//! Begin-flakiness pane — detect & visualise `pd begin` problems.
//!
//! Agents report that `pd begin` is occasionally flaky (crowded main worktree,
//! registration/session rollback, validation, race-shaped 500s). The daemon now
//! records every one of those moments — when the problem enters the human
//! suggestion layer — and exposes them at:
//!
//! `GET /sugar/begin/flakiness?limit=40`
//!
//! Shape:
//! ```json
//! {
//!   "success": true,
//!   "count": 3,
//!   "entries": [
//!     { "timestamp": 1781123816886, "class": "crowded", "code": "MAIN_WORKTREE_CROWDED",
//!       "error": "...", "hint": "Create a linked worktree…", "identity": "port-daddy:cli:fix",
//!       "agentId": null, "worktree": null, "lifecycle": "durable", "purpose": "...",
//!       "httpStatus": 400 }
//!   ],
//!   "summary": {
//!     "total": 3, "byClass": { "crowded": 2, "internal": 1 },
//!     "byCode": { "MAIN_WORKTREE_CROWDED": 2 }, "lastSeen": 1781123816886,
//!     "since": 1781037416886, "sparkline": [0,0,1,0,2,...]
//!   }
//! }
//! ```

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct FlakeEntry {
    timestamp_ms: i64,
    class: String,
    code: String,
    identity: String,
    /// The operator-facing line: prefer the hint (the suggestion), fall back to
    /// the raw error.
    suggestion: String,
}

impl FlakeEntry {
    fn from_value(v: &Value) -> Self {
        let hint = s(v, "hint");
        let error = s(v, "error");
        let suggestion = if !hint.is_empty() {
            // Hints can be multi-line (worktree recipe); keep the first line for
            // the row, the rest is still in the daemon log.
            hint.lines().next().unwrap_or("").to_string()
        } else {
            error
        };
        Self {
            timestamp_ms: n(v, "timestamp"),
            class: s(v, "class"),
            code: s(v, "code"),
            identity: s(v, "identity"),
            suggestion,
        }
    }
}

/// Map a coarse class to a console tone. Mirrors lib/begin-flakiness.ts classes.
fn tone_for_class(class: &str) -> Tone {
    match class {
        "internal" | "registration" | "session-start" => Tone::Conflicted,
        "crowded" | "worktree-policy" => Tone::Gated,
        "validation" => Tone::Resting,
        _ => Tone::Default,
    }
}

/// Stable display order for the summary chips so the layout does not jitter as
/// counts change between refreshes.
const CLASS_ORDER: &[&str] = &[
    "crowded",
    "worktree-policy",
    "registration",
    "session-start",
    "internal",
    "validation",
    "other",
];

pub struct BeginFlakinessPane {
    entries: Vec<FlakeEntry>,
    by_class: Vec<(String, i64)>,
    sparkline: Vec<f32>,
    total: i64,
    last_seen_ms: i64,
    last_error: Option<String>,
}

impl Default for BeginFlakinessPane {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            by_class: Vec::new(),
            sparkline: Vec::new(),
            total: 0,
            last_seen_ms: 0,
            last_error: None,
        }
    }
}

impl BeginFlakinessPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pull `summary.byClass` into a stable, ordered Vec for chip rendering.
    fn read_by_class(summary: &Value) -> Vec<(String, i64)> {
        let by_class = summary.get("byClass").and_then(|v| v.as_object());
        let mut out: Vec<(String, i64)> = Vec::new();
        if let Some(map) = by_class {
            // Known classes first, in stable order.
            for &k in CLASS_ORDER {
                if let Some(count) = map.get(k).and_then(|v| v.as_i64()) {
                    if count > 0 {
                        out.push((k.to_string(), count));
                    }
                }
            }
            // Any forward-compat classes we don't know about, appended as-is.
            for (k, v) in map {
                if !CLASS_ORDER.contains(&k.as_str()) {
                    if let Some(count) = v.as_i64() {
                        if count > 0 {
                            out.push((k.clone(), count));
                        }
                    }
                }
            }
        }
        out
    }

    fn read_sparkline(summary: &Value) -> Vec<f32> {
        summary
            .get("sparkline")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect())
            .unwrap_or_default()
    }
}

impl Pane for BeginFlakinessPane {
    fn id(&self) -> &str {
        "flakiness"
    }
    fn title(&self) -> String {
        "Begin Flakiness".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("pd begin — flakiness (24h)".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        blocks.push(Block::KeyVal("events (window)".into(), self.total.to_string()));
        blocks.push(Block::KeyVal(
            "last seen".into(),
            if self.last_seen_ms > 0 {
                age_short(self.last_seen_ms)
            } else {
                "—".into()
            },
        ));

        // Per-class breakdown as toned chips. Healthy fleet => no chips.
        if self.by_class.is_empty() {
            blocks.push(Block::Chip {
                label: "no begin flakiness".into(),
                tone: Tone::Landed,
            });
        } else {
            for (class, count) in &self.by_class {
                blocks.push(Block::Chip {
                    label: format!("{class} {count}"),
                    tone: tone_for_class(class),
                });
            }
        }

        // Rate over the window.
        if self.sparkline.iter().any(|&v| v > 0.0) {
            blocks.push(Block::Spark(self.sparkline.clone()));
        }

        blocks.push(Block::Gap);

        if self.entries.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no recent begin problems".into()));
        } else {
            blocks.push(Block::Header("recent".into()));
            for e in self.entries.iter().take(20) {
                let label = if e.code.is_empty() { e.class.clone() } else { e.code.clone() };
                blocks.push(Block::Row(vec![
                    age_short(e.timestamp_ms),
                    trunc(&label, 24),
                    trunc(&e.identity, 22),
                    trunc(&e.suggestion, 40),
                ]));
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/sugar/begin/flakiness?limit=40", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.entries.clear();
                    self.by_class.clear();
                    self.sparkline.clear();
                    self.total = 0;
                    self.last_seen_ms = 0;
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.entries =
                            arr(&data, "entries").iter().map(FlakeEntry::from_value).collect();
                        let summary = data.get("summary").cloned().unwrap_or(Value::Null);
                        if summary.is_object() {
                            self.by_class = Self::read_by_class(&summary);
                            self.sparkline = Self::read_sparkline(&summary);
                            self.total = summary.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
                            self.last_seen_ms =
                                summary.get("lastSeen").and_then(|v| v.as_i64()).unwrap_or(0);
                        } else {
                            // Older daemon without the recorder: fall back to the
                            // entry list so the pane still shows something.
                            self.by_class.clear();
                            self.sparkline.clear();
                            self.total = self.entries.len() as i64;
                            self.last_seen_ms =
                                self.entries.first().map(|e| e.timestamp_ms).unwrap_or(0);
                        }
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
    fn view_empty_is_healthy() {
        let p = BeginFlakinessPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("flakiness")));
        // Healthy: a Landed "no begin flakiness" chip is present.
        assert!(b.iter().any(|blk| matches!(blk, Block::Chip { tone: Tone::Landed, .. })));
    }

    #[test]
    fn tone_classification() {
        assert!(matches!(tone_for_class("internal"), Tone::Conflicted));
        assert!(matches!(tone_for_class("crowded"), Tone::Gated));
        assert!(matches!(tone_for_class("validation"), Tone::Resting));
        assert!(matches!(tone_for_class("mystery"), Tone::Default));
    }

    #[test]
    fn entry_prefers_hint_first_line() {
        let v = json!({
            "timestamp": 1781123816886i64,
            "class": "crowded",
            "code": "MAIN_WORKTREE_CROWDED",
            "error": "main worktree is crowded",
            "hint": "Create a linked worktree and run pd begin there:\n  git worktree add …",
            "identity": "port-daddy:cli:fix",
        });
        let e = FlakeEntry::from_value(&v);
        assert_eq!(e.class, "crowded");
        assert_eq!(e.code, "MAIN_WORKTREE_CROWDED");
        assert_eq!(e.suggestion, "Create a linked worktree and run pd begin there:");
    }

    #[test]
    fn entry_falls_back_to_error_without_hint() {
        let v = json!({
            "timestamp": 1i64, "class": "internal", "code": "INTERNAL_ERROR",
            "error": "boom", "hint": "", "identity": "",
        });
        let e = FlakeEntry::from_value(&v);
        assert_eq!(e.suggestion, "boom");
    }

    #[test]
    fn summary_by_class_is_ordered_and_drops_zeros() {
        let summary = json!({
            "byClass": { "validation": 1, "crowded": 3, "zzz-unknown": 2, "internal": 0 },
            "sparkline": [0, 1, 2],
        });
        let by_class = BeginFlakinessPane::read_by_class(&summary);
        // crowded comes before validation (CLASS_ORDER), internal=0 dropped,
        // unknown class appended last.
        assert_eq!(by_class[0].0, "crowded");
        assert_eq!(by_class[0].1, 3);
        assert!(by_class.iter().all(|(c, _)| c != "internal"));
        assert_eq!(by_class.last().unwrap().0, "zzz-unknown");

        let spark = BeginFlakinessPane::read_sparkline(&summary);
        assert_eq!(spark, vec![0.0, 1.0, 2.0]);
    }
}
