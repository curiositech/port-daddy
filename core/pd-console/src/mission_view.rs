//! Human-facing projection for one Port Daddy mission.
//!
//! Mission is a governed conversation, not a global scheduler. This module
//! converts the durable WorkIntent + execution projection into a short,
//! operator-readable story: what was asked, whether a body has started, the
//! exact body/runtime, its live work, and the resulting PR/checks. It contains
//! no launch authority and invents no progress.

use crate::pane::{Block, Tone};
use crate::work_plan::PredictedDag;
use std::collections::BTreeSet;

/// A contextual jump exposed beside the Mission conversation. These are not
/// independent dashboard panes: each target either reveals the daemon-authored
/// plan in place or opens one focused inspector beside the conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissionContextTarget {
    Plan,
    Claims,
    Suggestions,
    Activity,
    Cost,
}

/// One compact, provenance-bearing signal in the Mission context rail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionContextCard {
    pub eyebrow: &'static str,
    pub headline: String,
    pub detail: String,
    pub tone: Tone,
    pub target: MissionContextTarget,
}

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

    pub fn starting(snapshot: &crate::agent::WorkSnapshot) -> Self {
        let mut model = Self::from_snapshot(snapshot);
        model.state = "starting".into();
        model
    }

    pub fn from_execution(receipt: &crate::agent::WorkExecutionReceipt) -> Self {
        let mut model = Self::from_snapshot(&receipt.snapshot);
        model.state = receipt.state.clone();
        model.dispatch_id = Some(receipt.dispatch_id.clone());
        model.launch_id = receipt.launch_id.clone().or(model.launch_id);
        model.agent_id = receipt.agent_id.clone().or(model.agent_id);
        model.transcript_id = receipt.transcript_id.clone().or(model.transcript_id);
        model.backend = receipt.backend.clone().or(model.backend);
        model.model = receipt.model.clone().or(model.model);
        model.worktree = receipt.worktree_path.clone().or(model.worktree);
        model.branch = receipt.branch.clone().or(model.branch);
        model.artifact = receipt.result_artifact.clone().or(model.artifact);
        model.error = receipt.error_message.clone().or(model.error);
        model
    }

    pub fn stage(&self) -> (&'static str, Tone) {
        match self.state.as_str() {
            "proposed" | "claimed" => ("Starting", Tone::Engaged),
            "in_progress" => ("Working", Tone::Accent),
            "produced" | "review_pending" | "accepted" => ("Reviewing", Tone::Engaged),
            "settled" if self.artifact.is_some() => ("PR ready", Tone::Landed),
            "settled" => ("Finished", Tone::Landed),
            "failed" | "error" | "killed" | "aborted" | "over_budget" | "timed_out" | "timeout"
            | "salvage" | "rejected" => ("Needs attention", Tone::Gated),
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
                label: format!(
                    "{failing} check{} failing",
                    if failing == 1 { "" } else { "s" }
                ),
                tone: Tone::Gated,
            }]
        } else if pending > 0 {
            vec![Block::Chip {
                label: format!(
                    "{pending} check{} running",
                    if pending == 1 { "" } else { "s" }
                ),
                tone: Tone::Engaged,
            }]
        } else if unresolved > 0 {
            vec![Block::Chip {
                label: format!(
                    "checks passed · {unresolved} review thread{} open",
                    if unresolved == 1 { "" } else { "s" }
                ),
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

fn block_summary(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::Chip { label, .. } => Some(label.clone()),
        Block::KeyVal(key, value) if key != "status" || !value.contains("connecting") => {
            Some(format!("{key}: {value}"))
        }
        Block::Row(parts) if !parts.is_empty() => Some(parts.join(" · ")),
        Block::WrappedText { text, .. } => Some(text.clone()),
        _ => None,
    })
}

fn matching_chip(blocks: &[Block], prefix: &str) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::Chip { label, .. } if label.starts_with(prefix) => Some(label.clone()),
        _ => None,
    })
}

fn claim_count_summary(blocks: &[Block]) -> Option<String> {
    let count = blocks.iter().find_map(|block| match block {
        Block::KeyVal(key, value) if key == "total" || key == "active claims" => {
            value.trim().parse::<usize>().ok()
        }
        Block::KeyVal(key, value) if key == "status" && value == "no active claims" => Some(0),
        _ => None,
    })?;
    Some(format!(
        "{count} claim{}",
        if count == 1 { "" } else { "s" }
    ))
}

fn skill_summary(plan: &PredictedDag) -> (String, String) {
    let skills = plan
        .waves
        .iter()
        .flat_map(|wave| &wave.nodes)
        .map(|node| node.skill_id.trim())
        .filter(|skill| !skill.is_empty())
        .collect::<BTreeSet<_>>();
    if skills.is_empty() {
        return (
            "No skills attached yet".into(),
            "Waiting for WorkPlan node specs; the console will not guess.".into(),
        );
    }
    let visible = skills.iter().take(3).copied().collect::<Vec<_>>();
    let remaining = skills.len().saturating_sub(visible.len());
    let headline = if remaining == 0 {
        visible.join(" · ")
    } else {
        format!("{} · +{remaining}", visible.join(" · "))
    };
    (
        headline,
        "Suggested by the daemon-backed plan and preserved on its node specs.".into(),
    )
}

/// Build the Mission rail from the exact projections already refreshed for the
/// full inspectors. This is deliberately a projection, not a second data fetch
/// or a frontend inference engine.
pub fn context_cards(
    model: &MissionViewModel,
    plan: &PredictedDag,
    claims: &[Block],
    suggestions: &[Block],
    activity: &[Block],
    ledger: &[Block],
    correlation_id: Option<&str>,
    execution_id: Option<&str>,
) -> Vec<MissionContextCard> {
    let node_count = plan
        .waves
        .iter()
        .map(|wave| wave.nodes.len())
        .sum::<usize>();
    let plan_headline = if node_count == 0 {
        "No daemon-authored nodes yet".into()
    } else {
        format!(
            "{node_count} node{} · {} wave{}",
            if node_count == 1 { "" } else { "s" },
            plan.waves.len(),
            if plan.waves.len() == 1 { "" } else { "s" },
        )
    };
    let plan_detail = if let Some(reason) = plan.halt_reason.as_deref() {
        reason.to_string()
    } else if plan.problem_classification.trim().is_empty() {
        "WorkPlan truth will appear here when the daemon returns it.".into()
    } else {
        format!(
            "{} · {:.0}% confidence",
            plan.problem_classification,
            plan.confidence.clamp(0.0, 1.0) * 100.0
        )
    };
    let (skills_headline, skills_detail) = skill_summary(plan);
    let claims_headline =
        claim_count_summary(claims).unwrap_or_else(|| "Claims unavailable".into());
    let suggestion_headline = suggestions
        .iter()
        .find_map(|block| match block {
            Block::Chip { label, .. } => Some(label.clone()),
            _ => None,
        })
        .or_else(|| block_summary(suggestions))
        .unwrap_or_else(|| "No next move suggested".into());
    let activity_headline = activity
        .iter()
        .find_map(|block| match block {
            Block::Row(parts) if !parts.is_empty() => Some(parts.join(" · ")),
            _ => None,
        })
        .or_else(|| block_summary(activity))
        .unwrap_or_else(|| "No recent evidence".into());
    let cost_headline = matching_chip(ledger, "spent (24h)")
        .or_else(|| block_summary(ledger))
        .unwrap_or_else(|| "Cost unavailable".into());

    let receipt_headline = execution_id
        .map(|id| format!("execution {id}"))
        .or_else(|| model.intent_id.as_deref().map(|id| format!("intent {id}")))
        .unwrap_or_else(|| "No receipt yet".into());
    let receipt_detail = correlation_id
        .map(|id| format!("Trace {id}. Open Activity for the durable event trail."))
        .unwrap_or_else(|| "The first accepted turn will attach durable provenance.".into());

    vec![
        MissionContextCard {
            eyebrow: "PLAN",
            headline: plan_headline,
            detail: plan_detail,
            tone: model.stage().1,
            target: MissionContextTarget::Plan,
        },
        MissionContextCard {
            eyebrow: "SUGGESTED SKILLS",
            headline: skills_headline,
            detail: skills_detail,
            tone: if node_count == 0 {
                Tone::Resting
            } else {
                Tone::Engaged
            },
            target: MissionContextTarget::Plan,
        },
        MissionContextCard {
            eyebrow: "CLAIMS",
            headline: claims_headline,
            detail: "Live file and symbol ownership. Open the inspector for every claimant.".into(),
            tone: Tone::Engaged,
            target: MissionContextTarget::Claims,
        },
        MissionContextCard {
            eyebrow: "SUGGESTED NEXT MOVE",
            headline: suggestion_headline,
            detail: "A daemon projection with source evidence, never an unlabeled console hunch."
                .into(),
            tone: Tone::Accent,
            target: MissionContextTarget::Suggestions,
        },
        MissionContextCard {
            eyebrow: "RECEIPT",
            headline: receipt_headline,
            detail: receipt_detail,
            tone: if model.intent_id.is_some() {
                Tone::Landed
            } else {
                Tone::Resting
            },
            target: MissionContextTarget::Activity,
        },
        MissionContextCard {
            eyebrow: "LATEST EVIDENCE",
            headline: activity_headline,
            detail: "Newest durable activity from the same refresh cycle as the full inspector."
                .into(),
            tone: Tone::Default,
            target: MissionContextTarget::Activity,
        },
        MissionContextCard {
            eyebrow: "COST",
            headline: cost_headline,
            detail: "Actual 24-hour ledger projection; open it for budget and backend detail."
                .into(),
            tone: Tone::Accent,
            target: MissionContextTarget::Cost,
        },
    ]
}

/// Pull the actionable non-prose parts of the live Lane into the conversation:
/// tool states and artifacts stay visible without duplicating assistant prose
/// that is already rendered as chat bubbles.
pub fn live_trace_blocks(live_work: &[Block]) -> Vec<Block> {
    let mut selected = live_work
        .iter()
        .filter(|block| match block {
            Block::Chip { label, .. } => {
                label.starts_with('▸') || label.starts_with('✓') || label.starts_with('✗')
            }
            Block::ArtifactRef { .. } | Block::ImageArtifact { .. } => true,
            _ => false,
        })
        .cloned()
        .collect::<Vec<_>>();
    if selected.len() > 8 {
        selected.drain(..selected.len() - 8);
    }
    selected
}

/// Compact, read-only launch evidence drawn from the console's existing live
/// Health, Activity, and Cost panes. The Work receipt does not issue a second
/// daemon request or guess a status; it projects the same refresh cycle the
/// operator can inspect in full elsewhere.
pub fn launch_observability_blocks(
    health: &[Block],
    activity: &[Block],
    ledger: &[Block],
) -> Vec<Block> {
    let health_status = health.iter().find_map(|block| match block {
        Block::Chip { label, .. } if label.starts_with("status:") => Some(block.clone()),
        _ => None,
    });
    let recent_activity = activity.iter().find_map(|block| match block {
        Block::Row(parts) if !parts.is_empty() => Some(parts.join(" · ")),
        Block::KeyVal(key, value) if key == "status" || key == "error" => {
            Some(format!("{key}: {value}"))
        }
        _ => None,
    });
    let recent_cost = ledger.iter().find_map(|block| match block {
        Block::Chip { label, .. } if label.starts_with("spent (24h)") => Some(block.clone()),
        Block::Chip { label, .. } if label == "cost data unavailable" => Some(block.clone()),
        _ => None,
    });

    if health_status.is_none() && recent_activity.is_none() && recent_cost.is_none() {
        return Vec::new();
    }

    let mut out = vec![Block::Gap, Block::Header("Launch observability".into())];
    if let Some(status) = health_status {
        out.push(status);
    }
    if let Some(activity) = recent_activity {
        out.push(Block::KeyVal("recent activity".into(), activity));
    }
    if let Some(cost) = recent_cost {
        out.push(cost);
    }
    out
}

pub fn blocks(
    model: &MissionViewModel,
    live_work: &[Block],
    launch_observability: &[Block],
) -> Vec<Block> {
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
    if let Some(worktree) = &model.worktree {
        out.push(Block::KeyVal("worktree".into(), worktree.clone()));
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

    out.extend(launch_observability.iter().cloned());

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
        let rendered = blocks(&MissionViewModel::empty(), &[], &[]);
        assert!(
            matches!(rendered[0], Block::Header(ref text) if text == "What should Port Daddy do?")
        );
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
            model: Some("receipt-model-v1".into()),
            worktree: Some("/worktrees/mission-7".into()),
            ..MissionViewModel::default()
        };
        let rendered = blocks(
            &model,
            &[Block::TranscriptLine {
                text: "running tests".into(),
                tone: Tone::Accent,
            }],
            &[],
        );
        assert!(rendered.iter().any(|block| matches!(block, Block::KeyVal(key, value) if key == "agent" && value == "spawned-codex-7")));
        assert!(rendered
            .iter()
            .any(|block| matches!(block, Block::Header(text) if text == "Live work")));
        assert!(rendered.iter().any(
            |block| matches!(block, Block::KeyVal(key, value) if key == "worktree" && value == "/worktrees/mission-7")
        ));
        assert!(rendered.iter().any(
            |block| matches!(block, Block::TranscriptLine { text, .. } if text == "running tests")
        ));
    }

    #[test]
    fn killed_runtime_is_gated_instead_of_looking_accepted_or_working() {
        let model = MissionViewModel {
            intent_id: Some("intent-killed".into()),
            state: "killed".into(),
            ..MissionViewModel::empty()
        };
        assert_eq!(model.stage(), ("Needs attention", Tone::Gated));
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
        let rendered = blocks(&model, &[], &[]);
        assert!(rendered.iter().any(
            |block| matches!(block, Block::ArtifactRef { path, .. } if path.ends_with("/pull/123"))
        ));
        assert!(rendered
            .iter()
            .any(|block| matches!(block, Block::Chip { label, .. } if label == "1 check running")));
    }

    #[test]
    fn execution_receipt_uses_event_time_runtime_identity_when_snapshot_lags() {
        let snapshot = crate::agent::WorkSnapshot {
            intent: serde_json::json!({
                "intentId": "intent-3",
                "goal": { "text": "Build the thing" }
            }),
            plan: None,
            execution: None,
        };
        let receipt = crate::agent::WorkExecutionReceipt {
            status: "accepted".into(),
            duplicate: false,
            correlation_id: "corr-3".into(),
            snapshot,
            projection: "governed-mission".into(),
            dispatch_id: "dispatch-3".into(),
            state: "in_progress".into(),
            session_id: Some("session-3".into()),
            worktree_path: Some("/worktrees/mission-3".into()),
            branch: Some("codex/mission-3".into()),
            launch_id: Some("launch-3".into()),
            agent_id: Some("agent-3".into()),
            transcript_id: Some("transcript-3".into()),
            backend: Some("cli:codex".into()),
            model: Some("receipt-model-v1".into()),
            result_artifact: None,
            error_message: None,
            launched_this_tick: 1,
            next_action: "follow the exact agent".into(),
        };

        let model = MissionViewModel::from_execution(&receipt);
        assert_eq!(model.agent_id.as_deref(), Some("agent-3"));
        assert_eq!(model.transcript_id.as_deref(), Some("transcript-3"));
        assert_eq!(model.backend.as_deref(), Some("cli:codex"));
        assert_eq!(model.model.as_deref(), Some("receipt-model-v1"));
        assert_eq!(model.branch.as_deref(), Some("codex/mission-3"));
    }

    #[test]
    fn launch_observability_projects_the_live_panes_without_inventing_values() {
        let rendered = launch_observability_blocks(
            &[Block::Chip {
                label: "status: healthy".into(),
                tone: Tone::Landed,
            }],
            &[Block::Row(vec![
                "now".into(),
                "spawn.started".into(),
                "agent-7".into(),
                "running checks".into(),
            ])],
            &[Block::Chip {
                label: "spent (24h)  $1.25".into(),
                tone: Tone::Accent,
            }],
        );

        assert!(rendered
            .iter()
            .any(|block| matches!(block, Block::Header(text) if text == "Launch observability")));
        assert!(rendered.iter().any(
            |block| matches!(block, Block::KeyVal(key, value) if key == "recent activity" && value.contains("spawn.started"))
        ));
        assert!(rendered.iter().any(
            |block| matches!(block, Block::Chip { label, .. } if label == "spent (24h)  $1.25")
        ));
    }

    #[test]
    fn context_rail_uses_plan_skills_and_durable_receipt_ids() {
        let model = MissionViewModel {
            intent_id: Some("intent-7".into()),
            state: "in_progress".into(),
            ..MissionViewModel::default()
        };
        let plan = PredictedDag {
            problem_classification: "well-structured".into(),
            confidence: 0.92,
            waves: vec![crate::work_plan::PredictedWave {
                wave_number: 1,
                nodes: vec![
                    crate::work_plan::PredictedNode {
                        id: "design".into(),
                        skill_id: "agentic-coding-ux-designer".into(),
                        ..Default::default()
                    },
                    crate::work_plan::PredictedNode {
                        id: "architecture".into(),
                        skill_id: "agentic-app-architecture".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let cards = context_cards(
            &model,
            &plan,
            &[Block::KeyVal("active claims".into(), "2".into())],
            &[Block::Chip {
                label: "Inspect the claim tree".into(),
                tone: Tone::Accent,
            }],
            &[Block::Row(vec!["now".into(), "agent.output".into()])],
            &[Block::Chip {
                label: "spent (24h)  $0.42".into(),
                tone: Tone::Accent,
            }],
            Some("corr-7"),
            Some("execution-7"),
        );

        let skills = cards
            .iter()
            .find(|card| card.eyebrow == "SUGGESTED SKILLS")
            .expect("skills card");
        assert!(skills.headline.contains("agentic-coding-ux-designer"));
        assert!(skills.headline.contains("agentic-app-architecture"));

        let receipt = cards
            .iter()
            .find(|card| card.eyebrow == "RECEIPT")
            .expect("receipt card");
        assert_eq!(receipt.headline, "execution execution-7");
        assert!(receipt.detail.contains("corr-7"));
    }

    #[test]
    fn context_rail_ignores_claim_words_without_the_count_projection() {
        let cards = context_cards(
            &MissionViewModel::empty(),
            &PredictedDag::default(),
            &[Block::Chip {
                label: "Inspect the claim tree".into(),
                tone: Tone::Engaged,
            }],
            &[],
            &[],
            &[],
            None,
            None,
        );
        let claims = cards
            .iter()
            .find(|card| card.eyebrow == "CLAIMS")
            .expect("claims card");
        assert_eq!(claims.headline, "Claims unavailable");
    }

    #[test]
    fn context_rail_reads_the_explicit_empty_claims_projection() {
        let cards = context_cards(
            &MissionViewModel::empty(),
            &PredictedDag::default(),
            &[Block::KeyVal("status".into(), "no active claims".into())],
            &[],
            &[],
            &[],
            None,
            None,
        );
        let claims = cards
            .iter()
            .find(|card| card.eyebrow == "CLAIMS")
            .expect("claims card");
        assert_eq!(claims.headline, "0 claims");
    }

    #[test]
    fn context_rail_does_not_invent_skills_when_the_plan_has_none() {
        let cards = context_cards(
            &MissionViewModel::empty(),
            &PredictedDag::default(),
            &[],
            &[],
            &[],
            &[],
            None,
            None,
        );
        let skills = cards
            .iter()
            .find(|card| card.eyebrow == "SUGGESTED SKILLS")
            .expect("skills card");
        assert_eq!(skills.headline, "No skills attached yet");
        assert!(skills.detail.contains("will not guess"));
    }

    #[test]
    fn live_trace_keeps_tool_and_artifact_evidence_without_duplicate_chat_prose() {
        let trace = live_trace_blocks(&[
            Block::ChatTurn {
                speaker: "assistant".into(),
                text: "I am running the tests".into(),
                tone: Tone::Default,
            },
            Block::Chip {
                label: "▸ cargo test".into(),
                tone: Tone::Engaged,
            },
            Block::ArtifactRef {
                label: "test report".into(),
                path: "artifacts/test-report.txt".into(),
                preview: None,
                tone: Tone::Landed,
            },
        ]);

        assert_eq!(trace.len(), 2);
        assert!(trace
            .iter()
            .any(|block| matches!(block, Block::Chip { label, .. } if label == "▸ cargo test")));
        assert!(trace.iter().any(
            |block| matches!(block, Block::ArtifactRef { path, .. } if path == "artifacts/test-report.txt")
        ));
        assert!(!trace
            .iter()
            .any(|block| matches!(block, Block::ChatTurn { .. })));
    }
}
