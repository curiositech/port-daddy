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
use crate::util::{age_short, arr, b, fmt_duration_secs, n, s, trunc};
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
    /// The open run's detail — the expanded ship's transcript, or the per-ship
    /// summary rows when a run has many ships.
    RunDetail,
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
    /// Opaque run id (`run:<deliveryId>`) — the key for `GET /v1/fleet/runs/:id`.
    id: String,
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
            id: s(v, "id"),
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

// ── Run detail (Shipwright expandable view) ─────────────────────────────────────
//
// `GET /v1/fleet/runs/:id` returns `{ run, steps[], spend[] }`:
//   run   — header (id, prNumber, repo, conclusion, elapsedMs, createdAt, ships[])
//   steps — ordered transcript: {seq, kind, ship, title, detail(JSON), createdAt}
//            kinds: map-chunk, reduce, ship-verdict|ship-finding|ship-skipped,
//            review-posted, check-completed. `ship` is null on fleet-level steps.
//   spend — one row per ship that ran: {ship, model, inputTokens, outputTokens,
//            costUsd}. Best-effort on the relay; [] when billing isn't deployed.
// The pane folds these into per-ship rows (verdict from the ship's last verdict
// step; tokens/$ from its spend row) plus the full transcript for drill-down.

/// Accumulated per-ship spend within one run (usually one row, summed if repeated).
#[derive(Debug, Clone, Default)]
struct ShipSpend {
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
}

/// One transcript step. `detail` is the step's JSON blob pretty-printed to text so
/// the operator reads the ship's findings/output verbatim — never ellipsized at
/// the source (long transcripts page, they don't truncate).
#[derive(Debug, Clone)]
struct RunStep {
    seq: i64,
    kind: String,
    /// "" when the step is fleet-level (e.g. `check-completed`).
    ship: String,
    title: String,
    detail: String,
    created_at: i64,
}

impl RunStep {
    fn from_value(v: &Value) -> Self {
        Self {
            seq: n(v, "seq"),
            kind: s(v, "kind"),
            ship: s(v, "ship"),
            title: s(v, "title"),
            detail: pretty_detail(v.get("detail")),
            created_at: n(v, "createdAt"),
        }
    }
}

/// Per-ship rollup WITHIN one run: verdict + tokens + cost + a derived elapsed.
/// Every field is REAL recorded data — an unpriced model shows $0 (tokens still
/// real); a ship with no spend row shows cost "—" (`has_spend == false`).
#[derive(Debug, Clone)]
struct RunShip {
    ship: String,
    verdict: String,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
    has_spend: bool,
    /// Per-ship elapsed (ms), derived from the span of its transcript timestamps
    /// (seconds granularity). 0 when the ship has <2 timestamped steps or they
    /// share a second — rendered "—", never a fabricated duration.
    ms: i64,
}

/// Full detail for one expanded run.
#[derive(Debug, Clone)]
struct RunDetail {
    id: String,
    pr_number: i64,
    repo: String,
    conclusion: String,
    elapsed_ms: i64,
    created_at: i64,
    ships: Vec<RunShip>,
    steps: Vec<RunStep>,
    total_cost_usd: f64,
    has_any_spend: bool,
}

impl RunDetail {
    fn from_value(v: &Value) -> Self {
        use std::collections::{HashMap, HashSet};
        let run = v.get("run").cloned().unwrap_or(Value::Null);
        let steps: Vec<RunStep> = arr(v, "steps").iter().map(RunStep::from_value).collect();

        // Fold spend rows into a per-ship accumulator (sum tokens + cost).
        let mut spend: HashMap<String, ShipSpend> = HashMap::new();
        for sp in arr(v, "spend") {
            let ship = s(sp, "ship");
            if ship.is_empty() {
                continue;
            }
            let e = spend.entry(ship).or_default();
            e.input_tokens += n(sp, "inputTokens");
            e.output_tokens += n(sp, "outputTokens");
            e.cost_usd += f64_field(sp, "costUsd");
        }

        // Ship membership + order: the run header's ships[] first, then any ship
        // seen only in steps or spend, appended in first-seen order.
        let mut order: Vec<String> = arr(&run, "ships")
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect();
        let mut seen: HashSet<String> = order.iter().cloned().collect();
        for st in &steps {
            if !st.ship.is_empty() && seen.insert(st.ship.clone()) {
                order.push(st.ship.clone());
            }
        }
        for k in spend.keys() {
            if seen.insert(k.clone()) {
                order.push(k.clone());
            }
        }

        let ships: Vec<RunShip> = order
            .into_iter()
            .map(|name| {
                let sp = spend.get(&name);
                RunShip {
                    verdict: ship_verdict(&steps, &name),
                    input_tokens: sp.map(|s| s.input_tokens).unwrap_or(0),
                    output_tokens: sp.map(|s| s.output_tokens).unwrap_or(0),
                    cost_usd: sp.map(|s| s.cost_usd).unwrap_or(0.0),
                    has_spend: sp.is_some(),
                    ms: ship_elapsed_ms(&steps, &name),
                    ship: name,
                }
            })
            .collect();

        let total_cost_usd = spend.values().map(|s| s.cost_usd).sum();
        let has_any_spend = !spend.is_empty();

        Self {
            id: s(&run, "id"),
            pr_number: n(&run, "prNumber"),
            repo: s(&run, "repo"),
            conclusion: s(&run, "conclusion"),
            elapsed_ms: n(&run, "elapsedMs"),
            created_at: n(&run, "createdAt"),
            ships,
            steps,
            total_cost_usd,
            has_any_spend,
        }
    }

    /// The transcript steps belonging to one ship (for the drill-down view).
    fn steps_for<'a>(&'a self, ship: &str) -> Vec<&'a RunStep> {
        self.steps.iter().filter(|st| st.ship == ship).collect()
    }
}

/// A float field tolerant of number-or-numeric-string drift; 0.0 when missing.
fn f64_field(v: &Value, key: &str) -> f64 {
    match v.get(key) {
        Some(Value::Number(x)) => x.as_f64().unwrap_or(0.0),
        Some(Value::String(x)) => x.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// Pretty-print a step's `detail` blob to readable text (2-space indent for
/// objects/arrays; a bare string passes through; null/missing → "").
fn pretty_detail(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(sx)) => sx.clone(),
        Some(other) => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    }
}

/// A ship's verdict: the LAST (highest-seq) verdict-bearing step for that ship,
/// with the `pd-<ship>: ` prefix stripped. "—" when the ship logged none.
fn ship_verdict(steps: &[RunStep], ship: &str) -> String {
    const VERDICT_KINDS: [&str; 3] = ["ship-verdict", "ship-finding", "ship-skipped"];
    steps
        .iter()
        .filter(|st| st.ship == ship && VERDICT_KINDS.contains(&st.kind.as_str()))
        .max_by_key(|st| st.seq)
        .map(|st| {
            let prefix = format!("pd-{ship}: ");
            st.title.strip_prefix(&prefix).unwrap_or(&st.title).to_string()
        })
        .unwrap_or_else(|| "—".into())
}

/// Per-ship elapsed (ms) from the span of its transcript timestamps (seconds).
/// 0 when there are <2 distinct-second timestamps — the caller renders "—".
fn ship_elapsed_ms(steps: &[RunStep], ship: &str) -> i64 {
    let (mut lo, mut hi) = (i64::MAX, i64::MIN);
    for st in steps.iter().filter(|st| st.ship == ship && st.created_at > 0) {
        lo = lo.min(st.created_at);
        hi = hi.max(st.created_at);
    }
    if hi > lo {
        (hi - lo) * 1000
    } else {
        0
    }
}

/// Per-ship aggregate across the loaded activity window, enriched with cost +
/// per-ship verdict from any opened run details. Pure (no I/O) so the rollup math
/// is unit-testable in isolation.
#[derive(Debug, Clone, PartialEq)]
struct ShipRollup {
    ship: String,
    runs: usize,
    total_cost_usd: f64,
    /// True once an opened run detail contributed spend for this ship — otherwise
    /// cost is "—" (the activity list carries no per-ship cost).
    has_cost: bool,
    avg_ms: i64,
    /// Newest per-ship verdict from an opened run detail, else the newest run's
    /// (run-level) conclusion as a proxy.
    last_verdict: String,
}

/// Aggregate `activity` (newest-first) into a per-ship rollup, overlaying cost +
/// per-ship verdict from the `details` the operator has opened.
fn ship_window_rollup(
    activity: &[FleetRun],
    details: &std::collections::HashMap<String, RunDetail>,
) -> Vec<ShipRollup> {
    use std::collections::{BTreeMap, HashMap};

    // 1) Base pass over the activity window: runs count, ms sum, last conclusion.
    //    BTreeMap → deterministic (alphabetical) ship order in the rollup.
    struct Acc {
        runs: usize,
        ms_sum: i64,
        last_verdict: String,
    }
    let mut acc: BTreeMap<String, Acc> = BTreeMap::new();
    for run in activity {
        for ship in &run.ships {
            let e = acc.entry(ship.clone()).or_insert_with(|| Acc {
                runs: 0,
                ms_sum: 0,
                last_verdict: String::new(),
            });
            // activity is newest-first, so the FIRST sighting sets last_verdict.
            if e.last_verdict.is_empty() && !run.conclusion.is_empty() {
                e.last_verdict = run.conclusion.clone();
            }
            e.runs += 1;
            e.ms_sum += run.elapsed_ms;
        }
    }

    // 2) Overlay opened details: sum per-ship cost, prefer the newest per-ship
    //    verdict (keyed on the run's createdAt).
    let mut cost: HashMap<String, f64> = HashMap::new();
    let mut best_verdict: HashMap<String, (i64, String)> = HashMap::new();
    for d in details.values() {
        for rs in &d.ships {
            if rs.has_spend {
                *cost.entry(rs.ship.clone()).or_insert(0.0) += rs.cost_usd;
            }
            if rs.verdict != "—" {
                let slot = best_verdict
                    .entry(rs.ship.clone())
                    .or_insert((i64::MIN, String::new()));
                if d.created_at >= slot.0 {
                    *slot = (d.created_at, rs.verdict.clone());
                }
            }
        }
    }

    acc.into_iter()
        .map(|(ship, a)| {
            let has_cost = cost.contains_key(&ship);
            let last_verdict = best_verdict
                .get(&ship)
                .map(|(_, v)| v.clone())
                .unwrap_or(a.last_verdict);
            ShipRollup {
                total_cost_usd: cost.get(&ship).copied().unwrap_or(0.0),
                has_cost,
                avg_ms: if a.runs > 0 { a.ms_sum / a.runs as i64 } else { 0 },
                last_verdict,
                runs: a.runs,
                ship,
            }
        })
        .collect()
}

/// Percent-encode a run id for a URL path segment. Run ids are
/// `run:<deliveryId>`; the `:` (and any other reserved byte) is encoded so the
/// relay's `decodeURIComponent` round-trips it exactly.
fn encode_run_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for byte in id.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
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
    /// Run-detail (Shipwright expandable view) state. Selecting a Recent Run
    /// fetches `GET /v1/fleet/runs/:id` into `run_detail`; a failure sets
    /// `run_detail_error` and degrades ONLY this run's detail — the runs list,
    /// pause control, and every other section are untouched fields. Opened
    /// details are retained in `run_detail_cache` so the per-ship window rollup
    /// aggregates cost across them without re-fetching.
    selected_run: Option<String>,
    run_detail: Option<RunDetail>,
    run_detail_error: Option<String>,
    run_detail_cache: std::collections::HashMap<String, RunDetail>,
    /// Which ship's transcript is expanded inside the open run (None = the
    /// per-ship summary rows). Reset whenever a different run is opened.
    expanded_ship: Option<String>,
    /// Pages the open run's long content — the expanded ship's transcript steps,
    /// or the per-ship summary rows when a run has many ships. NO silent
    /// truncation: long transcripts page here. Reset on open/expand.
    run_detail_pager: Pager,
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
            selected_run: None,
            run_detail: None,
            run_detail_error: None,
            run_detail_cache: std::collections::HashMap::new(),
            expanded_ship: None,
            run_detail_pager: Pager::new(DEFAULT_PAGE_SIZE),
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
            CloudFleetList::RunDetail => {
                let total = self.run_detail_page_total();
                if forward {
                    self.run_detail_pager.next(total);
                } else {
                    self.run_detail_pager.prev();
                }
            }
        }
    }

    /// Total items the run-detail pager covers: the expanded ship's transcript
    /// steps, or the per-ship summary rows when no ship is expanded.
    fn run_detail_page_total(&self) -> usize {
        match (&self.run_detail, &self.expanded_ship) {
            (Some(d), Some(ship)) => d.steps_for(ship).len(),
            (Some(d), None) => d.ships.len(),
            _ => 0,
        }
    }

    /// Open (fetch) or close a run's detail. `Some(id)` fetches
    /// `GET /v1/fleet/runs/:id` (served from cache when already loaded); `None`
    /// collapses back to the runs list. A fetch failure degrades ONLY this run
    /// (records `run_detail_error`) — the runs list + pause toggle are untouched.
    pub async fn open_run(&mut self, daemon: &DaemonClient, run_id: Option<String>) {
        let Some(id) = run_id else {
            self.selected_run = None;
            self.run_detail = None;
            self.run_detail_error = None;
            self.expanded_ship = None;
            return;
        };
        self.selected_run = Some(id.clone());
        self.expanded_ship = None;
        self.run_detail_pager = Pager::new(DEFAULT_PAGE_SIZE);
        if let Some(cached) = self.run_detail_cache.get(&id) {
            self.run_detail = Some(cached.clone());
            self.run_detail_error = None;
            return;
        }
        if !self.is_configured() {
            self.run_detail = None;
            self.run_detail_error = Some("relay not configured".into());
            return;
        }
        let base = self.relay_url.trim_end_matches('/').to_string();
        let token = self.relay_token.clone();
        let url = format!("{base}/v1/fleet/runs/{}", encode_run_id(&id));
        match fetch_json(daemon, &url, &token).await {
            Ok(data) => {
                let detail = RunDetail::from_value(&data);
                self.run_detail_cache.insert(id, detail.clone());
                self.run_detail = Some(detail);
                self.run_detail_error = None;
            }
            Err(e) => {
                self.run_detail = None;
                self.run_detail_error = Some(e);
            }
        }
    }

    /// Expand/collapse a ship's transcript within the open run. Local state only —
    /// the detail is already loaded; no daemon round-trip.
    pub fn expand_ship(&mut self, ship: Option<String>) {
        self.expanded_ship = ship;
        self.run_detail_pager = Pager::new(DEFAULT_PAGE_SIZE);
    }

    /// The current run-detail fetch error, if the last `open_run` failed — so the
    /// caller can surface it on the alert bus (the pane also shows it inline).
    pub fn run_detail_error_message(&self) -> Option<String> {
        self.run_detail_error.clone()
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
            CloudFleetList::RunDetail => ("cloud-run-detail-prev", "cloud-run-detail-next"),
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

    /// Render the open run's Shipwright detail inline under its Recent Runs row.
    /// A `runs/:id` failure degrades ONLY this block (an inline error line); the
    /// runs list, pause control, and rollup above/below are untouched.
    fn push_run_detail(&self, blocks: &mut Vec<Block>) {
        if let Some(err) = &self.run_detail_error {
            blocks.push(Block::KeyVal("run detail".into(), format!("unavailable — {err}")));
            return;
        }
        let Some(d) = &self.run_detail else {
            blocks.push(Block::KeyVal("run detail".into(), "loading…".into()));
            return;
        };

        // Detail header: conclusion · elapsed · ships · total cost.
        let total_cost = if d.has_any_spend {
            format!("${:.4}", d.total_cost_usd)
        } else {
            "—".into()
        };
        blocks.push(Block::KeyVal(
            format!("run {}", trunc(&d.id, 28)),
            format!(
                "{} PR #{} · {} · {}ms · {} ships · cost {}",
                trunc(&d.repo, 24),
                d.pr_number,
                d.conclusion,
                d.elapsed_ms,
                d.ships.len(),
                total_cost
            ),
        ));

        match &self.expanded_ship {
            // Per-ship summary rows: ship · verdict · tokens(in/out) · $cost · Nms.
            None => {
                if d.ships.is_empty() {
                    blocks.push(Block::KeyVal(
                        "ships".into(),
                        "no per-ship steps recorded for this run".into(),
                    ));
                    return;
                }
                let total = d.ships.len();
                for rs in self.run_detail_pager.slice(&d.ships) {
                    let cost = if rs.has_spend {
                        format!("${:.4}", rs.cost_usd)
                    } else {
                        "—".into()
                    };
                    let ms = if rs.ms > 0 {
                        format!("{}ms", rs.ms)
                    } else {
                        "—".into()
                    };
                    blocks.push(Block::Row(vec![
                        trunc(&rs.ship, 18),
                        trunc(&rs.verdict, 22),
                        format!("{}/{}", rs.input_tokens, rs.output_tokens),
                        cost,
                        ms,
                    ]));
                    blocks.push(Block::ControlButton {
                        verb: format!("cloud-ship-expand:{}", rs.ship),
                        label: format!("{} transcript ▸", trunc(&rs.ship, 16)),
                        enabled: true,
                        why_disabled: None,
                        primary: false,
                    });
                }
                // Page only when a run has more ships than one page (rare) — no
                // silent truncation of an unusually wide fleet.
                if total > self.run_detail_pager.size {
                    self.push_pager(blocks, CloudFleetList::RunDetail, &self.run_detail_pager, total);
                }
            }
            // Expanded ship transcript — full step text, paged (never truncated).
            Some(ship) => {
                blocks.push(Block::ControlButton {
                    verb: "cloud-ship-collapse".into(),
                    label: format!("‹ back — {} transcript", trunc(ship, 16)),
                    enabled: true,
                    why_disabled: None,
                    primary: false,
                });
                let steps = d.steps_for(ship);
                let total = steps.len();
                if total == 0 {
                    blocks.push(Block::KeyVal(
                        "transcript".into(),
                        "no transcript steps for this ship".into(),
                    ));
                    return;
                }
                for st in self.run_detail_pager.slice(&steps) {
                    blocks.push(Block::KeyVal(
                        format!("#{} {}", st.seq, trunc(&st.kind, 16)),
                        trunc(&st.title, 60),
                    ));
                    if !st.detail.is_empty() {
                        // WrappedText wraps + never ellipsizes — the operator reads
                        // the ship's findings/output in full.
                        blocks.push(Block::WrappedText {
                            text: st.detail.clone(),
                            tone: Tone::Resting,
                        });
                    }
                }
                self.push_pager(blocks, CloudFleetList::RunDetail, &self.run_detail_pager, total);
            }
        }
    }

    /// "Ships (this window)" — a per-ship rollup across the loaded activity window,
    /// enriched with cost from any opened run details. Cost reads "—" until a run
    /// is opened (the activity list carries no per-ship $).
    fn push_ship_rollup(&self, blocks: &mut Vec<Block>) {
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Ships (this window)".into()));
        let rollup = ship_window_rollup(&self.activity, &self.run_detail_cache);
        if rollup.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no ships in the loaded run window".into(),
            ));
            return;
        }
        let any_cost = rollup.iter().any(|r| r.has_cost);
        for r in &rollup {
            let cost = if r.has_cost {
                format!("${:.4}", r.total_cost_usd)
            } else {
                "—".into()
            };
            blocks.push(Block::Row(vec![
                trunc(&r.ship, 18),
                format!("{} runs", r.runs),
                cost,
                format!("{}ms avg", r.avg_ms),
                trunc(&r.last_verdict, 18),
            ]));
        }
        if !any_cost {
            blocks.push(Block::KeyVal(
                "cost".into(),
                "open a run to load per-ship $ (the activity list carries none)".into(),
            ));
        }
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
                // `lastRunAgeSec` is a DURATION (seconds since the last run), not a
                // timestamp — format it directly. (The old `age_short(age*1000)`
                // treated it as a 1970 epoch and printed "20657d ago".)
                blocks.push(Block::KeyVal(
                    "last run".into(),
                    format!("{} ago", fmt_duration_secs(age)),
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
                // age · PR # · repo · conclusion · elapsed. (`created_at` is an
                // absolute epoch, so `age_short` is correct here — unlike the
                // health `lastRunAgeSec` duration handled above.)
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
                // Expand/collapse this run's Shipwright detail. A run with no id
                // (schema drift) simply can't be opened — omit the control rather
                // than show a dead affordance.
                if run.id.is_empty() {
                    // no run id → no detail endpoint key
                } else if self.selected_run.as_deref() == Some(run.id.as_str()) {
                    blocks.push(Block::ControlButton {
                        verb: "cloud-run-close".into(),
                        label: "Close ▾".into(),
                        enabled: true,
                        why_disabled: None,
                        primary: false,
                    });
                    self.push_run_detail(&mut blocks);
                } else {
                    blocks.push(Block::ControlButton {
                        verb: format!("cloud-run-open:{}", run.id),
                        label: "Open ▸".into(),
                        enabled: true,
                        why_disabled: None,
                        primary: false,
                    });
                }
            }
            self.push_pager(&mut blocks, CloudFleetList::Activity, &self.activity_pager, total);
        }

        // ── Ships (this window): per-ship rollup across the loaded runs ─────────
        self.push_ship_rollup(&mut blocks);

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

        // TODO(shipwright-editor): the ship EDITOR (validate → smoke-test →
        // optimize → save) is a FOLLOW-UP, intentionally NOT wired here. It needs
        // `POST /v1/fleet/{validate,smoke-test,optimize-prompt,save}` +
        // `GET /v1/fleet/config`, which currently 500 on the relay (the GitHub App
        // creds are unset). Wiring an editor now would ship dead buttons. Until the
        // relay serves config, show one honest, DISABLED affordance so the
        // capability is discoverable without pretending it works.
        blocks.push(Block::ControlButton {
            verb: "cloud-ship-edit".into(),
            label: "Edit ship prompt".into(),
            enabled: false,
            why_disabled: Some("ship editing coming — relay config unavailable".into()),
            primary: false,
        });

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
                id: format!("run:{i}"),
                pr_number: i as i64,
                repo: "port-daddy/relay".into(),
                conclusion: "success".into(),
                ships: vec![],
                elapsed_ms: 1,
                created_at: 1_719_432_000,
            })
            .collect()
    }

    /// A `/v1/fleet/runs/:id` response body with two ships, transcript, + spend.
    fn sample_run_detail_json() -> Value {
        json!({
            "code": "OK",
            "error": null,
            "run": {
                "id": "run:d1",
                "prNumber": 202,
                "repo": "curiositech/port-daddy",
                "conclusion": "failure",
                "ships": ["linter", "redteam"],
                "elapsedMs": 45000,
                "createdAt": 1_719_432_100i64
            },
            "steps": [
                { "seq": 0, "kind": "map-chunk", "ship": "linter", "title": "MAP chunk 1/1", "detail": {"chunkIndex": 0}, "createdAt": 1_719_432_101i64 },
                { "seq": 1, "kind": "ship-verdict", "ship": "linter", "title": "pd-linter: PASS", "detail": [], "createdAt": 1_719_432_103i64 },
                { "seq": 2, "kind": "ship-verdict", "ship": "redteam", "title": "pd-redteam: BLOCK", "detail": [{"path":"a.ts","body":"unsafe"}], "createdAt": 1_719_432_108i64 },
                { "seq": 3, "kind": "check-completed", "ship": null, "title": "Check concluded: failure", "detail": {"conclusion":"failure"}, "createdAt": 1_719_432_109i64 }
            ],
            "spend": [
                { "ship": "linter", "model": "@cf/qwen/qwen3-30b-a3b-fp8", "inputTokens": 1200, "outputTokens": 340, "costUsd": 0.000175 },
                { "ship": "redteam", "model": "@cf/openai/gpt-oss-120b", "inputTokens": 900, "outputTokens": 500, "costUsd": 0.00069 }
            ]
        })
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
            id: "run:7".into(),
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

    // ── Run detail parsing (Shipwright) ─────────────────────────────────────────

    #[test]
    fn run_detail_parses_ships_verdicts_spend_and_derived_ms() {
        let d = RunDetail::from_value(&sample_run_detail_json());
        assert_eq!(d.id, "run:d1");
        assert_eq!(d.pr_number, 202);
        assert_eq!(d.conclusion, "failure");
        assert_eq!(d.elapsed_ms, 45000);
        assert!(d.has_any_spend);
        // Two ships, in run-header order.
        assert_eq!(d.ships.iter().map(|s| s.ship.as_str()).collect::<Vec<_>>(), vec!["linter", "redteam"]);

        let linter = &d.ships[0];
        // Verdict from the ship's last verdict step, prefix stripped.
        assert_eq!(linter.verdict, "PASS");
        // Tokens + cost joined from spend[].
        assert_eq!(linter.input_tokens, 1200);
        assert_eq!(linter.output_tokens, 340);
        assert!(linter.has_spend);
        assert!((linter.cost_usd - 0.000175).abs() < 1e-9);
        // linter steps at 101 & 103 → 2s span → 2000ms.
        assert_eq!(linter.ms, 2000);

        let redteam = &d.ships[1];
        assert_eq!(redteam.verdict, "BLOCK");
        assert!((redteam.cost_usd - 0.00069).abs() < 1e-9);
        // redteam has a single step (108) → no span → 0 → rendered "—".
        assert_eq!(redteam.ms, 0);

        // Total cost sums both spend rows.
        assert!((d.total_cost_usd - 0.000865).abs() < 1e-9);
        // Transcript retained in full; steps_for filters by ship.
        assert_eq!(d.steps.len(), 4);
        assert_eq!(d.steps_for("linter").len(), 2);
        assert_eq!(d.steps_for("redteam").len(), 1);
    }

    #[test]
    fn run_detail_without_spend_shows_no_cost_but_keeps_verdicts() {
        // The billing-not-deployed case: relay returns spend: [].
        let mut body = sample_run_detail_json();
        body["spend"] = json!([]);
        let d = RunDetail::from_value(&body);
        assert!(!d.has_any_spend);
        assert!(d.ships.iter().all(|s| !s.has_spend));
        assert_eq!(d.total_cost_usd, 0.0);
        // Verdicts still resolve from the transcript.
        assert_eq!(d.ships[0].verdict, "PASS");
        assert_eq!(d.ships[1].verdict, "BLOCK");
    }

    #[test]
    fn ship_verdict_picks_last_and_strips_prefix() {
        let steps = vec![
            RunStep { seq: 0, kind: "ship-verdict".into(), ship: "qa".into(), title: "pd-qa: PASS".into(), detail: String::new(), created_at: 1 },
            RunStep { seq: 1, kind: "ship-verdict".into(), ship: "qa".into(), title: "pd-qa: BLOCK (errored)".into(), detail: String::new(), created_at: 2 },
            RunStep { seq: 2, kind: "review-posted".into(), ship: "qa".into(), title: "Posted review for pd-qa".into(), detail: String::new(), created_at: 3 },
        ];
        // Last VERDICT-bearing step wins (review-posted is not a verdict kind).
        assert_eq!(ship_verdict(&steps, "qa"), "BLOCK (errored)");
        // A ship with no verdict step → "—".
        assert_eq!(ship_verdict(&steps, "ghost"), "—");
    }

    #[test]
    fn f64_field_tolerates_number_string_and_missing() {
        let v = json!({ "a": 0.5, "b": "0.25", "c": null });
        assert_eq!(f64_field(&v, "a"), 0.5);
        assert_eq!(f64_field(&v, "b"), 0.25);
        assert_eq!(f64_field(&v, "c"), 0.0);
        assert_eq!(f64_field(&v, "zzz"), 0.0);
    }

    #[test]
    fn pretty_detail_handles_object_string_and_null() {
        assert_eq!(pretty_detail(None), "");
        assert_eq!(pretty_detail(Some(&Value::Null)), "");
        assert_eq!(pretty_detail(Some(&json!("raw text"))), "raw text");
        let obj = pretty_detail(Some(&json!({ "k": 1 })));
        assert!(obj.contains("\"k\""));
    }

    #[test]
    fn encode_run_id_percent_encodes_the_colon() {
        assert_eq!(encode_run_id("run:abc-123"), "run%3Aabc-123");
        // Unreserved bytes pass through untouched.
        assert_eq!(encode_run_id("run.v2_final~1"), "run.v2_final~1");
    }

    // ── Per-ship window rollup ──────────────────────────────────────────────────

    #[test]
    fn ship_rollup_counts_runs_avg_ms_and_last_verdict_from_activity() {
        // Newest-first activity: two runs, linter in both, qa in the newer one.
        let activity = vec![
            FleetRun { id: "run:2".into(), pr_number: 2, repo: "r".into(), conclusion: "failure".into(), ships: vec!["linter".into(), "qa".into()], elapsed_ms: 100, created_at: 200 },
            FleetRun { id: "run:1".into(), pr_number: 1, repo: "r".into(), conclusion: "success".into(), ships: vec!["linter".into()], elapsed_ms: 300, created_at: 100 },
        ];
        let rollup = ship_window_rollup(&activity, &std::collections::HashMap::new());
        // BTreeMap → alphabetical: linter, qa.
        assert_eq!(rollup.iter().map(|r| r.ship.as_str()).collect::<Vec<_>>(), vec!["linter", "qa"]);
        let linter = &rollup[0];
        assert_eq!(linter.runs, 2);
        assert_eq!(linter.avg_ms, 200); // (100 + 300) / 2
        // Newest run first → last_verdict is the newer run's conclusion.
        assert_eq!(linter.last_verdict, "failure");
        assert!(!linter.has_cost); // no opened details yet
        let qa = &rollup[1];
        assert_eq!(qa.runs, 1);
        assert_eq!(qa.last_verdict, "failure");
    }

    #[test]
    fn ship_rollup_overlays_cost_and_verdict_from_opened_details() {
        let activity = vec![FleetRun {
            id: "run:d1".into(),
            pr_number: 202,
            repo: "curiositech/port-daddy".into(),
            conclusion: "failure".into(),
            ships: vec!["linter".into(), "redteam".into()],
            elapsed_ms: 45000,
            created_at: 1_719_432_100,
        }];
        let mut details = std::collections::HashMap::new();
        details.insert("run:d1".to_string(), RunDetail::from_value(&sample_run_detail_json()));
        let rollup = ship_window_rollup(&activity, &details);
        let linter = rollup.iter().find(|r| r.ship == "linter").unwrap();
        // Cost overlaid from the opened detail's spend.
        assert!(linter.has_cost);
        assert!((linter.total_cost_usd - 0.000175).abs() < 1e-9);
        // Per-ship verdict from the detail overrides the run-level conclusion.
        assert_eq!(linter.last_verdict, "PASS");
        let redteam = rollup.iter().find(|r| r.ship == "redteam").unwrap();
        assert_eq!(redteam.last_verdict, "BLOCK");
    }

    // ── Run detail rendering + resilience ───────────────────────────────────────

    fn run_detail_pane() -> CloudFleetPane {
        let mut p = configured();
        let d = RunDetail::from_value(&sample_run_detail_json());
        p.activity = vec![FleetRun {
            id: "run:d1".into(),
            pr_number: 202,
            repo: "curiositech/port-daddy".into(),
            conclusion: "failure".into(),
            ships: vec!["linter".into(), "redteam".into()],
            elapsed_ms: 45000,
            created_at: 1_719_432_100,
        }];
        p.selected_run = Some("run:d1".into());
        p.run_detail = Some(d);
        p
    }

    #[test]
    fn recent_run_shows_open_control_when_collapsed() {
        let mut p = configured();
        p.activity = sample_runs(1);
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-run-open:run:0"
        )));
    }

    #[test]
    fn open_run_renders_per_ship_rows_with_verdict_tokens_and_cost() {
        let p = run_detail_pane();
        let blocks = p.view();
        // Close control replaces Open for the selected run.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, .. } if verb == "cloud-run-close"
        )));
        // A per-ship row: ship · verdict · tokens · $cost · ms.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(c) if c[0] == "linter" && c[1] == "PASS" && c[2] == "1200/340" && c[3] == "$0.0002" && c[4] == "2000ms"
        )));
        // redteam has no per-ship span → ms renders "—".
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(c) if c[0] == "redteam" && c[1] == "BLOCK" && c[4] == "—"
        )));
        // Each ship offers a transcript drill-down control.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, .. } if verb == "cloud-ship-expand:linter"
        )));
    }

    #[test]
    fn expanded_ship_renders_full_transcript_text() {
        let mut p = run_detail_pane();
        p.expand_ship(Some("redteam".into()));
        let blocks = p.view();
        // A collapse control back to the ships list.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, .. } if verb == "cloud-ship-collapse"
        )));
        // The ship's step title + full (never-truncated) detail text.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k.contains("ship-verdict") && v.contains("BLOCK")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::WrappedText { text, .. } if text.contains("unsafe")
        )));
    }

    #[test]
    fn run_detail_error_degrades_only_that_run_not_the_list_or_pause() {
        let mut p = run_detail_pane();
        p.run_detail = None;
        p.run_detail_error = Some("GET .../runs/run:d1 → 500 Internal Server Error".into());
        let blocks = p.view();
        // The detail line reports its own failure.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "run detail" && v.contains("unavailable") && v.contains("500")
        )));
        // The runs list still renders its row, and the pause control is still live.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(c) if c[1] == "PR #202"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-pause"
        )));
    }

    #[test]
    fn ship_rollup_section_renders_across_window() {
        let p = run_detail_pane();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Header(h) if h == "Ships (this window)"
        )));
        // With the detail cached... actually not cached here (set directly), so
        // cost is "—" but runs/verdict still render from activity.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(c) if c[0] == "linter" && c[1] == "1 runs"
        )));
    }

    #[test]
    fn ship_editor_affordance_is_disabled_with_reason() {
        let p = configured();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ControlButton { verb, enabled: false, why_disabled: Some(w), .. }
            if verb == "cloud-ship-edit" && w.contains("relay config unavailable")
        )));
    }

    #[test]
    fn many_ships_in_a_run_are_paged_not_truncated() {
        let mut p = configured();
        // Build a synthetic run with 60 ships so the per-ship rows exceed a page.
        let ships: Vec<RunShip> = (0..60)
            .map(|i| RunShip {
                ship: format!("ship{i:02}"),
                verdict: "PASS".into(),
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: 0.0,
                has_spend: false,
                ms: 0,
            })
            .collect();
        p.activity = vec![FleetRun {
            id: "run:big".into(),
            pr_number: 1,
            repo: "r".into(),
            conclusion: "success".into(),
            ships: vec![],
            elapsed_ms: 1,
            created_at: 1_719_432_000,
        }];
        p.selected_run = Some("run:big".into());
        p.run_detail = Some(RunDetail {
            id: "run:big".into(),
            pr_number: 1,
            repo: "r".into(),
            conclusion: "success".into(),
            elapsed_ms: 1,
            created_at: 1_719_432_000,
            ships,
            steps: vec![],
            total_cost_usd: 0.0,
            has_any_spend: false,
        });
        let blocks = p.view();
        // A run-detail pager appears with the full total, and only one page of
        // ship rows renders (25), never all 60.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "showing" && v.contains("of 60")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ControlButton { verb, enabled: true, .. } if verb == "cloud-run-detail-next"
        )));
    }
}
