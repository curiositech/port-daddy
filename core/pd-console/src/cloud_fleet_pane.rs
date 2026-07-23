//! Cloud Fleet pane — remote relay observability + operator control (Phase C).
//!
//! Unlike every other pane (which polls the LOCAL daemon), this one watches a
//! REMOTE Cloudflare relay: the cloud fleet-executor that reviews GitHub PRs.
//! Configure it with two operator secrets, resolved in this order:
//!   1. env `PD_CONSOLE_RELAY_URL` / `PD_CONSOLE_RELAY_TOKEN`
//!   2. `~/.port-daddy/console.env` (simple `KEY=VALUE` lines) as a fallback
//! When still unset the pane renders a clear, actionable "not configured" hint
//! (naming both vars AND the file path) instead of erroring — the console still
//! boots without a relay.
//!
//! It reuses the shared `DaemonClient::http_client()` (a plain reqwest client) to
//! issue bearer-authenticated calls against the operator-gated relay endpoints:
//!   - `GET  /v1/fleet/health`            → paused flag, last-run age, DLQ depth
//!   - `GET  /v1/fleet/activity?limit=N`  → recent `fleet_runs` (PR review runs)
//!   - `GET  /v1/fleet/config`            → declared ships (read-only prompts + roles)
//!   - `POST /v1/fleet/pause` `{paused}`  → operator kill switch (pause/resume)
//! and fetches local HITL proposals from the LOCAL daemon `/fleet-proposals`.
//!
//! Operator control (this pane is no longer read-only):
//!   - a pause/resume TOGGLE whose label reflects `health.paused`, dispatched via
//!     `mutate(SurfaceAction::Control { verb: "cloud-pause"|"cloud-resume" })`;
//!   - client-side PAGINATION over both the activity and proposals lists (a large
//!     window is fetched once; the pane pages it) so nothing is silently truncated.
//!
//! Render-agnostic on purpose (emits `Block`s); the GPUI and ratatui renderers
//! paint the same blocks in the locked maritime theme.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, SurfaceAction, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// Default rows per page for both paged lists (operator ruling: 25).
const DEFAULT_PAGE_SIZE: usize = 25;
/// One larger window we fetch from the relay/daemon, then page client-side. The
/// relay `/v1/fleet/activity` takes only `limit` (no offset/cursor), so paging
/// past this window is not possible without a relay change — this keeps a deep
/// scrollback available while staying one round-trip.
const FETCH_WINDOW: usize = 200;

/// The actionable hint shown when no relay is configured. Names the EXACT env
/// vars AND the fallback file to set them in — never a bare "set X / Y".
const CONFIG_HINT: &str = "not configured — set PD_CONSOLE_RELAY_URL and \
PD_CONSOLE_RELAY_TOKEN (env vars), or add them as KEY=VALUE lines to \
~/.port-daddy/console.env";

/// Which paged list an operator page action targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudFleetList {
    Activity,
    Proposals,
}

/// Pure pagination math over a list length — 0-based `page`, fixed `size`. No
/// I/O, no view coupling: unit-testable in isolation.
#[derive(Debug, Clone, Copy)]
struct Pager {
    page: usize,
    size: usize,
}

impl Pager {
    fn new(size: usize) -> Self {
        Self {
            page: 0,
            size: size.max(1),
        }
    }

    /// Total pages for `total` items — always at least 1 (an empty list is "page
    /// 1 of 1", never 0 pages).
    fn page_count(&self, total: usize) -> usize {
        if total == 0 {
            1
        } else {
            total.div_ceil(self.size)
        }
    }

    /// Keep `page` in range after the underlying list shrinks.
    fn clamp(&mut self, total: usize) {
        let last = self.page_count(total) - 1;
        if self.page > last {
            self.page = last;
        }
    }

    fn offset(&self) -> usize {
        self.page * self.size
    }

    /// 1-based inclusive `(start, end)` for a "showing start–end of total"
    /// indicator; `(0, 0)` when the list is empty.
    fn window(&self, total: usize) -> (usize, usize) {
        if total == 0 {
            return (0, 0);
        }
        let start = self.page * self.size;
        let end = ((self.page + 1) * self.size).min(total);
        (start + 1, end)
    }

    fn prev(&mut self) {
        if self.page > 0 {
            self.page -= 1;
        }
    }

    fn next(&mut self, total: usize) {
        if self.page + 1 < self.page_count(total) {
            self.page += 1;
        }
    }

    fn has_prev(&self) -> bool {
        self.page > 0
    }

    fn has_next(&self, total: usize) -> bool {
        self.page + 1 < self.page_count(total)
    }

    /// The slice of `items` this page covers (empty if the page is past the end).
    fn slice<'a, T>(&self, items: &'a [T]) -> &'a [T] {
        let start = self.offset().min(items.len());
        let end = (start + self.size).min(items.len());
        &items[start..end]
    }
}

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

/// Resolve `(relay_url, relay_token)`: env vars first, then the
/// `~/.port-daddy/console.env` fallback for whichever value the env didn't set.
fn resolve_relay_config() -> (String, String) {
    let mut url = std::env::var("PD_CONSOLE_RELAY_URL").unwrap_or_default();
    let mut token = std::env::var("PD_CONSOLE_RELAY_TOKEN").unwrap_or_default();
    if url.trim().is_empty() || token.trim().is_empty() {
        if let Some(map) = read_console_env() {
            if url.trim().is_empty() {
                if let Some(v) = map.get("PD_CONSOLE_RELAY_URL") {
                    url = v.clone();
                }
            }
            if token.trim().is_empty() {
                if let Some(v) = map.get("PD_CONSOLE_RELAY_TOKEN") {
                    token = v.clone();
                }
            }
        }
    }
    (url, token)
}

fn console_env_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".port-daddy/console.env"))
}

/// Read + parse `~/.port-daddy/console.env`. Any failure (missing file, unreadable
/// HOME) yields `None` — this is a best-effort fallback, never a hard error.
fn read_console_env() -> Option<std::collections::HashMap<String, String>> {
    let content = std::fs::read_to_string(console_env_path()?).ok()?;
    Some(parse_console_env(&content))
}

/// Pure `KEY=VALUE` parser: skips blank lines and `#` comments, tolerates an
/// `export ` prefix, trims whitespace, strips one layer of matching surrounding
/// quotes on the value. Last assignment wins on a duplicate key.
fn parse_console_env(content: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            if key.is_empty() {
                continue;
            }
            let mut val = v.trim();
            if val.len() >= 2 {
                let bytes = val.as_bytes();
                let first = bytes[0];
                let last = bytes[val.len() - 1];
                if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
                    val = &val[1..val.len() - 1];
                }
            }
            map.insert(key.to_string(), val.to_string());
        }
    }
    map
}

/// Build the `(url, body)` for a relay pause/resume POST — pure, so the URL
/// joining and body shape are unit-testable without a live relay.
fn pause_request(base: &str, paused: bool) -> (String, Value) {
    (
        format!("{}/v1/fleet/pause", base.trim_end_matches('/')),
        serde_json::json!({ "paused": paused }),
    )
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
    /// Per-section errors, tracked INDEPENDENTLY so one endpoint's failure never
    /// masks the others. `health` is the PRIMARY signal (it drives the pause
    /// toggle + top-line status); `activity` and `config` are secondary sections
    /// that degrade in place (a 500 on `/v1/fleet/config` — e.g. the relay's
    /// GitHub App creds are missing — must NOT hide the working reviewer control).
    health_error: Option<String>,
    activity_error: Option<String>,
    config_error: Option<String>,
    proposal_error: Option<String>,
    activity_pager: Pager,
    proposals_pager: Pager,
}

impl Default for CloudFleetPane {
    fn default() -> Self {
        let (relay_url, relay_token) = resolve_relay_config();
        Self {
            relay_url,
            relay_token,
            ships: Vec::new(),
            activity: Vec::new(),
            pending_proposals: Vec::new(),
            paused: false,
            last_run_age_sec: None,
            dlq_depth: None,
            health_error: None,
            activity_error: None,
            config_error: None,
            proposal_error: None,
            activity_pager: Pager::new(DEFAULT_PAGE_SIZE),
            proposals_pager: Pager::new(DEFAULT_PAGE_SIZE),
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

    /// Step a paged list. Local pane-state only — no daemon round-trip; the new
    /// window is reflected on the next view() render.
    pub fn page(&mut self, list: CloudFleetList, forward: bool) {
        match list {
            CloudFleetList::Activity => {
                let total = self.activity.len();
                if forward {
                    self.activity_pager.next(total);
                } else {
                    self.activity_pager.prev();
                }
            }
            CloudFleetList::Proposals => {
                let total = self.pending_proposals.len();
                if forward {
                    self.proposals_pager.next(total);
                } else {
                    self.proposals_pager.prev();
                }
            }
        }
    }

    /// Emit the "showing N–M of T" indicator plus prev/next controls for a paged
    /// list. Controls are honestly gated — disabled at the first/last page carry
    /// their reason (never a dead affordance).
    fn push_pager(&self, blocks: &mut Vec<Block>, list: CloudFleetList, pager: &Pager, total: usize) {
        let (start, end) = pager.window(total);
        blocks.push(Block::KeyVal(
            "showing".into(),
            if total == 0 {
                "0 of 0".into()
            } else {
                format!(
                    "{start}–{end} of {total} (page {}/{})",
                    pager.page + 1,
                    pager.page_count(total)
                )
            },
        ));
        let (prev_verb, next_verb) = match list {
            CloudFleetList::Activity => ("cloud-activity-prev", "cloud-activity-next"),
            CloudFleetList::Proposals => ("cloud-proposals-prev", "cloud-proposals-next"),
        };
        blocks.push(Block::ControlButton {
            verb: prev_verb.into(),
            label: "‹ Prev".into(),
            enabled: pager.has_prev(),
            why_disabled: if pager.has_prev() {
                None
            } else {
                Some("first page".into())
            },
            primary: false,
        });
        blocks.push(Block::ControlButton {
            verb: next_verb.into(),
            label: "Next ›".into(),
            enabled: pager.has_next(total),
            why_disabled: if pager.has_next(total) {
                None
            } else {
                Some("last page".into())
            },
            primary: false,
        });
    }

    fn push_pending_proposals(&self, blocks: &mut Vec<Block>) {
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Pending Proposals".into()));
        if let Some(err) = &self.proposal_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return;
        }
        let total = self.pending_proposals.len();
        if total == 0 {
            blocks.push(Block::KeyVal("status".into(), "no ship proposals awaiting approval".into()));
            return;
        }
        for proposal in self.proposals_pager.slice(&self.pending_proposals) {
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
        self.push_pager(blocks, CloudFleetList::Proposals, &self.proposals_pager, total);
    }

    /// Fold a `/v1/fleet/health` body into the pane's health fields.
    fn apply_health(&mut self, data: &Value) {
        self.paused = b(data, "paused");
        self.last_run_age_sec = data.get("lastRunAgeSec").and_then(Value::as_i64);
        self.dlq_depth = data.get("queueDepthEstimate").and_then(Value::as_i64);
    }
}

/// Defensive GET → parsed JSON, returning a short error string on any failure so
/// the pane can record a per-section error instead of hard-failing (mirrors the daemon
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

/// Defensive POST `{"paused": <bool>}` to `<base>/v1/fleet/pause` with bearer
/// auth. Returns a short error string on any failure (transport or non-2xx) so
/// the operator sees a real cause instead of a panic (mirrors [`fetch_json`]).
async fn relay_pause(
    daemon: &DaemonClient,
    base: &str,
    token: &str,
    paused: bool,
) -> std::result::Result<(), String> {
    let (url, body) = pause_request(base, paused);
    let mut req = daemon.http_client().post(&url).json(&body);
    if !token.trim().is_empty() {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Err(e) => Err(format!("relay unreachable: {e}")),
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("POST {url} → {status}"));
            }
            Ok(())
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
            blocks.push(Block::KeyVal("status".into(), CONFIG_HINT.into()));
            // Show the toggle so the affordance is discoverable — greyed, with an
            // honest reason (never a live button that silently no-ops).
            blocks.push(Block::ControlButton {
                verb: "cloud-pause".into(),
                label: "Pause reviewer".into(),
                enabled: false,
                why_disabled: Some("relay not configured".into()),
                primary: false,
            });
            self.push_pending_proposals(&mut blocks);
            return blocks;
        }

        // ── Health (PRIMARY signal) ────────────────────────────────────────────
        // Rendered on its OWN success/failure — a secondary section's failure
        // (activity, config) must never mask it. When health itself fails we can't
        // know the reviewer's paused state, so the pause toggle is disabled with a
        // reason; every other section still renders independently below.
        let health_ok = self.health_error.is_none();
        if let Some(err) = &self.health_error {
            blocks.push(Block::KeyVal("health".into(), format!("unavailable — {err}")));
            blocks.push(Block::Chip {
                label: "relay health unreachable".into(),
                tone: Tone::Gated,
            });
        } else {
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
        }

        // ── Operator kill switch: pause / resume the cloud reviewer ────────────
        // Driven by health.paused (which works even when /v1/fleet/config 500s).
        // The label reflects live health: "Pause reviewer" while running,
        // "Resume reviewer" while paused. Clicking POSTs the OPPOSITE state.
        // Disabled ONLY when health itself is unavailable (no confirmed state).
        if health_ok {
            let (verb, label) = if self.paused {
                ("cloud-resume", "Resume reviewer")
            } else {
                ("cloud-pause", "Pause reviewer")
            };
            blocks.push(Block::ControlButton {
                verb: verb.into(),
                label: label.into(),
                enabled: true,
                why_disabled: None,
                // Resuming a paused fleet is the primary call-to-action.
                primary: self.paused,
            });
        } else {
            blocks.push(Block::ControlButton {
                verb: "cloud-pause".into(),
                label: "Pause reviewer".into(),
                enabled: false,
                why_disabled: Some("health unavailable — cannot confirm reviewer state".into()),
                primary: false,
            });
        }

        // ── Local HITL proposals ──────────────────────────────────────────────
        self.push_pending_proposals(&mut blocks);

        // ── Recent runs (transitions / exceptions), paged — OWN failure line ───
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Recent Runs".into()));
        let total = self.activity.len();
        if let Some(err) = &self.activity_error {
            blocks.push(Block::KeyVal("status".into(), format!("activity unavailable — {err}")));
        } else if total == 0 {
            blocks.push(Block::KeyVal("status".into(), "no PR reviews yet".into()));
        } else {
            for run in self.activity_pager.slice(&self.activity) {
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
            self.push_pager(&mut blocks, CloudFleetList::Activity, &self.activity_pager, total);
        }

        // ── Ship prompts (read-only, SECONDARY) — own optional failure line ────
        // The relay's `/v1/fleet/config` can 500 independently (e.g. its GitHub
        // App creds are missing) while health + activity are fine. That is a
        // degraded nice-to-have, NOT a pane-wide outage: show a small line here
        // and leave every other section rendered normally above.
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Ships".into()));
        if let Some(err) = &self.config_error {
            blocks.push(Block::KeyVal(
                "status".into(),
                format!("ship config unavailable ({err})"),
            ));
        } else if self.ships.is_empty() {
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

    /// Operator mutation: pause / resume the CLOUD reviewer. Only
    /// `SurfaceAction::Control { verb: "cloud-pause"|"cloud-resume" }` is handled;
    /// anything else is a no-op. On success we re-fetch health so the toggle label
    /// flips to the confirmed state.
    fn mutate<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let SurfaceAction::Control { verb, .. } = action else {
                return Ok(());
            };
            let paused = match verb.as_str() {
                "cloud-pause" => true,
                "cloud-resume" => false,
                _ => return Ok(()),
            };
            if !self.is_configured() {
                return Err(anyhow::anyhow!(
                    "relay not configured — set PD_CONSOLE_RELAY_URL / PD_CONSOLE_RELAY_TOKEN"
                ));
            }
            let base = self.relay_url.trim_end_matches('/').to_string();
            let token = self.relay_token.clone();
            if let Err(e) = relay_pause(daemon, &base, &token, paused).await {
                return Err(anyhow::anyhow!(e));
            }
            // Optimistic reflect, then confirm from the relay's own health so a
            // divergence (e.g. relay ignored the flag) is visible next render.
            self.paused = paused;
            if let Ok(data) = fetch_json(daemon, &format!("{base}/v1/fleet/health"), &token).await {
                self.apply_health(&data);
                self.health_error = None;
            }
            Ok(())
        })
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Local proposal queue: always try it, even when the remote relay is
            // not configured. These packets live in the daemon DB and power the
            // Rust/FleetBar HITL surfaces. Fetch a large window; page client-side.
            match fetch_json(
                daemon,
                &format!(
                    "{}/fleet-proposals?status=pending&limit={FETCH_WINDOW}",
                    daemon.base()
                ),
                "",
            )
            .await
            {
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
            self.proposals_pager.clamp(self.pending_proposals.len());

            // Unconfigured → no-op; view() shows the actionable hint instead.
            if !self.is_configured() {
                return Ok(());
            }
            let base = self.relay_url.trim_end_matches('/').to_string();
            let token = self.relay_token.clone();

            // The three relay reads are fetched + folded INDEPENDENTLY: one
            // endpoint's failure never clears or masks another's data. A 500 on
            // `/v1/fleet/config` (missing GitHub App creds, an ops gap) must leave
            // health + activity + the pause control fully working.

            // Health (PRIMARY). On failure we record `health_error` and clear the
            // stale readout, but we DO NOT return early — activity + config are
            // still attempted below and render on their own success.
            match fetch_json(daemon, &format!("{base}/v1/fleet/health"), &token).await {
                Err(e) => {
                    self.health_error = Some(e);
                    self.last_run_age_sec = None;
                    self.dlq_depth = None;
                }
                Ok(data) => {
                    self.health_error = None;
                    self.apply_health(&data);
                }
            }

            // Recent activity. Fetch a large window once; the pane pages it
            // client-side (the relay route takes only `limit`, no offset/cursor).
            match fetch_json(
                daemon,
                &format!("{base}/v1/fleet/activity?limit={FETCH_WINDOW}"),
                &token,
            )
            .await
            {
                Err(e) => {
                    self.activity_error = Some(e);
                    self.activity.clear();
                }
                Ok(data) => {
                    self.activity_error = None;
                    self.activity = arr(&data, "runs")
                        .iter()
                        .map(FleetRun::from_value)
                        .collect();
                }
            }
            self.activity_pager.clamp(self.activity.len());

            // Ship config (read-only prompts/roles, SECONDARY). Tolerate either
            // {ships:[...]} or {config:{ships:[...]}} drift; pull name + role
            // defensively. A failure degrades ONLY this section.
            match fetch_json(daemon, &format!("{base}/v1/fleet/config"), &token).await {
                Err(e) => {
                    self.config_error = Some(e);
                    self.ships.clear();
                }
                Ok(data) => {
                    self.config_error = None;
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

    fn sample_runs(n: usize) -> Vec<FleetRun> {
        (0..n)
            .map(|i| FleetRun {
                pr_number: i as i64,
                repo: "port-daddy/relay".into(),
                conclusion: "success".into(),
                ships: vec![],
                elapsed_ms: 1,
                created_at: 1_719_432_000,
            })
            .collect()
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
    fn unconfigured_hint_names_both_vars_and_the_file() {
        let mut p = CloudFleetPane::default();
        p.relay_url = String::new();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::KeyVal(_, v)
                if v.contains("PD_CONSOLE_RELAY_URL")
                    && v.contains("PD_CONSOLE_RELAY_TOKEN")
                    && v.contains("~/.port-daddy/console.env")
        )));
    }

    #[test]
    fn unconfigured_pause_button_is_disabled_with_reason() {
        let mut p = CloudFleetPane::default();
        p.relay_url = String::new();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ControlButton { enabled: false, why_disabled: Some(_), .. }
        )));
    }

    #[test]
    fn health_failure_flags_health_and_disables_pause() {
        let mut p = configured();
        p.health_error = Some("GET .../health → 503 Service Unavailable".into());
        let blocks = p.view();
        // The health section reports its own unavailability + a gated chip.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "health" && v.contains("unavailable")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Gated } if label.contains("health unreachable")
        )));
        // Without a confirmed state the pause toggle is disabled — with a reason.
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ControlButton { verb, enabled: false, why_disabled: Some(_), .. }
            if verb == "cloud-pause"
        )));
    }

    #[test]
    fn config_failure_does_not_mask_health_activity_or_pause() {
        // The live-relay bug: /v1/fleet/config 500s (missing GitHub App creds)
        // while health + activity return 200. Everything but ships must render.
        let mut p = configured();
        p.paused = false; // health OK
        p.last_run_age_sec = Some(467);
        p.activity = sample_runs(3); // activity OK
        p.config_error = Some("GET .../config → 500 Internal Server Error".into());
        let blocks = p.view();

        // (a) Pause control present + ENABLED (driven by health, which works).
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-pause"
        )));
        // (a) Top-line health chip reads "running", NOT a relay-unreachable banner.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Engaged } if label == "running"
        )));
        assert!(!blocks.iter().any(|b| matches!(
            b, Block::Chip { label, .. } if label.contains("unreachable")
        )));
        // (b) Activity rows still render.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Row(cells) if cells[1] == "PR #0")));
        // (c) Health readout (last run) still renders.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, _) if k == "last run"
        )));
        // Ships degrades in place with a small line naming the error.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(_, v) if v.contains("ship config unavailable") && v.contains("500")
        )));
    }

    #[test]
    fn activity_failure_shows_line_but_keeps_health_and_pause() {
        let mut p = configured();
        p.paused = false;
        p.activity_error = Some("GET .../activity → 502 Bad Gateway".into());
        let blocks = p.view();
        // Pause stays live; activity degrades to a line.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-pause"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(_, v) if v.contains("activity unavailable")
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
    fn pause_toggle_label_reflects_health() {
        let mut p = configured();
        p.paused = false;
        assert!(p.view().iter().any(|b| matches!(
            b, Block::ControlButton { verb, label, enabled: true, .. }
            if verb == "cloud-pause" && label == "Pause reviewer"
        )));
        p.paused = true;
        assert!(p.view().iter().any(|b| matches!(
            b, Block::ControlButton { verb, label, .. }
            if verb == "cloud-resume" && label == "Resume reviewer"
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

    // ── Pagination ────────────────────────────────────────────────────────────

    #[test]
    fn pager_math_offsets_windows_and_counts() {
        let mut pg = Pager::new(25);
        assert_eq!(pg.page_count(0), 1);
        assert_eq!(pg.page_count(25), 1);
        assert_eq!(pg.page_count(26), 2);
        assert_eq!(pg.page_count(60), 3);
        assert_eq!(pg.window(0), (0, 0));
        assert_eq!(pg.window(10), (1, 10));
        assert_eq!(pg.offset(), 0);
        assert!(!pg.has_prev());
        assert!(pg.has_next(60));

        pg.next(60);
        assert_eq!(pg.offset(), 25);
        assert_eq!(pg.window(60), (26, 50));
        assert!(pg.has_prev());
        assert!(pg.has_next(60));

        pg.next(60);
        assert_eq!(pg.window(60), (51, 60));
        assert!(!pg.has_next(60));

        // Next past the end is a clamp, not an overflow.
        pg.next(60);
        assert_eq!(pg.window(60), (51, 60));

        // Shrinking the list clamps the page back into range.
        pg.clamp(10);
        assert_eq!(pg.page, 0);
        assert_eq!(pg.window(10), (1, 10));
    }

    #[test]
    fn pager_slice_covers_the_page() {
        let items: Vec<usize> = (0..60).collect();
        let mut pg = Pager::new(25);
        assert_eq!(pg.slice(&items), &items[0..25]);
        pg.next(60);
        assert_eq!(pg.slice(&items), &items[25..50]);
        pg.next(60);
        assert_eq!(pg.slice(&items), &items[50..60]);
    }

    #[test]
    fn activity_over_a_page_is_paged_not_truncated() {
        let mut p = configured();
        p.activity = sample_runs(60);
        let blocks = p.view();
        // The "showing" indicator names the full total — no silent truncation.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "showing" && v.contains("of 60")
        )));
        // Page 0 renders exactly one page of rows (25), not all 60.
        let rows = blocks
            .iter()
            .filter(|b| matches!(b, Block::Row(_)))
            .count();
        assert_eq!(rows, 25);
        // A Next control exists and is enabled; Prev is disabled on page 0.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-activity-next"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: false, .. } if verb == "cloud-activity-prev"
        )));
    }

    #[test]
    fn page_action_moves_window_forward_and_back() {
        let mut p = configured();
        p.activity = sample_runs(60);
        p.page(CloudFleetList::Activity, true);
        assert_eq!(p.activity_pager.window(60), (26, 50));
        p.page(CloudFleetList::Activity, true);
        assert_eq!(p.activity_pager.window(60), (51, 60));
        // Clamped at the last page.
        p.page(CloudFleetList::Activity, true);
        assert_eq!(p.activity_pager.window(60), (51, 60));
        p.page(CloudFleetList::Activity, false);
        assert_eq!(p.activity_pager.window(60), (26, 50));
    }

    // ── Pause request construction ─────────────────────────────────────────────

    #[test]
    fn pause_request_builds_clean_url_and_body() {
        // Trailing slash on the base must not produce a double slash.
        let (url, body) = pause_request("https://relay.example.dev/", true);
        assert_eq!(url, "https://relay.example.dev/v1/fleet/pause");
        assert_eq!(body, json!({ "paused": true }));

        let (url2, body2) = pause_request("https://relay.example.dev", false);
        assert_eq!(url2, "https://relay.example.dev/v1/fleet/pause");
        assert_eq!(body2, json!({ "paused": false }));
    }

    // ── console.env fallback parser ────────────────────────────────────────────

    #[test]
    fn console_env_parser_reads_keyvals_ignoring_noise() {
        let content = "\
# operator relay secrets
\n\
PD_CONSOLE_RELAY_URL=https://r.dev
export PD_CONSOLE_RELAY_TOKEN=\"tok-123\"
UNRELATED=keep
PD_CONSOLE_RELAY_URL=https://last.dev
";
        let m = parse_console_env(content);
        // Last assignment wins.
        assert_eq!(m.get("PD_CONSOLE_RELAY_URL").unwrap(), "https://last.dev");
        // `export ` prefix tolerated; surrounding quotes stripped.
        assert_eq!(m.get("PD_CONSOLE_RELAY_TOKEN").unwrap(), "tok-123");
        assert_eq!(m.get("UNRELATED").unwrap(), "keep");
        // Comments/blank lines never become keys.
        assert!(!m.contains_key("# operator relay secrets"));
    }

    #[test]
    fn console_env_parser_handles_single_quotes_and_empty() {
        let m = parse_console_env("PD_CONSOLE_RELAY_TOKEN='abc'\nEMPTY=\n=novalue\n");
        assert_eq!(m.get("PD_CONSOLE_RELAY_TOKEN").unwrap(), "abc");
        assert_eq!(m.get("EMPTY").unwrap(), "");
        // A blank key is dropped.
        assert!(!m.contains_key(""));
    }
}
