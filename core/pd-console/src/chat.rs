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
}

impl ChatMsg {
    /// The operator's own turn (optimistically shown the instant Send fires).
    pub fn mine(text: impl Into<String>) -> Self {
        Self {
            sender: "operator".into(),
            text: text.into(),
            kind: ChatMsgKind::Operator,
        }
    }
    /// A reply from the bound agent, carrying the tube sender id.
    pub fn agent(sender: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            sender: sender.into(),
            text: text.into(),
            kind: ChatMsgKind::Assistant,
        }
    }
    /// A deterministic admission/control receipt, never assistant prose.
    pub fn receipt(source: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            sender: source.into(),
            text: text.into(),
            kind: ChatMsgKind::Receipt,
        }
    }

    pub fn is_operator(&self) -> bool {
        self.kind == ChatMsgKind::Operator
    }
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
) -> ChatMsg {
    ChatMsg::receipt(
        "Port Daddy receipt",
        format!(
            "WorkIntent {intent_id} admitted · execution {execution_id} · runtime {runtime_state}. The attributed agent reply follows on its transcript stream."
        ),
    )
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
            | "salvage" | "rejected" | "refused" | "halted" | "cancelled" | "canceled",
        ) => false,
        Some(_) | None => has_live_agent,
    }
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
        // A reconnect can hydrate the finalized transcript immediately before
        // the agent stream replays its last assistant frame. Drop only that
        // exact adjacent duplicate; identical answers separated by a new
        // operator turn remain distinct conversation history.
        if self.messages.last() != Some(&message) {
            self.push(message);
        }
        self.awaiting_reply = false;
    }

    /// Append deterministic runtime provenance without impersonating the agent.
    pub fn push_receipt(&mut self, source: impl Into<String>, text: impl Into<String>) {
        self.push(ChatMsg::receipt(source, text));
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
                text: format!("{label}: {}", chat_display_text(&m.text)),
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
    /// A daemon-read transcript projection after launch/rebind. Replaces local
    /// bubbles atomically so a cold Mission is still a real conversation.
    Hydrate {
        messages: Vec<ChatMsg>,
        awaiting_reply: bool,
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
            text.contains("you: what's the roadmap status?"),
            "missing operator turn: {text}"
        );
        assert!(
            text.contains("claude-cli: Phase 3 is the hottest lane."),
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
        assert!(joined(&log.blocks()).contains("port-daddy receipt: intent wi-1 admitted"));

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
                mission_admission_receipt("wi-7", "dispatch-7", "settled"),
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
                mission_admission_receipt("wi-1", "d-1", "settled"),
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
}
