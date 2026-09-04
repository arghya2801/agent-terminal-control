//! Settings shape.
//!
//! Every field carries `#[serde(default)]` so a hand-edited partial file still loads.
//! Unknown fields are ignored rather than rejected, so a file written by a newer build
//! does not brick an older one.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub projects: ProjectSettings,
    pub ui: UiSettings,
    pub claude: ClaudeSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            projects: ProjectSettings::default(),
            ui: UiSettings::default(),
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
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PinnedProject {
    pub path: String,
    /// Overrides the directory name in the sidebar when set.
    pub display_name: Option<String>,
    pub order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiSettings {
    pub sidebar_width: u32,
    pub sidebar_open: bool,
    pub sessions_per_project: usize,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            sidebar_width: 260,
            sidebar_open: true,
            sessions_per_project: 15,
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
            path: r"D:\Coding\ccpg".into(),
            display_name: Some("ccpg".into()),
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
    fn camel_case_is_the_wire_format() {
        // The frontend reads this file too; snake_case would silently not bind.
        let text = serde_json::to_string(&Settings::default()).unwrap();
        assert!(text.contains("sessionsPerProject"), "{text}");
        assert!(text.contains("claudeProjectsDir"), "{text}");
        assert!(!text.contains("sessions_per_project"));
    }
}
