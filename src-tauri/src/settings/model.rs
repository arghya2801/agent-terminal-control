//! Settings shape.
//!
//! Every field carries `#[serde(default)]` so a hand-edited partial file still loads.
//! Unknown fields are ignored rather than rejected, so a file written by a newer build
//! does not brick an older one.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub projects: ProjectSettings,
    pub ui: UiSettings,
    pub terminal: TerminalSettings,
    pub claude: ClaudeSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            projects: ProjectSettings::default(),
            ui: UiSettings::default(),
            terminal: TerminalSettings::default(),
            claude: ClaudeSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProjectSettings {
    /// `None` means `%USERPROFILE%\.claude\projects`. The playground repoints this at
    /// the fixture corpus so real data is never touched.
    pub claude_projects_dir: Option<String>,
    pub pinned: Vec<PinnedProject>,
    /// Sidebar names chosen by the user, by project path. Wins over a pinned
    /// `display_name` and the directory name.
    pub names: BTreeMap<String, String>,
    /// Sidebar labels chosen by the user, by session uuid.
    pub session_names: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PinnedProject {
    pub path: String,
    /// Overrides the directory name in the sidebar when set.
    pub display_name: Option<String>,
    pub order: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiSettings {
    pub sidebar_width: u32,
    pub sidebar_open: bool,
    pub sessions_per_project: usize,
    /// Whole-application zoom. Stored as a plain factor; the frontend snaps it to its
    /// own ladder, so a hand-edited value in between still behaves.
    pub zoom: f64,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            sidebar_width: 260,
            sidebar_open: true,
            sessions_per_project: 15,
            zoom: 1.0,
        }
    }
}

/// Terminal appearance. Defaults mirror the constants in `src/terminal/theme.ts`, which
/// remains the frontend's fallback when settings cannot be read at all.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub scrollback: u32,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "\"FiraCode Nerd Font Mono\", \"Cascadia Mono\", Consolas, monospace"
                .into(),
            font_size: 13,
            scrollback: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClaudeSettings {
    pub command: String,
    /// `{session}` is replaced with the session uuid.
    pub resume_args: Vec<String>,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            command: "claude".into(),
            resume_args: vec!["--resume".into(), "{session}".into()],
        }
    }
}

impl ClaudeSettings {
    /// The command line typed into the shell to resume `session_id`.
    pub fn resume_command(&self, session_id: &str) -> String {
        let mut parts = vec![self.command.clone()];
        parts.extend(
            self.resume_args
                .iter()
                .map(|a| a.replace("{session}", session_id)),
        );
        parts.join(" ")
    }
}

impl Settings {
    pub fn claude_projects_dir(&self) -> PathBuf {
        crate::paths::claude_projects_dir(self.projects.claude_projects_dir.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_object_yields_all_defaults() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, Settings::default());
        assert_eq!(s.ui.sessions_per_project, 15);
    }

    #[test]
    fn a_partial_file_keeps_defaults_for_everything_else() {
        // Hand-editing one field must not blank out the rest.
        let s: Settings = serde_json::from_str(r#"{"ui":{"sidebarOpen":false}}"#).unwrap();
        assert!(!s.ui.sidebar_open);
        assert_eq!(s.ui.sidebar_width, 260);
        assert_eq!(s.claude.command, "claude");
    }

    #[test]
    fn unknown_fields_are_ignored() {
        // A file written by a newer build must still load in an older one.
        let s: Settings =
            serde_json::from_str(r#"{"somethingNew":42,"ui":{"whatever":true}}"#).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn round_trips_through_json() {
        let mut s = Settings::default();
        s.projects.pinned.push(PinnedProject {
            path: r"D:\Coding\atc".into(),
            display_name: Some("atc".into()),
            order: 0,
        });
        let text = serde_json::to_string(&s).unwrap();
        assert_eq!(serde_json::from_str::<Settings>(&text).unwrap(), s);
    }

    #[test]
    fn resume_command_substitutes_the_session_id() {
        let c = ClaudeSettings::default();
        assert_eq!(
            c.resume_command("abc-123"),
            "claude --resume abc-123",
            "this string is typed straight into the shell"
        );
    }

    #[test]
    fn resume_command_honours_a_customised_invocation() {
        let c = ClaudeSettings {
            command: "claude".into(),
            resume_args: vec![
                "--resume".into(),
                "{session}".into(),
                "--fork-session".into(),
            ],
        };
        assert_eq!(
            c.resume_command("xyz"),
            "claude --resume xyz --fork-session"
        );
    }

    #[test]
    fn new_fields_default_and_survive_a_partial_file() {
        let s: Settings = serde_json::from_str(r#"{"terminal":{"fontSize":16}}"#).unwrap();
        assert_eq!(s.terminal.font_size, 16);
        // Editing one terminal field must not blank the rest of the section.
        assert_eq!(s.terminal.scrollback, 10_000);
        assert!(s.terminal.font_family.contains("FiraCode"));
        assert_eq!(s.ui.zoom, 1.0);
    }

    #[test]
    fn zoom_round_trips_as_a_number() {
        let s: Settings = serde_json::from_str(r#"{"ui":{"zoom":1.25}}"#).unwrap();
        assert_eq!(s.ui.zoom, 1.25);
        let text = serde_json::to_string(&s).unwrap();
        assert!(text.contains("\"zoom\":1.25"), "{text}");
    }

    #[test]
    fn camel_case_is_the_wire_format() {
        // The frontend reads this file too; snake_case would silently not bind.
        let text = serde_json::to_string(&Settings::default()).unwrap();
        assert!(text.contains("sessionsPerProject"), "{text}");
        assert!(text.contains("claudeProjectsDir"), "{text}");
        assert!(!text.contains("sessions_per_project"));
    }
}
