pub mod commands;
pub mod error;
pub mod index;
pub mod paths;
pub mod pty;
pub mod settings;
pub mod state;

use tauri::{Emitter, Manager};

use state::AppState;

/// Emitted when the project/session index changes. Low-rate, so a plain event is right;
/// `Channel` stays exclusive to the PTY stream.
pub const EVENT_INDEX_UPDATED: &str = "index://updated";
/// Emitted when `settings.json` changes on disk and actually differs from what is loaded.
pub const EVENT_SETTINGS_UPDATED: &str = "settings://updated";

pub fn run() {
    let loaded = settings::load();
    if let settings::LoadOutcome::Invalid { error, .. } = &loaded {
        // Running on defaults for one session beats silently rewriting a config the user
        // hand-edited. The file is left exactly as it is.
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
            commands::resolve_shell_cmd,
            commands::index_snapshot,
            commands::index_refresh,
            commands::settings_get,
            commands::settings_set,
            commands::settings_path,
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

/// Stop WebView2 handling Chromium's own accelerator keys.
///
/// It consumes them before they reach the page, which is why Ctrl+Shift+B and
/// Ctrl+Shift+D did nothing while Ctrl+Shift+T and Ctrl+Shift+W worked -- Chromium binds
/// the first two (bookmarks bar, bookmark all tabs) and has nothing meaningful for the
/// others. The action is a no-op in an embedded webview, but the key is still eaten, so
/// the symptom is silence rather than an error.
///
/// Turning them off also stops Ctrl+R and F5 reloading the app, Ctrl+P opening a print
/// dialog, and Ctrl+/- zooming -- all wrong in a terminal, and Ctrl+R in particular is
/// Claude Code's verbose toggle. Clipboard keys are unaffected: Microsoft classes
/// Ctrl+C/V/X and Ctrl+A as not browser-specific.
///
/// `wry` exposes a flag for this but Tauri never calls it, so the WebView2 default
/// (enabled) stands and we reach for the COM interface directly.
fn disable_browser_accelerator_keys(app: &tauri::App) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(webview) = app.get_webview_window("main") else {
            eprintln!("no main webview; browser accelerator keys left enabled");
            return;
        };
        // Failing here costs a few shortcuts, not the app: warn and carry on rather
        // than refusing to start.
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

/// Apply `settings.json` edits without a restart.
fn start_settings_watcher(app: &tauri::AppHandle) {
    let path = settings::settings_path();
    let handle = app.clone();

    let watcher = settings::watcher::watch(&path, move || {
        let state = handle.state::<AppState>();
        match settings::load() {
            // A typo mid-edit is normal. Keep what is loaded and say nothing further --
            // the next save will be well-formed.
            settings::LoadOutcome::Invalid { error, .. } => {
                eprintln!("settings.json is not valid JSON, keeping current values: {error}");
            }
            outcome => {
                let next = outcome.settings();
                // Our own `settings_set` writes this file, which wakes this watcher.
                // Comparing before emitting is what stops that becoming a loop.
                if next == state.settings.get() {
                    return;
                }
                state.settings.set(next.clone());
                // The projects directory may have moved.
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
        // Only emit when the rendered projection actually differs -- a live session
        // appends constantly and would otherwise re-render the sidebar continuously.
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
