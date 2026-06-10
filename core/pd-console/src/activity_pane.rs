//! Activity pane — rolling feed of daemon events.
//!
//! Calls `GET /activity?limit=40` on the daemon and renders the most recent
//! events as a chronological log. Each entry: timestamp, type, actor, detail.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEntry {
    #[serde(rename = "type", default)]
    event_type: String,
    #[serde(rename = "agentId", default)]
    agent_id: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ActivityResponse {
    #[serde(default)]
    entries: Vec<ActivityEntry>,
}

fn tone_for_type(t: &str) -> Tone {
    match t {
        s if s.contains("error") || s.contains("fail") || s.contains("reject") => Tone::Gated,
        s if s.contains("done") || s.contains("complete") || s.contains("success") || s.contains("land") => Tone::Landed,
        s if s.contains("begin") || s.contains("spawn") || s.contains("start") || s.contains("claim") => Tone::Engaged,
        _ => Tone::Default,
    }
}

fn ts_short(ts: Option<&str>) -> String {
    match ts {
        Some(s) if s.len() >= 19 => s[11..19].to_string(), // HH:MM:SS
        Some(s) => s.to_string(),
        None => "—".into(),
    }
}

pub struct ActivityPane {
    entries: Vec<ActivityEntry>,
    last_error: Option<String>,
}

impl Default for ActivityPane {
    fn default() -> Self {
        Self { entries: Vec::new(), last_error: None }
    }
}

impl ActivityPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for ActivityPane {
    fn id(&self) -> &str { "activity" }
    fn title(&self) -> String { "Activity".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Activity Feed".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.entries.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no recent activity".into()));
        } else {
            for e in self.entries.iter().rev().take(30) {
                let ts = ts_short(e.created_at.as_deref());
                let actor = e.agent_id.as_deref()
                    .map(|a| if a.len() > 12 { &a[..12] } else { a })
                    .unwrap_or("-");
                let target = e.target.as_deref()
                    .map(|t| if t.len() > 16 { &t[..16] } else { t })
                    .unwrap_or("");
                let detail = e.detail.as_deref().unwrap_or("");
                let detail_trunc = if detail.len() > 30 { &detail[..30] } else { detail };

                let tone = tone_for_type(&e.event_type);
                let label = if detail_trunc.is_empty() {
                    format!("{ts}  {actor}  {}", e.event_type)
                } else {
                    format!("{ts}  {actor}  {}  {detail_trunc}", e.event_type)
                };
                if !target.is_empty() {
                    blocks.push(Block::Row(vec![
                        ts.clone(),
                        e.event_type[..e.event_type.len().min(20)].to_string(),
                        actor.to_string(),
                        target.to_string(),
                    ]));
                } else {
                    blocks.push(Block::Chip { label, tone });
                }
            }
        }

        blocks.push(Block::KeyVal("events shown".into(), self.entries.len().min(30).to_string()));
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/activity?limit=40", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.entries.clear();
                }
                Ok(resp) => {
                    match resp.json::<ActivityResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.entries = data.entries;
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
        let p = ActivityPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Activity Feed"));
    }

    #[test]
    fn tone_classification() {
        assert!(matches!(tone_for_type("session_done"), Tone::Landed));
        assert!(matches!(tone_for_type("claim_error"), Tone::Gated));
        assert!(matches!(tone_for_type("session_begin"), Tone::Engaged));
    }

    #[test]
    fn ts_short_extracts_time() {
        assert_eq!(ts_short(Some("2026-06-10T14:32:01Z")), "14:32:01");
        assert_eq!(ts_short(None), "—");
    }
}
