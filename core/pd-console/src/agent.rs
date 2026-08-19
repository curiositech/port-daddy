//! Daemon client for pd-console.
//!
//! New work enters through one Surface Gateway WorkIntent command. The console
//! supplies intent, constraints, and provenance; the daemon owns WorkPlan,
//! AgentNode, AgentRun, and Squid-governed Body decisions. The console has no
//! backend/model selection or direct spawn, sortie, or dispatch launch path.

use anyhow::{anyhow, Context, Result};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_WORK_TOKEN: AtomicU64 = AtomicU64::new(1);

fn work_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_WORK_TOKEN.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{}-{sequence}", nanos, std::process::id())
}

fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// One message off the tube.
#[derive(Debug, Clone)]
pub struct TubeMsg {
    pub id: u64,
    pub sender: String,
    pub text: String,
}

impl TubeMsg {
    /// Parse one message from a `GET /msg/:channel/subscribe` SSE `data:` object.
    ///
    /// The daemon (routes/messaging.ts → lib/messaging.ts) pushes each published
    /// message as `{ id, channel, payload, contentType, sender, createdAt }`, where
    /// `payload` is a bare string or `{text|content:...}` (a `tube_send` wraps its
    /// text as `{text:...}`). Returns `None` for the first `event: connected`
    /// handshake (`{channel:...}`, no `payload`) and any `event: timeout` frame, so
    /// the caller simply skips those — mirroring [`StreamEnvelope::from_value`]'s
    /// tolerance so a schema drift can never kill the channel lane.
    pub fn from_value(v: &serde_json::Value) -> Option<TubeMsg> {
        // The handshake/timeout frames carry no `payload`; that is the signal this
        // is not a real message (an actual empty payload is rejected daemon-side).
        let payload = v.get("payload")?;
        Some(TubeMsg {
            id: v.get("id").and_then(|i| i.as_u64()).unwrap_or(0),
            sender: v
                .get("sender")
                .and_then(|s| s.as_str())
                .unwrap_or("?")
                .to_string(),
            text: extract_text(Some(payload)),
        })
    }
}

// ── Live agent stream (GET /agents/:id/stream, SSE) ───────────────────────────
//
// The cockpit's "watch in real time" feed. The daemon (PR #404) opens an SSE
// stream and emits, after a first `event: connected` frame, typed envelopes
//   { v: 1, kind, agentId, body, ts }
// where `kind` ∈ { agent.status, agent.tube, agent.transcript }. We parse those
// envelopes off the raw byte stream and hand them to the UI on a channel.
//
// Parsing is deliberately tolerant (the util.rs house rule): an unknown `kind`
// becomes `StreamKind::Other(..)` rather than a hard error, and a malformed
// `data:` line is skipped, so a schema drift can never kill the live lane.

/// What a stream envelope carries. Mirrors the daemon's `kind` discriminant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamKind {
    /// `agent.status` — lifecycle/readiness transitions.
    Status,
    /// `agent.tube` — a message on the steering channel `agent:<id>` (this is
    /// also where an operator's own `control.interrupt` reappears — the closed
    /// loop).
    Tube,
    /// `agent.transcript` — streaming transcript text + tool-call deltas.
    Transcript,
    /// Any future/unknown kind, preserved verbatim so the UI can still show it.
    Other(String),
}

impl StreamKind {
    fn parse(s: &str) -> StreamKind {
        match s {
            "agent.status" => StreamKind::Status,
            "agent.tube" => StreamKind::Tube,
            "agent.transcript" => StreamKind::Transcript,
            other => StreamKind::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            StreamKind::Status => "agent.status",
            StreamKind::Tube => "agent.tube",
            StreamKind::Transcript => "agent.transcript",
            StreamKind::Other(s) => s,
        }
    }
}

/// One typed frame off the live agent stream.
#[derive(Debug, Clone)]
pub struct StreamEnvelope {
    pub v: u64,
    pub kind: StreamKind,
    pub agent_id: String,
    /// The kind-specific payload, kept as a `Value` so the UI extracts fields
    /// tolerantly (epoch-ms numbers, nulls, drift) instead of via strict serde.
    pub body: serde_json::Value,
    pub ts: i64,
}

impl StreamEnvelope {
    /// Parse one envelope from a single SSE `data:` JSON object. Returns `None`
    /// for the `connected` handshake frame (no `kind`) or any frame we can't
    /// make sense of — the caller simply skips those.
    pub fn from_value(v: &serde_json::Value) -> Option<StreamEnvelope> {
        let kind = v.get("kind").and_then(|k| k.as_str())?;
        Some(StreamEnvelope {
            v: v.get("v").and_then(|n| n.as_u64()).unwrap_or(1),
            kind: StreamKind::parse(kind),
            agent_id: v
                .get("agentId")
                .and_then(|a| a.as_str())
                .unwrap_or_default()
                .to_string(),
            body: v.get("body").cloned().unwrap_or(serde_json::Value::Null),
            ts: v.get("ts").and_then(|t| t.as_i64()).unwrap_or(0),
        })
    }
}

/// Incremental parser for an `text/event-stream` byte feed. SSE frames are
/// separated by a blank line; within a frame, `data:` lines are concatenated
/// and `:`-prefixed lines are comments (heartbeats). We only care about the
/// data payload; the `event:` name is advisory because the envelope carries its
/// own `kind`. Feed raw chunks in; pull out completed `data:` JSON strings.
#[derive(Default)]
pub struct SseParser {
    /// Bytes received but not yet split into complete lines.
    buf: String,
    /// `data:` lines accumulated for the frame currently being assembled.
    data: Vec<String>,
    /// The most recent SSE `id:` seen. Per the SSE spec this is sticky — it
    /// persists across events until a new `id:` arrives — and is the value the
    /// client echoes back as `Last-Event-ID` on reconnect so the daemon can
    /// resume the stream instead of replaying from the head (or dropping the
    /// gap). Without capturing this, a dropped connection silently loses or
    /// duplicates frames — the interchange "idempotency gap".
    last_id: Option<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// The last event id seen so far, for `Last-Event-ID` resume on reconnect.
    pub fn last_id(&self) -> Option<&str> {
        self.last_id.as_deref()
    }

    /// Feed a chunk of bytes; returns any `data:` payloads that completed
    /// (one String of concatenated data per dispatched event).
    pub fn feed(&mut self, chunk: &str) -> Vec<String> {
        self.buf.push_str(chunk);
        let mut out = Vec::new();
        // Process every complete line (terminated by '\n') left in the buffer.
        while let Some(nl) = self.buf.find('\n') {
            let mut line: String = self.buf.drain(..=nl).collect();
            // Trim the trailing '\n' and an optional '\r' (CRLF tolerance).
            if line.ends_with('\n') {
                line.pop();
            }
            if line.ends_with('\r') {
                line.pop();
            }
            if line.is_empty() {
                // Blank line dispatches the current event.
                if !self.data.is_empty() {
                    out.push(self.data.join("\n"));
                    self.data.clear();
                }
            } else if let Some(rest) = line.strip_prefix("data:") {
                // SSE spec: a single leading space after the colon is stripped.
                self.data
                    .push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
            } else if let Some(rest) = line.strip_prefix("id:") {
                // Sticky last-event-id for resumable reconnect.
                self.last_id = Some(rest.strip_prefix(' ').unwrap_or(rest).to_string());
            }
            // `event:` and `:comment` (heartbeat) lines are ignored — the
            // envelope's own `kind` is authoritative.
        }
        out
    }
}

/// Thin client for the live daemon — discovers it the canonical way (PR #261):
/// `PORT_DADDY_URL`, else the operator's selected `console-daemon.url`, else the
/// TCP port the running daemon wrote to `~/.port-daddy/daemon.port`, else the
/// canonical stable berth. The design intent of the final fallback: a fresh
/// console must always open — pointing at the one port the stable daemon is
/// contractually berthed on — and render "daemon unreachable" state in-pane,
/// rather than panicking before the window exists and leaving the operator
/// with a stack trace instead of an instruction.
pub struct DaemonClient {
    base: String,
    http: reqwest::Client,
}

/// Durable daemon truth returned for one operator WorkIntent. `intent` and
/// `plan` remain tolerant JSON objects so additive v0 fields survive a newer
/// daemon without crashing an older console.
#[derive(Debug, Clone)]
pub struct WorkSnapshot {
    pub intent: serde_json::Value,
    pub plan: Option<serde_json::Value>,
}

impl WorkSnapshot {
    pub fn intent_id(&self) -> &str {
        self.intent
            .get("intentId")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown-intent")
    }

    pub fn goal(&self) -> &str {
        self.intent
            .get("goal")
            .and_then(|v| v.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled work")
    }

    pub fn plan_state(&self) -> &str {
        self.plan
            .as_ref()
            .and_then(|v| v.get("state"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
    }
}

#[derive(Debug, Clone)]
pub struct WorkIntentReceipt {
    pub status: String,
    pub duplicate: bool,
    pub correlation_id: String,
    pub snapshot: WorkSnapshot,
    pub next_action: String,
}

#[derive(Debug, Clone)]
pub struct WorkExecutionReceipt {
    pub status: String,
    pub duplicate: bool,
    pub correlation_id: String,
    pub snapshot: WorkSnapshot,
    pub projection: String,
    pub dispatch_id: String,
    pub state: String,
    pub session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub launched_this_tick: usize,
    pub next_action: String,
}

fn work_snapshot(value: &serde_json::Value) -> Result<WorkSnapshot> {
    let intent = value
        .get("intent")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or_else(|| anyhow!("Surface Gateway response omitted WorkIntent truth"))?;
    let plan = value.get("plan").filter(|v| v.is_object()).cloned();
    Ok(WorkSnapshot { intent, plan })
}

fn build_work_intent_envelope(
    goal: &str,
    token: &str,
    issued_at: &str,
    workdir: Option<&str>,
) -> serde_json::Value {
    let idempotency_key = format!("pd-console:work:{token}");
    let mut constraints = serde_json::json!({
        "placement": "local-only",
        "maxCostUsd": 10.0,
        "parallelism": "planner-decides",
        "reviewRequired": true,
        "destructiveActions": "human-approval"
    });
    if let (Some(workdir), Some(map)) = (workdir, constraints.as_object_mut()) {
        map.insert(
            "workdir".to_string(),
            serde_json::Value::String(workdir.to_string()),
        );
    }
    let mut source = serde_json::json!({
        "kind": "console",
        "surface": "pd-console",
        "actorId": "operator:local"
    });
    if let (Some(workdir), Some(map)) = (workdir, source.as_object_mut()) {
        map.insert(
            "worktree".to_string(),
            serde_json::Value::String(workdir.to_string()),
        );
    }
    serde_json::json!({
        "schema": "pd.agent-harbor.surface-gateway.v0",
        "envelopeId": format!("surface_gateway_console_{token}"),
        "correlationId": format!("corr_console_{token}"),
        "surface": "pd-console",
        "direction": "surface-to-daemon",
        "mode": "command",
        "noun": "WorkIntent",
        "operation": "work-intent.capture",
        "issuedBy": "pd-console:operator:local",
        "issuedAt": issued_at,
        "idempotencyKey": idempotency_key,
        "payload": {
            "schema": "pd.agent-harbor.work-intent.v0",
            "intentId": format!("work_intent_console_{token}"),
            "idempotencyKey": idempotency_key,
            "source": source,
            "goal": { "text": goal },
            "constraints": constraints,
            "startPolicy": "queued",
            "attachExisting": false,
            "operator": "operator:local",
            "status": "captured",
            "createdAt": issued_at
        }
    })
}

fn build_work_intent_start_envelope(
    snapshot: &WorkSnapshot,
    token: &str,
    issued_at: &str,
) -> serde_json::Value {
    let intent_id = snapshot.intent_id();
    serde_json::json!({
        "schema": "pd.agent-harbor.surface-gateway.v0",
        "envelopeId": format!("surface_gateway_console_start_{token}"),
        "correlationId": format!("corr_console_start_{token}"),
        "surface": "pd-console",
        "direction": "surface-to-daemon",
        "mode": "command",
        "noun": "WorkIntent",
        "operation": "work-intent.start",
        "issuedBy": "pd-console:operator:local",
        "issuedAt": issued_at,
        "idempotencyKey": format!("pd-console:start:{intent_id}"),
        "payload": snapshot.intent.clone()
    })
}

/// Funnel a daemon response through a status check. reqwest treats 4xx/5xx as
/// `Ok`, so any call that cares whether the daemon accepted the request must
/// pass through here before reading the body — otherwise a rejection reads as
/// success. Returns the response on 2xx; an error with status + body otherwise
/// (best-effort body read, since we are already on the error path).
async fn ensure_success(resp: reqwest::Response, op: &str) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        Ok(resp)
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(anyhow!("{op} failed: HTTP {status}: {}", body.trim()))
    }
}

/// Whether an SSE (re)connect that came back with `status` should be RETRIED
/// (transient) rather than abandoned (permanent). A `429 Too Many Requests` — the
/// messaging route's connection-limit, which ships a `Retry-After` (routes/messaging.ts) —
/// and any `5xx` (the daemon restarting, e.g. a freshness self-heal) are transient:
/// backing off and reconnecting recovers the lane. Any other non-2xx (a `400`
/// invalid channel, a `404` unknown agent) is permanent — retrying it just spins.
/// Pure + unit-tested so the reconnect policy is a checked contract, not folklore
/// buried in a match arm (the bug: treating *every* non-2xx as permanent killed the
/// live lane forever on a transient blip).
fn sse_status_is_retryable(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

impl DaemonClient {
    pub fn discover() -> Result<Self> {
        // Resolution order, highest priority first:
        //   1. `PORT_DADDY_URL` env — explicit override for one launch.
        //   2. `~/.port-daddy/console-daemon.url` — the operator's selected daemon
        //      (a one-line URL). This is the console's "use this daemon" switch:
        //      point it at a dev berth (e.g. http://127.0.0.1:9886) WITHOUT
        //      clobbering the canonical daemon.port. Delete the file to fall back
        //      to stable. The status bar shows which URL is live.
        //   3. `~/.port-daddy/daemon.port` — the canonical (stable) daemon.
        //   4. The stable berth itself — the daemon's contractual default port.
        //      A console that cannot find any registration still opens against
        //      the address the stable daemon will occupy, and the panes render
        //      reachability truthfully instead of the process dying pre-window.
        if let Ok(url) = std::env::var("PORT_DADDY_URL") {
            return Ok(Self::new(url));
        }
        let home = dirs::home_dir();
        if let Some(url) = home
            .as_ref()
            .map(|h| h.join(".port-daddy/console-daemon.url"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            return Ok(Self::new(url));
        }
        if let Some(port) = home
            .map(|h| h.join(".port-daddy/daemon.port"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| s.trim().parse::<u16>().ok())
        {
            return Ok(Self::new(format!("http://127.0.0.1:{port}")));
        }
        Ok(Self::new(crate::berths::stable_url()))
    }

    /// Construct a client against an already-resolved base URL (e.g. the value
    /// `discover().base()` returned, handed to a background refresh thread).
    ///
    /// Timeouts are load-bearing: the producer thread awaits ~26 pane
    /// refreshes SERIALLY per 2s cycle, and `update_panes` (which dismisses
    /// the launch splash) only fires after a full cycle. With reqwest's
    /// default (no timeout), a single blackholed endpoint wedged the console
    /// on "connecting…" forever. Bounded here, a hung endpoint costs one
    /// pane's refresh ("daemon unreachable: … timed out"), never the console.
    /// The Lane's SSE stream shares this client — `subscribe_agent` overrides
    /// the total deadline per-request, so only connect_timeout governs it.
    pub fn new(base: String) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(3))
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client with static config cannot fail to build"),
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// Submit the console's one work-creation command. The console supplies
    /// intent, constraints, and provenance only; it cannot name a backend,
    /// provider, model, body, node, or run. The daemon binds berth authority,
    /// writes WorkIntent + initial WorkPlan atomically, and returns a durable
    /// receipt. A single timeout retry reuses the exact same idempotency key.
    pub async fn capture_work_intent(&self, goal: &str) -> Result<WorkIntentReceipt> {
        let goal = goal.trim();
        if goal.is_empty() {
            return Err(anyhow!("WorkIntent needs a non-empty goal"));
        }
        let token = work_token();
        let issued_at = now_iso8601();
        let workdir = std::env::var("PD_CONSOLE_WORKDIR")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let body = build_work_intent_envelope(goal, &token, &issued_at, workdir.as_deref());

        let mut response = None;
        for attempt in 0..2 {
            match self
                .http
                .post(format!("{}/agent-harbor/surface-gateway", self.base))
                .json(&body)
                .send()
                .await
            {
                Ok(value) => {
                    response = Some(value);
                    break;
                }
                Err(error) if attempt == 0 && error.is_timeout() => continue,
                Err(error) => return Err(error).context("POST Surface Gateway WorkIntent"),
            }
        }
        let response =
            response.ok_or_else(|| anyhow!("Surface Gateway request produced no response"))?;
        let response = ensure_success(response, "capture_work_intent").await?;
        let value: serde_json::Value = response
            .json()
            .await
            .context("Surface Gateway WorkIntent receipt")?;
        let snapshot = work_snapshot(&value)?;
        Ok(WorkIntentReceipt {
            status: value
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            duplicate: value
                .get("duplicate")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            correlation_id: value
                .get("correlationId")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown-correlation")
                .to_string(),
            next_action: value
                .get("nextAction")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Inspect the daemon-owned WorkPlan before continuing.")
                .to_string(),
            snapshot,
        })
    }

    /// Start one already-durable WorkIntent through the daemon's governed
    /// runtime. The GUI still chooses no provider, model, body, node, or legacy
    /// launch verb. A timeout retry reuses the same WorkIntent command key, so
    /// an unknown caller state cannot create a second execution projection.
    pub async fn start_work_intent(&self, snapshot: &WorkSnapshot) -> Result<WorkExecutionReceipt> {
        let token = work_token();
        let body = build_work_intent_start_envelope(snapshot, &token, &now_iso8601());
        let mut response = None;
        for attempt in 0..2 {
            match self
                .http
                .post(format!("{}/agent-harbor/surface-gateway", self.base))
                .json(&body)
                .send()
                .await
            {
                Ok(value) => {
                    response = Some(value);
                    break;
                }
                Err(error) if attempt == 0 && error.is_timeout() => continue,
                Err(error) => return Err(error).context("POST Surface Gateway WorkIntent start"),
            }
        }
        let response =
            response.ok_or_else(|| anyhow!("Surface Gateway start produced no response"))?;
        let response = ensure_success(response, "start_work_intent").await?;
        let value: serde_json::Value = response
            .json()
            .await
            .context("Surface Gateway WorkIntent start receipt")?;
        let execution = value
            .get("execution")
            .filter(|candidate| candidate.is_object())
            .ok_or_else(|| anyhow!("Surface Gateway start receipt omitted execution truth"))?;
        let snapshot = work_snapshot(&value)?;
        Ok(WorkExecutionReceipt {
            status: value
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            duplicate: value
                .get("duplicate")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            correlation_id: value
                .get("correlationId")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown-correlation")
                .to_string(),
            projection: execution
                .get("projection")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            dispatch_id: execution
                .get("dispatchId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("Surface Gateway start receipt omitted execution id"))?
                .to_string(),
            state: execution
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            session_id: execution
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            worktree_path: execution
                .get("worktreePath")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            launched_this_tick: execution
                .get("launchedThisTick")
                .and_then(|v| v.as_u64())
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0),
            next_action: value
                .get("nextAction")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Inspect the active-agent roster and transcript stream.")
                .to_string(),
            snapshot,
        })
    }

    /// Rehydrate recent WorkIntent/WorkPlan truth after a console restart. This
    /// is a Surface Gateway query, not reconstruction from frontend state.
    pub async fn list_work_intents(&self, limit: usize) -> Result<Vec<WorkSnapshot>> {
        let token = work_token();
        let body = serde_json::json!({
            "schema": "pd.agent-harbor.surface-gateway.v0",
            "envelopeId": format!("surface_gateway_console_query_{token}"),
            "correlationId": format!("corr_console_query_{token}"),
            "surface": "pd-console",
            "direction": "surface-to-daemon",
            "mode": "query",
            "noun": "WorkIntent",
            "operation": "work-intent.list",
            "issuedBy": "pd-console:operator:local",
            "issuedAt": now_iso8601(),
            "idempotencyKey": null,
            "payload": { "limit": limit.clamp(1, 100) }
        });
        let response = self
            .http
            .post(format!("{}/agent-harbor/surface-gateway", self.base))
            .json(&body)
            .send()
            .await
            .context("POST Surface Gateway WorkIntent query")?;
        let response = ensure_success(response, "list_work_intents").await?;
        let value: serde_json::Value = response
            .json()
            .await
            .context("Surface Gateway WorkIntent query result")?;
        value
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("Surface Gateway WorkIntent query omitted data"))?
            .iter()
            .map(work_snapshot)
            .collect()
    }

    /// Expose the underlying reqwest client so panes can issue arbitrary requests
    /// to the daemon without re-implementing discovery.
    pub fn http_client(&self) -> &reqwest::Client {
        &self.http
    }

    /// Post a turn up the tube.
    pub async fn tube_send(&self, channel: &str, text: &str, sender: &str) -> Result<()> {
        let body = serde_json::json!({ "payload": { "text": text }, "sender": sender });
        let resp = self
            .http
            .post(format!("{}/msg/{channel}", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /msg/<channel>")?;
        // A non-2xx (invalid channel, guard rejection, rate limit) must not be
        // reported to the operator as a delivered message.
        ensure_success(resp, "tube_send").await?;
        Ok(())
    }

    /// Broadcast one Harbor Editor **presence** frame (slice 2) up a file's tube
    /// channel. Same wire as [`tube_send`](Self::tube_send) — presence rides the
    /// SAME per-file channel as the op stream — but stamped with a distinct
    /// `sender` so a receiver's own-echo filter and any log reader can tell the
    /// lossy cursor lane apart from operator/agent chatter. `frame_text` is what
    /// [`crate::editor_pane::EditorPane::take_presence_broadcast`] returns.
    pub async fn send_presence(&self, channel: &str, frame_text: &str) -> Result<()> {
        self.tube_send(channel, frame_text, "presence").await
    }

    // ── Harbor Editor P2 slice 3: durability + channel isolation ──────────────

    /// Store a doc **snapshot** in the daemon's content-addressed `/blob` store and
    /// return its content address (`sha256(body)` hex). REUSES routes/blob.ts as-is:
    /// `POST /blob` with the raw bytes takes the body, hashes it server-side, and
    /// returns `{ blob: { id, size, ... } }` — so the returned `id` IS the content
    /// address (no client-side crypto dep). `bytes` is [`crate::buffer::HarborBuffer::export_snapshot`].
    /// The id then rides an [`crate::editor_sync::encode_snapshot_frame`] up the edit
    /// lane so a behind peer can fetch it.
    pub async fn put_blob(&self, bytes: Vec<u8>) -> Result<String> {
        let resp = self
            .http
            .post(format!("{}/blob", self.base))
            // A non-JSON content-type routes to blob.ts's wildcard raw-body parser,
            // which preserves the exact bytes (a JSON content-type would re-encode).
            .header("content-type", "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .context("POST /blob")?;
        let resp = ensure_success(resp, "put_blob").await?;
        let v: serde_json::Value = resp.json().await.context("blob put response")?;
        parse_blob_id(&v).ok_or_else(|| anyhow!("POST /blob returned no blob id: {v}"))
    }

    /// Fetch a snapshot blob back by its content address (`GET /blob/:id`). Returns
    /// the raw bytes for [`crate::buffer::HarborBuffer::apply_remote_ops`] to import.
    /// A 404 (blob evicted) surfaces as an error rather than empty bytes.
    pub async fn get_blob(&self, id: &str) -> Result<Vec<u8>> {
        let resp = self
            .http
            .get(format!("{}/blob/{id}", self.base))
            .send()
            .await
            .context("GET /blob/:id")?;
        let resp = ensure_success(resp, "get_blob").await?;
        let bytes = resp.bytes().await.context("blob body")?;
        Ok(bytes.to_vec())
    }

    /// Broadcast a snapshot **reference** frame up a file's EDIT-lane channel
    /// ([`crate::editor_sync::channel_for_path`]). Same wire as [`tube_send`](Self::tube_send),
    /// stamped `sender = "snapshot"` so a log reader can tell the durability lane
    /// apart. `frame_text` is [`crate::editor_sync::encode_snapshot_frame`].
    pub async fn broadcast_snapshot_ref(&self, channel: &str, frame_text: &str) -> Result<()> {
        self.tube_send(channel, frame_text, "snapshot").await
    }

    /// Append one op-log delta to the durable, immutable op-log via `POST /notes`
    /// (REUSING [`add_note`](Self::add_note) — notes are write-once, exactly what a
    /// replayable audit log needs). `note_content` is
    /// [`crate::editor_sync::encode_oplog_note`]. Isolation note: this is a `/notes`
    /// write, wholly off BOTH tube lanes — the durable log never competes with live
    /// doc-ops or coordination for tube bandwidth.
    pub async fn log_oplog_delta(&self, note_content: &str) -> Result<()> {
        self.add_note(note_content).await
    }

    /// Send a coordination-control-plane signal (claim acquire/release, conflict
    /// predicted) up a file's **coordination** channel
    /// ([`crate::editor_sync::coordination_channel_for_path`]) — a SEPARATE tube
    /// channel from the edit lane, so a keystroke burst on the edit channel cannot
    /// starve this latency-sensitive lane (the ref-03 §3 isolation contract; proven
    /// structurally by `editor_sync::LaneQueues`). `frame_text` is
    /// [`crate::editor_sync::encode_coord_frame`]; stamped `sender = "coord"`.
    pub async fn send_coord_signal(&self, coord_channel: &str, frame_text: &str) -> Result<()> {
        self.tube_send(coord_channel, frame_text, "coord").await
    }

    /// Broadcast a **region-claim awareness** frame (P3 slice 1) up a file's
    /// **coordination** channel — the live presence-as-claims lane. `frame_text` is
    /// [`crate::editor_claims::encode_claim_frame`] (a Loro awareness blob). Rides the
    /// SAME isolated coordination channel as [`send_coord_signal`](Self::send_coord_signal)
    /// (never the edit lane), stamped `sender = "claim"` so a poller can tell claim
    /// awareness from a coord signal without decoding. This is the LIVE view; the
    /// DURABLE twin is [`claim_region`](Self::claim_region).
    pub async fn broadcast_claim(&self, coord_channel: &str, frame_text: &str) -> Result<()> {
        self.tube_send(coord_channel, frame_text, "claim").await
    }

    /// Mirror an editor's local SELECTION into the durable claims table — the
    /// stronger, persistent "I am working here" signal that outlives the ephemeral
    /// cursor lane. This REUSES the exact endpoint `pd session files add` /
    /// `POST /sessions/:id/files` drives (a region reservation), rather than
    /// inventing a parallel presence store: the claim shows up in `/files`, the
    /// claims pane, and conflict prediction like any other region claim.
    ///
    /// `start_line`/`end_line` are 1-based inclusive (the route's `startLine`/
    /// `endLine` contract). `agent_id` attributes the claim to the acting replica's
    /// PD identity. A 4xx/5xx (unknown session, conflict without force) surfaces as
    /// an error rather than a silent no-op.
    pub async fn claim_region(
        &self,
        session_id: &str,
        path: &str,
        start_line: u32,
        end_line: u32,
        agent_id: &str,
    ) -> Result<()> {
        let body = region_claim_body(path, start_line, end_line, agent_id);
        let resp = self
            .http
            .post(format!("{}/sessions/{session_id}/files", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /sessions/:id/files")?;
        ensure_success(resp, "claim_region").await?;
        Ok(())
    }

    /// Predict conflicts between two claim sets — the Harbor Editor P3 **wedge**
    /// (conflict prediction *before a byte is written*). REUSES the daemon's existing
    /// `POST /conflicts/predict` (routes/symbols.ts) and its claim-type matrix rather
    /// than re-deriving conflict logic in Rust: `body` is
    /// [`crate::editor_wedge::predict_request_body`] (`{ claimsA, claimsB }`), and the
    /// caller folds the JSON back through [`crate::editor_wedge::parse_predict_response`]
    /// into a `ConflictReport`. Returns the raw response Value so the tolerant parser
    /// owns both the full-tally and empty-early-return shapes. A 4xx/5xx surfaces as an
    /// error (the parser then reads it as quiet — the render band fails open; the
    /// durable commit gate is the fail-closed seam).
    pub async fn predict_conflicts(&self, body: &serde_json::Value) -> Result<serde_json::Value> {
        let resp = self
            .http
            .post(format!("{}/conflicts/predict", self.base))
            .json(body)
            .send()
            .await
            .context("POST /conflicts/predict")?;
        let resp = ensure_success(resp, "predict_conflicts").await?;
        let v: serde_json::Value = resp.json().await.context("conflicts/predict response")?;
        Ok(v)
    }

    /// Pull replies after `cursor`. Returns (new_cursor, messages).
    pub async fn tube_poll(&self, channel: &str, cursor: u64) -> Result<(u64, Vec<TubeMsg>)> {
        let resp = self
            .http
            .get(format!("{}/msg/{channel}", self.base))
            .query(&[("after", cursor.to_string())])
            .send()
            .await
            .context("GET /msg/<channel>")?;
        // Without this, a 4xx/5xx error body deserializes into a Value with no
        // `messages` key and silently looks like "no new messages".
        let resp = ensure_success(resp, "tube_poll").await?;
        let v: serde_json::Value = resp.json().await?;
        let mut out = Vec::new();
        let mut max = cursor;
        if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
            for m in arr {
                let id = m.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
                max = max.max(id);
                out.push(TubeMsg {
                    id,
                    sender: m
                        .get("sender")
                        .and_then(|s| s.as_str())
                        .unwrap_or("?")
                        .to_string(),
                    text: extract_text(m.get("payload")),
                });
            }
        }
        Ok((max, out))
    }

    // ── Console-facing MUTATION verbs (the cockpit, not just polling) ─────────

    /// Interrupt a running agent: `POST /agents/:id/interrupt` with an optional
    /// reason. The daemon publishes `{kind:'control.interrupt'}` on channel
    /// `agent:<id>`; that control message ALSO reappears on the live stream as an
    /// `agent.tube` event — the closed loop, so the operator sees their signal
    /// land. 404 if the agent is unknown (surfaced here as an error).
    pub async fn interrupt(&self, agent_id: &str, reason: Option<&str>) -> Result<()> {
        let body = match reason {
            Some(r) => serde_json::json!({ "reason": r }),
            None => serde_json::json!({}),
        };
        let resp = self
            .http
            .post(format!("{}/agents/{agent_id}/interrupt", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /agents/:id/interrupt")?;
        // A 404 (unknown agent) or guard rejection must surface as an error, not
        // be silently swallowed as a delivered interrupt.
        ensure_success(resp, "interrupt").await?;
        Ok(())
    }

    /// Operator review gate on a dispatch: `POST /dispatches/:id/{accept|reject|cancel}`.
    /// `accept` needs no body; `reject` REQUIRES a `reason` (>=3 chars, daemon-enforced);
    /// `cancel` takes an optional reason. The single seat where the operator vetoes/lands
    /// agent work (the supervisor-worker blocking gate).
    pub async fn dispatch_action(
        &self,
        id: &str,
        action: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let body = match reason {
            Some(r) => serde_json::json!({ "reason": r }),
            None => serde_json::json!({}),
        };
        let resp = self
            .http
            .post(format!("{}/dispatches/{id}/{action}", self.base))
            .json(&body)
            .send()
            .await
            .with_context(|| format!("POST /dispatches/{id}/{action}"))?;
        ensure_success(resp, "dispatch_action").await?;
        Ok(())
    }

    /// Conductor operator control (ADR-0060): `POST /fleet/{halt|pause|resume}`.
    /// `root_id` scopes to one lineage; `None` = the whole fleet (global stop).
    /// halt = SIGTERM->SIGKILL the scope + refund (never slash) bonds; pause =
    /// stop admitting new launches; resume = reopen a halted/paused scope.
    pub async fn fleet_action(&self, verb: &str, root_id: Option<&str>) -> Result<()> {
        let body = match root_id {
            Some(r) => serde_json::json!({ "rootId": r }),
            None => serde_json::json!({}),
        };
        let resp = self
            .http
            .post(format!("{}/fleet/{verb}", self.base))
            .json(&body)
            .send()
            .await
            .with_context(|| format!("POST /fleet/{verb}"))?;
        ensure_success(resp, "fleet_action").await?;
        Ok(())
    }

    /// Add an operator note: `POST /notes` with `{ content, agentId }`. The
    /// daemon's note write needs a session SCOPE — without one it returns
    /// `NO_ACTIVE_SESSION_SCOPE`. We pass a stable `agentId` (`console-operator`)
    /// so the daemon auto-creates/reuses a "Quick notes" session and the write
    /// always lands. The route's body field is `content` (NOT `text`). The note
    /// surfaces in the Notes/Memory pane (`GET /notes`) on the next refresh.
    pub async fn add_note(&self, content: &str) -> Result<()> {
        let body = serde_json::json!({ "content": content, "agentId": "console-operator" });
        let resp = self
            .http
            .post(format!("{}/notes", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /notes")?;
        ensure_success(resp, "add_note").await?;
        Ok(())
    }

    /// Convene an operator parley: `POST /parley/call`. `parties` are AGENT ids
    /// (`fleet_transcripts.spawned_agent_id` — never transcript/session ids;
    /// parley DMs each party via its agent inbox) and the daemon 400s below 2
    /// distinct ids, so callers gate the affordance client-side too. Returns the
    /// parsed body so the caller can surface `parley.parleyId` / `channel`; a
    /// non-2xx surfaces the daemon's rejection verbatim through
    /// [`ensure_success`] (the alert bus shows it, never a silent swallow).
    pub async fn call_parley(
        &self,
        surface: &str,
        reason: &str,
        called_by: &str,
        parties: &[String],
    ) -> Result<serde_json::Value> {
        let body = serde_json::json!({
            "surface": surface,
            "reason": reason,
            "calledBy": called_by,
            "parties": parties,
            "trigger": "operator",
        });
        let resp = self
            .http
            .post(format!("{}/parley/call", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /parley/call")?;
        let resp = ensure_success(resp, "parley call").await?;
        let v: serde_json::Value = resp.json().await.context("parley call response")?;
        Ok(v)
    }

    /// Begin a coordination session: `POST /sugar/begin`. The daemon REQUIRES a
    /// non-empty `purpose` and an explicit `lifecycle` (`durable`|`ephemeral`) —
    /// omit either and it 400s. We default `lifecycle` to `durable` (ordinary
    /// work context, matching `pd begin`'s interactive default) and reuse the
    /// operator-supplied identity as the purpose when no distinct purpose is
    /// given. `allowMainWorktree` is set so a console launched outside a linked
    /// worktree is not bounced by the worktree gate. Sessions pane reads
    /// `/sessions`, so the new session appears on the next refresh.
    pub async fn begin_session(&self, identity: &str, purpose: Option<&str>) -> Result<()> {
        let purpose = purpose.filter(|p| !p.trim().is_empty()).unwrap_or(identity);
        let mut body = serde_json::json!({
            "purpose": purpose,
            "lifecycle": "durable",
            "allowMainWorktree": true,
        });
        if !identity.trim().is_empty() {
            body["identity"] = serde_json::json!(identity);
        }
        let resp = self
            .http
            .post(format!("{}/sugar/begin", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /sugar/begin")?;
        ensure_success(resp, "begin_session").await?;
        Ok(())
    }

    /// End the active coordination session: `POST /sugar/done`. The optional
    /// `summary` becomes the session's closing `note`. The daemon resolves the
    /// active session from worktree/agent scope when no id is passed; a 404
    /// (`NO_ACTIVE_SESSION`) surfaces here as an error rather than a silent
    /// no-op. Status defaults daemon-side to `completed`.
    pub async fn end_session(&self, summary: Option<&str>) -> Result<()> {
        let body = match summary.filter(|s| !s.trim().is_empty()) {
            Some(s) => serde_json::json!({ "note": s }),
            None => serde_json::json!({}),
        };
        let resp = self
            .http
            .post(format!("{}/sugar/done", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /sugar/done")?;
        ensure_success(resp, "end_session").await?;
        Ok(())
    }

    /// Claim a port: `POST /claim` with `{ id }` where `id` is the semantic
    /// identity (`project:stack:context`). Port Daddy's core verb — same identity
    /// always maps to the same port (deterministic hashing). The route's body
    /// field is `id` (NOT `identity`). Returns the assigned port so the operator
    /// sees what they got. Services/Claims surfaces reflect it on next refresh.
    pub async fn claim_port(&self, identity: &str) -> Result<u16> {
        let identity = identity.trim();
        if identity.is_empty() {
            return Err(anyhow!("claim_port needs a non-empty identity"));
        }
        let body = serde_json::json!({ "id": identity });
        let resp = self
            .http
            .post(format!("{}/claim", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /claim")?;
        let resp = ensure_success(resp, "claim_port").await?;
        let v: serde_json::Value = resp.json().await.context("claim response")?;
        let port = v
            .get("port")
            .and_then(|p| p.as_u64())
            .ok_or_else(|| anyhow!("claim succeeded but response carried no port: {v}"))?;
        u16::try_from(port).with_context(|| {
            format!("claim succeeded but daemon returned out-of-range port: {port}")
        })
    }

    /// Release a claimed port: `DELETE /release` with `{ id }` (the identity).
    /// The release route keys on the service identity, not the port number — so
    /// the operator passes the identity they claimed. A `SERVICE_NOT_FOUND`
    /// (unknown identity) surfaces as an error.
    pub async fn release_port(&self, identity: &str) -> Result<()> {
        let body = serde_json::json!({ "id": identity });
        let resp = self
            .http
            .delete(format!("{}/release", self.base))
            .json(&body)
            .send()
            .await
            .context("DELETE /release")?;
        ensure_success(resp, "release_port").await?;
        Ok(())
    }

    /// Kill (unregister) an agent: `DELETE /agents/:id`. Removes the agent from
    /// the fleet roster and publishes an `unregistered` event. A 400 (unknown
    /// agent / already gone) surfaces as an error rather than a silent no-op.
    /// Fleet/Cockpit panes read `/agents`, so the roster updates on next refresh.
    pub async fn kill_agent(&self, agent_id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!("{}/agents/{agent_id}", self.base))
            .send()
            .await
            .context("DELETE /agents/:id")?;
        ensure_success(resp, "kill_agent").await?;
        Ok(())
    }

    /// Open the live SSE feed `GET /agents/:id/stream` and yield parsed
    /// `StreamEnvelope`s on an mpsc channel. Spawns a tokio task that owns the
    /// HTTP body stream; it runs until the daemon closes the stream, the agent
    /// ends, or every receiver is dropped. Returns the receiver immediately so
    /// the GPUI foreground-drain loop can poll it the same way it drains pane
    /// updates. Designed to be reconnected by the caller if the task ends.
    pub fn subscribe_agent(&self, agent_id: &str) -> tokio::sync::mpsc::Receiver<StreamEnvelope> {
        // A modest buffer: the UI drains every 500ms; bound memory if the agent
        // is chatty and the consumer briefly stalls.
        let (tx, rx) = tokio::sync::mpsc::channel::<StreamEnvelope>(256);
        let url = format!("{}/agents/{agent_id}/stream", self.base);
        let http = self.http.clone();
        tokio::spawn(async move {
            use futures_util::StreamExt;
            use tokio::time::{sleep, Duration};
            // Resumable, self-healing stream. A transient network blip or a daemon
            // restart used to silently kill the lane (the task just returned and
            // nothing re-opened it unless the WATCH TARGET changed). Now we
            // reconnect with capped exponential backoff and resume from the last
            // event id via `Last-Event-ID`, so the live surface survives drops
            // instead of going dark mid-run.
            let mut last_id: Option<String> = None;
            let mut backoff = Duration::from_millis(500);
            const MAX_BACKOFF: Duration = Duration::from_secs(10);
            loop {
                // Long-lived SSE: override the client's 15s total-request
                // deadline (which exists to keep pane refreshes from wedging
                // the console) — only connect_timeout should govern a stream.
                let mut req = http.get(&url).timeout(Duration::from_secs(60 * 60 * 24));
                if let Some(id) = &last_id {
                    req = req.header("Last-Event-ID", id.as_str());
                }
                let resp = match req.send().await {
                    Ok(r) if r.status().is_success() => r,
                    // A 429 (rate-limit Retry-After) or 5xx (daemon restarting) is
                    // TRANSIENT — back off and retry so a momentary hiccup can't
                    // kill the live lane forever.
                    Ok(r) if sse_status_is_retryable(r.status()) => {
                        sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                        continue;
                    }
                    // Any other 4xx (404 = unknown agent) is permanent: nothing will
                    // ever stream, so stop (don't spin against a permanent error).
                    Ok(_) => return,
                    Err(_) => {
                        // Connection failure — back off and retry (daemon may be
                        // restarting, e.g. a freshness self-heal).
                        sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                        continue;
                    }
                };
                backoff = Duration::from_millis(500); // reset on a healthy connect
                let mut parser = SseParser::new();
                let mut body = resp.bytes_stream();
                while let Some(chunk) = body.next().await {
                    let bytes = match chunk {
                        Ok(b) => b,
                        Err(_) => break, // stream error — fall through to reconnect
                    };
                    // SSE is UTF-8; tolerate a split multibyte char across chunks by
                    // lossy-decoding (rare, and a single glyph is not worth dropping
                    // the whole feed for).
                    let text = String::from_utf8_lossy(&bytes);
                    for data in parser.feed(&text) {
                        // Track the resume point as each event is processed.
                        if let Some(id) = parser.last_id() {
                            last_id = Some(id.to_string());
                        }
                        let val: serde_json::Value = match serde_json::from_str(&data) {
                            Ok(v) => v,
                            Err(_) => continue, // skip a malformed frame, keep streaming
                        };
                        if let Some(env) = StreamEnvelope::from_value(&val) {
                            // Receiver dropped (pane closed / retargeted) → stop.
                            if tx.send(env).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                // Stream ended without the receiver being dropped (EOF or error):
                // reconnect with backoff, resuming from `last_id`.
                sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        });
        rx
    }

    /// Open the live SSE feed for a pub/sub tube channel
    /// (`GET /msg/:channel/subscribe`) and yield each published [`TubeMsg`] on an
    /// mpsc channel. This is the Harbor Editor's LAN-multiplayer receive path (P2
    /// slice 1): the per-file channel is [`crate::editor_sync::channel_for_path`],
    /// and each `TubeMsg::text` is a Loro op frame the caller folds into a buffer
    /// via [`crate::editor_sync::decode_frame`] + `apply_frame`.
    ///
    /// Structurally identical to [`subscribe_agent`](Self::subscribe_agent) — same
    /// resumable, self-healing loop (capped backoff + `Last-Event-ID` resume), same
    /// `SseParser`, same "receiver dropped → stop" contract — differing only in the
    /// URL and that it parses the messaging frame shape (`TubeMsg::from_value`)
    /// instead of the agent envelope. The frames are handed over a
    /// `tokio::sync::mpsc` channel (NOT a shared `Arc<Mutex<_>>`): the background
    /// task owns the HTTP body, the render loop drains via `try_recv` — the one
    /// safe hand-off across the SSE→render seam.
    pub fn subscribe_channel(&self, channel: &str) -> tokio::sync::mpsc::Receiver<TubeMsg> {
        let (tx, rx) = tokio::sync::mpsc::channel::<TubeMsg>(256);
        let url = format!("{}/msg/{channel}/subscribe", self.base);
        let http = self.http.clone();
        tokio::spawn(async move {
            use futures_util::StreamExt;
            use tokio::time::{sleep, Duration};
            let mut last_id: Option<String> = None;
            let mut backoff = Duration::from_millis(500);
            const MAX_BACKOFF: Duration = Duration::from_secs(10);
            loop {
                let mut req = http.get(&url);
                if let Some(id) = &last_id {
                    req = req.header("Last-Event-ID", id.as_str());
                }
                let resp = match req.send().await {
                    Ok(r) if r.status().is_success() => r,
                    // A 429 (connection-limit Retry-After) or 5xx (daemon restarting)
                    // is TRANSIENT — back off and retry so a momentary rate-limit or
                    // server hiccup can't kill the editor lane forever.
                    Ok(r) if sse_status_is_retryable(r.status()) => {
                        sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                        continue;
                    }
                    // Any other 4xx (invalid channel) is permanent: nothing will
                    // ever stream, so stop rather than spin against it.
                    Ok(_) => return,
                    Err(_) => {
                        sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                        continue;
                    }
                };
                backoff = Duration::from_millis(500); // reset on a healthy connect
                let mut parser = SseParser::new();
                let mut body = resp.bytes_stream();
                while let Some(chunk) = body.next().await {
                    let bytes = match chunk {
                        Ok(b) => b,
                        Err(_) => break, // stream error — fall through to reconnect
                    };
                    let text = String::from_utf8_lossy(&bytes);
                    for data in parser.feed(&text) {
                        if let Some(id) = parser.last_id() {
                            last_id = Some(id.to_string());
                        }
                        let val: serde_json::Value = match serde_json::from_str(&data) {
                            Ok(v) => v,
                            Err(_) => continue, // skip a malformed frame, keep streaming
                        };
                        if let Some(msg) = TubeMsg::from_value(&val) {
                            if tx.send(msg).await.is_err() {
                                return; // receiver dropped (pane closed/retargeted)
                            }
                        }
                    }
                }
                // EOF/error without the receiver dropping: reconnect with backoff.
                sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        });
        rx
    }
}

/// Pull readable text from a stream-envelope `body` (or any payload value):
/// a bare string, `{text:...}`, or `{content:...}`. Public so surfaces can fold
/// `agent.tube` frames into a line without re-implementing the shape walk.
pub fn body_text(body: &serde_json::Value) -> String {
    extract_text(Some(body))
}

/// Build the `POST /sessions/:id/files` body that mirrors an editor selection into
/// a durable region claim. Kept as a pure function so the shape is a checked
/// contract (in `region_claim_body_matches_the_sessions_files_region_schema`)
/// against the route's `regions: [{ path, startLine, endLine }]` schema (1-based
/// inclusive lines) without needing a live daemon. `agentId` attributes the claim
/// to the acting replica.
///
/// `allow(dead_code)`: its caller [`DaemonClient::claim_region`] is a `pub` method
/// (exempt from the lint) that is not yet invoked from `main.rs` — the same
/// not-yet-live status the slice-1 receive path had. The test exercises it.
#[allow(dead_code)]
fn region_claim_body(
    path: &str,
    start_line: u32,
    end_line: u32,
    agent_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "regions": [{
            "path": path,
            "startLine": start_line,
            "endLine": end_line,
        }],
        "agentId": agent_id,
    })
}

/// Pull the content-addressed blob id out of a `POST /blob` response
/// (`{ success, blob: { id, size, ... } }`, per routes/blob.ts). Kept pure so the
/// response shape is a checked contract (see `parse_blob_id_reads_the_blob_stat_id`)
/// without a live daemon. Tolerates a bare `{ id }` too, but never invents an id.
///
/// `allow(dead_code)`: its caller [`DaemonClient::put_blob`] is a `pub` method
/// (exempt from the lint) that is not yet invoked from `main.rs` — the same
/// not-yet-live status the slice-1 receive path had. The test exercises it.
#[allow(dead_code)]
fn parse_blob_id(v: &serde_json::Value) -> Option<String> {
    v.get("blob")
        .and_then(|b| b.get("id"))
        .or_else(|| v.get("id"))
        .and_then(|id| id.as_str())
        .map(String::from)
}

/// A payload may be a string, `{text:...}`, or `{content:...}` — pull readable text.
fn extract_text(payload: Option<&serde_json::Value>) -> String {
    match payload {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Object(o)) => o
            .get("text")
            .or_else(|| o.get("content"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .unwrap_or_else(|| serde_json::Value::Object(o.clone()).to_string()),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_intent_envelope_has_one_creation_authority() {
        let body = build_work_intent_envelope(
            "Repair the broken receipt path",
            "fixed-token",
            "2026-07-12T00:00:00Z",
            Some("/worktrees/receipt-repair"),
        );
        let payload = body.get("payload").expect("WorkIntent payload");

        assert_eq!(
            body.get("noun").and_then(|v| v.as_str()),
            Some("WorkIntent")
        );
        assert_eq!(
            body.get("operation").and_then(|v| v.as_str()),
            Some("work-intent.capture")
        );
        assert_eq!(
            payload.pointer("/source/kind").and_then(|v| v.as_str()),
            Some("console")
        );
        assert_eq!(
            payload.pointer("/source/worktree").and_then(|v| v.as_str()),
            Some("/worktrees/receipt-repair")
        );
        assert_eq!(
            payload
                .pointer("/constraints/maxCostUsd")
                .and_then(|v| v.as_f64()),
            Some(10.0)
        );
        assert_eq!(
            payload.get("startPolicy").and_then(|v| v.as_str()),
            Some("queued")
        );
        assert_eq!(body.get("idempotencyKey"), payload.get("idempotencyKey"));

        let wire = serde_json::to_string(&body).expect("serialize WorkIntent");
        for forbidden in [
            "backend",
            "provider",
            "model",
            "bodyPreference",
            "legacyVerb",
        ] {
            assert!(
                !wire.contains(&format!("\"{forbidden}\"")),
                "pd-console must not author {forbidden}: {wire}"
            );
        }
        assert!(
            !payload
                .as_object()
                .expect("payload object")
                .contains_key("body"),
            "pd-console must not author a Body"
        );
    }

    #[test]
    fn work_intent_envelope_omits_unknown_worktree_instead_of_sending_null() {
        let body = build_work_intent_envelope(
            "Audit the roadmap",
            "no-worktree-token",
            "2026-07-13T00:00:00Z",
            None,
        );
        let source = body
            .pointer("/payload/source")
            .and_then(serde_json::Value::as_object)
            .expect("WorkIntent source");

        assert!(!source.contains_key("worktree"), "source={source:?}");
        assert!(!body
            .pointer("/payload/constraints")
            .and_then(serde_json::Value::as_object)
            .expect("WorkIntent constraints")
            .contains_key("workdir"));
    }

    #[test]
    fn work_intent_start_envelope_reuses_durable_noun_without_provider_authority() {
        let snapshot = WorkSnapshot {
            intent: build_work_intent_envelope(
                "Take the next roadmap slice",
                "capture-token",
                "2026-07-12T00:00:00Z",
                Some("/worktrees/roadmap-slice"),
            )["payload"]
                .clone(),
            plan: None,
        };
        let body =
            build_work_intent_start_envelope(&snapshot, "start-token", "2026-07-12T00:00:05Z");

        assert_eq!(body["noun"], "WorkIntent");
        assert_eq!(body["operation"], "work-intent.start");
        assert_eq!(
            body["idempotencyKey"],
            format!("pd-console:start:{}", snapshot.intent_id())
        );
        assert_eq!(body["payload"], snapshot.intent);
        let wire = serde_json::to_string(&body).expect("serialize WorkIntent start");
        for forbidden in [
            "backend",
            "provider",
            "model",
            "bodyPreference",
            "legacyVerb",
        ] {
            assert!(!wire.contains(&format!("\"{forbidden}\"")), "{wire}");
        }
    }

    #[test]
    fn extract_text_handles_shapes() {
        assert_eq!(extract_text(Some(&serde_json::json!("hi"))), "hi");
        assert_eq!(
            extract_text(Some(&serde_json::json!({ "text": "yo" }))),
            "yo"
        );
        assert_eq!(
            extract_text(Some(&serde_json::json!({ "content": "c" }))),
            "c"
        );
        assert_eq!(extract_text(None), "");
    }

    // ── Stream envelope parsing ───────────────────────────────────────────────

    #[test]
    fn stream_kind_round_trips_and_falls_back() {
        assert_eq!(StreamKind::parse("agent.status"), StreamKind::Status);
        assert_eq!(StreamKind::parse("agent.tube"), StreamKind::Tube);
        assert_eq!(
            StreamKind::parse("agent.transcript"),
            StreamKind::Transcript
        );
        assert_eq!(StreamKind::Status.as_str(), "agent.status");
        // Unknown kinds are preserved, never dropped.
        match StreamKind::parse("agent.future") {
            StreamKind::Other(s) => assert_eq!(s, "agent.future"),
            other => panic!("expected Other, got {other:?}"),
        }
        assert_eq!(StreamKind::parse("agent.future").as_str(), "agent.future");
    }

    #[test]
    fn envelope_parses_typed_frame() {
        let v = serde_json::json!({
            "v": 1,
            "kind": "agent.transcript",
            "agentId": "agent-xyz",
            "body": { "text": "compiling…" },
            "ts": 1781561557841i64,
        });
        let env = StreamEnvelope::from_value(&v).expect("typed frame parses");
        assert_eq!(env.v, 1);
        assert_eq!(env.kind, StreamKind::Transcript);
        assert_eq!(env.agent_id, "agent-xyz");
        assert_eq!(env.ts, 1781561557841);
        assert_eq!(
            env.body.get("text").and_then(|t| t.as_str()),
            Some("compiling…")
        );
    }

    #[test]
    fn envelope_skips_connected_handshake_and_garbage() {
        // The first `connected` frame has no `kind` → None (caller skips it).
        assert!(StreamEnvelope::from_value(&serde_json::json!({ "channel": "agent:x" })).is_none());
        // Tolerate missing optional fields rather than failing.
        let env = StreamEnvelope::from_value(&serde_json::json!({ "kind": "agent.status" }))
            .expect("kind-only frame still parses");
        assert_eq!(env.v, 1); // defaulted
        assert_eq!(env.ts, 0); // defaulted
        assert!(env.agent_id.is_empty());
    }

    // ── SSE byte-stream parser ────────────────────────────────────────────────

    #[test]
    fn sse_parser_assembles_single_frame() {
        let mut p = SseParser::new();
        let out = p.feed("event: connected\ndata: {\"channel\":\"agent:x\"}\n\n");
        assert_eq!(out, vec!["{\"channel\":\"agent:x\"}"]);
    }

    #[test]
    fn sse_parser_handles_split_chunks() {
        // A frame arriving in two TCP chunks must still assemble exactly once.
        let mut p = SseParser::new();
        assert!(p.feed("data: {\"kind\":\"agent.").is_empty());
        let out = p.feed("status\"}\n\n");
        assert_eq!(out, vec!["{\"kind\":\"agent.status\"}"]);
    }

    #[test]
    fn sse_parser_ignores_heartbeats_and_handles_crlf() {
        let mut p = SseParser::new();
        // `:heartbeat` comment line + CRLF terminators must not emit a frame.
        let out = p.feed(":heartbeat\r\n\r\n");
        assert!(out.is_empty());
        let out = p.feed("data: {\"kind\":\"agent.tube\"}\r\n\r\n");
        assert_eq!(out, vec!["{\"kind\":\"agent.tube\"}"]);
    }

    #[test]
    fn sse_parser_multiline_data_concatenated() {
        let mut p = SseParser::new();
        let out = p.feed("data: line1\ndata: line2\n\n");
        assert_eq!(out, vec!["line1\nline2"]);
    }

    #[test]
    fn sse_parser_captures_sticky_last_event_id() {
        let mut p = SseParser::new();
        assert_eq!(p.last_id(), None);
        // An `id:` line sets the resume point; it is sticky across later events
        // until a new `id:` arrives (the SSE Last-Event-ID contract).
        p.feed("id: 42\ndata: {\"kind\":\"agent.transcript\"}\n\n");
        assert_eq!(p.last_id(), Some("42"));
        p.feed("data: {\"kind\":\"agent.transcript\"}\n\n");
        assert_eq!(
            p.last_id(),
            Some("42"),
            "id is sticky without a new id: line"
        );
        p.feed("id: 99\ndata: {\"kind\":\"agent.status\"}\n\n");
        assert_eq!(p.last_id(), Some("99"));
    }

    #[test]
    fn sse_end_to_end_chunk_to_envelope() {
        // The real pipeline: raw SSE bytes → data payloads → typed envelopes.
        let mut p = SseParser::new();
        let raw = "event: connected\ndata: {\"channel\":\"agent:a\"}\n\n\
                   event: message\ndata: {\"v\":1,\"kind\":\"agent.tube\",\"agentId\":\"a\",\"body\":{\"text\":\"control.interrupt\"},\"ts\":5}\n\n";
        let frames = p.feed(raw);
        let envs: Vec<_> = frames
            .iter()
            .filter_map(|d| serde_json::from_str::<serde_json::Value>(d).ok())
            .filter_map(|v| StreamEnvelope::from_value(&v))
            .collect();
        // The `connected` frame yields no envelope; the tube frame does.
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].kind, StreamKind::Tube);
        assert_eq!(
            envs[0].body.get("text").and_then(|t| t.as_str()),
            Some("control.interrupt")
        );
    }

    // ── Tube channel messages (GET /msg/:channel/subscribe) ───────────────────

    #[test]
    fn tube_msg_parses_messaging_frame_and_skips_handshake() {
        // The `event: connected` handshake carries no `payload` → skipped.
        assert!(
            TubeMsg::from_value(&serde_json::json!({ "channel": "harbor-editor:abc" })).is_none()
        );
        // A published message: a `tube_send` wraps its text as `{text:...}`; the
        // parser pulls the readable text and the sender through.
        let m = TubeMsg::from_value(&serde_json::json!({
            "id": 7,
            "channel": "harbor-editor:abc",
            "payload": { "text": "{\"v\":1,\"kind\":\"loro.update\"}" },
            "sender": "port-daddy:editor:agent-A",
            "createdAt": 1781561557841i64,
        }))
        .expect("a real message parses");
        assert_eq!(m.id, 7);
        assert_eq!(m.sender, "port-daddy:editor:agent-A");
        assert_eq!(m.text, "{\"v\":1,\"kind\":\"loro.update\"}");
        // A bare-string payload is also accepted (defaulted id/sender tolerated).
        let bare = TubeMsg::from_value(&serde_json::json!({ "payload": "hello" }))
            .expect("bare-string payload parses");
        assert_eq!(bare.text, "hello");
        assert_eq!(bare.id, 0);
        assert_eq!(bare.sender, "?");
    }

    /// The selection→claim mirror body matches the real `POST /sessions/:id/files`
    /// region schema (`regions: [{ path, startLine, endLine }]`, 1-based inclusive)
    /// so it reuses the durable claims table rather than a parallel presence store.
    #[test]
    fn region_claim_body_matches_the_sessions_files_region_schema() {
        let body = region_claim_body(
            "core/pd-console/src/editor_pane.rs",
            12,
            20,
            "port-daddy:editor:agent-A",
        );
        let regions = body
            .get("regions")
            .and_then(|r| r.as_array())
            .expect("regions array");
        assert_eq!(regions.len(), 1, "one region per selection mirror");
        let region = &regions[0];
        assert_eq!(
            region.get("path").and_then(|p| p.as_str()),
            Some("core/pd-console/src/editor_pane.rs")
        );
        // The route requires startLine >= 1 and endLine >= startLine.
        assert_eq!(region.get("startLine").and_then(|n| n.as_u64()), Some(12));
        assert_eq!(region.get("endLine").and_then(|n| n.as_u64()), Some(20));
        assert!(
            region.get("startLine").and_then(|n| n.as_u64()).unwrap() >= 1,
            "startLine is 1-based"
        );
        assert!(
            region.get("endLine").and_then(|n| n.as_u64()).unwrap()
                >= region.get("startLine").and_then(|n| n.as_u64()).unwrap(),
            "endLine >= startLine (the route's contract)"
        );
        // The claim is attributed to the acting replica's PD identity.
        assert_eq!(
            body.get("agentId").and_then(|a| a.as_str()),
            Some("port-daddy:editor:agent-A")
        );
    }

    /// `put_blob` reads the content address out of routes/blob.ts's response shape
    /// (`{ success, blob: { id, ... } }`) — the P2 slice-3 durability contract.
    #[test]
    fn parse_blob_id_reads_the_blob_stat_id() {
        let id = "e".repeat(64);
        let ok = serde_json::json!({ "success": true, "blob": { "id": id, "size": 128 } });
        assert_eq!(
            parse_blob_id(&ok).as_deref(),
            Some(id.as_str()),
            "reads blob.id (the sha256 content address)"
        );
        // A bare {id} is tolerated; a body with no id yields None (never invented).
        assert_eq!(
            parse_blob_id(&serde_json::json!({ "id": "abc" })).as_deref(),
            Some("abc")
        );
        assert_eq!(
            parse_blob_id(&serde_json::json!({ "success": false, "error": "boom" })),
            None
        );
        assert_eq!(
            parse_blob_id(&serde_json::json!({ "blob": { "size": 1 } })),
            None
        );
    }

    /// The SSE reconnect policy is a checked contract: a 429 (connection-limit
    /// Retry-After) and any 5xx (daemon restarting) are transient and MUST be
    /// retried so a blip can't kill the live lane forever; any other 4xx is
    /// permanent and MUST stop (retrying would spin). Guards the editor + agent
    /// receive lanes' recovery.
    #[test]
    fn sse_retry_policy_retries_429_and_5xx_but_stops_on_other_4xx() {
        use reqwest::StatusCode;
        // Transient → retry.
        assert!(
            sse_status_is_retryable(StatusCode::TOO_MANY_REQUESTS),
            "429 Retry-After is transient"
        );
        assert!(
            sse_status_is_retryable(StatusCode::INTERNAL_SERVER_ERROR),
            "500 is transient"
        );
        assert!(
            sse_status_is_retryable(StatusCode::BAD_GATEWAY),
            "502 (daemon restart) is transient"
        );
        assert!(
            sse_status_is_retryable(StatusCode::SERVICE_UNAVAILABLE),
            "503 is transient"
        );
        // Permanent → stop.
        assert!(
            !sse_status_is_retryable(StatusCode::BAD_REQUEST),
            "400 invalid channel is permanent"
        );
        assert!(
            !sse_status_is_retryable(StatusCode::FORBIDDEN),
            "403 is permanent"
        );
        assert!(
            !sse_status_is_retryable(StatusCode::NOT_FOUND),
            "404 unknown agent is permanent"
        );
    }
}
