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
use crate::util::{arr, n, s, trunc};
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
                if sched.is_empty() {
                    "manual".into()
                } else {
                    sched
                }
            }
        };
        let lifecycle = {
            let lc = s(v, "lifecycle");
            if lc.is_empty() {
                s(v, "status")
            } else {
                lc
            }
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
        Self {
            ships: Vec::new(),
            fleets_running: 0,
            last_error: None,
            approvals: Vec::new(),
        }
    }
}

impl FleetPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn count(&self, lifecycle: &str) -> usize {
        self.ships
            .iter()
            .filter(|sh| sh.lifecycle == lifecycle)
            .count()
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
            blocks.push(Block::KeyVal(
                "dry-dock".into(),
                format!("{drydock} — needs operator"),
            ));
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

            // Detail line: tier · backend · what it answers to.
            let tier = if sh.tier.is_empty() {
                "—".to_string()
            } else {
                sh.tier.clone()
            };
            blocks.push(Block::KeyVal(
                "  rig".into(),
                format!("{tier} · {} · {}", sh.backend, trunc(&sh.on, 28)),
            ));

            // Retry budget — only worth showing once a ship has stumbled.
            if sh.consecutive_failures > 0 {
                let retries = format!("{}/{}", sh.consecutive_failures, sh.max_respawns);
                let note = if sh.is_dry_dock() {
                    " (exhausted — dry-dock)"
                } else {
                    ""
                };
                blocks.push(Block::KeyVal(
                    "  retries".into(),
                    format!("{retries}{note}"),
                ));
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
                        self.last_error = Some(format!(
                            "GET /fleet → {status} (daemon may predate ship lifecycle)"
                        ));
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
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        // Error state must not also render ship rows.
        assert!(!blocks.iter().any(|b| matches!(b, Block::Flag { .. })));
    }

    #[test]
    fn view_populated_flags_ships_and_escalates_dry_dock() {
        let p = populated();
        let blocks = p.view();
        // Every ship hoists a maritime flag.
        let flag_count = blocks
            .iter()
            .filter(|b| matches!(b, Block::Flag { .. }))
            .count();
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
}
