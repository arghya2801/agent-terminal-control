//! Process-wide state handed to every command.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::index::cost::CostIndex;
use crate::index::watcher::SessionWatcher;
use crate::index::Index;
use crate::pty::registry::PtyRegistry;
use crate::settings::watcher::SettingsWatcher;
use crate::settings::{Settings, SettingsStore, Store, Task};

pub struct AppState {
    pub ptys: PtyRegistry,
    pub settings: SettingsStore,
    pub tasks: Store<Vec<Task>>,
    pub index: Index,
    pub costs: CostIndex,
    pub codex_costs: crate::index::codex_cost::CodexCostIndex,
    pub codex_limits: crate::codex_limits::Client,
    /// The filesystem watcher stops on `Drop`, so it lives here for the life of the app
    /// rather than being dropped at the end of setup.
    pub watcher: Mutex<Option<SessionWatcher>>,
    /// Same again for the settings and tasks file watchers.
    pub settings_watcher: Mutex<Option<SettingsWatcher>>,
    pub tasks_watcher: Mutex<Option<SettingsWatcher>>,
}

impl AppState {
    pub fn new(settings: Settings, tasks: Vec<Task>, cache_path: PathBuf) -> Self {
        Self {
            ptys: PtyRegistry::new(),
            settings: SettingsStore::new(settings),
            tasks: Store::new(tasks),
            index: Index::new(cache_path),
            costs: CostIndex::default(),
            codex_costs: Default::default(),
            codex_limits: Default::default(),
            watcher: Mutex::new(None),
            settings_watcher: Mutex::new(None),
            tasks_watcher: Mutex::new(None),
        }
    }
}
