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
        ])
        .setup(|app| {
            start_watcher(app.handle());
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
