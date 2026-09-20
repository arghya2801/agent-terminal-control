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
}
