//! Incremental Codex usage. Cumulative snapshots and response records share a watermark.
use super::{codex, cost::CostRow};
use crate::agent::AgentProvider;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Tokens {
    input: u64,
    output: u64,
    cached: u64,
    write: u64,
    reasoning: u64,
    total: u64,
}
impl Tokens {
    fn read(v: &Value) -> Self {
        let n = |k| v[k].as_u64().unwrap_or(0);
        let input = n("input_tokens");
        let output = n("output_tokens");
        Self {
            input,
            output,
            cached: n("cached_input_tokens").min(input),
            write: n("cache_write_input_tokens").min(input),
            reasoning: n("reasoning_output_tokens").min(output),
            total: v["total_tokens"].as_u64().unwrap_or(input + output),
        }
    }
    fn subtract(self, other: Self) -> Self {
        Self {
            input: self.input.saturating_sub(other.input),
            output: self.output.saturating_sub(other.output),
            cached: self.cached.saturating_sub(other.cached),
            write: self.write.saturating_sub(other.write),
            reasoning: self.reasoning.saturating_sub(other.reasoning),
            total: self.total.saturating_sub(other.total),
        }
    }
    fn add(self, other: Self) -> Self {
        Self {
            input: self.input + other.input,
            output: self.output + other.output,
            cached: self.cached + other.cached,
            write: self.write + other.write,
            reasoning: self.reasoning + other.reasoning,
            total: self.total + other.total,
        }
    }
}

#[derive(Default)]
struct Parsed {
    stamp: (u64, u64),
    offset: u64,
    id: String,
    parent: Option<String>,
    cwd: Option<String>,
    model: String,
    // Keep only usage records, not conversation content. Replaying these also deduplicates
    // responses copied into parent or forked rollouts without rereading whole transcripts.
    records: Vec<Record>,
}
struct Record {
    timestamp: i64,
    thread: String,
    response: Option<String>,
    total: Option<Tokens>,
    usage: Option<Tokens>,
    hour: String,
    model: String,
}

impl Parsed {
    fn absorb(&mut self, v: Value) {
        let kind = v["type"].as_str().unwrap_or("");
        let p = v.get("payload").unwrap_or(&v);
        if kind == "session_meta"
            || (self.id.is_empty() && p["id"].is_string() && p["timestamp"].is_string())
        {
            self.id = p["id"].as_str().unwrap_or("").into();
            self.cwd = p["cwd"].as_str().map(str::to_string);
            self.parent = p["parent_thread_id"]
                .as_str()
                .or_else(|| p["source"]["subagent"]["thread_spawn"]["parent_thread_id"].as_str())
                .or_else(|| p["session_id"].as_str().filter(|id| *id != self.id))
                .map(str::to_string);
        }
        if kind == "turn_context" {
            if let Some(m) = p["model"].as_str() {
                self.model = m.into();
            }
        }
        let usage_kind = if kind == "event_msg" {
            p["type"].as_str().unwrap_or("")
        } else {
            kind
        };
        let (total, usage, response) = match usage_kind {
            "token_usage" | "token_usage_record" => (
                p.get("thread_token_usage")
                    .filter(|v| v.is_object())
                    .map(Tokens::read),
                p.get("usage").filter(|v| v.is_object()).map(Tokens::read),
                p["response_id"].as_str().map(str::to_string),
            ),
            "token_count" => (
                p["info"]
                    .get("total_token_usage")
                    .filter(|v| v.is_object())
                    .map(Tokens::read),
                None,
                None,
            ),
            _ => return,
        };
        if total.is_none() && usage.is_none() {
            return;
        }
        let Some(timestamp) = v["timestamp"]
            .as_str()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        else {
            return;
        };
        self.records.push(Record {
            timestamp: timestamp.timestamp_millis(),
            thread: p["thread_id"].as_str().unwrap_or(&self.id).into(),
            response,
            total,
            usage,
            hour: timestamp
                .with_timezone(&chrono::Utc)
                .format("%Y-%m-%dT%H")
                .to_string(),
            model: p["model"]
                .as_str()
                .unwrap_or(if self.model.is_empty() {
                    "unknown"
                } else {
                    &self.model
                })
                .into(),
        });
    }
}

#[derive(Default)]
pub struct CodexCostIndex {
    files: Mutex<HashMap<PathBuf, Parsed>>,
}
impl CodexCostIndex {
    pub fn rows(&self, home: &Path) -> Vec<CostRow> {
        let mut paths = codex::files(&home.join("sessions"));
        paths.extend(codex::files(&home.join("archived_sessions")));
        let mut files = self.files.lock().expect("codex costs");
        files.retain(|p, _| paths.contains(p));
        for path in &paths {
            let Ok(meta) = std::fs::metadata(path) else {
                continue;
            };
            let stamp = (meta.len(), super::session::mtime_ms(&meta));
            let f = files.entry(path.clone()).or_default();
            if f.stamp == stamp {
                continue;
            }
            if stamp.0 <= f.stamp.0 {
                *f = Parsed::default();
            }
            f.offset = codex::read_from(path, f.offset, |v| f.absorb(v));
            f.stamp = stamp;
        }
        let parents: HashMap<_, _> = files
            .values()
            .filter_map(|f| f.parent.as_ref().map(|p| (f.id.as_str(), p.as_str())))
            .collect();
        let mut seen = HashSet::new();
        let mut rows: HashMap<(String, String, String), CostRow> = HashMap::new();
        let mut records: Vec<_> = paths
            .iter()
            .filter_map(|p| files.get(p))
            .flat_map(|f| f.records.iter().map(move |r| (f, r)))
            .collect();
        records.sort_by_key(|(_, r)| r.timestamp);
        let mut watermarks: HashMap<&str, Tokens> = HashMap::new();
        let mut snapshots = HashSet::new();
        for (f, record) in records {
            if record.response.is_none() {
                if let Some(total) = record.total {
                    if !snapshots.insert((
                        record.thread.as_str(),
                        record.timestamp,
                        total.input,
                        total.output,
                        total.total,
                    )) {
                        continue;
                    }
                }
            }
            if let Some(id) = &record.response {
                if !seen.insert((record.thread.clone(), id.clone())) {
                    continue;
                }
            }
            let previous = watermarks.entry(&record.thread).or_default();
            let usage = match (record.total, record.usage) {
                (Some(total), usage) => {
                    // A lower cumulative total starts a new accounting epoch after a reset.
                    let delta = if total.total < previous.total {
                        total
                    } else {
                        total.subtract(*previous)
                    };
                    let count = usage
                        .map(|u| {
                            if delta.total == 0 {
                                Tokens::default()
                            } else if delta.total < u.total {
                                delta
                            } else {
                                u
                            }
                        })
                        .unwrap_or(delta);
                    *previous = total;
                    count
                }
                (None, Some(usage)) => {
                    *previous = previous.add(usage);
                    usage
                }
                _ => continue,
            };
            if usage.total == 0 {
                continue;
            }
            let mut owner = record.thread.as_str();
            let mut visited = HashSet::new();
            while visited.insert(owner) {
                let Some(parent) = parents.get(owner) else {
                    break;
                };
                owner = parent;
            }
            let owner_file = files.values().find(|p| p.id == owner).unwrap_or(f);
            let resolved = owner_file.cwd.as_ref().map(crate::paths::resolve);
            let row = rows
                .entry((record.hour.clone(), owner.into(), record.model.clone()))
                .or_insert_with(|| CostRow {
                    provider: AgentProvider::Codex,
                    hour: record.hour.clone(),
                    session_id: owner.into(),
                    project_key: resolved.as_ref().map(|r| r.key.clone()).unwrap_or_default(),
                    project_path: resolved.map(|r| r.path),
                    model: record.model.clone(),
                    cost_usd: None,
                    ..Default::default()
                });
            row.input += usage
                .input
                .saturating_sub(usage.cached)
                .saturating_sub(usage.write);
            row.output += usage.output;
            row.cache_read += usage.cached;
            row.cache_write += usage.write;
            row.reasoning += usage.reasoning;
            row.total_tokens += usage.total;
        }
        let mut out: Vec<_> = rows.into_values().collect();
        out.sort_by(|a, b| {
            (&a.hour, &a.session_id, &a.model).cmp(&(&b.hour, &b.session_id, &b.model))
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    fn tokens(input: u64, output: u64) -> Value {
        json!({"input_tokens":input,"output_tokens":output,"cached_input_tokens":input/2,"reasoning_output_tokens":output/2,"total_tokens":input+output})
    }
    fn event(kind: &str, payload: Value) -> Value {
        json!({"type":kind,"timestamp":"2026-09-20T10:00:00Z","payload":payload})
    }
    fn snapshot(input: u64, output: u64) -> Value {
        event(
            "event_msg",
            json!({"type":"token_count","info":{"total_token_usage":tokens(input,output)}}),
        )
    }
    fn structured(id: &str, input: u64, output: u64, total: Value) -> Value {
        event(
            "token_usage",
            json!({"thread_id":"root","response_id":id,"usage":tokens(input,output),"thread_token_usage":total}),
        )
    }
    fn write(path: &Path, rows: &[Value]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = std::fs::File::create(path).unwrap();
        for row in rows {
            writeln!(file, "{row}").unwrap();
        }
    }
    fn meta(id: &str) -> Value {
        event(
            "session_meta",
            json!({"id":id,"cwd":"D:\\app","timestamp":"2026-09-20T10:00:00Z"}),
        )
    }

    #[test]
    fn mixed_records_deduplicate_responses_and_snapshots_without_counting_subsets_twice() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("sessions/a.jsonl");
        write(
            &path,
            &[
                meta("root"),
                event("turn_context", json!({"model":"test-model"})),
                structured("r1", 100, 20, tokens(100, 20)),
                snapshot(100, 20),
                snapshot(100, 20),
                structured("r1", 100, 20, tokens(100, 20)),
                snapshot(150, 30),
                structured("r2", 50, 10, tokens(150, 30)),
                snapshot(20, 4),
                snapshot(20, 4),
            ],
        );
        let index = CodexCostIndex::default();
        let rows = index.rows(d.path());
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.total_tokens, 204);
        assert_eq!(row.input, 85);
        assert_eq!(row.cache_read, 85);
        assert_eq!(row.output, 34);
        assert_eq!(row.reasoning, 17);
        assert_eq!(row.cost_usd, None);
        assert_eq!(row.model, "test-model");
        assert_eq!(index.rows(d.path()), rows);
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        write!(file, "{{\"type\":").unwrap();
        assert_eq!(index.rows(d.path()), rows);
        writeln!(file,"\"event_msg\",\"timestamp\":\"2026-09-20T10:00:00Z\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{}}}}}}}",tokens(30,6)).unwrap();
        assert_eq!(index.rows(d.path())[0].total_tokens, 216);
        write(&path, &[meta("root"), snapshot(10, 2)]);
        assert_eq!(index.rows(d.path())[0].total_tokens, 12);
    }

    #[test]
    fn child_usage_uses_parent_project_and_keeps_recorded_model() {
        let d = tempfile::tempdir().unwrap();
        write(&d.path().join("sessions/root.jsonl"), &[meta("root")]);
        write(
            &d.path().join("sessions/child.jsonl"),
            &[
                event(
                    "session_meta",
                    json!({"id":"child","parent_thread_id":"root","cwd":"D:\\elsewhere","timestamp":"2026-09-20T10:00:00Z"}),
                ),
                event("turn_context", json!({"model":"child-model"})),
                snapshot(100, 20),
                event("turn_context", json!({"model":"next-model"})),
                snapshot(200, 40),
            ],
        );
        let rows = CodexCostIndex::default().rows(d.path());
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.session_id == "root"
            && r.project_key == "d:\\app"
            && r.total_tokens == 120));
    }
}
