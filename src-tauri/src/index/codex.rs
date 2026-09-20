//! Local Codex rollouts. Keep the byte offset before incomplete records for the next scan.
use super::session::{LabelSource, SessionMeta};
use crate::agent::AgentProvider;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub fn home(override_dir: Option<&str>) -> PathBuf {
    override_dir
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("CODEX_HOME")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os("USERPROFILE")
                    .or_else(|| std::env::var_os("HOME"))
                    .unwrap_or_default(),
            )
            .join(".codex")
        })
}

pub fn files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            out.extend(files(&path));
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
    out.sort();
    out
}

pub fn timestamp_ms(v: &Value) -> Option<u64> {
    let date = chrono::DateTime::parse_from_rfc3339(v.as_str()?).ok()?;
    u64::try_from(date.timestamp_millis()).ok()
}

/// Shared complete-record reader for metadata, name index, and usage.
pub fn read_from(path: &Path, offset: u64, mut consume: impl FnMut(Value)) -> u64 {
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
                if let Ok(v) = serde_json::from_slice(&buf) {
                    consume(v);
                }
            }
            _ => return pos,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Reader {
    pub offset: u64,
    pub meta: Option<SessionMeta>,
    pub child: bool,
    pub archived: bool,
}

impl Reader {
    pub fn update(&mut self, path: &Path) {
        self.offset = read_from(path, self.offset, |v| self.absorb(path, &v));
        if let (Some(s), Ok(m)) = (&mut self.meta, std::fs::metadata(path)) {
            s.size = m.len();
            s.mtime_ms = super::session::mtime_ms(&m);
        }
    }

    fn absorb(&mut self, path: &Path, v: &Value) {
        let kind = v["type"].as_str().unwrap_or("");
        let p = v.get("payload").unwrap_or(v);
        // Early rollouts stored metadata directly, before the session_meta envelope.
        if kind == "session_meta"
            || (self.meta.is_none()
                && p["id"].is_string()
                && p.get("timestamp").is_some()
                && p.get("role").is_none())
        {
            let Some(id) = p["id"].as_str().filter(|s| !s.is_empty()) else {
                return;
            };
            let source = &p["source"];
            self.child = source.get("subagent").is_some()
                || source.as_str().is_some_and(|s| s.starts_with("subagent"))
                || p["parent_thread_id"].is_string();
            self.archived = p["archived"].as_bool() == Some(true);
            self.meta = Some(SessionMeta {
                provider: AgentProvider::Codex,
                id: id.into(),
                file: path.into(),
                cwd: p["cwd"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .map(PathBuf::from),
                git_branch: p["git"]["branch"]
                    .as_str()
                    .or_else(|| p["git_branch"].as_str())
                    .map(str::to_string),
                label: id.into(),
                label_source: LabelSource::Uuid,
                created_at_ms: timestamp_ms(&p["timestamp"])
                    .or_else(|| timestamp_ms(&v["timestamp"])),
                activity: None,
                activity_sequence: 0,
                mtime_ms: 0,
                size: 0,
            });
            return;
        }
        let Some(s) = &mut self.meta else { return };
        if kind == "event_msg" {
            let activity = match p["type"].as_str() {
                Some("task_started" | "turn_started") => Some("working"),
                Some("task_complete" | "turn_complete" | "turn_completed") => Some("idle"),
                Some("turn_aborted" | "task_interrupted" | "turn_interrupted") => {
                    Some("interrupted")
                }
                _ => None,
            };
            if let Some(activity) = activity {
                s.activity = Some(activity.into());
                s.activity_sequence += 1;
            }
        }
        if s.label_source == LabelSource::Uuid {
            let message = if kind == "event_msg" && p["type"] == "user_message" {
                p["message"].as_str().map(str::to_string)
            } else if (kind == "response_item" || kind == "message") && p["role"] == "user" {
                p["content"].as_str().map(str::to_string).or_else(|| {
                    p["content"].as_array().map(|a| {
                        a.iter()
                            .filter_map(|c| c["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                })
            } else {
                None
            };
            if let Some(label) = message.as_deref().and_then(message_label) {
                s.label = label;
                s.label_source = LabelSource::FirstMessage;
            }
        }
    }

    pub fn session(&self) -> Option<SessionMeta> {
        if self.child || self.archived {
            None
        } else {
            self.meta.clone()
        }
    }
}

fn message_label(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty()
        || [
            "# AGENTS.md instructions",
            "<environment_context>",
            "<permissions instructions>",
            "<instructions>",
            "<system-reminder>",
            "<developer_instructions>",
        ]
        .iter()
        .any(|prefix| text.starts_with(prefix))
    {
        return None;
    }
    Some(
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(72)
            .collect(),
    )
}

pub fn names(path: &Path) -> HashMap<String, String> {
    let mut names = HashMap::new();
    read_from(path, 0, |v| {
        if let (Some(id), Some(name)) = (
            v["id"].as_str(),
            v["thread_name"].as_str().or_else(|| v["name"].as_str()),
        ) {
            if !name.trim().is_empty() {
                names.insert(id.into(), name.trim().into());
            }
        }
    });
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/codex")
    }

    #[test]
    fn discovers_cli_editor_desktop_and_old_metadata_without_children() {
        let sessions: Vec<_> = files(&fixtures().join("sessions"))
            .iter()
            .filter_map(|p| {
                let mut reader = Reader::default();
                reader.update(p);
                reader.session()
            })
            .collect();
        assert_eq!(sessions.len(), 5);
        assert!(sessions.iter().any(|s| s.id == "legacy-id"));
        assert!(sessions
            .iter()
            .any(|s| s.id == "missing" && s.cwd.is_none()));
        let current = sessions.iter().find(|s| s.id.starts_with("aaaa")).unwrap();
        assert_eq!(current.label, "Build the Codex sidebar");
        assert_eq!(current.activity.as_deref(), Some("working"));
        assert_eq!(current.created_at_ms, Some(1758362400000 + 365 * 86400000));
        assert_eq!(
            names(&fixtures().join("session_index.jsonl"))[&current.id],
            "Renamed Codex session"
        );
    }

    #[test]
    fn incremental_cache_preserves_native_id_and_retries_partial_records() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("rollout-not-the-id.jsonl");
        std::fs::copy(
            fixtures().join("sessions/2026/09/20/rollout-current.jsonl"),
            &path,
        )
        .unwrap();
        let mut cache = super::super::cache::SessionCache::default();
        let first = cache.codex(&path).unwrap();
        assert!(first.id.starts_with("aaaa"));
        use std::io::Write;
        writeln!(
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap(),
            "{{\"type\":\"task_complete\"}}}}"
        )
        .unwrap();
        let second = cache.codex(&path).unwrap();
        assert_eq!(second.activity.as_deref(), Some("idle"));
        assert_eq!(second.activity_sequence, 2);
        let disk = d.path().join("cache.json");
        cache.save_to(&disk).unwrap();
        let mut reloaded = super::super::cache::SessionCache::load_from(&disk);
        assert_eq!(reloaded.codex(&path).unwrap(), second);
        assert_eq!(reloaded.hits, 1);
    }

    #[test]
    fn mixed_index_separates_identical_ids_and_applies_provider_renames() {
        let d = tempfile::tempdir().unwrap();
        let mut settings = crate::settings::Settings::default();
        settings.codex.home_dir = Some(fixtures().to_string_lossy().into_owned());
        settings.projects.claude_projects_dir = Some(
            fixtures()
                .join("../claude-projects")
                .to_string_lossy()
                .into_owned(),
        );
        let id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
        settings
            .projects
            .session_names
            .insert(id.into(), "Legacy Claude name".into());
        let index = super::super::Index::new(d.path().join("cache.json"));
        let snap = index.scan(&settings, false);
        let sessions: Vec<_> = snap
            .projects
            .iter()
            .flat_map(|p| &p.sessions)
            .filter(|s| s.id == id)
            .collect();
        assert_eq!(sessions.len(), 2);
        assert!(sessions
            .iter()
            .any(|s| s.provider == AgentProvider::Claude && s.label == "Legacy Claude name"));
        assert!(sessions
            .iter()
            .any(|s| s.provider == AgentProvider::Codex && s.label == "Renamed Codex session"));
        assert_eq!(index.scan(&settings, true), snap);
    }
}
