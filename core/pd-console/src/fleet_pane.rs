//! Fleet pane — declarative ships from `pd-fleet.yml` with live lifecycle state.
//!
//! Calls `GET /fleet` on the daemon. Response shape (v3.22):
//! `{ success, running, fleets: [{ project, agents: [{ name, type, status,
//!    lifecycle, backend, modelTier, trigger, schedule, consecutiveFailures,
//!    maxRespawns, backoffUntil, queueDepth, ... }] }], ... }` — many fields nullable.
//!
//! This pane is the operator's fleet lifecycle board, NOT the generic running-agent
//! roster (that was the old `GET /agents` view). Each *ship* is a declared agent; its
//! `lifecycle` is the daemon-derived state — `sailing` / `cooldown` / `dry-dock` /
//! `paused` / `idle` — resolved here to an ICS maritime flag.

use crate::agent::DaemonClient;
use crate::maritime::flag_for_state;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// One declared ship (fleet agent) plus its live lifecycle state.
#[derive(Debug, Clone)]
pub struct ShipEntry {
    pub project: String,
    pub name: String,
    /// Derived lifecycle: sailing | cooldown | dry-dock | paused | queued | armed | idle.
    pub lifecycle: String,
    /// trigger type: scheduled | triggered | manual.
    pub kind: String,
    pub backend: String,
    /// low | mid | high (empty when the ship pins an explicit model — discouraged).
    pub tier: String,
    /// Channel or cron the ship listens on (for display).
    pub on: String,
    pub consecutive_failures: i64,
    pub max_respawns: i64,
    pub queue_depth: i64,
    // ── Full config (the operator's ship-detail view; GET /fleet P2) ──
    /// Pinned model id (empty when the ship uses a tier instead).
    pub model: String,
    /// The ship's actual task/instructions.
    pub prompt: String,
    /// Coordination identity ("{project}:fleet:<name>").
    pub identity: String,
    /// Tool allowlist string.
    pub allowed_tools: String,
    pub singleton: bool,
    pub worktree: bool,
    pub cooldown_ms: i64,
    /// Fleet-level daily cost ceiling that governs this ship (USD/day).
    pub daily_budget_usd: f64,
}

impl ShipEntry {
    fn from_value(project: &str, v: &Value) -> Self {
        // The trigger/schedule the ship answers to — whichever is set.
        let on = {
            let trig = s(v, "trigger");
            if !trig.is_empty() {
                trig
            } else {
                let sched = s(v, "schedule");
                if sched.is_empty() { "manual".into() } else { sched }
            }
        };
        let lifecycle = {
            let lc = s(v, "lifecycle");
            if lc.is_empty() { s(v, "status") } else { lc }
        };
        Self {
            project: project.to_string(),
            name: s(v, "name"),
            lifecycle,
            kind: s(v, "type"),
            backend: s(v, "backend"),
            tier: s(v, "modelTier"),
            on,
            consecutive_failures: n(v, "consecutiveFailures"),
            max_respawns: n(v, "maxRespawns"),
            queue_depth: n(v, "queueDepth"),
            model: s(v, "model"),
            prompt: s(v, "prompt"),
            identity: s(v, "identity"),
            allowed_tools: s(v, "allowedTools"),
            singleton: b(v, "singleton"),
            worktree: b(v, "worktree"),
            cooldown_ms: n(v, "cooldownMs"),
            daily_budget_usd: v.get("dailyBudgetUsd").and_then(|x| x.as_f64()).unwrap_or(0.0),
        }
    }

    fn is_dry_dock(&self) -> bool {
        self.lifecycle == "dry-dock" || self.lifecycle == "drydock"
    }
}

/// Map a lifecycle string to a display tone (color resolves at paint time).
fn lifecycle_tone(lifecycle: &str) -> Tone {
    match lifecycle {
        "sailing" | "running" => Tone::Engaged,
        "dry-dock" | "drydock" => Tone::Conflicted,
        "cooldown" | "failing" | "queued" => Tone::Gated,
        _ => Tone::Resting,
    }
}

/// Human cooldown like "30m" / "2h" / "1500ms" for the ship config view.
fn fmt_cooldown(ms: i64) -> String {
    if ms >= 3_600_000 {
        format!("{}h", ms / 3_600_000)
    } else if ms >= 60_000 {
        format!("{}m", ms / 60_000)
    } else if ms >= 1_000 {
        format!("{}s", ms / 1_000)
    } else {
        format!("{ms}ms")
    }
}

pub struct FleetPane {
    pub ships: Vec<ShipEntry>,
    fleets_running: usize,
    last_error: Option<String>,
    /// Spawns held by the ADR-0093 trust gate — the operator's HITL queue.
    /// Rendered ABOVE everything else: a pending human gate is unmissable.
    pub approvals: Vec<ApprovalEntry>,
}

/// One held spawn approval (GET /fleet/approvals).
#[derive(Debug, Clone)]
pub struct ApprovalEntry {
    pub id: String,
    pub agent: String,
    pub trigger: String,
    pub tier: String,
    pub project: String,
    pub age_min: i64,
}

impl ApprovalEntry {
    fn from_value(v: &Value, now_ms: i64) -> Self {
        let ts = n(v, "timestamp");
        Self {
            id: s(v, "id"),
            agent: s(v, "agent"),
            trigger: s(v, "trigger"),
            tier: s(v, "tier"),
            project: s(v, "project"),
            age_min: ((now_ms - ts) / 60_000).max(0),
        }
    }
}

impl Default for FleetPane {
    fn default() -> Self {
        Self { ships: Vec::new(), fleets_running: 0, last_error: None, approvals: Vec::new() }
    }
}

impl FleetPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn count(&self, lifecycle: &str) -> usize {
        self.ships.iter().filter(|sh| sh.lifecycle == lifecycle).count()
    }
}

impl Pane for FleetPane {
    fn id(&self) -> &str {
        "fleet"
    }

    fn title(&self) -> String {
        "Fleet".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Fleet — Ship Lifecycle".into())];

        // HITL queue leads the pane: spawns the trust gate is holding for a
        // human decision. Shown before errors/empty-states so it cannot be
        // missed while the queue is non-empty.
        if !self.approvals.is_empty() {
            blocks.push(Block::Chip {
                label: format!(
                    "HITL — {} spawn approval{} waiting",
                    self.approvals.len(),
                    if self.approvals.len() == 1 { "" } else { "s" }
                ),
                tone: Tone::Conflicted,
            });
            for a in &self.approvals {
                blocks.push(Block::Row(vec![
                    trunc(&a.id, 12),
                    format!("{} ← {}", a.agent, a.trigger),
                    a.tier.replace('_', " ").to_lowercase(),
                    a.project.clone(),
                    format!("{}m", a.age_min),
                ]));
            }
            blocks.push(Block::KeyVal(
                "decide".into(),
                "pd fleet approve <id> · pd fleet reject <id> --feedback \"<why>\"".into(),
            ));
        }

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.ships.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                if self.fleets_running == 0 {
                    "no fleet running — `pd fleet up` to launch ships".into()
                } else {
                    "fleet running, but pd-fleet.yml declares no ships".into()
                },
            ));
            return blocks;
        }

        let sailing = self.count("sailing");
        let drydock = self.ships.iter().filter(|sh| sh.is_dry_dock()).count();
        let cooldown = self.count("cooldown");
        blocks.push(Block::KeyVal("ships".into(), self.ships.len().to_string()));
        blocks.push(Block::KeyVal("sailing".into(), sailing.to_string()));
        if drydock > 0 {
            // Dry-dock means retries are exhausted — surface it as an escalation line.
            blocks.push(Block::KeyVal("dry-dock".into(), format!("{drydock} — needs operator")));
        }
        blocks.push(Block::Gap);

        for sh in &self.ships {
            let flag = flag_for_state(&sh.lifecycle);
            let callsign = if sh.project.is_empty() {
                trunc(&sh.name, 28)
            } else {
                format!("{}/{}", trunc(&sh.project, 14), trunc(&sh.name, 20))
            };
            blocks.push(Block::Flag {
                letter: flag.letter(),
                label: format!("{callsign}  ·  {}", sh.lifecycle),
                tone: lifecycle_tone(&sh.lifecycle),
            });

            // Full ship config as distinct labeled fields. ("rig" was meaningless
            // jargon; the operator asked "why can't I see the ship configs".)
            blocks.push(Block::KeyVal("  backend".into(), sh.backend.clone()));
            let model = if !sh.model.is_empty() {
                sh.model.clone()
            } else if !sh.tier.is_empty() {
                format!("{} tier", sh.tier)
            } else {
                "default".into()
            };
            blocks.push(Block::KeyVal("  model".into(), model));
            let trig_label = if sh.kind.is_empty() { "trigger".to_string() } else { format!("{} trigger", sh.kind) };
            blocks.push(Block::KeyVal(
                format!("  {trig_label}"),
                if sh.on.is_empty() { "manual".into() } else { sh.on.clone() },
            ));
            if sh.cooldown_ms > 0 {
                blocks.push(Block::KeyVal("  cooldown".into(), fmt_cooldown(sh.cooldown_ms)));
            }
            if sh.daily_budget_usd > 0.0 {
                blocks.push(Block::KeyVal("  cost cap".into(), format!("${:.2}/day (fleet)", sh.daily_budget_usd)));
            }
            if !sh.allowed_tools.is_empty() {
                blocks.push(Block::KeyVal("  tools".into(), trunc(&sh.allowed_tools, 56)));
            }
            let mut flags: Vec<&str> = Vec::new();
            if sh.singleton {
                flags.push("singleton");
            }
            if sh.worktree {
                flags.push("worktree");
            }
            if !flags.is_empty() {
                blocks.push(Block::KeyVal("  flags".into(), flags.join(" · ")));
            }
            if !sh.identity.is_empty() {
                blocks.push(Block::KeyVal("  identity".into(), sh.identity.clone()));
            }
            if !sh.prompt.is_empty() {
                // The prompt is the ship's real instructions — show a wrapped
                // preview so the config is genuinely visible, not hidden behind a
                // row that looks clickable but does nothing.
                // Normalize whitespace into a BOUNDED preview without collecting the
                // whole prompt every render tick (ship prompts can be long).
                let mut preview = String::with_capacity(248);
                for word in sh.prompt.split_whitespace() {
                    if !preview.is_empty() {
                        preview.push(' ');
                    }
                    preview.push_str(word);
                    if preview.len() >= 240 {
                        break;
                    }
                }
                blocks.push(Block::WrappedText {
                    text: format!("prompt: {}", trunc(&preview, 240)),
                    tone: Tone::Resting,
                });
            }

            // Retry budget — only worth showing once a ship has stumbled.
            if sh.consecutive_failures > 0 {
                let retries = format!("{}/{}", sh.consecutive_failures, sh.max_respawns);
                let note = if sh.is_dry_dock() { " (exhausted — dry-dock)" } else { "" };
                blocks.push(Block::KeyVal("  retries".into(), format!("{retries}{note}")));
            }
            if sh.queue_depth > 0 {
                blocks.push(Block::KeyVal("  queued".into(), sh.queue_depth.to_string()));
            }
        }

        blocks.push(Block::Gap);
        let footer_tone = if drydock > 0 {
            Tone::Conflicted
        } else if sailing > 0 {
            Tone::Engaged
        } else {
            Tone::Resting
        };
        blocks.push(Block::Chip {
            label: format!(
                "{sailing} sailing · {cooldown} cooldown · {drydock} dry-dock · {} ships",
                self.ships.len()
            ),
            tone: footer_tone,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // HITL queue first (tolerant: an older daemon without the route
            // just leaves the queue empty — never an error).
            let approvals_url = format!("{}/fleet/approvals", daemon.base());
            self.approvals = match daemon.http_client().get(&approvals_url).send().await {
                Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                    Ok(data) => {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        arr(&data, "proposals")
                            .iter()
                            .map(|p| ApprovalEntry::from_value(p, now_ms))
                            .collect()
                    }
                    Err(_) => Vec::new(),
                },
                _ => Vec::new(),
            };

            let url = format!("{}/fleet", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.ships.clear();
                    self.fleets_running = 0;
                }
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        self.last_error =
                            Some(format!("GET /fleet → {status} (daemon may predate ship lifecycle)"));
                        self.ships.clear();
                        self.fleets_running = 0;
                        return Ok(());
                    }
                    match resp.json::<Value>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            let fleets = arr(&data, "fleets");
                            self.fleets_running = fleets.len();
                            let mut ships = Vec::new();
                            for fleet in fleets {
                                let project = s(fleet, "project");
                                for agent in arr(fleet, "agents") {
                                    ships.push(ShipEntry::from_value(&project, agent));
                                }
                            }
                            self.ships = ships;
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

    fn populated() -> FleetPane {
        let mut p = FleetPane::default();
        p.fleets_running = 1;
        p.ships = vec![
            ShipEntry {
                project: "port-daddy".into(),
                name: "simplifier".into(),
                lifecycle: "sailing".into(),
                kind: "triggered".into(),
                backend: "claude-cli".into(),
                tier: "mid".into(),
                on: "git:committed".into(),
                consecutive_failures: 0,
                max_respawns: 3,
                queue_depth: 0,
                model: String::new(),
                prompt: "Simplify recently changed files without changing behavior.".into(),
                identity: "port-daddy:fleet:simplifier".into(),
                allowed_tools: "Read,Grep,Edit".into(),
                singleton: true,
                worktree: true,
                cooldown_ms: 900_000,
                daily_budget_usd: 8.5,
            },
            ShipEntry {
                project: "port-daddy".into(),
                name: "qa-adversary".into(),
                lifecycle: "dry-dock".into(),
                kind: "triggered".into(),
                backend: "codex".into(),
                tier: "high".into(),
                on: "git:committed".into(),
                consecutive_failures: 3,
                max_respawns: 3,
                queue_depth: 0,
                model: String::new(),
                prompt: String::new(),
                identity: String::new(),
                allowed_tools: String::new(),
                singleton: false,
                worktree: false,
                cooldown_ms: 0,
                daily_budget_usd: 0.0,
            },
        ];
        p
    }

    #[test]
    fn from_value_tolerates_nulls_and_derives_on() {
        let v = json!({
            "name": "docs", "type": "scheduled", "status": "armed",
            "lifecycle": null, "backend": "claude", "modelTier": null,
            "trigger": null, "schedule": "0 9 * * *",
            "consecutiveFailures": 0, "maxRespawns": 3, "queueDepth": 0
        });
        let sh = ShipEntry::from_value("port-daddy", &v);
        assert_eq!(sh.name, "docs");
        assert_eq!(sh.lifecycle, "armed"); // falls back to status when lifecycle null
        assert_eq!(sh.on, "0 9 * * *"); // schedule used when no trigger
        assert_eq!(sh.tier, ""); // null tier → empty
        assert_eq!(sh.prompt, ""); // config fields tolerate absence
        assert!(!sh.singleton);
        assert_eq!(sh.cooldown_ms, 0);
    }

    #[test]
    fn view_empty_guides_the_operator() {
        let p = FleetPane::default();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Fleet — Ship Lifecycle"));
        // Empty + no fleet running → actionable guidance, not a blank pane.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(_, v) if v.contains("pd fleet up")
        )));
    }

    #[test]
    fn view_error_short_circuits() {
        let mut p = FleetPane::default();
        p.last_error = Some("daemon unreachable: boom".into());
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        // Error state must not also render ship rows.
        assert!(!blocks.iter().any(|b| matches!(b, Block::Flag { .. })));
    }

    #[test]
    fn view_populated_flags_ships_and_escalates_dry_dock() {
        let p = populated();
        let blocks = p.view();
        // Every ship hoists a maritime flag.
        let flag_count = blocks.iter().filter(|b| matches!(b, Block::Flag { .. })).count();
        assert_eq!(flag_count, 2, "one flag per ship");
        // The dry-dock ship is surfaced as an escalation line with the operator cue.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k.contains("dry-dock") && v.contains("needs operator")
        )));
        // Its exhausted retry budget is shown.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "  retries" && v.contains("3/3") && v.contains("exhausted")
        )));
        // The dry-dock ship's flag carries the Conflicted tone (attention).
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Flag { label, tone, .. }
            if label.contains("qa-adversary") && matches!(tone, Tone::Conflicted)
        )));
    }

    #[test]
    fn view_shows_full_ship_config_not_rig_jargon() {
        let p = populated();
        let blocks = p.view();
        // "rig" jargon is gone; config shows as distinct labeled fields.
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k.trim() == "rig")),
            "the meaningless 'rig' row must be gone"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::KeyVal(k, v) if k == "  backend" && v == "claude-cli")),
            "backend must be its own labeled field"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k == "  model")),
            "model must be its own labeled field"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("trigger"))),
            "trigger must be its own labeled field"
        );
        // The ship's actual prompt is visible — the operator's core ask.
        assert!(
            blocks.iter().any(|b| matches!(b, Block::WrappedText { text, .. } if text.contains("Simplify"))),
            "the ship's prompt must be shown"
        );
        // The fleet cost cap is surfaced.
        assert!(
            blocks.iter().any(|b| matches!(b, Block::KeyVal(k, v) if k == "  cost cap" && v.contains("8.50"))),
            "cost cap must be shown"
        );
    }
}
