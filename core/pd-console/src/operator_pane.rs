//! Operator pane — the AGENTIC CONTROL PLANE, ported from the web Operator tab
//! (`fleet-config-ui/src/components/NeedsYouHero.tsx` + `App.tsx`) into the
//! native console as the operator's default top surface.
//!
//! It mirrors the web dashboard's four sections, every one rendered from real
//! `GET /operator/state` data (no placeholders):
//!
//!   1. HEADER / GUARD STRIP — guard status badge ("Guard: enforcing" /
//!      "violation"), snapshot freshness, daemon project.
//!   2. NEEDS YOU — the prioritized `needsYou[]` triage: a maritime signal flag
//!      per code, a `P{priority}` badge, the human label, and the `pd …` action
//!      command in monospace.
//!   3. DISPATCH QUEUE — `dispatch.reviewPending` + `dispatch.open`: a state
//!      chip, title, agent id per entry.
//!   4. BUDGET LEDGER — `budget.total` (TODAY · CAP · EVENTS) plus a 10-cell
//!      spend bar and the most recent spend rows.
//!
//! Render-agnostic: emits `Block`s only, so GPUI and the ratatui TUI paint the
//! same surface. Tolerant extraction (never strict serde) — the daemon sends
//! epoch-ms numbers, nulls, and may predate fields; a stray shape must degrade a
//! single row, never blank the whole pane.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde_json::Value;

// ── NEEDS-YOU code → maritime glyph + tone ────────────────────────────────────

/// Map a `NeedsYouCode` to the ICS flag LETTER the console paints as its glyph
/// (mirrors `maritime.rs` semantics — a real signal flag, not an emoji). The web
/// UI uses lucide icons (AlertTriangle/ShieldAlert/Anchor/Map…); the console's
/// native vocabulary is the signal flag, so each code resolves to the closest
/// ICS meaning.
fn code_flag(code: &str) -> char {
    match code {
        "dispatch_review" => 'F', // Foxtrot — disabled, communicate (HITL review gate)
        "guard_violation" => 'L', // Lima — stop instantly (guard block)
        "budget_ceiling" => 'B',  // Bravo — dangerous cargo (burning budget)
        "salvage" => 'O',         // Oscar — man overboard (agent needs salvage)
        "stuck_agent" => 'W',     // Whiskey — require medical (agent health: dead)
        "roadmap_now" => 'P',     // Papa — about to put to sea (ready to dispatch)
        "inbox" => 'K',           // Kilo — I wish to communicate (message waiting)
        _ => 'V',                 // Victor — I require assistance (unknown attention)
    }
}

/// Tone for the priority badge: P0 is the loudest (conflict/accent), P1–P2 amber
/// (gated), everything lower is resting. Mirrors `urgencyStyle()` in the web
/// `NeedsYouHero`.
fn priority_tone(priority: i64) -> Tone {
    match priority {
        0 => Tone::Conflicted,
        1 | 2 => Tone::Gated,
        _ => Tone::Resting,
    }
}

// ── tolerant field helpers ────────────────────────────────────────────────────

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(str::to_string)
}
fn i(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|n| n as i64)))
}
fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn b(v: &Value, k: &str) -> Option<bool> {
    v.get(k).and_then(|x| x.as_bool())
}

/// Byte offset of the `n`-th char boundary (UTF-8 safe truncation — `&s[..n]`
/// panics mid-codepoint on arbitrary user text like dispatch titles).
fn char_boundary(s: &str, n: usize) -> Option<usize> {
    s.char_indices().nth(n).map(|(idx, _)| idx)
}
fn truncate(s: &str, n: usize) -> String {
    match char_boundary(s, n) {
        Some(end) => format!("{}…", &s[..end]),
        None => s.to_string(),
    }
}

/// A 10-cell proportional spend bar (`████████░░ 64.8%`) for spend-vs-cap.
/// Mirrors `ledger_pane::burn_bar` so the budget section reads identically to
/// the dedicated ledger.
fn spend_bar(pct: f64) -> String {
    let filled = ((pct / 10.0).round() as i64).clamp(0, 10) as usize;
    let mut bar = String::with_capacity(10);
    for _ in 0..filled {
        bar.push('█');
    }
    for _ in filled..10 {
        bar.push('░');
    }
    format!("{bar} {pct:.1}%")
}

// ── the pane ──────────────────────────────────────────────────────────────────

/// Operator control-plane pane. Holds the last `/operator/state` snapshot (an
/// opaque JSON object) plus the last error; `view()` renders it into Blocks.
#[derive(Default)]
pub struct OperatorPane {
    /// Last `GET /operator/state` body (None until first refresh).
    state: Option<Value>,
    /// Last error, if the daemon was unreachable / rejected the request.
    last_error: Option<String>,
}

impl OperatorPane {
    pub fn new() -> Self {
        Self::default()
    }

    // ── section renderers (pure; take the parsed snapshot) ───────────────────

    /// 1 · HEADER / GUARD STRIP — guard badge + freshness + project.
    fn header_blocks(&self, state: &Value, out: &mut Vec<Block>) {
        out.push(Block::Header("Operator — Agentic Control Plane".into()));

        // Project context.
        let project = s(state, "project").unwrap_or_else(|| "(daemon default)".into());
        out.push(Block::KeyVal("project".into(), project));

        // Guard badge: enforcing (green) / violation-prone (amber) / unavailable.
        let guard = state.get("guard");
        let (guard_label, guard_tone) = match guard {
            Some(g) => {
                let available = b(g, "available").unwrap_or(false);
                let enabled = b(g, "enabled").unwrap_or(false);
                let mode = s(g, "mode").unwrap_or_default();
                if !available {
                    ("Guard: unavailable".to_string(), Tone::Resting)
                } else if enabled && mode == "enforce" {
                    ("Guard: enforcing".to_string(), Tone::Landed)
                } else if enabled {
                    (format!("Guard: {mode}"), Tone::Gated)
                } else {
                    ("Guard: off".to_string(), Tone::Gated)
                }
            }
            None => ("Guard: unknown".to_string(), Tone::Resting),
        };
        out.push(Block::Chip { label: guard_label, tone: guard_tone });

        // Fleet signal (the maritime coordination state), when present.
        if let Some(sig) = state.get("fleetSignal").filter(|v| !v.is_null()) {
            if let (Some(code), Some(meaning)) = (s(sig, "code"), s(sig, "meaning")) {
                out.push(Block::Flag {
                    letter: code.chars().next().unwrap_or('P'),
                    label: meaning,
                    tone: Tone::Accent,
                });
            }
        }
    }

    /// 2 · NEEDS YOU — the prioritized triage list.
    fn needs_you_blocks(&self, state: &Value, out: &mut Vec<Block>) {
        let items = state
            .get("needsYou")
            .and_then(|n| n.as_array())
            .cloned()
            .unwrap_or_default();

        out.push(Block::Header(format!(
            "NEEDS YOU — {} item{}",
            items.len(),
            if items.len() == 1 { "" } else { "s" }
        )));

        if items.is_empty() {
            out.push(Block::Chip {
                label: "No action required — fleet is clear".into(),
                tone: Tone::Landed,
            });
            return;
        }

        for item in &items {
            let code = s(item, "code").unwrap_or_else(|| "unknown".into());
            let label = s(item, "label").unwrap_or_default();
            let action = s(item, "action").unwrap_or_default();
            let priority = i(item, "priority").unwrap_or(9);

            // A maritime signal flag carries the code's meaning (the glyph), and
            // the label rides alongside it. The flag's tone tracks urgency.
            out.push(Block::Flag {
                letter: code_flag(&code),
                label: format!("P{priority}  {label}"),
                tone: priority_tone(priority),
            });
            // The action command in monospace — the operator's next keystroke.
            // (Rendered as a Row so it sits indented under the flag.)
            out.push(Block::Row(vec!["→".into(), action]));
        }
    }

    /// 3 · DISPATCH QUEUE — review-pending + open dispatches.
    fn dispatch_blocks(&self, state: &Value, out: &mut Vec<Block>) {
        let dispatch = match state.get("dispatch").filter(|v| !v.is_null()) {
            Some(d) => d,
            None => return, // section omitted by the daemon when empty
        };
        let review: Vec<Value> = dispatch
            .get("reviewPending")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let open: Vec<Value> = dispatch
            .get("open")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        out.push(Block::Header(format!(
            "DISPATCH QUEUE — {}",
            review.len() + open.len()
        )));

        let render_entry = |entry: &Value, default_state: &str, out: &mut Vec<Block>| {
            let title = s(entry, "title")
                .or_else(|| s(entry, "goal"))
                .unwrap_or_else(|| "(untitled)".into());
            let st = s(entry, "state").unwrap_or_else(|| default_state.into());
            let agent = s(entry, "agentId").unwrap_or_else(|| "-".into());
            out.push(Block::Row(vec![st, truncate(&title, 48), agent]));
        };

        if review.is_empty() && open.is_empty() {
            out.push(Block::KeyVal("status".into(), "no dispatches".into()));
        } else {
            for e in &review {
                render_entry(e, "awaiting_review", out);
            }
            for e in &open {
                render_entry(e, "open", out);
            }
        }

        let tone = if review.is_empty() { Tone::Resting } else { Tone::Engaged };
        out.push(Block::Chip {
            label: format!("{} awaiting review", review.len()),
            tone,
        });
    }

    /// 4 · BUDGET LEDGER — today's spend, daily cap, event count, spend bar, recent.
    fn budget_blocks(&self, state: &Value, out: &mut Vec<Block>) {
        let budget = match state.get("budget").filter(|v| !v.is_null()) {
            Some(b) => b,
            None => return,
        };

        out.push(Block::Header("BUDGET LEDGER".into()));

        let total = budget.get("total");
        let today = total.and_then(|t| f(t, "spentTodayUsd")).unwrap_or(0.0);
        let events = total.and_then(|t| i(t, "eventCount")).unwrap_or(0);

        // Daily cap + percent come from `status` when a budget is configured.
        let status = budget.get("status").filter(|v| !v.is_null());
        let cap = status.and_then(|st| f(st, "budgetUsdPerDay"));
        let pct = status.and_then(|st| f(st, "percentUsed"));
        let over = status.and_then(|st| b(st, "overBudget")).unwrap_or(false);

        let cap_str = cap.map(|c| format!("${c:.2}/day")).unwrap_or_else(|| "—".into());
        out.push(Block::Row(vec![
            format!("TODAY ${today:.2}"),
            format!("CAP {cap_str}"),
            format!("EVENTS {events}"),
        ]));

        // The spend bar — only meaningful when a cap exists.
        if let Some(p) = pct {
            out.push(Block::KeyVal("spend".into(), spend_bar(p)));
            out.push(Block::Chip {
                label: if over { "OVER BUDGET".into() } else { format!("{p:.0}% of cap") },
                tone: if over { Tone::Conflicted } else { Tone::Gated },
            });
        }

        // RECENT SPEND — the latest cost events.
        let recent: Vec<Value> = budget
            .get("recentEvents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if !recent.is_empty() {
            out.push(Block::KeyVal("recent spend".into(), recent.len().to_string()));
            for ev in recent.iter().take(5) {
                let model = s(ev, "model").unwrap_or_else(|| "-".into());
                let proj = s(ev, "project").unwrap_or_else(|| "-".into());
                let cost = f(ev, "costUsd").map(|c| format!("${c:.4}")).unwrap_or_else(|| "-".into());
                out.push(Block::Row(vec![cost, model, proj]));
            }
        }
    }
}

impl Pane for OperatorPane {
    fn id(&self) -> &str {
        "operator"
    }

    fn title(&self) -> String {
        "Operator".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks: Vec<Block> = Vec::new();

        let state = match &self.state {
            Some(s) => s,
            None => {
                blocks.push(Block::Header("Operator — Agentic Control Plane".into()));
                if let Some(err) = &self.last_error {
                    blocks.push(Block::KeyVal("error".into(), err.clone()));
                } else {
                    blocks.push(Block::KeyVal("status".into(), "connecting…".into()));
                }
                return blocks;
            }
        };

        // Even when we have a stale snapshot, surface the last error inline so
        // the operator knows the data may be stale — but still render the data.
        self.header_blocks(state, &mut blocks);
        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("warning".into(), format!("stale: {err}")));
        }
        blocks.push(Block::Gap);
        self.needs_you_blocks(state, &mut blocks);
        blocks.push(Block::Gap);
        self.dispatch_blocks(state, &mut blocks);
        blocks.push(Block::Gap);
        self.budget_blocks(state, &mut blocks);

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            match daemon.operator_state().await {
                Ok(v) => {
                    self.last_error = None;
                    self.state = Some(v);
                }
                Err(e) => {
                    // Keep the last good snapshot (if any) and annotate it stale;
                    // only the error shows if we never connected.
                    self.last_error = Some(format!("{e}"));
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a pane pre-loaded with a synthetic `/operator/state` body — no
    /// daemon needed. Mirrors `dispatch_pane.rs`'s `make_pane` test idiom.
    fn make_pane(state: Value) -> OperatorPane {
        OperatorPane { state: Some(state), last_error: None }
    }

    /// A realistic snapshot: enforcing guard, a P0 dispatch_review, a salvage,
    /// a roadmap_now, one review-pending dispatch, and a budget section.
    fn sample_state() -> Value {
        serde_json::json!({
            "success": true,
            "project": "port-daddy",
            "projectDir": "/Users/op/coding/port-daddy",
            "generatedAt": 1781561557841i64,
            "guard": {
                "available": true,
                "enabled": true,
                "mode": "enforce",
                "name": "coordination-guard"
            },
            "fleetSignal": { "code": "U", "state": "warning", "meaning": "conflict warning" },
            "needsYou": [
                { "code": "dispatch_review", "label": "2 dispatches awaiting review",
                  "action": "pd review", "priority": 0,
                  "meta": { "count": 2 } },
                { "code": "salvage", "label": "1 agent in salvage queue",
                  "action": "pd salvage --project port-daddy", "priority": 3 },
                { "code": "roadmap_now", "label": "3 roadmap items at 'now'",
                  "action": "pd roadmap list --status now", "priority": 5 }
            ],
            "dispatch": {
                "reviewPending": [
                    { "id": "d1", "title": "Land the auth refactor",
                      "state": "awaiting_review", "agentId": "gardener-7" }
                ],
                "open": []
            },
            "budget": {
                "total": { "totalUsd": 12.5, "spentTodayUsd": 3.24, "eventCount": 47 },
                "status": {
                    "project": "port-daddy", "budgetUsdPerDay": 5.0,
                    "spentUsd": 3.24, "remainingUsd": 1.76, "percentUsed": 64.8
                },
                "recentEvents": [
                    { "id": 1, "model": "claude-opus", "project": "port-daddy",
                      "costUsd": 0.1234, "createdAt": 1781561557841i64 }
                ]
            }
        })
    }

    #[test]
    fn renders_all_four_sections_with_priority_and_actions() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();

        // The four section headers all appear, in order.
        let headers: Vec<&String> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Header(h) => Some(h),
                _ => None,
            })
            .collect();
        assert!(headers.iter().any(|h| h.contains("Operator")), "header strip");
        assert!(
            headers.iter().any(|h| h.contains("NEEDS YOU — 3 items")),
            "needs-you header with count, got {headers:?}"
        );
        assert!(headers.iter().any(|h| h.contains("DISPATCH QUEUE — 1")), "dispatch header");
        assert!(headers.iter().any(|h| h.contains("BUDGET LEDGER")), "budget header");
    }

    #[test]
    fn guard_enforcing_badge_renders_green() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();
        let guard_chip = blocks.iter().find_map(|b| match b {
            Block::Chip { label, tone } if label.contains("Guard") => Some((label.clone(), *tone)),
            _ => None,
        });
        let (label, tone) = guard_chip.expect("guard chip present");
        assert_eq!(label, "Guard: enforcing");
        assert!(matches!(tone, Tone::Landed), "enforcing guard is the 'landed' (green) tone");
    }

    #[test]
    fn p0_item_gets_conflicted_tone_and_correct_flag() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();
        // The dispatch_review (P0) flag: letter F, conflicted tone, P0 in label.
        let flag = blocks.iter().find_map(|b| match b {
            Block::Flag { letter, label, tone } if label.contains("P0") => {
                Some((*letter, label.clone(), *tone))
            }
            _ => None,
        });
        let (letter, label, tone) = flag.expect("P0 flag present");
        assert_eq!(letter, 'F', "dispatch_review maps to Foxtrot");
        assert!(label.contains("awaiting review"), "label carries the human text: {label}");
        assert!(matches!(tone, Tone::Conflicted), "P0 is the loudest tone");
    }

    #[test]
    fn salvage_and_roadmap_actions_render_as_commands() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();
        // Every needsYou action lands in a Row prefixed by '→'.
        let actions: Vec<String> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Row(cells) if cells.first().map(|c| c == "→").unwrap_or(false) => {
                    cells.get(1).cloned()
                }
                _ => None,
            })
            .collect();
        assert!(actions.iter().any(|a| a == "pd review"), "dispatch_review action: {actions:?}");
        assert!(
            actions.iter().any(|a| a == "pd salvage --project port-daddy"),
            "salvage action present: {actions:?}"
        );
        assert!(
            actions.iter().any(|a| a == "pd roadmap list --status now"),
            "roadmap_now action present: {actions:?}"
        );
    }

    #[test]
    fn dispatch_row_carries_state_title_agent() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();
        let row = blocks.iter().find_map(|b| match b {
            Block::Row(cells) if cells.iter().any(|c| c.contains("Land the auth")) => Some(cells),
            _ => None,
        });
        let cells = row.expect("dispatch row present");
        assert_eq!(cells[0], "awaiting_review", "state chip");
        assert!(cells[1].contains("Land the auth refactor"), "title");
        assert_eq!(cells[2], "gardener-7", "agent id");
    }

    #[test]
    fn budget_bar_and_today_cap_events_render() {
        let pane = make_pane(sample_state());
        let blocks = pane.view();

        // TODAY · CAP · EVENTS row.
        let summary = blocks.iter().find_map(|b| match b {
            Block::Row(cells) if cells.iter().any(|c| c.starts_with("TODAY")) => Some(cells.clone()),
            _ => None,
        });
        let cells = summary.expect("budget summary row");
        assert!(cells[0].contains("$3.24"), "today spend: {cells:?}");
        assert!(cells[1].contains("$5.00/day"), "daily cap: {cells:?}");
        assert!(cells[2].contains("47"), "event count: {cells:?}");

        // Spend bar at 64.8% → 6 filled cells + percent.
        let bar = blocks.iter().find_map(|b| match b {
            Block::KeyVal(k, v) if k == "spend" => Some(v.clone()),
            _ => None,
        });
        let bar = bar.expect("spend bar present");
        assert_eq!(bar.matches('█').count(), 6, "64.8% rounds to 6/10 cells: {bar}");
        assert!(bar.contains("64.8%"), "percent label: {bar}");
    }

    #[test]
    fn empty_needs_you_renders_clear_chip() {
        let mut state = sample_state();
        state["needsYou"] = serde_json::json!([]);
        let pane = make_pane(state);
        let blocks = pane.view();
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("NEEDS YOU — 0 items"))),
            "zero-item header"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Chip { label, .. } if label.contains("clear"))),
            "clear chip"
        );
    }

    #[test]
    fn unreachable_daemon_before_first_snapshot_shows_error_not_panic() {
        let pane = OperatorPane { state: None, last_error: Some("daemon unreachable".into()) };
        let blocks = pane.view();
        assert_eq!(blocks.len(), 2, "header + error only");
        assert!(matches!(&blocks[1], Block::KeyVal(k, v) if k == "error" && v.contains("unreachable")));
    }

    #[test]
    fn missing_optional_sections_are_omitted_not_faked() {
        // A minimal snapshot with no dispatch/budget — those sections must not
        // appear (honest: don't fabricate empty ledgers).
        let state = serde_json::json!({
            "success": true,
            "project": null,
            "guard": { "available": false, "enabled": false, "mode": "advisory" },
            "needsYou": []
        });
        let pane = make_pane(state);
        let blocks = pane.view();
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("DISPATCH QUEUE"))),
            "no dispatch section when daemon omits it"
        );
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::Header(h) if h.contains("BUDGET LEDGER"))),
            "no budget section when daemon omits it"
        );
        // Guard unavailable badge still renders.
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Chip { label, .. } if label.contains("unavailable"))),
            "guard unavailable badge"
        );
    }
}
