//! Reading session metadata out of Claude Code's JSONL transcripts.
//!
//! Mostly the head is read: transcripts reach several megabytes, and nearly everything
//! the sidebar needs sits near the top. The exception is the session's current name,
//! which Claude Code rewrites as it goes, so that is read from the last few KB.
//!
//! The directory name is never decoded. `~/.claude/projects/<mangled>` collapses
//! separators and underscores alike -- `D:\Coding\game_tracker_app` becomes
//! `D--Coding-game-tracker-app` -- so the `cwd` field inside the file is authoritative.

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Runs of `file-history-snapshot` push the first human message deep — as far as line 11
/// in real data — so a small line budget silently loses labels.
const MAX_LINES: usize = 300;
const MAX_BYTES: u64 = 512 * 1024;
/// How much of the end of a transcript is searched for the latest `agent-name`. Claude
/// Code rewrites that record every turn, so the current one sits within a few tens of KB
/// of the end in real data.
const TAIL_BYTES: u64 = 64 * 1024;
/// Shorter than this and a first message is not a useful label. One real session's first
/// message is literally ".".
const MIN_LABEL_LEN: usize = 3;
const MAX_LABEL_LEN: usize = 72;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelSource {
    /// Renamed by the user in ATC.
    Custom,
    /// The name Claude Code gives the session, and shows in its terminal title.
    AgentName,
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

#[derive(Debug, Default, Clone)]
struct Head {
    cwd: Option<PathBuf>,
    git_branch: Option<String>,
    slug: Option<String>,
    agent_name: Option<String>,
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
    let mut head = parse_head(path).unwrap_or_default();
    // The head only holds the first name, often not even that: the name changes as the
    // session goes on, and the current one is near the end.
    if let Some(name) = tail_agent_name(path) {
        head.agent_name = Some(name);
    }
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
            Some("agent-name") => {
                if head.agent_name.is_none() {
                    head.agent_name = non_empty(v.get("agentName").and_then(Value::as_str));
                }
            }
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

        // Stop only once the *best* label is in hand. Real transcripts put `ai-title`
        // below the first user turn, so bailing out as soon as any first message
        // exists skips the good label entirely -- and when that first message is the
        // useless "." there is nothing left but the uuid. Without an `ai-title` the
        // read simply runs to the budget, which is bounded and cheap.
        if head.cwd.is_some() && head.ai_title.is_some() {
            break;
        }
    }
    Some(head)
}

/// The last `agent-name` in the final `TAIL_BYTES` of a transcript, if any.
fn tail_agent_name(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.take(TAIL_BYTES).read_to_end(&mut buf).ok()?;
    // Starting mid-file lands inside a line; drop that fragment.
    let text = String::from_utf8_lossy(&buf);
    let text = if start > 0 {
        text.split_once('\n').map_or("", |(_, rest)| rest)
    } else {
        &text
    };
    // Newest first, so only the last name is parsed.
    text.lines()
        .rev()
        .filter(|l| l.contains("\"agent-name\""))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v.get("type").and_then(Value::as_str) == Some("agent-name"))
        .find_map(|v| non_empty(v.get("agentName").and_then(Value::as_str)))
}

/// The current agent name as a finished label, for a cached entry whose file grew.
pub fn current_agent_label(path: &Path) -> Option<String> {
    tail_agent_name(path)
        .map(|n| tidy(&n))
        .filter(|s| usable(s))
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

/// `agentName` is what Claude Code calls the session now; `aiTitle` is a summary of the
/// first prompt; `slug` is partly random and only present in newer transcripts; the first
/// message is a decent fallback; the uuid is the floor.
fn pick_label(head: &Head, id: &str) -> (String, LabelSource) {
    if let Some(n) = head.agent_name.as_deref().map(tidy).filter(|s| usable(s)) {
        return (n, LabelSource::AgentName);
    }
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
        assert!(s.cwd.is_some());
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
    fn a_late_ai_title_still_wins_over_an_earlier_message() {
        // Real transcripts put `ai-title` below the first user turn. Stopping as soon
        // as a cwd and any first message are in hand skips it, and a "." first message
        // then leaves nothing but the uuid.
        let s = read(
            fixtures().join("D--Coding-portfolio2"),
            "1a1a1a1a-8888-4888-8888-1a1a1a1a1a1a",
        );
        assert_eq!(s.label, "Run Astro portfolio with pnpm");
        assert_eq!(s.label_source, LabelSource::AiTitle);
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
        assert!(s.cwd.is_none());
        assert_eq!(s.label_source, LabelSource::Uuid);
    }

    #[test]
    fn the_byte_budget_actually_bounds_the_read() {
        // Asserted by content rather than wall-clock time, which failed under load: a
        // cwd placed past MAX_BYTES must never be seen. Few, long lines so the line
        // budget is not what stops the read.
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let big = format!(
            "{{\"type\":\"progress\",\"data\":\"{}\"}}\n",
            "x".repeat(4096)
        );
        let lines = (MAX_BYTES as usize / big.len()) + 2;
        assert!(
            lines < MAX_LINES,
            "the byte budget must be the limit under test"
        );
        let body = format!(
            "{}{}\n",
            big.repeat(lines),
            r#"{"type":"user","cwd":"D:/beyond/the/budget","message":{"content":"late"}}"#
        );
        std::fs::write(&p, body).unwrap();

        let s = read_session(&p).unwrap();
        assert_eq!(s.cwd, None, "a line past MAX_BYTES was parsed");
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

    fn agent_name(name: &str) -> String {
        format!(r#"{{"type":"agent-name","agentName":"{name}","sessionId":"x"}}"#)
    }

    /// About 1KB of a record the parser ignores, newline included.
    fn filler_line() -> String {
        format!(
            "{{\"type\":\"progress\",\"data\":\"{}\"}}\n",
            "x".repeat(1000)
        )
    }

    #[test]
    fn the_latest_agent_name_wins_even_far_past_the_head_budget() {
        // Real shape: an ai-title early, a first name past the 512KB head, then a rename
        // near the end. The sidebar must show what Claude calls the session now.
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let filler = filler_line();
        let body = [
            r#"{"type":"user","cwd":"D:/p","message":{"content":"hi there"}}"#.to_string(),
            r#"{"type":"ai-title","aiTitle":"Summary of the first prompt"}"#.to_string(),
            filler.repeat(600),
            agent_name("first-name"),
            filler.repeat(10),
            agent_name("renamed-later"),
            filler.repeat(5),
        ]
        .join("\n");
        std::fs::write(&p, body).unwrap();

        let s = read_session(&p).unwrap();
        assert_eq!(s.label, "renamed-later");
        assert_eq!(s.label_source, LabelSource::AgentName);
        assert_eq!(current_agent_label(&p).as_deref(), Some("renamed-later"));
    }

    #[test]
    fn an_agent_name_in_the_head_is_used_when_the_tail_has_none() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let body = format!(
            "{}\n{}",
            agent_name("early-name"),
            filler_line().repeat(100)
        );
        std::fs::write(&p, body).unwrap();

        let s = read_session(&p).unwrap();
        assert_eq!(s.label, "early-name");
        assert_eq!(current_agent_label(&p), None, "tail holds no name");
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
