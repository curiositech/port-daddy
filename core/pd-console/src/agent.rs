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
    Claude,
    Gemini,
    Groq,
    Deepseek,
    Xai,
    Openai,
    ClaudeCli,
    Codex,
    Cloudflare,
    Ollama,
    LmStudio,
    Aider,
    Custom,
}

impl Backend {
    pub const ALL: [Backend; 13] = [
        Backend::Claude,
        Backend::Gemini,
        Backend::Groq,
        Backend::Deepseek,
        Backend::Xai,
        Backend::Openai,
        Backend::ClaudeCli,
        Backend::Codex,
        Backend::Cloudflare,
        Backend::Ollama,
        Backend::LmStudio,
        Backend::Aider,
        Backend::Custom,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Claude => "claude",
            Backend::Gemini => "gemini",
            Backend::Groq => "groq",
            Backend::Deepseek => "deepseek",
            Backend::Xai => "xai",
            Backend::Openai => "openai",
            Backend::ClaudeCli => "claude-cli",
            Backend::Codex => "codex",
            Backend::Cloudflare => "cloudflare",
            Backend::Ollama => "ollama",
            Backend::LmStudio => "lmstudio",
            Backend::Aider => "aider",
            Backend::Custom => "custom",
        }
    }

    pub fn parse(s: &str) -> Option<Backend> {
        Backend::ALL.into_iter().find(|b| b.as_str() == s)
    }

    /// Human label for the inline picker chips (the operator never types the
    /// wire id; they pick a labelled option).
    pub fn label(self) -> &'static str {
        match self {
            Backend::Claude => "Claude (API)",
            Backend::Gemini => "Gemini",
            Backend::Groq => "Groq",
            Backend::Deepseek => "DeepSeek",
            Backend::Xai => "Grok (xAI)",
            Backend::Openai => "OpenAI",
            Backend::ClaudeCli => "Claude Code",
            Backend::Codex => "Codex",
            Backend::Cloudflare => "Cloudflare",
            Backend::Ollama => "Ollama (local)",
            Backend::LmStudio => "LM Studio",
            Backend::Aider => "Aider",
            Backend::Custom => "Custom",
        }
    }
}

/// THE MULTI-VENDOR MAP — route a Conjure node's free-string `model_tier`
/// (`"opus"` / `"sonnet"` / `"haiku"` / `"gemini"` / `"codex"` / `"groq"` /
/// `"gpt"` / …) to the daemon spawner Backend that should run it.
///
/// This is what makes Conjure dispatch genuinely multi-vendor instead of
/// Claude-only: a node tagged `gemini` spawns on Gemini, a node tagged `codex`
/// spawns on Codex, a node tagged `groq` on Groq — each through the SAME
/// `DaemonClient::spawn` path the operator's manual Spawn command uses, which
/// hits the daemon's existing vendor spawner (`lib/spawner.ts`). That spawner
/// launches the vendor CLI backends that are installed + pass readiness
/// (codex / claude-cli already do; gemini if installed). It does NOT require
/// the unbuilt Giant Squid Harness (ADR-0091, Proposed) — that is the FUTURE
/// upgrade for richer in-loop vendor-hook coordination, not a prerequisite here.
///
/// `model_tier` is a CAPABILITY string ("opus") or a VENDOR string ("gemini"),
/// because the planner emits both shapes. Claude tiers (opus/sonnet/haiku) map
/// to `ClaudeCli` — Claude Code (Max) is the Prime default and is launchable
/// without an API key. An unknown / empty tier also falls back to `ClaudeCli`,
/// so a node can never fail to route: the worst case is "the default vendor".
pub fn backend_for_tier(model_tier: &str) -> Backend {
    match model_tier.trim().to_ascii_lowercase().as_str() {
        // Claude capability tiers + the bare vendor name → Claude Code (Max).
        "opus" | "sonnet" | "haiku" | "claude" | "claude-cli" | "claude-code" => Backend::ClaudeCli,
        "gemini" | "google" => Backend::Gemini,
        "codex" => Backend::Codex,
        "groq" => Backend::Groq,
        "deepseek" => Backend::Deepseek,
        "xai" | "grok" => Backend::Xai,
        "openai" | "gpt" | "gpt-4" | "gpt-4o" | "o1" | "o3" => Backend::Openai,
        "ollama" | "local" => Backend::Ollama,
        "lmstudio" | "lm-studio" | "lm_studio" => Backend::LmStudio,
        "aider" => Backend::Aider,
        // Unknown / empty: the Prime default. Claude Max never bounces on a
        // missing API key, so this is the safe "still launchable" fallback.
        _ => Backend::ClaudeCli,
    }
}

/// A capability tier the operator picks instead of memorising model ids. The
/// tier is provider-agnostic; the concrete model is resolved at spawn time from
/// the [`ModelCatalog`] config — never hard-coded — so the model list never goes
/// stale in the binary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    High,
    Mid,
    Low,
}

impl Tier {
    pub const ALL: [Tier; 3] = [Tier::High, Tier::Mid, Tier::Low];

    pub fn as_str(self) -> &'static str {
        match self {
            Tier::High => "high",
            Tier::Mid => "mid",
            Tier::Low => "low",
        }
    }

    /// The chip label — tier plus a hint at what it buys.
    pub fn label(self) -> &'static str {
        match self {
            Tier::High => "High · most capable",
            Tier::Mid => "Mid · balanced",
            Tier::Low => "Low · fast & cheap",
        }
    }
}

/// The seed shipped with the binary, overridden by any on-disk config. Kept as
/// raw JSON (data, not Rust logic) so it reads like the editable file.
const BUNDLED_MODEL_TIERS: &str = include_str!("../config/model-tiers.json");

/// Provider capability tiers loaded from a JSON config — NOT compiled-in logic —
/// so the tier→model map can change without a rebuild. Load order:
///   `$PD_CONSOLE_MODEL_TIERS` → `~/.port-daddy/model-tiers.json` → bundled seed.
/// The on-disk file (the installer writes it; the operator edits it) wins. A
/// model id absent from the daemon's cost-rate registry fails the launch closed,
/// which is the signal to fix the id in the config.
#[derive(Debug, Clone, Default)]
pub struct ModelCatalog {
    providers: std::collections::HashMap<String, std::collections::HashMap<String, String>>,
}

impl ModelCatalog {
    pub fn load() -> ModelCatalog {
        let raw = std::env::var("PD_CONSOLE_MODEL_TIERS")
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .or_else(|| {
                dirs::home_dir()
                    .map(|h| h.join(".port-daddy/model-tiers.json"))
                    .and_then(|p| std::fs::read_to_string(p).ok())
            })
            .unwrap_or_else(|| BUNDLED_MODEL_TIERS.to_string());
        Self::parse(&raw).unwrap_or_default()
    }

    /// Parse the `{ "providers": { "<backend>": { "<tier>": "<model>" } } }` shape.
    pub fn parse(raw: &str) -> Option<ModelCatalog> {
        let v: serde_json::Value = serde_json::from_str(raw).ok()?;
        let mut providers = std::collections::HashMap::new();
        if let Some(obj) = v.get("providers").and_then(|p| p.as_object()) {
            for (backend, tiers) in obj {
                if let Some(tobj) = tiers.as_object() {
                    let map = tobj
                        .iter()
                        .filter_map(|(t, m)| Some((t.clone(), m.as_str()?.to_string())))
                        .collect();
                    providers.insert(backend.clone(), map);
                }
            }
        }
        Some(ModelCatalog { providers })
    }

    /// Whether this backend offers capability tiers (i.e. the config maps it).
    /// CLI backends (Claude Code, Codex, Aider) are intentionally absent — they
    /// run whatever model they're configured with, so a tier would be a lie.
    pub fn has_tiers(&self, backend: Backend) -> bool {
        self.providers
            .get(backend.as_str())
            .map(|m| !m.is_empty())
            .unwrap_or(false)
    }

    /// Resolve (backend, tier) → model id from the config, or `None` to let the
    /// daemon pick its own per-backend default.
    pub fn resolve(&self, backend: Backend, tier: Tier) -> Option<String> {
        self.providers
            .get(backend.as_str())?
            .get(tier.as_str())
            .cloned()
    }
}

/// One message off the tube.
#[derive(Debug, Clone)]
pub struct TubeMsg {
    pub id: u64,
    pub sender: String,
    pub text: String,
}

/// Per-spawn options that ride alongside the four positional `spawn` args.
///
/// Today this carries exactly one knob — `inject_squid_hooks` — but it is a
/// struct (not a bare `bool`) so future opt-ins land here without re-threading
/// every call site. `Default` is the byte-for-byte historical behaviour: no
/// squid hooks, so the manual Spawn command and `create_agent` are unchanged.
///
/// `inject_squid_hooks` → the daemon body's `"injectSquidHooks": true`. When the
/// daemon runs an updated `routes/spawn.ts` + `lib/spawner.ts`, that flag makes a
/// `claude-cli` / `cli:claude-code` launch FIRST sink the Giant Squid Harness
/// (ADR-0091) pd-hook-* tentacles into the workspace's `.claude/settings.json`,
/// so the conjure-dispatched vendor CLI runs UNDER PD coordination — its
/// UserPromptSubmit / PreToolUse / PostToolUse turns fire the lock gate +
/// pheromone hooks inside Claude Code's own loop (Claude Max Prime). codex /
/// gemini remain validate-then-add: their squid adapters throw, so the flag is a
/// no-op there until those adapters are written.
#[derive(Debug, Clone, Copy, Default)]
pub struct SpawnOpts {
    /// Inject the Giant Squid pd-hook tentacles for this spawn (default false).
    pub inject_squid_hooks: bool,
}

impl SpawnOpts {
    /// The conjure-dispatch posture: run the vendor agent UNDER squid
    /// coordination (lock-gating + pheromones via the injected pd-hook-*
    /// tentacles). The conjurer's vendor agents always dispatch with this on.
    pub fn squid() -> Self {
        SpawnOpts {
            inject_squid_hooks: true,
        }
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
        // Resolution order, highest priority first:
        //   1. `PORT_DADDY_URL` env — explicit override for one launch.
        //   2. `~/.port-daddy/console-daemon.url` — the operator's selected daemon
        //      (a one-line URL). This is the console's "use this daemon" switch:
        //      point it at a dev berth (e.g. http://127.0.0.1:9886) WITHOUT
        //      clobbering the canonical daemon.port. Delete the file to fall back
        //      to stable. The status bar shows which URL is live.
        //   3. `~/.port-daddy/daemon.port` — the canonical (stable) daemon.
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
        let port = home
            .map(|h| h.join(".port-daddy/daemon.port"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| s.trim().parse::<u16>().ok())
            .ok_or_else(|| {
                anyhow!(
                    "cannot locate the Port Daddy daemon: set PORT_DADDY_URL, write \
                     ~/.port-daddy/console-daemon.url, or start the daemon (it writes \
                     ~/.port-daddy/daemon.port)"
                )
            })?;
        Ok(Self::new(format!("http://127.0.0.1:{port}")))
    }

    /// Construct a client against an already-resolved base URL (e.g. the value
    /// `discover().base()` returned, handed to a background refresh thread).
    pub fn new(base: String) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
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
    ///
    /// `opts.inject_squid_hooks` adds `"injectSquidHooks": true` to the POST body
    /// (see [`build_spawn_body`]); conjure-dispatch sets it so the vendor CLI runs
    /// under PD coordination. `Default` opts keep the historical body unchanged.
    pub async fn spawn(
        &self,
        backend: Backend,
        prompt: &str,
        channel: &str,
        model: Option<&str>,
        opts: SpawnOpts,
    ) -> Result<SpawnOutcome> {
        let body = build_spawn_body(backend, prompt, channel, model, opts);
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

    /// Propose a dispatch: `POST /dispatches` with `{ goal, requestedBy,
    /// mergePolicy, baseBranch }`. The daemon requires a non-empty `goal` string
    /// and returns 201 with the queued dispatch. `requestedBy` defaults to
    /// `operator` (matching the route default) so the proposal is attributed to
    /// the console operator. The new proposal lands in the Dispatch pane's
    /// `review_pending` queue on the next refresh.
    pub async fn propose_dispatch(&self, goal: &str) -> Result<()> {
        let goal = goal.trim();
        if goal.is_empty() {
            return Err(anyhow!("propose_dispatch needs a non-empty goal"));
        }
        let body = serde_json::json!({ "goal": goal, "requestedBy": "operator" });
        let resp = self
            .http
            .post(format!("{}/dispatches", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /dispatches")?;
        ensure_success(resp, "propose_dispatch").await?;
        Ok(())
    }

    /// Launch a sortie: `POST /sorties` with `{ goal, projectDir, backend,
    /// budgetUsd }`. The daemon validates ALL four — `projectDir` must exist and
    /// pass the project-root guard, `backend` must be a known runtime, and
    /// `budgetUsd` must be a positive ceiling. `projectDir` comes from
    /// `PD_CONSOLE_WORKDIR` (the same operator-provided worktree `spawn` uses);
    /// without it the launch is refused loudly rather than guessing a directory.
    /// `backend` defaults to `claude-cli` and the budget to $0.25. Sortie pane
    /// reads `/sorties`, so the mission appears on the next refresh.
    pub async fn launch_sortie(&self, goal: &str) -> Result<()> {
        let goal = goal.trim();
        if goal.is_empty() {
            return Err(anyhow!("launch_sortie needs a non-empty goal"));
        }
        let project_dir = std::env::var("PD_CONSOLE_WORKDIR").map_err(|_| {
            anyhow!(
                "launch_sortie needs a project directory: set PD_CONSOLE_WORKDIR \
                 to the worktree the sortie should run in (the daemon refuses an \
                 unknown/main checkout)"
            )
        })?;
        let backend =
            std::env::var("PD_CONSOLE_SORTIE_BACKEND").unwrap_or_else(|_| "claude-cli".into());
        let budget: f64 = std::env::var("PD_CONSOLE_SORTIE_BUDGET")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .filter(|b: &f64| *b > 0.0)
            .unwrap_or(0.25);
        let body = serde_json::json!({
            "goal": goal,
            "projectDir": project_dir,
            "backend": backend,
            "budgetUsd": budget,
        });
        let resp = self
            .http
            .post(format!("{}/sorties", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /sorties")?;
        ensure_success(resp, "launch_sortie").await?;
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

/// Build the `POST /spawn` request body. Factored out of [`DaemonClient::spawn`]
/// as a PURE function (env reads aside) so the wire shape is unit-testable without
/// a live daemon — the proof that a conjure dispatch carries `injectSquidHooks`.
///
/// When `opts.inject_squid_hooks` is set, the body gains `"injectSquidHooks":
/// true`. The daemon's `routes/spawn.ts` reads that flag into the spawner spec
/// (`spec.injectSquidHooks`), and `lib/spawner.ts`'s `runClaudeCli` then injects
/// the Giant Squid Harness (ADR-0091) pd-hook-* tentacles into the workspace's
/// `.claude/settings.json` before the CLI boots — so a conjure-dispatched vendor
/// CLI runs UNDER PD coordination (lock-gating + pheromones) inside Claude Code's
/// own loop (Claude Max Prime). codex / gemini remain validate-then-add: their
/// squid adapters throw, so the flag is a harmless no-op for those backends.
pub fn build_spawn_body(
    backend: Backend,
    prompt: &str,
    channel: &str,
    model: Option<&str>,
    opts: SpawnOpts,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "backend": backend.as_str(),
        "task": prompt,
        "identity": format!("console:agent:{channel}"),
        "purpose": "Top-level console agent (tube conversation)",
        "tubeChannel": channel,
        "budgetUsd": 0.25,
    });
    // An operator-chosen capability tier resolves to a model id; honour it.
    if let Some(m) = model {
        body["model"] = serde_json::json!(m);
    } else if matches!(backend, Backend::Ollama) {
        // Model-backends (ollama) require an explicit model even with no tier.
        let m = std::env::var("PD_CONSOLE_OLLAMA_MODEL").unwrap_or_else(|_| "llama3.1:8b".into());
        body["model"] = serde_json::json!(m);
    }
    // Worktree isolation: the daemon refuses to run an agent in a main
    // checkout. Pass an operator-provided worktree.
    if let Ok(wd) = std::env::var("PD_CONSOLE_WORKDIR") {
        body["workdir"] = serde_json::json!(wd);
    }
    // Giant Squid Harness opt-in (ADR-0091): only emit the flag when set, so a
    // default spawn's body is byte-for-byte what it has always been (the daemon
    // defaults the absent flag to false). Conjure dispatch sets it true so its
    // vendor CLIs run under PD coordination via the injected pd-hook tentacles.
    if opts.inject_squid_hooks {
        body["injectSquidHooks"] = serde_json::json!(true);
    }
    body
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
        Ok(Self {
            client: DaemonClient::discover()?,
            agents: BTreeMap::new(),
            active: None,
            next: 1,
        })
    }

    pub fn daemon(&self) -> &DaemonClient {
        &self.client
    }

    async fn create_agent_with_opts(
        &mut self,
        backend: Backend,
        prompt: &str,
        opts: SpawnOpts,
    ) -> Result<(u64, SpawnOutcome)> {
        let local = self.next;
        self.next += 1;
        let channel = format!("console-agent-{local}");
        let outcome = self
            .client
            .spawn(backend, prompt, &channel, None, opts)
            .await?;
        self.agents.insert(
            local,
            TopLevelAgent {
                id: outcome.id.clone(),
                backend,
                channel,
                cursor: 0,
            },
        );
        self.active = Some(local);
        Ok((local, outcome))
    }

    /// Create a NEW top-level agent on `backend`. The thing iterm2 was for.
    pub async fn create_agent(
        &mut self,
        backend: Backend,
        prompt: &str,
    ) -> Result<(u64, SpawnOutcome)> {
        // Plain spawn: no squid hooks. Use create_harnessed_agent for the
        // Port-Daddy-compliant launch posture.
        self.create_agent_with_opts(backend, prompt, SpawnOpts::default())
            .await
    }

    /// Create a top-level agent under the Giant Squid harness. This keeps the
    /// same tube-bound conversation path as create_agent, but requests hook
    /// injection at daemon spawn time so turn-start/tool/post-tool affordances
    /// can reach the vendor CLI loop.
    pub async fn create_harnessed_agent(
        &mut self,
        backend: Backend,
        prompt: &str,
    ) -> Result<(u64, SpawnOutcome)> {
        self.create_agent_with_opts(backend, prompt, SpawnOpts::squid())
            .await
    }

    pub async fn send(&mut self, text: &str) -> Result<()> {
        let a = self
            .active
            .and_then(|i| self.agents.get(&i))
            .ok_or_else(|| anyhow!("no active agent"))?;
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
        Ok(msgs
            .into_iter()
            .filter(|m| m.sender != "operator")
            .collect())
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
        // DeepSeek + xAI are first-class backends alongside Groq + LM Studio.
        assert_eq!(Backend::parse("deepseek"), Some(Backend::Deepseek));
        assert_eq!(Backend::Deepseek.as_str(), "deepseek");
        assert_eq!(Backend::Deepseek.label(), "DeepSeek");
        assert!(Backend::ALL.contains(&Backend::Deepseek));
        assert_eq!(Backend::parse("xai"), Some(Backend::Xai));
        assert_eq!(Backend::Xai.as_str(), "xai");
        assert_eq!(Backend::Xai.label(), "Grok (xAI)");
        assert!(Backend::ALL.contains(&Backend::Xai));
        assert!(Backend::parse("nope").is_none());

        // app.rs::spawn_backend_hint() is GENERATED by joining Backend::ALL
        // (minus Custom) on " · ". Replicate that exact derivation here (agent.rs
        // is the unit-tested binary; app.rs only compiles under the gpui build)
        // to prove the Spawn suggestion now advertises deepseek + xai.
        let hint = Backend::ALL
            .into_iter()
            .filter(|b| *b != Backend::Custom)
            .map(|b| b.as_str())
            .collect::<Vec<_>>()
            .join(" · ");
        assert!(
            hint.contains("deepseek"),
            "spawn hint must advertise deepseek: {hint}"
        );
        assert!(
            hint.contains("xai"),
            "spawn hint must advertise xai: {hint}"
        );
        assert!(
            hint.contains("groq"),
            "spawn hint must still advertise groq: {hint}"
        );
        assert!(
            !hint.contains("custom"),
            "spawn hint must exclude custom: {hint}"
        );
    }

    #[test]
    fn backend_for_tier_is_multi_vendor() {
        // Claude capability tiers all route to Claude Code (the Prime/Max default).
        assert_eq!(backend_for_tier("opus"), Backend::ClaudeCli);
        assert_eq!(backend_for_tier("sonnet"), Backend::ClaudeCli);
        assert_eq!(backend_for_tier("haiku"), Backend::ClaudeCli);
        assert_eq!(backend_for_tier("claude"), Backend::ClaudeCli);
        // The actual multi-vendor proof: non-Claude tiers route to OTHER vendors.
        assert_eq!(backend_for_tier("gemini"), Backend::Gemini);
        assert_eq!(backend_for_tier("codex"), Backend::Codex);
        assert_eq!(backend_for_tier("groq"), Backend::Groq);
        assert_eq!(backend_for_tier("deepseek"), Backend::Deepseek);
        assert_eq!(backend_for_tier("xai"), Backend::Xai);
        assert_eq!(backend_for_tier("grok"), Backend::Xai);
        assert_eq!(backend_for_tier("openai"), Backend::Openai);
        assert_eq!(backend_for_tier("gpt"), Backend::Openai);
        assert_eq!(backend_for_tier("ollama"), Backend::Ollama);
        assert_eq!(backend_for_tier("lmstudio"), Backend::LmStudio);
        assert_eq!(backend_for_tier("lm-studio"), Backend::LmStudio);
        // Case + whitespace tolerant (planner output is a free string).
        assert_eq!(backend_for_tier("  GEMINI "), Backend::Gemini);
        // Unknown / empty falls back to the launchable default, never panics.
        assert_eq!(backend_for_tier("frobnicate"), Backend::ClaudeCli);
        assert_eq!(backend_for_tier(""), Backend::ClaudeCli);
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
    fn model_catalog_resolves_from_config_not_hardcode() {
        // The catalog is parsed from JSON data, never compiled-in logic.
        let cat = ModelCatalog::parse(
            r#"{ "providers": {
                   "claude":   { "high": "claude-opus-4-8", "low": "claude-haiku-4-5-20251001" },
                   "groq":     { "high": "llama-3.3-70b-versatile" },
                   "deepseek": { "high": "deepseek-reasoner", "low": "deepseek-chat" },
                   "xai":      { "high": "grok-2-latest", "low": "grok-code-fast-1" }
                 } }"#,
        )
        .expect("valid catalog");
        assert_eq!(
            cat.resolve(Backend::Claude, Tier::High).as_deref(),
            Some("claude-opus-4-8")
        );
        assert_eq!(
            cat.resolve(Backend::Groq, Tier::High).as_deref(),
            Some("llama-3.3-70b-versatile")
        );
        assert_eq!(
            cat.resolve(Backend::Deepseek, Tier::High).as_deref(),
            Some("deepseek-reasoner")
        );
        assert_eq!(
            cat.resolve(Backend::Deepseek, Tier::Low).as_deref(),
            Some("deepseek-chat")
        );
        assert_eq!(
            cat.resolve(Backend::Xai, Tier::High).as_deref(),
            Some("grok-2-latest")
        );
        assert_eq!(
            cat.resolve(Backend::Xai, Tier::Low).as_deref(),
            Some("grok-code-fast-1")
        );
        // A tier absent from the config → None (daemon picks its default).
        assert_eq!(cat.resolve(Backend::Claude, Tier::Mid), None);
        // A backend absent from the config offers no tiers (CLI backends, etc.).
        assert!(cat.has_tiers(Backend::Claude));
        assert!(!cat.has_tiers(Backend::ClaudeCli));
        // The bundled seed is valid JSON and maps the model-backends.
        let seed = ModelCatalog::parse(BUNDLED_MODEL_TIERS).expect("bundled seed parses");
        assert!(seed.has_tiers(Backend::Claude));
        assert!(seed.resolve(Backend::Gemini, Tier::Low).is_some());
        // Every backend still has a non-empty picker label.
        assert!(Backend::ALL.iter().all(|b| !b.label().is_empty()));
    }

    #[test]
    fn conjure_dispatch_body_carries_inject_squid_hooks() {
        // The conjure-dispatch posture runs the vendor agent UNDER squid
        // coordination: the POST /spawn body must carry injectSquidHooks=true so
        // the daemon injects the pd-hook tentacles (lock-gating + pheromones).
        let body = build_spawn_body(
            Backend::ClaudeCli,
            "do the thing",
            "operator",
            None,
            SpawnOpts::squid(),
        );
        assert_eq!(
            body.get("injectSquidHooks").and_then(|v| v.as_bool()),
            Some(true),
            "conjure dispatch must opt into the Giant Squid Harness"
        );

        // A manual Spawn (default opts) must NOT carry the flag — the body is the
        // historical shape, so the daemon defaults it to false (unchanged spawn).
        let manual = build_spawn_body(
            Backend::ClaudeCli,
            "do the thing",
            "operator",
            None,
            SpawnOpts::default(),
        );
        assert!(
            manual.get("injectSquidHooks").is_none(),
            "the manual Spawn body must omit injectSquidHooks (backward-compatible)"
        );

        // SpawnOpts::squid is the one true source of the true flag.
        assert!(SpawnOpts::squid().inject_squid_hooks);
        assert!(!SpawnOpts::default().inject_squid_hooks);
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
}
