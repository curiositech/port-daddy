//! Inbox pane — unread agent-to-operator messages from the PD bus.
//!
//! Calls `GET /inbox?limit=30` on the daemon.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxMsg {
    #[serde(rename = "msgId", default)]
    msg_id: String,
    #[serde(default)]
    sender: String,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    read: bool,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InboxResponse {
    #[serde(default)]
    messages: Vec<InboxMsg>,
}

fn ts_short(ts: Option<&str>) -> String {
    match ts {
        Some(s) if s.len() >= 19 => s[11..19].to_string(),
        Some(s) => s.to_string(),
        None => "—".into(),
    }
}

pub struct InboxPane {
    messages: Vec<InboxMsg>,
    last_error: Option<String>,
}

impl Default for InboxPane {
    fn default() -> Self { Self { messages: Vec::new(), last_error: None } }
}

impl InboxPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for InboxPane {
    fn id(&self) -> &str { "inbox" }
    fn title(&self) -> String { "Inbox".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Agent Inbox".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("note".into(), "GET /inbox not yet available".into()));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.messages.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "inbox empty".into()));
        } else {
            let unread = self.messages.iter().filter(|m| !m.read).count();
            blocks.push(Block::KeyVal("total".into(), self.messages.len().to_string()));
            blocks.push(Block::KeyVal("unread".into(), unread.to_string()));
            blocks.push(Block::Gap);

            for msg in &self.messages {
                let ts = ts_short(msg.created_at.as_deref());
                let sender = if msg.sender.len() > 16 { &msg.sender[..16] } else { &msg.sender };
                let subject = msg.subject.as_deref().unwrap_or(&msg.body);
                let subject_trunc = if subject.len() > 50 {
                    format!("{}…", &subject[..50])
                } else {
                    subject.to_string()
                };
                let tone = if msg.read { Tone::Resting } else { Tone::Engaged };
                blocks.push(Block::Row(vec![
                    ts,
                    sender.to_string(),
                    subject_trunc,
                ]));
                let _ = tone;
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/inbox?limit=30", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.messages.clear();
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.messages.clear();
                }
                Ok(resp) => {
                    match resp.json::<InboxResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.messages = data.messages;
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

    #[test]
    fn view_empty() {
        let p = InboxPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Inbox")));
    }

    #[test]
    fn view_messages() {
        let mut p = InboxPane::default();
        p.messages = vec![
            InboxMsg {
                msg_id: "m1".into(),
                sender: "agent-abc".into(),
                subject: Some("Scope claim conflict on app.rs".into()),
                body: String::new(),
                read: false,
                created_at: Some("2026-06-10T15:30:00Z".into()),
            },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 1);
    }
}
