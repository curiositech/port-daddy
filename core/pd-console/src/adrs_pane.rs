//! ADRs pane — Architecture Decision Records index from the daemon.
//!
//! Calls `GET /adrs?limit=40` on the daemon.

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
struct AdrsResponse {
    #[serde(default)]
    adrs: Vec<AdrEntry>,
}

fn adr_tone(status: &str) -> Tone {
    match status {
        "accepted" | "supersedes" => Tone::Landed,
        "proposed" | "draft" => Tone::Engaged,
        "rejected" | "deprecated" => Tone::Gated,
        _ => Tone::Resting,
    }
}

pub struct AdrsPane {
    adrs: Vec<AdrEntry>,
    last_error: Option<String>,
}

impl Default for AdrsPane {
    fn default() -> Self { Self { adrs: Vec::new(), last_error: None } }
}

impl AdrsPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for AdrsPane {
    fn id(&self) -> &str { "adrs" }
    fn title(&self) -> String { "ADRs".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Architecture Decision Records".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("note".into(), "GET /adrs not yet available".into()));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.adrs.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no ADRs — or endpoint not available".into()));
            return blocks;
        }

        let accepted = self.adrs.iter().filter(|a| a.status == "accepted").count();
        let proposed = self.adrs.iter().filter(|a| a.status == "proposed" || a.status == "draft").count();
        blocks.push(Block::KeyVal("total".into(), self.adrs.len().to_string()));
        blocks.push(Block::KeyVal("accepted".into(), accepted.to_string()));
        blocks.push(Block::KeyVal("proposed".into(), proposed.to_string()));
        blocks.push(Block::Gap);

        for adr in &self.adrs {
            let title = if adr.title.len() > 55 {
                format!("{}…", &adr.title[..55])
            } else {
                adr.title.clone()
            };
            let date = adr.date.as_deref().and_then(|d| if d.len() >= 10 { Some(&d[..10]) } else { Some(d) }).unwrap_or("—");
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
            let url = format!("{}/adrs?limit=40", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.adrs.clear();
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.adrs.clear();
                }
                Ok(resp) => {
                    match resp.json::<AdrsResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.adrs = data.adrs;
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
        let p = AdrsPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Architecture")));
    }

    #[test]
    fn adr_tones() {
        assert!(matches!(adr_tone("accepted"), Tone::Landed));
        assert!(matches!(adr_tone("proposed"), Tone::Engaged));
        assert!(matches!(adr_tone("rejected"), Tone::Gated));
        assert!(matches!(adr_tone("superseded"), Tone::Resting));
    }

    #[test]
    fn view_adrs() {
        let mut p = AdrsPane::default();
        p.adrs = vec![
            AdrEntry { number: 46, title: "GPUI console shell".into(), status: "accepted".into(), date: Some("2026-06-01".into()) },
            AdrEntry { number: 50, title: "Compulsion rent mechanism".into(), status: "accepted".into(), date: None },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }
}
