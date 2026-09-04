//! Watching `~/.claude/projects` so the sidebar stays live.
//!
//! Two things make a naive watcher unusable here:
//!
//! - The watch must be recursive, because new project directories appear at runtime —
//!   but that means every append to a multi-megabyte live transcript fires an event.
//! - `ReadDirectoryChangesW` fires continuously during those appends.
//!
//! So events are filtered hard, debounced, and then the *rendered projection* is compared
//! rather than the events themselves (see `Index::scan_if_changed`). An append that grows
//! a file but changes nothing visible produces no re-render.

use std::path::Path;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// The live watcher. **Must be kept alive** — `Debouncer` stops watching on `Drop`, so
/// this is owned by `AppState` rather than dropped at the end of setup.
pub type SessionWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Whether a changed path could affect the sidebar.
///
/// `root` is the projects directory. Only `root/<project>/<session>.jsonl` qualifies:
/// anything under a `subagents/` directory is a subagent transcript, and anything deeper
/// is not a session at all.
pub fn is_relevant(root: &Path, path: &Path) -> bool {
    if path.extension().is_none_or(|e| e != "jsonl") {
        return false;
    }
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let parts: Vec<_> = rel.components().collect();
    // Exactly <project-dir>/<file>.jsonl
    parts.len() == 2
}

/// Start watching `root`, calling `on_change` after the debounce window whenever at least
/// one relevant path changed.
pub fn watch<F>(root: &Path, mut on_change: F) -> notify::Result<SessionWatcher>
where
    F: FnMut() + Send + 'static,
{
    let watched = root.to_path_buf();
    let for_filter = watched.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        // Coalesce: the whole batch is one question -- did anything relevant change?
        if events
            .iter()
            .flat_map(|e| e.paths.iter())
            .any(|p| is_relevant(&for_filter, p))
        {
            on_change();
        }
    })?;

    // The directory may not exist yet on a fresh machine; watching then is not an error
    // worth failing startup over.
    if watched.is_dir() {
        debouncer.watch(&watched, RecursiveMode::Recursive)?;
    }
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn root() -> PathBuf {
        PathBuf::from(r"C:\Users\x\.claude\projects")
    }

    #[test]
    fn a_session_transcript_is_relevant() {
        assert!(is_relevant(
            &root(),
            &root().join("D--Coding-p").join("abc.jsonl")
        ));
    }

    #[test]
    fn subagent_transcripts_are_ignored() {
        // These would otherwise fire constantly and inflate the session list.
        assert!(!is_relevant(
            &root(),
            &root()
                .join("D--Coding-p")
                .join("abc")
                .join("subagents")
                .join("agent-1.jsonl")
        ));
    }

    #[test]
    fn non_jsonl_files_are_ignored() {
        assert!(!is_relevant(
            &root(),
            &root().join("D--Coding-p").join("abc.meta.json")
        ));
        assert!(!is_relevant(&root(), &root().join("D--Coding-p")));
    }

    #[test]
    fn a_transcript_directly_in_the_root_is_ignored() {
        // Sessions always live one level down, inside a project directory.
        assert!(!is_relevant(&root(), &root().join("stray.jsonl")));
    }

    #[test]
    fn paths_outside_the_root_are_ignored() {
        assert!(!is_relevant(
            &root(),
            &PathBuf::from(r"D:\elsewhere\a\b.jsonl")
        ));
    }

    #[test]
    fn watching_a_missing_directory_is_not_an_error() {
        // Fresh machine, no ~/.claude yet. Startup must not fail.
        let d = tempfile::tempdir().unwrap();
        assert!(watch(&d.path().join("absent"), || {}).is_ok());
    }

    #[test]
    fn a_new_transcript_triggers_the_callback() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let d = tempfile::tempdir().unwrap();
        let root = d.path().to_path_buf();
        std::fs::create_dir_all(root.join("D--Coding-p")).unwrap();

        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let _w = watch(&root, move || {
            h.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        std::fs::write(root.join("D--Coding-p").join("new.jsonl"), "{}\n").unwrap();

        // Debounce window plus slack for the OS to deliver.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while hits.load(Ordering::Relaxed) == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(hits.load(Ordering::Relaxed) > 0, "watcher never fired");
    }

    #[test]
    fn an_irrelevant_file_does_not_trigger_the_callback() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let d = tempfile::tempdir().unwrap();
        let root = d.path().to_path_buf();
        let sub = root.join("D--Coding-p").join("sess").join("subagents");
        std::fs::create_dir_all(&sub).unwrap();

        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let _w = watch(&root, move || {
            h.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        std::fs::write(sub.join("agent-9.jsonl"), "{}\n").unwrap();
        std::fs::write(root.join("D--Coding-p").join("notes.txt"), "x").unwrap();

        std::thread::sleep(DEBOUNCE + Duration::from_millis(900));
        assert_eq!(
            hits.load(Ordering::Relaxed),
            0,
            "subagent and non-jsonl writes must not wake the sidebar"
        );
    }
}
