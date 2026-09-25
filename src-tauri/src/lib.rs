pub mod agent;
pub mod codex_limits;
pub mod commands;
pub mod error;
pub mod index;
pub mod paths;
pub mod pty;
pub mod settings;
pub mod state;

use tauri::{Emitter, Manager};

use state::AppState;

pub const EVENT_INDEX_UPDATED: &str = "index://updated";
pub const EVENT_SETTINGS_UPDATED: &str = "settings://updated";
pub const EVENT_TASKS_UPDATED: &str = "tasks://updated";

pub fn run() {
    // Must precede the first load, or an existing user gets factory defaults.
    if settings::migrate_legacy_config() {
        eprintln!("carried settings over from the pre-rename config directory");
    }
    let loaded = settings::load();
    if let settings::LoadOutcome::Invalid { error, .. } = &loaded {
        eprintln!("settings could not be parsed, using defaults: {error}");
    }
    let mut settings = loaded.settings();
    let tasks_path = settings::tasks::tasks_path();
    if settings::tasks::migrate(&mut settings, &tasks_path) {
        if let Err(e) = settings::save(&settings) {
            eprintln!("moved tasks to tasks.json but could not rewrite settings.json: {e}");
        }
    }
    let tasks = settings::tasks::load_or_back_up(&tasks_path);
    let cache_path = settings::config_dir()
        .join("cache")
        .join("session-index.v1.json");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(settings, tasks, cache_path))
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::agent_command,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_ack,
            commands::pty_kill,
            commands::pty_stats,
            commands::index_snapshot,
            commands::index_refresh,
            commands::settings_get,
            commands::settings_set,
            commands::tasks_get,
            commands::tasks_set,
            commands::open_in_explorer,
            commands::git_branches,
            commands::open_url,
            commands::open_settings_file,
            commands::write_text_file,
            commands::scratch_dir,
            commands::open_devtools,
            commands::usage_costs,
            commands::claude_usage,
            commands::codex_usage,
            commands::codex_usage_stop,
            commands::list_themes,
        ])
        .setup(|app| {
            start_watcher(app.handle());
            start_settings_watcher(app.handle());
            start_tasks_watcher(app.handle());
            disable_browser_accelerator_keys(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Never leave orphaned pwsh/node/claude processes behind.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app.state::<AppState>().codex_limits.stop();
                app.state::<AppState>().ptys.kill_all();
            }
        });
}

/// WebView2 eats Chromium's accelerators before the page sees them, silently: Ctrl+Shift+B
/// and Ctrl+Shift+D never arrive, and Ctrl+R would reload the app instead of reaching the
/// shell. Tauri exposes no setting for this, hence the COM call. Clipboard keys are
/// unaffected.
fn disable_browser_accelerator_keys(app: &tauri::App) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(webview) = app.get_webview_window("main") else {
            eprintln!("no main webview; browser accelerator keys left enabled");
            return;
        };
        // Costs a few shortcuts, not the app, so never fatal.
        let result = webview.with_webview(|platform| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows::core::Interface;

            let apply = || -> windows::core::Result<()> {
                let settings = platform.controller().CoreWebView2()?.Settings()?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(false)
            };
            if let Err(e) = apply() {
                eprintln!("could not disable browser accelerator keys: {e}");
            }
        });
        if let Err(e) = result {
            eprintln!("could not reach the platform webview: {e}");
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn start_settings_watcher(app: &tauri::AppHandle) {
    let path = settings::settings_path();
    let handle = app.clone();

    let watcher = settings::watcher::watch(&path, move || {
        let state = handle.state::<AppState>();
        match settings::load() {
            // A typo mid-edit is normal; the next save will be well-formed.
            settings::LoadOutcome::Invalid { error, .. } => {
                eprintln!("settings.json is not valid JSON, keeping current values: {error}");
            }
            outcome => {
                let next = outcome.settings();
                // `settings_set` writes this file, waking this watcher; comparing first
                // is what stops that becoming a loop.
                if next == state.settings.get() {
                    return;
                }
                apply_settings(&handle, next.clone());
                let _ = handle.emit(EVENT_SETTINGS_UPDATED, next);
            }
        }
    });

    match watcher {
        Ok(w) => {
            *app.state::<AppState>()
                .settings_watcher
                .lock()
                .expect("lock") = Some(w)
        }
        Err(e) => eprintln!("could not watch {}: {e}", path.display()),
    }
}

/// Store new settings and do only what the change needs (#87, #100): re-arm the
/// transcript watcher when a watched directory moved, rescan when the sidebar projection
/// may have. Anything else, a task-free font or view change, is just stored.
pub(crate) fn apply_settings(app: &tauri::AppHandle, next: settings::Settings) {
    let state = app.state::<AppState>();
    let prev = state.settings.get();
    state.settings.set(next.clone());
    if settings::dirs_changed(&prev, &next) {
        start_watcher(app);
    }
    if settings::projection_changed(&prev, &next) {
        // The next scan must report even if its hash happens to match.
        state.index.invalidate();
        if let Some(snap) = state.index.scan_if_changed(&next, false) {
            let _ = app.emit(EVENT_INDEX_UPDATED, snap);
        }
    }
}

/// `tasks.json` edited outside the app. Our own `tasks_set` writes wake this too; they
/// match the store and stop at the comparison.
fn start_tasks_watcher(app: &tauri::AppHandle) {
    let path = settings::tasks::tasks_path();
    let handle = app.clone();
    let watched = path.clone();
    let watcher = settings::watcher::watch(&path, move || {
        let state = handle.state::<AppState>();
        match settings::tasks::load_from(&watched) {
            Err(e) => eprintln!("tasks.json is not valid JSON, keeping current tasks: {e}"),
            Ok(next) if next != state.tasks.get() => {
                state.tasks.set(next.clone());
                let _ = handle.emit(EVENT_TASKS_UPDATED, next);
            }
            Ok(_) => {}
        }
    });
    match watcher {
        Ok(w) => *app.state::<AppState>().tasks_watcher.lock().expect("lock") = Some(w),
        Err(e) => eprintln!("could not watch {}: {e}", path.display()),
    }
}

pub(crate) fn start_watcher(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let state = app.state::<AppState>();
    let settings = state.settings.get();
    let root = settings.claude_projects_dir();
    let codex_home = settings.codex_home();
    let watched = [
        index::watcher::watch_point(&root).map(|(path, _)| path),
        index::watcher::watch_point(&codex_home).map(|(path, _)| path),
    ];
    let rearming = Arc::new(AtomicBool::new(false));

    let handle = app.clone();
    let watched_root = root.clone();
    let watched_codex = codex_home.clone();
    let watcher = index::watcher::watch_roots(&root, Some(&codex_home), move || {
        let state = handle.state::<AppState>();
        // A live session appends constantly; only emit when the projection differs.
        if let Some(snap) = state.index.scan_if_changed(&state.settings.get(), false) {
            let _ = handle.emit(EVENT_INDEX_UPDATED, snap);
        }
        let current = [
            index::watcher::watch_point(&watched_root).map(|(path, _)| path),
            index::watcher::watch_point(&watched_codex).map(|(path, _)| path),
        ];
        if current != watched && !rearming.swap(true, Ordering::AcqRel) {
            // Replacing the current watcher on its callback thread could join itself.
            let handle = handle.clone();
            std::thread::spawn(move || {
                start_watcher(&handle);
                // Catch files written between the first scan and the new watch.
                let state = handle.state::<AppState>();
                if let Some(snap) = state.index.scan_if_changed(&state.settings.get(), false) {
                    let _ = handle.emit(EVENT_INDEX_UPDATED, snap);
                }
            });
        }
    });

    match watcher {
        // Held for the life of the app: the debouncer stops watching when dropped.
        Ok(w) => *state.watcher.lock().expect("watcher lock") = Some(w),
        Err(e) => eprintln!("could not watch {}: {e}", root.display()),
    }
}
