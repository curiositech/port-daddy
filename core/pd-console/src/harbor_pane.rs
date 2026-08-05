//! Harbor pane — the Agent Node roster + detail surface (binder ch18 work order
//! C3; F0 contract freeze ADR-0095; converged mock
//! `docs/design/fleetbar-mockups/triad-console-detail.html`).
//!
//! Consumes the frozen `schemas/agent-harbor/v0/` shapes with their canonical
//! field names — AgentNode (`agentNodeId`, `complianceLevel`, `complianceProbeId`,
//! `currentSessionId`…), TranscriptEvent (`agentNodeId`, `bodyId`, `payloadJson`,
//! `payloadBlobRefs`, `redactionState`, `retentionPolicyId`), ControlCommand
//! (capability-specific `kind` + honest `unsupported` state), ComplianceProbeResult
//! (`witnessedLevel` — the witnessing invariant, ADR-0095 §8), and CostAccrualEvent
//! (folded from the transcript's `cost_accrued`/`budget_*` family).
//!
//! The C3 acceptance gates, enforced here and unit-tested below:
//!   - no ordinary operator action requires typing an id (rows select by click);
//!   - active and historical sessions are visually distinct (live tail vs replay);
//!   - a missing transcript shows its exact cause and remediation, never an empty pane;
//!   - controls are enabled only when daemon-witnessed compliance supports them
//!     (stale projections may display but never authorize — ADR-0095 §3);
//!   - a failed fetch is recorded per-section and rendered; it never propagates,
//!     so a pane failure cannot blank the rest of the app.

use crate::agent::{DaemonClient, StreamEnvelope, StreamKind};
use crate::maritime::flag_for_state;
use crate::pane::{Block, Pane, Subscription, SurfaceAction, Tone};
use crate::util::{arr, s, trunc};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

// ── The compliance ladder (frozen, ADR-0095 fork resolution 2) ───────────────

/// Rank a C-level string ("C0".."C6") on the frozen 7-level ladder. Unknown
/// levels rank as C0 — an unparseable level must never grant capability.
fn level_rank(level: &str) -> u8 {
    match level {
        "C1" => 1,
        "C2" => 2,
        "C3" => 3,
        "C4" => 4,
        "C5" => 5,
        "C6" => 6,
        _ => 0,
    }
}

/// Operator-language name for a ladder level (mock: the roster badge).
fn level_name(level: &str) -> &'static str {
    match level {
        "C1" => "transcripted",
        "C2" => "governed",
        "C3" => "suggestible",
        "C4" => "controllable",
        "C5" => "cooperative",
        "C6" => "resumable",
        _ => "registered",
    }
}

/// The C3 click-control verb set (binder ch18 work order C3). Each is a
/// distinct claim with its own gate — never a generic "stop" button
/// (agent-control-command-contract: collapsed verbs are the #1 anti-pattern).
/// `successor` rides the wire as ControlCommand `kind: "resume"` — ADR-0095:
/// "resume creates a successor run"; old history is never mutated.
pub const CONTROL_VERBS: [(&str, &str, u8); 6] = [
    // (verb, wire kind, minimum ladder rank)
    ("steer", "steer", 3),           // C3 Suggestible: inject before next turn
    ("pause", "pause", 4),           // C4 Controllable
    ("interrupt", "interrupt", 4),   // C4 Controllable
    ("checkpoint", "checkpoint", 4), // C4 Controllable
    ("successor", "resume", 6),      // C6 Resumable: reconstructable successor
    ("retire", "retire", 4),         // C4 Controllable: never destroys evidence
];

/// Resolve a C3 verb to its wire `kind` (F0 control-command.schema.json enum).
pub fn wire_kind(verb: &str) -> Option<&'static str> {
    CONTROL_VERBS
        .iter()
        .find(|(v, _, _)| *v == verb)
        .map(|(_, k, _)| *k)
}

// ── Roster model (tolerant reader over the frozen AgentNode shape) ───────────

#[derive(Debug, Clone, Default)]
pub struct NodeRowData {
    pub agent_node_id: String,
    pub display_name: String,
    pub identity: String,
    pub class: String,
    pub authority: String,
    pub status: String,
    pub compliance_level: String,
    pub compliance_probe_id: Option<String>,
    /// Daemon-computed `witnessedLevel` when the node (or its embedded probe)
    /// carries one. `None` = no probe evidence surfaced to this projection.
    pub witnessed_level: Option<String>,
    pub transcript_fidelity: String,
    pub official_mode: String,
    pub session_id: Option<String>,
    pub body_id: Option<String>,
    pub run_id: Option<String>,
    pub worktree: String,
    pub branch: String,
    pub provider: String,
    pub model_tier: String,
    pub model_name: String,
    pub last_heartbeat_at: String,
    pub last_event_at: String,
}

/// Nullable string field: `None` for missing/null, `Some` otherwise.
fn opt_s(v: &Value, key: &str) -> Option<String> {
    match v.get(key) {
        Some(Value::String(x)) if !x.is_empty() => Some(x.clone()),
        _ => None,
    }
}

impl NodeRowData {
    /// Tolerant reader over the frozen `agent-node.schema.json` shape. Canonical
    /// names only (`agentNodeId`, never `agentId`; ADR-0095 fork resolution 1).
    /// Unknown/extra fields are tolerated; absent fields degrade to honest
    /// emptiness, never invented values.
    pub fn from_value(v: &Value) -> Self {
        let workspace = v.get("workspace").cloned().unwrap_or(Value::Null);
        // Provider/model enrichment: optional projection extras (the F0 schema
        // allows additionalProperties). Unknown stays "" and renders as "—".
        let display_name = {
            let d = s(v, "displayName");
            if d.is_empty() { s(v, "identity") } else { d }
        };
        // An embedded latest-probe projection, when the daemon supplies one.
        let witnessed_level = v
            .get("complianceProbe")
            .and_then(|p| p.get("witnessedLevel"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| opt_s(v, "witnessedLevel"));

        Self {
            agent_node_id: s(v, "agentNodeId"),
            display_name,
            identity: s(v, "identity"),
            class: s(v, "class"),
            authority: s(v, "authority"),
            status: s(v, "status"),
            compliance_level: s(v, "complianceLevel"),
            compliance_probe_id: opt_s(v, "complianceProbeId"),
            witnessed_level,
            transcript_fidelity: s(v, "transcriptFidelity"),
            official_mode: s(v, "officialMode"),
            session_id: opt_s(v, "currentSessionId"),
            body_id: opt_s(v, "currentBodyId"),
            run_id: opt_s(v, "currentRunId"),
            worktree: s(&workspace, "worktree"),
            branch: s(&workspace, "branch"),
            provider: s(v, "provider"),
            model_tier: s(v, "modelTier"),
            model_name: s(v, "modelName"),
            last_heartbeat_at: s(v, "lastHeartbeatAt"),
            last_event_at: s(v, "lastEventAt"),
        }
    }

    /// The daemon-witnessed effective ladder rank plus, when capped below the
    /// claimed level, the exact reason. THE WITNESSING INVARIANT (ADR-0095 §8):
    /// a `complianceLevel` above C0 with no backing probe is self-report and
    /// invalid — it gates as C0, honestly labeled.
    pub fn effective_rank(&self) -> (u8, Option<String>) {
        let claimed = level_rank(&self.compliance_level);
        if claimed == 0 {
            return (0, None);
        }
        if self.compliance_probe_id.is_none() {
            return (
                0,
                Some(format!(
                    "{} is self-reported — no compliance probe backs it \
                     (witnessing invariant, ADR-0095 §8); treated as C0",
                    self.compliance_level
                )),
            );
        }
        if let Some(w) = &self.witnessed_level {
            let witnessed = level_rank(w);
            if witnessed < claimed {
                return (
                    witnessed,
                    Some(format!(
                        "probe witnessed {w} but the node claims {} — \
                         capped at the witnessed level",
                        self.compliance_level
                    )),
                );
            }
        }
        (claimed, None)
    }

    /// LIVE means daemon-proved liveness: an active status AND daemon-side
    /// evidence of a running body — a bound body id, a heartbeat, or transcript
    /// events. A session row alone is never "live" (ADR-0095 §3).
    pub fn is_live(&self) -> bool {
        self.status == "active"
            && (self.body_id.is_some()
                || !self.last_heartbeat_at.is_empty()
                || !self.last_event_at.is_empty())
    }

    /// Historical = the run is over; the transcript is a replay artifact.
    pub fn is_historical(&self) -> bool {
        matches!(self.status.as_str(), "complete" | "retired")
    }
}

/// Gate one control verb against one node. `Ok(())` = safe to enable the
/// button; `Err(why)` = render disabled with the exact reason (the mock's
/// `why-disabled` copy). This is a projection-side courtesy gate — the daemon
/// re-authorizes on POST; a stale projection can disable but never authorize.
pub fn control_gate(verb: &str, node: &NodeRowData) -> std::result::Result<(), String> {
    let Some((_, _, min_rank)) = CONTROL_VERBS.iter().find(|(v, _, _)| *v == verb) else {
        return Err(format!("unknown control verb '{verb}'"));
    };
    // Observed imports can be watched, never governed (ch18 C2 gate:
    // "observed agents cannot receive C2+ controls").
    if node.authority == "observed" || node.official_mode == "observed" {
        return Err("observed import — Port Daddy can watch but not govern this body; \
                    no controls (C2+ requires a governed adapter)"
            .into());
    }
    if node.status == "retired" {
        return Err("node is retired — historical evidence only".into());
    }
    if node.status == "stale" {
        return Err(format!(
            "stale — last heartbeat {}; a stale projection never authorizes \
             a control (ADR-0095 §3). Refresh, then retry",
            if node.last_heartbeat_at.is_empty() { "unknown" } else { node.last_heartbeat_at.as_str() }
        ));
    }
    // A finished run has no live body to steer/pause/interrupt/checkpoint.
    if node.status == "complete" && matches!(verb, "steer" | "pause" | "interrupt" | "checkpoint") {
        return Err("run complete — no live body; open the transcript replay, \
                    or create a successor (C6)"
            .into());
    }
    let (effective, cap_reason) = node.effective_rank();
    if effective < *min_rank {
        let need = format!("C{min_rank}");
        let mut why = format!(
            "requires {} {} — node is {} {}",
            need,
            level_name(&need),
            if effective == 0 { "C0".into() } else { format!("C{effective}") },
            level_name(&format!("C{effective}")),
        );
        if let Some(r) = cap_reason {
            why.push_str(&format!(" ({r})"));
        }
        return Err(why);
    }
    Ok(())
}

// ── Transcript model (tolerant reader over the frozen TranscriptEvent shape) ─

#[derive(Debug, Clone)]
pub struct TranscriptRow {
    pub sequence: u64,
    pub occurred_at: String,
    pub kind: String,
    pub speaker: String,
    pub text: String,
    pub tone: Tone,
    pub redaction_state: String,
    pub blob_refs: usize,
    /// True for rows folded from the live SSE stream (vs the historical fetch).
    pub live: bool,
}

/// Which conversation family a transcript `kind` belongs to (the open-string
/// kind taxonomy from transcript-event.schema.json). Tolerant: unknown kinds
/// render as plain lines, never dropped.
fn kind_meta(kind: &str) -> (&'static str, Tone) {
    match kind {
        "operator_message" => ("operator", Tone::Accent),
        "assistant_message" | "assistant_delta" | "reasoning_summary" => ("agent", Tone::Default),
        "tool_call" | "tool_result" | "shell_command" | "mcp_call" | "mcp_result" => {
            ("tool", Tone::Resting)
        }
        "stdout_chunk" | "stderr_chunk" => ("shell", Tone::Resting),
        "file_read" | "file_write" | "file_diff" | "file_touch" | "git_action"
        | "commit_created" | "pr_opened" => ("file", Tone::Engaged),
        "tool_denied" | "approval_request" | "budget_warning" => ("gated", Tone::Gated),
        "budget_pause" | "budget_cancelled" | "adapter_error" | "provider_error"
        | "transcript_gap" | "retention_failure" => ("error", Tone::Conflicted),
        "cost_accrued" => ("cost", Tone::Resting),
        "checkpoint" | "successor_created" | "receipt_completed" | "receipt_verified" => {
            ("landed", Tone::Landed)
        }
        _ => ("event", Tone::Default),
    }
}

impl TranscriptRow {
    /// Tolerant reader over the frozen `transcript-event.schema.json` shape:
    /// canonical `payloadJson` / `payloadBlobRefs` / `redactionState` names
    /// (the ch03 `body`/`blobRefs`/`redaction` variant is superseded and NOT
    /// read here — ADR-0095 fork resolution 1).
    pub fn from_value(v: &Value, live: bool) -> Self {
        let kind = s(v, "kind");
        let (speaker, tone) = kind_meta(&kind);
        let payload = v.get("payloadJson").cloned().unwrap_or(Value::Null);
        // Best-effort display text from the structured payload.
        let mut text = ["text", "message", "summary", "command", "path", "detail"]
            .iter()
            .map(|k| s(&payload, k))
            .find(|t| !t.is_empty())
            .unwrap_or_default();
        if text.is_empty() {
            text = kind.clone();
        }
        let redaction_state = s(v, "redactionState");
        if matches!(redaction_state.as_str(), "redacted" | "quarantined") {
            text = format!("[{redaction_state}] content withheld by retention policy");
        }
        Self {
            sequence: v.get("sequence").and_then(Value::as_u64).unwrap_or(0),
            occurred_at: s(v, "occurredAt"),
            kind,
            speaker: speaker.into(),
            text,
            tone,
            redaction_state,
            blob_refs: arr(v, "payloadBlobRefs").len(),
            live,
        }
    }
}

// ── Files touched (absolute-path resolution) ─────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileTouch {
    /// Absolute path — resolved against the node's worktree when the event
    /// carried a relative one (C3 output: "files touched with absolute path
    /// resolution").
    pub absolute: String,
    /// Repo-relative display form.
    pub display: String,
    pub op: String,
    pub stats: String,
}

/// Resolve a possibly-relative transcript path against the node's worktree.
pub fn resolve_absolute(path: &str, worktree: &str) -> String {
    if path.starts_with('/') || worktree.is_empty() {
        path.to_string()
    } else {
        format!("{}/{}", worktree.trim_end_matches('/'), path)
    }
}

/// Fold the file/git event family into a deduped touched-files list.
pub fn fold_file_touches(events: &[Value], worktree: &str) -> Vec<FileTouch> {
    let mut touches: Vec<FileTouch> = Vec::new();
    for ev in events {
        let kind = s(ev, "kind");
        let op = match kind.as_str() {
            "file_write" | "file_diff" => "write",
            "file_read" => "read",
            "file_touch" => "touch",
            _ => continue,
        };
        let payload = ev.get("payloadJson").cloned().unwrap_or(Value::Null);
        let path = s(&payload, "path");
        if path.is_empty() {
            continue;
        }
        let additions = s(&payload, "additions");
        let deletions = s(&payload, "deletions");
        let stats = if additions.is_empty() && deletions.is_empty() {
            String::new()
        } else {
            format!(
                "+{} −{}",
                if additions.is_empty() { "0" } else { &additions },
                if deletions.is_empty() { "0" } else { &deletions }
            )
        };
        let absolute = resolve_absolute(&path, worktree);
        match touches.iter_mut().find(|t| t.absolute == absolute) {
            Some(existing) => {
                // A write supersedes a read in the rollup.
                if op == "write" {
                    existing.op = "write".into();
                    if !stats.is_empty() {
                        existing.stats = stats;
                    }
                }
            }
            None => touches.push(FileTouch {
                absolute,
                display: path,
                op: op.into(),
                stats,
            }),
        }
    }
    touches
}

// ── Cost fold (CostAccrualEvent, ridden in on the transcript's cost family) ──

#[derive(Debug, Clone, Default)]
pub struct CostSummary {
    pub events: usize,
    pub estimated_usd: Option<f64>,
    pub actual_usd: Option<f64>,
    pub budget_action: Option<String>,
}

impl CostSummary {
    /// Fold `cost_accrued`/`budget_*` transcript events whose payload carries
    /// the frozen CostAccrualEvent fields. Unknown values stay `None` — never
    /// guessed (F0: "Unknown values stay null, never guessed").
    pub fn fold(events: &[Value]) -> Self {
        let mut out = Self::default();
        for ev in events {
            let kind = s(ev, "kind");
            if !matches!(
                kind.as_str(),
                "cost_accrued" | "budget_warning" | "budget_pause" | "budget_cancelled"
            ) {
                continue;
            }
            out.events += 1;
            let payload = ev.get("payloadJson").cloned().unwrap_or(Value::Null);
            if let Some(e) = payload.get("estimatedCostUsd").and_then(Value::as_f64) {
                *out.estimated_usd.get_or_insert(0.0) += e;
            }
            if let Some(a) = payload.get("actualCostUsd").and_then(Value::as_f64) {
                *out.actual_usd.get_or_insert(0.0) += a;
            }
            let action = s(&payload, "budgetAction");
            if !action.is_empty() && action != "none" {
                out.budget_action = Some(action);
            }
            if matches!(kind.as_str(), "budget_warning" | "budget_pause" | "budget_cancelled") {
                out.budget_action = Some(kind.trim_start_matches("budget_").to_string());
            }
        }
        out
    }

    pub fn display(&self) -> String {
        match (self.actual_usd, self.estimated_usd) {
            (Some(a), _) => format!("${a:.2}"),
            (None, Some(e)) => format!("~${e:.2} est"),
            (None, None) if self.events > 0 => "accrued (unpriced)".into(),
            _ => "—".into(),
        }
    }
}

// ── The exact-cause contract for a missing transcript ────────────────────────

/// Why there is no transcript to render, with remediation — the C3 gate:
/// "missing transcript shows exact cause", never an empty stream.
pub fn transcript_absence_cause(node: &NodeRowData, fetch_error: Option<&str>) -> String {
    if let Some(err) = fetch_error {
        return err.to_string();
    }
    if node.official_mode == "observed" || node.authority == "observed" {
        return "observed import — the transcript stream is unjoinable and Port Daddy \
                never invents a session (F0: \"never invent a session\"). \
                Remediation: relaunch through `pd work` for an official, transcripted body."
            .into();
    }
    if node.session_id.is_none() {
        let level = if node.compliance_level.is_empty() {
            "C0"
        } else {
            node.compliance_level.as_str()
        };
        return format!(
            "no session bound — the node is registered ({level} {}) but no body has \
             attached a session yet. Remediation: launch a body \
             (`POST /agent-nodes/:id/bodies`) or wait for attach",
            level_name(level),
        );
    }
    if level_rank(&node.compliance_level) < 1 {
        return "C0 Registered — transcription starts at C1 Transcripted (T4 verified \
                fidelity). Remediation: run `pd agent probe` and attach a \
                transcript-capable adapter"
            .into();
    }
    "no transcript events persisted yet for this session".into()
}

// ── Control history (ControlCommand records rendered into the timeline) ──────

#[derive(Debug, Clone)]
pub struct ControlRow {
    pub kind: String,
    pub status: String,
    pub denial_reason: String,
    pub created_at: String,
}

impl ControlRow {
    pub fn from_value(v: &Value) -> Self {
        Self {
            kind: s(v, "kind"),
            status: s(v, "status"),
            denial_reason: s(v, "denialReason"),
            created_at: s(v, "createdAt"),
        }
    }

    fn tone(&self) -> Tone {
        match self.status.as_str() {
            "acknowledged" => Tone::Landed,
            "failed" | "expired" => Tone::Conflicted,
            "unsupported" => Tone::Gated,
            _ => Tone::Resting,
        }
    }
}

// ── Blackboard read model (M6, read-only — binder ch05; ADR-0097 §5) ────────

/// One card from `GET /blackboard` — a tolerant reader over the frozen
/// `blackboard-item.schema.json` shape (the M6 contract). READ-ONLY by
/// design: ch05 defers blackboard write/parley semantics to Milestone 8, so
/// this struct carries no ack/parley/mutation affordances and the pane never
/// POSTs to the board.
#[derive(Debug, Clone, Default)]
pub struct BlackboardCard {
    pub item_id: String,
    /// Open string (tolerant reading): active-claim, contested-file,
    /// transcript-episode, work-receipt, do-not-duplicate, …
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub severity: String,
    pub status: String,
    pub posted_at: String,
    pub session_id: Option<String>,
    pub agent_node_id: Option<String>,
    /// Who the projection derived the card from (`assertedBy.kind`) —
    /// provenance of the underlying fact, not a write permission.
    pub asserted_by: String,
    /// Citation count — the DIGEST-WITH-ZOOM guarantee (the frozen schema's
    /// minItems 1 means a rendered card always has a zoom path to the ledger).
    pub citations: usize,
    /// Freshness label from the card's own `projection.stale` — stale cards
    /// are labeled, never hidden.
    pub stale: bool,
}

impl BlackboardCard {
    /// Tolerant reader over the frozen BlackboardItem shape. Canonical names
    /// only (`itemId`, `postedAt`, `assertedBy`, `detail` — never the
    /// superseded ch03 `body`; ADR-0097 drift lock).
    pub fn from_value(v: &Value) -> Self {
        let asserted_by = v
            .get("assertedBy")
            .map(|a| s(a, "kind"))
            .unwrap_or_default();
        let stale = v
            .get("projection")
            .and_then(|p| p.get("stale"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Self {
            item_id: s(v, "itemId"),
            kind: s(v, "kind"),
            title: s(v, "title"),
            detail: s(v, "detail"),
            severity: s(v, "severity"),
            status: s(v, "status"),
            posted_at: s(v, "postedAt"),
            session_id: opt_s(v, "sessionId"),
            agent_node_id: opt_s(v, "agentNodeId"),
            asserted_by,
            citations: arr(v, "citations").len(),
            stale,
        }
    }

    /// Severity → tone: conflicts read as warnings, never as chrome. Unknown
    /// severities render calm (`Default`) — an unparseable severity must never
    /// paint a false alarm.
    pub fn tone(&self) -> Tone {
        match self.severity.as_str() {
            "critical" => Tone::Alarm,
            "high" => Tone::Conflicted,
            "warning" => Tone::Gated,
            _ => Tone::Default,
        }
    }
}

// ── The pane ─────────────────────────────────────────────────────────────────

pub struct HarborPane {
    pub nodes: Vec<NodeRowData>,
    pub selected: usize,
    /// Historical transcript (fetched replay), oldest→newest.
    transcript: Vec<TranscriptRow>,
    /// Live tail folded from the SSE stream — rendered visually distinct.
    live_tail: Vec<TranscriptRow>,
    files: Vec<FileTouch>,
    cost: CostSummary,
    controls: Vec<ControlRow>,
    /// The harbor-wide read-only blackboard (M6): claims, conflicts, recent
    /// compaction/receipt events. Not per-node — it renders even when the
    /// roster is empty.
    blackboard: Vec<BlackboardCard>,
    /// Invalid assertions the daemon dropped (`droppedInvalid`) — a bad
    /// asserter is visible, never silently absorbed.
    blackboard_dropped: u64,
    roster_error: Option<String>,
    transcript_error: Option<String>,
    control_error: Option<String>,
    blackboard_error: Option<String>,
    /// Outcome flash of the last issued control (verb, message).
    last_control: Option<(String, String)>,
    /// Monotonic salt for idempotency keys.
    command_seq: u64,
}

impl Default for HarborPane {
    fn default() -> Self {
        Self {
            nodes: Vec::new(),
            selected: 0,
            transcript: Vec::new(),
            live_tail: Vec::new(),
            files: Vec::new(),
            cost: CostSummary::default(),
            controls: Vec::new(),
            blackboard: Vec::new(),
            blackboard_dropped: 0,
            roster_error: None,
            transcript_error: None,
            control_error: None,
            blackboard_error: None,
            last_control: None,
            command_seq: 0,
        }
    }
}

impl HarborPane {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn selected_node(&self) -> Option<&NodeRowData> {
        self.nodes.get(self.selected)
    }

    /// Epoch-ms + per-pane counter: a fresh key is minted once per issued
    /// command (per click) and embedded in the POST body, so transport-level
    /// retries of that one POST carry the same key and dedupe daemon-side (F0
    /// "idempotency everywhere"). Two separate clicks are two distinct intents
    /// and deliberately get distinct keys.
    fn idempotency_key(&mut self, verb: &str, node_id: &str) -> String {
        self.command_seq += 1;
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("pd-console:{node_id}:{verb}:{ms}:{}", self.command_seq)
    }

    /// The POST body for `/agent-nodes/:id/control` — the request slice of the
    /// frozen ControlCommand shape (the daemon mints `commandId`/`status`/
    /// `createdAt`; it is the single writer of runtime truth).
    pub fn build_control_body(
        &mut self,
        verb: &str,
        node_id: &str,
        argument: Option<&str>,
    ) -> Option<Value> {
        let kind = wire_kind(verb)?;
        let mut payload = json!({});
        if let Some(text) = argument {
            let field = if verb == "steer" { "message" } else { "reason" };
            payload[field] = json!(text);
        }
        Some(json!({
            "schema": "pd.agent-harbor.control-command.v0",
            "kind": kind,
            "payload": payload,
            "requestedBy": "pd-console:operator",
            "idempotencyKey": self.idempotency_key(verb, node_id),
        }))
    }

    /// Roster row blocks — one clickable NodeRow per node.
    fn roster_blocks(&self) -> Vec<Block> {
        let mut blocks = Vec::new();
        for (i, node) in self.nodes.iter().enumerate() {
            let (rank, cap) = node.effective_rank();
            let level = format!("C{rank}");
            let badge = if cap.is_some() {
                format!("{} (unwitnessed)", level_name(&level))
            } else {
                level_name(&level).to_string()
            };
            let live = node.is_live();
            let tone = if live {
                Tone::Engaged
            } else if node.status == "blocked" {
                Tone::Gated
            } else if node.is_historical() {
                Tone::Resting
            } else if node.status == "stale" {
                Tone::Conflicted
            } else {
                Tone::Default
            };
            let mut meta_parts: Vec<String> = Vec::new();
            if !node.provider.is_empty() {
                meta_parts.push(node.provider.clone());
            }
            if !node.model_tier.is_empty() {
                meta_parts.push(node.model_tier.clone());
            }
            meta_parts.push(node.status.clone());
            blocks.push(Block::NodeRow {
                index: i,
                selected: i == self.selected,
                live,
                flag: flag_for_state(if live { "engaged" } else { node.status.as_str() }).letter(),
                name: node.display_name.clone(),
                badge,
                badge_tone: if cap.is_some() { Tone::Gated } else { Tone::Accent },
                meta: meta_parts.join(" · "),
                age: if node.last_event_at.is_empty() { "—".into() } else { node.last_event_at.clone() },
                tone,
            });
        }
        blocks
    }

    /// Detail blocks for the selected node: facts, transcript (live tail
    /// visually distinct from historical replay), files touched, control row.
    fn detail_blocks(&self, node: &NodeRowData) -> Vec<Block> {
        let mut blocks = Vec::new();
        let live = node.is_live();

        // ── facts line (mock: body/tier/worktree/context/cost) ──
        blocks.push(Block::Header(format!(
            "{} — {}",
            node.display_name,
            if live {
                "● live"
            } else if node.is_historical() {
                "historical"
            } else {
                node.status.as_str()
            }
        )));
        let (rank, cap_reason) = node.effective_rank();
        blocks.push(Block::KeyVal(
            "compliance".into(),
            format!(
                "C{rank} {}{} · fidelity {}{}",
                level_name(&format!("C{rank}")),
                cap_reason.as_deref().map(|r| format!(" — {r}")).unwrap_or_default(),
                if node.transcript_fidelity.is_empty() { "—" } else { node.transcript_fidelity.as_str() },
                if node.official_mode.is_empty() || node.official_mode == "official" {
                    String::new()
                } else {
                    format!(" · mode {}", node.official_mode)
                },
            ),
        ));
        blocks.push(Block::KeyVal(
            "body".into(),
            format!(
                "{} · tier {} · model {}",
                if node.provider.is_empty() { "—" } else { node.provider.as_str() },
                if node.model_tier.is_empty() { "—" } else { node.model_tier.as_str() },
                if node.model_name.is_empty() { "—" } else { node.model_name.as_str() },
            ),
        ));
        if !node.worktree.is_empty() {
            blocks.push(Block::KeyVal(
                "worktree".into(),
                format!(
                    "{}{}",
                    node.worktree,
                    if node.branch.is_empty() { String::new() } else { format!(" @ {}", node.branch) }
                ),
            ));
        }
        blocks.push(Block::KeyVal("cost".into(), self.cost.display()));
        if let Some(action) = &self.cost.budget_action {
            blocks.push(Block::Chip {
                label: format!("budget: {action}"),
                tone: Tone::Gated,
            });
        }

        // ── transcript ──
        if self.transcript.is_empty() && self.live_tail.is_empty() {
            blocks.push(Block::Header("transcript — unavailable".into()));
            blocks.push(Block::WrappedText {
                text: transcript_absence_cause(node, self.transcript_error.as_deref()),
                tone: Tone::Gated,
            });
        } else {
            // A refresh failure after a prior success must stay visible: render
            // the error banner above the last-known data instead of silently
            // presenting stale rows as current (honest-state acceptance gate).
            if let Some(err) = &self.transcript_error {
                blocks.push(Block::WrappedText {
                    text: format!("transcript refresh failed — showing last-known data: {err}"),
                    tone: Tone::Gated,
                });
            }
            if !self.transcript.is_empty() {
                blocks.push(Block::Header("historical transcript — replay".into()));
                for row in &self.transcript {
                    blocks.push(self.transcript_block(row));
                }
            }
            if !self.live_tail.is_empty() {
                blocks.push(Block::Header("● live — events arriving".into()));
                for row in &self.live_tail {
                    blocks.push(self.transcript_block(row));
                }
            }
        }

        // ── files touched ──
        if !self.files.is_empty() {
            blocks.push(Block::Header("files touched".into()));
            for f in &self.files {
                blocks.push(Block::ArtifactRef {
                    label: if f.stats.is_empty() {
                        f.op.clone()
                    } else {
                        format!("{} {}", f.op, f.stats)
                    },
                    path: f.absolute.clone(),
                    preview: Some(f.display.clone()),
                    tone: if f.op == "write" { Tone::Engaged } else { Tone::Default },
                });
            }
        }

        // ── recent control history (rendered into the timeline) ──
        if let Some(err) = &self.control_error {
            blocks.push(Block::WrappedText {
                text: format!("control history unavailable: {err}"),
                tone: Tone::Gated,
            });
        }
        for c in self.controls.iter().take(5) {
            let mut label = format!("{} → {}", c.kind, c.status);
            if !c.denial_reason.is_empty() {
                label.push_str(&format!(" ({})", c.denial_reason));
            }
            blocks.push(Block::Chip { label, tone: c.tone() });
        }
        if let Some((verb, msg)) = &self.last_control {
            blocks.push(Block::WrappedText {
                text: format!("{verb}: {msg}"),
                tone: Tone::Landed,
            });
        }

        // ── click controls, compliance-gated at emit time ──
        for (verb, _, _) in CONTROL_VERBS.iter() {
            let gate = control_gate(verb, node);
            blocks.push(Block::ControlButton {
                verb: (*verb).into(),
                label: {
                    let mut c = verb.chars();
                    match c.next() {
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                        None => String::new(),
                    }
                },
                enabled: gate.is_ok(),
                why_disabled: gate.err(),
                primary: *verb == "steer",
            });
        }
        blocks
    }

    fn transcript_block(&self, row: &TranscriptRow) -> Block {
        let stamp = if row.occurred_at.is_empty() {
            String::new()
        } else {
            format!("{} ", row.occurred_at)
        };
        match row.speaker.as_str() {
            "operator" | "agent" => Block::ChatTurn {
                speaker: row.speaker.clone(),
                text: format!(
                    "{}{}{}",
                    stamp,
                    row.text,
                    if row.blob_refs > 0 { format!(" [{} blob(s)]", row.blob_refs) } else { String::new() }
                ),
                tone: row.tone,
            },
            _ => Block::TranscriptLine {
                text: format!(
                    "{}{} · {}{}",
                    stamp,
                    row.kind,
                    trunc(&row.text, 160),
                    if row.blob_refs > 0 { format!(" [{} blob(s)]", row.blob_refs) } else { String::new() }
                ),
                tone: row.tone,
            },
        }
    }

    /// Apply a fetched roster payload (tolerant: bare array, `{nodes}`, or
    /// `{agentNodes}`), keeping the selection pinned to the same node id.
    pub fn apply_roster(&mut self, data: &Value) {
        let list: &[Value] = match data {
            Value::Array(a) => a.as_slice(),
            _ => {
                let nodes = arr(data, "nodes");
                if nodes.is_empty() { arr(data, "agentNodes") } else { nodes }
            }
        };
        let previously = self.selected_node().map(|n| n.agent_node_id.clone());
        self.nodes = list.iter().map(NodeRowData::from_value).collect();
        if let Some(prev) = previously {
            if let Some(pos) = self.nodes.iter().position(|n| n.agent_node_id == prev) {
                self.selected = pos;
                return;
            }
        }
        self.selected = self.selected.min(self.nodes.len().saturating_sub(1));
    }

    /// Apply a fetched `GET /blackboard` envelope (tolerant: bare array or
    /// `{data, droppedInvalid, projection}`).
    pub fn apply_blackboard(&mut self, data: &Value) {
        let list: Vec<Value> = match data {
            Value::Array(a) => a.clone(),
            _ => arr(data, "data").to_vec(),
        };
        self.blackboard = list.iter().map(BlackboardCard::from_value).collect();
        self.blackboard_dropped = data
            .get("droppedInvalid")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        self.blackboard_error = None;
    }

    /// The read-only blackboard section (M6). Never blank: error, empty, and
    /// populated states all render honestly. Cards are lenses, not chat —
    /// each shows its kind, severity tone, citation count (the zoom path),
    /// and read-model status.
    fn blackboard_blocks(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Blackboard — read-only (M6)".into())];
        if let Some(err) = &self.blackboard_error {
            blocks.push(Block::WrappedText {
                text: format!("blackboard unavailable: {err}"),
                tone: Tone::Gated,
            });
            return blocks;
        }
        if self.blackboard.is_empty() {
            blocks.push(Block::WrappedText {
                text: "board is clear — no active claims, conflicts, or recent \
                       compaction/receipt events"
                    .into(),
                tone: Tone::Resting,
            });
            return blocks;
        }
        if self.blackboard_dropped > 0 {
            blocks.push(Block::WrappedText {
                text: format!(
                    "{} asserted item(s) failed contract validation and were dropped \
                     by the daemon — inspect the asserting Longshoreman",
                    self.blackboard_dropped
                ),
                tone: Tone::Conflicted,
            });
        }
        for card in self.blackboard.iter().take(12) {
            let status = if card.status == "active" {
                String::new()
            } else {
                format!(" [{}]", card.status)
            };
            let stale = if card.stale { " [stale]" } else { "" };
            let stamp = if card.posted_at.is_empty() {
                String::new()
            } else {
                format!("{} · ", card.posted_at)
            };
            blocks.push(Block::TranscriptLine {
                text: format!(
                    "{}{} · {}{}{} · {} citation(s) · via {}",
                    stamp,
                    card.kind,
                    trunc(&card.title, 100),
                    status,
                    stale,
                    card.citations,
                    if card.asserted_by.is_empty() { "?" } else { card.asserted_by.as_str() },
                ),
                tone: card.tone(),
            });
            // Conflicts and worse get their detail rendered inline — stakes-
            // proportional visibility (a warning the operator must scroll for
            // is a warning missed); info housekeeping stays one line.
            if matches!(card.severity.as_str(), "warning" | "high" | "critical")
                && !card.detail.is_empty()
            {
                blocks.push(Block::WrappedText {
                    text: trunc(&card.detail, 240),
                    tone: card.tone(),
                });
            }
        }
        if self.blackboard.len() > 12 {
            blocks.push(Block::WrappedText {
                text: format!("… {} more card(s) on the board", self.blackboard.len() - 12),
                tone: Tone::Resting,
            });
        }
        blocks
    }

    /// Apply fetched transcript events (tolerant: bare array or `{events}`).
    pub fn apply_events(&mut self, data: &Value) {
        let list: Vec<Value> = match data {
            Value::Array(a) => a.clone(),
            _ => arr(data, "events").to_vec(),
        };
        let mut rows: Vec<TranscriptRow> =
            list.iter().map(|e| TranscriptRow::from_value(e, false)).collect();
        rows.sort_by_key(|r| r.sequence);
        let worktree = self.selected_node().map(|n| n.worktree.clone()).unwrap_or_default();
        self.files = fold_file_touches(&list, &worktree);
        self.cost = CostSummary::fold(&list);
        self.transcript = rows;
        self.transcript_error = None;
    }
}

impl Pane for HarborPane {
    fn id(&self) -> &str {
        "harbor"
    }

    fn title(&self) -> String {
        "Harbor".into()
    }

    fn view(&self) -> Vec<Block> {
        // Never blank: every branch below renders at least a header plus an
        // honest state (error / empty / populated).
        let mut blocks = vec![Block::Header("Agent Nodes — Harbor".into())];

        if let Some(err) = &self.roster_error {
            blocks.push(Block::WrappedText {
                text: format!(
                    "roster unavailable: {err}\nThe console renders daemon truth only — \
                     no fabricated rows (ADR-0095 §3)."
                ),
                tone: Tone::Conflicted,
            });
            return blocks;
        }
        if self.nodes.is_empty() {
            blocks.push(Block::WrappedText {
                text: "no Agent Nodes registered — describe work (`pd work`) or launch a \
                       body to see it here"
                    .into(),
                tone: Tone::Resting,
            });
            // The blackboard is harbor-wide, not per-node: contested files and
            // live claims can exist before any Agent Node registers, so the
            // board renders even over an empty roster.
            blocks.push(Block::Gap);
            blocks.extend(self.blackboard_blocks());
            return blocks;
        }

        blocks.extend(self.roster_blocks());
        blocks.push(Block::Gap);
        blocks.extend(self.blackboard_blocks());
        blocks.push(Block::Gap);
        if let Some(node) = self.selected_node() {
            let node = node.clone();
            blocks.extend(self.detail_blocks(&node));
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // 1. Roster: GET /agent-nodes (F0 registry route, binder ch09).
            let url = format!("{}/agent-nodes", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.roster_error = Some(format!("daemon unreachable: {e}"));
                    return Ok(());
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.as_u16() == 404 {
                        self.roster_error = Some(
                            "GET /agent-nodes → 404 — this daemon predates the Agent Harbor \
                             ledger (work order C1). Remediation: upgrade the daemon \
                             (`pd doctor`), or this pane stays honestly empty"
                                .into(),
                        );
                        return Ok(());
                    }
                    if !status.is_success() {
                        self.roster_error = Some(format!("GET /agent-nodes → {status}"));
                        return Ok(());
                    }
                    match resp.json::<Value>().await {
                        Err(e) => {
                            self.roster_error = Some(format!("bad roster response: {e}"));
                            return Ok(());
                        }
                        Ok(data) => {
                            self.roster_error = None;
                            self.apply_roster(&data);
                        }
                    }
                }
            }

            // 1.5. Blackboard: GET /blackboard (M6 read-only board, binder
            //      ch05; ADR-0097 §5). Harbor-wide — fetched regardless of
            //      node selection, GET only (writes are M8).
            let url = format!("{}/blackboard?limit=50", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.blackboard_error = Some(format!("daemon unreachable: {e}"));
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.as_u16() == 404 {
                        self.blackboard_error = Some(
                            "GET /blackboard → 404 — this daemon predates the M6 \
                             read-only blackboard (ADR-0097 phase 4). Upgrade the \
                             daemon to see the board."
                                .into(),
                        );
                    } else if !status.is_success() {
                        self.blackboard_error = Some(format!("GET /blackboard → {status}"));
                    } else {
                        match resp.json::<Value>().await {
                            Err(e) => {
                                self.blackboard_error =
                                    Some(format!("bad blackboard response: {e}"));
                            }
                            Ok(data) => self.apply_blackboard(&data),
                        }
                    }
                }
            }

            let Some(node) = self.selected_node().cloned() else {
                return Ok(());
            };

            // 2. Historical transcript for the selected node's session.
            if let Some(session_id) = &node.session_id {
                let url = format!("{}/sessions/{}/events?limit=200", daemon.base(), session_id);
                match daemon.http_client().get(&url).send().await {
                    Err(e) => {
                        self.transcript_error =
                            Some(format!("GET /sessions/{session_id}/events failed: {e}"));
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        if status.as_u16() == 404 {
                            self.transcript_error = Some(format!(
                                "GET /sessions/{session_id}/events → 404 — the transcript \
                                 ledger route is missing on this daemon (work order C1). \
                                 Remediation: upgrade the daemon (`pd doctor`)"
                            ));
                        } else if !status.is_success() {
                            self.transcript_error =
                                Some(format!("GET /sessions/{session_id}/events → {status}"));
                        } else {
                            match resp.json::<Value>().await {
                                Err(e) => {
                                    self.transcript_error =
                                        Some(format!("bad events response: {e}"));
                                }
                                Ok(data) => self.apply_events(&data),
                            }
                        }
                    }
                }
            } else {
                self.transcript.clear();
                self.files.clear();
                self.cost = CostSummary::default();
                self.transcript_error = None;
            }

            // 3. Control history: GET /agent-nodes/:id/control (queued controls
            //    are separate records that render into the timeline).
            let url = format!("{}/agent-nodes/{}/control", daemon.base(), node.agent_node_id);
            match daemon.http_client().get(&url).send().await {
                Err(e) => self.control_error = Some(e.to_string()),
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        self.control_error = Some(format!("GET …/control → {status}"));
                    } else {
                        match resp.json::<Value>().await {
                            Err(e) => self.control_error = Some(format!("bad response: {e}")),
                            Ok(data) => {
                                self.control_error = None;
                                let list: Vec<Value> = match &data {
                                    Value::Array(a) => a.clone(),
                                    other => arr(other, "commands").to_vec(),
                                };
                                self.controls =
                                    list.iter().map(ControlRow::from_value).collect();
                            }
                        }
                    }
                }
            }
            Ok(())
        })
    }

    fn mutate<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            match action {
                SurfaceAction::SelectRow { index } => {
                    if index < self.nodes.len() && index != self.selected {
                        self.selected = index;
                        // Detail state belongs to the previous node; drop it so
                        // stale detail is never shown under a new header. The
                        // next refresh repopulates from daemon truth.
                        self.transcript.clear();
                        self.live_tail.clear();
                        self.files.clear();
                        self.cost = CostSummary::default();
                        self.controls.clear();
                        self.transcript_error = None;
                        self.control_error = None;
                        self.last_control = None;
                    }
                    Ok(())
                }
                SurfaceAction::Control { verb, argument } => {
                    let node = self
                        .selected_node()
                        .cloned()
                        .ok_or_else(|| anyhow!("no node selected"))?;
                    // Projection-side gate — the daemon re-authorizes from
                    // authoritative state on receipt; this stops obviously
                    // unauthorized clicks with the exact reason.
                    if let Err(why) = control_gate(&verb, &node) {
                        return Err(anyhow!("{verb} not available: {why}"));
                    }
                    let body = self
                        .build_control_body(&verb, &node.agent_node_id, argument.as_deref())
                        .ok_or_else(|| anyhow!("unknown control verb '{verb}'"))?;
                    let url = format!(
                        "{}/agent-nodes/{}/control",
                        daemon.base(),
                        node.agent_node_id
                    );
                    let resp = daemon
                        .http_client()
                        .post(&url)
                        .json(&body)
                        .send()
                        .await
                        .map_err(|e| anyhow!("POST …/control failed: {e}"))?;
                    let status = resp.status();
                    if !status.is_success() {
                        let text = resp.text().await.unwrap_or_default();
                        return Err(anyhow!(
                            "{verb} refused by daemon ({status}): {}",
                            if text.is_empty() { "no detail".into() } else { text }
                        ));
                    }
                    let outcome: Value = resp.json().await.unwrap_or(Value::Null);
                    let queued_status = s(&outcome, "status");
                    self.last_control = Some((
                        verb,
                        if queued_status.is_empty() {
                            "queued — watch for the acknowledgement event".into()
                        } else {
                            format!("{queued_status} — watch for the acknowledgement event")
                        },
                    ));
                    Ok(())
                }
                _ => Ok(()),
            }
        })
    }

    fn subscription(&self) -> Option<Subscription> {
        // Live-follow the selected node only while it is daemon-proved live.
        let node = self.selected_node()?;
        if node.is_live() {
            Some(Subscription::Agent {
                agent_id: node.agent_node_id.clone(),
            })
        } else {
            None
        }
    }

    fn on_stream(&mut self, env: &StreamEnvelope) {
        // Fold live frames into the tail — kept apart from the historical
        // replay so the two render visually distinct.
        let text = crate::agent::body_text(&env.body);
        if text.trim().is_empty() {
            return;
        }
        let kind = match &env.kind {
            StreamKind::Transcript => "assistant_delta",
            StreamKind::Tube => "operator_message",
            StreamKind::Status => "heartbeat",
            StreamKind::Other(k) => k.as_str(),
        };
        let (speaker, tone) = kind_meta(kind);
        self.live_tail.push(TranscriptRow {
            sequence: self.transcript.len() as u64 + self.live_tail.len() as u64 + 1,
            occurred_at: String::new(),
            kind: kind.to_string(),
            speaker: speaker.into(),
            text,
            tone,
            redaction_state: String::new(),
            blob_refs: 0,
            live: true,
        });
        // Bound the tail: the historical fetch is the durable record.
        if self.live_tail.len() > 200 {
            let excess = self.live_tail.len() - 200;
            self.live_tail.drain(..excess);
        }
    }
}

// ── Tests — fixture-driven against the frozen F0 shapes ──────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Load a frozen F0 fixture from schemas/agent-harbor/v0/fixtures/ — the
    /// exact shapes the contract freeze shipped (ADR-0095). Parsing these
    /// proves the pane reads the canonical field names, not a ch03 variant.
    fn fixture(name: &str) -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schemas/agent-harbor/v0/fixtures")
            .join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("fixture {} unreadable: {e}", path.display()));
        serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("fixture {} is not JSON: {e}", path.display()))
    }

    fn c4_node() -> NodeRowData {
        NodeRowData {
            agent_node_id: "an-1".into(),
            display_name: "Cartographer".into(),
            identity: "port-daddy:cartographer:main".into(),
            class: "voyager".into(),
            authority: "local".into(),
            status: "active".into(),
            compliance_level: "C4".into(),
            compliance_probe_id: Some("probe-1".into()),
            witnessed_level: Some("C4".into()),
            transcript_fidelity: "T4".into(),
            official_mode: "official".into(),
            session_id: Some("sess-1".into()),
            body_id: Some("body-1".into()),
            run_id: Some("run-1".into()),
            worktree: "/Users/op/coding/port-daddy".into(),
            branch: "main".into(),
            provider: "anthropic".into(),
            model_tier: "mid".into(),
            model_name: "claude-sonnet".into(),
            last_heartbeat_at: "2026-07-05T00:00:00Z".into(),
            last_event_at: "2026-07-05T00:00:01Z".into(),
        }
    }

    // ── F0 shape consumption ──

    #[test]
    fn parses_the_frozen_agent_node_fixture() {
        let v = fixture("agent-node.json");
        let node = NodeRowData::from_value(&v);
        // Canonical names only — agentNodeId, never the superseded ch03 agentId.
        assert!(!node.agent_node_id.is_empty(), "agentNodeId must parse");
        assert!(!node.identity.is_empty());
        assert!(!node.compliance_level.is_empty());
        assert!(!node.status.is_empty());
    }

    #[test]
    fn parses_the_frozen_transcript_event_fixture() {
        let v = fixture("transcript-event.json");
        let row = TranscriptRow::from_value(&v, false);
        assert!(!row.kind.is_empty(), "kind must parse");
        // The canonical payloadBlobRefs name (fork resolution 1), not blobRefs.
        assert_eq!(row.blob_refs, arr(&v, "payloadBlobRefs").len());
    }

    #[test]
    fn parses_the_frozen_control_command_fixture() {
        let v = fixture("control-command.json");
        let row = ControlRow::from_value(&v);
        assert!(!row.kind.is_empty());
        assert!(!row.status.is_empty());
    }

    #[test]
    fn folds_the_frozen_cost_accrual_fixture_from_the_transcript_family() {
        let cost_payload = fixture("cost-accrual-event.json");
        let events = vec![json!({
            "eventId": "ev-cost-1",
            "sessionId": "sess-1",
            "agentNodeId": "an-1",
            "sequence": 9,
            "occurredAt": "2026-07-05T00:00:09Z",
            "schemaVersion": 1,
            "kind": "cost_accrued",
            "payloadJson": cost_payload,
        })];
        let cost = CostSummary::fold(&events);
        assert_eq!(cost.events, 1);
        // Unknown values stay None — never guessed.
        if cost_payload.get("actualCostUsd").and_then(Value::as_f64).is_none() {
            assert!(cost.actual_usd.is_none(), "absent actual cost must stay None");
        }
    }

    #[test]
    fn compliance_probe_fixture_witnessed_level_caps_the_claimed_level() {
        let probe = fixture("compliance-probe-result.json");
        let witnessed = probe.get("witnessedLevel").and_then(Value::as_str).unwrap();
        let mut node = c4_node();
        node.compliance_level = "C6".into();
        node.witnessed_level = Some(witnessed.to_string());
        let (rank, reason) = node.effective_rank();
        if level_rank(witnessed) < 6 {
            assert_eq!(rank, level_rank(witnessed));
            assert!(reason.unwrap().contains("witnessed"));
        }
    }

    // ── the witnessing invariant (ADR-0095 §8) ──

    #[test]
    fn self_reported_level_without_probe_gates_as_c0() {
        let mut node = c4_node();
        node.compliance_probe_id = None; // C4 claimed, nothing backs it
        let (rank, reason) = node.effective_rank();
        assert_eq!(rank, 0, "unbacked level is self-report and invalid");
        assert!(reason.unwrap().contains("self-reported"));
        // And every control gate closes with that exact cause.
        let err = control_gate("pause", &node).unwrap_err();
        assert!(err.contains("self-reported"), "why-disabled must name the cause: {err}");
    }

    // ── per-verb compliance gating (C3 acceptance gate) ──

    #[test]
    fn c4_controllable_enables_pause_interrupt_checkpoint_retire_but_not_successor() {
        let node = c4_node();
        for verb in ["steer", "pause", "interrupt", "checkpoint", "retire"] {
            assert!(control_gate(verb, &node).is_ok(), "{verb} should be enabled at C4");
        }
        let err = control_gate("successor", &node).unwrap_err();
        assert!(err.contains("C6"), "successor requires C6 Resumable: {err}");
    }

    #[test]
    fn c3_suggestible_enables_steer_only() {
        let mut node = c4_node();
        node.compliance_level = "C3".into();
        node.witnessed_level = Some("C3".into());
        assert!(control_gate("steer", &node).is_ok());
        for verb in ["pause", "interrupt", "checkpoint", "retire", "successor"] {
            let err = control_gate(verb, &node).unwrap_err();
            assert!(err.contains("requires"), "{verb} must be gated with the level named: {err}");
        }
    }

    #[test]
    fn observed_bodies_receive_no_controls() {
        let mut node = c4_node();
        node.authority = "observed".into();
        for (verb, _, _) in CONTROL_VERBS.iter() {
            let err = control_gate(verb, &node).unwrap_err();
            assert!(err.contains("observed"), "{verb}: {err}");
        }
    }

    #[test]
    fn stale_projection_never_authorizes() {
        let mut node = c4_node();
        node.status = "stale".into();
        let err = control_gate("interrupt", &node).unwrap_err();
        assert!(err.contains("stale"), "{err}");
        assert!(err.contains("ADR-0095"), "the reason cites the rule: {err}");
    }

    #[test]
    fn complete_run_blocks_live_verbs_but_allows_retire() {
        let mut node = c4_node();
        node.status = "complete".into();
        node.compliance_level = "C6".into();
        node.witnessed_level = Some("C6".into());
        for verb in ["steer", "pause", "interrupt", "checkpoint"] {
            assert!(control_gate(verb, &node).is_err(), "{verb} needs a live body");
        }
        assert!(control_gate("retire", &node).is_ok());
        assert!(control_gate("successor", &node).is_ok(), "successor from a sealed run is the C6 path");
    }

    // ── missing transcript shows exact cause ──

    #[test]
    fn missing_transcript_causes_are_exact_per_branch() {
        let mut node = c4_node();

        node.session_id = None;
        let cause = transcript_absence_cause(&node, None);
        assert!(cause.contains("no session bound"), "{cause}");
        assert!(cause.contains("Remediation"), "{cause}");

        node.session_id = Some("sess-1".into());
        node.official_mode = "observed".into();
        let cause = transcript_absence_cause(&node, None);
        assert!(cause.contains("observed import"), "{cause}");

        node.official_mode = "official".into();
        node.compliance_level = "C0".into();
        let cause = transcript_absence_cause(&node, None);
        assert!(cause.contains("C1 Transcripted"), "{cause}");

        let cause = transcript_absence_cause(&c4_node(), Some("GET /sessions/sess-1/events → 404 — ledger route missing"));
        assert!(cause.contains("404"), "fetch errors pass through verbatim: {cause}");
    }

    #[test]
    fn view_renders_the_exact_cause_not_an_empty_stream() {
        let mut pane = HarborPane::new();
        let mut node = c4_node();
        node.session_id = None;
        pane.nodes = vec![node];
        let blocks = pane.view();
        let has_cause = blocks.iter().any(|b| {
            matches!(b, Block::WrappedText { text, .. } if text.contains("no session bound"))
        });
        assert!(has_cause, "missing transcript must render its exact cause");
    }

    // ── active vs historical visually distinct ──

    #[test]
    fn live_and_historical_rows_carry_distinct_markers() {
        let mut pane = HarborPane::new();
        let live = c4_node();
        let mut done = c4_node();
        done.agent_node_id = "an-2".into();
        done.display_name = "QA".into();
        done.status = "complete".into();
        done.body_id = None;
        pane.nodes = vec![live, done];
        let blocks = pane.view();
        let rows: Vec<_> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::NodeRow { live, tone, .. } => Some((*live, *tone)),
                _ => None,
            })
            .collect();
        assert_eq!(rows.len(), 2);
        assert!(rows[0].0, "active node renders live");
        assert!(!rows[1].0, "complete node renders historical");
        assert_ne!(rows[0].1, rows[1].1, "live and historical must differ in tone");
    }

    #[test]
    fn live_tail_renders_under_a_live_header_distinct_from_replay() {
        let mut pane = HarborPane::new();
        pane.nodes = vec![c4_node()];
        pane.apply_events(&json!({ "events": [{
            "eventId": "ev-1", "sessionId": "sess-1", "agentNodeId": "an-1",
            "sequence": 1, "occurredAt": "2026-07-05T00:00:00Z", "schemaVersion": 1,
            "kind": "assistant_message", "payloadJson": { "text": "replay row" }
        }]}));
        pane.on_stream(&StreamEnvelope {
            v: 1,
            kind: StreamKind::Transcript,
            agent_id: "an-1".into(),
            body: json!({ "text": "live row" }),
            ts: 0,
        });
        let blocks = pane.view();
        let headers: Vec<&str> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Header(t) => Some(t.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            headers.iter().any(|h| h.contains("historical transcript")),
            "replay section labeled: {headers:?}"
        );
        assert!(
            headers.iter().any(|h| h.contains("live — events arriving")),
            "live section labeled: {headers:?}"
        );
    }

    #[test]
    fn session_row_alone_is_never_live() {
        // ADR-0095 §3: "LIVE" requires a heartbeat or transcript events,
        // never a session row alone.
        let mut node = c4_node();
        node.body_id = None;
        node.last_heartbeat_at = String::new();
        node.last_event_at = String::new();
        assert!(node.session_id.is_some() && node.status == "active");
        assert!(!node.is_live(), "active + session-only must not render LIVE");
        node.last_heartbeat_at = "2026-07-05T00:00:00Z".into();
        assert!(node.is_live(), "a heartbeat is daemon-proved liveness evidence");
    }

    #[test]
    fn transcript_fetch_error_stays_visible_over_last_known_data() {
        // A refresh failure after a prior success must not silently present
        // stale rows as current (honest-state acceptance gate).
        let mut pane = HarborPane::new();
        pane.nodes = vec![c4_node()];
        pane.apply_events(&json!({ "events": [{
            "eventId": "ev-1", "sessionId": "sess-1", "agentNodeId": "an-1",
            "sequence": 1, "occurredAt": "2026-07-05T00:00:00Z", "schemaVersion": 1,
            "kind": "assistant_message", "payloadJson": { "text": "old row" }
        }]}));
        pane.transcript_error = Some("GET /sessions/sess-1/events → 502".into());
        let blocks = pane.view();
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::WrappedText { text, tone: Tone::Gated }
                    if text.contains("transcript refresh failed")
                        && text.contains("502")
            )),
            "stale-data error banner must render above last-known transcript"
        );
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::Header(t) if t.contains("historical transcript")
            )),
            "last-known transcript still renders under its replay header"
        );
    }

    // ── files touched: absolute path resolution ──

    #[test]
    fn file_touches_resolve_relative_paths_against_the_worktree() {
        let events = vec![
            json!({
                "eventId": "ev-2", "sessionId": "sess-1", "agentNodeId": "an-1",
                "sequence": 2, "occurredAt": "t", "schemaVersion": 1,
                "kind": "file_write",
                "payloadJson": { "path": "lib/symbol-index.ts", "additions": 118, "deletions": 6 }
            }),
            json!({
                "eventId": "ev-3", "sessionId": "sess-1", "agentNodeId": "an-1",
                "sequence": 3, "occurredAt": "t", "schemaVersion": 1,
                "kind": "file_read",
                "payloadJson": { "path": "/abs/elsewhere/feedback.ts" }
            }),
        ];
        let touches = fold_file_touches(&events, "/Users/op/coding/port-daddy");
        assert_eq!(touches.len(), 2);
        assert_eq!(touches[0].absolute, "/Users/op/coding/port-daddy/lib/symbol-index.ts");
        assert_eq!(touches[0].op, "write");
        assert_eq!(touches[0].stats, "+118 −6");
        assert_eq!(touches[1].absolute, "/abs/elsewhere/feedback.ts", "absolute stays as-is");
    }

    #[test]
    fn a_write_supersedes_a_read_for_the_same_file() {
        let mk = |kind: &str, seq: u64| {
            json!({
                "eventId": format!("ev-{seq}"), "sessionId": "s", "agentNodeId": "a",
                "sequence": seq, "occurredAt": "t", "schemaVersion": 1,
                "kind": kind, "payloadJson": { "path": "src/x.ts" }
            })
        };
        let touches = fold_file_touches(&[mk("file_read", 1), mk("file_write", 2)], "/wt");
        assert_eq!(touches.len(), 1);
        assert_eq!(touches[0].op, "write");
    }

    // ── click-first: selection & controls act on the selection, never an id ──

    #[test]
    fn select_row_changes_selection_and_drops_stale_detail() {
        let mut pane = HarborPane::new();
        let mut second = c4_node();
        second.agent_node_id = "an-2".into();
        pane.nodes = vec![c4_node(), second];
        pane.transcript = vec![TranscriptRow::from_value(
            &json!({ "eventId": "e", "sessionId": "s", "agentNodeId": "a", "sequence": 1,
                     "occurredAt": "t", "schemaVersion": 1, "kind": "assistant_message",
                     "payloadJson": {"text": "stale detail"} }),
            false,
        )];
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        block_on(pane.mutate(&daemon, SurfaceAction::SelectRow { index: 1 })).unwrap();
        assert_eq!(pane.selected, 1);
        assert!(pane.transcript.is_empty(), "stale detail must not survive a reselect");
    }

    #[test]
    fn roster_selection_is_pinned_by_node_id_across_refreshes() {
        let mut pane = HarborPane::new();
        pane.apply_roster(&json!({ "nodes": [
            { "schema": "pd.agent-harbor.agent-node.v0", "agentNodeId": "an-1", "identity": "i1",
              "class": "voyager", "authority": "local", "complianceLevel": "C0",
              "status": "active", "createdAt": "t" },
            { "schema": "pd.agent-harbor.agent-node.v0", "agentNodeId": "an-2", "identity": "i2",
              "class": "voyager", "authority": "local", "complianceLevel": "C0",
              "status": "active", "createdAt": "t" },
        ]}));
        pane.selected = 1;
        // Refresh reorders the roster; selection follows the node, not the index.
        pane.apply_roster(&json!({ "nodes": [
            { "schema": "pd.agent-harbor.agent-node.v0", "agentNodeId": "an-2", "identity": "i2",
              "class": "voyager", "authority": "local", "complianceLevel": "C0",
              "status": "active", "createdAt": "t" },
            { "schema": "pd.agent-harbor.agent-node.v0", "agentNodeId": "an-1", "identity": "i1",
              "class": "voyager", "authority": "local", "complianceLevel": "C0",
              "status": "active", "createdAt": "t" },
        ]}));
        assert_eq!(pane.selected_node().unwrap().agent_node_id, "an-2");
    }

    #[test]
    fn control_button_blocks_carry_gate_verdicts() {
        let mut pane = HarborPane::new();
        let mut node = c4_node(); // C4: successor must render disabled w/ reason
        node.compliance_level = "C4".into();
        pane.nodes = vec![node];
        let blocks = pane.view();
        let buttons: Vec<_> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::ControlButton { verb, enabled, why_disabled, .. } => {
                    Some((verb.clone(), *enabled, why_disabled.clone()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(buttons.len(), CONTROL_VERBS.len());
        let successor = buttons.iter().find(|(v, _, _)| v == "successor").unwrap();
        assert!(!successor.1, "successor disabled at C4");
        assert!(
            successor.2.as_deref().unwrap_or("").contains("C6"),
            "why-disabled names the missing level"
        );
        let steer = buttons.iter().find(|(v, _, _)| v == "steer").unwrap();
        assert!(steer.1, "steer enabled at C4");
        assert!(steer.2.is_none());
    }

    #[test]
    fn gated_control_mutate_fails_closed_with_the_reason_and_sends_nothing() {
        let mut pane = HarborPane::new();
        let mut node = c4_node();
        node.authority = "observed".into();
        pane.nodes = vec![node];
        // Unroutable daemon: if the gate leaked, the POST would error with a
        // connection failure instead of the gate's own message.
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        let err = block_on(pane.mutate(
            &daemon,
            SurfaceAction::Control { verb: "interrupt".into(), argument: None },
        ))
        .unwrap_err();
        assert!(err.to_string().contains("observed"), "gate reason surfaces: {err}");
    }

    #[test]
    fn control_body_matches_the_frozen_wire_shape() {
        let mut pane = HarborPane::new();
        let body = pane.build_control_body("steer", "an-1", Some("focus on routes")).unwrap();
        assert_eq!(body["schema"], "pd.agent-harbor.control-command.v0");
        assert_eq!(body["kind"], "steer");
        assert_eq!(body["payload"]["message"], "focus on routes");
        assert!(!body["requestedBy"].as_str().unwrap().is_empty());
        assert!(!body["idempotencyKey"].as_str().unwrap().is_empty());
        // successor rides the wire as the frozen `resume` kind.
        let body = pane.build_control_body("successor", "an-1", None).unwrap();
        assert_eq!(body["kind"], "resume");
        // idempotency keys are unique per issued command.
        let k1 = pane.build_control_body("pause", "an-1", None).unwrap()["idempotencyKey"].clone();
        let k2 = pane.build_control_body("pause", "an-1", None).unwrap()["idempotencyKey"].clone();
        assert_ne!(k1, k2);
    }

    // ── pane failure does not blank the app ──

    #[test]
    fn roster_error_renders_an_honest_error_state_never_an_empty_view() {
        let mut pane = HarborPane::new();
        pane.roster_error = Some("daemon unreachable: connection refused".into());
        let blocks = pane.view();
        assert!(!blocks.is_empty(), "an error state is still a rendered state");
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::WrappedText { text, .. } if text.contains("connection refused")
        )));
    }

    #[test]
    fn refresh_against_a_dead_daemon_records_the_error_and_returns_ok() {
        let mut pane = HarborPane::new();
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        // Must not propagate: one bad route never blanks the console.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            pane.refresh(&daemon).await.expect("refresh records, never propagates");
        });
        assert!(pane.roster_error.is_some());
        assert!(!pane.view().is_empty());
    }

    #[test]
    fn subscription_follows_only_a_live_selected_node() {
        let mut pane = HarborPane::new();
        pane.nodes = vec![c4_node()];
        assert!(matches!(
            pane.subscription(),
            Some(Subscription::Agent { agent_id }) if agent_id == "an-1"
        ));
        pane.nodes[0].status = "complete".into();
        assert!(pane.subscription().is_none(), "historical nodes are never live-followed");
    }

    // ── Blackboard read query (M6, read-only — binder ch05; ADR-0097 §5) ──

    #[test]
    fn parses_the_frozen_blackboard_item_fixture_with_canonical_names() {
        let v = fixture("blackboard-item.json");
        let card = BlackboardCard::from_value(&v);
        // Canonical M6 names — itemId/postedAt/assertedBy/detail, never the
        // superseded ch03 `body` (ADR-0097 drift lock).
        assert!(!card.item_id.is_empty(), "itemId must parse");
        assert!(!card.kind.is_empty());
        assert!(!card.title.is_empty());
        assert!(!card.posted_at.is_empty(), "postedAt must parse");
        assert!(!card.asserted_by.is_empty(), "assertedBy.kind must parse");
        // The frozen schema's citations minItems 1: the zoom path exists.
        assert!(card.citations >= 1, "a card without citations is a loose chat, not a board");
        assert!(!card.stale, "the fixture's projection is fresh");
    }

    #[test]
    fn severity_maps_to_tone_and_unknown_severity_never_alarms() {
        let mut card = BlackboardCard::default();
        card.severity = "critical".into();
        assert!(matches!(card.tone(), Tone::Alarm));
        card.severity = "high".into();
        assert!(matches!(card.tone(), Tone::Conflicted));
        card.severity = "warning".into();
        assert!(matches!(card.tone(), Tone::Gated));
        card.severity = "someFutureSeverity".into();
        assert!(matches!(card.tone(), Tone::Default), "unknown severity renders calm");
    }

    #[test]
    fn applies_a_blackboard_envelope_and_surfaces_dropped_assertions() {
        let mut pane = HarborPane::new();
        pane.apply_blackboard(&json!({
            "data": [fixture("blackboard-item.json")],
            "droppedInvalid": 2,
            "projection": { "name": "blackboard", "stale": false }
        }));
        assert_eq!(pane.blackboard.len(), 1);
        assert_eq!(pane.blackboard_dropped, 2);
        let blocks = pane.blackboard_blocks();
        // The dropped count is rendered — a bad asserter is visible.
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::WrappedText { text, .. } if text.contains("2 asserted item(s)")
        )));
        // The card itself renders with its citation count (the zoom path).
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::TranscriptLine { text, .. } if text.contains("citation(s)")
        )));
    }

    #[test]
    fn blackboard_renders_even_over_an_empty_roster_and_errors_are_honest() {
        let mut pane = HarborPane::new();
        // Empty roster, populated board: the board is harbor-wide.
        pane.apply_blackboard(&json!({ "data": [fixture("blackboard-item.json")] }));
        let blocks = pane.view();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Header(text) if text.contains("Blackboard — read-only")
        )));
        // A fetch failure is an honest rendered state, never a blank section.
        pane.blackboard_error = Some("GET /blackboard → 404".into());
        let blocks = pane.blackboard_blocks();
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::WrappedText { text, .. } if text.contains("blackboard unavailable")
        )));
    }

    /// Minimal block_on for the no-yield futures in these tests (gated mutate
    /// paths return before any IO).
    fn block_on<F: std::future::Future>(mut fut: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(_: *const ()) -> RawWaker {
            RawWaker::new(std::ptr::null(), &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);
        let mut fut = unsafe { std::pin::Pin::new_unchecked(&mut fut) };
        loop {
            if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
                return v;
            }
        }
    }
}
