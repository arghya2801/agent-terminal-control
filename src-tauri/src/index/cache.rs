//! On-disk cache of parsed transcript heads.
//!
//! The scan re-runs on every watcher tick, and the corpus is already ~22MB. Re-parsing
//! everything each time would be wasteful, but the naive `(size, mtime)` key is close to
//! useless here: Claude *appends* to the live session constantly, so its size and mtime
//! change every few seconds.
//!
//! The saving grace is that only the **head** is ever read, and appends never touch it.
//! So a file that merely grew, whose cached entry already looks complete, is still valid
//! — refresh the mtime and skip the parse. Only a shrink or an in-place rewrite forces a
//! re-read.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::session::{LabelSource, SessionMeta};

/// Bump this whenever the parser could produce a different result for the same bytes.
/// A cached entry records the parser's *output*, so a parsing fix is invisible until the
/// cache is discarded -- which is a confusing way to discover that a fix "did not work".
///
/// 2: `ai-title` below the first user turn is no longer skipped (labels were falling
///    back to the uuid for real transcripts).
pub const SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    mtime_ms: u64,
    size: u64,
    cwd: Option<PathBuf>,
    git_branch: Option<String>,
    label: String,
    label_source: LabelSourceRepr,
}

/// Mirrors `LabelSource`; kept separate so the cache format is not hostage to an enum
/// used elsewhere.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum LabelSourceRepr {
    AiTitle,
    Slug,
    FirstMessage,
    Uuid,
}

impl From<LabelSource> for LabelSourceRepr {
    fn from(v: LabelSource) -> Self {
        match v {
            LabelSource::AiTitle => Self::AiTitle,
            LabelSource::Slug => Self::Slug,
            LabelSource::FirstMessage => Self::FirstMessage,
            LabelSource::Uuid => Self::Uuid,
        }
    }
}
impl From<LabelSourceRepr> for LabelSource {
    fn from(v: LabelSourceRepr) -> Self {
        match v {
            LabelSourceRepr::AiTitle => Self::AiTitle,
            LabelSourceRepr::Slug => Self::Slug,
            LabelSourceRepr::FirstMessage => Self::FirstMessage,
            LabelSourceRepr::Uuid => Self::Uuid,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCache {
    schema: u32,
    entries: HashMap<String, Entry>,
    #[serde(skip)]
    dirty: bool,
    #[serde(skip)]
    pub hits: u64,
    #[serde(skip)]
    pub misses: u64,
}

impl Default for SessionCache {
    fn default() -> Self {
        Self {
            schema: SCHEMA_VERSION,
            entries: HashMap::new(),
            dirty: false,
            hits: 0,
            misses: 0,
        }
    }
}

fn cache_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

impl SessionCache {
    pub fn load_from(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        match serde_json::from_str::<Self>(&text) {
            // A schema bump means a full rebuild rather than a subtly wrong cache.
            Ok(c) if c.schema == SCHEMA_VERSION => c,
            _ => Self::default(),
        }
    }

    pub fn save_to(&mut self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(self)?)?;
        std::fs::rename(&tmp, path)?;
        self.dirty = false;
        Ok(())
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Return cached metadata for `path` if it is still valid, else parse and store.
    pub fn get_or_parse(
        &mut self,
        path: &Path,
        parse: impl FnOnce(&Path) -> Option<SessionMeta>,
    ) -> Option<SessionMeta> {
        let meta = std::fs::metadata(path).ok()?;
        let size = meta.len();
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let key = cache_key(path);
        if let Some(hit) = self.entries.get_mut(&key) {
            if entry_still_valid(hit, size) {
                self.hits += 1;
                // The head is unchanged, but the file did grow: keep mtime current so
                // ordering by recency stays right.
                if hit.mtime_ms != mtime_ms || hit.size != size {
                    hit.mtime_ms = mtime_ms;
                    hit.size = size;
                    self.dirty = true;
                }
                return Some(SessionMeta {
                    id: path.file_stem()?.to_string_lossy().into_owned(),
                    file: path.to_path_buf(),
                    cwd: hit.cwd.clone(),
                    git_branch: hit.git_branch.clone(),
                    label: hit.label.clone(),
                    label_source: hit.label_source.into(),
                    mtime_ms,
                    size,
                });
            }
        }

        self.misses += 1;
        let parsed = parse(path)?;
        self.entries.insert(
            key,
            Entry {
                mtime_ms: parsed.mtime_ms,
                size: parsed.size,
                cwd: parsed.cwd.clone(),
                git_branch: parsed.git_branch.clone(),
                label: parsed.label.clone(),
                label_source: parsed.label_source.into(),
            },
        );
        self.dirty = true;
        Some(parsed)
    }

    /// Forget entries for files that no longer exist, so the cache cannot grow forever.
    pub fn retain_existing(&mut self, live: &[PathBuf]) {
        let live: std::collections::HashSet<String> = live.iter().map(|p| cache_key(p)).collect();
        let before = self.entries.len();
        self.entries.retain(|k, _| live.contains(k));
        if self.entries.len() != before {
            self.dirty = true;
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// A grown file whose cached head looks complete is still valid: appends never rewrite
/// the head. A shrink, or a same-size change, means the file was rewritten.
fn entry_still_valid(entry: &Entry, size: u64) -> bool {
    if size < entry.size {
        return false;
    }
    if size == entry.size {
        return true;
    }
    // Grew. Trust the cached head only if it actually captured something; an entry that
    // fell back to the uuid may simply not have reached the label yet.
    entry.cwd.is_some() && !matches!(entry.label_source, LabelSourceRepr::Uuid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn meta_for(path: &Path, label: &str, src: LabelSource) -> Option<SessionMeta> {
        let m = std::fs::metadata(path).ok()?;
        Some(SessionMeta {
            id: path.file_stem()?.to_string_lossy().into_owned(),
            file: path.to_path_buf(),
            cwd: Some(PathBuf::from(r"D:\Coding\p")),
            git_branch: None,
            label: label.into(),
            label_source: src,
            mtime_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            size: m.len(),
        })
    }

    struct Counter(AtomicUsize);
    impl Counter {
        fn new() -> Self {
            Self(AtomicUsize::new(0))
        }
        fn count(&self) -> usize {
            self.0.load(Ordering::Relaxed)
        }
    }

    #[test]
    fn a_second_lookup_of_an_unchanged_file_does_not_reparse() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        std::fs::write(&p, "line\n").unwrap();

        let mut cache = SessionCache::default();
        let calls = Counter::new();
        for _ in 0..2 {
            cache.get_or_parse(&p, |path| {
                calls.0.fetch_add(1, Ordering::Relaxed);
                meta_for(path, "Label", LabelSource::AiTitle)
            });
        }
        assert_eq!(calls.count(), 1);
        assert_eq!(cache.hits, 1);
    }

    #[test]
    fn an_appended_file_is_not_reparsed_but_its_mtime_updates() {
        // The case that matters: Claude appends to the live session constantly, and the
        // head never changes.
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        std::fs::write(&p, "head\n").unwrap();

        let mut cache = SessionCache::default();
        let calls = Counter::new();
        let first = cache
            .get_or_parse(&p, |path| {
                calls.0.fetch_add(1, Ordering::Relaxed);
                meta_for(path, "Label", LabelSource::AiTitle)
            })
            .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&p, "head\nappended appended appended\n").unwrap();

        let second = cache
            .get_or_parse(&p, |path| {
                calls.0.fetch_add(1, Ordering::Relaxed);
                meta_for(path, "Label", LabelSource::AiTitle)
            })
            .unwrap();

        assert_eq!(calls.count(), 1, "an append must not force a re-parse");
        assert_eq!(second.label, "Label");
        assert!(second.size > first.size);
        assert!(
            second.mtime_ms >= first.mtime_ms,
            "recency must stay current"
        );
    }

    #[test]
    fn a_shrunken_file_is_reparsed() {
        // Truncation means the head really could have changed.
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        std::fs::write(&p, "aaaaaaaaaaaaaaaaaaaa\n").unwrap();

        let mut cache = SessionCache::default();
        let calls = Counter::new();
        cache.get_or_parse(&p, |path| {
            calls.0.fetch_add(1, Ordering::Relaxed);
            meta_for(path, "Label", LabelSource::AiTitle)
        });
        std::fs::write(&p, "b\n").unwrap();
        cache.get_or_parse(&p, |path| {
            calls.0.fetch_add(1, Ordering::Relaxed);
            meta_for(path, "Label", LabelSource::AiTitle)
        });
        assert_eq!(calls.count(), 2);
    }

    #[test]
    fn a_grown_file_whose_head_never_yielded_a_label_is_retried() {
        // The head budget may simply not have reached the label yet.
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        std::fs::write(&p, "x\n").unwrap();

        let mut cache = SessionCache::default();
        let calls = Counter::new();
        cache.get_or_parse(&p, |path| {
            calls.0.fetch_add(1, Ordering::Relaxed);
            meta_for(path, "abcd1234", LabelSource::Uuid)
        });
        std::fs::write(&p, "x\nmore content here\n").unwrap();
        cache.get_or_parse(&p, |path| {
            calls.0.fetch_add(1, Ordering::Relaxed);
            meta_for(path, "Real Title", LabelSource::AiTitle)
        });
        assert_eq!(calls.count(), 2, "a uuid label is worth retrying");
    }

    #[test]
    fn round_trips_through_disk() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        std::fs::write(&p, "x\n").unwrap();
        let cache_path = d.path().join("cache").join("index.json");

        let mut cache = SessionCache::default();
        cache.get_or_parse(&p, |path| meta_for(path, "Label", LabelSource::AiTitle));
        assert!(cache.is_dirty());
        cache.save_to(&cache_path).unwrap();
        assert!(!cache.is_dirty());
        assert!(!cache_path.with_extension("json.tmp").exists());

        let mut reloaded = SessionCache::load_from(&cache_path);
        assert_eq!(reloaded.len(), 1);
        let calls = Counter::new();
        reloaded.get_or_parse(&p, |path| {
            calls.0.fetch_add(1, Ordering::Relaxed);
            meta_for(path, "Label", LabelSource::AiTitle)
        });
        assert_eq!(calls.count(), 0, "a persisted cache must survive restart");
    }

    #[test]
    fn a_schema_bump_discards_the_cache() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("index.json");
        std::fs::write(&p, r#"{"schema":999,"entries":{"x":{}}}"#).unwrap();
        assert!(SessionCache::load_from(&p).is_empty());
    }

    #[test]
    fn a_corrupt_cache_file_is_discarded_rather_than_fatal() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("index.json");
        std::fs::write(&p, "not json at all").unwrap();
        assert!(SessionCache::load_from(&p).is_empty());
    }

    #[test]
    fn deleted_sessions_are_evicted() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.jsonl");
        let b = d.path().join("b.jsonl");
        std::fs::write(&a, "x\n").unwrap();
        std::fs::write(&b, "x\n").unwrap();

        let mut cache = SessionCache::default();
        cache.get_or_parse(&a, |p| meta_for(p, "A", LabelSource::AiTitle));
        cache.get_or_parse(&b, |p| meta_for(p, "B", LabelSource::AiTitle));
        assert_eq!(cache.len(), 2);

        cache.retain_existing(std::slice::from_ref(&a));
        assert_eq!(cache.len(), 1);
    }
}
