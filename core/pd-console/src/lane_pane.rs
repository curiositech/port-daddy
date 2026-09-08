//! The live LANE — "watch + grab the wheel" for ONE running agent.
//!
//! This is the first *real-time* surface in pd-console. Every other pane polls
//! the daemon every 2s; the Lane instead opens the agent's SSE feed
//! (`GET /agents/:id/stream`, PR #404) and folds typed envelopes into a
//! scrolling view as they arrive:
//!
//!   • `agent.transcript` → streaming transcript lines + tool-call chips
//!     (▸ running → ✓ ok / ✗ failed)
//!   • `agent.status`     → the agent's lifecycle status
//!   • `agent.tube`       → steering-channel traffic, including the operator's own
//!                          `control.interrupt` reappearing — the closed loop
//!
//! And it can steer: `SurfaceAction::Interrupt` POSTs `/agents/:id/interrupt`.
//! The control message then comes BACK on the stream as an `agent.tube` frame, so
//! the operator sees their signal land.
//!
//! Which agent? `refresh()` (the 2s poll) picks the watch target: `PD_LANE_AGENT`
//! if set (deterministic for screenshot capture), else the most-recently-active
//! running agent from `GET /agents`. main.rs reads `subscription()` and opens the
//! stream; envelopes flow back through `on_stream`.

use crate::agent::{DaemonClient, StreamEnvelope, StreamKind};
use crate::pane::{Block, Pane, Subscription, SurfaceAction, Tone};
use crate::util;
use anyhow::Result;
use serde_json::Value;

/// How many transcript/tube lines to retain in the scrollback. Older lines drop
/// off the top — the Lane is a live tail, not an archive.
const SCROLLBACK: usize = 200;

/// One tool call surfaced from the transcript stream, with its live status.
#[derive(Debug, Clone)]
struct ToolCall {
    name: String,
    state: ToolState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolState {
    Running,
    Ok,
    Failed,
}

impl ToolState {
    fn chip(self, name: &str) -> (String, Tone) {
        match self {
            ToolState::Running => (format!("▸ {name}"), Tone::Engaged),
            ToolState::Ok => (format!("✓ {name}"), Tone::Landed),
            ToolState::Failed => (format!("✗ {name}"), Tone::Gated),
        }
    }
}

/// A line in the live scrollback, tagged by origin so the renderer can tone it.
#[derive(Debug, Clone)]
enum LaneLine {
    Transcript { role: ChatRole, text: String },
    Tube { sender: String, text: String },
    Hitl {
        agent_id: String,
        request_id: String,
        title: String,
        detail: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChatRole {
    Operator,
    Agent,
    Tool,
    System,
}

impl ChatRole {
    fn from_body(body: &Value) -> Self {
        let raw = string_field(body, &["role", "speaker", "sender", "author", "source"])
            .unwrap_or_default()
            .to_lowercase();
        match raw.as_str() {
            "operator" | "user" | "human" | "you" => ChatRole::Operator,
            "tool" | "tool-call" | "tool_call" | "function" => ChatRole::Tool,
            "system" | "status" | "daemon" => ChatRole::System,
            _ => ChatRole::Agent,
        }
    }

    fn label(self) -> &'static str {
        match self {
            ChatRole::Operator => "you",
            ChatRole::Agent => "agent",
            ChatRole::Tool => "tool",
            ChatRole::System => "system",
        }
    }

    fn tone(self) -> Tone {
        match self {
            ChatRole::Operator => Tone::Accent,
            ChatRole::Agent => Tone::Default,
            ChatRole::Tool => Tone::Engaged,
            ChatRole::System => Tone::Resting,
        }
    }

    fn mine(self) -> bool {
        self == ChatRole::Operator
    }
}

/// The live agent LANE surface.
pub struct LanePane {
    /// Operator-selected target from the Fleet roster. `None` means the lane
    /// auto-follows the newest active agent on each refresh.
    pinned_agent_id: Option<String>,
    /// The agent we're watching (chosen on refresh). `None` until one is found.
    agent_id: Option<String>,
    /// Last known lifecycle status from `agent.status` frames.
    status: String,
    /// Whether the live stream has delivered at least one frame (vs. just polled).
    streamed: bool,
    /// Scrollback of transcript + tube lines (most recent at the end).
    lines: Vec<LaneLine>,
    /// Tool calls seen on the stream, in arrival order (deduped by name+running).
    tools: Vec<ToolCall>,
    /// Last error from the 2s poll (daemon unreachable / no agents), if any.
    error: Option<String>,
}

impl LanePane {
    pub fn new() -> Self {
        Self {
            pinned_agent_id: None,
            agent_id: None,
            status: "—".into(),
            streamed: false,
            lines: Vec::new(),
            tools: Vec::new(),
            error: None,
        }
    }

    pub fn watch_agent(&mut self, agent_id: Option<String>) {
        self.pinned_agent_id = agent_id.clone();
        self.set_agent(agent_id);
    }

    fn set_agent(&mut self, agent_id: Option<String>) {
        if self.agent_id == agent_id {
            return;
        }
        self.agent_id = agent_id;
        self.streamed = false;
        self.lines.clear();
        self.tools.clear();
        self.status = "—".into();
    }

    /// Choose the agent to watch from a `GET /agents` body. `PD_LANE_AGENT` wins
    /// (deterministic capture); otherwise the most-recently-heartbeated active
    /// agent, falling back to the most-recently-heartbeated agent overall.
    fn pick_agent(v: &serde_json::Value) -> Option<String> {
        if let Ok(forced) = std::env::var("PD_LANE_AGENT") {
            if !forced.trim().is_empty() {
                return Some(forced);
            }
        }
        let agents = util::arr(v, "agents");
        let score = |a: &serde_json::Value| -> (i64, i64) {
            // Prefer active; within that, most recent heartbeat.
            let active = if util::b(a, "isActive") { 1 } else { 0 };
            (active, util::n(a, "lastHeartbeat"))
        };
        agents
            .iter()
            .filter(|a| !util::s(a, "id").is_empty())
            .max_by_key(|a| score(a))
            .map(|a| util::s(a, "id"))
    }

    fn push_line(&mut self, line: LaneLine) {
        self.lines.push(line);
        if self.lines.len() > SCROLLBACK {
            let overflow = self.lines.len() - SCROLLBACK;
            self.lines.drain(..overflow);
        }
    }

    /// Fold a transcript envelope. The body may carry streaming text and/or a
    /// tool-call delta. Shapes vary, so we extract tolerantly:
    ///   { text } | { delta } | { content }      → transcript text
    ///   { tool: { name, status } }               → tool-call chip
    ///   { tool, status }                         → tool-call chip (flat)
    fn fold_transcript(&mut self, agent_id: &str, body: &Value) {
        if let Some(card) = hitl_card_from_body(agent_id, self.agent_id.as_deref(), body, self.lines.len()) {
            self.push_line(card);
            return;
        }

        // Tool-call delta (nested or flat).
        let tool_obj = body.get("tool");
        let tool_name = tool_obj
            .and_then(|t| t.as_str().map(str::to_string))
            .or_else(|| tool_obj.and_then(|t| t.get("name")).and_then(|n| n.as_str()).map(str::to_string))
            .or_else(|| body.get("toolName").and_then(|n| n.as_str()).map(str::to_string));
        if let Some(name) = tool_name {
            let status = tool_obj
                .and_then(|t| t.get("status"))
                .or_else(|| body.get("status"))
                .or_else(|| body.get("toolStatus"))
                .and_then(|s| s.as_str())
                .unwrap_or("running");
            let state = match status {
                "ok" | "success" | "done" | "complete" | "completed" => ToolState::Ok,
                "error" | "failed" | "failure" => ToolState::Failed,
                _ => ToolState::Running,
            };
            self.note_tool(&name, state);
        }

        // Transcript text.
        let text = body
            .get("text")
            .or_else(|| body.get("delta"))
            .or_else(|| body.get("content"))
            .and_then(|t| t.as_str())
            .unwrap_or_default();
        if !text.is_empty() {
            self.push_line(LaneLine::Transcript {
                role: ChatRole::from_body(body),
                text: text.to_string(),
            });
        }
    }

    /// Record a tool-call status. A `Running` for a tool we already track and is
    /// still running is a no-op; a terminal status updates the existing entry.
    fn note_tool(&mut self, name: &str, state: ToolState) {
        if let Some(existing) = self
            .tools
            .iter_mut()
            .rev()
            .find(|t| t.name == name && t.state == ToolState::Running)
        {
            if state != ToolState::Running {
                existing.state = state;
            }
            return;
        }
        // Cap the tool chip list to keep the view bounded.
        if self.tools.len() >= 40 {
            self.tools.remove(0);
        }
        self.tools.push(ToolCall { name: name.to_string(), state });
    }
}

impl Default for LanePane {
    fn default() -> Self {
        Self::new()
    }
}

impl Pane for LanePane {
    fn id(&self) -> &str {
        "lane"
    }

    fn title(&self) -> String {
        "Lane".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut out = vec![Block::Header("Live Lane".into())];

        match &self.agent_id {
            Some(id) => out.push(Block::KeyVal("watching".into(), util::trunc(id, 48))),
            None => {
                out.push(Block::KeyVal(
                    "watching".into(),
                    "no running agent — waiting…".into(),
                ));
            }
        }

        if let Some(err) = &self.error {
            out.push(Block::KeyVal("error".into(), util::trunc(err, 60)));
        }

        // Status chip + live/poll indicator.
        out.push(Block::Chip {
            label: format!("status: {}", if self.status.is_empty() { "—" } else { &self.status }),
            tone: Tone::Accent,
        });
        out.push(Block::Chip {
            label: if self.streamed { "● live".into() } else { "○ connecting".into() },
            tone: if self.streamed { Tone::Landed } else { Tone::Resting },
        });

        // Tool-call chips (running → done/failed).
        if !self.tools.is_empty() {
            out.push(Block::Header("tools".into()));
            for t in self.tools.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
                let (label, tone) = t.state.chip(&t.name);
                out.push(Block::Chip { label, tone });
            }
        }

        // Live transcript / tube tail.
        out.push(Block::Header("stream".into()));
        if self.lines.is_empty() {
            out.push(Block::KeyVal("—".into(), "(no frames yet)".into()));
        } else {
            // Show the last ~24 lines (most recent at the bottom).
            let start = self.lines.len().saturating_sub(24);
            for line in &self.lines[start..] {
                match line {
                    LaneLine::Transcript { role, text } => out.push(Block::TranscriptBubble {
                        speaker: role.label().into(),
                        text: text.clone(),
                        tone: role.tone(),
                        mine: role.mine(),
                    }),
                    LaneLine::Tube { sender, text } => {
                        let role = if sender.eq_ignore_ascii_case("operator")
                            || text.starts_with("control.")
                            || text.starts_with("hitl.")
                        {
                            ChatRole::Operator
                        } else {
                            ChatRole::System
                        };
                        out.push(Block::TranscriptBubble {
                            speaker: if sender.is_empty() { role.label().into() } else { sender.clone() },
                            text: text.clone(),
                            tone: role.tone(),
                            mine: role.mine(),
                        })
                    }
                    LaneLine::Hitl { agent_id, request_id, title, detail } => {
                        out.push(Block::HitlCard {
                            agent_id: agent_id.clone(),
                            request_id: request_id.clone(),
                            title: title.clone(),
                            detail: detail.clone(),
                            tone: Tone::Gated,
                        })
                    }
                }
            }
        }

        out
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // The 2s poll's only job here is choosing/refreshing the watch target.
            // The live content arrives via on_stream, not this poll.
            let url = format!("{}/agents", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Ok(resp) => match resp.json::<serde_json::Value>().await {
                    Ok(v) => {
                        self.error = None;
                        let target = self
                            .pinned_agent_id
                            .clone()
                            .or_else(|| Self::pick_agent(&v));
                        if let Some(id) = target {
                            // If the target changed, reset the live view for the new agent.
                            self.set_agent(Some(id));
                        }
                    }
                    Err(e) => self.error = Some(format!("decode /agents: {e}")),
                },
                Err(e) => self.error = Some(format!("GET /agents: {e}")),
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
                SurfaceAction::Interrupt { reason } => {
                    let Some(id) = self.agent_id.clone() else {
                        return Err(anyhow::anyhow!("no agent to interrupt"));
                    };
                    daemon.interrupt(&id, reason.as_deref()).await?;
                    Ok(())
                }
            }
        })
    }

    fn subscription(&self) -> Option<Subscription> {
        self.agent_id.clone().map(|agent_id| Subscription::Agent { agent_id })
    }

    fn on_stream(&mut self, env: &StreamEnvelope) {
        self.streamed = true;
        match &env.kind {
            StreamKind::Status => {
                // Body may be { status } | a bare string | { state }.
                let s = env
                    .body
                    .get("status")
                    .or_else(|| env.body.get("state"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| env.body.as_str().map(str::to_string))
                    .unwrap_or_default();
                if !s.is_empty() {
                    self.status = s;
                }
            }
            StreamKind::Transcript => self.fold_transcript(&env.agent_id, &env.body),
            StreamKind::Tube => {
                let text = crate::agent::body_text(&env.body);
                if !text.is_empty() {
                    let sender = string_field(&env.body, &["sender", "from", "role"]).unwrap_or_default();
                    self.push_line(LaneLine::Tube { sender, text });
                }
            }
            StreamKind::Other(_) => { /* preserve forward-compat: ignore unknown kinds */ }
        }
    }
}

fn string_field(body: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(s) = body.get(*name).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return Some(s.trim().to_string());
            }
        }
    }
    None
}

fn bool_field(body: &Value, names: &[&str]) -> bool {
    names.iter().any(|name| body.get(*name).and_then(|v| v.as_bool()).unwrap_or(false))
}

fn nested_hitl(body: &Value) -> Option<&Value> {
    body.get("hitl")
        .or_else(|| body.get("humanInput"))
        .or_else(|| body.get("approval"))
        .or_else(|| body.get("decision"))
}

fn hitl_card_from_body(agent_id: &str, fallback_agent: Option<&str>, body: &Value, ordinal: usize) -> Option<LaneLine> {
    let nested = nested_hitl(body);
    let marker = string_field(body, &["type", "kind", "event"]).unwrap_or_default().to_lowercase();
    let flagged = marker.contains("hitl")
        || marker.contains("approval")
        || marker.contains("human")
        || bool_field(body, &["requiresApproval", "approvalRequired", "askUserBeforeProceeding", "needsHuman"])
        || nested.is_some();
    if !flagged {
        return None;
    }

    let source = nested.unwrap_or(body);
    let request_id = string_field(source, &["id", "requestId", "request_id", "gateId", "decisionId"])
        .or_else(|| string_field(body, &["id", "requestId", "request_id", "gateId", "decisionId"]))
        .unwrap_or_else(|| format!("hitl-{}", ordinal + 1));
    let title = string_field(source, &["title", "question", "prompt", "summary"])
        .or_else(|| string_field(body, &["title", "question", "prompt", "summary"]))
        .unwrap_or_else(|| "Operator decision needed".into());
    let detail = string_field(source, &["detail", "details", "context", "text", "message", "reason"])
        .or_else(|| string_field(body, &["detail", "details", "context", "text", "message", "reason"]))
        .unwrap_or_else(|| "Approve, adjust, or deny before this agent continues.".into());
    let target = if !agent_id.is_empty() {
        agent_id.to_string()
    } else {
        fallback_agent.unwrap_or_default().to_string()
    };

    Some(LaneLine::Hitl { agent_id: target, request_id, title, detail })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env(kind: &str, body: serde_json::Value) -> StreamEnvelope {
        StreamEnvelope::from_value(&json!({
            "v": 1, "kind": kind, "agentId": "a", "body": body, "ts": 1,
        }))
        .expect("envelope")
    }

    #[test]
    fn picks_active_agent_then_recent() {
        let v = json!({"agents": [
            {"id": "old-active", "isActive": true, "lastHeartbeat": 100},
            {"id": "new-active", "isActive": true, "lastHeartbeat": 200},
            {"id": "newest-idle", "isActive": false, "lastHeartbeat": 999},
        ]});
        assert_eq!(LanePane::pick_agent(&v).as_deref(), Some("new-active"));
    }

    #[test]
    fn pick_agent_handles_empty() {
        assert!(LanePane::pick_agent(&json!({"agents": []})).is_none());
        assert!(LanePane::pick_agent(&json!({})).is_none());
    }

    #[test]
    fn watch_agent_pins_and_clears_the_target() {
        let mut lane = LanePane::new();

        lane.watch_agent(Some("agent-fixed".into()));
        assert_eq!(lane.pinned_agent_id.as_deref(), Some("agent-fixed"));
        match lane.subscription() {
            Some(Subscription::Agent { agent_id }) => assert_eq!(agent_id, "agent-fixed"),
            other => panic!("expected pinned subscription, got {other:?}"),
        }

        lane.on_stream(&env("agent.transcript", json!({"text": "old line"})));
        assert_eq!(lane.lines.len(), 1);

        lane.watch_agent(None);
        assert!(lane.pinned_agent_id.is_none());
        assert!(lane.subscription().is_none());
        assert!(lane.lines.is_empty(), "changing targets clears stale transcript");
    }

    #[test]
    fn folds_status_transcript_and_tube() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("a".into());

        lane.on_stream(&env("agent.status", json!({"status": "working"})));
        assert_eq!(lane.status, "working");
        assert!(lane.streamed);

        lane.on_stream(&env("agent.transcript", json!({"text": "hello world"})));
        lane.on_stream(&env("agent.tube", json!({"text": "control.interrupt"})));
        // 1 transcript line + 1 tube line.
        assert_eq!(lane.lines.len(), 2);

        // The view renders without panicking and includes the live indicator.
        let blocks = lane.view();
        assert!(!blocks.is_empty());
    }

    #[test]
    fn transcript_roles_render_as_bubbles() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("a".into());

        lane.on_stream(&env("agent.transcript", json!({"role": "operator", "text": "please check CI"})));
        lane.on_stream(&env("agent.tube", json!({"sender": "agent", "text": "working on it"})));

        let blocks = lane.view();
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::TranscriptBubble { speaker, mine: true, text, .. }
                    if speaker == "you" && text == "please check CI"
            )),
            "operator transcript frames become right-role bubbles",
        );
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::TranscriptBubble { speaker, mine: false, text, .. }
                    if speaker == "agent" && text == "working on it"
            )),
            "tube sender frames keep their speaker label",
        );
    }

    #[test]
    fn hitl_frames_render_inline_decision_cards() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("agent-a".into());

        lane.on_stream(&env("agent.transcript", json!({
            "type": "hitl",
            "requestId": "gate-1",
            "question": "Ship this patch?",
            "context": "cargo test is green"
        })));

        let blocks = lane.view();
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::HitlCard { agent_id, request_id, title, detail, .. }
                    if agent_id == "a"
                    && request_id == "gate-1"
                    && title == "Ship this patch?"
                    && detail == "cargo test is green"
            )),
            "HITL stream frames become inline decision cards",
        );
    }

    #[test]
    fn tool_calls_transition_running_to_done() {
        let mut lane = LanePane::new();
        // Running, then completed → one chip that flips to Ok.
        lane.on_stream(&env("agent.transcript", json!({"tool": {"name": "Bash", "status": "running"}})));
        lane.on_stream(&env("agent.transcript", json!({"tool": {"name": "Bash", "status": "ok"}})));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].state, ToolState::Ok);

        // A failing tool surfaces as Failed.
        lane.on_stream(&env("agent.transcript", json!({"tool": {"name": "Edit", "status": "error"}})));
        assert_eq!(lane.tools.last().unwrap().state, ToolState::Failed);
    }

    #[test]
    fn flat_tool_shape_also_parsed() {
        let mut lane = LanePane::new();
        lane.on_stream(&env("agent.transcript", json!({"toolName": "Read", "status": "running"})));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].name, "Read");
    }

    #[test]
    fn scrollback_is_bounded() {
        let mut lane = LanePane::new();
        for i in 0..(SCROLLBACK + 50) {
            lane.on_stream(&env("agent.transcript", json!({"text": format!("line {i}")})));
        }
        assert!(lane.lines.len() <= SCROLLBACK);
    }

    #[test]
    fn unknown_kind_is_ignored_not_fatal() {
        let mut lane = LanePane::new();
        lane.on_stream(&env("agent.future", json!({"whatever": true})));
        // No crash, no spurious lines.
        assert!(lane.lines.is_empty());
        assert!(lane.streamed); // we did receive a frame
    }
}
