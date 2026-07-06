//! Peek pane — active console/session context from the daemon.
//!
//! Calls `GET /sugar/whoami` on the daemon.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct PeekResponse {
    #[serde(default)]
    active: bool,
    #[serde(default, rename = "agentId")]
    agent_id: Option<String>,
    #[serde(default, rename = "sessionId")]
    session_id: Option<String>,
    #[serde(default)]
    identity: Option<String>,
    #[serde(default)]
    purpose: Option<String>,
    #[serde(default)]
    hint: Option<String>,
}

pub struct PeekPane {
    data: Option<PeekResponse>,
    last_error: Option<String>,
}

impl Default for PeekPane {
    fn default() -> Self {
        Self {
            data: None,
            last_error: None,
        }
    }
}

impl PeekPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for PeekPane {
    fn id(&self) -> &str {
        "peek"
    }
    fn title(&self) -> String {
        "Peek".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Peek — Active Session".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal(
                "note".into(),
                "GET /sugar/whoami failed".into(),
            ));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let Some(d) = &self.data else {
            blocks.push(Block::KeyVal("status".into(), "connecting…".into()));
            return blocks;
        };

        blocks.push(Block::KeyVal("active".into(), d.active.to_string()));
        if let Some(session_id) = &d.session_id {
            blocks.push(Block::KeyVal("session".into(), session_id.clone()));
        }
        if let Some(agent_id) = &d.agent_id {
            blocks.push(Block::KeyVal("agent".into(), agent_id.clone()));
        }
        if let Some(identity) = &d.identity {
            blocks.push(Block::KeyVal("identity".into(), identity.clone()));
        }
        if let Some(purpose) = &d.purpose {
            blocks.push(Block::KeyVal("purpose".into(), purpose.clone()));
        }
        if let Some(hint) = &d.hint {
            blocks.push(Block::KeyVal("hint".into(), hint.clone()));
        }

        let tone = if d.active {
            Tone::Landed
        } else {
            Tone::Resting
        };
        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: if d.active {
                "active".into()
            } else {
                "no active session".into()
            },
            tone,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/sugar/whoami", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.data = None;
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.data = None;
                }
                Ok(resp) => match resp.json::<PeekResponse>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.data = Some(data);
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

    #[test]
    fn view_no_data() {
        let p = PeekPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Peek")));
    }

    #[test]
    fn view_error_shows_note() {
        let mut p = PeekPane::default();
        p.last_error = Some("404 Not Found".into());
        let b = p.view();
        assert!(b
            .iter()
            .any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "note")));
    }
}
