//! The whole IPC surface, as thin delegation. Keeping it in one file makes what the
//! frontend can reach auditable at a glance.

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::index::IndexSnapshot;
use crate::pty::session::{PtyEvent, SpawnOpts, StatsSnapshot};
use crate::settings::Settings;
use crate::state::AppState;

// --- pty -------------------------------------------------------------------

#[tauri::command]
pub fn pty_spawn(
    opts: SpawnOpts,
    on_event: Channel<PtyEvent>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    Ok(state.ptys.spawn(opts, on_event)?)
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.write(&id, &data)?)
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.resize(&id, cols, rows)?)
}

#[tauri::command]
pub fn pty_ack(id: String, bytes: u64, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.ack(&id, bytes)?)
}

#[tauri::command]
pub fn pty_kill(id: String, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.ptys.kill(&id)?)
}

#[tauri::command]
pub fn pty_stats(id: String, state: State<'_, AppState>) -> AppResult<StatsSnapshot> {
    Ok(state.ptys.stats(&id)?)
}

// --- index -----------------------------------------------------------------

#[tauri::command]
pub fn index_snapshot(state: State<'_, AppState>) -> AppResult<IndexSnapshot> {
    Ok(state.index.scan(&state.settings.get(), false))
}

#[tauri::command]
pub fn index_refresh(force: bool, state: State<'_, AppState>) -> AppResult<IndexSnapshot> {
    // An explicit refresh should always report, even if nothing changed.
    state.index.invalidate();
    Ok(state.index.scan(&state.settings.get(), force))
}

// --- settings --------------------------------------------------------------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings.get())
}

#[tauri::command]
pub fn settings_set(settings: Settings, state: State<'_, AppState>) -> AppResult<()> {
    crate::settings::save(&settings).map_err(crate::error::AppError::Io)?;
    state.settings.set(settings);
    // Settings can repoint the projects directory, so the next scan must report.
    state.index.invalidate();
    Ok(())
}

// --- misc ------------------------------------------------------------------

/// Devtools, re-added under our own chord after WebView2's F12 was turned off.
/// Debug builds only: release has no path to it at all.
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Open `settings.json` with the default handler, writing defaults first if it is
/// missing so the button is never a dead end.
#[tauri::command]
pub fn open_settings_file(state: State<'_, AppState>) -> AppResult<()> {
    let path = crate::settings::settings_path();
    if !path.exists() {
        crate::settings::save(&state.settings.get()).map_err(crate::error::AppError::Io)?;
    }
    // `explorer <file>` opens with the default handler and involves no shell; `cmd /C
    // start` would interpret metacharacters in the path.
    open_with_shell_handler(&path)
}

fn open_with_shell_handler(path: &std::path::Path) -> AppResult<()> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(crate::error::AppError::Io)?;
    Ok(())
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> AppResult<()> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(crate::error::AppError::Message(format!(
            "path no longer exists: {path}"
        )));
    }
    open_with_shell_handler(p)
}
