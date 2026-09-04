//! The whole IPC surface, as thin delegation. Keeping it in one file makes what the
//! frontend can reach auditable at a glance.

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::pty::session::{PtyEvent, SpawnOpts, StatsSnapshot};
use crate::pty::shell::{resolve_shell, ShellInfo};
use crate::state::AppState;

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

#[tauri::command]
pub fn resolve_shell_cmd(path: Option<String>) -> AppResult<ShellInfo> {
    Ok(resolve_shell(path.as_deref())?)
}
