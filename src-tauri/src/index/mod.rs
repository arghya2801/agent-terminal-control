//! Discovering projects and their Claude sessions.

pub mod cache;
pub mod project;
pub mod session;
pub mod watcher;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::settings::Settings;
use cache::SessionCache;
pub use project::{IndexSnapshot, Project};
pub use session::SessionMeta;

/// Every `*.jsonl` at depth 1 under every project directory.
///
/// Depth 1 is the whole trick: `<uuid>/subagents/*.jsonl` are subagent transcripts, and
/// a recursive walk reports roughly twice as many sessions as exist.
pub fn discover_session_files(projects_root: &Path) -> Vec<PathBuf> {
    let Ok(dirs) = std::fs::read_dir(projects_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for dir in dirs.filter_map(Result::ok) {
        let p = dir.path();
        if p.is_dir() {
            out.extend(session::session_files(&p));
        }
    }
    out.sort();
    out
}

/// The index, plus the cache that makes rescans cheap.
pub struct Index {
    cache: Mutex<SessionCache>,
    cache_path: PathBuf,
    /// Hash of the last snapshot handed to the frontend, so a rescan that changes
    /// nothing does not trigger a re-render.
    last_hash: Mutex<Option<u64>>,
}

impl Index {
    pub fn new(cache_path: PathBuf) -> Self {
        Self {
            cache: Mutex::new(SessionCache::load_from(&cache_path)),
            cache_path,
            last_hash: Mutex::new(None),
        }
    }

    /// Rescan and build a snapshot. `force` bypasses the cache entirely.
    pub fn scan(&self, settings: &Settings, force: bool) -> IndexSnapshot {
        let root = settings.claude_projects_dir();
        let files = discover_session_files(&root);

        let mut cache = self.cache.lock().expect("index cache");
        if force {
            *cache = SessionCache::default();
        }
        cache.retain_existing(&files);

        let sessions: Vec<SessionMeta> = files
            .iter()
            .filter_map(|f| cache.get_or_parse(f, session::read_session))
            .collect();

        if cache.is_dirty() {
            let _ = cache.save_to(&self.cache_path);
        }
        drop(cache);

        project::build(sessions, settings)
    }

    /// Scan, returning the snapshot only when it differs from the last one emitted.
    ///
    /// The watcher fires continuously while a session is being written; without this the
    /// sidebar would re-render many times a second for no visible change.
    pub fn scan_if_changed(&self, settings: &Settings, force: bool) -> Option<IndexSnapshot> {
        let snap = self.scan(settings, force);
        let hash = hash_snapshot(&snap);
        let mut last = self.last_hash.lock().expect("index hash");
        if *last == Some(hash) {
            return None;
        }
        *last = Some(hash);
        Some(snap)
    }

    /// Forget the last-emitted hash, so the next scan always reports a change.
    pub fn invalidate(&self) {
        *self.last_hash.lock().expect("index hash") = None;
    }
}

/// Hash the *projection the sidebar renders*, not raw filesystem events. An append that
/// changes a file's size but nothing the user can see must not count as a change.
fn hash_snapshot(snap: &IndexSnapshot) -> u64 {
    let mut h = DefaultHasher::new();
    snap.projects.len().hash(&mut h);
    for p in &snap.projects {
        p.key.hash(&mut h);
        p.name.hash(&mut h);
        p.pinned.hash(&mut h);
        p.exists.hash(&mut h);
        p.sessions.len().hash(&mut h);
        for s in &p.sessions {
            s.id.hash(&mut h);
            s.label.hash(&mut h);
            s.git_branch.hash(&mut h);
        }
    }
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("fixtures")
            .join("claude-projects")
    }

    fn fixture_settings() -> Settings {
        let mut s = Settings::default();
        s.projects.claude_projects_dir = Some(fixtures().to_string_lossy().into_owned());
        s
    }

    fn index(dir: &tempfile::TempDir) -> Index {
        Index::new(dir.path().join("index.json"))
    }

    #[test]
    fn discovery_skips_subagent_transcripts() {
        let files = discover_session_files(&fixtures());
        assert!(
            files
                .iter()
                .all(|f| !f.to_string_lossy().contains("subagents")),
            "{files:?}"
        );
        // 3 game-tracker + 2 portfolio2 + 1 deleted-project + 1 headless.
        assert_eq!(files.len(), 7, "{files:?}");
    }

    #[test]
    fn a_missing_root_yields_nothing_rather_than_erroring() {
        assert!(discover_session_files(&fixtures().join("nope")).is_empty());
    }

    #[test]
    fn scanning_the_corpus_groups_it_into_projects() {
        let d = tempfile::tempdir().unwrap();
        let snap = index(&d).scan(&fixture_settings(), false);

        assert_eq!(snap.session_count, 7);
        let names: Vec<&str> = snap.projects.iter().map(|p| p.name.as_str()).collect();
        // The underscore proves cwd was read rather than the directory name decoded.
        assert!(names.contains(&"game_tracker_app"), "{names:?}");
        assert!(names.contains(&"portfolio2"), "{names:?}");
        assert!(names.contains(&"Unknown"), "{names:?}");
    }

    #[test]
    fn the_game_tracker_project_has_exactly_three_sessions() {
        let d = tempfile::tempdir().unwrap();
        let snap = index(&d).scan(&fixture_settings(), false);
        let p = snap
            .projects
            .iter()
            .find(|p| p.name == "game_tracker_app")
            .expect("game_tracker_app present");
        assert_eq!(p.sessions.len(), 3, "a recursive walk would say 4");
    }

    #[test]
    fn a_rescan_that_changes_nothing_reports_no_change() {
        // This is what keeps the sidebar from re-rendering while a session is live.
        let d = tempfile::tempdir().unwrap();
        let idx = index(&d);
        let s = fixture_settings();

        assert!(
            idx.scan_if_changed(&s, false).is_some(),
            "first scan is a change"
        );
        assert!(idx.scan_if_changed(&s, false).is_none(), "nothing changed");
        assert!(idx.scan_if_changed(&s, false).is_none());
    }

    #[test]
    fn invalidate_forces_the_next_scan_to_report() {
        let d = tempfile::tempdir().unwrap();
        let idx = index(&d);
        let s = fixture_settings();
        idx.scan_if_changed(&s, false);
        idx.invalidate();
        assert!(idx.scan_if_changed(&s, false).is_some());
    }

    #[test]
    fn the_cache_persists_between_scans() {
        let d = tempfile::tempdir().unwrap();
        let cache_path = d.path().join("index.json");
        let s = fixture_settings();

        Index::new(cache_path.clone()).scan(&s, false);
        assert!(cache_path.exists(), "cache should have been written");

        let second = Index::new(cache_path);
        second.scan(&s, false);
        let cache = second.cache.lock().unwrap();
        assert!(cache.hits > 0, "a warm cache should hit");
    }

    #[test]
    fn forcing_a_scan_bypasses_the_cache() {
        let d = tempfile::tempdir().unwrap();
        let idx = index(&d);
        let s = fixture_settings();
        idx.scan(&s, false);
        idx.scan(&s, true);
        assert_eq!(idx.cache.lock().unwrap().hits, 0, "force must re-parse");
    }
}
