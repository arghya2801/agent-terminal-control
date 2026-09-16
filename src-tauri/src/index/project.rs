//! Grouping sessions into projects: those found under `~/.claude/projects`, plus
//! whatever the user pinned in settings.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;

use super::session::SessionMeta;
use crate::paths;
use crate::settings::Settings;

/// Sessions whose transcript never revealed a `cwd` are grouped here rather than being
/// dropped or given an invented path.
pub const UNKNOWN_KEY: &str = "\u{0}unknown";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub key: String,
    /// `None` for the Unknown group, which has no usable path.
    pub path: Option<PathBuf>,
    pub name: String,
    pub pinned: bool,
    pub exists: bool,
    pub last_active_ms: u64,
    pub sessions: Vec<SessionMeta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSnapshot {
    pub projects: Vec<Project>,
    pub session_count: usize,
}

/// Build the sidebar's view from parsed sessions plus settings.
pub fn build(sessions: Vec<SessionMeta>, settings: &Settings) -> IndexSnapshot {
    let session_count = sessions.len();
    let mut by_key: BTreeMap<String, Project> = BTreeMap::new();

    for s in sessions {
        let (key, path, name, exists) = match &s.cwd {
            Some(cwd) => {
                let r = paths::resolve(cwd);
                let name = r
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| r.path.to_string_lossy().into_owned());
                (r.key, Some(r.path), name, r.exists)
            }
            None => (UNKNOWN_KEY.to_string(), None, "Unknown".to_string(), false),
        };

        let entry = by_key.entry(key.clone()).or_insert_with(|| Project {
            key,
            path,
            name,
            pinned: false,
            exists,
            last_active_ms: 0,
            sessions: Vec::new(),
        });
        entry.last_active_ms = entry.last_active_ms.max(s.mtime_ms);
        entry.sessions.push(s);
    }

    // Newest session first within a project.
    for p in by_key.values_mut() {
        p.sessions.sort_by_key(|s| std::cmp::Reverse(s.mtime_ms));
    }

    // Pinned entries are inserted if absent, and always override name and ordering --
    // pinning is an explicit statement about how the user wants it to appear.
    let mut order_of: BTreeMap<String, i32> = BTreeMap::new();
    for pin in &settings.projects.pinned {
        if pin.path.trim().is_empty() {
            continue;
        }
        let r = paths::resolve(&pin.path);
        let fallback_name = r
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| pin.path.clone());

        let entry = by_key.entry(r.key.clone()).or_insert_with(|| Project {
            key: r.key.clone(),
            path: Some(r.path.clone()),
            name: fallback_name.clone(),
            pinned: false,
            exists: r.exists,
            last_active_ms: 0,
            sessions: Vec::new(),
        });
        entry.pinned = true;
        if let Some(display) = pin
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
        {
            entry.name = display.to_string();
        }
        order_of.insert(r.key, pin.order);
    }

    // Renames are keyed by path as the user saw it; resolve so any spelling matches.
    for (path, name) in &settings.projects.names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        if let Some(p) = by_key.get_mut(&paths::resolve(path).key) {
            p.name = name.to_string();
        }
    }
    for p in by_key.values_mut() {
        for s in &mut p.sessions {
            if let Some(name) = settings
                .projects
                .session_names
                .get(&s.id)
                .map(|n| n.trim())
                .filter(|n| !n.is_empty())
            {
                s.label = name.to_string();
                s.label_source = super::session::LabelSource::Custom;
            }
        }
    }

    let mut projects: Vec<Project> = by_key.into_values().collect();

    projects.sort_by(|a, b| {
        // Pinned block first, in the user's declared order.
        match (a.pinned, b.pinned) {
            (true, false) => return std::cmp::Ordering::Less,
            (false, true) => return std::cmp::Ordering::Greater,
            (true, true) => {
                let ao = order_of.get(&a.key).copied().unwrap_or(i32::MAX);
                let bo = order_of.get(&b.key).copied().unwrap_or(i32::MAX);
                if ao != bo {
                    return ao.cmp(&bo);
                }
            }
            (false, false) => {}
        }
        // Unknown sinks to the bottom; otherwise most recently active first.
        let a_unknown = a.key == UNKNOWN_KEY;
        let b_unknown = b.key == UNKNOWN_KEY;
        match (a_unknown, b_unknown) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => b
                .last_active_ms
                .cmp(&a.last_active_ms)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        }
    });

    IndexSnapshot {
        projects,
        session_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::session::LabelSource;
    use crate::settings::PinnedProject;

    fn sess(id: &str, cwd: Option<&str>, mtime: u64) -> SessionMeta {
        SessionMeta {
            id: id.into(),
            file: PathBuf::from(format!("{id}.jsonl")),
            cwd: cwd.map(PathBuf::from),
            git_branch: None,
            label: id.into(),
            label_source: LabelSource::Uuid,
            mtime_ms: mtime,
            size: 1,
        }
    }

    #[test]
    fn sessions_group_by_project() {
        let snap = build(
            vec![
                sess("a", Some(r"D:\Coding\portfolio2"), 10),
                sess("b", Some(r"D:\Coding\portfolio2"), 20),
                sess("c", Some(r"D:\Coding\game_tracker_app"), 5),
            ],
            &Settings::default(),
        );
        assert_eq!(snap.projects.len(), 2);
        assert_eq!(snap.session_count, 3);
    }

    #[test]
    fn different_spellings_of_one_path_do_not_split_a_project() {
        // The same directory arrives from JSONL and from settings spelled differently.
        let snap = build(
            vec![
                sess("a", Some(r"D:\Coding\portfolio2"), 10),
                sess("b", Some(r"d:/coding/portfolio2/"), 20),
            ],
            &Settings::default(),
        );
        assert_eq!(snap.projects.len(), 1, "{:?}", snap.projects);
        assert_eq!(snap.projects[0].sessions.len(), 2);
    }

    #[test]
    fn newest_session_first_within_a_project() {
        let snap = build(
            vec![
                sess("old", Some(r"D:\Coding\p"), 10),
                sess("new", Some(r"D:\Coding\p"), 99),
            ],
            &Settings::default(),
        );
        let ids: Vec<&str> = snap.projects[0]
            .sessions
            .iter()
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(ids, vec!["new", "old"]);
        assert_eq!(snap.projects[0].last_active_ms, 99);
    }

    #[test]
    fn projects_sort_by_most_recent_activity() {
        let snap = build(
            vec![
                sess("a", Some(r"D:\Coding\stale"), 10),
                sess("b", Some(r"D:\Coding\fresh"), 900),
            ],
            &Settings::default(),
        );
        assert_eq!(snap.projects[0].name, "fresh");
    }

    #[test]
    fn sessions_without_a_cwd_land_in_unknown_and_are_not_launchable() {
        let snap = build(vec![sess("x", None, 5)], &Settings::default());
        assert_eq!(snap.projects.len(), 1);
        let p = &snap.projects[0];
        assert_eq!(p.key, UNKNOWN_KEY);
        assert_eq!(p.path, None);
        assert!(p.path.is_none(), "a reconstructed path must never be used");
    }

    #[test]
    fn unknown_sorts_last_even_when_most_recent() {
        let snap = build(
            vec![sess("x", None, 9999), sess("a", Some(r"D:\Coding\p"), 1)],
            &Settings::default(),
        );
        assert_eq!(snap.projects.last().unwrap().key, UNKNOWN_KEY);
    }

    #[test]
    fn a_pinned_project_leads_and_can_be_renamed() {
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\portfolio2".into(),
            display_name: Some("Portfolio".into()),
            order: 0,
        });
        let snap = build(
            vec![
                sess("a", Some(r"D:\Coding\portfolio2"), 1),
                sess("b", Some(r"D:\Coding\busy"), 9999),
            ],
            &s,
        );
        assert_eq!(snap.projects[0].name, "Portfolio");
        assert!(snap.projects[0].pinned);
        assert_eq!(
            snap.projects[0].sessions.len(),
            1,
            "pinning must not drop sessions"
        );
    }

    #[test]
    fn pinned_order_is_respected() {
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\second".into(),
            display_name: None,
            order: 1,
        });
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\first".into(),
            display_name: None,
            order: 0,
        });
        let snap = build(Vec::new(), &s);
        let names: Vec<&str> = snap.projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["first", "second"]);
    }

    #[test]
    fn a_pinned_project_with_no_sessions_still_appears() {
        // Everything else is listed only if it has sessions; pinning is the opt-in.
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\empty_but_pinned".into(),
            display_name: None,
            order: 0,
        });
        let snap = build(Vec::new(), &s);
        assert_eq!(snap.projects.len(), 1);
        assert!(snap.projects[0].sessions.is_empty());
    }

    #[test]
    fn projects_without_sessions_are_not_invented() {
        assert!(build(Vec::new(), &Settings::default()).projects.is_empty());
    }

    #[test]
    fn a_deleted_project_directory_is_flagged_not_launchable() {
        let snap = build(
            vec![sess("a", Some(r"D:\Coding\deleted_project_xyz"), 1)],
            &Settings::default(),
        );
        assert!(!snap.projects[0].exists);
        assert!(!snap.projects[0].exists);
        // It still appears, so old sessions remain reachable in the UI.
        assert_eq!(snap.projects[0].sessions.len(), 1);
    }

    #[test]
    fn a_rename_beats_the_directory_and_pinned_names() {
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\portfolio2".into(),
            display_name: Some("Pinned".into()),
            order: 0,
        });
        s.projects
            .names
            .insert(r"d:/coding/portfolio2/".into(), "My Site".into());
        let snap = build(vec![sess("a", Some(r"D:\Coding\portfolio2"), 1)], &s);
        assert_eq!(snap.projects[0].name, "My Site");
    }

    #[test]
    fn a_blank_rename_falls_back() {
        let mut s = Settings::default();
        s.projects
            .names
            .insert(r"D:\Coding\portfolio2".into(), "  ".into());
        let snap = build(vec![sess("a", Some(r"D:\Coding\portfolio2"), 1)], &s);
        assert_eq!(snap.projects[0].name, "portfolio2");
    }

    #[test]
    fn a_session_rename_replaces_the_label() {
        let mut s = Settings::default();
        s.projects
            .session_names
            .insert("a".into(), "auth refactor".into());
        let snap = build(
            vec![
                sess("a", Some(r"D:\Coding\p"), 1),
                sess("b", Some(r"D:\Coding\p"), 2),
            ],
            &s,
        );
        let a = snap.projects[0]
            .sessions
            .iter()
            .find(|x| x.id == "a")
            .unwrap();
        assert_eq!(a.label, "auth refactor");
        assert_eq!(a.label_source, LabelSource::Custom);
        let b = snap.projects[0]
            .sessions
            .iter()
            .find(|x| x.id == "b")
            .unwrap();
        assert_eq!(b.label, "b");
    }

    #[test]
    fn a_blank_pinned_path_is_ignored() {
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: "   ".into(),
            display_name: None,
            order: 0,
        });
        assert!(build(Vec::new(), &s).projects.is_empty());
    }
}
