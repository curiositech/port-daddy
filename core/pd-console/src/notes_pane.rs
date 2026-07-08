//! Notes / Memory pane — recent session notes from the daemon.
//!
//! Calls `GET /notes?limit=30`. Real shape (v3.18):
//! `{ notes: [{ id, sessionId, content, type, createdAt(ms), agentId,
//!    sessionPurpose, identityProject }] }`

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct NoteEntry {
    content: String,
    agent_id: String,
    note_type: String,
    created_at_ms: i64,
}

impl NoteEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            content: s(v, "content"),
            agent_id: s(v, "agentId"),
            note_type: s(v, "type"),
            created_at_ms: n(v, "createdAt"),
        }
    }
}

pub struct NotesPane {
    notes: Vec<NoteEntry>,
    last_error: Option<String>,
}

impl Default for NotesPane {
    fn default() -> Self {
        Self {
            notes: Vec::new(),
            last_error: None,
        }
    }
}

impl NotesPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for NotesPane {
    fn id(&self) -> &str {
        "memory"
    }
    fn title(&self) -> String {
        "Memory".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Session Notes".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.notes.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no notes — pd note \"...\" to add one".into(),
            ));
        } else {
            blocks.push(Block::KeyVal("total".into(), self.notes.len().to_string()));
            blocks.push(Block::Gap);

            for note in &self.notes {
                let ntype = if note.note_type.is_empty() {
                    "note".to_string()
                } else {
                    note.note_type.clone()
                };
                let tone = match ntype.as_str() {
                    "feat" | "fix" | "result" | "handoff" => Tone::Landed,
                    "scope" | "begin" => Tone::Engaged,
                    "error" | "block" => Tone::Gated,
                    _ => Tone::Default,
                };
                let first_line = note.content.lines().next().unwrap_or("");
                blocks.push(Block::Row(vec![
                    age_short(note.created_at_ms),
                    ntype,
                    trunc(&note.agent_id, 14),
                    trunc(first_line, 56),
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
            let url = format!("{}/notes?limit=30", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.notes.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.notes = arr(&data, "notes")
                            .iter()
                            .map(NoteEntry::from_value)
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
    fn view_empty() {
        let p = NotesPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Session Notes"));
    }

    #[test]
    fn from_value_real_shape() {
        let v = json!({
            "id": 9661, "sessionId": "session-x", "content": "Result: done.\nMore detail.",
            "type": "handoff", "createdAt": 1781123458171i64,
            "agentId": "spawned-f67d", "sessionPurpose": "echo allowed"
        });
        let e = NoteEntry::from_value(&v);
        assert_eq!(e.content.lines().next().unwrap(), "Result: done.");
        assert_eq!(e.note_type, "handoff");
        assert_eq!(e.created_at_ms, 1781123458171);
    }

    #[test]
    fn view_notes() {
        let mut p = NotesPane::default();
        p.notes = vec![
            NoteEntry {
                content: "Scope: app.rs".into(),
                agent_id: "a1".into(),
                note_type: "scope".into(),
                created_at_ms: 0,
            },
            NoteEntry {
                content: "Result: green".into(),
                agent_id: "a1".into(),
                note_type: "result".into(),
                created_at_ms: 0,
            },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }
}
