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
    status: String,
    liveness: String,
    pid: i64,
    progress: String,
    event_verb: String,
    lineage_label: String,
    cost_usd: Option<f64>,
    budget_usd: Option<f64>,
    harness: String,
    backend: String,
    model: String,
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
    stream_url: String,
    interrupt_url: String,
    control_center_url: String,
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
            status: s(v, "status"),
            liveness: s(v, "liveness"),
            pid: n(v, "pid"),
            progress: s(v, "progress"),
            event_verb: s(v, "eventVerb"),
            lineage_label: s(v, "lineageLabel"),
            cost_usd: v.get("costUsd").and_then(Value::as_f64),
            budget_usd: v.get("budgetUsd").and_then(Value::as_f64),
            harness: nested_s(v, "harness", "label"),
            backend: nested_s(v, "harness", "backend"),
            model: nested_s(v, "harness", "model"),
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
            stream_url: nested_s(v, "control", "streamUrl"),
            interrupt_url: nested_s(v, "control", "interruptUrl"),
            control_center_url: nested_s(v, "control", "controlCenterUrl"),
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

        let live_runtime = self
            .agents
            .iter()
            .filter(|agent| agent.liveness == "alive")
            .count();
        let shell_rows = self
            .agents
            .iter()
            .filter(|agent| {
                matches!(agent.status.as_str(), "accepted" | "starting")
                    && agent.liveness == "no_runtime"
            })
            .count();
        blocks.push(Block::KeyVal("live".into(), live_runtime.to_string()));
        blocks.push(Block::KeyVal("shells".into(), shell_rows.to_string()));
        let count = |level: &str| {
            self.agents
                .iter()
                .filter(|agent| agent.squid_level == level)
                .count()
        };
        blocks.push(Block::Chip {
            label: format!(
                "◆ STATUS live {}  shell receipts {}  ·  SQUID LIVE {}  READY {}  PARTIAL {}  UNPROTECTED {}",
                live_runtime,
                shell_rows,
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
            let status = if agent.status.is_empty() {
                "unknown"
            } else {
                &agent.status
            };
            let runtime = if agent.liveness == "no_runtime" {
                "no_runtime".to_string()
            } else if agent.pid > 0 {
                format!(
                    "pid {} · heartbeat {} · {}",
                    agent.pid,
                    age_short(agent.last_heartbeat_ms),
                    agent.liveness
                )
            } else if agent.last_heartbeat_ms > 0 {
                format!(
                    "heartbeat {} · {}",
                    age_short(agent.last_heartbeat_ms),
                    agent.liveness
                )
            } else {
                format!("runtime unknown · {}", agent.liveness)
            };
            blocks.push(Block::Chip {
                label: format!(
                    "{}  |  SQUID {:<11} {:>3}%  {}",
                    status,
                    if agent.squid_level.is_empty() {
                        "UNKNOWN"
                    } else {
                        &agent.squid_level
                    },
                    agent.squid_score,
                    trunc(&agent.label, 28)
                ),
                tone: Self::squid_tone(&agent.squid_level),
            });
            blocks.push(Block::KeyVal("  status".into(), status.to_string()));
            blocks.push(Block::KeyVal("  runtime".into(), runtime));
            blocks.push(Block::KeyVal(
                "  harness".into(),
                if agent.harness.is_empty() {
                    "unknown".into()
                } else {
                    trunc(&agent.harness, 52)
                },
            ));
            if !agent.backend.is_empty() {
                blocks.push(Block::KeyVal("  backend".into(), trunc(&agent.backend, 52)));
            }
            if !agent.model.is_empty() {
                blocks.push(Block::KeyVal("  model".into(), trunc(&agent.model, 52)));
            }
            if !agent.progress.is_empty() {
                blocks.push(Block::KeyVal(
                    "  progress".into(),
                    trunc(&agent.progress, 88),
                ));
            }
            blocks.push(Block::KeyVal(
                "  event".into(),
                if agent.event_verb.is_empty() {
                    "unknown".into()
                } else {
                    trunc(&agent.event_verb, 72)
                },
            ));
            blocks.push(Block::KeyVal(
                "  lineage".into(),
                if agent.lineage_label.is_empty() {
                    "unknown".into()
                } else {
                    trunc(&agent.lineage_label, 92)
                },
            ));
            if agent.cost_usd.is_some() || agent.budget_usd.is_some() {
                let cost = match (agent.cost_usd, agent.budget_usd) {
                    (Some(cost), Some(budget)) => format!("${cost:.2} / ${budget:.2}"),
                    (Some(cost), None) => format!("${cost:.2}"),
                    (None, Some(budget)) => format!("budget ${budget:.2}"),
                    (None, None) => String::new(),
                };
                if !cost.is_empty() {
                    blocks.push(Block::KeyVal("  cost".into(), cost));
                }
            }
            blocks.push(Block::KeyVal(
                "  touching".into(),
                if agent.touched.is_empty() {
                    "no active file claims".into()
                } else {
                    trunc(&agent.touched.join(", "), 92)
                },
            ));
            if !agent.stream_url.is_empty() {
                blocks.push(Block::KeyVal(
                    "  stream".into(),
                    format!("open live stream for {}", agent.id),
                ));
            }
            if !agent.interrupt_url.is_empty() {
                blocks.push(Block::KeyVal(
                    "  interrupt".into(),
                    format!("send interrupt for {}", agent.id),
                ));
            }
            if !agent.control_center_url.is_empty() {
                blocks.push(Block::KeyVal(
                    "  open".into(),
                    trunc(&agent.control_center_url, 92),
                ));
            }
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
            if !agent.purpose.is_empty() {
                blocks.push(Block::KeyVal("  doing".into(), trunc(&agent.purpose, 72)));
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
            "worktree": { "root": "/Users/operator/coding/tmp/work", "branch": "codex/feature" },
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
            status: "ready".into(),
            liveness: "alive".into(),
            pid: 4242,
            progress: "50% through the turn".into(),
            event_verb: "writing".into(),
            lineage_label: "session-0 -> session-1".into(),
            cost_usd: Some(0.5),
            budget_usd: Some(1.0),
            harness: "Claude Code with Codex backend".into(),
            backend: "codex".into(),
            model: "resolved-codex-model".into(),
            squid_level: "PARTIAL".into(),
            squid_score: 72,
            squid_capabilities: vec!["EDIT protection".into(), "TRACE".into()],
            squid_missing: vec!["Pilot SessionStart hook is not installed".into()],
            squid_repair: "pd squid on".into(),
            worktree: "/Users/operator/coding/tmp/work".into(),
            branch: "codex/feature".into(),
            session_id: "session-1".into(),
            touched: vec!["src/a.ts".into()],
            last_heartbeat_ms: 0,
            stream_url: "/agents/agent-1/stream".into(),
            interrupt_url: "/agents/agent-1/interrupt".into(),
            control_center_url: "/fleet-ui/?surface=agents&agent=agent-1".into(),
        }];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  runtime" && v.contains("pid 4242"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  model" && v.contains("resolved-codex-model"))));
        assert!(blocks.iter().any(
            |block| matches!(block, Block::KeyVal(k, v) if k == "  event" && v.contains("writing"))
        ));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  lineage" && v.contains("session-0 -> session-1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  stream" && v.contains("open live stream for agent-1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  interrupt" && v.contains("send interrupt for agent-1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  open" && v.contains("/fleet-ui/"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::Chip { label, tone: Tone::Gated } if label.contains("ready") && label.contains("SQUID PARTIAL") && label.contains("72%"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  missing" && v.contains("SessionStart"))));
    }

    #[test]
    fn view_shell_rows_hide_live_controls_when_runtime_is_missing() {
        let mut pane = ActiveAgentsPane::default();
        pane.agents = vec![ActiveAgentEntry {
            id: "session-shell".into(),
            label: "Accepted shell".into(),
            purpose: "Accepted shell".into(),
            status: "accepted".into(),
            liveness: "no_runtime".into(),
            pid: 0,
            progress: String::new(),
            event_verb: "accepted".into(),
            lineage_label: "session-prev -> session-shell".into(),
            cost_usd: None,
            budget_usd: None,
            harness: "Session shell".into(),
            backend: String::new(),
            model: String::new(),
            squid_level: "READY".into(),
            squid_score: 100,
            squid_capabilities: vec![],
            squid_missing: vec![],
            squid_repair: String::new(),
            worktree: "/Users/operator/coding/tmp/work".into(),
            branch: "repair/shell".into(),
            session_id: "session-shell".into(),
            touched: vec![],
            last_heartbeat_ms: 0,
            stream_url: String::new(),
            interrupt_url: String::new(),
            control_center_url: "/fleet-ui/?surface=agents&agent=session-shell".into(),
        }];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(block, Block::Chip { label, tone: Tone::Engaged } if label.contains("shell receipts 1"))));
        assert!(blocks.iter().any(|block| matches!(block, Block::KeyVal(k, v) if k == "  runtime" && v.contains("no_runtime"))));
        assert!(!blocks
            .iter()
            .any(|block| matches!(block, Block::KeyVal(k, _) if k == "  stream")));
        assert!(!blocks
            .iter()
            .any(|block| matches!(block, Block::KeyVal(k, _) if k == "  interrupt")));
    }

    #[test]
    fn view_starting_shell_rows_surface_no_runtime() {
        let mut pane = ActiveAgentsPane::default();
        pane.agents = vec![ActiveAgentEntry {
            id: "session-starting".into(),
            label: "Starting shell".into(),
            purpose: "Starting shell".into(),
            status: "starting".into(),
            liveness: "no_runtime".into(),
            pid: 0,
            progress: String::new(),
            event_verb: "starting".into(),
            lineage_label: "session-prev -> session-starting".into(),
            cost_usd: None,
            budget_usd: None,
            harness: "Session shell".into(),
            backend: String::new(),
            model: String::new(),
            squid_level: "READY".into(),
            squid_score: 100,
            squid_capabilities: vec![],
            squid_missing: vec![],
            squid_repair: String::new(),
            worktree: "/Users/operator/coding/tmp/work".into(),
            branch: "repair/shell".into(),
            session_id: "session-starting".into(),
            touched: vec![],
            last_heartbeat_ms: 0,
            stream_url: String::new(),
            interrupt_url: String::new(),
            control_center_url: "/fleet-ui/?surface=agents&agent=session-starting".into(),
        }];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(block, Block::Chip { label, tone: Tone::Engaged } if label.contains("shell receipts 1"))));
        assert!(blocks.iter().any(
            |block| matches!(block, Block::KeyVal(k, v) if k == "  status" && v == "starting")
        ));
        assert!(blocks.iter().any(
            |block| matches!(block, Block::KeyVal(k, v) if k == "  runtime" && v == "no_runtime")
        ));
    }
}
