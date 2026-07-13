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
    project: String,
    worktree: String,
    created_at_ms: i64,
}

impl SessionEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            purpose: s(v, "purpose"),
            status: s(v, "status"),
            project: s(v, "identityProject"),
            worktree: s(v, "worktreeId"),
            created_at_ms: n(v, "createdAt"),
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
        blocks.push(Block::KeyVal("active".into(), active.to_string()));

        if self.sessions.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no sessions — pd begin to start one".into(),
            ));
        } else {
            blocks.push(Block::Gap);
            for sess in &self.sessions {
                let (letter, tone) = match sess.status.as_str() {
                    "active" => ('K', Tone::Engaged),
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
                        age_short(sess.created_at_ms),
                        trunc(&sess.project, 14),
                        sess.status.clone(),
                        name,
                    ]
                    .join("  /  "),
                });
                if !sess.worktree.is_empty() {
                    blocks.push(Block::KeyVal("worktree".into(), trunc(&sess.worktree, 24)));
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
            "createdAt": 1781123457144i64
        });
        let e = SessionEntry::from_value(&v);
        assert_eq!(e.purpose, "echo allowed");
        assert_eq!(e.project, "myapp");
        assert_eq!(e.created_at_ms, 1781123457144);
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
            project: "port-daddy".into(),
            worktree: "wt-1".into(),
            created_at_ms: 0,
        }];
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Flag {
                letter: 'K',
                tone: Tone::Engaged,
                ..
            }
        )));
    }

    #[test]
    fn view_error() {
        let mut pane = SessionsPane::default();
        pane.last_error = Some("connection refused".into());
        let blocks = pane.view();
        assert!(matches!(&blocks[1], Block::KeyVal(k, _) if k == "error"));
    }
}
