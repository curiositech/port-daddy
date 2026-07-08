//! Sortie multiplexer pane — the operator's at-a-glance view of all running,
//! waiting, and recently completed agent sorties. This is the "needs input /
//! working / completed rows" view inspired by the Claude Code agent progress
//! panel (ADR-0046, Wave 1 — Attention Queue foundation).
//!
//! Renders one row per sortie:
//!   [●] console:auth:simplifier  working    4m  goal truncated to 60 chars…
//!   [⏸] docs:sync:archivist      needs-input  ↲  "waiting on operator"
//!   [✓] fix:daemon:debugger      completed  2m ago
//!   [✗] feat:auth:qa             failed     error snippet
//!
//! The pane polls `GET /sorties?limit=50` and surfaces the four state buckets
//! the operator cares about: running (working), blocked (needs-input), done
//! (completed/cancelled/failed). Fail-closed: if the daemon is unreachable the
//! pane shows an error row rather than panicking.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;

/// One sortie entry as returned by `GET /sorties`.
///
/// Built via tolerant `from_value` extraction, never strict serde: the daemon
/// sends epoch-ms numbers, nulls, and has drifted field names across versions
/// (`status` vs `state`, `harbor` vs `identity`). A strict struct silently
/// dropped every row (rendered "total 0" against a live daemon with sorties).
#[derive(Debug, Clone)]
struct SortieEntry {
    id: String,
    identity: String,
    goal: String,
    state: String,
    backend: String,
    cost_usd: Option<f64>,
    started_at: Option<u64>,
    ended_at: Option<u64>,
    error: Option<String>,
}

/// First string value among `keys`, owned. Missing/null/non-string → None.
fn vstr(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v.get(k).and_then(|x| x.as_str()).map(str::to_string))
}

/// First numeric value among `keys` as u64 (accepts integer or float ms).
fn vu64(v: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|k| {
        let x = v.get(*k)?;
        x.as_u64().or_else(|| x.as_f64().map(|f| f as u64))
    })
}

impl SortieEntry {
    /// Tolerant extraction from one daemon JSON object. Only `id` is required;
    /// every other field falls back to a sensible default rather than dropping
    /// the row.
    fn from_value(v: &serde_json::Value) -> Option<Self> {
        let id = vstr(v, &["id"])?;
        Some(Self {
            id,
            identity: vstr(v, &["harbor", "identity", "project"]).unwrap_or_default(),
            goal: vstr(v, &["goal"]).unwrap_or_default(),
            state: vstr(v, &["status", "state"]).unwrap_or_else(|| "unknown".into()),
            backend: vstr(v, &["backend"]).unwrap_or_default(),
            cost_usd: ["costUsd", "cost_usd"].iter().find_map(|k| v.get(*k).and_then(|x| x.as_f64())),
            started_at: vu64(v, &["startedAt", "started_at", "createdAt", "created_at"]),
            ended_at: vu64(v, &["endedAt", "ended_at", "completedAt", "completed_at"]),
            error: vstr(v, &["error"]),
        })
    }
}

/// Pure decode of a `GET /sorties` body. Accepts both `[…]` and
/// `{sorties:[…]}` shapes; rows missing an `id` are the only ones dropped.
fn parse_sorties(v: &serde_json::Value) -> Vec<SortieEntry> {
    let arr = v
        .as_array()
        .cloned()
        .or_else(|| v.get("sorties").and_then(|s| s.as_array()).cloned())
        .unwrap_or_default();
    arr.iter().filter_map(SortieEntry::from_value).collect()
}

/// State bucket for grouping and display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Bucket {
    NeedsInput, // blocked — highest attention
    Working,    // running
    Done,       // completed / cancelled / failed
}

impl SortieEntry {
    fn bucket(&self) -> Bucket {
        match self.state.as_str() {
            "blocked" | "needs_input" | "awaiting_human" => Bucket::NeedsInput,
            "running" | "working" | "spawned" | "starting" => Bucket::Working,
            _ => Bucket::Done, // completed, failed, cancelled, unknown
        }
    }

    fn status_glyph(&self) -> &'static str {
        match self.bucket() {
            Bucket::NeedsInput => "◔",
            Bucket::Working => "●",
            Bucket::Done => match self.state.as_str() {
                "failed" | "error" => "✗",
                _ => "✓",
            },
        }
    }

    fn tone(&self) -> Tone {
        match self.bucket() {
            Bucket::NeedsInput => Tone::Gated,
            Bucket::Working => Tone::Engaged,
            Bucket::Done => match self.state.as_str() {
                "failed" | "error" => Tone::Conflicted,
                _ => Tone::Landed,
            },
        }
    }

    /// Human-readable elapsed time label.
    fn elapsed_label(&self, now_ms: u64) -> String {
        let start = match self.started_at {
            Some(s) => s,
            None => return String::new(),
        };
        let end = self.ended_at.unwrap_or(now_ms);
        let secs = end.saturating_sub(start) / 1000;
        if secs < 60 {
            format!("{secs}s")
        } else {
            format!("{}m", secs / 60)
        }
    }

    /// Truncated goal for the row (≤60 chars + ellipsis).
    fn goal_trunc(&self) -> String {
        let g = self.goal.trim();
        let chars: Vec<char> = g.chars().collect();
        if chars.len() <= 60 {
            g.to_string()
        } else {
            format!("{}…", chars[..59].iter().collect::<String>())
        }
    }

    /// Short id (≤12 chars). Slices on a CHARACTER boundary, never a byte index:
    /// `&s[..12]` panics when byte 12 lands inside a multi-byte UTF-8 codepoint.
    fn id_short(&self) -> &str {
        match self.id.char_indices().nth(12).map(|(i, _)| i) {
            Some(end) => &self.id[..end],
            None => self.id.as_str(),
        }
    }
}

/// Live sortie multiplexer. Refreshed by the console on `:sorties` command
/// or on a timer (when the shell layer adds one).
pub struct SortiePane {
    sorties: Vec<SortieEntry>,
    last_error: Option<String>,
    now_ms: u64,
}

impl SortiePane {
    pub fn new() -> Self {
        Self { sorties: Vec::new(), last_error: None, now_ms: 0 }
    }

    fn current_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

impl Pane for SortiePane {
    fn id(&self) -> &str {
        "sorties"
    }

    fn title(&self) -> String {
        "Sorties".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Sorties".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let needs_input: Vec<_> = self.sorties.iter().filter(|s| s.bucket() == Bucket::NeedsInput).collect();
        let working: Vec<_> = self.sorties.iter().filter(|s| s.bucket() == Bucket::Working).collect();
        let done: Vec<_> = self.sorties.iter().filter(|s| s.bucket() == Bucket::Done).collect();

        let total = self.sorties.len();
        let running_count = working.len();
        let blocked_count = needs_input.len();

        blocks.push(Block::KeyVal(
            "running".into(),
            format!("{running_count}  |  blocked {blocked_count}  |  total {total}"),
        ));
        blocks.push(Block::Gap);

        // Needs-input first — highest priority for the operator.
        if !needs_input.is_empty() {
            blocks.push(Block::Header("Needs Input".into()));
            for s in &needs_input {
                let elapsed = s.elapsed_label(self.now_ms);
                let detail = s.error.as_deref().unwrap_or("waiting on operator");
                blocks.push(Block::Row(vec![
                    format!("{} {}", s.status_glyph(), s.id_short()),
                    s.identity.clone(),
                    s.goal_trunc(),
                    elapsed,
                    detail.chars().take(40).collect(),
                ]));
                blocks.push(Block::Chip { label: "needs input".into(), tone: s.tone() });
            }
            blocks.push(Block::Gap);
        }

        // Working.
        if !working.is_empty() {
            blocks.push(Block::Header("●  Working".into()));
            for s in &working {
                let elapsed = s.elapsed_label(self.now_ms);
                let cost = s.cost_usd.map(|c| format!("${c:.4}")).unwrap_or_default();
                blocks.push(Block::Row(vec![
                    format!("{} {}", s.status_glyph(), s.id_short()),
                    s.backend.clone(),
                    s.goal_trunc(),
                    elapsed,
                    cost,
                ]));
            }
            blocks.push(Block::Gap);
        }

        // Done (cap at 10 most recent to avoid flooding).
        let recent_done: Vec<_> = done.iter().rev().take(10).collect();
        if !recent_done.is_empty() {
            blocks.push(Block::Header("  Recent".into()));
            for s in recent_done {
                let elapsed = s.elapsed_label(self.now_ms);
                let cost = s.cost_usd.map(|c| format!("${c:.4}")).unwrap_or_default();
                blocks.push(Block::Row(vec![
                    format!("{} {}", s.status_glyph(), s.id_short()),
                    s.state.clone(),
                    s.goal_trunc(),
                    elapsed,
                    cost,
                ]));
            }
        }

        if self.sorties.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no sorties yet — :new <backend> <goal>".into()));
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: if running_count > 0 {
                format!("{running_count} running")
            } else {
                "idle".into()
            },
            tone: if blocked_count > 0 {
                Tone::Gated
            } else if running_count > 0 {
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
            self.now_ms = Self::current_ms();
            let url = format!("{}/sorties?limit=50", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("GET /sorties: {e}"));
                    self.sorties.clear();
                }
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        self.last_error = Some(format!(
                            "GET /sorties → {status} (daemon may predate this route)"
                        ));
                        self.sorties.clear();
                        return Ok(());
                    }
                    match resp.json::<serde_json::Value>().await {
                        Err(e) => {
                            self.last_error = Some(format!("parse: {e}"));
                        }
                        Ok(v) => {
                            self.last_error = None;
                            self.sorties = parse_sorties(&v);
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

    fn make_entry(id: &str, state: &str, goal: &str, started_at: Option<u64>) -> SortieEntry {
        SortieEntry {
            id: id.into(),
            identity: format!("test:{id}"),
            goal: goal.into(),
            state: state.into(),
            backend: "claude".into(),
            cost_usd: Some(0.0012),
            started_at,
            ended_at: None,
            error: None,
        }
    }

    /// Regression: a real daemon payload (captured from pd 3.18.0 live) uses
    /// `status` not `state`, `harbor` not `identity`, epoch-ms `createdAt`,
    /// and nulls. The old strict-serde decode dropped every row → "total 0".
    #[test]
    fn parse_sorties_real_daemon_payload() {
        let body: serde_json::Value = serde_json::json!({
            "success": true,
            "sorties": [{
                "id": "sortie-6b79acdd6ac7",
                "projectDir": "/Users/x/coding/port-daddy",
                "project": "port-daddy",
                "harbor": "port-daddy:sortie:sortie-6b79acdd6ac7",
                "goal": "Extend the pd-tube CLI backend family",
                "recipe": "spawner-tube-backends",
                "status": "blocked",
                "backend": "cli:claude-code",
                "model": null,
                "modelTier": null,
                "budgetUsd": 8,
                "spawnAgentId": null,
                "resultOutput": null,
                "error": "No launchable backend",
                "createdAt": 1781133247168u64
            }]
        });
        let sorties = parse_sorties(&body);
        assert_eq!(sorties.len(), 1, "real daemon row must not be dropped");
        let s = &sorties[0];
        assert_eq!(s.state, "blocked");
        assert_eq!(s.bucket(), Bucket::NeedsInput);
        assert_eq!(s.identity, "port-daddy:sortie:sortie-6b79acdd6ac7");
        assert_eq!(s.started_at, Some(1781133247168));
        assert_eq!(s.error.as_deref(), Some("No launchable backend"));
    }

    /// Rows without an `id` are dropped; everything else defaults.
    #[test]
    fn parse_sorties_tolerates_sparse_rows() {
        let body = serde_json::json!({"sorties": [
            {"id": "a1", "state": "running"},
            {"goal": "no id — dropped"},
            {"id": "b2"}
        ]});
        let sorties = parse_sorties(&body);
        assert_eq!(sorties.len(), 2);
        assert_eq!(sorties[0].state, "running");
        assert_eq!(sorties[1].state, "unknown");
    }

    /// Bare-array shape still accepted.
    #[test]
    fn parse_sorties_bare_array() {
        let body = serde_json::json!([{"id": "c3", "status": "completed"}]);
        assert_eq!(parse_sorties(&body).len(), 1);
    }

    #[test]
    fn view_empty_shows_idle() {
        let pane = SortiePane::new();
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("Sortie"))));
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, .. } if label == "idle")));
    }

    #[test]
    fn working_sortie_shows_in_working_section() {
        let mut pane = SortiePane::new();
        pane.now_ms = 60_000;
        pane.sorties = vec![make_entry("abc123def456", "running", "refactor auth middleware", Some(0))];
        let blocks = pane.view();
        let has_working_header = blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("Working")));
        let has_row = blocks.iter().any(|b| matches!(b, Block::Row(cells) if cells.iter().any(|c| c.contains("refactor"))));
        assert!(has_working_header);
        assert!(has_row);
    }

    #[test]
    fn needs_input_sortie_listed_first() {
        let mut pane = SortiePane::new();
        pane.now_ms = 10_000;
        pane.sorties = vec![
            make_entry("aaa", "running", "working sortie", Some(0)),
            make_entry("bbb", "blocked", "blocked sortie", Some(0)),
        ];
        let blocks = pane.view();
        // "Needs Input" header should appear before "Working" header.
        let ni_pos = blocks.iter().position(|b| matches!(b, Block::Header(h) if h.contains("Needs Input")));
        let wk_pos = blocks.iter().position(|b| matches!(b, Block::Header(h) if h.contains("Working")));
        assert!(ni_pos.is_some());
        assert!(wk_pos.is_some());
        assert!(ni_pos.unwrap() < wk_pos.unwrap());
    }

    #[test]
    fn goal_truncated_at_60_chars() {
        let long_goal = "a".repeat(80);
        let entry = make_entry("x", "running", &long_goal, None);
        let trunc = entry.goal_trunc();
        assert!(trunc.chars().count() <= 60, "truncated goal must be ≤60 chars");
        assert!(trunc.ends_with('…'));
    }

    #[test]
    fn elapsed_label_minutes() {
        let entry = make_entry("x", "running", "g", Some(0));
        assert_eq!(entry.elapsed_label(300_000), "5m");
        assert_eq!(entry.elapsed_label(45_000), "45s");
    }

    #[test]
    fn failed_sortie_shows_in_done_with_error_tone() {
        let mut pane = SortiePane::new();
        let mut e = make_entry("fail1", "failed", "something broke", Some(0));
        e.error = Some("timeout".into());
        pane.sorties = vec![e];
        let blocks = pane.view();
        let has_recent = blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("Recent")));
        assert!(has_recent);
    }

    #[test]
    fn error_state_shows_error_block() {
        let mut pane = SortiePane::new();
        pane.last_error = Some("connection refused".into());
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        // Should only have Header + error KV — no sortie rows.
        assert_eq!(blocks.len(), 2);
    }
}
