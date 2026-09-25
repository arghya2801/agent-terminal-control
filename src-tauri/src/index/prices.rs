//! Model prices as data (#102). Defaults ship in `prices.json`; a `pricing.json` in the
//! config directory adds or overrides entries without a release, the way `themes/` does
//! for palettes. Read once per launch. The matching rules stay in code, with the callers.
//!
//! USD per million tokens. Claude rates checked against the Anthropic price list; Codex
//! (OpenAI) standard short-context rates checked 2026-09-23 at
//! https://developers.openai.com/api/docs/pricing. Baseline API equivalents, not
//! subscription charges.

use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Prices {
    /// Matched by substring, first hit wins, so the most specific goes first.
    pub claude: Vec<ClaudePrice>,
    /// Matched by exact name, or name plus a `-YYYY-MM-DD` suffix.
    pub codex: Vec<CodexPrice>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClaudePrice {
    #[serde(rename = "match")]
    pub pattern: String,
    pub input: f64,
    pub output: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPrice {
    pub model: String,
    pub input: f64,
    pub cached: f64,
    /// Not published for some older models.
    pub cache_write: Option<f64>,
    pub output: f64,
}

const DEFAULTS: &str = include_str!("prices.json");

/// Defaults with the user's entries in front, so theirs win on first-match lookup. A
/// user file that does not parse is ignored, never fatal.
fn merged(user: Option<&str>) -> Prices {
    let mut prices: Prices = serde_json::from_str(DEFAULTS).expect("bundled prices.json");
    if let Some(text) = user {
        match serde_json::from_str::<Prices>(text) {
            Ok(mut extra) => {
                extra.claude.append(&mut prices.claude);
                extra.codex.append(&mut prices.codex);
                prices = extra;
            }
            Err(e) => eprintln!("pricing.json ignored: {e}"),
        }
    }
    prices
}

pub fn prices() -> &'static Prices {
    static PRICES: OnceLock<Prices> = OnceLock::new();
    PRICES.get_or_init(|| {
        let user = std::fs::read_to_string(crate::settings::config_dir().join("pricing.json"));
        merged(user.ok().as_deref())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_entries_override_and_extend_the_defaults() {
        let p = merged(Some(
            r#"{"codex":[{"model":"gpt-5.5","input":1,"cached":0.1,"output":2},
                         {"model":"gpt-7","input":3,"cached":0.3,"output":4}]}"#,
        ));
        let first = |m: &str| p.codex.iter().find(|c| c.model == m).unwrap().input;
        assert_eq!(first("gpt-5.5"), 1.0);
        assert_eq!(first("gpt-7"), 3.0);
        assert_eq!(
            p.claude,
            merged(None).claude,
            "untouched section keeps defaults"
        );
    }

    #[test]
    fn a_bad_user_file_keeps_the_defaults() {
        assert_eq!(merged(Some("{ nope")), merged(None));
    }
}
