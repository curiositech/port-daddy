//! Dispatch-queue control pane — the operator's view of sorties awaiting review.
//!
//! On `:dispatch` the pane refreshes against the daemon and emits render-agnostic
//! `Block`s:  Header → KeyVal(pending count) → one Row per dispatch → Chip(summary).
//!
//! Fail-closed: when the daemon is unreachable the pane renders a `Header`
//! followed by a `Block::KeyVal("error", <message>)` (two blocks) and does NOT
//! panic.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;

/// Byte offset of the `n`-th character boundary, or `None` if the string has
/// `n` or fewer characters (render it whole). The returned index always falls
/// on a UTF-8 boundary, so slicing `&s[..end]` never panics.
fn char_boundary(s: &str, n: usize) -> Option<usize> {
    s.char_indices().nth(n).map(|(i, _)| i)
}

/// Truncate to at most `n` characters (never a byte index — `&s[..n]` panics
/// mid-codepoint). Returns the whole string when it is `n` chars or shorter.
fn truncate_chars(s: &str, n: usize) -> String {
    match char_boundary(s, n) {
        Some(end) => s[..end].to_string(),
        None => s.to_string(),
    }
}

/// One dispatch entry as returned by `GET /dispatches?state=review_pending`.
///
/// Tolerant `from_value` extraction, never strict serde — the daemon sends
/// epoch-ms numbers and nulls (`createdAt: 1781133247168`), which a strict
/// struct turns into a whole-response decode failure ("bad response: error
/// decoding response body").
#[derive(Debug, Clone)]
struct DispatchEntry {
    id: String,
    goal: String,
    state: String,
    #[allow(dead_code)]
    budget_usd: Option<f64>,
    cost_usd: Option<f64>,
    #[allow(dead_code)]
    created_at: Option<u64>,
}

impl DispatchEntry {
    /// Tolerant extraction from one daemon JSON object. Only `id` is required.
    fn from_value(v: &serde_json::Value) -> Option<Self> {
        let id = v.get("id")?.as_str()?.to_string();
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let f = |k: &str| v.get(k).and_then(|x| x.as_f64());
        Some(Self {
            id,
            goal: s("goal").unwrap_or_default(),
            state: s("state").or_else(|| s("status")).unwrap_or_else(|| "unknown".into()),
            budget_usd: f("budgetUsd").or_else(|| f("budget_usd")),
            cost_usd: f("costUsd").or_else(|| f("cost_usd")),
            created_at: v
                .get("createdAt")
                .or_else(|| v.get("created_at"))
                .and_then(|x| x.as_u64().or_else(|| x.as_f64().map(|n| n as u64))),
        })
    }
}

/// Pure decode of a `GET /dispatches` body: `{ok, dispatches: […], count}`.
/// Count falls back to the parsed length when absent.
fn parse_dispatches(v: &serde_json::Value) -> (Vec<DispatchEntry>, u32) {
    let entries: Vec<DispatchEntry> = v
        .get("dispatches")
        .and_then(|d| d.as_array())
        .map(|arr| arr.iter().filter_map(DispatchEntry::from_value).collect())
        .unwrap_or_default();
    let count = v
        .get("count")
        .and_then(|c| c.as_u64())
        .map(|c| c as u32)
        .unwrap_or(entries.len() as u32);
    (entries, count)
}

/// The head-of-queue dispatch the operator reviews next, surfaced to the GPUI
/// view so it can render an interactive review gate (Approve / Reject / Cancel)
/// with the agent's intention + stop-conditions legible (human-gate-designer).
#[derive(Debug, Clone)]
pub struct DispatchHead {
    pub id: String,
    pub goal: String,
    pub state: String,
    pub budget_usd: Option<f64>,
    pub cost_usd: Option<f64>,
    /// Total dispatches awaiting review (the queue depth behind this head).
    pub count: u32,
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

    /// The oldest dispatch awaiting review — what the operator gate acts on next.
    pub fn head(&self) -> Option<DispatchHead> {
        self.dispatches.first().map(|d| DispatchHead {
            id: d.id.clone(),
            goal: d.goal.clone(),
            state: d.state.clone(),
            budget_usd: d.budget_usd,
            cost_usd: d.cost_usd,
            count: self.count,
        })
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
                // Truncate by CHARACTER, never byte index: `&s[..n]` panics when
                // n lands inside a multi-byte UTF-8 codepoint (goals are arbitrary
                // user text). char_indices gives a safe boundary.
                let id_short = truncate_chars(&d.id, 8);
                let goal_trunc = match char_boundary(&d.goal, 50) {
                    Some(end) => format!("{}…", &d.goal[..end]),
                    None => d.goal.clone(),
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
                    let status = resp.status();
                    if !status.is_success() {
                        self.last_error = Some(format!(
                            "GET /dispatches → {status} (daemon may predate this route)"
                        ));
                        self.dispatches.clear();
                        self.count = 0;
                        return Ok(());
                    }
                    match resp.json::<serde_json::Value>().await {
                        Err(e) => {
                            self.last_error = Some(format!("bad response: {e}"));
                        }
                        Ok(v) => {
                            self.last_error = None;
                            let (dispatches, count) = parse_dispatches(&v);
                            self.dispatches = dispatches;
                            self.count = count;
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
    fn truncation_is_utf8_safe_on_multibyte_goals() {
        // 'é' is 2 bytes: a naive `&s[..50]` byte slice would land mid-codepoint
        // and panic. char-based truncation must not.
        let multibyte = "é".repeat(40); // 40 chars, 80 bytes
        assert_eq!(truncate_chars(&multibyte, 8).chars().count(), 8);
        // The returned boundary is always sliceable without panic.
        if let Some(end) = char_boundary(&multibyte, 50) {
            let _ = &multibyte[..end];
        }
        // Mixed-width content (CJK = 3 bytes) around the boundary, via view().
        let goal = "日本語".repeat(30); // 90 chars, 270 bytes
        let entry = DispatchEntry {
            id: "日本語日本語".to_string(),
            goal,
            state: "review_pending".into(),
            budget_usd: None,
            cost_usd: None,
            created_at: Some(1),
        };
        let pane = make_pane(vec![entry], 1);
        let _ = pane.view(); // must not panic
    }

    #[test]
    fn truncate_chars_returns_short_strings_whole() {
        assert_eq!(truncate_chars("hi", 8), "hi");
        assert_eq!(char_boundary("hi", 8), None);
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
            created_at: Some(1781133247168),
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

    /// Regression: real `routes/dispatches.ts` entities carry epoch-ms
    /// `createdAt` numbers and nulls — the old strict struct (created_at as
    /// String) failed the whole-response decode.
    #[test]
    fn parse_dispatches_real_shape() {
        let body = serde_json::json!({
            "ok": true,
            "count": 2,
            "dispatches": [
                {"id": "d1", "goal": "ship it", "state": "review_pending",
                 "requestedBy": "operator", "budgetUsd": 2.5, "costUsd": null,
                 "createdAt": 1781133247168u64},
                {"id": "d2", "goal": "fix it", "state": "review_pending",
                 "budgetUsd": null, "costUsd": 0.12, "createdAt": 1781133250000u64}
            ]
        });
        let (entries, count) = parse_dispatches(&body);
        assert_eq!(count, 2);
        assert_eq!(entries.len(), 2, "epoch-ms/null rows must not be dropped");
        assert_eq!(entries[0].cost_usd, None);
        assert_eq!(entries[1].cost_usd, Some(0.12));
        assert_eq!(entries[0].created_at, Some(1781133247168));
    }

    /// Missing `count` falls back to parsed length; missing array → empty.
    #[test]
    fn parse_dispatches_missing_fields() {
        let (entries, count) =
            parse_dispatches(&serde_json::json!({"dispatches": [{"id": "x"}]}));
        assert_eq!((entries.len(), count), (1, 1));
        let (entries, count) = parse_dispatches(&serde_json::json!({"ok": true}));
        assert_eq!((entries.len(), count), (0, 0));
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
