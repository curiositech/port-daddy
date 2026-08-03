//! Active agents pane - live harness roster over GET /agent-roster.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct ActiveAgentEntry {
    id: String,
    label: String,
    purpose: String,
    liveness: String,
    harness: String,
    backend: String,
    squid_level: String,
    squid_score: i64,
    squid_capabilities: Vec<String>,
    squid_missing: Vec<String>,
    squid_repair: String,
    worktree: String,
    branch: String,
    session_id: String,
    touched: Vec<String>,
    last_heartbeat_ms: i64,
}

fn nested_s(v: &Value, object_key: &str, field_key: &str) -> String {
    v.get(object_key)
        .and_then(|object| object.get(field_key))
        .map(|field| match field {
            Value::String(value) => value.clone(),
            Value::Number(value) => value.to_string(),
            Value::Bool(value) => value.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default()
}

impl ActiveAgentEntry {
    fn from_value(v: &Value) -> Self {
        let session_id = v
            .get("activeSession")
            .and_then(|session| session.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let touched = arr(v, "touchedFiles")
            .iter()
            .filter_map(|claim| {
                let file = s(claim, "filePath");
                if file.is_empty() {
                    None
                } else {
                    let symbol = s(claim, "symbolPath");
                    Some(if symbol.is_empty() {
                        file
                    } else {
                        format!("{file}#{symbol}")
                    })
                }
            })
            .take(4)
            .collect();
        let squid = v.get("squid").unwrap_or(&Value::Null);
        let capabilities = squid.get("capabilities").unwrap_or(&Value::Null);
        let squid_capabilities = [
            ("TURN suggestibility", "suggestibility"),
            ("EDIT protection", "editProtection"),
            ("TRACE", "trace"),
            ("INBOX", "inbox"),
            ("PARLEY delivery", "parleyDelivery"),
        ]
        .iter()
        .filter(|(_, key)| capabilities.get(*key).and_then(Value::as_bool) == Some(true))
        .map(|(label, _)| (*label).to_string())
        .collect();
        let squid_missing = squid
            .get("missing")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();

        Self {
            id: s(v, "id"),
            label: s(v, "label"),
            purpose: s(v, "purpose"),
            liveness: s(v, "liveness"),
            harness: nested_s(v, "harness", "label"),
            backend: nested_s(v, "harness", "backend"),
            squid_level: nested_s(v, "squid", "level"),
            squid_score: v
                .get("squid")
                .and_then(|squid| squid.get("score"))
                .and_then(Value::as_i64)
                .unwrap_or(0),
            squid_capabilities,
            squid_missing,
            squid_repair: nested_s(v, "squid", "repair"),
            worktree: nested_s(v, "worktree", "root"),
            branch: nested_s(v, "worktree", "branch"),
            session_id,
            touched,
            last_heartbeat_ms: n(v, "lastHeartbeat"),
        }
    }
}

pub struct ActiveAgentsPane {
    agents: Vec<ActiveAgentEntry>,
    generated_at_ms: i64,
    last_error: Option<String>,
}

impl Default for ActiveAgentsPane {
    fn default() -> Self {
        Self {
            agents: Vec::new(),
            generated_at_ms: 0,
            last_error: None,
        }
    }
}

impl ActiveAgentsPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn squid_tone(level: &str) -> Tone {
        match level {
            "LIVE" => Tone::Engaged,
            "READY" => Tone::Landed,
            "PARTIAL" => Tone::Gated,
            "UNPROTECTED" => Tone::Alarm,
            _ => Tone::Resting,
        }
    }
}

impl Pane for ActiveAgentsPane {
    fn id(&self) -> &str {
        "active-agents"
    }

    fn title(&self) -> String {
        "Agents".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Active Agents - Harness Roster".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        blocks.push(Block::KeyVal("live".into(), self.agents.len().to_string()));
        let count = |level: &str| {
            self.agents
                .iter()
                .filter(|agent| agent.squid_level == level)
                .count()
        };
        blocks.push(Block::Chip {
            label: format!(
                "◆ SQUID  LIVE {}  READY {}  PARTIAL {}  UNPROTECTED {}",
                count("LIVE"),
                count("READY"),
                count("PARTIAL"),
                count("UNPROTECTED")
            ),
            tone: if count("PARTIAL") + count("UNPROTECTED") > 0 {
                Tone::Gated
            } else {
                Tone::Engaged
            },
        });
        if self.generated_at_ms > 0 {
            blocks.push(Block::KeyVal(
                "refreshed".into(),
                age_short(self.generated_at_ms),
            ));
        }

        if self.agents.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no active harnessed agents".into(),
            ));
            return blocks;
        }

        blocks.push(Block::Gap);
        for agent in &self.agents {
            blocks.push(Block::Chip {
                label: format!(
                    "◆ SQUID {:<11} {:>3}%  {} - {}",
                    if agent.squid_level.is_empty() {
                        "UNKNOWN"
                    } else {
                        &agent.squid_level
                    },
                    agent.squid_score,
                    trunc(&agent.label, 28),
                    agent.liveness
                ),
                tone: Self::squid_tone(&agent.squid_level),
            });
            blocks.push(Block::KeyVal(
                "  adds".into(),
                if agent.squid_capabilities.is_empty() {
                    "no active Squid capabilities".into()
                } else {
                    agent.squid_capabilities.join(" · ")
                },
            ));
            if !agent.squid_missing.is_empty() {
                blocks.push(Block::KeyVal(
                    "  missing".into(),
                    trunc(&agent.squid_missing.join("; "), 92),
                ));
            }
            if !agent.squid_repair.is_empty() {
                blocks.push(Block::KeyVal(
                    "  repair".into(),
                    trunc(&agent.squid_repair, 92),
                ));
            }
            blocks.push(Block::KeyVal(
                "  harness".into(),
                format!(
                    "{}{}",
                    if agent.harness.is_empty() {
                        "unknown"
                    } else {
                        &agent.harness
                    },
                    if agent.backend.is_empty() {
                        String::new()
                    } else {
                        format!(" / {}", agent.backend)
                    }
                ),
            ));
            blocks.push(Block::KeyVal(
                "  worktree".into(),
                format!(
                    "{}{}",
                    if agent.worktree.is_empty() {
                        "unknown".to_string()
                    } else {
                        trunc(&agent.worktree, 48)
                    },
                    if agent.branch.is_empty() {
                        String::new()
                    } else {
                        format!(" @ {}", trunc(&agent.branch, 20))
                    }
                ),
            ));
            blocks.push(Block::KeyVal(
                "  doing".into(),
                if agent.purpose.is_empty() {
                    "no purpose recorded".into()
                } else {
                    trunc(&agent.purpose, 72)
                },
            ));
            blocks.push(Block::KeyVal(
                "  touching".into(),
                if agent.touched.is_empty() {
                    "no active file claims".into()
                } else {
                    trunc(&agent.touched.join(", "), 92)
                },
            ));
            blocks.push(Block::KeyVal(
                "  stream".into(),
                format!("pd agent stream {}", agent.id),
            ));
            blocks.push(Block::KeyVal(
                "  steer".into(),
                format!("pd agent interrupt {} --reason ...", agent.id),
            ));
            if !agent.session_id.is_empty() {
                blocks.push(Block::KeyVal(
                    "  takeover".into(),
                    format!("pd session takeover {}", agent.session_id),
                ));
            }
            if agent.last_heartbeat_ms > 0 {
                blocks.push(Block::KeyVal(
                    "  heartbeat".into(),
                    age_short(agent.last_heartbeat_ms),
                ));
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/agent-roster?limit=80", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.agents.clear();
                }
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        self.last_error = Some(format!("GET /agent-roster -> {status}"));
                        self.agents.clear();
                        return Ok(());
                    }
                    match resp.json::<Value>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.generated_at_ms = n(&data, "generatedAt");
                            self.agents = arr(&data, "agents")
                                .iter()
                                .map(ActiveAgentEntry::from_value)
                                .collect();
                        }
                    }
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_roster_entry() {
        let entry = ActiveAgentEntry::from_value(&json!({
            "id": "agent-1",
            "label": "builder",
            "purpose": "ship feature",
            "liveness": "alive",
            "lastHeartbeat": 123,
            "harness": { "label": "Claude Code with Codex backend", "backend": "codex" },
            "squid": {
                "level": "LIVE",
                "score": 100,
                "capabilities": {
                    "suggestibility": true,
                    "editProtection": true,
                    "trace": true,
                    "inbox": true,
                    "parleyDelivery": true
                },
                "missing": [],
                "repair": null
            },
            "worktree": { "root": "/tmp/work", "branch": "codex/feature" },
            "activeSession": { "id": "session-1" },
            "touchedFiles": [{ "filePath": "src/a.ts", "symbolPath": "run" }]
        }));

        assert_eq!(entry.id, "agent-1");
        assert_eq!(entry.harness, "Claude Code with Codex backend");
        assert_eq!(entry.squid_level, "LIVE");
        assert_eq!(entry.squid_score, 100);
        assert_eq!(entry.squid_capabilities.len(), 5);
        assert_eq!(entry.touched, vec!["src/a.ts#run"]);
        assert_eq!(entry.session_id, "session-1");
    }

    #[test]
    fn view_lists_control_affordances() {
        let mut pane = ActiveAgentsPane::default();
        pane.agents = vec![ActiveAgentEntry {
            id: "agent-1".into(),
            label: "builder".into(),
            purpose: "ship feature".into(),
            liveness: "alive".into(),
            harness: "Claude Code with Codex backend".into(),
            backend: "codex".into(),
            squid_level: "PARTIAL".into(),
            squid_score: 72,
            squid_capabilities: vec!["EDIT protection".into(), "TRACE".into()],
            squid_missing: vec!["Pilot SessionStart hook is not installed".into()],
            squid_repair: "pd squid on".into(),
            worktree: "/tmp/work".into(),
            branch: "codex/feature".into(),
            session_id: "session-1".into(),
            touched: vec!["src/a.ts".into()],
            last_heartbeat_ms: 0,
        }];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  stream" && v.contains("pd agent stream agent-1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  takeover" && v.contains("session-1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::Chip { label, tone: Tone::Gated } if label.contains("SQUID PARTIAL") && label.contains("72%"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  missing" && v.contains("SessionStart"))));
    }
}
