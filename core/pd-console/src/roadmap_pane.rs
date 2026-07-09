//! Roadmap pane — the Port Daddy roadmap as live blocks.
//!
//! Calls `GET /roadmap/items?limit=60`. Real shape (v3.18):
//! `{ items: [{ id, slug, summaryMd, status, harbor, lastTouchedAt, ... }] }`
//! status values seen: "now", "next", "later", "done", "rejected".

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct RoadmapItem {
    slug: String,
    summary: String,
    status: String,
}

impl RoadmapItem {
    fn from_value(v: &Value) -> Self {
        Self {
            slug: s(v, "slug"),
            summary: s(v, "summaryMd"),
            status: s(v, "status"),
        }
    }
}

fn status_tone(st: &str) -> Tone {
    match st {
        "done" | "complete" | "shipped" | "landed" => Tone::Landed,
        "now" | "in-progress" | "active" => Tone::Engaged,
        "blocked" | "rejected" | "deferred" => Tone::Gated,
        _ => Tone::Resting,
    }
}

/// Display order for status groups.
const STATUS_ORDER: &[&str] = &["now", "next", "later", "done", "rejected"];

pub struct RoadmapPane {
    items: Vec<RoadmapItem>,
    last_error: Option<String>,
}

impl Default for RoadmapPane {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            last_error: None,
        }
    }
}

impl RoadmapPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for RoadmapPane {
    fn id(&self) -> &str {
        "roadmap"
    }
    fn title(&self) -> String {
        "Roadmap".into()
    }

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

        let count_for = |st: &str| self.items.iter().filter(|i| i.status == st).count();
        blocks.push(Block::KeyVal("total".into(), self.items.len().to_string()));
        blocks.push(Block::KeyVal("now".into(), count_for("now").to_string()));
        blocks.push(Block::KeyVal("done".into(), count_for("done").to_string()));
        blocks.push(Block::Gap);

        // Known statuses in priority order, then anything else.
        let mut shown = 0usize;
        for st in STATUS_ORDER {
            let group: Vec<_> = self.items.iter().filter(|i| i.status == *st).collect();
            if group.is_empty() {
                continue;
            }
            blocks.push(Block::Header(st.to_string()));
            for item in group {
                let first_line = item.summary.lines().next().unwrap_or("");
                blocks.push(Block::Row(vec![
                    trunc(&item.slug, 32),
                    trunc(first_line, 52),
                ]));
                shown += 1;
            }
            blocks.push(Block::Gap);
        }
        let other: Vec<_> = self
            .items
            .iter()
            .filter(|i| !STATUS_ORDER.contains(&i.status.as_str()))
            .collect();
        if !other.is_empty() {
            blocks.push(Block::Header("other".into()));
            for item in other {
                blocks.push(Block::Row(vec![trunc(&item.slug, 32), item.status.clone()]));
                shown += 1;
            }
            blocks.push(Block::Gap);
        }
        let _ = shown;

        let now_n = count_for("now");
        blocks.push(Block::Chip {
            label: format!(
                "{} now · {}/{} done",
                now_n,
                count_for("done"),
                self.items.len()
            ),
            tone: if now_n > 0 {
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
            let url = format!("{}/roadmap/items?limit=60", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.items.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.items = arr(&data, "items")
                            .iter()
                            .map(RoadmapItem::from_value)
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
            "id": "d0553267", "slug": "mcp-parity-no-copouts",
            "summaryMd": "Agents are first-class MCP consumers.\nMore detail.",
            "status": "now", "harbor": null
        });
        let item = RoadmapItem::from_value(&v);
        assert_eq!(item.slug, "mcp-parity-no-copouts");
        assert_eq!(item.status, "now");
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
        assert!(matches!(status_tone("now"), Tone::Engaged));
        assert!(matches!(status_tone("rejected"), Tone::Gated));
        assert!(matches!(status_tone("later"), Tone::Resting));
    }

    #[test]
    fn view_groups_by_status() {
        let mut p = RoadmapPane::default();
        p.items = vec![
            RoadmapItem {
                slug: "thing-a".into(),
                summary: "Build A".into(),
                status: "now".into(),
            },
            RoadmapItem {
                slug: "thing-b".into(),
                summary: "Build B".into(),
                status: "later".into(),
            },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }
}
