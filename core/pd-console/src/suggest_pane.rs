//! Suggest pane — operator-facing next-move suggestions from the daemon.
//!
//! Calls `GET /suggest?limit=10` on the daemon.
//! Surface: unblocked sorties, sessions nearing TTL, unhealthy routes.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Suggestion {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    priority: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SuggestResponse {
    #[serde(default)]
    suggestions: Vec<Suggestion>,
}

fn priority_tone(p: Option<&str>) -> Tone {
    match p {
        Some("high") | Some("critical") => Tone::Gated,
        Some("medium") => Tone::Accent,
        Some("low") => Tone::Resting,
        _ => Tone::Default,
    }
}

pub struct SuggestPane {
    suggestions: Vec<Suggestion>,
    last_error: Option<String>,
}

impl Default for SuggestPane {
    fn default() -> Self { Self { suggestions: Vec::new(), last_error: None } }
}

impl SuggestPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for SuggestPane {
    fn id(&self) -> &str { "suggest" }
    fn title(&self) -> String { "Suggest".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Next-Move Suggestions".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("note".into(), "GET /suggest not yet available".into()));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.suggestions.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no suggestions — system looks healthy".into()));
        } else {
            blocks.push(Block::KeyVal("count".into(), self.suggestions.len().to_string()));
            blocks.push(Block::Gap);

            for sug in &self.suggestions {
                let tone = priority_tone(sug.priority.as_deref());
                let title_trunc = if sug.title.len() > 60 {
                    format!("{}…", &sug.title[..60])
                } else {
                    sug.title.clone()
                };
                blocks.push(Block::Chip { label: format!("[{}]  {}", sug.kind, title_trunc), tone });
                if let Some(detail) = &sug.detail {
                    let d = if detail.len() > 72 { format!("{}…", &detail[..72]) } else { detail.clone() };
                    blocks.push(Block::KeyVal("detail".into(), d));
                }
                if let Some(action) = &sug.action {
                    blocks.push(Block::KeyVal("action".into(), action.clone()));
                }
                blocks.push(Block::Gap);
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/suggest?limit=10", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.suggestions.clear();
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.suggestions.clear();
                }
                Ok(resp) => {
                    match resp.json::<SuggestResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.suggestions = data.suggestions;
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
        let p = SuggestPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Suggest")));
    }

    #[test]
    fn priority_tones() {
        assert!(matches!(priority_tone(Some("high")), Tone::Gated));
        assert!(matches!(priority_tone(Some("medium")), Tone::Accent));
        assert!(matches!(priority_tone(Some("low")), Tone::Resting));
        assert!(matches!(priority_tone(None), Tone::Default));
    }
}
