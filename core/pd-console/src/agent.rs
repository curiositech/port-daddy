//! The conversation multiplexer — ON THE PD BUS, backend-agnostic (ADR-0046).
//!
//! "Why can't we create new top-level agents? I want to talk to you from inside
//! pd-console." This is the answer — and it does it the *Port Daddy* way, not by
//! shelling out to one vendor:
//!
//!   create_agent(backend, prompt)  → daemon `POST /spawn` on ANY backend
//!     (ollama | claude | claude-cli | gemini | cloudflare | codex | aider | custom),
//!     bound to a per-agent **tube** channel.
//!   send(text)   → `POST /msg/<channel>`   (a turn up the tube)
//!   poll()       → `GET  /msg/<channel>?after=<cursor>`  (replies down the tube)
//!
//! On-bus means: the agent is a real voyage (observable in the Ledger/manifest),
//! steerable, and any backend works — the console never re-implements a vendor.

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;

/// Every backend the daemon's spawner accepts (mirrors routes/spawn.ts VALID_BACKENDS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Ollama,
    Claude,
    ClaudeCli,
    Gemini,
    Cloudflare,
    Codex,
    Aider,
    Custom,
}

impl Backend {
    pub const ALL: [Backend; 8] = [
        Backend::Ollama,
        Backend::Claude,
        Backend::ClaudeCli,
        Backend::Gemini,
        Backend::Cloudflare,
        Backend::Codex,
        Backend::Aider,
        Backend::Custom,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Ollama => "ollama",
            Backend::Claude => "claude",
            Backend::ClaudeCli => "claude-cli",
            Backend::Gemini => "gemini",
            Backend::Cloudflare => "cloudflare",
            Backend::Codex => "codex",
            Backend::Aider => "aider",
            Backend::Custom => "custom",
        }
    }

    pub fn parse(s: &str) -> Option<Backend> {
        Backend::ALL.into_iter().find(|b| b.as_str() == s)
    }
}

/// One message off the tube.
#[derive(Debug, Clone)]
pub struct TubeMsg {
    pub id: u64,
    pub sender: String,
    pub text: String,
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
                self.data.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
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
/// `PORT_DADDY_URL`, else the TCP port the running daemon wrote to
/// `~/.port-daddy/daemon.port`. There is no hardcoded port fallback: the daemon
/// writes that file when it boots, so its absence means there is no daemon to
/// talk to — fail loudly with the fix rather than guess a port.
pub struct DaemonClient {
    base: String,
    http: reqwest::Client,
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

impl DaemonClient {
    pub fn discover() -> Result<Self> {
        let base = if let Ok(url) = std::env::var("PORT_DADDY_URL") {
            url.trim_end_matches('/').to_string()
        } else {
            let port = dirs::home_dir()
                .map(|h| h.join(".port-daddy/daemon.port"))
                .and_then(|p| std::fs::read_to_string(p).ok())
                .and_then(|s| s.trim().parse::<u16>().ok())
                .ok_or_else(|| {
                    anyhow!(
                        "cannot locate the Port Daddy daemon: set PORT_DADDY_URL, \
                         or start the daemon (it writes ~/.port-daddy/daemon.port)"
                    )
                })?;
            format!("http://127.0.0.1:{port}")
        };
        Ok(Self { base, http: reqwest::Client::new() })
    }

    /// Construct a client against an already-resolved base URL (e.g. the value
    /// `discover().base()` returned, handed to a background refresh thread).
    pub fn new(base: String) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), http: reqwest::Client::new() }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// Expose the underlying reqwest client so panes can issue arbitrary requests
    /// to the daemon without re-implementing discovery.
    pub fn http_client(&self) -> &reqwest::Client {
        &self.http
    }

    /// Create a top-level agent on `backend`, bound to `channel`. The daemon
    /// enforces real launch guards — a positive budget ceiling, a model for
    /// model-backends, and a worktree workdir (NOT a main checkout). We satisfy
    /// all three here so the command actually launches instead of bouncing off a
    /// precondition. `workdir` comes from `PD_CONSOLE_WORKDIR` (an isolated
    /// worktree); the daemon blocks main-checkout spawns by design.
    /// Returns the outcome incl. one-shot inline `output` (ollama et al. reply in
    /// the spawn response, not on the tube).
    pub async fn spawn(&self, backend: Backend, prompt: &str, channel: &str) -> Result<SpawnOutcome> {
        let mut body = serde_json::json!({
            "backend": backend.as_str(),
            "task": prompt,
            "identity": format!("console:agent:{channel}"),
            "purpose": "Top-level console agent (tube conversation)",
            "tubeChannel": channel,
            "budgetUsd": 0.25,
        });
        // Model-backends (ollama) require an explicit model.
        if matches!(backend, Backend::Ollama) {
            let m = std::env::var("PD_CONSOLE_OLLAMA_MODEL").unwrap_or_else(|_| "llama3.1:8b".into());
            body["model"] = serde_json::json!(m);
        }
        // Worktree isolation: the daemon refuses to run an agent in a main
        // checkout. Pass an operator-provided worktree.
        if let Ok(wd) = std::env::var("PD_CONSOLE_WORKDIR") {
            body["workdir"] = serde_json::json!(wd);
        }
        let resp = self
            .http
            .post(format!("{}/spawn", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /spawn")?;
        let resp = ensure_success(resp, "spawn").await?;
        let v: serde_json::Value = resp.json().await.context("spawn response")?;
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
        Ok(SpawnOutcome {
            id: s("agentId").unwrap_or_else(|| "?".into()),
            status: s("status").unwrap_or_default(),
            output: s("output"),
            error: s("error"),
        })
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
                    sender: m.get("sender").and_then(|s| s.as_str()).unwrap_or("?").to_string(),
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
    pub async fn dispatch_action(&self, id: &str, action: &str, reason: Option<&str>) -> Result<()> {
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
                let mut req = http.get(&url);
                if let Some(id) = &last_id {
                    req = req.header("Last-Event-ID", id.as_str());
                }
                let resp = match req.send().await {
                    Ok(r) if r.status().is_success() => r,
                    // 404 = unknown agent: nothing will ever stream, so stop
                    // (don't spin reconnecting against a permanent error).
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
}

/// Pull readable text from a stream-envelope `body` (or any payload value):
/// a bare string, `{text:...}`, or `{content:...}`. Public so surfaces can fold
/// `agent.tube` frames into a line without re-implementing the shape walk.
pub fn body_text(body: &serde_json::Value) -> String {
    extract_text(Some(body))
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

/// Result of a spawn: the agent id, its lifecycle status, any one-shot inline
/// output, and a daemon error/block reason when the launch was refused.
pub struct SpawnOutcome {
    pub id: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

/// One hosted top-level agent.
pub struct TopLevelAgent {
    pub id: String,
    pub backend: Backend,
    pub channel: String,
    pub cursor: u64,
}

/// The console's conversation registry — create / switch / converse, all on-bus.
pub struct AgentManager {
    client: DaemonClient,
    pub agents: BTreeMap<u64, TopLevelAgent>,
    pub active: Option<u64>,
    next: u64,
}

impl AgentManager {
    pub fn new() -> Result<Self> {
        Ok(Self { client: DaemonClient::discover()?, agents: BTreeMap::new(), active: None, next: 1 })
    }

    pub fn daemon(&self) -> &DaemonClient {
        &self.client
    }

    /// Create a NEW top-level agent on `backend`. The thing iterm2 was for.
    pub async fn create_agent(&mut self, backend: Backend, prompt: &str) -> Result<(u64, SpawnOutcome)> {
        let local = self.next;
        self.next += 1;
        let channel = format!("console-agent-{local}");
        let outcome = self.client.spawn(backend, prompt, &channel).await?;
        self.agents.insert(local, TopLevelAgent { id: outcome.id.clone(), backend, channel, cursor: 0 });
        self.active = Some(local);
        Ok((local, outcome))
    }

    pub async fn send(&mut self, text: &str) -> Result<()> {
        let a = self.active.and_then(|i| self.agents.get(&i)).ok_or_else(|| anyhow!("no active agent"))?;
        self.client.tube_send(&a.channel, text, "operator").await
    }

    pub async fn poll_active(&mut self) -> Result<Vec<TubeMsg>> {
        let local = self.active.ok_or_else(|| anyhow!("no active agent"))?;
        let (channel, cursor) = {
            let a = self.agents.get(&local).unwrap();
            (a.channel.clone(), a.cursor)
        };
        let (new_cursor, msgs) = self.client.tube_poll(&channel, cursor).await?;
        if let Some(a) = self.agents.get_mut(&local) {
            a.cursor = new_cursor;
        }
        // Don't echo the operator's own turns back as replies.
        Ok(msgs.into_iter().filter(|m| m.sender != "operator").collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_backends_round_trip() {
        for b in Backend::ALL {
            assert_eq!(Backend::parse(b.as_str()), Some(b));
        }
        assert!(Backend::parse("nope").is_none());
    }

    #[test]
    fn extract_text_handles_shapes() {
        assert_eq!(extract_text(Some(&serde_json::json!("hi"))), "hi");
        assert_eq!(extract_text(Some(&serde_json::json!({ "text": "yo" }))), "yo");
        assert_eq!(extract_text(Some(&serde_json::json!({ "content": "c" }))), "c");
        assert_eq!(extract_text(None), "");
    }

    // ── Stream envelope parsing ───────────────────────────────────────────────

    #[test]
    fn stream_kind_round_trips_and_falls_back() {
        assert_eq!(StreamKind::parse("agent.status"), StreamKind::Status);
        assert_eq!(StreamKind::parse("agent.tube"), StreamKind::Tube);
        assert_eq!(StreamKind::parse("agent.transcript"), StreamKind::Transcript);
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
        assert_eq!(env.body.get("text").and_then(|t| t.as_str()), Some("compiling…"));
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
        assert_eq!(p.last_id(), Some("42"), "id is sticky without a new id: line");
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
        assert_eq!(envs[0].body.get("text").and_then(|t| t.as_str()), Some("control.interrupt"));
    }
}
