//! Loading and saving settings.

pub mod model;
pub mod tasks;
pub mod watcher;

use std::path::PathBuf;
use std::sync::RwLock;

pub use model::{ClaudeSettings, PinnedProject, ProjectSettings, Settings, Task, UiSettings};

/// The folder users actually browse to, so it reads as a product name rather than a
/// bundle identifier.
const APP_DIR: &str = "Agent Terminal Control";

/// Folder names this app has used before, newest first. The first one holding a settings
/// file wins the migration.
const LEGACY_APP_DIRS: [&str; 2] = ["dev.arghya.atc", "dev.arghya.ccpg"];

/// Config directory. `ATC_CONFIG_DIR` lets the playground run against fixtures without
/// touching the real config. Made absolute because the watcher compares against the
/// absolute paths `notify` reports; not canonicalized, which would add a `\\?\` prefix.
pub fn config_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("ATC_CONFIG_DIR") {
        let d = PathBuf::from(d);
        return std::path::absolute(&d).unwrap_or(d);
    }
    appdata().join(APP_DIR)
}

fn appdata() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

/// Carry settings over from an earlier config directory, once.
///
/// A copy rather than a move, so a bad migration cannot lose the original. Only the
/// settings file: the index cache rebuilds itself in milliseconds.
pub fn migrate_from(legacy_dir: &std::path::Path, current_dir: &std::path::Path) -> bool {
    let target = current_dir.join("settings.json");
    let source = legacy_dir.join("settings.json");
    // Never overwrite settings that already exist here.
    if target.exists() || !source.is_file() {
        return false;
    }
    if std::fs::create_dir_all(current_dir).is_err() {
        return false;
    }
    std::fs::copy(&source, &target).is_ok()
}

/// Run the one-time migration against the real directories.
pub fn migrate_legacy_config() -> bool {
    // An overridden config dir was never one of the old locations.
    if std::env::var_os("ATC_CONFIG_DIR").is_some() {
        return false;
    }
    let current = config_dir();
    LEGACY_APP_DIRS
        .iter()
        .any(|old| migrate_from(&appdata().join(old), &current))
}

#[derive(Debug)]
pub enum LoadOutcome {
    /// Loaded from disk.
    Loaded(Settings),
    /// No file yet; defaults are in use.
    Missing(Settings),
    /// The file exists but could not be parsed. Defaults are in use and **the file has
    /// not been touched** — clobbering a user's hand-edited config because of a typo
    /// would be far worse than running on defaults for one session.
    Invalid { settings: Settings, error: String },
}

impl LoadOutcome {
    pub fn settings(self) -> Settings {
        match self {
            LoadOutcome::Loaded(s) | LoadOutcome::Missing(s) => s,
            LoadOutcome::Invalid { settings, .. } => settings,
        }
    }
}

pub fn load_from(path: &std::path::Path) -> LoadOutcome {
    let Ok(text) = std::fs::read_to_string(path) else {
        return LoadOutcome::Missing(Settings::default());
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(s) => LoadOutcome::Loaded(s),
        Err(e) => LoadOutcome::Invalid {
            settings: Settings::default(),
            error: e.to_string(),
        },
    }
}

pub fn load() -> LoadOutcome {
    load_from(&settings_path())
}

pub fn save_to<T: serde::Serialize + ?Sized>(
    path: &std::path::Path,
    value: &T,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(value)?;
    // Temp file + rename so a crash mid-write cannot leave a truncated config.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    save_to(&settings_path(), settings)
}

/// Whether the transcript watcher must be re-armed: it watches these two directories.
pub fn dirs_changed(prev: &Settings, next: &Settings) -> bool {
    prev.projects.claude_projects_dir != next.projects.claude_projects_dir
        || prev.codex.home_dir != next.codex.home_dir
}

/// Whether the sidebar projection may have moved, so the index must rescan and report.
/// Everything else (font, zoom, theme, the sidebar view) only needs storing.
pub fn projection_changed(prev: &Settings, next: &Settings) -> bool {
    dirs_changed(prev, next)
        || prev.projects != next.projects
        || prev.claude.scratch_dir != next.claude.scratch_dir
}

/// Process-wide value shared with every command: the settings, and the tasks.
#[derive(Debug, Default)]
pub struct Store<T> {
    inner: RwLock<T>,
}

pub type SettingsStore = Store<Settings>;

impl<T: Clone> Store<T> {
    pub fn new(value: T) -> Self {
        Self {
            inner: RwLock::new(value),
        }
    }
    pub fn get(&self) -> T {
        self.inner.read().expect("store lock").clone()
    }
    pub fn set(&self, value: T) {
        *self.inner.write().expect("store lock") = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn a_missing_file_yields_defaults() {
        let d = tmp();
        let p = d.path().join("settings.json");
        assert!(matches!(load_from(&p), LoadOutcome::Missing(_)));
    }

    #[test]
    fn a_partial_file_loads() {
        let d = tmp();
        let p = d.path().join("settings.json");
        std::fs::write(&p, r#"{"ui":{"sidebarWidth":320}}"#).unwrap();
        let LoadOutcome::Loaded(s) = load_from(&p) else {
            panic!("expected Loaded");
        };
        assert_eq!(s.ui.sidebar_width, 320);
        assert_eq!(s.ui.sessions_per_project, 15);
    }

    #[test]
    fn malformed_json_uses_defaults_and_leaves_the_file_alone() {
        let d = tmp();
        let p = d.path().join("settings.json");
        let original = "{ this is not json";
        std::fs::write(&p, original).unwrap();

        let outcome = load_from(&p);
        assert!(matches!(outcome, LoadOutcome::Invalid { .. }));
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            original,
            "a typo in settings must never cost the user their file"
        );
    }

    #[test]
    fn save_then_load_round_trips() {
        let d = tmp();
        let p = d.path().join("nested").join("settings.json");
        let mut s = Settings::default();
        s.ui.sidebar_open = false;
        s.projects.claude_projects_dir = Some(r"D:\fixtures".into());

        save_to(&p, &s).unwrap();
        let LoadOutcome::Loaded(back) = load_from(&p) else {
            panic!("expected Loaded");
        };
        assert_eq!(back, s);
    }

    #[test]
    fn saving_leaves_no_temp_file_behind() {
        let d = tmp();
        let p = d.path().join("settings.json");
        save_to(&p, &Settings::default()).unwrap();
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn the_config_dir_can_be_redirected_for_the_playground() {
        // npm run play relies on this to keep real config untouched.
        let key = "ATC_CONFIG_DIR";
        let prev = std::env::var_os(key);
        std::env::set_var(key, r"D:\playground\config");
        assert_eq!(config_dir(), PathBuf::from(r"D:\playground\config"));
        // A relative spelling must come back absolute, or the watcher never matches (#67).
        std::env::set_var(key, "./playground/config");
        let dir = config_dir();
        assert!(dir.is_absolute(), "got {dir:?}");
        assert!(dir.ends_with("playground/config"), "got {dir:?}");
        match prev {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn migration_carries_settings_from_the_old_directory() {
        // The rename moved the config directory; a user's pins must survive it.
        let d = tmp();
        let legacy = d.path().join("dev.arghya.ccpg");
        let current = d.path().join("dev.arghya.atc");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), r#"{"ui":{"zoom":1.5}}"#).unwrap();

        assert!(migrate_from(&legacy, &current));
        let LoadOutcome::Loaded(s) = load_from(&current.join("settings.json")) else {
            panic!("expected the migrated file to load");
        };
        assert_eq!(s.ui.zoom, 1.5);
    }

    #[test]
    fn migration_leaves_the_original_in_place() {
        // A copy, not a move: if the migration is wrong, the old file is still there.
        let d = tmp();
        let legacy = d.path().join("old");
        let current = d.path().join("new");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();

        migrate_from(&legacy, &current);
        assert!(legacy.join("settings.json").exists());
    }

    #[test]
    fn migration_never_overwrites_existing_settings() {
        let d = tmp();
        let legacy = d.path().join("old");
        let current = d.path().join("new");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(legacy.join("settings.json"), r#"{"ui":{"zoom":2.0}}"#).unwrap();
        std::fs::write(current.join("settings.json"), r#"{"ui":{"zoom":1.0}}"#).unwrap();

        assert!(!migrate_from(&legacy, &current), "should decline");
        let LoadOutcome::Loaded(s) = load_from(&current.join("settings.json")) else {
            panic!("expected Loaded");
        };
        assert_eq!(s.ui.zoom, 1.0, "existing settings must win");
    }

    #[test]
    fn the_config_folder_is_named_for_the_product_not_the_author() {
        // It sits in every user's AppData, so it should not carry a bundle identifier.
        let key = "ATC_CONFIG_DIR";
        let prev = std::env::var_os(key);
        std::env::remove_var(key);
        let dir = config_dir();
        if let Some(v) = prev {
            std::env::set_var(key, v);
        }
        assert!(dir.ends_with("Agent Terminal Control"), "got {dir:?}");
    }

    #[test]
    fn migration_is_idempotent_and_quiet_when_there_is_nothing_to_do() {
        let d = tmp();
        let legacy = d.path().join("absent");
        let current = d.path().join("new");
        assert!(!migrate_from(&legacy, &current));
        // Running twice with a source present must still only copy once.
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        assert!(migrate_from(&legacy, &current));
        assert!(!migrate_from(&legacy, &current));
    }

    #[test]
    fn only_directory_and_projection_changes_need_more_than_a_store() {
        // #87: a font or view change must not restart the watcher or rescan.
        let prev = Settings::default();
        let mut next = prev.clone();
        next.ui.zoom = 1.5;
        next.ui.sidebar_view = "tasks".into();
        next.terminal.font_size = 20;
        assert!(!dirs_changed(&prev, &next));
        assert!(!projection_changed(&prev, &next));

        let mut named = prev.clone();
        named.projects.names.insert(r"D:\atc".into(), "atc".into());
        assert!(!dirs_changed(&prev, &named));
        assert!(projection_changed(&prev, &named));

        let mut moved = prev.clone();
        moved.codex.home_dir = Some(r"D:\codex".into());
        assert!(dirs_changed(&prev, &moved));
        assert!(projection_changed(&prev, &moved));
    }

    #[test]
    fn the_store_shares_updates() {
        let store = SettingsStore::new(Settings::default());
        let mut s = store.get();
        s.ui.sidebar_open = false;
        store.set(s);
        assert!(!store.get().ui.sidebar_open);
    }
}
