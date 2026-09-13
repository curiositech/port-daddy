//! GPUI-free reducers for Mission's daemon-to-window callback buses.
//!
//! The native shell owns audio and focus side effects. Durable chat and Work
//! projection state changes live here so the headless Rust gate executes the
//! exact transitions used by `ConsoleView::apply_*_update`.

use crate::chat::{ChatLog, ChatUpdate};
use crate::mission_view::MissionViewModel;
use crate::work_plan::PredictedDag;
use std::path::PathBuf;

/// Foreground-only side effect requested by a chat state transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatUpdateSignal {
    None,
    ReplyArrived,
    ReceiptArrived,
}

/// Fold one transport callback into the durable Mission transcript model.
pub fn apply_chat_update(log: &mut ChatLog, update: ChatUpdate) -> ChatUpdateSignal {
    match update {
        ChatUpdate::Reply(msg) => {
            log.push_agent_message(msg);
            ChatUpdateSignal::ReplyArrived
        }
        ChatUpdate::Receipt(msg) => {
            log.push_receipt_message(msg, false);
            // Admission recovered after a transient transport error still means
            // the attributed language answer is outstanding.
            log.awaiting_reply = true;
            ChatUpdateSignal::ReceiptArrived
        }
        ChatUpdate::Terminal { receipt, .. } => {
            log.push_receipt_message(receipt, true);
            ChatUpdateSignal::ReceiptArrived
        }
        ChatUpdate::Hydrate {
            messages,
            awaiting_reply,
            terminal_status: _,
        } => {
            log.hydrate(messages, awaiting_reply);
            ChatUpdateSignal::None
        }
        ChatUpdate::Reset => {
            log.reset();
            ChatUpdateSignal::None
        }
        ChatUpdate::Error(reason) => {
            log.set_error(reason);
            ChatUpdateSignal::None
        }
    }
}

/// Mutable bindings for every berth-scoped Work projection field in the native
/// Mission surface. Keeping the list explicit makes daemon rebinds fail closed:
/// a newly-added field must be deliberately added to this boundary or it cannot
/// silently retain another daemon's state.
pub struct WorkProjectionBindings<'a> {
    pub mission: &'a mut MissionViewModel,
    pub plan_graph: &'a mut PredictedDag,
    pub graph_png_path: &'a mut Option<PathBuf>,
    pub intent_id: &'a mut Option<String>,
    pub plan_state: &'a mut String,
    pub correlation_id: &'a mut Option<String>,
    pub next_action: &'a mut Option<String>,
    pub execution_state: &'a mut String,
    pub execution_id: &'a mut Option<String>,
    pub execution_projection: &'a mut Option<String>,
    pub execution_session: &'a mut Option<String>,
    pub execution_worktree: &'a mut Option<String>,
    pub selected_node: &'a mut Option<String>,
    pub control_flash: &'a mut Option<String>,
}

impl WorkProjectionBindings<'_> {
    /// Clear all Mission truth bound to the previous daemon berth.
    pub fn clear_for_daemon_rebind(self) {
        *self.mission = MissionViewModel::empty();
        *self.plan_graph = PredictedDag::default();
        *self.graph_png_path = None;
        *self.intent_id = None;
        *self.plan_state = "not-started".into();
        *self.correlation_id = None;
        *self.next_action = None;
        *self.execution_state = "not-started".into();
        *self.execution_id = None;
        *self.execution_projection = None;
        *self.execution_session = None;
        *self.execution_worktree = None;
        *self.selected_node = None;
        *self.control_flash = Some("Mission context cleared for the selected daemon.".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{ChatMsg, ChatMsgKind};
    use crate::work_plan::PredictedWave;

    #[test]
    fn chat_callback_preserves_receipt_provenance_then_resets_the_berth() {
        let mut log = ChatLog::default();
        log.push_mine("inspect the live mission");
        log.set_error("stale transport failure");

        let signal = apply_chat_update(
            &mut log,
            ChatUpdate::Receipt(ChatMsg::receipt(
                "Port Daddy receipt",
                "WorkIntent admitted",
            )),
        );

        assert_eq!(signal, ChatUpdateSignal::ReceiptArrived);
        assert_eq!(log.messages.len(), 2);
        assert!(log.error.is_none());
        assert!(log.awaiting_reply, "an admission receipt is not an answer");
        let receipt = log.messages.last().expect("receipt turn");
        assert_eq!(receipt.kind, ChatMsgKind::Receipt);
        assert_eq!(receipt.sender, "Port Daddy receipt");
        assert_eq!(receipt.text, "WorkIntent admitted");

        assert_eq!(
            apply_chat_update(&mut log, ChatUpdate::Reset),
            ChatUpdateSignal::None
        );
        assert!(log.messages.is_empty());
        assert!(log.error.is_none());
        assert!(!log.awaiting_reply);
    }

    #[test]
    fn terminal_callback_stops_waiting_even_when_execution_projection_is_stale() {
        let mut log = ChatLog::default();
        log.push_mine("prove the worktree state");

        let signal = apply_chat_update(
            &mut log,
            ChatUpdate::Terminal {
                receipt: crate::chat::mission_terminal_receipt(
                    "killed",
                    Some("Killed by spawner"),
                    Some(1_788_590_537_856),
                ),
                status: "killed".into(),
            },
        );

        assert_eq!(signal, ChatUpdateSignal::ReceiptArrived);
        assert!(!log.awaiting_reply);
        assert_eq!(log.messages.last().unwrap().kind, ChatMsgKind::Receipt);
        assert!(log.messages.last().unwrap().text.contains("KILLED"));
    }

    #[test]
    fn work_reset_callback_clears_every_berth_scoped_projection() {
        let mut mission = MissionViewModel::empty();
        mission.goal = "stale mission".into();
        mission.intent_id = Some("intent-stale".into());
        mission.state = "in_progress".into();
        let mut plan_graph = PredictedDag {
            title: "stale plan".into(),
            waves: vec![PredictedWave::default()],
            ..PredictedDag::default()
        };
        let mut graph_png_path = Some(PathBuf::from("stale-plan.png"));
        let mut intent_id = Some("intent-stale".into());
        let mut plan_state = "materialized".into();
        let mut correlation_id = Some("corr-stale".into());
        let mut next_action = Some("keep stale state".into());
        let mut execution_state = "in_progress".into();
        let mut execution_id = Some("execution-stale".into());
        let mut execution_projection = Some("dispatch-compat".into());
        let mut execution_session = Some("session-stale".into());
        let mut execution_worktree = Some("/repo/stale".into());
        let mut selected_node = Some("node-stale".into());
        let mut control_flash = None;

        WorkProjectionBindings {
            mission: &mut mission,
            plan_graph: &mut plan_graph,
            graph_png_path: &mut graph_png_path,
            intent_id: &mut intent_id,
            plan_state: &mut plan_state,
            correlation_id: &mut correlation_id,
            next_action: &mut next_action,
            execution_state: &mut execution_state,
            execution_id: &mut execution_id,
            execution_projection: &mut execution_projection,
            execution_session: &mut execution_session,
            execution_worktree: &mut execution_worktree,
            selected_node: &mut selected_node,
            control_flash: &mut control_flash,
        }
        .clear_for_daemon_rebind();

        assert_eq!(mission.goal, "What should Port Daddy do?");
        assert_eq!(mission.state, "not-started");
        assert!(mission.intent_id.is_none());
        assert!(plan_graph.title.is_empty());
        assert!(plan_graph.waves.is_empty());
        assert!(graph_png_path.is_none());
        assert!(intent_id.is_none());
        assert_eq!(plan_state, "not-started");
        assert!(correlation_id.is_none());
        assert!(next_action.is_none());
        assert_eq!(execution_state, "not-started");
        assert!(execution_id.is_none());
        assert!(execution_projection.is_none());
        assert!(execution_session.is_none());
        assert!(execution_worktree.is_none());
        assert!(selected_node.is_none());
        assert_eq!(
            control_flash.as_deref(),
            Some("Mission context cleared for the selected daemon.")
        );
    }
}
