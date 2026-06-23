//! Conductor pane — the live face of the Daemon Fleet Conductor (ADR-0060).
//!
//! The Fleet roster pane (`fleet_pane.rs`) shows *agents* (`GET /agents`). This
//! pane shows the *control plane*: every launch the Conductor is shepherding
//! through `proposed → admitted → embodied → running → settled | halted`, the
//! lineage that binds them, and the bond/cost each carries. It is the thing an
//! operator watches to answer "what is the fleet spending, and on whose say-so?"
//! and the surface the `pd fleet halt|pause|resume` verbs act on.
//!
//! Calls `GET /fleet/conductor` (added with ADR-0060): a flat, newest-first list
//! of launches across every root. We group by `rootId` and indent by `depth` to
//! reconstruct the lineage trees the CLI renders one-at-a-time via `pd fleet tree`.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct LaunchEntry {
    pub id: String,
    pub root_id: String,
    pub depth: i64,
    pub goal: String,
    pub source: String,
    pub backend: String,
    pub state: String,
    pub bond_usd: Option<f64>,
    pub cost_usd: Option<f64>,
    pub refused_reason: String,
    pub created_at: i64,
}

impl LaunchEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            root_id: s(v, "rootId"),
            depth: n(v, "depth"),
            goal: s(v, "goal"),
            source: s(v, "source"),
            backend: s(v, "backend"),
            state: s(v, "state"),
            bond_usd: v.get("bondUsd").and_then(Value::as_f64),
            cost_usd: v.get("costUsd").and_then(Value::as_f64),
            refused_reason: s(v, "refusedReason"),
            created_at: n(v, "createdAt"),
        }
    }
}

/// Semantic tone + glyph for a launch state. Color = MEANING (the renderer maps
/// `Tone` to the locked theme OKLCH); the glyph keeps it legible in mono/no-color.
fn state_style(state: &str) -> (Tone, &'static str) {
    match state {
        "proposed" => (Tone::Resting, "·"),
        "admitted" => (Tone::Gated, "○"),
        "embodied" => (Tone::Accent, "◐"),
        "running" => (Tone::Engaged, "●"),
        "produced" | "review_pending" => (Tone::Accent, "◑"),
        "settled" => (Tone::Landed, "✓"),
        "halted" => (Tone::Conflicted, "■"),
        "refused" => (Tone::Conflicted, "✗"),
        _ => (Tone::Default, "?"),
    }
}

fn is_terminal(state: &str) -> bool {
    matches!(state, "settled" | "halted" | "refused")
}

/// The active lineage the operator's fleet-control gate acts on — the Conductor
/// analogue of `DispatchHead`. `head()` picks the first root with a non-terminal
/// launch, so Halt/Pause/Resume target *that* lineage, not the whole fleet.
#[derive(Debug, Clone)]
pub struct ConductorHead {
    pub root_id: String,
    pub label: String,
    pub running: usize,
    pub roots: usize,
}

pub struct ConductorPane {
    pub launches: Vec<LaunchEntry>,
    last_error: Option<String>,
    wired: bool,
}

impl Default for ConductorPane {
    fn default() -> Self {
        Self { launches: Vec::new(), last_error: None, wired: true }
    }
}

impl ConductorPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn money(v: Option<f64>) -> String {
        match v {
            Some(x) => format!("${x:.2}"),
            None => "—".into(),
        }
    }

    /// The active lineage the operator gate should target — the first root with a
    /// non-terminal launch. `None` when the fleet is idle (gate falls back to
    /// whole-fleet scope).
    pub fn head(&self) -> Option<ConductorHead> {
        let mut roots: Vec<String> = Vec::new();
        for l in &self.launches {
            if !roots.contains(&l.root_id) {
                roots.push(l.root_id.clone());
            }
        }
        for root in &roots {
            let running = self
                .launches
                .iter()
                .filter(|l| &l.root_id == root && !is_terminal(&l.state))
                .count();
            if running > 0 {
                let label = self
                    .launches
                    .iter()
                    .find(|l| &l.root_id == root && l.depth == 0)
                    .map(|l| if l.goal.is_empty() { l.id.clone() } else { l.goal.clone() })
                    .unwrap_or_else(|| root.clone());
                return Some(ConductorHead { root_id: root.clone(), label, running, roots: roots.len() });
            }
        }
        None
    }
}

impl Pane for ConductorPane {
    fn id(&self) -> &str {
        "conductor"
    }

    fn title(&self) -> String {
        "Conductor".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Conductor — Fleet Lineage".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }
        if !self.wired {
            blocks.push(Block::KeyVal(
                "conductor".into(),
                "not wired on this daemon (ADR-0060 — needs a rebuild)".into(),
            ));
            return blocks;
        }
        if self.launches.is_empty() {
            blocks.push(Block::Chip { label: "no launches — fleet idle".into(), tone: Tone::Resting });
            blocks.push(Block::KeyVal(
                "control".into(),
                "pd fleet halt|pause|resume <root> · tree <root>".into(),
            ));
            return blocks;
        }

        // Group by root, newest root first; within a root, ascending depth/time so
        // the lineage reads parent → child top-down.
        let mut roots: Vec<String> = Vec::new();
        for l in &self.launches {
            if !roots.contains(&l.root_id) {
                roots.push(l.root_id.clone());
            }
        }

        let mut active = 0usize;
        let mut total_cost = 0.0f64;
        let mut halted = 0usize;

        for root in &roots {
            let mut kids: Vec<&LaunchEntry> =
                self.launches.iter().filter(|l| &l.root_id == root).collect();
            kids.sort_by_key(|l| (l.depth, l.created_at));

            blocks.push(Block::Gap);
            let root_cost: f64 = kids.iter().filter_map(|l| l.cost_usd).sum();
            blocks.push(Block::Row(vec![
                "root".into(),
                trunc(root, 28),
                format!("{} launch(es)", kids.len()),
                format!("${root_cost:.2}"),
            ]));

            for l in &kids {
                let (tone, glyph) = state_style(&l.state);
                if l.state == "halted" {
                    halted += 1;
                }
                if !is_terminal(&l.state) {
                    active += 1;
                }
                if let Some(c) = l.cost_usd {
                    total_cost += c;
                }
                let indent = "  ".repeat((l.depth.max(0) as usize) + 1);
                let label = if l.goal.is_empty() { trunc(&l.id, 28) } else { trunc(&l.goal, 40) };
                blocks.push(Block::Row(vec![
                    format!("{indent}{glyph}"),
                    label,
                    l.backend.clone(),
                    l.source.clone(),
                    format!("bond {} · cost {}", Self::money(l.bond_usd), Self::money(l.cost_usd)),
                ]));
                blocks.push(Block::Chip { label: l.state.clone(), tone });
                if !l.refused_reason.is_empty() {
                    blocks.push(Block::KeyVal(
                        format!("{indent}refused"),
                        trunc(&l.refused_reason, 60),
                    ));
                }
            }
        }

        blocks.push(Block::Gap);
        let tone = if active > 0 { Tone::Engaged } else { Tone::Resting };
        blocks.push(Block::Chip {
            label: format!(
                "{} active · {} root(s) · {} halted · ${:.2} spent",
                active,
                roots.len(),
                halted,
                total_cost
            ),
            tone,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/fleet/conductor", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.launches.clear();
                }
                Ok(resp) => {
                    // 503 = no conductor wired (legacy/test daemon without ADR-0060).
                    if resp.status().as_u16() == 503 {
                        self.wired = false;
                        self.last_error = None;
                        self.launches.clear();
                        return Ok(());
                    }
                    match resp.json::<Value>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.wired = true;
                            self.last_error = None;
                            self.launches =
                                arr(&data, "launches").iter().map(LaunchEntry::from_value).collect();
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
    use serde_json::json;

    fn sample() -> Value {
        json!({
            "launches": [
                { "id": "L-root", "rootId": "L-root", "depth": 0, "goal": "ship the conductor",
                  "source": "sortie", "backend": "cli:claude-code", "state": "running",
                  "bondUsd": 0.25, "costUsd": 0.11, "createdAt": 1781120000000i64 },
                { "id": "L-child", "rootId": "L-root", "depth": 1, "goal": "write tests",
                  "source": "agent", "backend": "cli:codex", "state": "settled",
                  "bondUsd": 0.10, "costUsd": 0.04, "createdAt": 1781120500000i64 },
                { "id": "L-ref", "rootId": "L-root", "depth": 1, "goal": "spawn on main",
                  "source": "agent", "backend": "cli:codex", "state": "refused",
                  "bondUsd": null, "costUsd": null, "refusedReason": "NO_SPAWN_ON_MAIN",
                  "createdAt": 1781120600000i64 }
            ]
        })
    }

    #[test]
    fn parses_and_groups() {
        let mut p = ConductorPane::new();
        p.launches = arr(&sample(), "launches").iter().map(LaunchEntry::from_value).collect();
        assert_eq!(p.launches.len(), 3);
        assert_eq!(p.launches[0].state, "running");
        assert_eq!(p.launches[0].cost_usd, Some(0.11));
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Conductor — Fleet Lineage"));
        // a refused launch surfaces its reason
        assert!(blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("refused"))));
        // footer chip reports active count (running = 1 active; settled/refused terminal)
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, .. } if label.contains("1 active"))));
    }

    #[test]
    fn head_targets_the_first_active_lineage() {
        let mut p = ConductorPane::new();
        p.launches = arr(&sample(), "launches").iter().map(LaunchEntry::from_value).collect();
        let h = p.head().expect("an active lineage exists");
        assert_eq!(h.root_id, "L-root");           // the running root
        assert_eq!(h.label, "ship the conductor"); // its depth-0 goal
        assert_eq!(h.running, 1);                  // one non-terminal (the root; child is settled)
        assert_eq!(h.roots, 1);
    }

    #[test]
    fn head_is_none_when_idle() {
        let p = ConductorPane::new();
        assert!(p.head().is_none());
    }

    #[test]
    fn empty_is_idle() {
        let p = ConductorPane::new();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, .. } if label.contains("idle"))));
    }

    #[test]
    fn unwired_daemon_is_explained() {
        let mut p = ConductorPane::new();
        p.wired = false;
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::KeyVal(_, v) if v.contains("not wired"))));
    }
}
