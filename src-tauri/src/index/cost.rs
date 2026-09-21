//! What Claude Code usage would cost at API list prices, read from the transcripts.
//!
//! Every assistant line carries `message.usage`. Streaming writes the same message more
//! than once, so lines are deduplicated on `message.id` + `requestId`. Subagent
//! transcripts (`<uuid>/subagents/*.jsonl`) are included: those tokens are billed too.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// One deduplicated API response.
#[derive(Debug, Clone)]
struct Usage {
    id: String,
    /// Session uuid from the transcript; the file stem when a line omits it.
    session: String,
    /// UTC hour, `YYYY-MM-DDTHH`. The frontend buckets it into local days.
    hour: String,
    cwd: Option<String>,
    model: String,
    input: u64,
    output: u64,
    cache_write_5m: u64,
    cache_write_1h: u64,
    cache_read: u64,
    fast: bool,
}

/// Tokens and cost for one (hour, project, model).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostRow {
    pub provider: crate::agent::AgentProvider,
    pub total_tokens: u64,
    pub reasoning: u64,
    pub hour: String,
    /// Session uuid, so spend can be broken down within a project.
    pub session_id: String,
    /// Canonical project key; empty when the transcript recorded no cwd.
    pub project_key: String,
    pub project_path: Option<PathBuf>,
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub cost_usd: Option<f64>,
    /// Some or all of this row has no known price, so the estimate is partial.
    pub unpriced: bool,
}

/// USD per million tokens: (input, output). Cache writes are 1.25x input (5 minute) or
/// 2x (1 hour); cache reads are 0.1x input.
fn price(model: &str) -> Option<(f64, f64)> {
    let m = model.to_ascii_lowercase();
    // Most specific first: "claude-opus-4-1" must not match the "opus-4" family below it.
    let table: &[(&str, (f64, f64))] = &[
        ("fable", (10.0, 50.0)),
        ("mythos", (10.0, 50.0)),
        ("opus-5", (5.0, 25.0)),
        ("opus-4-8", (5.0, 25.0)),
        ("opus-4-7", (5.0, 25.0)),
        ("opus-4-6", (5.0, 25.0)),
        ("opus-4-5", (5.0, 25.0)),
        ("opus-4", (15.0, 75.0)),
        ("sonnet-5", (2.0, 10.0)),
        ("sonnet-4", (3.0, 15.0)),
        ("sonnet-3", (3.0, 15.0)),
        ("haiku-4-5", (1.0, 5.0)),
        ("haiku-3-5", (0.8, 4.0)),
        ("haiku-3", (0.25, 1.25)),
    ];
    table.iter().find(|(k, _)| m.contains(k)).map(|(_, p)| *p)
}

fn cost_of(u: &Usage) -> Option<f64> {
    let (input, output) = price(&u.model)?;
    let per_m = |tokens: u64, rate: f64| tokens as f64 * rate / 1_000_000.0;
    let base = per_m(u.input, input)
        + per_m(u.output, output)
        + per_m(u.cache_write_5m, input * 1.25)
        + per_m(u.cache_write_1h, input * 2.0)
        + per_m(u.cache_read, input * 0.1);
    // ponytail: fast mode is a flat 2x of Opus rates; revisit if other models get it.
    Some(if u.fast { base * 2.0 } else { base })
}

fn parse_line(line: &str, session: &str) -> Option<Usage> {
    // Cheap reject before a full JSON parse; most lines carry no usage.
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let model = msg.get("model").and_then(Value::as_str).unwrap_or("");
    // Local error messages Claude Code writes itself; nothing was billed.
    if model == "<synthetic>" {
        return None;
    }
    let n = |o: &Value, k: &str| o.get(k).and_then(Value::as_u64).unwrap_or(0);
    let cache_write = n(usage, "cache_creation_input_tokens");
    let (w5, w1h) = match usage.get("cache_creation") {
        Some(c) => (
            n(c, "ephemeral_5m_input_tokens"),
            n(c, "ephemeral_1h_input_tokens"),
        ),
        None => (cache_write, 0),
    };
    let id = format!(
        "{}:{}",
        msg.get("id").and_then(Value::as_str).unwrap_or(""),
        v.get("requestId").and_then(Value::as_str).unwrap_or("")
    );
    let hour = v
        .get("timestamp")
        .and_then(Value::as_str)?
        .get(..13)?
        .to_string();
    Some(Usage {
        id,
        session: v
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or(session)
            .to_string(),
        hour,
        cwd: v.get("cwd").and_then(Value::as_str).map(str::to_string),
        model: model.to_string(),
        input: n(usage, "input_tokens"),
        output: n(usage, "output_tokens"),
        cache_write_5m: w5,
        cache_write_1h: w1h,
        cache_read: n(usage, "cache_read_input_tokens"),
        fast: usage.get("speed").and_then(Value::as_str) == Some("fast"),
    })
}

/// Parse complete lines from byte `offset` on, appending to `out`. Returns the offset
/// just past the last complete line: a line still being written is left for next time.
fn parse_from(path: &Path, offset: u64, out: &mut Vec<Usage>) -> u64 {
    // Subagent transcripts live at <session uuid>/subagents/<agent>.jsonl, so their own
    // stem is not the session; the fallback only matters for lines with no sessionId.
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Ok(mut file) = std::fs::File::open(path) else {
        return offset;
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return offset;
    }
    let mut reader = BufReader::new(file);
    let mut pos = offset;
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(n) if n > 0 && buf.ends_with(b"\n") => {
                pos += n as u64;
                if let Some(u) = parse_line(&String::from_utf8_lossy(&buf), &stem) {
                    out.push(u);
                }
            }
            // A final line with no newline is either mid-write or left by a killed
            // process. Count it if it parses, but read it again next time; the
            // duplicate is removed in `aggregate` like any repeated response.
            Ok(n) if n > 0 => {
                if let Some(u) = parse_line(&String::from_utf8_lossy(&buf), &stem) {
                    out.push(u);
                }
                return pos;
            }
            _ => return pos,
        }
    }
}

/// Every `*.jsonl` under `root`, at any depth, so subagent transcripts count.
fn all_transcripts(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.filter_map(Result::ok) {
        let p = e.path();
        if p.is_dir() {
            all_transcripts(&p, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

type Stamp = (u64, Option<std::time::SystemTime>);

/// Parsed usage for one transcript, and how far into it parsing got.
struct Parsed {
    stamp: Stamp,
    offset: u64,
    usages: Vec<Usage>,
}

/// Parsed usage per file. Transcripts are append-only, so a file that grew is parsed
/// only from where the last scan stopped; a shrink or same-size rewrite reads it again.
#[derive(Default)]
pub struct CostIndex {
    files: Mutex<HashMap<PathBuf, Parsed>>,
}

impl CostIndex {
    pub fn rows(&self, root: &Path) -> Vec<CostRow> {
        let mut paths = Vec::new();
        all_transcripts(root, &mut paths);

        let mut files = self.files.lock().expect("cost cache");
        let live: HashSet<&PathBuf> = paths.iter().collect();
        files.retain(|p, _| live.contains(p));
        for p in &paths {
            let Ok(meta) = std::fs::metadata(p) else {
                continue;
            };
            let stamp = (meta.len(), meta.modified().ok());
            match files.get_mut(p) {
                Some(f) if f.stamp == stamp => {}
                Some(f) if stamp.0 > f.stamp.0 => {
                    f.offset = parse_from(p, f.offset, &mut f.usages);
                    f.stamp = stamp;
                }
                _ => {
                    let mut usages = Vec::new();
                    let offset = parse_from(p, 0, &mut usages);
                    files.insert(
                        p.clone(),
                        Parsed {
                            stamp,
                            offset,
                            usages,
                        },
                    );
                }
            }
        }

        // Duplicates across resumed reads are removed here, same as within one file.
        aggregate(files.values().flat_map(|f| f.usages.iter()))
    }
}

fn aggregate<'a>(usages: impl Iterator<Item = &'a Usage>) -> Vec<CostRow> {
    let mut seen = HashSet::new();
    let mut resolved: HashMap<String, (String, PathBuf)> = HashMap::new();
    let mut rows: HashMap<(String, String, String, String), CostRow> = HashMap::new();

    for u in usages {
        if !seen.insert(u.id.as_str()) {
            continue;
        }
        let (key, path) = match &u.cwd {
            Some(cwd) => {
                let (k, p) = resolved.entry(cwd.clone()).or_insert_with(|| {
                    let r = crate::paths::resolve(cwd);
                    (r.key, r.path)
                });
                (k.clone(), Some(p.clone()))
            }
            None => (String::new(), None),
        };
        let row = rows
            .entry((
                u.hour.clone(),
                key.clone(),
                u.model.clone(),
                u.session.clone(),
            ))
            .or_insert_with(|| CostRow {
                cost_usd: Some(0.0),
                hour: u.hour.clone(),
                session_id: u.session.clone(),
                project_key: key,
                project_path: path,
                model: u.model.clone(),
                ..Default::default()
            });
        row.total_tokens += u.input + u.output + u.cache_write_5m + u.cache_write_1h + u.cache_read;
        row.input += u.input;
        row.output += u.output;
        row.cache_write += u.cache_write_5m + u.cache_write_1h;
        row.cache_read += u.cache_read;
        match cost_of(u) {
            Some(c) => *row.cost_usd.get_or_insert(0.0) += c,
            None => row.unpriced = true,
        }
    }

    let mut out: Vec<CostRow> = rows.into_values().collect();
    for row in &mut out {
        if row.unpriced {
            row.cost_usd = None;
        }
    }
    // Model breaks ties: rows come out of a HashMap, so without it two models in one
    // hour and project swap places between calls.
    out.sort_by(|a, b| {
        a.hour
            .cmp(&b.hour)
            .then(a.project_key.cmp(&b.project_key))
            .then(a.model.cmp(&b.model))
            .then(a.session_id.cmp(&b.session_id))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, req: &str, model: &str, cwd: &str, extra: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-09-11T17:51:00.554Z","cwd":"{cwd}","requestId":"{req}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":1000000,"output_tokens":1000000,"cache_read_input_tokens":1000000,"cache_creation_input_tokens":2000000,"cache_creation":{{"ephemeral_5m_input_tokens":1000000,"ephemeral_1h_input_tokens":1000000}}{extra}}}}}}}"#
        )
    }

    #[test]
    fn prices_every_token_kind() {
        let u = parse_line(&line("m", "r", "claude-opus-5", "D:/x", ""), "s").unwrap();
        // 5 input + 25 output + 6.25 5m write + 10 1h write + 0.5 read
        assert!((cost_of(&u).unwrap() - 46.75).abs() < 1e-9);
        assert_eq!(u.hour, "2026-09-11T17");
    }

    #[test]
    fn fast_mode_doubles() {
        let u = parse_line(
            &line("m", "r", "claude-opus-5", "D:/x", r#","speed":"fast""#),
            "s",
        )
        .unwrap();
        assert!((cost_of(&u).unwrap() - 93.5).abs() < 1e-9);
    }

    #[test]
    fn older_opus_is_not_priced_as_opus_4_5() {
        assert_eq!(price("claude-opus-4-1-20250805"), Some((15.0, 75.0)));
        assert_eq!(price("claude-opus-4-5-20251101"), Some((5.0, 25.0)));
        assert_eq!(price("claude-sonnet-4-6"), Some((3.0, 15.0)));
        assert_eq!(price("claude-sonnet-5"), Some((2.0, 10.0)));
        assert_eq!(price("gpt-whatever"), None);
    }

    #[test]
    fn repeated_streaming_lines_count_once_and_synthetic_is_skipped() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        let sub = root.join("proj").join("uuid").join("subagents");
        std::fs::create_dir_all(&sub).unwrap();
        let a = line("m1", "r1", "claude-opus-5", "D:/x", "");
        let synthetic = line("m9", "r9", "<synthetic>", "D:/x", "");
        std::fs::write(
            root.join("proj").join("s.jsonl"),
            format!("{a}\n{a}\n{synthetic}\nnot json\n"),
        )
        .unwrap();
        std::fs::write(
            sub.join("agent.jsonl"),
            line("m2", "r2", "claude-haiku-4-5", "D:/x", ""),
        )
        .unwrap();

        let idx = CostIndex::default();
        let rows = idx.rows(root);
        assert_eq!(rows.len(), 2, "{rows:?}");
        let opus = rows.iter().find(|r| r.model == "claude-opus-5").unwrap();
        assert_eq!(opus.input, 1_000_000, "duplicate line counted twice");
        assert!(
            rows.iter().any(|r| r.model == "claude-haiku-4-5"),
            "subagent missed"
        );

        // A second call with nothing changed returns the same result from the cache.
        assert_eq!(idx.rows(root), rows);
    }

    fn total_input(rows: &[CostRow]) -> u64 {
        rows.iter().map(|r| r.input).sum()
    }

    #[test]
    fn a_grown_transcript_is_parsed_only_from_where_the_last_scan_stopped() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let first = line("m1", "r1", "claude-opus-5", "D:/x", "");
        std::fs::write(&p, format!("{first}\n")).unwrap();

        let idx = CostIndex::default();
        assert_eq!(total_input(&idx.rows(d.path())), 1_000_000);

        // Blank out the first line in place while appending a second. A resumed read
        // never looks at the start again, so m1 still counts; a full re-read would drop
        // it.
        let second = line("m2", "r2", "claude-opus-5", "D:/x", "");
        std::fs::write(&p, format!("{}\n{second}\n", " ".repeat(first.len()))).unwrap();
        assert_eq!(total_input(&idx.rows(d.path())), 2_000_000);
    }

    #[test]
    fn a_line_still_being_written_is_counted_once_when_it_completes() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let a = line("m1", "r1", "claude-opus-5", "D:/x", "");
        let b = line("m2", "r2", "claude-opus-5", "D:/x", "");
        let (b_head, b_tail) = b.split_at(b.len() / 2);

        std::fs::write(&p, format!("{a}\n{b_head}")).unwrap();
        let idx = CostIndex::default();
        assert_eq!(total_input(&idx.rows(d.path())), 1_000_000);

        std::fs::write(&p, format!("{a}\n{b_head}{b_tail}")).unwrap();
        assert_eq!(
            total_input(&idx.rows(d.path())),
            2_000_000,
            "a complete final line without a newline still counts"
        );

        std::fs::write(&p, format!("{a}\n{b}\n")).unwrap();
        assert_eq!(total_input(&idx.rows(d.path())), 2_000_000, "counted twice");
    }

    #[test]
    fn a_shrunken_transcript_is_read_again_from_the_start() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let a = line("m1", "r1", "claude-opus-5", "D:/x", "");
        let b = line("m2", "r2", "claude-opus-5", "D:/x", "");
        std::fs::write(&p, format!("{a}\n{b}\n")).unwrap();
        let idx = CostIndex::default();
        assert_eq!(total_input(&idx.rows(d.path())), 2_000_000);

        std::fs::write(&p, format!("{b}\n")).unwrap();
        assert_eq!(total_input(&idx.rows(d.path())), 1_000_000);
    }

    #[test]
    fn rows_carry_the_session_and_split_by_it() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("proj");
        std::fs::create_dir_all(&proj).unwrap();
        // No sessionId on the line: the file stem stands in.
        std::fs::write(
            proj.join("aaa.jsonl"),
            format!(
                "{}
",
                line("m1", "r1", "claude-opus-5", "D:/x", "")
            ),
        )
        .unwrap();
        // An explicit sessionId wins over the stem.
        let with_id = line("m2", "r2", "claude-opus-5", "D:/x", "").replace(
            r#""type":"assistant""#,
            r#""type":"assistant","sessionId":"real-uuid""#,
        );
        std::fs::write(
            proj.join("bbb.jsonl"),
            format!(
                "{with_id}
"
            ),
        )
        .unwrap();

        let rows = CostIndex::default().rows(d.path());
        let mut ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["aaa", "real-uuid"], "{rows:?}");
        assert_eq!(rows.len(), 2, "same hour and model must not merge sessions");
    }

    #[test]
    fn unknown_models_are_flagged_not_priced() {
        let u = parse_line(&line("m", "r", "mystery", "D:/x", ""), "s").unwrap();
        let rows = aggregate([u].iter());
        assert!(rows[0].unpriced);
        assert_eq!(rows[0].cost_usd, None);
    }
}
