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

pub fn run() {
    // Must precede the first load, or an existing user gets factory defaults.
    if settings::migrate_legacy_config() {
        eprintln!("carried settings over from the pre-rename config directory");
    }
    let loaded = settings::load();
    if let settings::LoadOutcome::Invalid { error, .. } = &loaded {
        eprintln!("settings could not be parsed, using defaults: {error}");
    }
    let settings = loaded.settings();
    let cache_path = settings::config_dir()
        .join("cache")
        .join("session-index.v1.json");

    tauri::Builder::default()
        .manage(AppState::new(settings, cache_path))
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_ack,
            commands::pty_kill,
            commands::pty_stats,
            commands::index_snapshot,
            commands::index_refresh,
            commands::settings_get,
            commands::settings_set,
            commands::open_in_explorer,
            commands::open_settings_file,
            commands::open_devtools,
        ])
        .setup(|app| {
            start_watcher(app.handle());
            start_settings_watcher(app.handle());
            disable_browser_accelerator_keys(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Never leave orphaned pwsh/node/claude processes behind.
            if let tauri::RunEvent::ExitRequested { .. } = event {
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
                state.settings.set(next.clone());
                state.index.invalidate();
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

fn start_watcher(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let root = state.settings.get().claude_projects_dir();

    let handle = app.clone();
    let watcher = index::watcher::watch(&root, move || {
        let state = handle.state::<AppState>();
        // A live session appends constantly; only emit when the projection differs.
        if let Some(snap) = state.index.scan_if_changed(&state.settings.get(), false) {
            let _ = handle.emit(EVENT_INDEX_UPDATED, snap);
        }
    });

    match watcher {
        // Held for the life of the app: the debouncer stops watching when dropped.
        Ok(w) => *state.watcher.lock().expect("watcher lock") = Some(w),
        Err(e) => eprintln!("could not watch {}: {e}", root.display()),
    }
}
