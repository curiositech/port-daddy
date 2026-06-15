//! Peek pane — context snapshot: active git branch, recent commits, dirty files.
//!
//! Calls `GET /peek` on the daemon (returns worktree + git context for active session).

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct PeekResponse {
    #[serde(default)]
    branch: String,
    #[serde(default)]
    worktree: Option<String>,
    #[serde(default)]
    dirty_files: u32,
    #[serde(default)]
    ahead: u32,
    #[serde(default)]
    behind: u32,
    #[serde(default)]
    recent_commits: Vec<String>,
}

pub struct PeekPane {
    data: Option<PeekResponse>,
    last_error: Option<String>,
}

impl Default for PeekPane {
    fn default() -> Self { Self { data: None, last_error: None } }
}

impl PeekPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for PeekPane {
    fn id(&self) -> &str { "peek" }
    fn title(&self) -> String { "Peek".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Peek — Git Context".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("note".into(), "GET /peek not yet available".into()));
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let Some(d) = &self.data else {
            blocks.push(Block::KeyVal("status".into(), "connecting…".into()));
            return blocks;
        };

        blocks.push(Block::KeyVal("branch".into(), d.branch.clone()));
        if let Some(wt) = &d.worktree {
            blocks.push(Block::KeyVal("worktree".into(), wt.clone()));
        }
        blocks.push(Block::KeyVal("dirty files".into(), d.dirty_files.to_string()));
        if d.ahead > 0 || d.behind > 0 {
            blocks.push(Block::KeyVal("ahead".into(), d.ahead.to_string()));
            blocks.push(Block::KeyVal("behind".into(), d.behind.to_string()));
        }

        if !d.recent_commits.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Recent Commits".into()));
            for c in d.recent_commits.iter().take(5) {
                let trunc = if c.len() > 72 { format!("{}…", &c[..72]) } else { c.clone() };
                blocks.push(Block::KeyVal("·".into(), trunc));
            }
        }

        let tone = if d.dirty_files > 0 { Tone::Engaged } else { Tone::Landed };
        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!("{} dirty  ↑{}  ↓{}", d.dirty_files, d.ahead, d.behind),
            tone,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/peek", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.data = None;
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.last_error = Some(format!("HTTP {}", resp.status()));
                    self.data = None;
                }
                Ok(resp) => {
                    match resp.json::<PeekResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.data = Some(data);
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
    fn view_no_data() {
        let p = PeekPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Peek")));
    }

    #[test]
    fn view_error_shows_note() {
        let mut p = PeekPane::default();
        p.last_error = Some("404 Not Found".into());
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "note")));
    }
}
