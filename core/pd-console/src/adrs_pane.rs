//! ADRs pane — Architecture Decision Records derived from daemon roadmap items.
//!
//! Calls `GET /roadmap/items?status=all&limit=2000` on the daemon and filters
//! ADR-like slugs until a dedicated ADR route exists.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdrEntry {
    #[serde(default)]
    number: u32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoadmapItemsResponse {
    #[serde(default)]
    items: Vec<RoadmapItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoadmapItem {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    summary_md: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    last_touched_at: Option<String>,
}

fn adr_tone(status: &str) -> Tone {
    match status {
        "accepted" | "supersedes" | "done" => Tone::Landed,
        "proposed" | "draft" | "now" | "next" => Tone::Engaged,
        "rejected" | "deprecated" => Tone::Gated,
        _ => Tone::Resting,
    }
}

fn adr_number_from_slug(slug: &str) -> Option<u32> {
    let lower = slug.to_lowercase();
    let rest = lower.strip_prefix("adr-")?;
    rest.chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}

fn adr_from_roadmap_item(item: RoadmapItem) -> Option<AdrEntry> {
    let number = adr_number_from_slug(&item.slug)?;
    Some(AdrEntry {
        number,
        title: item
            .title
            .or(item.summary_md)
            .unwrap_or_else(|| format!("ADR-{:04}", number)),
        status: item.status,
        date: item.last_touched_at,
    })
}

pub struct AdrsPane {
    adrs: Vec<AdrEntry>,
    last_error: Option<String>,
}

impl Default for AdrsPane {
    fn default() -> Self {
        Self {
            adrs: Vec::new(),
            last_error: None,
        }
    }
}

impl AdrsPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for AdrsPane {
    fn id(&self) -> &str {
        "adrs"
    }
    fn title(&self) -> String {
        "ADRs".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Architecture Decision Records".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal(
                "note".into(),
                "GET /roadmap/items failed".into(),
            ));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.adrs.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no ADR-like roadmap items found".into(),
            ));
            return blocks;
        }

        let landed = self
            .adrs
            .iter()
            .filter(|a| matches!(a.status.as_str(), "accepted" | "done"))
            .count();
        let active = self
            .adrs
            .iter()
            .filter(|a| matches!(a.status.as_str(), "proposed" | "draft" | "now" | "next"))
            .count();
        blocks.push(Block::KeyVal("total".into(), self.adrs.len().to_string()));
        blocks.push(Block::KeyVal("landed".into(), landed.to_string()));
        blocks.push(Block::KeyVal("active".into(), active.to_string()));
        blocks.push(Block::Gap);

        for adr in &self.adrs {
            let title = if adr.title.len() > 55 {
                format!("{}…", &adr.title[..55])
            } else {
                adr.title.clone()
            };
            let date = adr
                .date
                .as_deref()
                .and_then(|d| {
                    if d.len() >= 10 {
                        Some(&d[..10])
                    } else {
                        Some(d)
                    }
                })
                .unwrap_or("—");
            let tone = adr_tone(&adr.status);
            blocks.push(Block::Row(vec![
                format!("ADR-{:04}", adr.number),
                title,
                adr.status.clone(),
                date.to_string(),
            ]));
            let _ = tone;
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/roadmap/items?status=all&limit=2000", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.adrs.clear();
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.adrs.clear();
                }
                Ok(resp) => match resp.json::<RoadmapItemsResponse>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.adrs = data
                            .items
                            .into_iter()
                            .filter_map(adr_from_roadmap_item)
                            .collect();
                        self.adrs.sort_by_key(|adr| adr.number);
                        self.adrs.truncate(40);
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
    fn view_empty() {
        let p = AdrsPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Architecture")));
    }

    #[test]
    fn adr_tones() {
        assert!(matches!(adr_tone("accepted"), Tone::Landed));
        assert!(matches!(adr_tone("done"), Tone::Landed));
        assert!(matches!(adr_tone("proposed"), Tone::Engaged));
        assert!(matches!(adr_tone("now"), Tone::Engaged));
        assert!(matches!(adr_tone("rejected"), Tone::Gated));
        assert!(matches!(adr_tone("superseded"), Tone::Resting));
    }

    #[test]
    fn parses_adr_numbers_from_roadmap_slugs() {
        assert_eq!(
            adr_number_from_slug("adr-0054-rust-surface-alignment"),
            Some(54)
        );
        assert_eq!(adr_number_from_slug("roadmap-item"), None);
    }

    #[test]
    fn view_adrs() {
        let mut p = AdrsPane::default();
        p.adrs = vec![
            AdrEntry {
                number: 46,
                title: "GPUI console shell".into(),
                status: "accepted".into(),
                date: Some("2026-06-01".into()),
            },
            AdrEntry {
                number: 50,
                title: "Compulsion rent mechanism".into(),
                status: "accepted".into(),
                date: None,
            },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }
}
