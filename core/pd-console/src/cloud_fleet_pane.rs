//! Cloud Fleet pane — remote relay observability (Phase C).
//!
//! Unlike every other pane (which polls the LOCAL daemon), this one watches a
//! REMOTE Cloudflare relay: the cloud fleet-executor that reviews GitHub PRs.
//! It loads the same signed-in operator account as FleetBar
//! (`~/.port-daddy/account.json`). Explicit `PD_CONSOLE_RELAY_URL` /
//! `PD_CONSOLE_RELAY_TOKEN` overrides remain for tests and development, but
//! routine operator setup never requires an environment variable.
//!
//! It reuses the shared `DaemonClient::http_client()` (a plain reqwest client) to
//! issue bearer-authenticated GETs against the operator-gated relay endpoints:
//!   - `GET /v1/fleet/health`            → paused flag, last-run age, queue estimate
//!   - `GET /v1/fleet/activity?limit=30` → recent `fleet_runs` (PR review runs)
//!   - `GET /v1/fleet/runs/:id`          → live durable transcript
//!   - `GET /v1/fleet/config`            → declared ships (read-only prompts + roles)
//!
//! Render-agnostic on purpose (emits `Block`s); the GPUI and ratatui renderers
//! paint the same blocks in the locked maritime theme.

use crate::agent::DaemonClient;
#[cfg(test)]
use crate::interruptions_pane::resolve_relay_credentials;
use crate::interruptions_pane::{load_relay_credentials, RelayCredentials};
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// One remote fleet run (a GitHub PR review the cloud executor performed).
#[derive(Debug, Clone)]
struct FleetRun {
    id: String,
    pr_number: i64,
    repo: String,
    head_sha: String,
    conclusion: String,
    ships: Vec<String>,
    elapsed_ms: i64,
    /// Unix *seconds* (relay uses `unixepoch()`), not millis.
    created_at: i64,
    state: String,
    generation: i64,
    attempt_count: i64,
    last_progress_at: Option<i64>,
    expected_start_at: Option<i64>,
    expected_finish_at: Option<i64>,
    queue_ahead_estimate: Option<i64>,
    has_transcript: bool,
    last_error: String,
}

impl FleetRun {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            pr_number: n(v, "prNumber"),
            repo: s(v, "repo"),
            head_sha: s(v, "headSha"),
            conclusion: s(v, "conclusion"),
            ships: arr(v, "ships")
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect(),
            elapsed_ms: n(v, "elapsedMs"),
            created_at: n(v, "createdAt"),
            state: {
                let state = s(v, "state");
                if state.is_empty() {
                    "unknown".into()
                } else {
                    state
                }
            },
            generation: n(v, "generation").max(1),
            attempt_count: n(v, "attemptCount").max(0),
            last_progress_at: optional_i64(v, "lastProgressAt"),
            expected_start_at: optional_i64(v, "expectedStartAt"),
            expected_finish_at: optional_i64(v, "expectedFinishAt"),
            queue_ahead_estimate: optional_i64(v, "queueAheadEstimate").filter(|value| *value >= 0),
            has_transcript: b(v, "hasTranscript"),
            last_error: s(v, "lastError"),
        }
    }

    fn is_active(&self) -> bool {
        matches!(
            self.state.as_str(),
            "admitting" | "queued" | "running" | "retrying"
        )
    }

    fn timing(&self) -> String {
        match self.state.as_str() {
            "admitting" => self
                .expected_start_at
                .map(|value| format!("executor handoff {}Z est.", hhmmss_seconds(value)))
                .unwrap_or_else(|| "admission in progress".into()),
            "queued" => {
                let ahead = self
                    .queue_ahead_estimate
                    .map(|value| format!("≈{value} ahead"))
                    .unwrap_or_else(|| "position unknown".into());
                let eta = self
                    .expected_start_at
                    .map(|value| format!("start {}Z", hhmmss_seconds(value)))
                    .unwrap_or_else(|| "start estimate pending".into());
                format!("{ahead} · {eta}")
            }
            "running" => self
                .expected_finish_at
                .map(|value| format!("finish {}Z est.", hhmmss_seconds(value)))
                .unwrap_or_else(|| "finish estimate pending".into()),
            "retrying" => self
                .expected_start_at
                .map(|value| format!("retry {}Z", hhmmss_seconds(value)))
                .unwrap_or_else(|| "durable retry scheduled".into()),
            "superseded" => "replaced by newer head".into(),
            _ => duration_short(self.elapsed_ms),
        }
    }
}

#[derive(Debug, Clone)]
struct FleetStep {
    seq: i64,
    kind: String,
    ship: String,
    title: String,
    created_at: i64,
    expected_at: Option<i64>,
}

impl FleetStep {
    fn from_value(v: &Value) -> Self {
        Self {
            seq: n(v, "seq"),
            kind: s(v, "kind"),
            ship: s(v, "ship"),
            title: s(v, "title"),
            created_at: n(v, "createdAt"),
            expected_at: optional_i64(v, "expectedAt"),
        }
    }

    fn explanation(&self) -> String {
        match self.kind.as_str() {
            "delivery-attempt" => "Cloudflare delivered the job to the executor; the attempt distinguishes a retry from new work.".into(),
            "checkpoint-reused" => "Durable completed work was reused instead of spending or publishing it again.".into(),
            "checkpoint-written" => "Progress was persisted so a later delivery can resume from this boundary.".into(),
            "map-chunk" => "One bounded section of the change is being inspected by the named ship.".into(),
            "reduce" => "Chunk observations are being consolidated into one ship verdict.".into(),
            "ship-verdict" => "A ship finished its assigned review and persisted the verdict.".into(),
            "check-completed" => "GitHub read-back confirmed the required check reached its intended terminal state.".into(),
            "check-completion-retry" => "GitHub did not confirm completion; a rate-limited durable retry was scheduled.".into(),
            "superseded" => "A newer head generation replaced this intent before stale work could publish.".into(),
            _ if !self.ship.is_empty() => format!(
                "{} recorded this {} step in the durable transcript.",
                self.ship,
                self.kind.replace('-', " ")
            ),
            _ => format!(
                "The executor recorded this {} step in the durable transcript.",
                self.kind.replace('-', " ")
            ),
        }
    }
}

fn optional_i64(v: &Value, key: &str) -> Option<i64> {
    match v.get(key) {
        Some(Value::Number(value)) => value.as_i64(),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn hhmmss_seconds(epoch_seconds: i64) -> String {
    if epoch_seconds <= 0 {
        return "—".into();
    }
    let day = epoch_seconds.rem_euclid(86_400);
    format!("{:02}:{:02}:{:02}", day / 3600, (day % 3600) / 60, day % 60)
}

fn duration_short(milliseconds: i64) -> String {
    let seconds = milliseconds.max(0) / 1000;
    if seconds >= 3600 {
        format!("{}h {:02}m", seconds / 3600, (seconds % 3600) / 60)
    } else if seconds >= 60 {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{seconds}s")
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

/// One (ship, attempt) capture from a run's transcript LEDGER
/// (`GET /fleet/runs/:id/transcripts.json` — pd-transcript.v1 Phase 3/4,
/// docs/FLEET-SESSION-TRANSCRIPTS.md). The ledger row carries the capture's
/// outcome columns; the raw turns come from the sibling `.jsonl` route.
#[derive(Debug, Clone)]
struct TranscriptSession {
    ship: String,
    attempt: i64,
    turns: i64,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    cost_usd: Option<f64>,
    incomplete: bool,
}

impl TranscriptSession {
    fn from_value(v: &Value) -> Self {
        Self {
            ship: s(v, "ship"),
            attempt: n(v, "attempt"),
            turns: n(v, "turns"),
            prompt_tokens: optional_i64(v, "promptTokens"),
            completion_tokens: optional_i64(v, "completionTokens"),
            cost_usd: v.get("costUsd").and_then(Value::as_f64),
            incomplete: b(v, "incomplete"),
        }
    }

    /// Ledger-row token summary: honest `not reported`, never a lying `0/0`
    /// (mirrors the run page's usage-honesty rule).
    fn tokens_label(&self) -> String {
        match (self.prompt_tokens, self.completion_tokens) {
            (Some(p), c) => format!("{p} in / {} out", c.unwrap_or(0)),
            _ => "tokens not reported".into(),
        }
    }
}

/// One pd-transcript.v1 envelope, parsed TOLERANTLY from a `.jsonl` line.
/// Only what the pane renders is kept; anything wrong-typed degrades to a
/// counted skip (never a crash) — the same posture as the web viewer's parser,
/// because a transcript is read precisely when something already went wrong.
#[derive(Debug, Clone)]
struct TranscriptTurn {
    seq: i64,
    kind: String,
    phase: String,
    chunk: Option<(i64, i64)>,
    model: String,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    truncated: bool,
    text: String,
}

impl TranscriptTurn {
    /// `MAP 3/7` for chunked turns, bare `PLAN`/`GATE`/… otherwise.
    fn phase_label(&self) -> String {
        match self.chunk {
            Some((index, count)) => format!("{} {}/{}", self.phase.to_uppercase(), index + 1, count),
            None => self.phase.to_uppercase(),
        }
    }

    /// Header line the pane paints above the body: seq, kind, phase, model,
    /// usage, and the explicit TRUNCATED badge when the capture dropped bytes.
    fn header(&self) -> String {
        let usage = match (self.prompt_tokens, self.completion_tokens) {
            (Some(p), Some(c)) => format!(" · {p} in / {c} out"),
            _ => String::new(),
        };
        let truncated = if self.truncated { " · TRUNCATED" } else { "" };
        format!(
            "#t{} {} {} · {}{}{}",
            self.seq,
            self.kind.to_uppercase(),
            self.phase_label(),
            trunc(&self.model, 36),
            usage,
            truncated
        )
    }
}

/// Parse one `.jsonl` body into renderable turns plus an honest skipped count.
/// A line is skipped — never thrown on — when it is not JSON, not major
/// version 1, has no numeric `seq`, or carries wrong-typed `content`; the
/// count renders as a notice so the pane never fakes completeness.
fn parse_transcript_jsonl(body: &str) -> (Vec<TranscriptTurn>, usize) {
    let mut turns = Vec::new();
    let mut skipped = 0usize;
    for line in body.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            skipped += 1;
            continue;
        };
        let version_ok = v.get("v").and_then(Value::as_i64) == Some(1);
        let seq = optional_i64(&v, "seq");
        let content_ok = v.get("content").is_some_and(Value::is_array);
        if !version_ok || seq.is_none() || !content_ok {
            skipped += 1;
            continue;
        }
        let text: String = arr(&v, "content")
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect();
        let usage = v.get("usage").cloned().unwrap_or(Value::Null);
        let chunk = v.get("chunk").and_then(|c| {
            Some((
                c.get("index").and_then(Value::as_i64)?,
                c.get("count").and_then(Value::as_i64)?,
            ))
        });
        turns.push(TranscriptTurn {
            seq: seq.unwrap_or(0),
            kind: s(&v, "kind"),
            phase: s(&v, "phase"),
            chunk,
            model: s(&v, "model"),
            prompt_tokens: optional_i64(&usage, "prompt"),
            completion_tokens: optional_i64(&usage, "completion"),
            truncated: b(&v, "truncated"),
            text,
        });
    }
    turns.sort_by_key(|turn| turn.seq);
    (turns, skipped)
}

/// Turn kind → paint tone: the model's own words are the payload (Landed),
/// an error turn is the incident (Conflicted), prompts are context the
/// operator usually already knows (Resting/Engaged).
fn turn_tone(kind: &str) -> Tone {
    match kind {
        "error" => Tone::Conflicted,
        "assistant" => Tone::Landed,
        "user" => Tone::Engaged,
        _ => Tone::Resting,
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

fn run_tone(run: &FleetRun) -> Tone {
    match run.state.as_str() {
        "running" => Tone::Engaged,
        "admitting" | "queued" | "retrying" => Tone::Gated,
        "enqueue_failed" | "failed_admission" => Tone::Conflicted,
        "superseded" => Tone::Resting,
        _ => conclusion_tone(&run.conclusion),
    }
}

fn step_tone(step: &FleetStep) -> Tone {
    match step.kind.as_str() {
        "check-completed" | "ship-verdict" | "checkpoint-written" => Tone::Landed,
        "check-completion-retry" => Tone::Gated,
        "superseded" => Tone::Resting,
        _ => Tone::Engaged,
    }
}

pub struct CloudFleetPane {
    relay_url: String,
    relay_token: String,
    account_login: String,
    ships: Vec<ShipPrompt>,
    activity: Vec<FleetRun>,
    selected_run: Option<FleetRun>,
    steps: Vec<FleetStep>,
    loaded_detail_id: Option<String>,
    loaded_detail_progress_at: Option<i64>,
    detail_retry_at: Option<std::time::Instant>,
    ship_config_attempted: bool,
    pending_proposals: Vec<FleetProposal>,
    paused: bool,
    last_run_age_sec: Option<i64>,
    queue_depth_estimate: Option<i64>,
    running: i64,
    retrying: i64,
    superseded: i64,
    failed_admission: i64,
    known_intents: i64,
    last_error: Option<String>,
    detail_error: Option<String>,
    proposal_error: Option<String>,
    /// The selected run's transcript LEDGER rows (pd-transcript.v1 Phase 4).
    sessions: Vec<TranscriptSession>,
    /// Parsed turns of the session currently shown (newest attempt of the
    /// first captured ship, unless a prior choice is still valid).
    session_turns: Vec<TranscriptTurn>,
    /// Malformed/foreign lines skipped while parsing — rendered as an honest
    /// notice, never hidden.
    session_skipped: usize,
    /// (run id, ship, attempt) the loaded session belongs to. Capture flushes
    /// ONCE at ship completion (immutable after), so a matching key means the
    /// bytes cannot have changed and the poll loop skips the refetch.
    session_key: Option<(String, String, i64)>,
    session_error: Option<String>,
}

impl Default for CloudFleetPane {
    fn default() -> Self {
        let credentials = load_relay_credentials();
        Self {
            relay_url: credentials.url,
            relay_token: credentials.token,
            account_login: credentials.login,
            ships: Vec::new(),
            activity: Vec::new(),
            selected_run: None,
            steps: Vec::new(),
            loaded_detail_id: None,
            loaded_detail_progress_at: None,
            detail_retry_at: None,
            ship_config_attempted: false,
            pending_proposals: Vec::new(),
            paused: false,
            last_run_age_sec: None,
            queue_depth_estimate: None,
            running: 0,
            retrying: 0,
            superseded: 0,
            failed_admission: 0,
            known_intents: 0,
            last_error: None,
            detail_error: None,
            proposal_error: None,
            sessions: Vec::new(),
            session_turns: Vec::new(),
            session_skipped: 0,
            session_key: None,
            session_error: None,
        }
    }
}

impl CloudFleetPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn is_configured(&self) -> bool {
        !self.relay_url.trim().is_empty() && !self.relay_token.trim().is_empty()
    }

    fn credentials_rejected(&self) -> bool {
        self.last_error
            .as_deref()
            .is_some_and(|error| error.contains("session rejected"))
            || self
                .detail_error
                .as_deref()
                .is_some_and(|error| error.contains("session rejected"))
    }

    fn apply_credentials(&mut self, credentials: RelayCredentials) -> bool {
        if self.relay_url == credentials.url
            && self.relay_token == credentials.token
            && self.account_login == credentials.login
        {
            return false;
        }
        self.relay_url = credentials.url;
        self.relay_token = credentials.token;
        self.account_login = credentials.login;
        self.last_error = None;
        self.detail_error = None;
        self.loaded_detail_id = None;
        self.loaded_detail_progress_at = None;
        self.detail_retry_at = None;
        self.ship_config_attempted = false;
        true
    }

    /// A normal estimated queue is informative, not an alarm. Pause and failed
    /// admission are the states that require operator remediation.
    fn alarmed(&self) -> bool {
        self.paused || self.failed_admission > 0
    }

    /// The selected run's captured ship sessions (pd-transcript.v1 Phase 4):
    /// the ledger table, then the shown session's turns as chat. Mirrors the
    /// web viewer's reading posture — assistant/error text is the payload and
    /// renders open (bounded), system/user prompts fold to a one-line summary,
    /// truncation and skipped lines are said out loud, and "nothing captured"
    /// is a status, not an error, because transcripts flush at ship completion.
    fn push_raw_sessions(&self, blocks: &mut Vec<Block>) {
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Raw Ship Sessions".into()));
        if let Some(err) = &self.session_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return;
        }
        if self.selected_run.is_none() {
            blocks.push(Block::KeyVal("status".into(), "no run selected".into()));
            return;
        }
        if self.sessions.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no captured sessions yet — a ship's transcript flushes when it completes".into(),
            ));
            return;
        }
        for session in self.sessions.iter().take(12) {
            blocks.push(Block::Row(vec![
                format!("pd-{}", trunc(&session.ship, 18)),
                format!("attempt {}", session.attempt),
                format!("{} turns", session.turns),
                trunc(&session.tokens_label(), 24),
                session
                    .cost_usd
                    .map(|usd| format!("${usd:.4}"))
                    .unwrap_or_else(|| "—".into()),
                if session.incomplete {
                    "INCOMPLETE".into()
                } else {
                    String::new()
                },
            ]));
        }
        let Some((_, ship, attempt)) = &self.session_key else {
            return;
        };
        blocks.push(Block::KeyVal(
            format!("pd-{ship} session"),
            format!("attempt {attempt} · raw pd-transcript.v1"),
        ));
        if self.session_skipped > 0 {
            blocks.push(Block::TranscriptLine {
                text: format!(
                    "{} malformed/foreign line(s) skipped — the raw .jsonl download carries every byte",
                    self.session_skipped
                ),
                tone: Tone::Gated,
            });
        }
        let start = self.session_turns.len().saturating_sub(10);
        for turn in &self.session_turns[start..] {
            let body = match turn.kind.as_str() {
                // Prompts fold exactly like the web viewer's <details> and the
                // CLI's --full gate: bulky context, one line, never a wall.
                "system" | "user" if !turn.text.is_empty() => {
                    format!("({} chars — prompt folded)", turn.text.len())
                }
                "system" if turn.text.is_empty() => "(system prompt deduplicated — sysRef)".into(),
                _ => trunc(&turn.text, 400),
            };
            blocks.push(Block::ChatTurn {
                speaker: turn.header(),
                text: body,
                tone: turn_tone(&turn.kind),
            });
        }
    }

    fn push_pending_proposals(&self, blocks: &mut Vec<Block>) {
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Pending Proposals".into()));
        if let Some(err) = &self.proposal_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return;
        }
        if self.pending_proposals.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no ship proposals awaiting approval".into(),
            ));
            return;
        }
        for proposal in self.pending_proposals.iter().take(10) {
            let source = if proposal.repo.is_empty() {
                proposal.source_ship.clone()
            } else if proposal.pr_number > 0 {
                format!(
                    "{} · {} PR #{}",
                    proposal.source_ship, proposal.repo, proposal.pr_number
                )
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
                label: format!(
                    "{} → approve/reject in FleetBar",
                    trunc(&proposal.title, 72)
                ),
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
            if let Some(error) = fleet_read_status_error(status) {
                return Err(error);
            }
            resp.json::<Value>()
                .await
                .map_err(|e| format!("bad response: {e}"))
        }
    }
}

fn fleet_read_status_error(status: reqwest::StatusCode) -> Option<String> {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Some("Cloud Fleet session rejected — renew it from FleetBar Credentials".into());
    }
    (!status.is_success()).then(|| format!("Cloud Fleet read failed ({status})"))
}

/// GET → response body TEXT, with the relay's deliberate 404 mapped to
/// `Ok(None)`: on the transcript surfaces, 404 means "nothing captured yet OR
/// unknown OR unauthorized" — indistinguishable by design — so it is an
/// expected answer the pane phrases honestly, never an error chip.
async fn fetch_text_ok_or_missing(
    daemon: &DaemonClient,
    url: &str,
    token: &str,
) -> std::result::Result<Option<String>, String> {
    let mut req = daemon.http_client().get(url);
    if !token.trim().is_empty() {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Err(e) => Err(format!("relay unreachable: {e}")),
        Ok(resp) => {
            let status = resp.status();
            if status == reqwest::StatusCode::NOT_FOUND {
                return Ok(None);
            }
            if let Some(error) = fleet_read_status_error(status) {
                return Err(error);
            }
            resp.text()
                .await
                .map(Some)
                .map_err(|e| format!("bad response: {e}"))
        }
    }
}

/// `{base}/fleet/runs/{id}/transcripts.json` — the run's transcript ledger.
/// Built with real URL segment encoding (never string interpolation of the
/// run id), the same discipline as [`run_detail_url`].
fn transcript_ledger_url(base: &str, run_id: &str) -> std::result::Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{}/fleet/runs/", base.trim_end_matches('/')))
        .map_err(|_| "saved relay address is invalid".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "saved relay address cannot address a run".to_string())?
        .pop_if_empty()
        .push(run_id)
        .push("transcripts.json");
    Ok(url.into())
}

/// `{base}/fleet/runs/{id}/transcript/{ship}.jsonl?attempt=N` — one captured
/// session's raw pd-transcript.v1 bytes.
fn transcript_jsonl_url(
    base: &str,
    run_id: &str,
    ship: &str,
    attempt: i64,
) -> std::result::Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{}/fleet/runs/", base.trim_end_matches('/')))
        .map_err(|_| "saved relay address is invalid".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "saved relay address cannot address a run".to_string())?
        .pop_if_empty()
        .push(run_id)
        .push("transcript")
        .push(&format!("{ship}.jsonl"));
    url.query_pairs_mut()
        .append_pair("attempt", &attempt.to_string());
    Ok(url.into())
}

fn run_detail_url(base: &str, run_id: &str) -> std::result::Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{}/v1/fleet/runs/", base.trim_end_matches('/')))
        .map_err(|_| "saved relay address is invalid".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "saved relay address cannot address a run".to_string())?
        .pop_if_empty()
        .push(run_id);
    Ok(url.into())
}

fn transcript_changed(
    loaded_id: Option<&str>,
    loaded_progress_at: Option<i64>,
    steps_empty: bool,
    run: &FleetRun,
) -> bool {
    loaded_id != Some(run.id.as_str()) || loaded_progress_at != run.last_progress_at || steps_empty
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
                "signed out — sign in from FleetBar Credentials".into(),
            ));
            self.push_pending_proposals(&mut blocks);
            return blocks;
        }

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            blocks.push(Block::Chip {
                label: "Cloud Fleet state is stale".into(),
                tone: Tone::Gated,
            });
            self.push_pending_proposals(&mut blocks);
            return blocks;
        }

        // ── Health ───────────────────────────────────────────────────────────
        let alarmed = self.alarmed();
        if !self.account_login.is_empty() {
            blocks.push(Block::KeyVal(
                "account".into(),
                format!("@{} · read-only", self.account_login),
            ));
        }
        blocks.push(Block::Chip {
            label: if self.paused {
                "PAUSED — kill switch engaged".into()
            } else {
                format!(
                    "{} running · {} retrying · {} known intents",
                    self.running, self.retrying, self.known_intents
                )
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
                format!("{} ago", duration_short(age * 1000)),
            ));
        } else {
            blocks.push(Block::KeyVal("last run".into(), "—".into()));
        }
        if let Some(depth) = self.queue_depth_estimate {
            blocks.push(Block::KeyVal(
                "queue depth (estimate)".into(),
                if depth > 0 {
                    format!("≈{depth} known queued or retrying")
                } else {
                    "0".into()
                },
            ));
        }
        if self.superseded > 0 || self.failed_admission > 0 {
            blocks.push(Block::KeyVal(
                "admission outcomes".into(),
                format!(
                    "{} superseded · {} failed admission",
                    self.superseded, self.failed_admission
                ),
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
                // age · PR # · repo · logical state · ETA/duration.
                blocks.push(Block::Row(vec![
                    age_short(run.created_at * 1000),
                    format!("PR #{}", run.pr_number),
                    trunc(&run.repo, 24),
                    trunc(&run.state.replace('_', " "), 16),
                    trunc(&run.timing(), 30),
                ]));
                let head = trunc(&run.head_sha, 7);
                blocks.push(Block::Chip {
                    label: if run.is_active() {
                        format!(
                            "PR #{} · {} · gen {} · delivery {} · {}",
                            run.pr_number, run.state, run.generation, run.attempt_count, head
                        )
                    } else {
                        format!(
                            "PR #{} · {} · {} · {}",
                            run.pr_number,
                            run.conclusion,
                            duration_short(run.elapsed_ms),
                            head
                        )
                    },
                    tone: run_tone(run),
                });
                if !run.last_error.is_empty() {
                    blocks.push(Block::TranscriptLine {
                        text: format!(
                            "PR #{} error: {}",
                            run.pr_number,
                            trunc(&run.last_error, 120)
                        ),
                        tone: Tone::Conflicted,
                    });
                }
            }
        }

        // ── Selected live transcript ──────────────────────────────────────────
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Live Transcript".into()));
        if let Some(run) = &self.selected_run {
            blocks.push(Block::KeyVal(
                format!("{} PR #{}", run.repo, run.pr_number),
                format!(
                    "{} · gen {} · delivery {} · {}",
                    run.state,
                    run.generation,
                    run.attempt_count,
                    run.timing()
                ),
            ));
            if let Some(err) = &self.detail_error {
                blocks.push(Block::KeyVal("transcript".into(), err.clone()));
            } else if self.steps.is_empty() {
                blocks.push(Block::KeyVal(
                    "transcript".into(),
                    if run.has_transcript {
                        "durable steps are not readable yet".into()
                    } else {
                        "legacy receipt — no durable transcript".into()
                    },
                ));
            } else {
                blocks.push(Block::KeyVal(
                    "timestamps".into(),
                    "actual UTC; per-step ETA shown only when executor publishes one".into(),
                ));
                let start = self.steps.len().saturating_sub(12);
                for step in &self.steps[start..] {
                    let expected = step
                        .expected_at
                        .map(|at| format!(" · expected {}Z", hhmmss_seconds(at)))
                        .unwrap_or_else(|| " · step ETA unavailable".into());
                    blocks.push(Block::TranscriptLine {
                        text: format!(
                            "{}Z · {:02} · {} · {}{}\n{}",
                            hhmmss_seconds(step.created_at),
                            step.seq,
                            if step.ship.is_empty() {
                                &step.kind
                            } else {
                                &step.ship
                            },
                            step.title,
                            expected,
                            step.explanation()
                        ),
                        tone: step_tone(step),
                    });
                }
            }
        } else {
            blocks.push(Block::KeyVal("status".into(), "no run selected".into()));
        }

        // ── Raw ship sessions (pd-transcript.v1 — Phase 4) ────────────────────
        self.push_raw_sessions(&mut blocks);

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

            // Sign-in and token rotation happen outside the console. Reload on
            // every producer tick, but keep a rejected unchanged credential
            // parked so the UI does not hammer the operator endpoint.
            let credentials_changed = self.apply_credentials(load_relay_credentials());

            // Unconfigured → no-op; view() shows the actionable hint instead.
            if !self.is_configured() {
                return Ok(());
            }
            if self.credentials_rejected() && !credentials_changed {
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
                    self.queue_depth_estimate = match data.get("queueDepthEstimate") {
                        Some(Value::Number(x)) => x.as_i64(),
                        _ => None,
                    };
                    self.running = n(&data, "running");
                    self.retrying = n(&data, "retrying");
                    self.superseded = n(&data, "superseded");
                    self.failed_admission = n(&data, "failedAdmission");
                    self.known_intents = n(&data, "knownIntents");
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

            // Follow the active run by default and refresh its durable transcript.
            // If the operator's previously selected run still exists, retain it.
            let selected_id = self.selected_run.as_ref().map(|run| run.id.as_str());
            let selected = selected_id
                .and_then(|id| self.activity.iter().find(|run| run.id == id))
                .or_else(|| self.activity.iter().find(|run| run.is_active()))
                .or_else(|| self.activity.first())
                .cloned();
            self.selected_run = selected.clone();
            if let Some(run) = selected {
                let selection_changed = self.loaded_detail_id.as_deref() != Some(run.id.as_str());
                if selection_changed {
                    self.detail_retry_at = None;
                }
                let needs_transcript_refresh = transcript_changed(
                    self.loaded_detail_id.as_deref(),
                    self.loaded_detail_progress_at,
                    self.steps.is_empty(),
                    &run,
                );
                let retry_ready = self
                    .detail_retry_at
                    .map(|at| std::time::Instant::now() >= at)
                    .unwrap_or(true);
                match (needs_transcript_refresh && retry_ready)
                    .then(|| run_detail_url(&base, &run.id))
                    .transpose()
                {
                    Err(error) => {
                        self.detail_error = Some(error);
                        self.steps.clear();
                    }
                    Ok(Some(url)) => match fetch_json(daemon, &url, &token).await {
                        Err(error) => {
                            self.detail_error = Some(error);
                            self.detail_retry_at = Some(
                                std::time::Instant::now() + std::time::Duration::from_secs(30),
                            );
                        }
                        Ok(data) => {
                            self.detail_error = None;
                            self.detail_retry_at = None;
                            if let Some(detail_run) = data.get("run") {
                                self.selected_run = Some(FleetRun::from_value(detail_run));
                            }
                            self.steps = arr(&data, "steps")
                                .iter()
                                .map(FleetStep::from_value)
                                .collect();
                            self.steps.sort_by_key(|step| step.seq);
                            self.loaded_detail_id = Some(run.id.clone());
                            self.loaded_detail_progress_at = run.last_progress_at;
                        }
                    },
                    Ok(None) => {}
                }
            } else {
                self.detail_error = None;
                self.steps.clear();
                self.loaded_detail_id = None;
                self.loaded_detail_progress_at = None;
                self.detail_retry_at = None;
            }

            // ── Raw ship sessions (pd-transcript.v1 — Phase 4) ────────────────
            // Ledger first; then one session's raw turns. Capture flushes ONCE
            // at ship completion, so a session whose (run, ship, attempt) key we
            // already loaded is immutable — the poll loop refetches only the
            // cheap ledger, never the bytes it already has.
            if let Some(run) = self.selected_run.clone() {
                match transcript_ledger_url(&base, &run.id) {
                    Err(error) => {
                        self.session_error = Some(error);
                        self.sessions.clear();
                    }
                    Ok(url) => match fetch_text_ok_or_missing(daemon, &url, &token).await {
                        Err(error) => self.session_error = Some(error),
                        Ok(None) => {
                            // The relay's uniform 404: nothing captured yet (or
                            // not visible) — a status the view phrases honestly.
                            self.session_error = None;
                            self.sessions.clear();
                            self.session_turns.clear();
                            self.session_skipped = 0;
                            self.session_key = None;
                        }
                        Ok(Some(body)) => {
                            self.session_error = None;
                            let data: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                            self.sessions = arr(&data, "transcripts")
                                .iter()
                                .map(TranscriptSession::from_value)
                                .collect();
                            // Keep the prior ship choice while it still exists in
                            // the ledger; otherwise show the first captured ship
                            // (ledger order is ship ASC, newest attempt first).
                            let wanted = self
                                .session_key
                                .as_ref()
                                .filter(|(run_id, ship, attempt)| {
                                    run_id == &run.id
                                        && self.sessions.iter().any(|session| {
                                            &session.ship == ship && session.attempt == *attempt
                                        })
                                })
                                .cloned()
                                .or_else(|| {
                                    self.sessions.first().map(|session| {
                                        (run.id.clone(), session.ship.clone(), session.attempt)
                                    })
                                });
                            match wanted {
                                None => {
                                    self.session_turns.clear();
                                    self.session_skipped = 0;
                                    self.session_key = None;
                                }
                                Some(key) if self.session_key.as_ref() == Some(&key) => {}
                                Some((run_id, ship, attempt)) => {
                                    match transcript_jsonl_url(&base, &run_id, &ship, attempt) {
                                        Err(error) => self.session_error = Some(error),
                                        Ok(url) => {
                                            match fetch_text_ok_or_missing(daemon, &url, &token)
                                                .await
                                            {
                                                Err(error) => self.session_error = Some(error),
                                                Ok(None) => {
                                                    self.session_turns.clear();
                                                    self.session_skipped = 0;
                                                    self.session_key = None;
                                                }
                                                Ok(Some(jsonl)) => {
                                                    let (turns, skipped) =
                                                        parse_transcript_jsonl(&jsonl);
                                                    self.session_turns = turns;
                                                    self.session_skipped = skipped;
                                                    self.session_key =
                                                        Some((run_id, ship, attempt));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                }
            } else {
                self.sessions.clear();
                self.session_turns.clear();
                self.session_skipped = 0;
                self.session_key = None;
                self.session_error = None;
            }

            // Ship config (read-only prompts/roles). Tolerate either {ships:[...]}
            // or {config:{ships:[...]}} drift; pull name + role defensively.
            if !self.ship_config_attempted {
                self.ship_config_attempted = true;
                match fetch_json(daemon, &format!("{base}/v1/fleet/config"), &token).await {
                    Err(_) => self.ships.clear(),
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
        p.account_login = "operator".into();
        p.last_error = None;
        p
    }

    #[test]
    fn unconfigured_shows_hint_not_error() {
        let mut p = CloudFleetPane::default();
        p.relay_url = String::new();
        p.relay_token = String::new();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Cloud Fleet"));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(_, v) if v.contains("FleetBar Credentials")
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
    fn estimated_queue_is_visible_but_not_mislabeled_as_an_alarm() {
        let mut p = configured();
        p.queue_depth_estimate = Some(3);
        assert!(!p.alarmed());
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "queue depth (estimate)" && v.contains("≈3")
        )));
    }

    #[test]
    fn failed_admission_alarms_even_when_executor_is_not_paused() {
        let mut p = configured();
        p.failed_admission = 2;
        assert!(p.alarmed());
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Chip {
                tone: Tone::Conflicted,
                ..
            }
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "admission outcomes" && v.contains("2 failed")
        )));
    }

    #[test]
    fn run_from_value_parses_relay_shape() {
        let v = json!({
            "id": "uuid", "prNumber": 123, "repo": "owner/repo",
            "prUrl": "https://github.com/owner/repo/pull/123",
            "headSha": "abc123d", "conclusion": "success",
            "ships": ["linter", "qa"], "elapsedMs": 45000, "createdAt": 1719432000i64,
            "state": "retrying", "generation": 3, "attemptCount": 4,
            "lastProgressAt": 1719432040i64,
            "expectedStartAt": 1719432060i64, "queueAheadEstimate": 2,
            "hasTranscript": true, "lastError": "completion pending"
        });
        let r = FleetRun::from_value(&v);
        assert_eq!(r.pr_number, 123);
        assert_eq!(r.repo, "owner/repo");
        assert_eq!(r.conclusion, "success");
        assert_eq!(r.ships, vec!["linter".to_string(), "qa".to_string()]);
        assert_eq!(r.elapsed_ms, 45000);
        assert_eq!(r.state, "retrying");
        assert_eq!(r.generation, 3);
        assert_eq!(r.attempt_count, 4);
        assert_eq!(r.queue_ahead_estimate, Some(2));
        assert!(r.has_transcript);
    }

    #[test]
    fn admission_states_do_not_invent_a_delivery_and_failures_use_the_relay_name() {
        let admitting = FleetRun::from_value(&json!({
            "id": "intent:admitting", "state": "admitting", "generation": 0,
            "attemptCount": -3, "queueAheadEstimate": -2
        }));
        assert!(admitting.is_active());
        assert_eq!(admitting.generation, 1);
        assert_eq!(admitting.attempt_count, 0);
        assert_eq!(admitting.queue_ahead_estimate, None);
        assert!(admitting.timing().contains("admission"));
        assert!(matches!(run_tone(&admitting), Tone::Gated));

        let failed = FleetRun::from_value(&json!({
            "id": "intent:failed", "state": "enqueue_failed", "attemptCount": 0
        }));
        assert!(!failed.is_active());
        assert!(matches!(run_tone(&failed), Tone::Conflicted));

        let missing_state = FleetRun::from_value(&json!({ "id": "intent:unknown", "state": "" }));
        assert_eq!(missing_state.state, "unknown");
        assert!(!missing_state.is_active());
    }

    #[test]
    fn transcript_read_is_cumulative_until_progress_or_selection_changes() {
        let run = FleetRun::from_value(&json!({
            "id": "intent:delivery-live",
            "state": "running",
            "lastProgressAt": 1719432040i64
        }));
        assert!(transcript_changed(None, None, true, &run));
        assert!(!transcript_changed(
            Some("intent:delivery-live"),
            Some(1719432040),
            false,
            &run
        ));
        assert!(transcript_changed(
            Some("intent:delivery-live"),
            Some(1719432030),
            false,
            &run
        ));
        assert!(transcript_changed(
            Some("intent:another"),
            Some(1719432040),
            false,
            &run
        ));
        assert!(transcript_changed(
            Some("intent:delivery-live"),
            None,
            false,
            &run
        ));
    }

    #[test]
    fn cloud_fleet_http_statuses_distinguish_credentials_from_service_failures() {
        let unauthorized = fleet_read_status_error(reqwest::StatusCode::UNAUTHORIZED)
            .expect("401 must require credential remediation");
        let forbidden = fleet_read_status_error(reqwest::StatusCode::FORBIDDEN)
            .expect("403 must require credential remediation");
        assert!(unauthorized.contains("FleetBar Credentials"));
        assert_eq!(unauthorized, forbidden);

        assert_eq!(
            fleet_read_status_error(reqwest::StatusCode::INTERNAL_SERVER_ERROR),
            Some("Cloud Fleet read failed (500 Internal Server Error)".into())
        );
        assert_eq!(fleet_read_status_error(reqwest::StatusCode::OK), None);
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
        let run = FleetRun::from_value(&json!({
            "id": "intent:delivery-live",
            "prNumber": 7,
            "repo": "port-daddy/relay",
            "headSha": "abcdef123456",
            "conclusion": null,
            "ships": ["linter"],
            "elapsedMs": 12345,
            "createdAt": 1719432000i64,
            "state": "running",
            "generation": 2,
            "attemptCount": 4,
            "expectedFinishAt": 1719432300i64,
            "hasTranscript": true
        }));
        p.activity = vec![run.clone()];
        p.selected_run = Some(run);
        p.steps = vec![FleetStep::from_value(&json!({
            "seq": 4,
            "kind": "check-completion-retry",
            "ship": null,
            "title": "GitHub completion deferred",
            "createdAt": 1719432100i64
        }))];
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
            b, Block::Chip { tone: Tone::Engaged, label } if label.contains("delivery 4")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Header(h) if h == "Live Transcript"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::TranscriptLine { text, tone: Tone::Gated }
                if text.contains("GitHub completion deferred")
                    && text.contains("step ETA unavailable")
                    && text.contains("rate-limited")
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
        p.relay_token = String::new();
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

    #[test]
    fn credentials_default_to_signed_in_account_and_allow_explicit_overrides() {
        let stored_token = format!("pdu_{}", "a".repeat(64));
        let stored = format!(
            r#"{{
            "token":"{stored_token}",
            "login":"operator",
            "relayUrl":"https://stored.example/"
        }}"#
        );
        let stored_only = resolve_relay_credentials(None, None, Some(&stored));
        assert_eq!(stored_only.url, "https://stored.example");
        assert_eq!(stored_only.token, stored_token);
        assert_eq!(stored_only.login, "operator");

        let override_token = format!("pdu_{}", "b".repeat(64));
        let overridden = resolve_relay_credentials(
            Some("https://dev.example/".into()),
            Some(override_token.clone()),
            Some(&stored),
        );
        assert_eq!(overridden.url, "https://dev.example");
        assert_eq!(overridden.token, override_token);
        assert!(overridden.login.is_empty());
    }

    #[test]
    fn rotated_account_recovers_without_relaunching_console() {
        let mut pane = configured();
        pane.last_error =
            Some("Cloud Fleet session rejected — renew it from FleetBar Credentials".into());
        pane.loaded_detail_id = Some("run-old".into());
        pane.ship_config_attempted = true;
        assert!(pane.credentials_rejected());

        assert!(pane.apply_credentials(RelayCredentials {
            url: "https://relay.example.dev".into(),
            token: "tok-rotated".into(),
            login: "operator".into(),
        }));
        assert_eq!(pane.relay_token, "tok-rotated");
        assert!(pane.last_error.is_none());
        assert!(pane.loaded_detail_id.is_none());
        assert!(!pane.ship_config_attempted);
        assert!(!pane.credentials_rejected());
    }

    #[test]
    fn run_detail_url_encodes_colons_without_changing_the_run_id() {
        let url = run_detail_url("https://relay.example", "intent:delivery-live").unwrap();
        assert_eq!(
            url,
            "https://relay.example/v1/fleet/runs/intent:delivery-live"
        );
    }

    // ── Raw ship sessions (pd-transcript.v1 — Phase 4) ───────────────────────

    fn turn_line(seq: i64, kind: &str, text: &str, extra: Value) -> String {
        let mut v = json!({
            "v": 1, "seq": seq, "phase": "map", "chunk": null, "kind": kind,
            "model": "fixture/test-model", "ts": 1_700_000_000, "latencyMs": 900,
            "usage": {"prompt": 100, "completion": 20}, "costUsd": 0.0012,
            "content": [{"type": "text", "text": text}], "sysRef": null,
            "truncated": false,
        });
        if let (Value::Object(base), Value::Object(over)) = (&mut v, extra) {
            for (k, val) in over {
                base.insert(k, val);
            }
        }
        v.to_string()
    }

    #[test]
    fn parse_transcript_jsonl_is_tolerant_and_counts_what_it_skips() {
        let body = [
            turn_line(1, "assistant", "FLEET-VERDICT: PASS", json!({"chunk": {"index": 2, "count": 7}})),
            turn_line(0, "system", "You are pd-qa.", json!({})),
            "not-json-at-all".into(),
            turn_line(9, "assistant", "future major", json!({"v": 2})),
            turn_line(3, "assistant", "wrong-typed content", json!({"content": "a string"})),
            turn_line(2, "error", "Workers AI 429", json!({"truncated": true, "usage": null})),
        ]
        .join("\n");
        let (turns, skipped) = parse_transcript_jsonl(&body);
        // 3 renderable turns, sorted by seq; 3 skips (bad JSON, v2, bad content).
        assert_eq!(turns.len(), 3);
        assert_eq!(skipped, 3);
        assert_eq!(
            turns.iter().map(|t| t.seq).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(turns[1].phase_label(), "MAP 3/7");
        assert!(turns[1].header().contains("100 in / 20 out"));
        assert!(turns[2].header().contains("TRUNCATED"));
        assert!(!turns[2].header().contains("in /"), "null usage prints no counts");
    }

    fn pane_with_session() -> CloudFleetPane {
        let mut pane = configured();
        pane.selected_run = Some(FleetRun::from_value(&json!({
            "id": "run:d-1", "prNumber": 7, "repo": "octo/widgets",
            "headSha": "abc", "conclusion": "success", "ships": ["qa"],
            "elapsedMs": 1000, "createdAt": 1_700_000_000, "state": "success",
        })));
        pane.sessions = vec![
            TranscriptSession {
                ship: "qa".into(),
                attempt: 2,
                turns: 3,
                prompt_tokens: Some(1200),
                completion_tokens: Some(240),
                cost_usd: Some(0.0031),
                incomplete: false,
            },
            TranscriptSession {
                ship: "purser".into(),
                attempt: 1,
                turns: 14,
                prompt_tokens: None,
                completion_tokens: None,
                cost_usd: None,
                incomplete: true,
            },
        ];
        let (turns, skipped) = parse_transcript_jsonl(
            &[
                turn_line(0, "system", "You are pd-qa.", json!({})),
                turn_line(1, "user", "diff chunk one", json!({})),
                turn_line(2, "assistant", "FLEET-VERDICT: PASS", json!({})),
                turn_line(3, "error", "Workers AI 429", json!({"truncated": true})),
                "corrupt".into(),
            ]
            .join("\n"),
        );
        pane.session_turns = turns;
        pane.session_skipped = skipped;
        pane.session_key = Some(("run:d-1".into(), "qa".into(), 2));
        pane
    }

    #[test]
    fn raw_sessions_render_ledger_rows_folded_prompts_and_honest_notices() {
        let blocks = pane_with_session().view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Header(h) if h == "Raw Ship Sessions")));
        // Ledger rows: real tokens on one, honest "not reported" + INCOMPLETE
        // on the other — never a lying 0/0.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.iter().any(|c| c == "pd-qa")
                && cells.iter().any(|c| c.contains("1200 in / 240 out"))
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.iter().any(|c| c == "pd-purser")
                && cells.iter().any(|c| c.contains("not reported"))
                && cells.iter().any(|c| c == "INCOMPLETE")
        )));
        // Prompts fold; the model's words render open; the error turn alarms.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ChatTurn { speaker, text, .. }
                if speaker.starts_with("#t0 SYSTEM") && text.contains("prompt folded")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ChatTurn { text, tone: Tone::Landed, .. }
                if text.contains("FLEET-VERDICT: PASS")
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::ChatTurn { speaker, tone: Tone::Conflicted, .. }
                if speaker.contains("TRUNCATED")
        )));
        // The skipped corrupt line is disclosed, never silent.
        assert!(blocks.iter().any(|b| matches!(
            b, Block::TranscriptLine { text, .. } if text.contains("1 malformed/foreign line(s) skipped")
        )));
    }

    #[test]
    fn no_captures_is_a_status_not_an_error() {
        let mut pane = pane_with_session();
        pane.sessions.clear();
        pane.session_turns.clear();
        pane.session_key = None;
        pane.session_skipped = 0;
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "status" && v.contains("flushes when it completes")
        )));
        assert!(!blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
    }

    #[test]
    fn transcript_urls_encode_segments_and_carry_the_attempt() {
        assert_eq!(
            transcript_ledger_url("https://relay.example/", "run:d-1").unwrap(),
            "https://relay.example/fleet/runs/run:d-1/transcripts.json"
        );
        assert_eq!(
            transcript_jsonl_url("https://relay.example", "run:d-1", "qa", 2).unwrap(),
            "https://relay.example/fleet/runs/run:d-1/transcript/qa.jsonl?attempt=2"
        );
    }

    // ── PNG proofs (offscreen Block raster — same pattern as hitl-interruptions;
    //    gpui 0.2.2 exposes no offscreen Metal readback, see headless_capture.rs) ──

    fn write_png(name: &str, blocks: &[Block]) -> Vec<u8> {
        let canvas = crate::headless_capture::render_blocks(blocks, &crate::theme::DARK, 1100);
        let png = canvas.to_png();
        assert!(png.len() > 2_000, "{name}: suspiciously small PNG");
        assert_eq!(&png[0..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../target/cloud-fleet-transcript-{name}.png"));
        std::fs::write(&out, &png).expect("write png");
        png
    }

    /// Only the raw-sessions SECTION, not the whole pane — the committed
    /// proofs stay small and legible (the hitl-interruptions convention).
    fn section_blocks(pane: &CloudFleetPane) -> Vec<Block> {
        let mut blocks = Vec::new();
        pane.push_raw_sessions(&mut blocks);
        blocks
    }

    #[test]
    fn renders_the_session_states_to_real_pngs() {
        let with_session = write_png("session", &section_blocks(&pane_with_session()));
        let mut empty = pane_with_session();
        empty.sessions.clear();
        empty.session_turns.clear();
        empty.session_key = None;
        let no_captures = write_png("empty", &section_blocks(&empty));
        assert_ne!(with_session, no_captures);
    }
}
