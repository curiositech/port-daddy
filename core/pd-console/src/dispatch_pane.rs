//! Dispatch-queue control pane — the operator's view of sorties awaiting review.
//!
//! On `:dispatch` the pane refreshes against the daemon and emits render-agnostic
//! `Block`s:  Header → KeyVal(pending count) → one Row per dispatch → Chip(summary).
//!
//! Fail-closed: when the daemon is unreachable the pane renders a single
//! `Block::KeyVal("error", <message>)` and does NOT panic.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

/// One dispatch entry as returned by `GET /dispatches?state=review_pending`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DispatchEntry {
    id: String,
    goal: String,
    state: String,
    budget_usd: Option<f64>,
    cost_usd: Option<f64>,
    created_at: Option<String>,
}

/// The daemon response shape for the dispatches list endpoint.
#[derive(Debug, Deserialize)]
struct DispatchesResponse {
    #[allow(dead_code)]
    ok: bool,
    dispatches: Vec<DispatchEntry>,
    count: u32,
}

/// Pane that shows the dispatch queue (sorties in `review_pending` state).
pub struct DispatchQueuePane {
    /// Current snapshot from the daemon (empty until first refresh).
    dispatches: Vec<DispatchEntry>,
    /// Total count as reported by the daemon.
    count: u32,
    /// Last error, if the daemon was unreachable on the most recent refresh.
    last_error: Option<String>,
}

impl Default for DispatchQueuePane {
    fn default() -> Self {
        Self { dispatches: Vec::new(), count: 0, last_error: None }
    }
}

impl DispatchQueuePane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for DispatchQueuePane {
    fn id(&self) -> &str {
        "dispatch"
    }

    fn title(&self) -> String {
        "Dispatch Queue".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks: Vec<Block> = Vec::new();
        blocks.push(Block::Header("Dispatch Queue".into()));

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        blocks.push(Block::KeyVal("pending review".into(), self.count.to_string()));

        if self.dispatches.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no dispatches awaiting review".into()));
        } else {
            for d in &self.dispatches {
                let id_short = if d.id.len() > 8 { d.id[..8].to_string() } else { d.id.clone() };
                let goal_trunc = if d.goal.len() > 50 {
                    format!("{}…", &d.goal[..50])
                } else {
                    d.goal.clone()
                };
                let cost_str = match d.cost_usd {
                    Some(c) => format!("${:.4}", c),
                    None => "-".into(),
                };
                blocks.push(Block::Row(vec![
                    id_short,
                    goal_trunc,
                    d.state.clone(),
                    cost_str,
                ]));
            }
        }

        let chip_label = format!("{} awaiting review", self.count);
        let chip_tone = if self.count == 0 { Tone::Resting } else { Tone::Engaged };
        blocks.push(Block::Chip { label: chip_label, tone: chip_tone });

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/dispatches?state=review_pending&limit=50", daemon.base());
            let result = daemon
                .http_client()
                .get(&url)
                .send()
                .await;

            match result {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.dispatches.clear();
                    self.count = 0;
                }
                Ok(resp) => {
                    match resp.json::<DispatchesResponse>().await {
                        Err(e) => {
                            self.last_error = Some(format!("bad response: {e}"));
                        }
                        Ok(data) => {
                            self.last_error = None;
                            self.count = data.count;
                            self.dispatches = data.dispatches;
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

    /// Helper: build a DispatchQueuePane with pre-loaded data (no daemon needed).
    fn make_pane(dispatches: Vec<DispatchEntry>, count: u32) -> DispatchQueuePane {
        DispatchQueuePane { dispatches, count, last_error: None }
    }

    #[test]
    fn view_empty_queue() {
        let pane = make_pane(vec![], 0);
        let blocks = pane.view();
        // Must have Header + KeyVal(pending=0) + status KeyVal + Chip
        assert!(blocks.len() >= 3, "need at least 3 blocks for empty queue, got {}", blocks.len());
        match &blocks[0] {
            Block::Header(h) => assert_eq!(h, "Dispatch Queue"),
            _ => panic!("first block must be Header"),
        }
        // The chip must say "0 awaiting review"
        let chip = blocks.last().expect("chip");
        match chip {
            Block::Chip { label, .. } => assert!(
                label.contains("0 awaiting review"),
                "chip label should contain count: {label}"
            ),
            _ => panic!("last block must be Chip, got {chip:?}"),
        }
    }

    #[test]
    fn view_populated_queue() {
        let entry = DispatchEntry {
            id: "abc12345xyz".into(),
            goal: "Refactor the authentication module to use JWT tokens and add refresh logic"
                .into(),
            state: "review_pending".into(),
            budget_usd: Some(1.0),
            cost_usd: Some(0.3456),
            created_at: Some("2026-06-10T00:00:00Z".into()),
        };
        let pane = make_pane(vec![entry], 1);
        let blocks = pane.view();

        // Header present
        match &blocks[0] {
            Block::Header(h) => assert_eq!(h, "Dispatch Queue"),
            _ => panic!("expected Header"),
        }
        // KeyVal(pending review, 1) present
        match &blocks[1] {
            Block::KeyVal(k, v) => {
                assert_eq!(k, "pending review");
                assert_eq!(v, "1");
            }
            _ => panic!("expected KeyVal for pending count"),
        }
        // Row for the dispatch
        let row = blocks.iter().find(|b| matches!(b, Block::Row(_)));
        assert!(row.is_some(), "expected at least one Row block");
        if let Some(Block::Row(cells)) = row {
            // id_short ≤ 8 chars
            assert!(cells[0].len() <= 8, "id_short too long: {}", cells[0]);
            // goal truncated to ≤51 (50 + ellipsis char)
            assert!(cells[1].chars().count() <= 51, "goal too long: {}", cells[1]);
            // state is as provided
            assert_eq!(cells[2], "review_pending");
            // cost formatted
            assert!(cells[3].starts_with('$'), "cost format: {}", cells[3]);
        }
        // Chip says "1 awaiting review"
        let chip = blocks.last().expect("chip");
        match chip {
            Block::Chip { label, .. } => {
                assert!(label.contains("1 awaiting review"), "label: {label}");
            }
            _ => panic!("last block must be Chip"),
        }
    }

    #[test]
    fn view_error_state() {
        let mut pane = DispatchQueuePane::default();
        pane.last_error = Some("connection refused".into());
        let blocks = pane.view();
        // Header then error KeyVal, nothing else
        assert_eq!(blocks.len(), 2);
        match &blocks[1] {
            Block::KeyVal(k, v) => {
                assert_eq!(k, "error");
                assert!(v.contains("connection refused"), "v: {v}");
            }
            _ => panic!("expected error KeyVal, got {:?}", blocks[1]),
        }
    }
}
