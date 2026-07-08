//! Cloud Fleet pane — remote relay observability (Phase C).
//!
//! Unlike every other pane (which polls the LOCAL daemon), this one watches a
//! REMOTE Cloudflare relay: the cloud fleet-executor that reviews GitHub PRs.
//! Configure it with two env vars:
//!   - `PD_CONSOLE_RELAY_URL`   — e.g. `https://relay.port-daddy.dev`
//!   - `PD_CONSOLE_RELAY_TOKEN` — the operator bearer token
//! When either is unset the pane renders a clear "not configured" hint instead
//! of erroring — the console still boots without a relay.
//!
//! It reuses the shared `DaemonClient::http_client()` (a plain reqwest client) to
//! issue bearer-authenticated GETs against the operator-gated relay endpoints:
//!   - `GET /v1/fleet/health`            → paused flag, last-run age, DLQ depth
//!   - `GET /v1/fleet/activity?limit=30` → recent `fleet_runs` (PR review runs)
//!   - `GET /v1/fleet/config`            → declared ships (read-only prompts + roles)
//!
//! Render-agnostic on purpose (emits `Block`s); the GPUI and ratatui renderers
//! paint the same blocks in the locked maritime theme.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// One remote fleet run (a GitHub PR review the cloud executor performed).
#[derive(Debug, Clone)]
struct FleetRun {
    pr_number: i64,
    repo: String,
    conclusion: String,
    ships: Vec<String>,
    elapsed_ms: i64,
    /// Unix *seconds* (relay uses `unixepoch()`), not millis.
    created_at: i64,
}

impl FleetRun {
    fn from_value(v: &Value) -> Self {
        Self {
            pr_number: n(v, "prNumber"),
            repo: s(v, "repo"),
            conclusion: s(v, "conclusion"),
            ships: arr(v, "ships")
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect(),
            elapsed_ms: n(v, "elapsedMs"),
            created_at: n(v, "createdAt"),
        }
    }
}

/// One declared cloud ship (read-only prompt config from `/v1/fleet/config`).
#[derive(Debug, Clone)]
struct ShipPrompt {
    name: String,
    role: String,
}

/// One local HITL proposal packet awaiting operator approval.
#[derive(Debug, Clone)]
struct FleetProposal {
    id: String,
    title: String,
    source_ship: String,
    target_specialist: String,
    repo: String,
    pr_number: i64,
}

impl FleetProposal {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            title: s(v, "title"),
            source_ship: s(v, "sourceShip"),
            target_specialist: s(v, "targetSpecialist"),
            repo: s(v, "repoFullName"),
            pr_number: n(v, "prNumber"),
        }
    }
}

/// Conclusion → display tone (color resolves at paint time).
fn conclusion_tone(conclusion: &str) -> Tone {
    match conclusion {
        "success" => Tone::Landed,
        "failure" => Tone::Conflicted,
        "neutral" => Tone::Gated,
        _ => Tone::Resting,
    }
}

pub struct CloudFleetPane {
    relay_url: String,
    relay_token: String,
    ships: Vec<ShipPrompt>,
    activity: Vec<FleetRun>,
    pending_proposals: Vec<FleetProposal>,
    paused: bool,
    last_run_age_sec: Option<i64>,
    dlq_depth: Option<i64>,
    last_error: Option<String>,
    proposal_error: Option<String>,
}

impl Default for CloudFleetPane {
    fn default() -> Self {
        Self {
            relay_url: std::env::var("PD_CONSOLE_RELAY_URL").unwrap_or_default(),
            relay_token: std::env::var("PD_CONSOLE_RELAY_TOKEN").unwrap_or_default(),
            ships: Vec::new(),
            activity: Vec::new(),
            pending_proposals: Vec::new(),
            paused: false,
            last_run_age_sec: None,
            dlq_depth: None,
            last_error: None,
            proposal_error: None,
        }
    }
}

impl CloudFleetPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn is_configured(&self) -> bool {
        !self.relay_url.trim().is_empty()
    }

    /// Health is "alarmed" when the fleet is paused or the dead-letter queue has
    /// anything in it — both warrant the operator's attention.
    fn alarmed(&self) -> bool {
        self.paused || self.dlq_depth.map(|d| d > 0).unwrap_or(false)
    }

    fn push_pending_proposals(&self, blocks: &mut Vec<Block>) {
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Pending Proposals".into()));
        if let Some(err) = &self.proposal_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return;
        }
        if self.pending_proposals.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no ship proposals awaiting approval".into()));
            return;
        }
        for proposal in self.pending_proposals.iter().take(10) {
            let source = if proposal.repo.is_empty() {
                proposal.source_ship.clone()
            } else if proposal.pr_number > 0 {
                format!("{} · {} PR #{}", proposal.source_ship, proposal.repo, proposal.pr_number)
            } else {
                format!("{} · {}", proposal.source_ship, proposal.repo)
            };
            blocks.push(Block::Row(vec![
                trunc(&proposal.id, 8),
                trunc(&proposal.title, 44),
                trunc(&source, 34),
                trunc(&proposal.target_specialist, 22),
            ]));
            blocks.push(Block::Chip {
                label: format!("{} → approve/reject in FleetBar", trunc(&proposal.title, 72)),
                tone: Tone::Gated,
            });
        }
    }
}

/// Defensive GET → parsed JSON, returning a short error string on any failure so
/// the pane can render `last_error` instead of hard-failing (mirrors the daemon
/// panes' tolerance of schema/transport drift).
async fn fetch_json(
    daemon: &DaemonClient,
    url: &str,
    token: &str,
) -> std::result::Result<Value, String> {
    let mut req = daemon.http_client().get(url);
    if !token.trim().is_empty() {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Err(e) => Err(format!("relay unreachable: {e}")),
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("GET {url} → {status}"));
            }
            resp.json::<Value>()
                .await
                .map_err(|e| format!("bad response: {e}"))
        }
    }
}

impl Pane for CloudFleetPane {
    fn id(&self) -> &str {
        "cloud-fleet"
    }

    fn title(&self) -> String {
        "Cloud Fleet".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Cloud Fleet".into())];

        if !self.is_configured() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "not configured — set PD_CONSOLE_RELAY_URL / PD_CONSOLE_RELAY_TOKEN".into(),
            ));
            self.push_pending_proposals(&mut blocks);
            return blocks;
        }

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            blocks.push(Block::Chip {
                label: "relay unreachable".into(),
                tone: Tone::Gated,
            });
            self.push_pending_proposals(&mut blocks);
            return blocks;
        }

        // ── Health ───────────────────────────────────────────────────────────
        let alarmed = self.alarmed();
        blocks.push(Block::Chip {
            label: if self.paused {
                "PAUSED — kill switch engaged".into()
            } else {
                "running".into()
            },
            tone: if alarmed {
                Tone::Conflicted
            } else {
                Tone::Engaged
            },
        });
        if let Some(age) = self.last_run_age_sec {
            blocks.push(Block::KeyVal(
                "last run".into(),
                format!("{} ago", age_short(age * 1000)),
            ));
        } else {
            blocks.push(Block::KeyVal("last run".into(), "—".into()));
        }
        if let Some(dlq) = self.dlq_depth {
            blocks.push(Block::KeyVal(
                "dead-letter queue".into(),
                if dlq > 0 {
                    format!("{dlq} — needs operator")
                } else {
                    "0".into()
                },
            ));
        }

        // ── Local HITL proposals ──────────────────────────────────────────────
        self.push_pending_proposals(&mut blocks);

        // ── Recent runs (transitions / exceptions) ─────────────────────────────
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Recent Runs".into()));
        if self.activity.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no PR reviews yet".into()));
        } else {
            for run in self.activity.iter().take(20) {
                // age · PR # · repo · conclusion · elapsed.
                blocks.push(Block::Row(vec![
                    age_short(run.created_at * 1000),
                    format!("PR #{}", run.pr_number),
                    trunc(&run.repo, 24),
                    trunc(&run.conclusion, 10),
                    format!("{}ms", run.elapsed_ms),
                ]));
                // A conclusion chip carries the colored verdict for the run, plus
                // which ships reviewed it (the at-a-glance exception cue).
                blocks.push(Block::Chip {
                    label: if run.ships.is_empty() {
                        format!("PR #{}: {}", run.pr_number, run.conclusion)
                    } else {
                        format!(
                            "PR #{}: {} · {}",
                            run.pr_number,
                            run.conclusion,
                            run.ships.join(", ")
                        )
                    },
                    tone: conclusion_tone(&run.conclusion),
                });
            }
        }

        // ── Ship prompts (read-only) ───────────────────────────────────────────
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Ships".into()));
        if self.ships.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no ships declared in relay config".into(),
            ));
        } else {
            for ship in &self.ships {
                let role = if ship.role.is_empty() {
                    "—".to_string()
                } else {
                    trunc(&ship.role, 48)
                };
                blocks.push(Block::KeyVal(format!("• {}", trunc(&ship.name, 24)), role));
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Local proposal queue: always try it, even when the remote relay is
            // not configured. These packets live in the daemon DB and power the
            // Rust/FleetBar HITL surfaces.
            match fetch_json(
                daemon,
                &format!("{}/fleet-proposals?status=pending&limit=10", daemon.base()),
                "",
            ).await {
                Err(e) => {
                    self.proposal_error = Some(e);
                    self.pending_proposals.clear();
                }
                Ok(data) => {
                    self.proposal_error = None;
                    self.pending_proposals = arr(&data, "proposals")
                        .iter()
                        .map(FleetProposal::from_value)
                        .collect();
                }
            }

            // Unconfigured → no-op; view() shows the actionable hint instead.
            if !self.is_configured() {
                return Ok(());
            }
            let base = self.relay_url.trim_end_matches('/').to_string();
            let token = self.relay_token.clone();

            // Health.
            match fetch_json(daemon, &format!("{base}/v1/fleet/health"), &token).await {
                Err(e) => {
                    self.last_error = Some(e);
                    self.activity.clear();
                    self.ships.clear();
                    return Ok(());
                }
                Ok(data) => {
                    self.last_error = None;
                    self.paused = b(&data, "paused");
                    self.last_run_age_sec = match data.get("lastRunAgeSec") {
                        Some(Value::Number(x)) => x.as_i64(),
                        _ => None,
                    };
                    self.dlq_depth = match data.get("queueDepthEstimate") {
                        Some(Value::Number(x)) => x.as_i64(),
                        _ => None,
                    };
                }
            }

            // Recent activity (tolerated independently — a failure here keeps health).
            match fetch_json(
                daemon,
                &format!("{base}/v1/fleet/activity?limit=30"),
                &token,
            )
            .await
            {
                Err(e) => self.last_error = Some(e),
                Ok(data) => {
                    self.activity = arr(&data, "runs")
                        .iter()
                        .map(FleetRun::from_value)
                        .collect();
                }
            }

            // Ship config (read-only prompts/roles). Tolerate either {ships:[...]}
            // or {config:{ships:[...]}} drift; pull name + role defensively.
            match fetch_json(daemon, &format!("{base}/v1/fleet/config"), &token).await {
                Err(e) => self.last_error = Some(e),
                Ok(data) => {
                    let ships_val: &[Value] = if !arr(&data, "ships").is_empty() {
                        arr(&data, "ships")
                    } else if let Some(cfg) = data.get("config") {
                        arr(cfg, "ships")
                    } else {
                        &[]
                    };
                    self.ships = ships_val
                        .iter()
                        .map(|v| ShipPrompt {
                            name: s(v, "name"),
                            role: s(v, "role"),
                        })
                        .collect();
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

    fn configured() -> CloudFleetPane {
        let mut p = CloudFleetPane::default();
        p.relay_url = "https://relay.example.dev".into();
        p.relay_token = "tok".into();
        p
    }

    #[test]
    fn unconfigured_shows_hint_not_error() {
        let mut p = CloudFleetPane::default();
        p.relay_url = String::new();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Cloud Fleet"));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(_, v) if v.contains("PD_CONSOLE_RELAY_URL")
        )));
        // No error chip — absence of config is not a failure.
        assert!(!blocks.iter().any(|b| matches!(
            b,
            Block::Chip {
                tone: Tone::Gated,
                ..
            }
        )));
    }

    #[test]
    fn error_short_circuits() {
        let mut p = configured();
        p.last_error = Some("relay unreachable: boom".into());
        let blocks = p.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Chip {
                tone: Tone::Gated,
                ..
            }
        )));
    }

    #[test]
    fn paused_flips_health_chip_to_conflicted() {
        let mut p = configured();
        p.paused = true;
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Conflicted } if label.contains("PAUSED")
        )));
    }

    #[test]
    fn dlq_backlog_alarms_even_when_running() {
        let mut p = configured();
        p.dlq_depth = Some(3);
        assert!(p.alarmed());
        let blocks = p.view();
        // Running (not paused) but alarmed → the status chip is Conflicted.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Conflicted } if label == "running"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "dead-letter queue" && v.contains("needs operator")
        )));
    }

    #[test]
    fn run_from_value_parses_relay_shape() {
        let v = json!({
            "id": "uuid", "prNumber": 123, "repo": "owner/repo",
            "prUrl": "https://github.com/owner/repo/pull/123",
            "headSha": "abc123d", "conclusion": "success",
            "ships": ["linter", "qa"], "elapsedMs": 45000, "createdAt": 1719432000i64
        });
        let r = FleetRun::from_value(&v);
        assert_eq!(r.pr_number, 123);
        assert_eq!(r.repo, "owner/repo");
        assert_eq!(r.conclusion, "success");
        assert_eq!(r.ships, vec!["linter".to_string(), "qa".to_string()]);
        assert_eq!(r.elapsed_ms, 45000);
    }

    #[test]
    fn conclusion_tones_map() {
        assert!(matches!(conclusion_tone("success"), Tone::Landed));
        assert!(matches!(conclusion_tone("failure"), Tone::Conflicted));
        assert!(matches!(conclusion_tone("neutral"), Tone::Gated));
        assert!(matches!(conclusion_tone("cancelled"), Tone::Resting));
    }

    #[test]
    fn view_populated_renders_runs_and_ships() {
        let mut p = configured();
        p.activity = vec![FleetRun {
            pr_number: 7,
            repo: "port-daddy/relay".into(),
            conclusion: "failure".into(),
            ships: vec!["linter".into()],
            elapsed_ms: 12345,
            created_at: 1719432000,
        }];
        p.ships = vec![ShipPrompt {
            name: "linter".into(),
            role: "style + lint review".into(),
        }];
        p.pending_proposals = vec![FleetProposal {
            id: "proposal-abc123".into(),
            title: "Assign a UI expert to the shader console".into(),
            source_ship: "spark".into(),
            target_specialist: "ui-expert".into(),
            repo: "curiositech/port-daddy".into(),
            pr_number: 642,
        }];
        let blocks = p.view();
        // A row per run + a colored verdict chip.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Row(cells) if cells[1] == "PR #7")));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { tone: Tone::Conflicted, label } if label.contains("PR #7")
        )));
        // The ship prompt is listed read-only.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k.contains("linter") && v.contains("lint")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.iter().any(|c| c.contains("UI expert"))
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Gated } if label.contains("approve/reject")
        )));
    }

    #[test]
    fn unconfigured_still_renders_local_proposals() {
        let mut p = CloudFleetPane::default();
        p.relay_url = String::new();
        p.pending_proposals = vec![FleetProposal {
            id: "proposal-1".into(),
            title: "Spider combines docs and SDK into a build".into(),
            source_ship: "spider".into(),
            target_specialist: "documentarian".into(),
            repo: String::new(),
            pr_number: 0,
        }];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Header(h) if h == "Pending Proposals"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.iter().any(|c| c.contains("Spider"))
        )));
    }
}
