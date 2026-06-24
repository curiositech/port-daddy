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

/// Tone for the spend bar by threshold: healthy (<75%) reads green (`Landed`),
/// nearing the cap (75–99%) reads amber (`Gated`), over/at the cap reads red
/// (`Conflicted`). The renderer resolves the Tone → OKLCH — no hex here.
fn spend_tone(pct: f64, over: bool) -> Tone {
    if over || pct >= 100.0 {
        Tone::Conflicted
    } else if pct >= 75.0 {
        Tone::Gated
    } else {
        Tone::Landed
    }
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

    /// 1 · HEADER / GUARD STRIP — an elevated Card holding the title, a guard
    /// Badge (enforcing=green / off=red), the project, freshness, and the fleet
    /// signal flag. The polished "AGENTIC CONTROL PLANE" header.
    fn header_blocks(&self, state: &Value, out: &mut Vec<Block>) {
        // The page title rides above the card (the section eyebrow).
        out.push(Block::Header("Operator — Agentic Control Plane".into()));

        let project = s(state, "project").unwrap_or_else(|| "(daemon default)".into());

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
                    ("Guard: off".to_string(), Tone::Conflicted)
                }
            }
            None => ("Guard: unknown".to_string(), Tone::Resting),
        };

        let mut children: Vec<Block> = vec![
            Block::Badge { label: guard_label, tone: guard_tone },
            Block::KeyVal("project".into(), project),
        ];

        // Snapshot freshness (epoch-ms → relative age), when present.
        if let Some(gen_at) = i(state, "generatedAt") {
            children.push(Block::KeyVal("snapshot".into(), crate::util::age_short(gen_at)));
        }

        // Fleet signal (the maritime coordination state) as a flagged action row.
        if let Some(sig) = state.get("fleetSignal").filter(|v| !v.is_null()) {
            if let (Some(code), Some(meaning)) = (s(sig, "code"), s(sig, "meaning")) {
                children.push(Block::ActionRow {
                    icon: code.chars().next(),
                    title: meaning,
                    subtitle: Some("fleet signal".into()),
                    action: None,
                    badge: None,
                });
            }
        }

        out.push(Block::Card {
            title: Some("Control Plane".into()),
            tone: guard_tone,
            children,
        });
    }

    /// 2 · NEEDS YOU — the prioritized triage, an `ActionRow` per item inside a
    /// Card: a P-badge by priority, the code's flag glyph, the human label, and
    /// the `pd …` action chip in monospace.
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
            out.push(Block::Card {
                title: Some("Needs you".into()),
                tone: Tone::Landed,
                children: vec![Block::Badge {
                    label: "No action required — fleet is clear".into(),
                    tone: Tone::Landed,
                }],
            });
            return;
        }

        // The card's overall tone tracks the loudest (lowest-priority-number) item.
        let top_priority = items
            .iter()
            .filter_map(|it| i(it, "priority"))
            .min()
            .unwrap_or(9);

        let mut rows: Vec<Block> = Vec::with_capacity(items.len());
        for item in &items {
            let code = s(item, "code").unwrap_or_else(|| "unknown".into());
            let label = s(item, "label").unwrap_or_default();
            let action = s(item, "action").unwrap_or_default();
            let priority = i(item, "priority").unwrap_or(9);
            let tone = priority_tone(priority);

            rows.push(Block::ActionRow {
                icon: Some(code_flag(&code)),
                title: label,
                subtitle: None,
                action: if action.is_empty() { None } else { Some(action) },
                badge: Some((format!("P{priority}"), tone)),
            });
        }

        out.push(Block::Card {
            title: Some("Needs you".into()),
            tone: priority_tone(top_priority),
            children: rows,
        });
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

        let card_tone = if review.is_empty() { Tone::Resting } else { Tone::Engaged };

        let render_entry = |entry: &Value, default_state: &str, rows: &mut Vec<Block>| {
            let title = s(entry, "title")
                .or_else(|| s(entry, "goal"))
                .unwrap_or_else(|| "(untitled)".into());
            let st = s(entry, "state").unwrap_or_else(|| default_state.into());
            let agent = s(entry, "agentId").unwrap_or_else(|| "-".into());
            // Review-pending reads as the loud Gated badge; open is the neutral
            // Engaged state — the state badge IS the right-aligned affordance.
            let tone = if st.contains("review") { Tone::Gated } else { Tone::Engaged };
            rows.push(Block::ActionRow {
                icon: None,
                title: truncate(&title, 56),
                subtitle: Some(format!("agent {agent}")),
                action: None,
                badge: Some((st, tone)),
            });
        };

        let mut rows: Vec<Block> = Vec::new();
        if review.is_empty() && open.is_empty() {
            rows.push(Block::Badge { label: "no dispatches".into(), tone: Tone::Resting });
        } else {
            for e in &review {
                render_entry(e, "awaiting_review", &mut rows);
            }
            for e in &open {
                render_entry(e, "open", &mut rows);
            }
            rows.push(Block::Badge {
                label: format!("{} awaiting review", review.len()),
                tone: card_tone,
            });
        }

        out.push(Block::Card {
            title: Some("Dispatch queue".into()),
            tone: card_tone,
            children: rows,
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

        let cap_str = cap.map(|c| format!("${c:.2}")).unwrap_or_else(|| "—".into());

        // The three stat tiles, side by side — big numbers, muted labels. The
        // MetricRow lets the GPU face flex TODAY · CAP · EVENTS edge-to-edge.
        let metric_tone = pct.map(|p| spend_tone(p, over)).unwrap_or(Tone::Engaged);
        let mut children: Vec<Block> = vec![Block::MetricRow(vec![
            ("TODAY".into(), format!("${today:.2}"), metric_tone),
            ("CAP".into(), cap_str, Tone::Default),
            ("EVENTS".into(), events.to_string(), Tone::Default),
        ])];

        // The REAL filled progress bar — fraction of cap, tone by threshold. The
        // renderer paints a track + tone-colored fill (no ████ text here).
        if let Some(p) = pct {
            let frac = (p / 100.0) as f32;
            let tone = spend_tone(p, over);
            let label = if over {
                format!("OVER BUDGET — {p:.0}% of cap")
            } else {
                format!("{p:.0}% of daily cap")
            };
            children.push(Block::Bar { fraction: frac, tone, label: Some(label) });
        }

        // RECENT SPEND — the latest cost events as action rows.
        let recent: Vec<Value> = budget
            .get("recentEvents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for ev in recent.iter().take(5) {
            let model = s(ev, "model").unwrap_or_else(|| "-".into());
            let proj = s(ev, "project").unwrap_or_else(|| "-".into());
            let cost = f(ev, "costUsd")
                .map(|c| format!("${c:.4}"))
                .unwrap_or_else(|| "-".into());
            children.push(Block::ActionRow {
                icon: None,
                title: model,
                subtitle: Some(proj),
                action: Some(cost),
                badge: None,
            });
        }

        out.push(Block::Card {
            title: Some("Budget ledger".into()),
            tone: metric_tone,
            children,
        });
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

    /// Flatten the block tree, descending into `Card` children, so assertions
    /// can find a nested Badge/ActionRow/Bar regardless of which Card holds it.
    /// (The rich vocabulary nests; the terminal/GPU faces both recurse, so the
    /// tests recurse too.)
    fn flatten(blocks: &[Block]) -> Vec<Block> {
        let mut out = Vec::new();
        for b in blocks {
            out.push(b.clone());
            if let Block::Card { children, .. } = b {
                out.extend(flatten(children));
            }
        }
        out
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
        let blocks = flatten(&pane.view());
        // The guard state is now a Badge inside the Control Plane card.
        let guard_badge = blocks.iter().find_map(|b| match b {
            Block::Badge { label, tone } if label.contains("Guard") => Some((label.clone(), *tone)),
            _ => None,
        });
        let (label, tone) = guard_badge.expect("guard badge present");
        assert_eq!(label, "Guard: enforcing");
        assert!(matches!(tone, Tone::Landed), "enforcing guard is the 'landed' (green) tone");
    }

    #[test]
    fn p0_item_gets_conflicted_tone_and_correct_flag() {
        let pane = make_pane(sample_state());
        let blocks = flatten(&pane.view());
        // The dispatch_review (P0) item is now an ActionRow: Foxtrot flag glyph,
        // a P0 badge in the conflicted tone, the human label as the title.
        let row = blocks.iter().find_map(|b| match b {
            Block::ActionRow { icon, title, badge, .. }
                if badge.as_ref().map(|(l, _)| l == "P0").unwrap_or(false) =>
            {
                Some((*icon, title.clone(), badge.clone().unwrap().1))
            }
            _ => None,
        });
        let (icon, title, tone) = row.expect("P0 action row present");
        assert_eq!(icon, Some('F'), "dispatch_review maps to Foxtrot");
        assert!(title.contains("awaiting review"), "title carries the human text: {title}");
        assert!(matches!(tone, Tone::Conflicted), "P0 is the loudest tone");
    }

    #[test]
    fn salvage_and_roadmap_actions_render_as_commands() {
        let pane = make_pane(sample_state());
        let blocks = flatten(&pane.view());
        // Every needsYou action lands in an ActionRow's monospace action chip.
        let actions: Vec<String> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::ActionRow { action, .. } => action.clone(),
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
        let blocks = flatten(&pane.view());
        // The dispatch is an ActionRow: state badge, title, "agent <id>" subtitle.
        let row = blocks.iter().find_map(|b| match b {
            Block::ActionRow { title, subtitle, badge, .. }
                if title.contains("Land the auth") =>
            {
                Some((title.clone(), subtitle.clone(), badge.clone()))
            }
            _ => None,
        });
        let (title, subtitle, badge) = row.expect("dispatch action row present");
        let (state, tone) = badge.expect("state badge present");
        assert_eq!(state, "awaiting_review", "state badge");
        assert!(matches!(tone, Tone::Gated), "review-pending is the loud Gated tone");
        assert!(title.contains("Land the auth refactor"), "title");
        assert_eq!(subtitle.as_deref(), Some("agent gardener-7"), "agent subtitle");
    }

    #[test]
    fn budget_metrics_and_bar_render() {
        let pane = make_pane(sample_state());
        let blocks = flatten(&pane.view());

        // TODAY · CAP · EVENTS as a MetricRow of (label, value, tone).
        let metrics = blocks.iter().find_map(|b| match b {
            Block::MetricRow(m) => Some(m.clone()),
            _ => None,
        });
        let m = metrics.expect("budget metric row");
        let by_label = |needle: &str| -> String {
            m.iter().find(|(l, _, _)| l == needle).map(|(_, v, _)| v.clone()).unwrap_or_default()
        };
        assert!(by_label("TODAY").contains("$3.24"), "today spend: {m:?}");
        assert!(by_label("CAP").contains("$5.00"), "daily cap: {m:?}");
        assert!(by_label("EVENTS").contains("47"), "event count: {m:?}");

        // The REAL progress bar at 64.8% → fraction ~0.648, label carries percent.
        let bar = blocks.iter().find_map(|b| match b {
            Block::Bar { fraction, label, .. } => Some((*fraction, label.clone())),
            _ => None,
        });
        let (fraction, label) = bar.expect("budget bar present");
        assert!((fraction - 0.648).abs() < 0.001, "fraction tracks percent: {fraction}");
        assert!(label.unwrap_or_default().contains("65% of daily cap"), "percent label");
    }

    #[test]
    fn budget_bar_tones_by_threshold_no_hardcoded_color() {
        // Healthy (<75%) → Landed (green); nearing (75–99%) → Gated (amber);
        // over → Conflicted (red). The Bar's tone is the toned affordance; color
        // is resolved by the renderer from the semantic Tone — never a hex here.
        let bar_tone = |pct: f64, over: bool| -> Tone {
            let mut state = sample_state();
            state["budget"]["status"]["percentUsed"] = serde_json::json!(pct);
            state["budget"]["status"]["overBudget"] = serde_json::json!(over);
            let pane = make_pane(state);
            flatten(&pane.view())
                .iter()
                .find_map(|b| match b {
                    Block::Bar { tone, .. } => Some(*tone),
                    _ => None,
                })
                .expect("budget bar present")
        };
        assert!(matches!(bar_tone(40.0, false), Tone::Landed), "healthy spend is green");
        assert!(matches!(bar_tone(85.0, false), Tone::Gated), "nearing the cap is amber");
        assert!(matches!(bar_tone(120.0, true), Tone::Conflicted), "over budget is red");
    }

    #[test]
    fn empty_needs_you_renders_clear_badge() {
        let mut state = sample_state();
        state["needsYou"] = serde_json::json!([]);
        let pane = make_pane(state);
        let view = pane.view();
        let blocks = flatten(&view);
        assert!(
            view.iter().any(|b| matches!(b, Block::Header(h) if h.contains("NEEDS YOU — 0 items"))),
            "zero-item header"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Badge { label, .. } if label.contains("clear"))),
            "clear badge"
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
        let view = pane.view();
        let blocks = flatten(&view);
        assert!(
            !view.iter().any(|b| matches!(b, Block::Header(h) if h.contains("DISPATCH QUEUE"))),
            "no dispatch section when daemon omits it"
        );
        assert!(
            !view.iter().any(|b| matches!(b, Block::Header(h) if h.contains("BUDGET LEDGER"))),
            "no budget section when daemon omits it"
        );
        // Guard unavailable badge still renders (now a Badge inside the card).
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Badge { label, .. } if label.contains("unavailable"))),
            "guard unavailable badge"
        );
    }
}
