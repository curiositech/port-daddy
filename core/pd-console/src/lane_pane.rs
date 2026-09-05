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
//! And it can steer: `SurfaceAction::Interrupt` POSTs `/agents/:id/interrupt`;
//! `SurfaceAction::OperatorTurn` publishes operator turns to `agent:<id>`. Those
//! turns can include text, attached files/photos, and requested skill/tool
//! context. The daemon echoes delivery back as `agent.tube`, while the Lane
//! renders the structured attachment context as chat/artifact rows after
//! successful delivery.
//!
//! Which agent? `refresh()` (the 2s poll) picks the watch target: `PD_LANE_AGENT`
//! if set (deterministic for screenshot capture), else the most-recently-active
//! running agent from `GET /agents`. main.rs reads `subscription()` and opens the
//! stream; envelopes flow back through `on_stream`.

use crate::agent::{DaemonClient, StreamEnvelope, StreamKind};
use crate::pane::{
    Block, OperatorAttachmentKind, OperatorTurn, Pane, Subscription, SurfaceAction, Tone,
};
use crate::util;
use anyhow::Result;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// How many transcript/tube lines to retain in the scrollback. Older lines drop
/// off the top — the Lane is a live tail, not an archive.
const SCROLLBACK: usize = 200;
/// Keep the visible lane short enough that its newest event remains above the
/// fixed operator controls at the minimum proof viewport. The durable
/// transcript is still complete; this is only the live-tail projection.
const VISIBLE_TAIL: usize = 4;

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
    Chat {
        speaker: String,
        text: String,
        tone: Tone,
    },
    Artifact {
        label: String,
        path: String,
        preview: Option<String>,
    },
    ImageArtifact {
        label: String,
        path: String,
        preview: Option<String>,
        image_path: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedArtifactRef {
    raw: String,
    path: String,
}

/// The live agent LANE surface.
pub struct LanePane {
    /// Mission-selected body. When present, the lane follows this exact agent
    /// instead of whichever unrelated process most recently heartbeated.
    pinned_agent_id: Option<String>,
    /// The agent we're watching (chosen on refresh). `None` until one is found.
    agent_id: Option<String>,
    /// Last known lifecycle status from `agent.status` frames.
    status: String,
    /// Whether the selected roster entry can still receive operator turns.
    /// Keep this separate from `agent_id`: a completed lane retains its receipt
    /// and transcript, but must not pretend a tube send can reach the dead body.
    agent_active: bool,
    /// Whether the live stream has delivered at least one frame (vs. just polled).
    streamed: bool,
    /// Scrollback of transcript + tube lines (most recent at the end).
    lines: Vec<LaneLine>,
    /// Transcript route updates carry the full refreshed row. Remember rendered
    /// message/output keys so one append does not repaint the whole history.
    seen_transcript_items: BTreeSet<String>,
    /// Last steering-channel message read from `/msg/agent:<id>`. The live SSE
    /// stream tails future traffic; this backfill catches messages that arrived
    /// before the native pane subscribed.
    channel_cursor: u64,
    /// Tool calls seen on the stream, in arrival order (deduped by name+running).
    tools: Vec<ToolCall>,
    /// Last error from the 2s poll (daemon unreachable / no agents), if any.
    error: Option<String>,
    /// Assistant transcript turns not yet forwarded to the focused chat surface.
    /// The Lane remains the full-fidelity stream; chat receives only deduped
    /// assistant prose, never tools/thinking/run metadata.
    pending_chat_replies: Vec<String>,
}

impl LanePane {
    pub fn new() -> Self {
        Self {
            pinned_agent_id: None,
            agent_id: None,
            status: "—".into(),
            agent_active: false,
            streamed: false,
            lines: Vec::new(),
            seen_transcript_items: BTreeSet::new(),
            channel_cursor: 0,
            tools: Vec::new(),
            error: None,
            pending_chat_replies: Vec::new(),
        }
    }

    pub fn has_agent(&self) -> bool {
        self.agent_id.is_some() && self.agent_active
    }

    /// Attach the lane to the body recorded on the current mission receipt.
    /// Passing `None` restores roster-based selection for standalone use.
    pub fn follow_agent(&mut self, agent_id: Option<&str>) {
        let selected = agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if self.pinned_agent_id == selected {
            return;
        }
        self.pinned_agent_id = selected.clone();
        if selected.is_some() {
            self.select_agent(selected);
        }
    }

    fn select_agent(&mut self, selected: Option<String>) {
        if self.agent_id == selected {
            return;
        }
        self.agent_id = selected;
        self.agent_active = false;
        self.streamed = false;
        self.lines.clear();
        self.seen_transcript_items.clear();
        self.channel_cursor = 0;
        self.tools.clear();
        self.pending_chat_replies.clear();
        self.status = "—".into();
    }

    pub fn take_chat_replies(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_chat_replies)
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

    fn push_operator_turn(&mut self, turn: &OperatorTurn) {
        if !turn.text.trim().is_empty() {
            self.push_line(LaneLine::Chat {
                speaker: "you".into(),
                text: turn.text.trim().to_string(),
                tone: Tone::Accent,
            });
        }
        for attachment in &turn.attachments {
            let path = display_artifact_path(&attachment.path)
                .unwrap_or_else(|| attachment.path.trim().to_string());
            let (label, preview) = match attachment.kind {
                OperatorAttachmentKind::File => (
                    "file attachment".to_string(),
                    "attached file / open in current worktree",
                ),
                OperatorAttachmentKind::Photo => (
                    "photo attachment".to_string(),
                    "attached photo / open in current worktree",
                ),
            };
            self.push_line(LaneLine::Artifact {
                label,
                path,
                preview: Some(preview.to_string()),
            });
        }
        if !turn.skills.is_empty() {
            self.push_line(LaneLine::Chat {
                speaker: "skill".into(),
                text: format!("invoke {}", turn.skills.join(", ")),
                tone: Tone::Engaged,
            });
        }
        if !turn.tools.is_empty() {
            self.push_line(LaneLine::Chat {
                speaker: "tool".into(),
                text: format!("operator requested {}", turn.tools.join(", ")),
                tone: Tone::Engaged,
            });
        }
    }

    async fn send_operator_turn(
        &mut self,
        daemon: &DaemonClient,
        turn: OperatorTurn,
    ) -> Result<()> {
        if turn.is_empty() {
            return Ok(());
        }
        let Some(id) = self.agent_id.clone() else {
            return Err(anyhow::anyhow!("no agent to message"));
        };
        let text = turn.tube_text();
        let channel = format!("agent:{id}");
        daemon.tube_send(&channel, &text, "operator").await?;
        self.push_operator_turn(&turn);
        Ok(())
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
            rendered |= self.push_unique_chat_turn(
                format!("flat:{}", digest_text(&text)),
                "agent".into(),
                text,
                Tone::Default,
            );
        }

        if !rendered && !has_entry {
            if let Some(kind) = body.get("type").and_then(|t| t.as_str()) {
                self.push_unique_chat_turn(
                    format!("event:{kind}:{}", body.to_string().len()),
                    "stream".into(),
                    format!("transcript {kind}"),
                    Tone::Resting,
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
            rendered |= self.push_unique_chat_turn(
                format!("{tx_id}:meta:{status}:{}", event_type.unwrap_or("event")),
                "run".into(),
                format!("run {status}: {ship} via {backend}/{model}"),
                Tone::Resting,
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
            let tone = if matches!(status, "failed" | "error" | "blocked") {
                Tone::Gated
            } else {
                Tone::Landed
            };
            self.status = status.to_string();
            self.agent_active = false;
            self.streamed = false;
            rendered |= self.push_unique_chat_turn(
                format!("{tx_id}:end:{status}"),
                "run".into(),
                line,
                tone,
            );
        }

        rendered
    }

    fn fold_transcript_message(&mut self, tx_id: &str, msg: &serde_json::Value) -> bool {
        let mut rendered = false;
        let mut structured_error: Option<String> = None;
        let timestamp = msg.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);

        if let Some(tool_calls) = msg.get("tool_calls").and_then(|calls| calls.as_array()) {
            for (idx, call) in tool_calls.iter().enumerate() {
                if let Some(name) = field_str(call, &["name", "tool", "toolName"]) {
                    let state = if name == "error" {
                        if let Some(message) = call
                            .get("args")
                            .and_then(|args| field_str(args, &["message"]))
                        {
                            structured_error = Some(message.to_string());
                        }
                        ToolState::Failed
                    } else if call.get("result").is_some() {
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

        let Some(content) = structured_error
            .as_deref()
            .or_else(|| field_str(msg, &["content", "text", "delta"]))
        else {
            return rendered;
        };
        let content = content.trim();
        if content.is_empty() {
            return rendered;
        }

        let role = field_str(msg, &["role"]).unwrap_or("assistant");
        let (speaker, tone) = if structured_error.is_some() {
            ("runtime".into(), Tone::Gated)
        } else {
            chat_speaker_for_role(role)
        };
        self.push_unique_chat_turn(
            format!("{tx_id}:msg:{timestamp}:{role}:{}", digest_text(content)),
            speaker,
            content.to_string(),
            tone,
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

        if let Some(reference) = artifact_ref_from_output(output, summary) {
            let mime = field_str(
                output,
                &["mimeType", "mime_type", "contentType", "content_type"],
            );
            if is_transcript_image_output(output_type, &reference.path, mime) {
                let label = artifact_label(output_type, summary, &reference.raw);
                return self.push_unique_image_artifact(
                    format!(
                        "{tx_id}:output:{output_type}:image:{}:{}",
                        reference.path,
                        digest_text(summary)
                    ),
                    label,
                    reference.path.clone(),
                    Some("image proof from transcript output".into()),
                    local_image_path(&reference.path),
                );
            }
            let label = artifact_label(output_type, summary, &reference.raw);
            return self.push_unique_artifact_ref(
                format!(
                    "{tx_id}:output:{output_type}:artifact:{}:{}",
                    reference.path,
                    digest_text(summary)
                ),
                label,
                reference.path,
                Some("open / preview in current worktree".into()),
            );
        }

        let mut line = format!("artifact {output_type}: {summary}");
        if let Some(url) = field_str(output, &["url"]) {
            if !url.is_empty() {
                line.push_str(&format!(" {url}"));
            }
        }
        self.push_unique_chat_turn(
            format!("{tx_id}:output:{output_type}:{}", digest_text(summary)),
            "artifact".into(),
            line,
            Tone::Accent,
        )
    }

    fn push_unique_chat_turn(
        &mut self,
        key: String,
        speaker: String,
        text: String,
        tone: Tone,
    ) -> bool {
        if !self.seen_transcript_items.insert(key) {
            return false;
        }
        if speaker == "agent" {
            self.pending_chat_replies.push(text.clone());
        }
        let artifact_refs = extract_artifact_refs(&text);
        self.push_line(LaneLine::Chat {
            speaker,
            text,
            tone,
        });
        for (idx, reference) in artifact_refs.into_iter().enumerate() {
            let artifact_key = format!("artifact-from-line:{idx}:{}", reference.path);
            let label = artifact_label("reference", "", &reference.raw);
            self.push_unique_artifact_ref(
                artifact_key,
                label,
                reference.path,
                Some("open / preview in current worktree".into()),
            );
        }
        true
    }

    fn push_unique_artifact_ref(
        &mut self,
        key: String,
        label: String,
        path: String,
        preview: Option<String>,
    ) -> bool {
        if !self.seen_transcript_items.insert(key) {
            return false;
        }
        self.push_line(LaneLine::Artifact {
            label,
            path,
            preview,
        });
        true
    }

    fn push_unique_image_artifact(
        &mut self,
        key: String,
        label: String,
        path: String,
        preview: Option<String>,
        image_path: Option<String>,
    ) -> bool {
        if !self.seen_transcript_items.insert(key) {
            return false;
        }
        self.push_line(LaneLine::ImageArtifact {
            label,
            path,
            preview,
            image_path,
        });
        true
    }

    fn fold_visual_task(&mut self, body: &serde_json::Value) -> bool {
        if !is_visual_task_payload(body) {
            return false;
        }

        let task_id = field_str(body, &["taskId", "id"]).unwrap_or("visual-task");
        let title = field_str(body, &["title"]).unwrap_or("Visual task");
        let description = field_str(body, &["description"]).unwrap_or("");
        let mut text = format!("Scout captured visual task: {title}");
        if !description.is_empty() && description != title {
            text.push_str(&format!(" - {description}"));
        }
        if let Some(url) = field_str(body, &["pageUrl"]) {
            if !url.is_empty() {
                text.push_str(&format!(" ({url})"));
            }
        }

        let mut rendered = self.push_unique_chat_turn(
            format!("visual-task:{task_id}:notice"),
            "scout".into(),
            text,
            Tone::Engaged,
        );

        if let Some((path, preview, image_path)) = visual_task_image_artifact(body) {
            rendered |= self.push_unique_image_artifact(
                format!("visual-task:{task_id}:screenshot:{path}"),
                format!("visual task screenshot: {title}"),
                path,
                Some(preview),
                image_path,
            );
        }

        rendered
    }

    fn fold_tube_body(
        &mut self,
        key: String,
        sender: String,
        body: &serde_json::Value,
        tone: Tone,
    ) -> bool {
        if self.fold_visual_task(body) {
            return true;
        }
        let text = crate::agent::body_text(body);
        if text.is_empty() {
            return false;
        }
        self.push_unique_chat_turn(key, sender, text, tone)
    }

    async fn backfill_agent_channel(&mut self, daemon: &DaemonClient) {
        let Some(agent_id) = self.agent_id.clone() else {
            return;
        };
        let channel = format!("agent:{agent_id}");
        let resp = daemon
            .http_client()
            .get(format!("{}/msg/{channel}", daemon.base()))
            .query(&[
                ("after", self.channel_cursor.to_string()),
                ("limit", "50".to_string()),
            ])
            .send()
            .await;
        let Ok(resp) = resp else {
            return;
        };
        if !resp.status().is_success() {
            return;
        }
        let Ok(v) = resp.json::<serde_json::Value>().await else {
            return;
        };
        let Some(messages) = v.get("messages").and_then(|m| m.as_array()) else {
            return;
        };

        for message in messages {
            let id = message.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
            self.channel_cursor = self.channel_cursor.max(id);
            let body = message
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let sender = message
                .get("sender")
                .and_then(|s| s.as_str())
                .unwrap_or("agent")
                .to_string();
            self.fold_tube_body(
                format!("channel:{channel}:{id}"),
                sender,
                &body,
                Tone::Default,
            );
        }
    }

    async fn hydrate_image_artifacts(&mut self, daemon: &DaemonClient) {
        let pending: Vec<(usize, String)> = self
            .lines
            .iter()
            .enumerate()
            .filter_map(|(idx, line)| match line {
                LaneLine::ImageArtifact {
                    path, image_path, ..
                } if image_path.is_none() => Some((idx, path.clone())),
                _ => None,
            })
            .collect();

        for (idx, path) in pending {
            let Some(cached) = fetch_image_artifact(daemon, &path).await else {
                continue;
            };
            if let Some(LaneLine::ImageArtifact { image_path, .. }) = self.lines.get_mut(idx) {
                if image_path.is_none() {
                    *image_path = Some(cached);
                }
            }
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

fn is_terminal_status(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "complete"
            | "completed"
            | "done"
            | "failed"
            | "error"
            | "cancelled"
            | "canceled"
            | "halted"
            | "settled"
            | "killed"
            | "aborted"
            | "over_budget"
            | "timed_out"
            | "timeout"
    )
}

fn chat_speaker_for_role(role: &str) -> (String, Tone) {
    match role {
        "assistant" => ("agent".into(), Tone::Default),
        "thinking" => ("thinking".into(), Tone::Resting),
        "tool" => ("tool".into(), Tone::Engaged),
        "user" | "operator" => ("you".into(), Tone::Accent),
        other => (other.to_string(), Tone::Default),
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

fn artifact_ref_from_output(
    output: &serde_json::Value,
    summary: &str,
) -> Option<ParsedArtifactRef> {
    field_str(
        output,
        &[
            "path",
            "file",
            "filePath",
            "file_path",
            "filename",
            "artifactPath",
            "artifact_path",
        ],
    )
    .and_then(parsed_artifact_ref)
    .or_else(|| extract_artifact_refs(summary).into_iter().next())
}

fn is_visual_task_payload(body: &serde_json::Value) -> bool {
    field_str(body, &["kind"]) == Some("visual-task")
        || field_str(body, &["type"]) == Some("visual-task")
}

fn visual_task_image_artifact(
    body: &serde_json::Value,
) -> Option<(String, String, Option<String>)> {
    let image = body.get("image")?;
    let path = field_str(image, &["blobUrl", "blob_url", "url", "path", "src"])
        .map(str::to_string)
        .or_else(|| field_str(image, &["blobId", "blob_id"]).map(|id| format!("/blob/{id}")))?;
    let mime = field_str(
        image,
        &["mimeType", "mime_type", "contentType", "content_type"],
    );
    if !is_image_reference(&path, mime) {
        return None;
    }

    let mut parts = Vec::new();
    if let Some(mime) = mime {
        parts.push(mime.to_string());
    }
    if let (Some(width), Some(height)) =
        (number_field(image, "width"), number_field(image, "height"))
    {
        parts.push(format!("{width}x{height}"));
    }
    if let Some(region) = body.get("region").and_then(format_region) {
        parts.push(region);
    }
    if let Some(url) = field_str(body, &["pageUrl"]) {
        if !url.is_empty() {
            parts.push(format!("page {url}"));
        }
    }
    if let Some(channel) = body
        .get("channel")
        .and_then(|channel| field_str(channel, &["name"]))
        .filter(|name| !name.is_empty())
    {
        parts.push(format!("payload {channel}"));
    }
    let preview = if parts.is_empty() {
        "screenshot evidence from visual-task intake".to_string()
    } else {
        parts.join(" / ")
    };
    let image_path = local_image_path(&path);
    Some((path, preview, image_path))
}

fn format_region(region: &serde_json::Value) -> Option<String> {
    let x = number_field(region, "x")?;
    let y = number_field(region, "y")?;
    let width = number_field(region, "width")?;
    let height = number_field(region, "height")?;
    let space = field_str(region, &["coordinateSpace", "coordinate_space"]).unwrap_or("viewport");
    Some(format!("region {space} {x},{y} {width}x{height}"))
}

fn number_field(value: &serde_json::Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|n| n.round() as i64)))
}

fn is_image_reference(path: &str, mime: Option<&str>) -> bool {
    if mime
        .map(|m| m.to_ascii_lowercase().starts_with("image/"))
        .unwrap_or(false)
    {
        return true;
    }
    if path.starts_with("/blob/") || path.contains("/blob/") {
        return true;
    }
    image_extension(path).is_some()
}

fn content_type_is_image(mime: Option<&str>) -> bool {
    mime.map(|m| m.to_ascii_lowercase().starts_with("image/"))
        .unwrap_or(false)
}

fn is_transcript_image_output(output_type: &str, path: &str, mime: Option<&str>) -> bool {
    if content_type_is_image(mime) {
        return true;
    }
    if path.starts_with("/blob/") || path.contains("/blob/") {
        return true;
    }
    matches!(
        output_type.to_ascii_lowercase().as_str(),
        "screenshot" | "image" | "visual-task-screenshot" | "proof-image"
    )
}

fn image_extension(path: &str) -> Option<&'static str> {
    let ext = path
        .split('?')
        .next()
        .unwrap_or(path)
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "gif" => Some("gif"),
        "jpeg" | "jpg" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        _ => None,
    }
}

fn local_image_path(path: &str) -> Option<String> {
    if path.starts_with("/blob/") || path.starts_with("http://") || path.starts_with("https://") {
        return None;
    }
    if image_extension(path).is_none() {
        return None;
    }
    let candidate = Path::new(path);
    let absolute = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(candidate)
    };
    if absolute.exists() {
        Some(absolute.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn blob_url(daemon: &DaemonClient, path: &str) -> Option<String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        Some(path.to_string())
    } else if path.starts_with("/blob/") {
        Some(format!("{}{}", daemon.base(), path))
    } else {
        None
    }
}

fn cache_extension(path: &str, content_type: Option<&str>) -> &'static str {
    if let Some(ext) = image_extension(path) {
        return ext;
    }
    match content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
    {
        "image/gif" => "gif",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn image_cache_path(path: &str, content_type: Option<&str>) -> PathBuf {
    let ext = cache_extension(path, content_type);
    std::env::temp_dir()
        .join("pd-console-lane-images")
        .join(format!("{:016x}.{ext}", digest_text(path)))
}

async fn fetch_image_artifact(daemon: &DaemonClient, path: &str) -> Option<String> {
    let url = blob_url(daemon, path)?;
    let resp = daemon.http_client().get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if content_type
        .as_deref()
        .is_some_and(|ct| !content_type_is_image(Some(ct)))
    {
        return None;
    }
    if content_type.is_none() && !is_image_reference(path, None) {
        return None;
    }
    let cache = image_cache_path(path, content_type.as_deref());
    if cache.exists() {
        return Some(cache.to_string_lossy().into_owned());
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    if let Some(parent) = cache.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&cache, bytes.as_ref()).ok()?;
    Some(cache.to_string_lossy().into_owned())
}

fn artifact_label(output_type: &str, summary: &str, raw_path: &str) -> String {
    let trimmed = summary.replace(raw_path, "");
    let trimmed = trimmed
        .trim_matches(|c: char| c.is_whitespace() || matches!(c, ':' | '-' | '–' | '—'))
        .trim();
    if trimmed.is_empty() {
        output_type.to_string()
    } else {
        format!("{output_type}: {trimmed}")
    }
}

fn extract_artifact_refs(text: &str) -> Vec<ParsedArtifactRef> {
    let mut refs = Vec::new();
    let mut seen = BTreeSet::new();

    for token in text.split_whitespace() {
        if let Some(reference) = parsed_artifact_ref(token) {
            if seen.insert(reference.path.clone()) {
                refs.push(reference);
            }
        }
        if refs.len() >= 3 {
            break;
        }
    }

    refs
}

fn parsed_artifact_ref(raw: &str) -> Option<ParsedArtifactRef> {
    let cleaned = clean_path_token(raw);
    let pathish = cleaned.strip_prefix("file://").unwrap_or(&cleaned);
    if !looks_like_file_reference(pathish) {
        return None;
    }
    let stripped = strip_line_suffix(pathish);
    let path = display_artifact_path(stripped)?;
    Some(ParsedArtifactRef { raw: cleaned, path })
}

fn clean_path_token(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | '{' | '}'
                )
        })
        .trim_end_matches(|c: char| matches!(c, ',' | ';' | '.'))
        .to_string()
}

fn strip_line_suffix(token: &str) -> &str {
    let Some((path, suffix)) = token.rsplit_once(':') else {
        return token;
    };
    if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
        path
    } else {
        token
    }
}

fn display_artifact_path(raw: &str) -> Option<String> {
    let raw = raw.strip_prefix("file://").unwrap_or(raw);
    if raw.is_empty() || raw.contains("://") {
        return None;
    }

    let path = std::path::Path::new(raw);
    if path.is_absolute() {
        if let Ok(cwd) = std::env::current_dir() {
            if let Ok(relative) = path.strip_prefix(cwd) {
                return Some(path_to_display(relative));
            }
        }
    }

    Some(raw.trim_start_matches("./").replace('\\', "/"))
}

fn path_to_display(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn looks_like_file_reference(raw: &str) -> bool {
    if raw.is_empty() || raw.contains("://") {
        return false;
    }
    let raw = strip_line_suffix(raw);
    let file_name = raw.rsplit('/').next().unwrap_or(raw);
    let Some((_, ext)) = file_name.rsplit_once('.') else {
        return raw.starts_with("./")
            || raw.starts_with('/')
            || raw.split('/').any(|segment| segment.contains('.'));
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "css"
            | "diff"
            | "gif"
            | "html"
            | "jpeg"
            | "jpg"
            | "js"
            | "json"
            | "lock"
            | "log"
            | "md"
            | "mjs"
            | "mov"
            | "mp4"
            | "patch"
            | "png"
            | "rs"
            | "sh"
            | "sql"
            | "svg"
            | "toml"
            | "ts"
            | "tsx"
            | "txt"
            | "webm"
            | "yaml"
            | "yml"
    )
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
        "Agent Chat".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut out = vec![Block::Header("Agent Work Chat".into())];

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
            label: if self.agent_active && self.streamed {
                "● live".into()
            } else if !self.agent_active && is_terminal_status(&self.status) {
                "✓ closed".into()
            } else if !self.agent_active && self.streamed {
                "◐ draining".into()
            } else {
                "○ connecting".into()
            },
            tone: if (self.agent_active && self.streamed)
                || (!self.agent_active && is_terminal_status(&self.status))
            {
                Tone::Landed
            } else if !self.agent_active && self.streamed {
                Tone::Engaged
            } else {
                Tone::Resting
            },
        });

        // Live conversation / tube tail. This is the Lane's primary evidence;
        // keep it above secondary tool chips so small panes still show the agent.
        out.push(Block::Header("conversation".into()));
        if self.lines.is_empty() {
            out.push(Block::KeyVal(
                "waiting".into(),
                "connected; waiting for transcript/tool/tube frames".into(),
            ));
        } else {
            // Show a viewport-sized tail with the newest event at the bottom.
            let start = self.lines.len().saturating_sub(VISIBLE_TAIL);
            for line in &self.lines[start..] {
                match line {
                    LaneLine::Chat {
                        speaker,
                        text,
                        tone,
                    } => out.push(Block::ChatTurn {
                        speaker: util::trunc(speaker, 32),
                        text: util::trunc(text, 160),
                        tone: *tone,
                    }),
                    LaneLine::Artifact {
                        label,
                        path,
                        preview,
                    } => out.push(Block::ArtifactRef {
                        label: util::trunc(label, 64),
                        path: util::trunc(path, 96),
                        preview: preview.clone(),
                        tone: Tone::Accent,
                    }),
                    LaneLine::ImageArtifact {
                        label,
                        path,
                        preview,
                        image_path,
                    } => out.push(Block::ImageArtifact {
                        label: util::trunc(label, 64),
                        path: util::trunc(path, 96),
                        preview: preview.clone(),
                        image_path: image_path.clone(),
                        tone: Tone::Accent,
                    }),
                }
            }
        }

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
                        let selected = self
                            .pinned_agent_id
                            .clone()
                            .or_else(|| Self::pick_agent(&v));
                        if let Some(id) = selected {
                            let active = util::arr(&v, "agents")
                                .iter()
                                .find(|agent| util::s(agent, "id") == id)
                                .is_some_and(|agent| util::b(agent, "isActive"));
                            // If the target changed, reset the live view for the new agent.
                            self.select_agent(Some(id));
                            self.agent_active = active;
                        } else if self.agent_id.is_some() {
                            // Preserve the completed transcript and receipt, but
                            // close the control path when the roster no longer
                            // contains the selected body. Keep the stream open:
                            // roster deregistration can beat the final durable
                            // transcript row by a few ticks.
                            self.agent_active = false;
                            if !is_terminal_status(&self.status) {
                                self.status = "finishing".into();
                            }
                        }
                    }
                    Err(e) => self.error = Some(format!("decode /agents: {e}")),
                },
                Err(e) => self.error = Some(format!("GET /agents: {e}")),
            }
            self.backfill_agent_channel(daemon).await;
            self.hydrate_image_artifacts(daemon).await;
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
                SurfaceAction::OperatorTurn { turn } => self.send_operator_turn(daemon, turn).await,
                // Roster selection / control verbs belong to conjoined
                // roster/detail surfaces (HarborPane); the Lane ignores them.
                _ => Ok(()),
            }
        })
    }

    fn subscription(&self) -> Option<Subscription> {
        (self.agent_active || !is_terminal_status(&self.status))
            .then(|| self.agent_id.clone())
            .flatten()
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
                    self.agent_active = !is_terminal_status(&s);
                    if !self.agent_active {
                        self.streamed = false;
                    }
                    self.status = s;
                }
            }
            StreamKind::Transcript => self.fold_transcript(&env.body),
            StreamKind::Tube => {
                self.fold_tube_body(
                    format!("tube:{}", digest_text(&env.body.to_string())),
                    "steer".into(),
                    &env.body,
                    Tone::Engaged,
                );
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
                LaneLine::Chat { text, .. } => Some(text.clone()),
                LaneLine::Artifact { .. } => None,
                LaneLine::ImageArtifact { .. } => None,
            })
            .collect()
    }

    fn chat_turns(lane: &LanePane) -> Vec<(String, String, Tone)> {
        lane.lines
            .iter()
            .filter_map(|line| match line {
                LaneLine::Chat {
                    speaker,
                    text,
                    tone,
                } => Some((speaker.clone(), text.clone(), *tone)),
                LaneLine::Artifact { .. } => None,
                LaneLine::ImageArtifact { .. } => None,
            })
            .collect()
    }

    fn artifact_paths(lane: &LanePane) -> Vec<String> {
        lane.lines
            .iter()
            .filter_map(|line| match line {
                LaneLine::Artifact { path, .. } => Some(path.clone()),
                LaneLine::ImageArtifact { path, .. } => Some(path.clone()),
                LaneLine::Chat { .. } => None,
            })
            .collect()
    }

    fn image_artifact_paths(lane: &LanePane) -> Vec<String> {
        lane.lines
            .iter()
            .filter_map(|line| match line {
                LaneLine::ImageArtifact { path, .. } => Some(path.clone()),
                LaneLine::Chat { .. } | LaneLine::Artifact { .. } => None,
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
    fn mission_receipt_pins_the_exact_agent_and_resets_unrelated_scrollback() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("unrelated-newest".into());
        lane.agent_active = true;
        lane.lines.push(LaneLine::Chat {
            speaker: "other".into(),
            text: "not this mission".into(),
            tone: Tone::Default,
        });

        lane.follow_agent(Some("mission-agent-7"));

        assert_eq!(lane.pinned_agent_id.as_deref(), Some("mission-agent-7"));
        assert_eq!(lane.agent_id.as_deref(), Some("mission-agent-7"));
        assert!(!lane.agent_active);
        assert!(lane.lines.is_empty());
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
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::ChatTurn { speaker, text, .. } if speaker == "agent" && text == "hello world")));
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ChatTurn { speaker, text, tone: Tone::Engaged } if speaker == "steer" && text.contains("control.interrupt")
        )));
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::Row(_))),
            "Lane transcript lines should not render as table/control rows"
        );
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

        let turns = chat_turns(&lane);
        assert!(turns
            .iter()
            .any(|(speaker, text, tone)| speaker == "thinking"
                && text.contains("checking the stream contract")
                && *tone == Tone::Resting));
        assert!(turns
            .iter()
            .any(|(speaker, text, _)| speaker == "agent"
                && text.contains("I found the cockpit route.")));
        let lines = transcript_lines(&lane);
        assert!(lines
            .iter()
            .any(|line| line.contains("artifact draft-pr: opened draft PR #123")));
        assert_eq!(lane.tools.len(), 1);
        assert_eq!(lane.tools[0].name, "rg");
        assert_eq!(lane.tools[0].state, ToolState::Ok);
    }

    #[test]
    fn structured_runtime_error_shows_its_message_instead_of_a_placeholder() {
        let mut lane = LanePane::new();
        lane.on_stream(&env(
            "agent.transcript",
            json!({
                "type": "update",
                "entry": {
                    "id": "tx-runtime-warning",
                    "messages": [{
                        "role": "tool",
                        "content": "[codex:error]",
                        "timestamp": 12,
                        "tool_calls": [{
                            "name": "error",
                            "args": {"message": "Falling back to the HTTPS transport."}
                        }]
                    }],
                    "outputs": []
                }
            }),
        ));

        assert!(chat_turns(&lane).iter().any(|(speaker, text, tone)| {
            speaker == "runtime"
                && text == "Falling back to the HTTPS transport."
                && *tone == Tone::Gated
        }));
        assert_eq!(
            lane.tools.last().map(|tool| tool.state),
            Some(ToolState::Failed)
        );
    }

    #[test]
    fn output_filename_renders_as_artifact_ref_block() {
        let mut lane = LanePane::new();
        lane.on_stream(&env(
            "agent.transcript",
            json!({
                "type": "update",
                "entry": {
                    "id": "tx-artifact",
                    "outputs": [
                        {
                            "type": "artifact",
                            "summary": "manual-pane-lane.png refreshed"
                        }
                    ]
                }
            }),
        ));

        assert_eq!(artifact_paths(&lane), vec!["manual-pane-lane.png"]);
        assert!(
            !transcript_lines(&lane)
                .iter()
                .any(|line| line.contains("artifact artifact")),
            "artifact filenames should render as artifact refs, not transcript prose"
        );

        let blocks = lane.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::ArtifactRef { label, path, preview, tone: Tone::Accent }
                if label == "artifact: refreshed"
                    && path == "manual-pane-lane.png"
                    && preview.as_deref() == Some("open / preview in current worktree")
        )));
    }

    #[test]
    fn transcript_file_references_emit_artifact_refs() {
        let mut lane = LanePane::new();
        lane.on_stream(&env("agent.transcript", json!({
            "type": "update",
            "entry": {
                "id": "tx-file-ref",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "Updated core/pd-console/src/lane_pane.rs:264 for artifact rows.",
                        "timestamp": 12
                    }
                ]
            }
        })));

        assert!(transcript_lines(&lane)
            .iter()
            .any(|line| line.contains("Updated core/pd-console/src/lane_pane.rs:264")));
        assert_eq!(
            artifact_paths(&lane),
            vec!["core/pd-console/src/lane_pane.rs"]
        );
    }

    #[test]
    fn visual_task_tube_event_renders_screenshot_image_artifact() {
        let mut lane = LanePane::new();
        let blob = format!("/blob/{}", "a".repeat(64));
        lane.on_stream(&env(
            "agent.tube",
            json!({
                "kind": "visual-task",
                "taskId": "visual-task-proof",
                "title": "Checkout button is clipped",
                "description": "The lower half is hidden behind the cart footer.",
                "pageUrl": "http://localhost:5173/cart",
                "image": {
                    "mimeType": "image/png",
                    "blobUrl": blob,
                    "width": 1440,
                    "height": 900
                },
                "region": {
                    "x": 20,
                    "y": 30,
                    "width": 220,
                    "height": 80,
                    "coordinateSpace": "viewport"
                },
                "channel": { "name": "visual-feedback", "messageId": 7 }
            }),
        ));

        assert!(chat_turns(&lane).iter().any(|(speaker, text, tone)| {
            speaker == "scout"
                && text.contains("Scout captured visual task")
                && text.contains("Checkout button is clipped")
                && *tone == Tone::Engaged
        }));
        assert_eq!(
            image_artifact_paths(&lane),
            vec![format!("/blob/{}", "a".repeat(64))]
        );
        let blocks = lane.view();
        assert!(blocks.iter().any(|block| matches!(
        block,
        Block::ImageArtifact { label, path, preview, image_path, tone: Tone::Accent }
            if label.contains("visual task screenshot")
                && path == &format!("/blob/{}", "a".repeat(64))
                && preview.as_deref().unwrap_or("").contains("region viewport 20,30 220x80")
                && preview.as_deref().unwrap_or("").contains("payload visual-feedback")
                && image_path.is_none()
        )));
    }

    #[test]
    fn steering_channel_backfill_uses_visual_task_folding() {
        let mut lane = LanePane::new();
        let blob = format!("/blob/{}", "b".repeat(64));
        lane.fold_tube_body(
            "channel:agent:proof:1".into(),
            "chrome-extension-visual".into(),
            &json!({
                "kind": "visual-task",
                "taskId": "visual-task-backfill",
                "title": "Checkout button is clipped",
                "image": {
                    "mimeType": "image/png",
                    "blobUrl": blob
                },
                "channel": { "name": "visual-feedback", "messageId": 1 }
            }),
            Tone::Default,
        );

        assert_eq!(
            image_artifact_paths(&lane),
            vec![format!("/blob/{}", "b".repeat(64))]
        );
        assert!(chat_turns(&lane).iter().any(|(speaker, text, tone)| {
            speaker == "scout"
                && text.contains("Scout captured visual task")
                && *tone == Tone::Engaged
        }));
    }

    #[test]
    fn folds_real_daemon_transcript_start_and_end_metadata() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("a".into());
        lane.agent_active = true;
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
        assert_eq!(lane.status, "completed");
        assert!(!lane.has_agent());
        assert!(!lane.streamed);
        assert!(lane.subscription().is_none());
        assert!(lane.view().iter().any(|block| matches!(
            block,
            Block::Chip { label, tone: Tone::Landed } if label == "✓ closed"
        )));
    }

    #[test]
    fn blocked_agent_remains_live_for_operator_gate_response() {
        let mut lane = LanePane::new();
        lane.agent_id = Some("agent-gated".into());
        lane.agent_active = true;

        lane.on_stream(&env("agent.status", json!({"status": "blocked"})));

        assert_eq!(lane.status, "blocked");
        assert!(lane.has_agent());
        assert!(lane.subscription().is_some());
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
    fn operator_turn_context_renders_as_chat_and_artifacts() {
        let mut lane = LanePane::new();
        let turn = OperatorTurn::parse(
            "Please inspect this @core/pd-console/src/main.rs\n@photo /tmp/lane proof.png\n@skill native-app-designer\n@tool cargo check",
        );

        lane.push_operator_turn(&turn);

        let turns = chat_turns(&lane);
        assert!(turns.iter().any(|(speaker, text, tone)| speaker == "you"
            && text == "Please inspect this"
            && *tone == Tone::Accent));
        assert!(turns.iter().any(|(speaker, text, tone)| speaker == "skill"
            && text.contains("native-app-designer")
            && *tone == Tone::Engaged));
        assert!(turns.iter().any(|(speaker, text, tone)| speaker == "tool"
            && text.contains("cargo check")
            && *tone == Tone::Engaged));
        assert_eq!(
            artifact_paths(&lane),
            vec![
                "core/pd-console/src/main.rs".to_string(),
                "/tmp/lane proof.png".to_string()
            ]
        );
        let blocks = lane.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::ArtifactRef { label, path, preview, .. }
                if label == "file attachment"
                    && path == "core/pd-console/src/main.rs"
                    && preview.as_deref() == Some("attached file / open in current worktree")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::ArtifactRef { label, path, preview, .. }
                if label == "photo attachment"
                    && path == "/tmp/lane proof.png"
                    && preview.as_deref() == Some("attached photo / open in current worktree")
        )));
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
    fn visible_lane_projects_only_the_newest_viewport_sized_tail() {
        let mut lane = LanePane::new();
        for i in 0..(VISIBLE_TAIL + 3) {
            lane.on_stream(&env(
                "agent.transcript",
                json!({"text": format!("line {i}")}),
            ));
        }

        let visible = lane
            .view()
            .into_iter()
            .filter_map(|block| match block {
                Block::ChatTurn { text, .. } => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            visible,
            vec!["line 3", "line 4", "line 5", "line 6"],
            "the live pane should keep its newest event above fixed controls"
        );
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
