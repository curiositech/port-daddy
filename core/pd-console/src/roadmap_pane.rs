//! Roadmap pane — the Port Daddy roadmap as live blocks.
//!
//! Calls `GET /roadmap/items?limit=60` on the daemon.
//! Shows items grouped by phase, with status chips.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoadmapItem {
    id: String,
    title: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    phase: Option<String>,
    #[serde(default)]
    priority: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoadmapResponse {
    #[serde(default)]
    items: Vec<RoadmapItem>,
}

fn status_tone(s: &str) -> Tone {
    match s {
        "done" | "complete" | "shipped" | "landed" => Tone::Landed,
        "in-progress" | "active" | "now" => Tone::Engaged,
        "blocked" | "deferred" | "rejected" => Tone::Gated,
        _ => Tone::Resting,
    }
}

pub struct RoadmapPane {
    items: Vec<RoadmapItem>,
    last_error: Option<String>,
}

impl Default for RoadmapPane {
    fn default() -> Self { Self { items: Vec::new(), last_error: None } }
}

impl RoadmapPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for RoadmapPane {
    fn id(&self) -> &str { "roadmap" }
    fn title(&self) -> String { "Roadmap".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Roadmap".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.items.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no roadmap items".into()));
            return blocks;
        }

        // Count by status
        let done = self.items.iter().filter(|i| matches!(i.status.as_str(), "done" | "complete" | "shipped" | "landed")).count();
        let active = self.items.iter().filter(|i| matches!(i.status.as_str(), "in-progress" | "active" | "now")).count();
        let total = self.items.len();
        blocks.push(Block::KeyVal("total".into(), total.to_string()));
        blocks.push(Block::KeyVal("active".into(), active.to_string()));
        blocks.push(Block::KeyVal("done".into(), done.to_string()));
        blocks.push(Block::Gap);

        // Group by phase
        let mut phases: Vec<String> = self.items.iter()
            .filter_map(|i| i.phase.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        if phases.is_empty() {
            phases.push(String::new());
        }

        for phase in &phases {
            let phase_items: Vec<_> = self.items.iter()
                .filter(|i| i.phase.as_deref().unwrap_or("") == phase.as_str())
                .collect();
            if !phase.is_empty() {
                blocks.push(Block::Header(phase.clone()));
            }
            for item in phase_items {
                let title = if item.title.len() > 50 {
                    format!("{}…", &item.title[..50])
                } else {
                    item.title.clone()
                };
                let status = if item.status.is_empty() { "pending" } else { &item.status };
                let id_short = &item.id[..item.id.len().min(8)];
                blocks.push(Block::Row(vec![
                    id_short.to_string(),
                    title,
                    status.to_string(),
                ]));
            }
            blocks.push(Block::Gap);
        }

        let active_tone = if active > 0 { Tone::Engaged } else { Tone::Resting };
        blocks.push(Block::Chip {
            label: format!("{active} active · {done}/{total} done"),
            tone: active_tone,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/roadmap/items?limit=60", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.items.clear();
                }
                Ok(resp) => {
                    match resp.json::<RoadmapResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.items = data.items;
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

    fn make_item(id: &str, title: &str, status: &str, phase: Option<&str>) -> RoadmapItem {
        RoadmapItem { id: id.into(), title: title.into(), status: status.into(), phase: phase.map(String::from), priority: None }
    }

    #[test]
    fn view_empty() {
        let p = RoadmapPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Roadmap"));
    }

    #[test]
    fn status_tones() {
        assert!(matches!(status_tone("done"), Tone::Landed));
        assert!(matches!(status_tone("in-progress"), Tone::Engaged));
        assert!(matches!(status_tone("blocked"), Tone::Gated));
        assert!(matches!(status_tone("pending"), Tone::Resting));
    }

    #[test]
    fn view_items() {
        let mut p = RoadmapPane::default();
        p.items = vec![
            make_item("abc", "Build the thing", "in-progress", Some("Phase 1")),
            make_item("def", "Ship the thing", "pending", Some("Phase 2")),
        ];
        let b = p.view();
        let has_row = b.iter().any(|blk| matches!(blk, Block::Row(_)));
        assert!(has_row);
    }
}
