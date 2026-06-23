//! PRs pane — open pull requests relevant to active sessions.
//!
//! Calls `GET /prs?limit=20` on the daemon.
//! Shows: PR number, title, status, author, CI state.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrEntry {
    #[serde(default)]
    number: u32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    ci_status: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PrsResponse {
    #[serde(default)]
    prs: Vec<PrEntry>,
}

fn pr_tone(state: &str, ci: Option<&str>) -> Tone {
    match (state, ci) {
        ("merged", _) => Tone::Landed,
        ("closed", _) => Tone::Resting,
        (_, Some("failure") | Some("error")) => Tone::Gated,
        (_, Some("success")) => Tone::Landed,
        ("open", _) => Tone::Engaged,
        _ => Tone::Default,
    }
}

pub struct PrsPane {
    prs: Vec<PrEntry>,
    last_error: Option<String>,
}

impl Default for PrsPane {
    fn default() -> Self { Self { prs: Vec::new(), last_error: None } }
}

impl PrsPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for PrsPane {
    fn id(&self) -> &str { "prs" }
    fn title(&self) -> String { "PRs".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Pull Requests".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("note".into(), "GET /prs not yet available".into()));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.prs.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no open PRs".into()));
            return blocks;
        }

        let open = self.prs.iter().filter(|p| p.state == "open").count();
        blocks.push(Block::KeyVal("total".into(), self.prs.len().to_string()));
        blocks.push(Block::KeyVal("open".into(), open.to_string()));
        blocks.push(Block::Gap);

        for pr in &self.prs {
            let title = if pr.title.len() > 55 {
                format!("{}…", &pr.title[..55])
            } else {
                pr.title.clone()
            };
            let author = pr.author.as_deref().unwrap_or("—");
            let ci = pr.ci_status.as_deref().unwrap_or("—");
            let tone = pr_tone(&pr.state, pr.ci_status.as_deref());
            blocks.push(Block::Row(vec![
                format!("#{}", pr.number),
                title,
                pr.state.clone(),
                ci.to_string(),
            ]));
            let _ = (author, tone);
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/prs?limit=20", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.prs.clear();
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.prs.clear();
                }
                Ok(resp) => {
                    match resp.json::<PrsResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.prs = data.prs;
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
        let p = PrsPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Pull Requests")));
    }

    #[test]
    fn pr_tones() {
        assert!(matches!(pr_tone("merged", None), Tone::Landed));
        assert!(matches!(pr_tone("open", Some("failure")), Tone::Gated));
        assert!(matches!(pr_tone("open", Some("success")), Tone::Landed));
        assert!(matches!(pr_tone("open", None), Tone::Engaged));
    }

    #[test]
    fn view_prs() {
        let mut p = PrsPane::default();
        p.prs = vec![
            PrEntry { number: 318, title: "feat: GPUI console shell".into(), state: "open".into(), author: Some("agent-1".into()), ci_status: Some("success".into()), url: None },
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 1);
    }
}
