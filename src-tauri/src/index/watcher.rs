//! Watching `~/.claude/projects` so the sidebar stays live.
//!
//! The watch has to be recursive, since project directories appear at runtime, which
//! means every append to a live transcript fires an event. Events are therefore filtered
//! hard and debounced, and the rendered projection is compared rather than the events
//! themselves — see `Index::scan_if_changed`.

use std::path::Path;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// The live watcher. **Must be kept alive** — `Debouncer` stops watching on `Drop`, so
/// this is owned by `AppState` rather than dropped at the end of setup.
pub type SessionWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

fn watchable_root(target: &Path) -> Option<&Path> {
    target.is_dir().then_some(target)
}

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
pub fn watch<F>(root: &Path, on_change: F) -> notify::Result<SessionWatcher>
where
    F: FnMut() + Send + 'static,
{
    watch_roots(root, None, on_change)
}

pub fn watch_roots<F>(
    root: &Path,
    codex_home: Option<&Path>,
    mut on_change: F,
) -> notify::Result<SessionWatcher>
where
    F: FnMut() + Send + 'static,
{
    let claude = root.to_path_buf();
    let codex = codex_home.map(Path::to_path_buf);
    let mut targets = vec![claude.clone()];
    if let Some(home) = &codex {
        targets.push(home.clone());
    }
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        if events.iter().any(|e| {
            e.paths.iter().any(|p| {
                let directory_change = matches!(
                    e.kind,
                    notify::EventKind::Create(_)
                        | notify::EventKind::Remove(_)
                        | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
                );
                is_relevant(&claude, p)
                    || (directory_change
                        && (claude.starts_with(p)
                            || (p
                                .strip_prefix(&claude)
                                .is_ok_and(|r| r.components().count() == 1)
                                && p.extension().is_none())))
                    || codex.as_ref().is_some_and(|home| {
                        (directory_change && home.starts_with(p))
                            || p == &home.join("session_index.jsonl")
                            || p.starts_with(home.join("sessions"))
                    })
            })
        }) {
            on_change();
        }
    })?;
    let mut watched = std::collections::HashSet::new();
    for target in targets {
        // Never fall back to an ancestor. A missing ~/.codex or ~/.claude/projects
        // would otherwise turn this into a recursive watch of the whole user profile.
        if let Some(root) =
            watchable_root(&target).filter(|root| watched.insert(root.to_path_buf()))
        {
            // One inaccessible provider must not disable the other watcher.
            if let Err(e) = debouncer.watch(root, RecursiveMode::Recursive) {
                eprintln!("could not watch {}: {e}", root.display());
            }
        }
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
    fn missing_roots_do_not_expand_the_watch_to_their_existing_ancestor() {
        let d = tempfile::tempdir().unwrap();
        let claude = d.path().join("claude/projects");
        let codex = d.path().join("codex");
        assert_eq!(watchable_root(&claude), None);
        assert_eq!(watchable_root(&codex), None);
        let _watcher = watch_roots(&claude, Some(&codex), || {}).unwrap();
        std::fs::create_dir_all(codex.join("sessions/2026/09")).unwrap();
        std::fs::write(codex.join("sessions/2026/09/new.jsonl"), "{}\n").unwrap();
        assert_eq!(watchable_root(d.path()), Some(d.path()));
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
