//! Sessions pane — live view of Port Daddy sessions.
//!
//! Calls `GET /sessions?status=active&all=true&limit=50`. Real shape (v3.18):
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
    agent_id: String,
    project: String,
    worktree: String,
    created_at_ms: i64,
    file_count: i64,
    note_count: i64,
}

impl SessionEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            purpose: s(v, "purpose"),
            status: s(v, "status"),
            agent_id: s(v, "agentId"),
            project: s(v, "identityProject"),
            worktree: s(v, "worktreeId"),
            created_at_ms: n(v, "createdAt"),
            file_count: n(v, "fileCount"),
            note_count: n(v, "noteCount"),
        }
    }
}

pub struct SessionsPane {
    sessions: Vec<SessionEntry>,
    last_error: Option<String>,
}

impl Default for SessionsPane {
    fn default() -> Self {
        Self { sessions: Vec::new(), last_error: None }
    }
}

impl SessionsPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for SessionsPane {
    fn id(&self) -> &str { "sessions" }
    fn title(&self) -> String { "Sessions".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Sessions".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let active = self.sessions.iter().filter(|x| x.status == "active").count();
        let claimed_files: i64 = self.sessions.iter().map(|x| x.file_count).sum();
        let notes: i64 = self.sessions.iter().map(|x| x.note_count).sum();
        blocks.push(Block::KeyVal("active".into(), active.to_string()));
        blocks.push(Block::KeyVal("scope".into(), "all worktrees".into()));

        if self.sessions.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no active sessions — pd begin to start one".into()));
        } else {
            blocks.push(Block::Gap);
            for sess in &self.sessions {
                let name = if sess.purpose.is_empty() {
                    trunc(&sess.id, 24)
                } else {
                    trunc(&sess.purpose, 44)
                };
                blocks.push(Block::Row(vec![
                    age_short(sess.created_at_ms),
                    trunc(&sess.project, 14),
                    if sess.agent_id.is_empty() { "no-agent".into() } else { trunc(&sess.agent_id, 18) },
                    name,
                ]));
                if !sess.worktree.is_empty() {
                    blocks.push(Block::KeyVal(
                        "worktree".into(),
                        format!(
                            "{} · {} files · {} notes",
                            trunc(&sess.worktree, 18),
                            sess.file_count,
                            sess.note_count
                        ),
                    ));
                }
            }
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!(
                "{active} active · {claimed_files} files · {notes} notes"
            ),
            tone: if active > 0 { Tone::Engaged } else { Tone::Resting },
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/sessions?status=active&all=true&limit=50", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.sessions.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.sessions = arr(&data, "sessions").iter().map(SessionEntry::from_value).collect();
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
            "createdAt": 1781123457144i64, "fileCount": 2, "noteCount": 3
        });
        let e = SessionEntry::from_value(&v);
        assert_eq!(e.purpose, "echo allowed");
        assert_eq!(e.agent_id, "spawned-x");
        assert_eq!(e.project, "myapp");
        assert_eq!(e.created_at_ms, 1781123457144);
        assert_eq!(e.file_count, 2);
        assert_eq!(e.note_count, 3);
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
            agent_id: "agent-1".into(),
            project: "port-daddy".into(),
            worktree: "wt-1".into(),
            created_at_ms: 0,
            file_count: 2,
            note_count: 4,
        }];
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Row(_))));
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Chip { label, tone }
            if label.contains("2 files") && label.contains("4 notes") && matches!(tone, Tone::Engaged)
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
