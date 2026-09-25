//! Tasks live in `tasks.json` beside `settings.json`, not in it (#99). They are written
//! often (typing notes, ticking branches), and settings writes are the rare, expensive
//! path: sharing a file made the Settings page's draft overwrite tasks (#86).

use std::path::{Path, PathBuf};

use super::{Settings, Task};

pub fn tasks_path() -> PathBuf {
    super::config_dir().join("tasks.json")
}

/// `Ok(empty)` when there is no file yet. `Err` when it exists but does not parse; the
/// file is left alone.
pub fn load_from(path: &Path) -> Result<Vec<Task>, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Startup load. A file that does not parse is copied to `tasks.json.bad` before ATC runs
/// on an empty list, because the next task edit rewrites `tasks.json`.
pub fn load_or_back_up(path: &Path) -> Vec<Task> {
    load_from(path).unwrap_or_else(|e| {
        let backup = path.with_extension("json.bad");
        eprintln!(
            "tasks.json could not be parsed ({e}); copied to {}",
            backup.display()
        );
        let _ = std::fs::copy(path, backup);
        Vec::new()
    })
}

/// Move tasks that an older build kept in `settings.json` into `tasks.json`, once.
/// Returns true when `settings` changed and should be saved; tasks are then gone from it,
/// since `Settings::tasks` is never written back.
pub fn migrate(settings: &mut Settings, path: &Path) -> bool {
    if settings.tasks.is_empty() || path.exists() {
        return false;
    }
    if let Err(e) = super::save_to(path, &settings.tasks) {
        // Keep them in settings.json for the next attempt.
        eprintln!("could not move tasks to {}: {e}", path.display());
        return false;
    }
    settings.tasks.clear();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: u32) -> Task {
        Task {
            id,
            title: format!("t{id}"),
            ..Task::default()
        }
    }

    #[test]
    fn a_missing_file_is_an_empty_list() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(load_from(&d.path().join("tasks.json")), Ok(Vec::new()));
    }

    #[test]
    fn round_trips() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("tasks.json");
        super::super::save_to(&p, &[task(1), task(2)]).unwrap();
        assert_eq!(load_from(&p).unwrap(), vec![task(1), task(2)]);
    }

    #[test]
    fn a_bad_file_is_backed_up_and_left_alone() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("tasks.json");
        std::fs::write(&p, "[{ oops").unwrap();
        assert!(load_or_back_up(&p).is_empty());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "[{ oops");
        assert_eq!(
            std::fs::read_to_string(p.with_extension("json.bad")).unwrap(),
            "[{ oops"
        );
    }

    #[test]
    fn migration_moves_tasks_out_of_settings_once() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("tasks.json");
        let mut s: Settings =
            serde_json::from_str(r#"{"tasks":[{"id":1,"title":"t1"}],"ui":{"zoom":1.5}}"#).unwrap();

        assert!(migrate(&mut s, &p));
        assert!(s.tasks.is_empty());
        assert_eq!(load_from(&p).unwrap(), vec![task(1)]);
        let text = serde_json::to_string(&s).unwrap();
        assert!(
            !text.contains("tasks"),
            "settings.json stops carrying tasks"
        );

        // An existing tasks.json always wins over leftovers in settings.json.
        s.tasks.push(task(9));
        assert!(!migrate(&mut s, &p));
        assert_eq!(load_from(&p).unwrap(), vec![task(1)]);
    }
}
