//! Dispatch run/recovery pane — live work, review gates, and recoverable output.
//!
//! On `:dispatch` the pane refreshes against the daemon and emits render-agnostic
//! `Block`s: Header → state counts → one Row per dispatch → Chip(summary).
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

/// One dispatch entry as returned by `GET /dispatches`.
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
    worktree_path: Option<String>,
    error_message: Option<String>,
    result_artifact: Option<String>,
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
            state: s("state")
                .or_else(|| s("status"))
                .unwrap_or_else(|| "unknown".into()),
            budget_usd: f("budgetUsd").or_else(|| f("budget_usd")),
            cost_usd: f("costUsd").or_else(|| f("cost_usd")),
            worktree_path: s("worktreePath").or_else(|| s("worktree_path")),
            error_message: s("errorMessage").or_else(|| s("error")),
            result_artifact: s("resultArtifact").or_else(|| s("result_artifact")),
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
#[derive(Debug, Clone, PartialEq)]
pub struct DispatchHead {
    pub id: String,
    pub goal: String,
    pub state: String,
    pub budget_usd: Option<f64>,
    pub cost_usd: Option<f64>,
    /// Total dispatches awaiting review (the queue depth behind this head).
    pub count: u32,
}

/// Pane that shows dispatches requiring operator awareness. Active, review,
/// failure, and salvage rows remain visible, followed by a bounded set of
/// recently settled rows with their durable artifact receipts.
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
        Self {
            dispatches: Vec::new(),
            count: 0,
            last_error: None,
        }
    }
}

impl DispatchQueuePane {
    pub fn new() -> Self {
        Self::default()
    }

    /// The oldest dispatch awaiting review — what the operator gate acts on next.
    pub fn head(&self) -> Option<DispatchHead> {
        self.dispatches
            .iter()
            .find(|dispatch| dispatch.state == "review_pending")
            .map(|d| DispatchHead {
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

        let active = self
            .dispatches
            .iter()
            .filter(|dispatch| {
                matches!(
                    dispatch.state.as_str(),
                    "proposed" | "claimed" | "in_progress" | "produced"
                )
            })
            .count();
        let recovery = self
            .dispatches
            .iter()
            .filter(|dispatch| matches!(dispatch.state.as_str(), "salvage" | "failed" | "rejected"))
            .count();
        let completed = self
            .dispatches
            .iter()
            .filter(|dispatch| dispatch.state == "settled")
            .count();
        blocks.push(Block::KeyVal("active".into(), active.to_string()));
        blocks.push(Block::KeyVal(
            "pending review".into(),
            self.count.to_string(),
        ));
        blocks.push(Block::KeyVal("recovery".into(), recovery.to_string()));
        blocks.push(Block::KeyVal(
            "recently completed".into(),
            completed.to_string(),
        ));

        if self.dispatches.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no active, gated, or recoverable dispatches".into(),
            ));
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
                if d.state == "salvage" {
                    blocks.push(Block::KeyVal(
                        format!("recover {}", truncate_chars(&d.id, 8)),
                        d.worktree_path
                            .clone()
                            .or_else(|| d.error_message.clone())
                            .unwrap_or_else(|| "inspect the durable transcript receipt".into()),
                    ));
                } else if d.state == "settled" {
                    blocks.push(Block::KeyVal(
                        format!("receipt {}", truncate_chars(&d.id, 8)),
                        d.result_artifact
                            .clone()
                            .unwrap_or_else(|| "artifact receipt missing".into()),
                    ));
                }
            }
        }

        let chip_label = format!(
            "{active} active · {} review · {recovery} recovery · {completed} complete",
            self.count
        );
        let chip_tone = if recovery > 0 {
            Tone::Gated
        } else if active > 0 || self.count > 0 {
            Tone::Engaged
        } else {
            Tone::Resting
        };
        blocks.push(Block::Chip {
            label: chip_label,
            tone: chip_tone,
        });

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/dispatches?limit=50", daemon.base());
            let result = daemon.http_client().get(&url).send().await;

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
                            let (dispatches, _) = parse_dispatches(&v);
                            let mut recent_settled = 0;
                            self.dispatches = dispatches
                                .into_iter()
                                .filter(|dispatch| {
                                    if dispatch.state != "settled" {
                                        return true;
                                    }
                                    recent_settled += 1;
                                    recent_settled <= 3
                                })
                                .collect();
                            self.count = self
                                .dispatches
                                .iter()
                                .filter(|dispatch| dispatch.state == "review_pending")
                                .count() as u32;
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
        DispatchQueuePane {
            dispatches,
            count,
            last_error: None,
        }
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
            worktree_path: None,
            error_message: None,
            result_artifact: None,
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
        // Header + state counters + status + summary chip remain legible even empty.
        assert!(blocks.len() >= 7, "empty queue blocks: {}", blocks.len());
        match &blocks[0] {
            Block::Header(h) => assert_eq!(h, "Dispatch Queue"),
            _ => panic!("first block must be Header"),
        }
        // The chip must report every state family honestly.
        let chip = blocks.last().expect("chip");
        match chip {
            Block::Chip { label, .. } => {
                assert_eq!(label, "0 active · 0 review · 0 recovery · 0 complete")
            }
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
            worktree_path: None,
            error_message: None,
            result_artifact: None,
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
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value) if key == "pending review" && value == "1"
        )));
        // Row for the dispatch
        let row = blocks.iter().find(|b| matches!(b, Block::Row(_)));
        assert!(row.is_some(), "expected at least one Row block");
        if let Some(Block::Row(cells)) = row {
            // id_short ≤ 8 chars
            assert!(cells[0].len() <= 8, "id_short too long: {}", cells[0]);
            // goal truncated to ≤51 (50 + ellipsis char)
            assert!(
                cells[1].chars().count() <= 51,
                "goal too long: {}",
                cells[1]
            );
            // state is as provided
            assert_eq!(cells[2], "review_pending");
            // cost formatted
            assert!(cells[3].starts_with('$'), "cost format: {}", cells[3]);
        }
        // Chip reports the review gate separately from live and recovery work.
        let chip = blocks.last().expect("chip");
        match chip {
            Block::Chip { label, .. } => {
                assert_eq!(label, "0 active · 1 review · 0 recovery · 0 complete");
            }
            _ => panic!("last block must be Chip"),
        }
    }

    #[test]
    fn head_surfaces_oldest_dispatch_with_queue_count() {
        // Empty queue → no head (the review gate shows "queue empty").
        assert!(make_pane(vec![], 0).head().is_none());

        // Populated → head is the first entry, carrying intent + economics + the
        // full queue count (what the review gate renders).
        let first = DispatchEntry {
            id: "head-1".into(),
            goal: "Land the auth refactor".into(),
            state: "review_pending".into(),
            budget_usd: Some(2.0),
            cost_usd: Some(0.5),
            worktree_path: None,
            error_message: None,
            result_artifact: None,
            created_at: Some(1),
        };
        let second = DispatchEntry {
            id: "tail-2".into(),
            goal: "later".into(),
            state: "review_pending".into(),
            budget_usd: None,
            cost_usd: None,
            worktree_path: None,
            error_message: None,
            result_artifact: None,
            created_at: Some(2),
        };
        let pane = make_pane(vec![first, second], 2);
        let head = pane.head().expect("head present");
        assert_eq!(head.id, "head-1");
        assert_eq!(head.goal, "Land the auth refactor");
        assert_eq!(head.state, "review_pending");
        assert_eq!(head.budget_usd, Some(2.0));
        assert_eq!(head.cost_usd, Some(0.5));
        assert_eq!(head.count, 2, "head carries the full queue depth");
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
                 "worktreePath": "/tmp/d1", "errorMessage": "recover me",
                 "createdAt": 1781133247168u64},
                {"id": "d2", "goal": "fix it", "state": "review_pending",
                 "budgetUsd": null, "costUsd": 0.12,
                 "resultArtifact": "https://example.test/pr/2",
                 "createdAt": 1781133250000u64}
            ]
        });
        let (entries, count) = parse_dispatches(&body);
        assert_eq!(count, 2);
        assert_eq!(entries.len(), 2, "epoch-ms/null rows must not be dropped");
        assert_eq!(entries[0].cost_usd, None);
        assert_eq!(entries[1].cost_usd, Some(0.12));
        assert_eq!(entries[0].created_at, Some(1781133247168));
        assert_eq!(entries[0].worktree_path.as_deref(), Some("/tmp/d1"));
        assert_eq!(entries[0].error_message.as_deref(), Some("recover me"));
        assert_eq!(
            entries[1].result_artifact.as_deref(),
            Some("https://example.test/pr/2")
        );
    }

    #[test]
    fn view_surfaces_recovery_and_completed_receipts() {
        let pane = make_pane(
            vec![
                DispatchEntry {
                    id: "recover-1234".into(),
                    goal: "Preserve unfinished edits".into(),
                    state: "salvage".into(),
                    budget_usd: Some(10.0),
                    cost_usd: Some(0.01),
                    worktree_path: Some("/tmp/recover-1234".into()),
                    error_message: Some("artifact missing".into()),
                    result_artifact: None,
                    created_at: Some(1),
                },
                DispatchEntry {
                    id: "settled-5678".into(),
                    goal: "Publish a reviewable change".into(),
                    state: "settled".into(),
                    budget_usd: Some(10.0),
                    cost_usd: Some(0.02),
                    worktree_path: None,
                    error_message: None,
                    result_artifact: Some("https://github.com/example/repo/pull/42".into()),
                    created_at: Some(2),
                },
            ],
            0,
        );

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value)
                if key == "recover recover-" && value == "/tmp/recover-1234"
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value)
                if key == "receipt settled-" && value.ends_with("/pull/42")
        )));
        assert!(matches!(
            blocks.last(),
            Some(Block::Chip { label, tone: Tone::Gated })
                if label == "0 active · 0 review · 1 recovery · 1 complete"
        ));
    }

    /// Missing `count` falls back to parsed length; missing array → empty.
    #[test]
    fn parse_dispatches_missing_fields() {
        let (entries, count) = parse_dispatches(&serde_json::json!({"dispatches": [{"id": "x"}]}));
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
