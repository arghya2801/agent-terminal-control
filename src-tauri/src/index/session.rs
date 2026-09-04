//! Reading session metadata out of Claude Code's JSONL transcripts.
//!
//! Two constraints shape everything here.
//!
//! **Only the head is read.** Transcripts reach several megabytes; the largest in local
//! data is 3.8MB. Everything the sidebar needs sits near the top, so parsing stops after
//! `MAX_LINES` or `MAX_BYTES`, whichever comes first, and exits earlier still once a
//! `cwd` and a label are both in hand.
//!
//! **The directory name is never decoded.** `~/.claude/projects/<mangled>` collapses
//! separators and underscores alike: `D:\Coding\game_tracker_app` becomes
//! `D--Coding-game-tracker-app`, and the underscore is unrecoverable. The authoritative
//! path is the `cwd` field inside the file.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Runs of `file-history-snapshot` push the first human message deep — as far as line 11
/// in real data — so a small line budget silently loses labels.
const MAX_LINES: usize = 300;
const MAX_BYTES: u64 = 512 * 1024;
/// Shorter than this and a first message is not a useful label. One real session's first
/// message is literally ".".
const MIN_LABEL_LEN: usize = 3;
const MAX_LABEL_LEN: usize = 72;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelSource {
    AiTitle,
    Slug,
    FirstMessage,
    Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    /// Session uuid — the file stem, and what `claude --resume` takes.
    pub id: String,
    pub file: PathBuf,
    /// Authoritative working directory, read from the transcript. `None` when the head
    /// budget ran out before one appeared.
    pub cwd: Option<PathBuf>,
    pub git_branch: Option<String>,
    pub label: String,
    pub label_source: LabelSource,
    pub mtime_ms: u64,
    pub size: u64,
}

impl SessionMeta {
    /// False when no `cwd` was found. Such a session must never be used as a shell cwd:
    /// the only other candidate would be a path reconstructed from the lossy directory
    /// name, which would be wrong.
    pub fn has_trusted_path(&self) -> bool {
        self.cwd.is_some()
    }
}

#[derive(Debug, Default, Clone)]
struct Head {
    cwd: Option<PathBuf>,
    git_branch: Option<String>,
    slug: Option<String>,
    ai_title: Option<String>,
    first_message: Option<String>,
}

/// List the session transcripts in one project directory.
///
/// Depth 1 only: `<uuid>/subagents/*.jsonl` holds subagent transcripts, and a recursive
/// walk would report roughly twice as many sessions as exist.
pub fn session_files(project_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(project_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "jsonl"))
        .collect();
    files.sort();
    files
}

/// Parse one transcript's head into sidebar metadata.
pub fn read_session(path: &Path) -> Option<SessionMeta> {
    let meta = std::fs::metadata(path).ok()?;
    let id = path.file_stem()?.to_string_lossy().into_owned();
    let head = parse_head(path).unwrap_or_default();
    let (label, label_source) = pick_label(&head, &id);

    Some(SessionMeta {
        id,
        file: path.to_path_buf(),
        cwd: head.cwd,
        git_branch: head.git_branch,
        label,
        label_source,
        mtime_ms: mtime_ms(&meta),
        size: meta.len(),
    })
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_head(path: &Path) -> Option<Head> {
    let file = File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file.take(MAX_BYTES));
    let mut head = Head::default();

    for (i, line) in reader.lines().enumerate() {
        if i >= MAX_LINES {
            break;
        }
        // A transcript truncated mid-write (killed process) is normal, not an error.
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        match v.get("type").and_then(Value::as_str) {
            Some("ai-title") => {
                if head.ai_title.is_none() {
                    head.ai_title = non_empty(v.get("aiTitle").and_then(Value::as_str));
                }
            }
            Some("user") => {
                absorb_common(&mut head, &v);
                if head.first_message.is_none() && is_human_turn(&v) {
                    head.first_message =
                        extract_text(v.get("message").and_then(|m| m.get("content")));
                }
            }
            _ => absorb_common(&mut head, &v),
        }

        if head.cwd.is_some() && (head.ai_title.is_some() || head.first_message.is_some()) {
            break;
        }
    }
    Some(head)
}

fn absorb_common(head: &mut Head, v: &Value) {
    if head.cwd.is_none() {
        head.cwd = non_empty(v.get("cwd").and_then(Value::as_str)).map(PathBuf::from);
    }
    if head.git_branch.is_none() {
        head.git_branch = non_empty(v.get("gitBranch").and_then(Value::as_str));
    }
    if head.slug.is_none() {
        head.slug = non_empty(v.get("slug").and_then(Value::as_str));
    }
}

fn non_empty(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// A genuine typed turn, as opposed to a slash-command echo or an injected caveat.
///
/// `origin.kind == "human"` is the reliable signal; the string checks are a fallback for
/// transcripts written before that field existed.
fn is_human_turn(v: &Value) -> bool {
    if v.get("isMeta").and_then(Value::as_bool).unwrap_or(false)
        || v.get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return false;
    }
    match v
        .get("origin")
        .and_then(|o| o.get("kind"))
        .and_then(Value::as_str)
    {
        Some(kind) => kind == "human",
        None => {
            let text = extract_text(v.get("message").and_then(|m| m.get("content")));
            !text.is_some_and(|t| looks_generated(&t))
        }
    }
}

fn looks_generated(text: &str) -> bool {
    const MARKERS: [&str; 4] = [
        "<local-command-caveat>",
        "<command-name>",
        "<local-command-stdout>",
        "<system-reminder>",
    ];
    MARKERS.iter().any(|m| text.contains(m))
}

/// `content` is a bare string in some records and an array of typed blocks in others.
fn extract_text(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(s) => non_empty(Some(s)),
        Value::Array(blocks) => {
            let joined: String = blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" ");
            non_empty(Some(&joined))
        }
        _ => None,
    }
}

/// `aiTitle` is readable prose written for the session; `slug` is partly random and only
/// present in newer transcripts; the first message is a decent fallback; the uuid is the
/// floor.
fn pick_label(head: &Head, id: &str) -> (String, LabelSource) {
    if let Some(t) = head.ai_title.as_deref().map(tidy).filter(|s| usable(s)) {
        return (t, LabelSource::AiTitle);
    }
    if let Some(s) = head.slug.as_deref().map(tidy).filter(|s| usable(s)) {
        return (s, LabelSource::Slug);
    }
    if let Some(m) = head
        .first_message
        .as_deref()
        .map(tidy)
        .filter(|s| usable(s))
    {
        return (m, LabelSource::FirstMessage);
    }
    (id.chars().take(8).collect(), LabelSource::Uuid)
}

fn usable(s: &str) -> bool {
    s.chars().count() >= MIN_LABEL_LEN
}

fn tidy(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_LABEL_LEN {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(MAX_LABEL_LEN - 1).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("fixtures")
            .join("claude-projects")
    }

    fn game_tracker() -> PathBuf {
        fixtures().join("D--Coding-game-tracker-app")
    }

    fn read(dir: PathBuf, stem: &str) -> SessionMeta {
        read_session(&dir.join(format!("{stem}.jsonl"))).expect("session parses")
    }

    #[test]
    fn subagent_transcripts_are_not_listed_as_sessions() {
        // A recursive walk would report 4 here. Depth 1 only.
        let files = session_files(&game_tracker());
        assert_eq!(files.len(), 3, "{files:?}");
        assert!(files
            .iter()
            .all(|f| !f.to_string_lossy().contains("subagents")));
    }

    #[test]
    fn a_missing_directory_yields_no_sessions_rather_than_erroring() {
        assert!(session_files(&fixtures().join("does-not-exist")).is_empty());
    }

    #[test]
    fn cwd_comes_from_the_transcript_not_the_directory_name() {
        // The directory is `D--Coding-game-tracker-app`; the real path has an underscore
        // that the directory name cannot represent.
        let s = read(game_tracker(), "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
        assert_eq!(s.cwd, Some(PathBuf::from(r"D:\Coding\game_tracker_app")));
        assert!(s.has_trusted_path());
    }

    #[test]
    fn ai_title_wins_when_present() {
        let s = read(game_tracker(), "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
        assert_eq!(s.label, "Game tracker professional grade");
        assert_eq!(s.label_source, LabelSource::AiTitle);
    }

    #[test]
    fn slug_is_used_when_there_is_no_ai_title() {
        let s = read(game_tracker(), "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb");
        assert_eq!(s.label, "quiet-cuddling-lampson");
        assert_eq!(s.label_source, LabelSource::Slug);
        assert_eq!(s.git_branch.as_deref(), Some("feat/stats"));
    }

    #[test]
    fn the_first_human_message_is_used_when_there_is_neither() {
        // This transcript hides its first human turn behind snapshot runs and two decoy
        // turns, and stores content as a block array rather than a string.
        let s = read(game_tracker(), "cccccccc-3333-4333-8333-cccccccccccc");
        assert_eq!(s.label, "fix the scoreboard sort order please");
        assert_eq!(s.label_source, LabelSource::FirstMessage);
    }

    #[test]
    fn slash_commands_and_caveats_are_not_mistaken_for_the_first_message() {
        let s = read(game_tracker(), "cccccccc-3333-4333-8333-cccccccccccc");
        assert!(!s.label.contains("command-name"), "{}", s.label);
        assert!(!s.label.contains("caveat"), "{}", s.label);
    }

    #[test]
    fn a_trivial_first_message_falls_through_to_the_uuid() {
        // One real session's first message is ".".
        let s = read(
            fixtures().join("D--Coding-portfolio2"),
            "dddddddd-4444-4444-8444-dddddddddddd",
        );
        assert_eq!(s.label_source, LabelSource::Uuid);
        assert_eq!(s.label, "dddddddd");
    }

    #[test]
    fn a_truncated_final_line_does_not_lose_the_rest_of_the_head() {
        let s = read(
            fixtures().join("D--Coding-portfolio2"),
            "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        );
        assert_eq!(s.label, "Portfolio refresh");
        assert_eq!(s.cwd, Some(PathBuf::from(r"D:\Coding\portfolio2")));
    }

    #[test]
    fn a_transcript_with_no_cwd_in_budget_is_marked_untrusted() {
        // 688KB of snapshots and no cwd anywhere. Must not invent a path.
        let s = read(
            fixtures().join("D--Coding-headless"),
            "99999999-7777-4777-8777-999999999999",
        );
        assert_eq!(s.cwd, None);
        assert!(!s.has_trusted_path());
        assert_eq!(s.label_source, LabelSource::Uuid);
    }

    #[test]
    fn the_byte_budget_actually_bounds_the_read() {
        // The headless fixture is larger than MAX_BYTES; parsing must still terminate
        // quickly rather than walking the whole file.
        let p = fixtures()
            .join("D--Coding-headless")
            .join("99999999-7777-4777-8777-999999999999.jsonl");
        assert!(std::fs::metadata(&p).unwrap().len() > MAX_BYTES);
        let start = std::time::Instant::now();
        let s = read_session(&p).unwrap();
        assert!(start.elapsed() < std::time::Duration::from_millis(500));
        assert!(
            s.size > MAX_BYTES,
            "size is reported from metadata, not the read"
        );
    }

    #[test]
    fn a_deleted_cwd_is_still_reported() {
        // Resolving whether it exists is paths.rs's job; the parser just reports it.
        let s = read(
            fixtures().join("D--Coding-deleted-project"),
            "ffffffff-6666-4666-8666-ffffffffffff",
        );
        assert_eq!(s.cwd, Some(PathBuf::from(r"D:\Coding\deleted_project_xyz")));
        assert_eq!(s.label, "Long gone experiment");
    }

    #[test]
    fn mtime_and_size_are_populated_for_cache_keying() {
        let s = read(game_tracker(), "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
        assert!(s.mtime_ms > 0);
        assert!(s.size > 0);
    }

    #[test]
    fn long_labels_are_truncated_and_whitespace_collapsed() {
        let head = Head {
            first_message: Some("a  b\n\tc".into()),
            ..Default::default()
        };
        assert_eq!(pick_label(&head, "id123456").0, "a b c");

        let head = Head {
            first_message: Some("x".repeat(200)),
            ..Default::default()
        };
        let (label, _) = pick_label(&head, "id123456");
        assert!(label.chars().count() <= MAX_LABEL_LEN, "{}", label.len());
        assert!(label.ends_with('…'));
    }
}
