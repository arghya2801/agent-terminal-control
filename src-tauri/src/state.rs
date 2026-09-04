//! Process-wide state handed to every command.

use crate::pty::registry::PtyRegistry;

#[derive(Default)]
pub struct AppState {
    pub ptys: PtyRegistry,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
