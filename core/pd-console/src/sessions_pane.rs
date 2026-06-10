//! Sessions pane — live view of all active Port Daddy sessions.
//!
//! Calls `GET /sessions?status=active&limit=50` on the daemon.
//! Shows: identity, purpose, worktree, file-claim count, age.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionEntry {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(default)]
    identity: String,
    #[serde(default)]
    purpose: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    worktree_id: Option<String>,
    #[serde(default)]
    file_count: Option<u32>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionsResponse {
    #[serde(default)]
    sessions: Vec<SessionEntry>,
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
        let mut blocks = vec![Block::Header("Active Sessions".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let active: Vec<_> = self.sessions.iter().filter(|s| s.status == "active").collect();
        blocks.push(Block::KeyVal("active".into(), active.len().to_string()));

        if self.sessions.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no sessions — pd begin to start one".into()));
        } else {
            blocks.push(Block::Gap);
            for s in &self.sessions {
                let id_short = &s.session_id[..s.session_id.len().min(10)];
                let identity = if s.identity.is_empty() { id_short.to_string() } else {
                    s.identity[..s.identity.len().min(28)].to_string()
                };
                let purpose_trunc = if s.purpose.len() > 40 {
                    format!("{}…", &s.purpose[..40])
                } else {
                    s.purpose.clone()
                };
                let wt = s.worktree_id.as_deref().unwrap_or("-");
                let wt_short = if wt.len() > 16 { &wt[..16] } else { wt };
                let files = s.file_count.map(|n| n.to_string()).unwrap_or_else(|| "0".into());
                let tone = if s.status == "active" { Tone::Engaged } else { Tone::Resting };
                blocks.push(Block::Chip { label: identity.clone(), tone });
                blocks.push(Block::KeyVal("purpose".into(), purpose_trunc));
                blocks.push(Block::KeyVal("worktree".into(), wt_short.to_string()));
                blocks.push(Block::KeyVal("files".into(), files));
                blocks.push(Block::Gap);
            }
        }

        let n = active.len();
        blocks.push(Block::Chip {
            label: format!("{n} active session{}", if n == 1 { "" } else { "s" }),
            tone: if n > 0 { Tone::Engaged } else { Tone::Resting },
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
                Ok(resp) => {
                    match resp.json::<SessionsResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.sessions = data.sessions;
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

    fn make_session(identity: &str, status: &str) -> SessionEntry {
        SessionEntry {
            session_id: "sess-abc123".into(),
            identity: identity.into(),
            purpose: "Test purpose".into(),
            status: status.into(),
            worktree_id: Some("my-worktree".into()),
            file_count: Some(3),
            created_at: None,
        }
    }

    #[test]
    fn view_empty() {
        let pane = SessionsPane::default();
        let blocks = pane.view();
        assert!(blocks.len() >= 2);
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Active Sessions"));
    }

    #[test]
    fn view_active_sessions() {
        let mut pane = SessionsPane::default();
        pane.sessions = vec![make_session("port-daddy:panels", "active")];
        let blocks = pane.view();
        let has_chip = blocks.iter().any(|b| matches!(b, Block::Chip { .. }));
        assert!(has_chip, "expected a chip block");
    }

    #[test]
    fn view_error() {
        let mut pane = SessionsPane::default();
        pane.last_error = Some("connection refused".into());
        let blocks = pane.view();
        assert_eq!(blocks.len(), 2);
        assert!(matches!(&blocks[1], Block::KeyVal(k, _) if k == "error"));
    }
}
