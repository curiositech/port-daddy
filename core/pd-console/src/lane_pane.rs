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
use std::collections::BTreeSet;

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
    Transcript(String),
    Tube(String),
}

/// The live agent LANE surface.
pub struct LanePane {
    /// The agent we're watching (chosen on refresh). `None` until one is found.
    agent_id: Option<String>,
    /// Last known lifecycle status from `agent.status` frames.
    status: String,
    /// Whether the live stream has delivered at least one frame (vs. just polled).
    streamed: bool,
    /// Scrollback of transcript + tube lines (most recent at the end).
    lines: Vec<LaneLine>,
    /// Transcript route updates carry the full refreshed row. Remember rendered
    /// message/output keys so one append does not repaint the whole history.
    seen_transcript_items: BTreeSet<String>,
    /// Tool calls seen on the stream, in arrival order (deduped by name+running).
    tools: Vec<ToolCall>,
    /// Last error from the 2s poll (daemon unreachable / no agents), if any.
    error: Option<String>,
}

impl LanePane {
    pub fn new() -> Self {
        Self {
            agent_id: None,
            status: "—".into(),
            streamed: false,
            lines: Vec::new(),
            seen_transcript_items: BTreeSet::new(),
            tools: Vec::new(),
            error: None,
        }
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

    /// Fold a transcript envelope. The daemon's real shape is
    /// `{type, entry:{messages, outputs, ...}}`; older streamers may still send
    /// flat deltas. Extract both so the Lane is an honest live digest, not a
    /// happy-path toy parser.
    fn fold_transcript(&mut self, body: &serde_json::Value) {
        let mut rendered = false;
        let has_entry = body.get("entry").is_some();

        if let Some(entry) = body.get("entry") {
            rendered |=
                self.fold_transcript_entry(body.get("type").and_then(|t| t.as_str()), entry);
        }

        // Tool-call delta (nested or flat) for streamers that emit incremental
        // tool frames instead of row snapshots.
        if let Some((name, state)) = extract_flat_tool_delta(body) {
            self.note_tool(&name, state);
            rendered = true;
        }

        // Flat text delta fallback: {text} | {delta} | {content} | "text".
        if let Some(text) = flat_text(body) {
            self.push_line(LaneLine::Transcript(text));
            rendered = true;
        }

        if !rendered && !has_entry {
            if let Some(kind) = body.get("type").and_then(|t| t.as_str()) {
                self.push_unique_transcript_line(
                    format!("event:{kind}:{}", body.to_string().len()),
                    format!("transcript {kind}"),
                );
            }
        }
    }

    fn fold_transcript_entry(
        &mut self,
        event_type: Option<&str>,
        entry: &serde_json::Value,
    ) -> bool {
        let mut rendered = false;
        let tx_id = field_str(entry, &["id"]).unwrap_or("transcript");

        if matches!(event_type, Some("start") | Some("snapshot")) {
            let ship = field_str(entry, &["ship"]).unwrap_or("agent");
            let backend = field_str(entry, &["backend"]).unwrap_or("backend");
            let model = field_str(entry, &["model"]).unwrap_or("model");
            let status = field_str(entry, &["status"]).unwrap_or("running");
            rendered |= self.push_unique_transcript_line(
                format!("{tx_id}:meta:{status}:{}", event_type.unwrap_or("event")),
                format!("run {status}: {ship} via {backend}/{model}"),
            );
        }

        if let Some(messages) = entry.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                rendered |= self.fold_transcript_message(tx_id, msg);
            }
        }

        if let Some(outputs) = entry.get("outputs").and_then(|o| o.as_array()) {
            for output in outputs {
                rendered |= self.fold_transcript_output(tx_id, output);
            }
        }

        if matches!(event_type, Some("end")) {
            let ship = field_str(entry, &["ship"]).unwrap_or("agent");
            let status = field_str(entry, &["status"]).unwrap_or("completed");
            let cost = entry.get("cost_usd").and_then(|c| c.as_f64());
            let tokens_in = entry.get("tokens_in").and_then(|t| t.as_i64());
            let tokens_out = entry.get("tokens_out").and_then(|t| t.as_i64());
            let mut line = format!("run {status}: {ship}");
            if let Some(cost) = cost {
                line.push_str(&format!(" ${cost:.4}"));
            }
            if tokens_in.is_some() || tokens_out.is_some() {
                line.push_str(&format!(
                    " tokens {} in / {} out",
                    tokens_in.unwrap_or(0),
                    tokens_out.unwrap_or(0)
                ));
            }
            if let Some(err) = field_str(entry, &["error"]) {
                if !err.is_empty() {
                    line.push_str(&format!(" error: {err}"));
                }
            }
            rendered |= self.push_unique_transcript_line(format!("{tx_id}:end:{status}"), line);
        }

        rendered
    }

    fn fold_transcript_message(&mut self, tx_id: &str, msg: &serde_json::Value) -> bool {
        let mut rendered = false;
        let timestamp = msg.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);

        if let Some(tool_calls) = msg.get("tool_calls").and_then(|calls| calls.as_array()) {
            for (idx, call) in tool_calls.iter().enumerate() {
                if let Some(name) = field_str(call, &["name", "tool", "toolName"]) {
                    let state = if call.get("result").is_some() {
                        ToolState::Ok
                    } else {
                        ToolState::Running
                    };
                    let key = format!("{tx_id}:tool:{timestamp}:{idx}:{name}:{state:?}");
                    if self.seen_transcript_items.insert(key) {
                        self.note_tool(name, state);
                        rendered = true;
                    }
                }
            }
        }

        let Some(content) = field_str(msg, &["content", "text", "delta"]) else {
            return rendered;
        };
        let content = content.trim();
        if content.is_empty() {
            return rendered;
        }

        let role = field_str(msg, &["role"]).unwrap_or("assistant");
        let line = match role {
            "assistant" => content.to_string(),
            "thinking" => format!("thinking: {content}"),
            "tool" => format!("tool: {content}"),
            "user" => format!("user: {content}"),
            other => format!("{other}: {content}"),
        };
        self.push_unique_transcript_line(
            format!("{tx_id}:msg:{timestamp}:{role}:{}", digest_text(content)),
            line,
        ) || rendered
    }

    fn fold_transcript_output(&mut self, tx_id: &str, output: &serde_json::Value) -> bool {
        let output_type = field_str(output, &["type"]).unwrap_or("output");
        let Some(summary) = field_str(output, &["summary", "content", "text"]) else {
            return false;
        };
        let summary = summary.trim();
        if summary.is_empty() {
            return false;
        }
        let mut line = format!("artifact {output_type}: {summary}");
        if let Some(url) = field_str(output, &["url"]) {
            if !url.is_empty() {
                line.push_str(&format!(" {url}"));
            }
        }
        self.push_unique_transcript_line(
            format!("{tx_id}:output:{output_type}:{}", digest_text(summary)),
            line,
        )
    }

    fn push_unique_transcript_line(&mut self, key: String, text: String) -> bool {
        if !self.seen_transcript_items.insert(key) {
            return false;
        }
        self.push_line(LaneLine::Transcript(text));
        true
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
        self.tools.push(ToolCall {
            name: name.to_string(),
            state,
        });
    }
}

fn extract_flat_tool_delta(body: &serde_json::Value) -> Option<(String, ToolState)> {
    let tool_obj = body.get("tool");
    let name = tool_obj
        .and_then(|t| t.as_str())
        .or_else(|| {
            tool_obj
                .and_then(|t| t.get("name"))
                .and_then(|n| n.as_str())
        })
        .or_else(|| body.get("toolName").and_then(|n| n.as_str()))?;
    let status = tool_obj
        .and_then(|t| t.get("status"))
        .or_else(|| body.get("status"))
        .or_else(|| body.get("toolStatus"))
        .and_then(|s| s.as_str())
        .unwrap_or("running");
    Some((name.to_string(), tool_state(status)))
}

fn tool_state(status: &str) -> ToolState {
    match status {
        "ok" | "success" | "done" | "complete" | "completed" => ToolState::Ok,
        "error" | "failed" | "failure" => ToolState::Failed,
        _ => ToolState::Running,
    }
}

fn flat_text(body: &serde_json::Value) -> Option<String> {
    if let Some(text) = body.as_str() {
        return non_empty(text);
    }
    for key in ["text", "delta", "content", "message", "body"] {
        if let Some(text) = body.get(key).and_then(|v| v.as_str()).and_then(non_empty) {
            return Some(text);
        }
    }
    None
}

fn field_str<'a>(value: &'a serde_json::Value, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(|v| v.as_str()))
}

fn non_empty(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn digest_text(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
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
            label: format!(
                "status: {}",
                if self.status.is_empty() {
                    "—"
                } else {
                    &self.status
                }
            ),
            tone: Tone::Accent,
        });
        out.push(Block::Chip {
            label: if self.streamed {
                "● live".into()
            } else {
                "○ connecting".into()
            },
            tone: if self.streamed {
                Tone::Landed
            } else {
                Tone::Resting
            },
        });

        // Tool-call chips (running → done/failed).
        if !self.tools.is_empty() {
            out.push(Block::Header("tools".into()));
            for t in self
                .tools
                .iter()
                .rev()
                .take(12)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                let (label, tone) = t.state.chip(&t.name);
                out.push(Block::Chip { label, tone });
            }
        }

        // Live transcript / tube tail.
        out.push(Block::Header("stream".into()));
        if self.lines.is_empty() {
            out.push(Block::KeyVal(
                "—".into(),
                "connected; waiting for transcript/tool/tube frames".into(),
            ));
        } else {
            // Show the last ~24 lines (most recent at the bottom).
            let start = self.lines.len().saturating_sub(24);
            for line in &self.lines[start..] {
                match line {
                    LaneLine::Transcript(t) => out.push(Block::Row(vec![util::trunc(t, 96)])),
                    LaneLine::Tube(t) => {
                        out.push(Block::Row(vec![format!("⤳ {}", util::trunc(t, 92))]))
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
                        if let Some(id) = Self::pick_agent(&v) {
                            // If the target changed, reset the live view for the new agent.
                            if self.agent_id.as_deref() != Some(id.as_str()) {
                                self.agent_id = Some(id);
                                self.streamed = false;
                                self.lines.clear();
                                self.seen_transcript_items.clear();
                                self.tools.clear();
                                self.status = "—".into();
                            }
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
        self.agent_id
            .clone()
            .map(|agent_id| Subscription::Agent { agent_id })
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
            StreamKind::Transcript => self.fold_transcript(&env.body),
            StreamKind::Tube => {
                let text = crate::agent::body_text(&env.body);
                if !text.is_empty() {
                    self.push_line(LaneLine::Tube(text));
                }
            }
            StreamKind::Other(_) => { /* preserve forward-compat: ignore unknown kinds */ }
        }
    }
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

    fn transcript_lines(lane: &LanePane) -> Vec<String> {
        lane.lines
            .iter()
            .filter_map(|line| match line {
                LaneLine::Transcript(text) => Some(text.clone()),
                LaneLine::Tube(_) => None,
            })
            .collect()
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
    fn tool_calls_transition_running_to_done() {
        let mut lane = LanePane::new();
        // Running, then completed → one chip that flips to Ok.
        lane.on_stream(&env(
            "agent.transcript",
            json!({"tool": {"name": "Bash", "status": "running"}}),
        ));
        lane.on_stream(&env(
            "agent.transcript",
            json!({"tool": {"name": "Bash", "status": "ok"}}),
        ));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].state, ToolState::Ok);

        // A failing tool surfaces as Failed.
        lane.on_stream(&env(
            "agent.transcript",
            json!({"tool": {"name": "Edit", "status": "error"}}),
        ));
        assert_eq!(lane.tools.last().unwrap().state, ToolState::Failed);
    }

    #[test]
    fn flat_tool_shape_also_parsed() {
        let mut lane = LanePane::new();
        lane.on_stream(&env(
            "agent.transcript",
            json!({"toolName": "Read", "status": "running"}),
        ));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].name, "Read");
    }

    #[test]
    fn folds_real_daemon_transcript_entry_messages_tools_and_outputs() {
        let mut lane = LanePane::new();
        lane.on_stream(&env("agent.transcript", json!({
            "type": "update",
            "entry": {
                "id": "tx-real",
                "ship": "codex",
                "spawned_agent_id": "a",
                "status": "running",
                "backend": "codex",
                "model": "gpt-5",
                "messages": [
                    {"role": "thinking", "content": "checking the stream contract", "timestamp": 10},
                    {
                        "role": "assistant",
                        "content": "I found the cockpit route.",
                        "timestamp": 11,
                        "tool_calls": [
                            {"name": "rg", "args": {"query": "agent.transcript"}, "result": "matched"}
                        ]
                    }
                ],
                "outputs": [
                    {
                        "type": "draft-pr",
                        "summary": "opened draft PR #123",
                        "url": "https://github.com/org/repo/pull/123"
                    }
                ]
            }
        })));

        let lines = transcript_lines(&lane);
        assert!(lines
            .iter()
            .any(|line| line.contains("thinking: checking the stream contract")));
        assert!(lines
            .iter()
            .any(|line| line.contains("I found the cockpit route.")));
        assert!(lines
            .iter()
            .any(|line| line.contains("artifact draft-pr: opened draft PR #123")));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].name, "rg");
        assert_eq!(lane.tools[0].state, ToolState::Ok);
    }

    #[test]
    fn folds_real_daemon_transcript_start_and_end_metadata() {
        let mut lane = LanePane::new();
        lane.on_stream(&env(
            "agent.transcript",
            json!({
                "type": "start",
                "entry": {
                    "id": "tx-meta",
                    "ship": "codex",
                    "spawned_agent_id": "a",
                    "status": "running",
                    "backend": "codex",
                    "model": "gpt-5",
                    "messages": [],
                    "outputs": []
                }
            }),
        ));
        lane.on_stream(&env(
            "agent.transcript",
            json!({
                "type": "end",
                "entry": {
                    "id": "tx-meta",
                    "ship": "codex",
                    "spawned_agent_id": "a",
                    "status": "completed",
                    "backend": "codex",
                    "model": "gpt-5",
                    "cost_usd": 0.0123,
                    "tokens_in": 1200,
                    "tokens_out": 340,
                    "messages": [],
                    "outputs": []
                }
            }),
        ));

        let lines = transcript_lines(&lane);
        assert!(lines
            .iter()
            .any(|line| line.contains("run running: codex via codex/gpt-5")));
        assert!(lines
            .iter()
            .any(|line| line.contains("run completed: codex $0.0123 tokens 1200 in / 340 out")));
    }

    #[test]
    fn repeated_full_transcript_updates_do_not_duplicate_scrollback() {
        let mut lane = LanePane::new();
        let body = json!({
            "type": "update",
            "entry": {
                "id": "tx-dedupe",
                "ship": "codex",
                "spawned_agent_id": "a",
                "status": "running",
                "backend": "codex",
                "model": "gpt-5",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "same row replayed",
                        "timestamp": 99,
                        "tool_calls": [
                            {"name": "rg", "args": {"query": "agent.transcript"}, "result": "matched"}
                        ]
                    }
                ],
                "outputs": []
            }
        });

        lane.on_stream(&env("agent.transcript", body.clone()));
        lane.on_stream(&env("agent.transcript", body));
        assert_eq!(
            transcript_lines(&lane),
            vec!["same row replayed".to_string()]
        );
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].name, "rg");
        assert_eq!(lane.tools[0].state, ToolState::Ok);
    }

    #[test]
    fn scrollback_is_bounded() {
        let mut lane = LanePane::new();
        for i in 0..(SCROLLBACK + 50) {
            lane.on_stream(&env(
                "agent.transcript",
                json!({"text": format!("line {i}")}),
            ));
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
