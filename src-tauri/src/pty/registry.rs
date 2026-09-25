//! Owns every live PTY and guarantees none outlive the app.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

use super::session::{PtyError, PtyEvent, PtySession, SpawnOpts, StatsSnapshot};

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    next_id: AtomicU64,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(&self, opts: SpawnOpts, ch: Channel<PtyEvent>) -> Result<String, PtyError> {
        let id = format!("pty-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let session = PtySession::spawn(id.clone(), opts, ch)?;
        self.sessions
            .lock()
            .expect("registry mutex")
            .insert(id.clone(), Arc::new(session));
        Ok(id)
    }

    /// Name of a program running under the shell, or `None` at a bare prompt (#106).
    pub fn busy_with(&self, id: &str) -> Result<Option<String>, PtyError> {
        Ok(self.get(id)?.pid.and_then(super::procs::first_child))
    }

    fn get(&self, id: &str) -> Result<Arc<PtySession>, PtyError> {
        self.sessions
            .lock()
            .expect("registry mutex")
            .get(id)
            .cloned()
            .ok_or_else(|| PtyError::NotFound(id.to_string()))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), PtyError> {
        self.get(id)?.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.get(id)?.resize(cols, rows)
    }

    pub fn ack(&self, id: &str, bytes: u64) -> Result<(), PtyError> {
        self.get(id)?.ack(bytes);
        Ok(())
    }

    pub fn stats(&self, id: &str) -> Result<StatsSnapshot, PtyError> {
        Ok(self.get(id)?.stats.snapshot())
    }

    /// Kill and forget. Closing the pseudoconsole takes the whole attached process tree
    /// with it, so `pwsh` -> `node` -> `claude` all go together.
    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let session = self
            .sessions
            .lock()
            .expect("registry mutex")
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;
        session.kill();
        Ok(())
    }

    pub fn ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .expect("registry mutex")
            .keys()
            .cloned()
            .collect()
    }

    /// Called on app exit. `ClosePseudoConsole` has a history of hanging, so the kills
    /// run on a detached thread with a deadline rather than blocking shutdown.
    pub fn kill_all(&self) {
        let sessions: Vec<Arc<PtySession>> = self
            .sessions
            .lock()
            .expect("registry mutex")
            .drain()
            .map(|(_, s)| s)
            .collect();

        if sessions.is_empty() {
            return;
        }

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for s in sessions {
                s.kill();
            }
            let _ = tx.send(());
        });
        // Best effort: never let a hung teardown wedge application exit.
        let _ = rx.recv_timeout(std::time::Duration::from_secs(3));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_ids_are_reported_not_panicked_on() {
        let reg = PtyRegistry::new();
        assert!(matches!(
            reg.write("nope", "x").unwrap_err(),
            PtyError::NotFound(_)
        ));
        assert!(matches!(
            reg.resize("nope", 10, 10).unwrap_err(),
            PtyError::NotFound(_)
        ));
        assert!(matches!(
            reg.kill("nope").unwrap_err(),
            PtyError::NotFound(_)
        ));
    }

    #[test]
    fn kill_all_on_an_empty_registry_is_a_noop() {
        // Runs on every app exit, including exits before any tab was opened.
        PtyRegistry::new().kill_all();
    }
}
