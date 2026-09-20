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
    if let Some(id) = session {
        parts.extend(args.iter().map(|a| argument(&a.replace("{session}", id))));
    }
    let command = parts.join(" ");
    if provider == AgentProvider::Codex
        && (settings
            .codex
            .home_dir
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
            || std::env::var("ATC_DEV").is_ok_and(|v| v == "1"))
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
        assert_eq!(command(&s, AgentProvider::Codex, Some("id';$(bad)")), "$env:CODEX_HOME = 'D:\\Codex home\\$literal'; & 'C:\\O''Brien\\codex.exe' resume 'id'';$(bad)'");
        assert_eq!(
            command(&s, AgentProvider::Claude, Some("abc")),
            "claude --resume abc"
        );
        assert_eq!(command(&s, AgentProvider::Claude, None), "claude");
    }

    #[test]
    fn simple_arguments_stay_readable_and_expressions_stay_literal() {
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
