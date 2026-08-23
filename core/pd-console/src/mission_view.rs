//! Human-facing projection for one Port Daddy mission.
//!
//! The Work screen is a mission receipt, not a global scheduler. This module
//! converts the durable WorkIntent + execution projection into a short,
//! operator-readable story: what was asked, whether a body has started, the
//! exact body/runtime, its live work, and the resulting PR/checks. It contains
//! no launch authority and invents no progress.

use crate::pane::{Block, Tone};

#[derive(Debug, Clone, Default)]
pub struct MissionViewModel {
    pub goal: String,
    pub intent_id: Option<String>,
    pub state: String,
    pub dispatch_id: Option<String>,
    pub launch_id: Option<String>,
    pub agent_id: Option<String>,
    pub transcript_id: Option<String>,
    pub backend: Option<String>,
    pub model: Option<String>,
    pub worktree: Option<String>,
    pub branch: Option<String>,
    pub artifact: Option<String>,
    pub artifact_status: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl MissionViewModel {
    pub fn from_snapshot(snapshot: &crate::agent::WorkSnapshot) -> Self {
        Self {
            goal: snapshot.goal().to_string(),
            intent_id: Some(snapshot.intent_id().to_string()),
            state: snapshot.execution_state().to_string(),
            dispatch_id: snapshot.dispatch_id().map(str::to_string),
            launch_id: snapshot.launch_id().map(str::to_string),
            agent_id: snapshot.execution_agent_id().map(str::to_string),
            transcript_id: snapshot.transcript_id().map(str::to_string),
            backend: snapshot.backend().map(str::to_string),
            model: snapshot.model().map(str::to_string),
            worktree: snapshot.worktree_path().map(str::to_string),
            branch: snapshot.branch().map(str::to_string),
            artifact: snapshot.result_artifact().map(str::to_string),
            artifact_status: snapshot.artifact_status().cloned(),
            error: snapshot.execution_error().map(str::to_string),
        }
    }

    pub fn empty() -> Self {
        Self {
            goal: "What should Port Daddy do?".into(),
            state: "not-started".into(),
            ..Self::default()
        }
    }

    pub fn stage(&self) -> (&'static str, Tone) {
        match self.state.as_str() {
            "proposed" | "claimed" => ("Starting", Tone::Engaged),
            "in_progress" => ("Working", Tone::Accent),
            "produced" | "review_pending" | "accepted" => ("Reviewing", Tone::Engaged),
            "settled" if self.artifact.is_some() => ("PR ready", Tone::Landed),
            "settled" => ("Finished", Tone::Landed),
            "failed" | "salvage" | "rejected" => ("Needs attention", Tone::Gated),
            "starting" => ("Starting", Tone::Engaged),
            _ if self.intent_id.is_some() => ("Accepted", Tone::Engaged),
            _ => ("Ready", Tone::Resting),
        }
    }

    fn runtime_label(&self) -> Option<String> {
        match (&self.backend, &self.model) {
            (Some(backend), Some(model)) => Some(format!("{backend} · {model}")),
            (Some(backend), None) => Some(backend.clone()),
            (None, Some(model)) => Some(model.clone()),
            (None, None) => None,
        }
    }

    fn check_blocks(&self) -> Vec<Block> {
        let Some(status) = self.artifact_status.as_ref() else {
            return Vec::new();
        };
        if let Some(error) = status.get("fetchError").and_then(|value| value.as_str()) {
            return vec![Block::Chip {
                label: format!("PR status unavailable · {error}"),
                tone: Tone::Gated,
            }];
        }
        let failing = status
            .get("failingChecks")
            .and_then(|value| value.as_array())
            .map(Vec::len)
            .unwrap_or(0);
        let pending = status
            .get("pendingChecks")
            .and_then(|value| value.as_array())
            .map(Vec::len)
            .unwrap_or(0);
        let unresolved = status
            .get("unresolvedThreads")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        if failing > 0 {
            vec![Block::Chip {
                label: format!("{failing} check{} failing", if failing == 1 { "" } else { "s" }),
                tone: Tone::Gated,
            }]
        } else if pending > 0 {
            vec![Block::Chip {
                label: format!("{pending} check{} running", if pending == 1 { "" } else { "s" }),
                tone: Tone::Engaged,
            }]
        } else if unresolved > 0 {
            vec![Block::Chip {
                label: format!("checks passed · {unresolved} review thread{} open", if unresolved == 1 { "" } else { "s" }),
                tone: Tone::Engaged,
            }]
        } else {
            vec![Block::Chip {
                label: "all checks passed".into(),
                tone: Tone::Landed,
            }]
        }
    }
}

pub fn blocks(model: &MissionViewModel, live_work: &[Block]) -> Vec<Block> {
    if model.intent_id.is_none() {
        return vec![
            Block::Header("What should Port Daddy do?".into()),
            Block::WrappedText {
                text: "Describe the outcome in plain English. Port Daddy will plan it, choose a governed agent, show its work here, run the checks, and attach the resulting pull request.".into(),
                tone: Tone::Default,
            },
            Block::Chip {
                label: "Ready for a mission".into(),
                tone: Tone::Resting,
            },
        ];
    }

    let (stage, stage_tone) = model.stage();
    let mut out = vec![
        Block::Header(model.goal.clone()),
        Block::Chip {
            label: stage.into(),
            tone: stage_tone,
        },
    ];
    if let Some(agent) = &model.agent_id {
        out.push(Block::KeyVal("agent".into(), agent.clone()));
    } else {
        out.push(Block::KeyVal(
            "agent".into(),
            "Port Daddy is selecting a governed body".into(),
        ));
    }
    if let Some(runtime) = model.runtime_label() {
        out.push(Block::KeyVal("runtime".into(), runtime));
    }
    if let Some(branch) = &model.branch {
        out.push(Block::KeyVal("branch".into(), branch.clone()));
    }
    if let Some(error) = &model.error {
        out.push(Block::WrappedText {
            text: error.clone(),
            tone: Tone::Gated,
        });
    }

    if !live_work.is_empty() && model.agent_id.is_some() {
        out.push(Block::Gap);
        out.push(Block::Header("Live work".into()));
        out.extend(live_work.iter().cloned());
    }

    if let Some(artifact) = &model.artifact {
        out.push(Block::Gap);
        out.push(Block::Header("Delivery".into()));
        out.push(Block::ArtifactRef {
            label: "Open pull request".into(),
            path: artifact.clone(),
            preview: Some("code, checks, review, and merge status".into()),
            tone: Tone::Landed,
        });
        out.extend(model.check_blocks());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_screen_asks_for_an_outcome_in_plain_language() {
        let rendered = blocks(&MissionViewModel::empty(), &[]);
        assert!(matches!(rendered[0], Block::Header(ref text) if text == "What should Port Daddy do?"));
        assert!(rendered.iter().any(|block| matches!(block, Block::WrappedText { text, .. } if text.contains("plain English"))));
    }

    #[test]
    fn running_mission_names_the_exact_body_and_embeds_its_live_work() {
        let model = MissionViewModel {
            goal: "Repair the console".into(),
            intent_id: Some("intent-1".into()),
            state: "in_progress".into(),
            agent_id: Some("spawned-codex-7".into()),
            backend: Some("cli:codex".into()),
            model: Some("gpt-5.3-codex".into()),
            ..MissionViewModel::default()
        };
        let rendered = blocks(&model, &[Block::TranscriptLine {
            text: "running tests".into(),
            tone: Tone::Accent,
        }]);
        assert!(rendered.iter().any(|block| matches!(block, Block::KeyVal(key, value) if key == "agent" && value == "spawned-codex-7")));
        assert!(rendered.iter().any(|block| matches!(block, Block::Header(text) if text == "Live work")));
        assert!(rendered.iter().any(|block| matches!(block, Block::TranscriptLine { text, .. } if text == "running tests")));
    }

    #[test]
    fn delivered_mission_surfaces_pr_and_check_state() {
        let model = MissionViewModel {
            goal: "Ship it".into(),
            intent_id: Some("intent-2".into()),
            state: "settled".into(),
            artifact: Some("https://github.com/port-daddy/port-daddy/pull/123".into()),
            artifact_status: Some(serde_json::json!({
                "state": "OPEN",
                "failingChecks": [],
                "pendingChecks": ["visual-artifact"],
                "unresolvedThreads": 0
            })),
            ..MissionViewModel::default()
        };
        let rendered = blocks(&model, &[]);
        assert!(rendered.iter().any(|block| matches!(block, Block::ArtifactRef { path, .. } if path.ends_with("/pull/123"))));
        assert!(rendered.iter().any(|block| matches!(block, Block::Chip { label, .. } if label == "1 check running")));
    }
}
