//! Operator chat — the render-agnostic conversation MODEL, kept gpui-free so it
//! compiles into (and is unit-tested by) the headless `pd-console-repl` bin.
//!
//! The GPUI shell (`app.rs`) owns the bespoke bubble rendering + the rolled-own
//! text input; this module owns the *state* it renders:
//!   * `ChatMsg`  — one turn (mine vs the agent's), backend-agnostic.
//!   * `ChatLog`  — the ordered transcript plus a transient error banner.
//!   * `ChatState` — the three render states (empty / populated / error) the
//!     pane must handle (rust-with-claude-code "three states").
//!   * `ChatUpdate` — the bus message the background transport thread pushes back
//!     to the view (a real reply down the tube, or a transport error).
//!
//! Transport lives in `main.rs` (it owns the daemon client + the 2s loop): the
//! operator's turn rides UP the tube via `DaemonClient::tube_send`, and replies
//! come DOWN via `tube_poll` — both on a stable per-conversation channel. This
//! module never touches the network; it is pure data so the test gate can prove
//! the three states without a daemon.

use crate::pane::{Block, Tone};

/// One turn in the conversation. `mine` distinguishes the operator's own message
/// (right-aligned, accent bubble) from an agent reply (left-aligned, cobalt rail).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMsg {
    /// Who sent it — "operator" for the operator, else the agent's tube sender id.
    pub sender: String,
    pub text: String,
    pub mine: bool,
}

impl ChatMsg {
    /// The operator's own turn (optimistically shown the instant Send fires).
    pub fn mine(text: impl Into<String>) -> Self {
        Self {
            sender: "operator".into(),
            text: text.into(),
            mine: true,
        }
    }
    /// A reply from the bound agent, carrying the tube sender id.
    pub fn agent(sender: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            sender: sender.into(),
            text: text.into(),
            mine: false,
        }
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
}

impl ChatLog {
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
    }

    /// Fold in a real reply that came down the tube.
    pub fn push_agent(&mut self, sender: impl Into<String>, text: impl Into<String>) {
        self.push(ChatMsg::agent(sender, text));
    }

    /// Record a transport failure (a daemon refusal, no control plane, etc.).
    pub fn set_error(&mut self, err: impl Into<String>) {
        self.error = Some(err.into());
    }

    /// Render the transcript as render-agnostic [`Block`]s — the terminal face and
    /// the headless test surface. The GPUI shell renders bespoke bubbles instead,
    /// but both read the same model, so this never drifts from what the operator sees.
    pub fn blocks(&self) -> Vec<Block> {
        let mut out = vec![Block::Header("cartographer chat".into())];
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
            let label = if m.mine {
                "you".to_string()
            } else {
                chat_display_text(&m.sender)
            };
            let tone = if m.mine { Tone::Accent } else { Tone::Default };
            out.push(Block::WrappedText {
                text: format!("{label}: {}", chat_display_text(&m.text)),
                tone,
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
        assert!(log.messages[0].mine);
        assert!(!log.messages[1].mine);
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
        assert!(!reply.mine);
        let mine = ChatMsg::mine("hello");
        assert!(mine.mine);
        assert_eq!(mine.sender, "operator");
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
}
