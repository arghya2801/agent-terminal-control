//! Incremental Codex usage. Cumulative snapshots and response records share a watermark.
use super::{codex, cost::CostRow};
use crate::agent::AgentProvider;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Standard, short-context USD/1M rates checked 2026-09-20:
/// https://developers.openai.com/api/docs/pricing
/// Older models: /api/docs/models/gpt-5.5, gpt-5.4, gpt-5.3-codex.
/// Baseline API equivalents, not subscription charges. No tier, regional, or
/// long-context adjustments: older cumulative records do not preserve these.
fn estimate(row: &CostRow) -> Option<f64> {
    let model = row.model.to_ascii_lowercase();
    let rates = [
        ("gpt-6-astra", (10.0, 1.0, Some(12.5), 50.0)),
        ("gpt-5.6-sol", (4.0, 0.4, Some(5.0), 20.0)),
        ("gpt-5.6-terra", (2.0, 0.2, Some(2.5), 12.0)),
        ("gpt-5.6-luna", (0.2, 0.02, Some(0.25), 1.2)),
        ("gpt-5.5", (5.0, 0.5, None, 30.0)),
        ("gpt-5.4", (2.5, 0.25, None, 15.0)),
        ("gpt-5.3-codex", (1.75, 0.175, None, 14.0)),
    ];
    let (_, (input, cached, write, output)) = rates.iter().find(|(name, _)| {
        model == *name
            || model
                .strip_prefix(&format!("{name}-"))
                .is_some_and(|suffix| chrono::NaiveDate::parse_from_str(suffix, "%Y-%m-%d").is_ok())
    })?;
    let write_cost = if row.cache_write == 0 {
        0.0
    } else {
        row.cache_write as f64 * (*write)?
    };
    // Input/cache buckets are disjoint; reasoning is already included in output.
    Some(
        (row.input as f64 * input
            + row.cache_read as f64 * cached
            + write_cost
            + row.output as f64 * output)
            / 1_000_000.0,
    )
}

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
        // Once a thread records response IDs, those records are authoritative.
        // token_count snapshots can lag, reset on compaction, or arrive before their
        // matching response; reconciling both as one counter inflates usage.
        let mut structured_since: HashMap<&str, i64> = HashMap::new();
        for (_, record) in &records {
            if record.response.is_some() && record.usage.is_some() {
                structured_since
                    .entry(&record.thread)
                    .or_insert(record.timestamp);
            }
        }
        let mut structured_started = HashSet::new();
        let mut watermarks: HashMap<&str, Tokens> = HashMap::new();
        let mut snapshots = HashSet::new();
        for (f, record) in records {
            if record.response.is_none()
                && structured_since
                    .get(record.thread.as_str())
                    .is_some_and(|start| record.timestamp >= *start)
            {
                continue;
            }

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
            let usage = if let Some(usage) = record.usage {
                let first = structured_started.insert(record.thread.as_str());
                // An older snapshot may already include the first response from a CLI
                // upgrade. Reconcile that boundary once, never subsequent snapshots.
                let count = if first && previous.total > 0 {
                    record
                        .total
                        .map(|total| {
                            if total.total >= previous.total {
                                let delta = total.subtract(*previous);
                                if delta.total < usage.total {
                                    delta
                                } else {
                                    usage
                                }
                            } else {
                                usage
                            }
                        })
                        .unwrap_or(usage)
                } else {
                    usage
                };
                *previous = record.total.unwrap_or_else(|| previous.add(usage));
                count
            } else if let Some(total) = record.total {
                // Legacy-only streams have no response identities. A decrease starts
                // another cumulative epoch; repeated snapshots still produce zero.
                let delta = if total.total < previous.total {
                    total
                } else {
                    total.subtract(*previous)
                };
                *previous = total;
                delta
            } else {
                continue;
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
        for row in &mut out {
            row.cost_usd = estimate(row);
            row.unpriced = row.cost_usd.is_none();
        }
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
    #[test]
    fn estimates_cached_input_writes_and_output_without_double_counting_reasoning() {
        let mut row = CostRow {
            model: "gpt-6-astra".into(),
            input: 100_000,
            cache_read: 800_000,
            cache_write: 100_000,
            output: 20_000,
            reasoning: 10_000,
            ..Default::default()
        };
        assert!((estimate(&row).unwrap() - 4.05).abs() < 1e-10);
        row.model = "gpt-6-astra-2026-09-01".into();
        assert!((estimate(&row).unwrap() - 4.05).abs() < 1e-10);
        for model in [
            "codex-auto-review",
            "gpt-6-astra-pro",
            "gpt-5.4-mini",
            "gpt-6-astra-invalid",
        ] {
            row.model = model.into();
            assert_eq!(estimate(&row), None);
        }
    }

    #[test]
    fn prices_deduplicated_rows_and_preserves_unknown_models() {
        let d = tempfile::tempdir().unwrap();
        write(
            &d.path().join("sessions/a.jsonl"),
            &[
                meta("root"),
                event("turn_context", json!({"model":"gpt-6-astra"})),
                structured("r1", 100, 20, tokens(100, 20)),
                snapshot(100, 20),
            ],
        );
        let rows = CodexCostIndex::default().rows(d.path());
        assert!((rows[0].cost_usd.unwrap() - 0.00155).abs() < 1e-10);
        assert!(!rows[0].unpriced);
    }
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
        assert_eq!(row.total_tokens, 180);
        assert_eq!(row.input, 75);
        assert_eq!(row.cache_read, 75);
        assert_eq!(row.output, 30);
        assert_eq!(row.reasoning, 15);
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
        assert_eq!(index.rows(d.path())[0].total_tokens, 180);
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

    #[test]
    fn lagging_snapshots_never_recount_structured_thread_totals() {
        let d = tempfile::tempdir().unwrap();
        let mut events = vec![
            meta("root"),
            event("turn_context", json!({"model":"gpt-6-astra"})),
        ];
        for n in 1..=100 {
            events.push(snapshot((n - 1) * 100, (n - 1) * 20));
            events.push(structured(
                &format!("r{n}"),
                100,
                20,
                tokens(n * 100, n * 20),
            ));
            events.push(snapshot((n - 1) * 100, (n - 1) * 20));
        }
        write(&d.path().join("sessions/root.jsonl"), &events);
        let index = CodexCostIndex::default();
        let rows = index.rows(d.path());
        assert_eq!(rows[0].total_tokens, 12_000);
        assert!((rows[0].cost_usd.unwrap() - 0.155).abs() < 1e-10);
        assert_eq!(index.rows(d.path()), rows);
    }

    #[test]
    fn legacy_only_snapshots_still_support_counter_resets() {
        let d = tempfile::tempdir().unwrap();
        write(
            &d.path().join("sessions/root.jsonl"),
            &[
                meta("root"),
                snapshot(100, 20),
                snapshot(100, 20),
                snapshot(150, 30),
                snapshot(20, 4),
                snapshot(20, 4),
                snapshot(30, 6),
            ],
        );
        assert_eq!(
            CodexCostIndex::default().rows(d.path())[0].total_tokens,
            216
        );
    }

    #[test]
    #[ignore = "read-only audit requires ATC_AUDIT_CODEX_HOME"]
    fn audit_local_usage_totals() {
        let home = std::env::var("ATC_AUDIT_CODEX_HOME").unwrap();
        let rows = CodexCostIndex::default().rows(Path::new(&home));
        let tokens: u64 = rows.iter().map(|r| r.total_tokens).sum();
        let cost: f64 = rows.iter().filter_map(|r| r.cost_usd).sum();
        println!(
            "Deduplicated local Codex usage: {tokens} tokens, ${cost:.2} baseline API estimate"
        );
    }
}
