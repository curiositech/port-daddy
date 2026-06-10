//! Notes / Memory pane — recent session notes from the daemon.
//!
//! Calls `GET /notes?limit=30` on the daemon. Shows the latest notes
//! sorted by recency — short-form log of what agents have been doing.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteEntry {
    #[serde(rename = "noteId", default)]
    note_id: String,
    #[serde(default)]
    text: String,
    #[serde(rename = "agentId", default)]
    agent_id: Option<String>,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
    #[serde(rename = "type", default)]
    note_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NotesResponse {
    #[serde(default)]
    notes: Vec<NoteEntry>,
}

fn ts_short(ts: Option<&str>) -> String {
    match ts {
        Some(s) if s.len() >= 19 => s[11..19].to_string(),
        Some(s) => s.to_string(),
        None => "—".into(),
    }
}

pub struct NotesPane {
    notes: Vec<NoteEntry>,
    last_error: Option<String>,
}

impl Default for NotesPane {
    fn default() -> Self { Self { notes: Vec::new(), last_error: None } }
}

impl NotesPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for NotesPane {
    fn id(&self) -> &str { "memory" }
    fn title(&self) -> String { "Memory".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Session Notes".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.notes.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no notes — pd note \"...\" to add one".into()));
        } else {
            blocks.push(Block::KeyVal("total".into(), self.notes.len().to_string()));
            blocks.push(Block::Gap);

            for note in &self.notes {
                let ts = ts_short(note.created_at.as_deref());
                let actor = note.agent_id.as_deref()
                    .map(|a| &a[..a.len().min(14)])
                    .unwrap_or("—");
                let ntype = note.note_type.as_deref().unwrap_or("note");
                let tone = match ntype {
                    "feat" | "fix" | "result" => Tone::Landed,
                    "scope" | "begin" => Tone::Engaged,
                    "error" | "block" => Tone::Gated,
                    _ => Tone::Default,
                };

                // Note text — first line only, truncated to 60 chars
                let first_line = note.text.lines().next().unwrap_or(&note.text);
                let text_trunc = if first_line.len() > 60 {
                    format!("{}…", &first_line[..60])
                } else {
                    first_line.to_string()
                };

                blocks.push(Block::Row(vec![
                    ts,
                    ntype.to_string(),
                    actor.to_string(),
                    text_trunc,
                ]));
                let _ = tone; // tone metadata available for richer rendering
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
                Ok(resp) => {
                    match resp.json::<NotesResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.notes = data.notes;
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

    fn make_note(text: &str, ntype: Option<&str>) -> NoteEntry {
        NoteEntry {
            note_id: "note-123".into(),
            text: text.into(),
            agent_id: Some("agent-abc".into()),
            session_id: None,
            created_at: Some("2026-06-10T15:30:00Z".into()),
            note_type: ntype.map(String::from),
        }
    }

    #[test]
    fn view_empty() {
        let p = NotesPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Session Notes"));
    }

    #[test]
    fn view_notes() {
        let mut p = NotesPane::default();
        p.notes = vec![
            make_note("Scope: app.rs. Started panel refactor.", Some("scope")),
            make_note("Result: panels built and CI green.", Some("result")),
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }

    #[test]
    fn ts_short_extracts_time() {
        assert_eq!(ts_short(Some("2026-06-10T15:30:00Z")), "15:30:00");
    }
}
