//! Watching `settings.json` so edits apply without a restart. The file is the whole
//! configuration story; there is no settings UI.

use std::path::Path;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

/// Long enough to ride out an editor's write-truncate-write cycle.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

pub type SettingsWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Watch the *directory* containing the settings file, not the file itself.
///
/// Editors routinely save by writing a temporary file and renaming it over the target,
/// which destroys the original inode. A watch on the file would follow the deleted inode
/// and go silent after the first save.
pub fn watch<F>(settings_path: &Path, mut on_change: F) -> notify::Result<SettingsWatcher>
where
    F: FnMut() + Send + 'static,
{
    let dir = settings_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let target = settings_path.to_path_buf();

    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        if events
            .iter()
            .flat_map(|e| e.paths.iter())
            .any(|p| same_file(p, &target))
        {
            on_change();
        }
    })?;

    // The directory may not exist on a first run; creating it means the watch is live
    // before the file is ever written.
    std::fs::create_dir_all(&dir).ok();
    if dir.is_dir() {
        debouncer.watch(&dir, RecursiveMode::NonRecursive)?;
    }
    Ok(debouncer)
}

/// Windows paths are case-insensitive, and the watcher reports whatever casing the
/// filesystem used.
fn same_file(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn wait_for_hit(hits: &Arc<AtomicUsize>, timeout: Duration) -> usize {
        let deadline = std::time::Instant::now() + timeout;
        while hits.load(Ordering::Relaxed) == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        hits.load(Ordering::Relaxed)
    }

    #[test]
    fn writing_the_settings_file_fires_the_callback() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("settings.json");

        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let _w = watch(&path, move || {
            h.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        std::fs::write(&path, r#"{"ui":{"zoom":1.25}}"#).unwrap();

        assert!(
            wait_for_hit(&hits, Duration::from_secs(10)) > 0,
            "never fired"
        );
    }

    #[test]
    fn a_replaced_file_still_fires() {
        // Editors save by writing a temp file and renaming over the target. Watching the
        // file itself would follow the destroyed inode and go silent after one save.
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("settings.json");
        std::fs::write(&path, "{}").unwrap();

        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let _w = watch(&path, move || {
            h.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        let tmp = d.path().join("settings.json.tmp");
        std::fs::write(&tmp, r#"{"ui":{"zoom":2.0}}"#).unwrap();
        std::fs::rename(&tmp, &path).unwrap();

        assert!(
            wait_for_hit(&hits, Duration::from_secs(10)) > 0,
            "never fired"
        );
    }

    #[test]
    fn an_unrelated_file_in_the_same_directory_is_ignored() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("settings.json");

        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let _w = watch(&path, move || {
            h.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();

        std::thread::sleep(DEBOUNCE + Duration::from_millis(900));
        assert_eq!(
            hits.load(Ordering::Relaxed),
            0,
            "should only watch settings.json"
        );
    }

    #[test]
    fn watching_a_missing_directory_is_not_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(watch(&d.path().join("fresh").join("settings.json"), || {}).is_ok());
    }
}
