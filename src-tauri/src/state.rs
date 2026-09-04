//! Process-wide state handed to every command.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::index::watcher::SessionWatcher;
use crate::index::Index;
use crate::pty::registry::PtyRegistry;
use crate::settings::{Settings, SettingsStore};

pub struct AppState {
    pub ptys: PtyRegistry,
    pub settings: SettingsStore,
    pub index: Index,
    /// The filesystem watcher stops on `Drop`, so it lives here for the life of the app
    /// rather than being dropped at the end of setup.
    pub watcher: Mutex<Option<SessionWatcher>>,
}

impl AppState {
    pub fn new(settings: Settings, cache_path: PathBuf) -> Self {
        Self {
            ptys: PtyRegistry::new(),
            settings: SettingsStore::new(settings),
            index: Index::new(cache_path),
            watcher: Mutex::new(None),
        }
    }
}
