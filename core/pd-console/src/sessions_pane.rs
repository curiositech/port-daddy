//! Sessions pane — live view of Port Daddy sessions.
//!
//! Calls `GET /sessions?limit=50`. Real shape (v3.18):
//! `{ sessions: [{ id, purpose, status, phase, agentId, worktreeId,
//!    identityProject, createdAt(ms), updatedAt(ms) }] }`

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct SessionEntry {
    id: String,
    purpose: String,
    status: String,
    phase: String,
    project: String,
    worktree: String,
    agent_id: String,
    updated_at_ms: i64,
    created_at_ms: i64,
    file_count: i64,
    note_count: i64,
    durable: bool,
    metadata: Option<Value>,
}

impl SessionEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            purpose: s(v, "purpose"),
            status: s(v, "status"),
            phase: s(v, "phase"),
            project: s(v, "identityProject"),
            worktree: s(v, "worktreeId"),
            agent_id: s(v, "agentId"),
            updated_at_ms: n(v, "updatedAt"),
            created_at_ms: n(v, "createdAt"),
            file_count: n(v, "fileCount"),
            note_count: n(v, "noteCount"),
            durable: v.get("durable").and_then(Value::as_bool).unwrap_or(false),
            metadata: v.get("metadata").cloned().filter(|value| value.is_object()),
        }
    }

    fn metadata_string(&self, keys: &[&str]) -> Option<String> {
        let metadata = self.metadata.as_ref()?.as_object()?;
        for key in keys {
            let Some(value) = metadata.get(*key) else {
                continue;
            };
            let parsed = match value {
                Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
                Value::Number(value) => Some(value.to_string()),
                Value::Bool(value) => Some(value.to_string()),
                _ => None,
            };
            if parsed.is_some() {
                return parsed;
            }
        }
        None
    }

    fn metadata_number(&self, keys: &[&str]) -> Option<f64> {
        let metadata = self.metadata.as_ref()?.as_object()?;
        for key in keys {
            let Some(value) = metadata.get(*key) else {
                continue;
            };
            let parsed = match value {
                Value::Number(value) => value.as_f64(),
                Value::String(value) => value.trim().parse::<f64>().ok(),
                _ => None,
            };
            if parsed.is_some() {
                return parsed;
            }
        }
        None
    }

    fn is_shell(&self) -> bool {
        self.agent_id.is_empty() && self.status == "active"
    }

    fn display_status(&self) -> String {
        if let Some(receipt) = self.metadata_string(&[
            "currentEventVerb",
            "eventVerb",
            "latestStatus",
            "latest_event_verb",
            "verb",
        ]) {
            if receipt == "accepted" || receipt == "starting" {
                return receipt;
            }
        }
        if self.status.is_empty() {
            "unknown".into()
        } else {
            self.status.clone()
        }
    }

    fn runtime_label(&self) -> String {
        "no_runtime".into()
    }

    fn lineage_label(&self) -> String {
        let predecessor = self.metadata_string(&["predecessorSessionId", "predecessor_session_id"]);
        let successor = self.metadata_string(&["takenOverBySessionId", "taken_over_by_session_id"]);
        if let Some(predecessor) = predecessor {
            return format!("{predecessor} -> {}", self.id);
        }
        if let Some(successor) = successor {
            return format!("{} -> {successor}", self.id);
        }
        self.id.clone()
    }

    fn action_label(&self) -> String {
        "open takeover".into()
    }

    fn cost_label(&self) -> Option<String> {
        let cost =
            self.metadata_number(&["costUsd", "cost_usd", "currentCostUsd", "current_cost_usd"]);
        let budget = self.metadata_number(&[
            "budgetUsd",
            "budget_usd",
            "budgetUsdPerDay",
            "budget_usd_per_day",
        ]);
        match (cost, budget) {
            (Some(cost), Some(budget)) => Some(format!("${cost:.2} / ${budget:.2}")),
            (Some(cost), None) => Some(format!("${cost:.2}")),
            (None, Some(budget)) => Some(format!("budget ${budget:.2}")),
            (None, None) => None,
        }
    }
}

pub struct SessionsPane {
    sessions: Vec<SessionEntry>,
    last_error: Option<String>,
}

impl Default for SessionsPane {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
            last_error: None,
        }
    }
}

impl SessionsPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for SessionsPane {
    fn id(&self) -> &str {
        "sessions"
    }
    fn title(&self) -> String {
        "Sessions".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Sessions".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let active = self
            .sessions
            .iter()
            .filter(|x| x.status == "active")
            .count();
        let shells = self
            .sessions
            .iter()
            .filter(|x| {
                x.is_shell() && matches!(x.display_status().as_str(), "accepted" | "starting")
            })
            .count();
        blocks.push(Block::KeyVal("active".into(), active.to_string()));
        blocks.push(Block::Chip {
            label: format!("shell receipts {}", shells),
            tone: if shells > 0 {
                Tone::Landed
            } else {
                Tone::Resting
            },
        });

        if self.sessions.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no sessions — pd begin to start one".into(),
            ));
        } else {
            blocks.push(Block::Gap);
            for sess in &self.sessions {
                let status = sess.display_status();
                let runtime = sess.runtime_label();
                let (letter, tone) = match status.as_str() {
                    "accepted" => ('A', Tone::Landed),
                    "starting" => ('S', Tone::Landed),
                    "active" => (
                        'K',
                        if runtime == "no_runtime" {
                            Tone::Landed
                        } else {
                            Tone::Engaged
                        },
                    ),
                    "completed" => ('C', Tone::Landed),
                    "abandoned" => ('N', Tone::Gated),
                    "failed" => ('V', Tone::Conflicted),
                    _ => ('L', Tone::Resting),
                };
                let name = if sess.purpose.is_empty() {
                    trunc(&sess.id, 24)
                } else {
                    trunc(&sess.purpose, 44)
                };
                blocks.push(Block::Flag {
                    letter,
                    tone,
                    label: vec![
                        age_short(sess.updated_at_ms.max(sess.created_at_ms)),
                        trunc(&sess.project, 14),
                        status,
                        name,
                    ]
                    .join("  /  "),
                });
                blocks.push(Block::KeyVal("runtime".into(), runtime));
                if !sess.agent_id.is_empty() {
                    blocks.push(Block::KeyVal("agent".into(), trunc(&sess.agent_id, 24)));
                }
                if !sess.worktree.is_empty() {
                    blocks.push(Block::KeyVal("worktree".into(), trunc(&sess.worktree, 24)));
                }
                blocks.push(Block::KeyVal(
                    "event".into(),
                    sess.metadata_string(&[
                        "currentEventVerb",
                        "eventVerb",
                        "latestStatus",
                        "latest_event_verb",
                        "verb",
                    ])
                    .or_else(|| {
                        if !sess.phase.is_empty() {
                            Some(sess.phase.clone())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| sess.status.clone()),
                ));
                blocks.push(Block::KeyVal(
                    "lineage".into(),
                    trunc(&sess.lineage_label(), 64),
                ));
                if let Some(cost) = sess.cost_label() {
                    blocks.push(Block::KeyVal("cost".into(), cost));
                }
                blocks.push(Block::KeyVal("files".into(), sess.file_count.to_string()));
                blocks.push(Block::KeyVal("notes".into(), sess.note_count.to_string()));
                blocks.push(Block::KeyVal("action".into(), sess.action_label()));
                if sess.durable {
                    blocks.push(Block::KeyVal("durable".into(), "yes".into()));
                }
            }
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!(
                "{active} active session{}",
                if active == 1 { "" } else { "s" }
            ),
            tone: if active > 0 {
                Tone::Engaged
            } else {
                Tone::Resting
            },
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/sessions?limit=50", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.sessions.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.sessions = arr(&data, "sessions")
                            .iter()
                            .map(SessionEntry::from_value)
                            .collect();
                    }
                },
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
    fn from_value_real_shape() {
        let v = json!({
            "id": "session-echo-allowed-77486c46e6a1", "purpose": "echo allowed",
            "status": "completed", "phase": "completed", "agentId": "spawned-x",
            "worktreeId": "b4cc5e56", "identityProject": "myapp",
            "createdAt": 1781123457144i64,
            "updatedAt": 1781123459155i64,
            "fileCount": 2,
            "noteCount": 7,
            "durable": true,
            "metadata": { "predecessorSessionId": "session-prev" }
        });
        let e = SessionEntry::from_value(&v);
        assert_eq!(e.purpose, "echo allowed");
        assert_eq!(e.project, "myapp");
        assert_eq!(e.created_at_ms, 1781123457144);
        assert_eq!(e.updated_at_ms, 1781123459155);
        assert_eq!(e.file_count, 2);
        assert_eq!(e.note_count, 7);
        assert!(e.durable);
        assert_eq!(
            e.lineage_label(),
            "session-prev -> session-echo-allowed-77486c46e6a1"
        );
    }

    #[test]
    fn view_empty() {
        let pane = SessionsPane::default();
        let blocks = pane.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Sessions"));
    }

    #[test]
    fn view_active_sessions() {
        let mut pane = SessionsPane::default();
        pane.sessions = vec![SessionEntry {
            id: "sess-1".into(),
            purpose: "build panels".into(),
            status: "active".into(),
            phase: "in_progress".into(),
            project: "port-daddy".into(),
            worktree: "wt-1".into(),
            agent_id: "agent-1".into(),
            updated_at_ms: 1000,
            created_at_ms: 0,
            file_count: 1,
            note_count: 3,
            durable: true,
            metadata: Some(json!({
                "predecessorSessionId": "sess-0",
                "budgetUsd": 2.5,
                "costUsd": 1.25
            })),
        }];
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Flag {
                letter: 'K',
                tone: Tone::Landed,
                ..
            }
        )));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "runtime" && v == "no_runtime")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "agent" && v == "agent-1")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "action" && v == "open takeover")));
    }

    #[test]
    fn view_accepted_shell_sessions_surface_no_runtime() {
        let mut pane = SessionsPane::default();
        pane.sessions = vec![SessionEntry {
            id: "sess-shell".into(),
            purpose: "shell session".into(),
            status: "active".into(),
            phase: "in_progress".into(),
            project: "port-daddy".into(),
            worktree: "wt-shell".into(),
            agent_id: String::new(),
            updated_at_ms: 2000,
            created_at_ms: 1000,
            file_count: 0,
            note_count: 0,
            durable: false,
            metadata: Some(json!({
                "currentEventVerb": "accepted",
                "predecessorSessionId": "sess-prev"
            })),
        }];
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, tone: Tone::Landed } if label.contains("shell receipts 1"))));
        assert!(blocks.iter().any(|b| matches!(b, Block::Flag { letter: 'A', tone: Tone::Landed, label, .. } if label.contains("accepted"))));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "runtime" && v == "no_runtime")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "action" && v == "open takeover")));
        assert!(!blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "agent")));
    }

    #[test]
    fn view_starting_shell_sessions_surface_no_runtime() {
        let mut pane = SessionsPane::default();
        pane.sessions = vec![SessionEntry {
            id: "sess-starting".into(),
            purpose: "starting shell".into(),
            status: "active".into(),
            phase: "starting".into(),
            project: "port-daddy".into(),
            worktree: "wt-starting".into(),
            agent_id: String::new(),
            updated_at_ms: 2000,
            created_at_ms: 1000,
            file_count: 0,
            note_count: 0,
            durable: false,
            metadata: Some(json!({
                "currentEventVerb": "starting",
                "predecessorSessionId": "sess-prev"
            })),
        }];
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, tone: Tone::Landed } if label.contains("shell receipts 1"))));
        assert!(blocks.iter().any(|b| matches!(b, Block::Flag { letter: 'S', tone: Tone::Landed, label, .. } if label.contains("starting"))));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "runtime" && v == "no_runtime")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "action" && v == "open takeover")));
        assert!(!blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "agent")));
    }

    #[test]
    fn view_error() {
        let mut pane = SessionsPane::default();
        pane.last_error = Some("connection refused".into());
        let blocks = pane.view();
        assert!(matches!(&blocks[1], Block::KeyVal(k, _) if k == "error"));
    }
}
