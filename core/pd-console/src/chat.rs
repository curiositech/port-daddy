//! Mission conversation — the render-agnostic MODEL, kept gpui-free so it
//! compiles into (and is unit-tested by) the headless `pd-console-repl` bin.
//!
//! The GPUI shell (`app.rs`) owns the bespoke bubble rendering + the rolled-own
//! text input; this module owns the *state* it renders:
//!   * `ChatMsg`  — one attributed operator, assistant, or receipt turn.
//!   * `ChatLog`  — the ordered transcript plus a transient error banner.
//!   * `ChatState` — the three render states (empty / populated / error) the
//!     pane must handle (rust-with-claude-code "three states").
//!   * `ChatUpdate` — the bus message the background transport thread pushes back
//!     to the view (a real reply down the tube, or a transport error).
//!
//! Transport lives in `main.rs` (it owns the daemon client + the 2s loop): an
//! existing governed agent receives the operator turn over its tube; otherwise
//! the turn is captured as a WorkIntent and its attributed responder is bound
//! back to this conversation. This module never touches the network.

use crate::pane::{Block, Tone};

/// The visible provenance class for a Mission turn. A daemon receipt is not
/// rendered as if it were an assistant answer: admission and language stay
/// visibly different.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatMsgKind {
    Operator,
    Assistant,
    Receipt,
}

/// One attributed turn in the conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMsg {
    /// Who emitted it — "operator", a concrete agent id, or a receipt source.
    pub sender: String,
    pub text: String,
    pub kind: ChatMsgKind,
    /// Daemon-authored epoch milliseconds when available; locally-authored
    /// turns are stamped at capture time. `None` is rendered as unknown rather
    /// than inventing a time during legacy transcript recovery.
    pub timestamp_ms: Option<i64>,
}

impl ChatMsg {
    /// The operator's own turn (optimistically shown the instant Send fires).
    pub fn mine(text: impl Into<String>) -> Self {
        Self::mine_at(text, Some(now_epoch_ms()))
    }

    pub fn mine_at(text: impl Into<String>, timestamp_ms: Option<i64>) -> Self {
        Self {
            sender: "operator".into(),
            text: text.into(),
            kind: ChatMsgKind::Operator,
            timestamp_ms,
        }
    }
    /// A reply from the bound agent, carrying the tube sender id.
    pub fn agent(sender: impl Into<String>, text: impl Into<String>) -> Self {
        Self::agent_at(sender, text, Some(now_epoch_ms()))
    }

    pub fn agent_at(
        sender: impl Into<String>,
        text: impl Into<String>,
        timestamp_ms: Option<i64>,
    ) -> Self {
        Self {
            sender: sender.into(),
            text: text.into(),
            kind: ChatMsgKind::Assistant,
            timestamp_ms,
        }
    }
    /// A deterministic admission/control receipt, never assistant prose.
    pub fn receipt(source: impl Into<String>, text: impl Into<String>) -> Self {
        Self::receipt_at(source, text, Some(now_epoch_ms()))
    }

    pub fn receipt_at(
        source: impl Into<String>,
        text: impl Into<String>,
        timestamp_ms: Option<i64>,
    ) -> Self {
        Self {
            sender: source.into(),
            text: text.into(),
            kind: ChatMsgKind::Receipt,
            timestamp_ms,
        }
    }

    pub fn is_operator(&self) -> bool {
        self.kind == ChatMsgKind::Operator
    }

    /// Compare the durable payload while ignoring a receive-time stamp. This
    /// keeps an SSE replay from duplicating the final turn after hydration.
    pub fn same_payload(&self, other: &Self) -> bool {
        self.sender == other.sender && self.text == other.text && self.kind == other.kind
    }

    pub fn timestamp_label(&self) -> String {
        chat_timestamp_label(self.timestamp_ms)
    }
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

/// Compact, explicit UTC label shared by the GPUI and terminal faces. Keeping
/// the zone visible is more honest than presenting daemon epoch time as local.
pub fn chat_timestamp_label(timestamp_ms: Option<i64>) -> String {
    let Some(timestamp_ms) = timestamp_ms else {
        return "time unavailable".into();
    };
    let Ok(stamp) = time::OffsetDateTime::from_unix_timestamp(timestamp_ms.div_euclid(1_000))
    else {
        return "time unavailable".into();
    };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        stamp.year(),
        stamp.month() as u8,
        stamp.day(),
        stamp.hour(),
        stamp.minute(),
        stamp.second()
    )
}

pub const CHAT_COLLAPSE_CHARS: usize = 420;

pub fn chat_needs_expansion(text: &str) -> bool {
    text.chars().count() > CHAT_COLLAPSE_CHARS || text.lines().count() > 8
}

/// Unicode-safe preview for long Mission turns. The complete daemon transcript
/// stays in memory and one click restores it; this is presentation, not loss.
pub fn chat_excerpt(text: &str) -> String {
    if !chat_needs_expansion(text) {
        return text.to_string();
    }
    let preview = text.chars().take(CHAT_COLLAPSE_CHARS).collect::<String>();
    format!("{}…", preview.trim_end())
}

/// Text that is safe to hand to the native GPUI text element and the shared
/// terminal/repl renderer. GPUI's `String` child renders as text, not HTML, so
/// keep markup-looking chat literal; only neutralize control characters that can
/// perturb terminal output or invisible layout state.
pub fn chat_display_text(raw: &str) -> String {
    raw.chars()
        .map(|ch| match ch {
            '\n' | '\t' => ch,
            ch if ch.is_control() => '\u{FFFD}',
            ch => ch,
        })
        .collect()
}

/// The GPUI error banner text. Kept in the GPUI-free model so tests can pin the
/// same display contract the native pane uses.
pub fn chat_error_display_text(reason: &str) -> String {
    format!("⚠ {}", chat_display_text(reason))
}

/// The first Mission turn becomes the WorkIntent goal verbatim. The console is
/// an operator surface, not a hidden prompt author: policy, admission, and
/// execution metadata travel in their own typed fields and receipts.
pub fn mission_goal_for_operator_turn(text: &str) -> String {
    text.to_string()
}

/// The deterministic admission receipt shown between the operator prompt and
/// attributed assistant prose. Keeping this constructor shared makes live and
/// restart-rehydrated Mission conversations byte-identical.
pub fn mission_admission_receipt(
    intent_id: &str,
    execution_id: &str,
    runtime_state: &str,
    agent_id: Option<&str>,
) -> ChatMsg {
    let continuation = if agent_id.map(str::trim).is_some_and(|id| !id.is_empty()) {
        "The attributed agent reply follows on its transcript stream."
    } else {
        "No governed agent or transcript is attached to this execution."
    };
    ChatMsg::receipt(
        "Port Daddy receipt",
        format!(
            "WorkIntent {intent_id} admitted · execution {execution_id} · runtime {runtime_state}. {continuation}"
        ),
    )
}

/// Terminal runtime truth is a receipt, not assistant language. It is appended
/// even when the WorkIntent projection is stale so Mission never implies a
/// killed or failed responder is still thinking.
pub fn mission_terminal_receipt(
    status: &str,
    error: Option<&str>,
    timestamp_ms: Option<i64>,
) -> ChatMsg {
    let mut text = format!("Run ended · {}", status.trim().to_ascii_uppercase());
    if let Some(error) = error.map(str::trim).filter(|error| !error.is_empty()) {
        text.push_str(&format!(" · {error}"));
    }
    text.push_str(". This execution is no longer running.");
    ChatMsg::receipt_at("Port Daddy runtime", text, timestamp_ms)
}

/// Decide whether a new operator turn belongs to the currently-bound mission.
///
/// The durable execution state wins over a briefly-stale roster heartbeat: once
/// a mission reaches review or a terminal state, the next turn starts a fresh
/// WorkIntent even if the lane has not observed the agent exit yet. Conversely,
/// an admitted mission that is still binding keeps ownership of follow-up turns
/// before its exact agent appears in the roster.
pub fn routes_to_existing_mission_body(
    execution_state: Option<&str>,
    has_live_agent: bool,
) -> bool {
    match execution_state
        .map(str::trim)
        .filter(|state| !state.is_empty())
    {
        Some("starting" | "proposed" | "claimed" | "in_progress") => true,
        Some(
            "not-started" | "produced" | "review_pending" | "accepted" | "settled" | "failed"
            | "error" | "complete" | "completed" | "done" | "killed" | "aborted" | "over_budget"
            | "timed_out" | "timeout" | "salvage" | "rejected" | "refused" | "halted" | "cancelled"
            | "canceled",
        ) => false,
        Some(_) | None => has_live_agent,
    }
}

/// Admit a Lane frame into Mission only when it belongs to the body named by
/// the current WorkIntent. The general Lane may independently follow the newest
/// roster agent, but that is not authority to splice its prose or terminal
/// state into an unrelated mission. An explicit operator-selected agent is the
/// only non-WorkIntent conversation allowed through this gate.
pub fn lane_frame_routes_to_mission(
    operator_selected_agent: bool,
    mission_agent_id: Option<&str>,
    lane_agent_id: &str,
) -> bool {
    if operator_selected_agent {
        return true;
    }
    mission_agent_id
        .map(str::trim)
        .filter(|agent_id| !agent_id.is_empty())
        .is_some_and(|agent_id| agent_id == lane_agent_id.trim())
}

/// The three render states a chat pane must handle. Drives the test gate and the
/// honest empty/error affordances (never a blank pane).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatState {
    /// No turns yet — show the "say hello" placeholder, not emptiness.
    Empty,
    /// At least one turn — render the bubbles.
    Populated,
    /// The last transport action failed; surface the refusal reason.
    Error,
}

/// The conversation transcript plus a transient transport error. The view stores
/// one of these per chat pane; the background thread folds replies in via
/// [`ChatLog::push`] and errors via [`ChatLog::set_error`].
#[derive(Debug, Clone, Default)]
pub struct ChatLog {
    pub messages: Vec<ChatMsg>,
    /// Set when a transport or WorkIntent capture was refused; cleared when a new turn lands so a
    /// stale failure never sticks once the channel recovers.
    pub error: Option<String>,
    /// True after an operator turn until attributed assistant prose or a refusal
    /// lands. A receipt alone confirms admission, not an answer.
    pub awaiting_reply: bool,
}

impl ChatLog {
    /// Clear daemon-bound conversation state. A Mission transcript belongs to
    /// the daemon berth that admitted it; carrying it across a rebind would
    /// present stale prose and receipts as if they came from the new target.
    pub fn reset(&mut self) {
        self.messages.clear();
        self.error = None;
        self.awaiting_reply = false;
    }

    /// Replace volatile window state with the daemon's durable conversation.
    /// This is used after launch/rebind and after terminal transcript finalization;
    /// it deliberately replaces rather than appends so reconnects cannot duplicate
    /// operator or assistant bubbles.
    pub fn hydrate(&mut self, messages: Vec<ChatMsg>, awaiting_reply: bool) {
        self.messages = messages;
        self.error = None;
        self.awaiting_reply = awaiting_reply;
    }

    /// Which of the three render states the pane is in. Error takes precedence
    /// (a failed turn is the most important thing to surface), then populated,
    /// then empty.
    pub fn state(&self) -> ChatState {
        if self.error.is_some() {
            ChatState::Error
        } else if self.messages.is_empty() {
            ChatState::Empty
        } else {
            ChatState::Populated
        }
    }

    /// Append a turn, clearing any prior error (the channel is making progress).
    pub fn push(&mut self, msg: ChatMsg) {
        self.error = None;
        self.messages.push(msg);
    }

    /// Optimistically append the operator's own turn (shown before the tube round-trips).
    pub fn push_mine(&mut self, text: impl Into<String>) {
        self.push(ChatMsg::mine(text));
        self.awaiting_reply = true;
    }

    /// Fold in a real reply that came down the tube.
    pub fn push_agent(&mut self, sender: impl Into<String>, text: impl Into<String>) {
        let message = ChatMsg::agent(sender, text);
        self.push_agent_message(message);
    }

    pub fn push_agent_message(&mut self, message: ChatMsg) {
        // A reconnect can hydrate the finalized transcript immediately before
        // the agent stream replays its last assistant frame. Drop only that
        // exact adjacent duplicate; identical answers separated by a new
        // operator turn remain distinct conversation history.
        if !self
            .messages
            .last()
            .is_some_and(|existing| existing.same_payload(&message))
        {
            self.push(message);
        }
        self.awaiting_reply = false;
    }

    /// Append deterministic runtime provenance without impersonating the agent.
    pub fn push_receipt(&mut self, source: impl Into<String>, text: impl Into<String>) {
        self.push(ChatMsg::receipt(source, text));
    }

    pub fn push_receipt_message(&mut self, message: ChatMsg, terminal: bool) {
        if !self
            .messages
            .last()
            .is_some_and(|existing| existing.same_payload(&message))
        {
            self.push(message);
        }
        if terminal {
            self.awaiting_reply = false;
        }
    }

    /// Record a transport failure (a daemon refusal, no control plane, etc.).
    pub fn set_error(&mut self, err: impl Into<String>) {
        self.error = Some(err.into());
        self.awaiting_reply = false;
    }

    pub fn finish_waiting(&mut self) {
        self.awaiting_reply = false;
    }

    /// Render the transcript as render-agnostic [`Block`]s — the terminal face and
    /// the headless test surface. The GPUI shell renders bespoke bubbles instead,
    /// but both read the same model, so this never drifts from what the operator sees.
    pub fn blocks(&self) -> Vec<Block> {
        let mut out = vec![Block::Header("mission".into())];
        if let Some(err) = &self.error {
            out.push(Block::WrappedText {
                text: format!("error: {}", chat_display_text(err)),
                tone: Tone::Conflicted,
            });
        }
        if self.messages.is_empty() {
            if self.error.is_none() {
                out.push(Block::KeyVal(
                    "status".into(),
                    "no messages yet — type below and press Enter to talk".into(),
                ));
            }
            return out;
        }
        for m in &self.messages {
            let label = match m.kind {
                ChatMsgKind::Operator => "you".to_string(),
                ChatMsgKind::Assistant | ChatMsgKind::Receipt => chat_display_text(&m.sender),
            };
            let tone = match m.kind {
                ChatMsgKind::Operator => Tone::Accent,
                ChatMsgKind::Assistant => Tone::Default,
                ChatMsgKind::Receipt => Tone::Engaged,
            };
            out.push(Block::WrappedText {
                text: format!(
                    "{label} · {}: {}",
                    m.timestamp_label(),
                    chat_display_text(&m.text)
                ),
                tone,
            });
        }
        if self.awaiting_reply {
            out.push(Block::Chip {
                label: "waiting for attributed agent reply".into(),
                tone: Tone::Engaged,
            });
        }
        out
    }
}

/// A push from the background transport thread back to the view. The thread owns
/// the daemon client (reqwest off the gpui executor); it streams results here over
/// an mpsc channel that the foreground drains and folds into [`ChatLog`].
#[derive(Debug, Clone)]
pub enum ChatUpdate {
    /// A real reply that came DOWN the tube (`tube_poll`) or inline from a one-shot
    /// spawn (ollama) — never the operator's own echo.
    Reply(ChatMsg),
    /// Deterministic WorkIntent/admission provenance. This confirms a state
    /// transition but is never presented as language from the model.
    Receipt(ChatMsg),
    /// Daemon-authored terminal runtime truth. Unlike an admission receipt this
    /// ends the waiting state even if the WorkIntent projection still says run.
    Terminal { receipt: ChatMsg, status: String },
    /// A daemon-read transcript projection after launch/rebind. Replaces local
    /// bubbles atomically so a cold Mission is still a real conversation.
    Hydrate {
        messages: Vec<ChatMsg>,
        awaiting_reply: bool,
        terminal_status: Option<String>,
    },
    /// The console rebound to another daemon/state plane. Conversation state
    /// is berth-scoped and must not leak across that boundary.
    Reset,
    /// A transport failure to surface in the error state (spawn/send refusal).
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pull the readable text out of a Block for assertions (Header/KeyVal/WrappedText).
    fn block_text(b: &Block) -> String {
        match b {
            Block::Header(s) => s.clone(),
            Block::KeyVal(k, v) => format!("{k}: {v}"),
            Block::WrappedText { text, .. } => text.clone(),
            Block::Row(cells) => cells.join(" "),
            Block::Chip { label, .. } => label.clone(),
            _ => String::new(),
        }
    }

    fn joined(blocks: &[Block]) -> String {
        blocks.iter().map(block_text).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn lane_frames_require_the_exact_mission_body() {
        assert!(lane_frame_routes_to_mission(
            false,
            Some("mission-agent"),
            "mission-agent"
        ));
        assert!(!lane_frame_routes_to_mission(
            false,
            Some("mission-agent"),
            "newest-unrelated-agent"
        ));
        assert!(!lane_frame_routes_to_mission(
            false,
            None,
            "newest-unrelated-agent"
        ));
        assert!(lane_frame_routes_to_mission(
            true,
            None,
            "operator-selected-agent"
        ));
    }

    // ── The three states (rust-with-claude-code "three states") ────────────────

    #[test]
    fn empty_state_renders_a_placeholder_not_a_blank_pane() {
        let log = ChatLog::default();
        assert_eq!(log.state(), ChatState::Empty);
        let blocks = log.blocks();
        // Always a header; never zero blocks (a blank pane is a defect).
        assert!(!blocks.is_empty());
        assert!(matches!(blocks[0], Block::Header(_)));
        assert!(
            joined(&blocks).contains("no messages yet"),
            "empty chat must invite the operator to talk, got: {}",
            joined(&blocks)
        );
    }

    #[test]
    fn populated_state_renders_both_sides_in_order() {
        let mut log = ChatLog::default();
        log.push_mine("what's the roadmap status?");
        log.push_agent("claude-cli", "Phase 3 is the hottest lane.");
        assert_eq!(log.state(), ChatState::Populated);
        assert_eq!(log.messages.len(), 2);
        assert!(log.messages[0].is_operator());
        assert!(!log.messages[1].is_operator());
        let text = joined(&log.blocks());
        assert!(
            text.contains("you · ") && text.contains("what's the roadmap status?"),
            "missing operator turn: {text}"
        );
        assert!(
            text.contains("claude-cli · ") && text.contains("Phase 3 is the hottest lane."),
            "missing reply: {text}"
        );
    }

    #[test]
    fn error_state_surfaces_the_failure_reason() {
        let mut log = ChatLog::default();
        log.set_error("spawn rejected: budget ceiling required");
        assert_eq!(log.state(), ChatState::Error);
        let text = joined(&log.blocks());
        assert!(
            text.contains("error:") && text.contains("budget ceiling required"),
            "error state must show the full reason untruncated, got: {text}"
        );
    }

    // ── Transitions ────────────────────────────────────────────────────────────

    #[test]
    fn error_takes_precedence_even_with_messages() {
        // A reply landed, then the NEXT send failed: the error is the headline.
        let mut log = ChatLog::default();
        log.push_mine("hi");
        log.set_error("send failed: HTTP 503");
        assert_eq!(log.state(), ChatState::Error);
    }

    #[test]
    fn a_new_turn_clears_a_stale_error() {
        let mut log = ChatLog::default();
        log.set_error("transient daemon blip");
        assert_eq!(log.state(), ChatState::Error);
        // The channel recovered and a reply arrived → the error must not stick.
        log.push_agent("claude-cli", "back online");
        assert_eq!(log.state(), ChatState::Populated);
        assert!(log.error.is_none());
    }

    #[test]
    fn replies_filter_the_operators_own_echo_by_construction() {
        // The transport only ever wraps NON-operator tube messages as Reply, so an
        // agent ChatMsg is never `mine` — proving the bubble side can't be spoofed.
        let reply = ChatMsg::agent("operator-look-alike", "hello");
        assert!(!reply.is_operator());
        let mine = ChatMsg::mine("hello");
        assert!(mine.is_operator());
        assert_eq!(mine.sender, "operator");
    }

    #[test]
    fn runtime_receipt_does_not_impersonate_an_assistant_reply() {
        let mut log = ChatLog::default();
        log.push_mine("inspect the active claims");
        log.push_receipt("port-daddy receipt", "intent wi-1 admitted");

        assert!(log.awaiting_reply, "admission is not the requested answer");
        assert_eq!(log.messages[1].kind, ChatMsgKind::Receipt);
        let rendered = joined(&log.blocks());
        assert!(rendered.contains("port-daddy receipt · "));
        assert!(rendered.contains("intent wi-1 admitted"));

        log.push_agent("agent-7", "Three claim groups need attention.");
        assert!(!log.awaiting_reply);
    }

    #[test]
    fn durable_hydration_replaces_stale_bubbles_without_duplication() {
        let mut log = ChatLog::default();
        log.push_mine("stale berth prompt");
        log.push_agent("agent-old", "stale berth answer");

        log.hydrate(
            vec![
                ChatMsg::mine("durable mission prompt"),
                mission_admission_receipt("wi-7", "dispatch-7", "settled", Some("agent-7")),
                ChatMsg::agent("agent-7", "durable mission answer"),
            ],
            false,
        );

        assert_eq!(log.messages.len(), 3);
        assert_eq!(log.messages[0].text, "durable mission prompt");
        assert_eq!(log.messages[1].kind, ChatMsgKind::Receipt);
        assert_eq!(log.messages[2].text, "durable mission answer");
        assert!(!joined(&log.blocks()).contains("stale berth"));
        assert!(!log.awaiting_reply);
    }

    #[test]
    fn stream_replay_does_not_duplicate_the_hydrated_final_answer() {
        let mut log = ChatLog::default();
        log.hydrate(
            vec![
                ChatMsg::mine("prompt"),
                mission_admission_receipt("wi-1", "d-1", "settled", Some("agent-1")),
                ChatMsg::agent("agent-1", "same answer"),
            ],
            false,
        );

        log.push_agent("agent-1", "same answer");
        assert_eq!(log.messages.len(), 3);

        log.push_mine("say it again");
        log.push_agent("agent-1", "same answer");
        assert_eq!(log.messages.len(), 5);
    }

    #[test]
    fn admission_without_an_agent_does_not_promise_a_reply() {
        let receipt = mission_admission_receipt("wi-hold", "dispatch-hold", "salvage", None);
        assert!(receipt
            .text
            .contains("No governed agent or transcript is attached"));
        assert!(!receipt.text.contains("reply follows"));
    }

    #[test]
    fn markup_like_chat_text_stays_literal_plain_text() {
        let payload = r#"<script>alert("pd")</script> & <b>bold?</b>"#;
        let mut log = ChatLog::default();
        log.push_mine(payload);

        let text = joined(&log.blocks());
        assert!(
            text.contains(payload),
            "native chat text should preserve literal markup-looking input: {text}"
        );
        assert!(
            !text.contains("&lt;script&gt;"),
            "GPUI is not HTML; escaping would corrupt the transcript: {text}"
        );
    }

    #[test]
    fn untrusted_display_text_neutralizes_control_characters() {
        let raw = "agent\u{1b}[31m says <img src=x onerror=alert(1)>";
        let display = chat_display_text(raw);

        assert!(
            !display.contains('\u{1b}'),
            "escape/control characters must not reach renderers: {display:?}"
        );
        assert!(
            display.contains("<img src=x onerror=alert(1)>"),
            "HTML-looking text remains literal native text, not escaped markup: {display}"
        );
    }

    #[test]
    fn error_banner_text_uses_the_same_plain_text_contract() {
        let banner = chat_error_display_text("spawn refused <svg onload=alert(1)>\u{1b}[0m");

        assert!(banner.starts_with("⚠ spawn refused "));
        assert!(banner.contains("<svg onload=alert(1)>"));
        assert!(
            !banner.contains('\u{1b}'),
            "error banner must neutralize controls: {banner:?}"
        );
    }

    #[test]
    fn first_mission_turn_is_not_rewritten_into_a_hidden_prompt() {
        let operator_turn = "Inspect the live claim tree.\nAnswer in one sentence.";

        assert_eq!(
            mission_goal_for_operator_turn(operator_turn),
            operator_turn,
            "the WorkIntent goal must preserve the operator's exact text"
        );
    }

    #[test]
    fn in_flight_mission_owns_follow_up_turns_before_its_agent_binds() {
        for state in ["starting", "proposed", "claimed", "in_progress"] {
            assert!(
                routes_to_existing_mission_body(Some(state), false),
                "{state} is still the same governed mission"
            );
        }
    }

    #[test]
    fn completed_mission_never_captures_the_next_turn_even_with_a_stale_live_roster() {
        for state in [
            "produced",
            "review_pending",
            "accepted",
            "settled",
            "failed",
            "salvage",
            "rejected",
            "killed",
            "aborted",
            "over_budget",
            "timed_out",
        ] {
            assert!(
                !routes_to_existing_mission_body(Some(state), true),
                "{state} must release the composer for a new WorkIntent"
            );
        }
    }

    #[test]
    fn unknown_execution_state_falls_back_to_observed_agent_liveness() {
        assert!(routes_to_existing_mission_body(
            Some("future-running-state"),
            true
        ));
        assert!(!routes_to_existing_mission_body(
            Some("future-running-state"),
            false
        ));
        assert!(routes_to_existing_mission_body(None, true));
        assert!(!routes_to_existing_mission_body(None, false));
    }

    #[test]
    fn daemon_rebind_clears_conversation_receipts_and_waiting_state() {
        let mut log = ChatLog::default();
        log.push_mine("inspect the old berth");
        log.push_receipt("old receipt", "intent old-1 admitted");
        log.set_error("old berth disconnected");

        log.reset();

        assert_eq!(log.state(), ChatState::Empty);
        assert!(log.messages.is_empty());
        assert!(log.error.is_none());
        assert!(!log.awaiting_reply);
    }

    #[test]
    fn durable_timestamps_are_explicit_and_missing_time_is_not_invented() {
        assert_eq!(
            chat_timestamp_label(Some(1_788_590_537_856)),
            "2026-09-05 06:42:17 UTC"
        );
        assert_eq!(chat_timestamp_label(None), "time unavailable");
    }

    #[test]
    fn long_turn_preview_is_unicode_safe_and_the_full_text_remains_available() {
        let text = format!("{}é-tail", "context ".repeat(80));
        assert!(chat_needs_expansion(&text));
        let preview = chat_excerpt(&text);
        assert!(preview.ends_with('…'));
        assert!(preview.chars().count() <= CHAT_COLLAPSE_CHARS + 1);
        assert_eq!(text.chars().last(), Some('l'));
    }

    #[test]
    fn terminal_receipt_ends_waiting_and_replay_does_not_duplicate_it() {
        let mut log = ChatLog::default();
        log.push_mine("inspect the checkout");
        let terminal =
            mission_terminal_receipt("killed", Some("Killed by spawner"), Some(1_788_590_537_856));
        log.push_receipt_message(terminal.clone(), true);
        log.push_receipt_message(terminal, true);

        assert!(!log.awaiting_reply);
        assert_eq!(log.messages.len(), 2);
        assert_eq!(log.messages[1].kind, ChatMsgKind::Receipt);
        assert!(log.messages[1].text.contains("KILLED"));
        assert!(log.messages[1]
            .text
            .contains("This execution is no longer running"));
    }
}
