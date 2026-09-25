use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentProvider {
    #[default]
    Claude,
    Codex,
}

impl AgentProvider {
    pub fn key(self, id: &str) -> String {
        format!(
            "{}:{id}",
            match self {
                Self::Claude => "claude",
                Self::Codex => "codex",
            }
        )
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Codex => "Codex",
        }
    }
}

pub fn quote(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', "''"))
}

fn argument(arg: &str) -> String {
    if !arg.is_empty()
        && arg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-./\\:".contains(&b))
    {
        arg.to_owned()
    } else {
        quote(arg)
    }
}

/// One PowerShell builder for launches, restoration, and copied resume commands.
pub fn command(
    settings: &crate::settings::Settings,
    provider: AgentProvider,
    session: Option<&str>,
) -> String {
    build(
        settings,
        provider,
        session,
        crate::pty::procs::job_blocks_breakaway(),
    )
}

/// `no_daemon`: run Codex standalone rather than have it fail to start its background
/// server inside a Job Object that forbids breakaway (#118).
fn build(
    settings: &crate::settings::Settings,
    provider: AgentProvider,
    session: Option<&str>,
    no_daemon: bool,
) -> String {
    let (exe, args) = match provider {
        AgentProvider::Claude => (&settings.claude.command, &settings.claude.resume_args),
        AgentProvider::Codex => (&settings.codex.command, &settings.codex.resume_args),
    };
    let executable = if matches!(exe.as_str(), "claude" | "codex") {
        exe.clone()
    } else {
        format!("& {}", quote(exe))
    };
    let mut parts = vec![executable];
    if provider == AgentProvider::Codex && no_daemon {
        parts.push("--no-daemon".into());
    }
    if let Some(id) = session {
        parts.extend(args.iter().map(|a| argument(&a.replace("{session}", id))));
    }
    let command = parts.join(" ");
    if provider == AgentProvider::Codex
        && settings
            .codex
            .home_dir
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
    {
        format!(
            "$env:CODEX_HOME = {}; {command}",
            quote(&settings.codex_home().to_string_lossy())
        )
    } else {
        command
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_quote_paths_ids_and_home_as_literal_powershell_arguments() {
        let mut s = crate::settings::Settings::default();
        s.codex.command = "C:\\O'Brien\\codex.exe".into();
        s.codex.home_dir = Some("D:\\Codex home\\$literal".into());
        assert_eq!(build(&s, AgentProvider::Codex, Some("id';$(bad)"), false), "$env:CODEX_HOME = 'D:\\Codex home\\$literal'; & 'C:\\O''Brien\\codex.exe' resume 'id'';$(bad)'");
        assert_eq!(
            build(&s, AgentProvider::Claude, Some("abc"), false),
            "claude --resume abc"
        );
        assert_eq!(build(&s, AgentProvider::Claude, None, false), "claude");
    }

    #[test]
    fn codex_runs_standalone_when_the_host_job_forbids_breakaway() {
        let s = crate::settings::Settings::default();
        assert_eq!(
            build(&s, AgentProvider::Codex, Some("abc"), true),
            "codex --no-daemon resume abc"
        );
        assert_eq!(build(&s, AgentProvider::Claude, None, true), "claude");
    }

    #[test]
    fn simple_arguments_stay_readable_and_expressions_stay_literal() {
        assert_eq!(
            build(
                &crate::settings::Settings::default(),
                AgentProvider::Codex,
                None,
                false
            ),
            "codex"
        );
        assert_eq!(argument("0199-abc"), "0199-abc");
        for value in [
            "",
            "two words",
            "$(whoami)",
            "a;b",
            "a`nb",
            "a'b",
            "@foo",
            "#comment",
        ] {
            assert_eq!(argument(value), quote(value));
        }
    }
}
