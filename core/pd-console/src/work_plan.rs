//! Read-only WorkPlan projection for the native operator surface.
//!
//! The daemon owns WorkIntent capture, planning, node materialization, Body
//! attachment, and execution. This module only converts durable daemon facts
//! into the existing DAG-shaped visual model. An absent plan stays absent and
//! an empty node list stays empty: the console never invents a provider, model,
//! node, run, or fixture to make the surface look busy.

use crate::pane::{Block, Tone};
use serde::{Deserialize, Serialize};

/// Top-level daemon WorkPlan projection. Optional/extra fields carry
/// `#[serde(default)]` so a partial durable plan remains inspectable.
/// `Serialize` closes the loop to the Vello renderer: the console serializes
/// daemon truth to the renderer's JSON shape without creating a second planner.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PredictedDag {
    /// "Ship API endpoint with tests".
    pub title: String,
    /// "well-structured" | "ill-structured" | "wicked" (free string for forward-compat).
    #[serde(default)]
    pub problem_classification: String,
    /// 0–1 overall confidence in this prediction.
    #[serde(default)]
    pub confidence: f64,
    /// Set when wicked/unclear and we can't proceed.
    #[serde(default)]
    pub halt_reason: Option<String>,
    /// The execution waves, in order.
    #[serde(default)]
    pub waves: Vec<PredictedWave>,
    #[serde(default)]
    pub estimated_total_minutes: f64,
    #[serde(default)]
    pub estimated_total_cost_usd: f64,
    /// Topology hint (absent ⇒ "dag").
    #[serde(default)]
    pub topology: Option<String>,
}

/// One execution wave. Mirrors the TS `PredictedWave`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PredictedWave {
    #[serde(default)]
    pub wave_number: u32,
    /// True when the nodes in this wave can run concurrently.
    #[serde(default)]
    pub parallelizable: bool,
    #[serde(default)]
    pub nodes: Vec<PredictedNode>,
}

/// A single predicted unit of work. Mirrors the TS `PredictedNode`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PredictedNode {
    /// Stable node id, e.g. "research-api-patterns".
    #[serde(default)]
    pub id: String,
    /// The skill this agent loads, e.g. "api-architect".
    #[serde(default)]
    pub skill_id: String,
    /// What this agent does in context.
    #[serde(default)]
    pub role_description: String,
    /// Why this skill, why now.
    #[serde(default)]
    pub why: String,
    /// "COMMITTED" | "TENTATIVE" | "EXPLORATORY" — a free string; tone is derived.
    #[serde(default)]
    pub commitment_level: String,
    /// What this node needs from upstream.
    #[serde(default)]
    pub input_contract: String,
    /// What this node promises to deliver.
    #[serde(default)]
    pub output_contract: String,
    /// Vendor-agnostic capability tier label ("opus"/"sonnet"/"haiku"/"gemini"/…).
    #[serde(default)]
    pub model_tier: String,
    #[serde(default)]
    pub estimated_minutes: f64,
    #[serde(default)]
    pub estimated_cost_usd: f64,
    /// How many downstream nodes depend on this one.
    #[serde(default)]
    pub cascade_depth: u32,
    /// Interactive clients stop and ask before executing this node (the HITL gate).
    #[serde(default)]
    pub ask_user_before_proceeding: bool,
}

/// Parse a daemon WorkPlan projection into a [`PredictedDag`]. Missing optional
/// fields are tolerated so partial durable truth stays visible rather than being
/// replaced with frontend fixtures.
pub fn parse(json: &str) -> anyhow::Result<PredictedDag> {
    let dag = serde_json::from_str::<PredictedDag>(json)?;
    Ok(dag)
}

/// Serialize a [`PredictedDag`] to the JSON shape the Vello renderer reads.
/// Pretty-printing keeps the render handoff inspectable; the daemon snapshot
/// remains the sole source of plan truth.
pub fn to_json(dag: &PredictedDag) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(dag)?)
}

/// The Work surface before a daemon-backed intent has been selected.
pub fn empty_work_projection() -> PredictedDag {
    PredictedDag {
        title: "No work selected".into(),
        problem_classification: "daemon truth".into(),
        confidence: 0.0,
        halt_reason: Some(
            "Submit a WorkIntent to the daemon. The console will not synthesize a plan.".into(),
        ),
        topology: Some("unplanned".into()),
        ..Default::default()
    }
}

/// Honest foreground state while the idempotent Surface Gateway command is in flight.
pub fn pending_work_projection() -> PredictedDag {
    PredictedDag {
        title: "Capturing work intent".into(),
        problem_classification: "pending".into(),
        confidence: 0.0,
        halt_reason: Some(
            "Waiting for the daemon receipt; no plan, provider, node, or run is confirmed.".into(),
        ),
        topology: Some("pending".into()),
        ..Default::default()
    }
}

fn value_string(value: &serde_json::Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|field| field.as_str()))
        .unwrap_or_default()
        .to_string()
}

fn value_f64(value: &serde_json::Value, keys: &[&str]) -> f64 {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|field| field.as_f64()))
        .unwrap_or(0.0)
}

/// Project one durable WorkIntent/WorkPlan snapshot into the visual DAG model.
/// Only daemon-supplied `nodeSpecs` become nodes. Provider/model fields are not
/// interpreted here; the Squid-governed Body attachment remains runtime truth.
pub fn from_work_snapshot(snapshot: &crate::agent::WorkSnapshot) -> PredictedDag {
    let plan = snapshot.plan.as_ref();
    let state = plan
        .and_then(|value| value.get("state"))
        .and_then(|value| value.as_str())
        .unwrap_or("unplanned");
    let shape = plan
        .and_then(|value| value.get("shape"))
        .and_then(|value| value.as_str())
        .unwrap_or("unplanned");
    let evidence = plan
        .and_then(|value| value.get("evidence"))
        .and_then(|value| value.as_str())
        .unwrap_or("The daemon has not returned a WorkPlan.")
        .to_string();

    let mut by_wave = std::collections::BTreeMap::<u32, Vec<PredictedNode>>::new();
    if let Some(specs) = plan
        .and_then(|value| value.get("nodeSpecs"))
        .and_then(|value| value.as_array())
    {
        for (index, spec) in specs.iter().enumerate() {
            let wave = spec
                .get("wave")
                .or_else(|| spec.get("waveNumber"))
                .and_then(|value| value.as_u64())
                .unwrap_or(1) as u32;
            let id = {
                let candidate = value_string(spec, &["nodeId", "id"]);
                if candidate.is_empty() {
                    format!("daemon-node-{}", index + 1)
                } else {
                    candidate
                }
            };
            by_wave.entry(wave.max(1)).or_default().push(PredictedNode {
                id,
                skill_id: value_string(spec, &["skillId", "skill"]),
                role_description: value_string(spec, &["roleDescription", "goal", "role"]),
                why: value_string(spec, &["why", "evidence"]),
                commitment_level: value_string(spec, &["commitmentLevel", "commitment"]),
                input_contract: value_string(spec, &["inputContract"]),
                output_contract: value_string(spec, &["outputContract"]),
                model_tier: value_string(spec, &["capabilityTier"]),
                estimated_minutes: value_f64(spec, &["estimatedMinutes"]),
                estimated_cost_usd: value_f64(spec, &["estimatedCostUsd"]),
                cascade_depth: spec
                    .get("cascadeDepth")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as u32,
                ask_user_before_proceeding: spec
                    .get("requiresApproval")
                    .or_else(|| spec.get("askUserBeforeProceeding"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            });
        }
    }

    let waves = by_wave
        .into_iter()
        .map(|(wave_number, nodes)| PredictedWave {
            wave_number,
            parallelizable: nodes.len() > 1,
            nodes,
        })
        .collect::<Vec<_>>();
    let estimated_total_minutes = waves
        .iter()
        .flat_map(|wave| &wave.nodes)
        .map(|node| node.estimated_minutes)
        .sum();
    let estimated_total_cost_usd = waves
        .iter()
        .flat_map(|wave| &wave.nodes)
        .map(|node| node.estimated_cost_usd)
        .sum();

    PredictedDag {
        title: snapshot.goal().to_string(),
        problem_classification: format!("{state} / {shape}"),
        confidence: plan
            .and_then(|value| value.get("confidence"))
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0),
        halt_reason: waves.is_empty().then_some(evidence),
        waves,
        estimated_total_minutes,
        estimated_total_cost_usd,
        topology: Some(shape.to_string()),
    }
}

/// Map a commitment level to a semantic [`Tone`]. Matches windags' own stroke
/// semantics: COMMITTED is the strongest signal, EXPLORATORY the faintest.
/// Unknown levels fall back to the neutral default tone.
pub fn commitment_tone(level: &str) -> Tone {
    match level.trim().to_ascii_uppercase().as_str() {
        "COMMITTED" => Tone::Accent,
        "TENTATIVE" => Tone::Engaged,
        "EXPLORATORY" => Tone::Resting,
        _ => Tone::Default,
    }
}

/// A compact, legible scoped-context hint for a node's footer. This is the
/// "efficiently slicing context" cue the operator asked for — direct-dependency
/// outputs (full), upstream-wave summaries (compressed), the shared whiteboard.
/// In this slice it is derived from the node's structural position; the exact
/// per-node `NodeContext` breakdown is the inspector slice (rung 3).
fn context_hint(node: &PredictedNode) -> String {
    // cascade_depth is a stand-in for "how much downstream rides on this node".
    let downstream = if node.cascade_depth == 0 {
        "leaf".to_string()
    } else {
        format!("{}\u{2193}", node.cascade_depth) // e.g. "2↓"
    };
    // "◖ full deps · Σ wave summaries · wb" — the partition legend.
    format!("\u{25d6} full deps \u{00b7} \u{03a3} waves \u{00b7} wb \u{00b7} {downstream}")
}

/// The plan-time **scoped context** for one node — the agent-context-partitioner
/// SLICE, computed purely from the DAG structure (no runtime, no model call).
///
/// The partitioner's contract (from the Work design / `ScopedAccumulator`):
/// each node sees a *partitioned* view of the run's accumulated context, never
/// the whole transcript:
///   - **FULL** — the direct-dependency outputs, verbatim. In the feed-forward
///     model a node's deps are exactly the nodes of the immediately-preceding
///     wave (per `visualize-dag.ts`); a wave-0 node has no upstream node, so its
///     full slice is the operator prompt itself.
///   - **COMPRESSED** — every earlier wave (those *before* the dep wave) folded
///     to a short summary (~2k tok total), so depth is bounded, not linear.
///   - **SHARED** — the whiteboard: a couple of representative shared keys every
///     node can read (tech stack, live claims).
///   - everything else is **PRUNED**.
/// `est_budget_tokens` is a simple, monotone function of dep count + wave depth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeContext {
    /// FULL slice: direct-dependency node ids (prior wave), or the operator
    /// prompt sentinel for a wave-0 node.
    pub full_deps: Vec<String>,
    /// COMPRESSED slice: the wave numbers strictly before the dependency wave,
    /// each contributing a summary. Empty for waves 0 and 1.
    pub compressed_waves: Vec<u32>,
    /// SHARED slice: representative whiteboard keys every node may read.
    pub whiteboard: Vec<String>,
    /// Plan-time token-budget estimate (full deps + compressed depth + shared).
    pub est_budget_tokens: u32,
}

/// The sentinel a wave-0 node's FULL slice carries instead of an upstream node:
/// the operator prompt is its only "dependency".
pub const OPERATOR_PROMPT_DEP: &str = "operator prompt";

/// A per-wave compressed summary is budgeted at ~this many tokens.
const COMPRESSED_TOKENS_PER_WAVE: u32 = 600;
/// A direct-dependency FULL output is budgeted at ~this many tokens.
const FULL_TOKENS_PER_DEP: u32 = 1500;
/// The shared whiteboard is budgeted at ~this flat cost.
const WHITEBOARD_TOKENS: u32 = 400;

/// Compute the [`NodeContext`] partition for the node at `wave_index` (purely
/// structural — derivable from the DAG alone, the plan-time slice).
///
/// `full_deps` = the node ids of wave `wave_index - 1` (the feed-forward
/// dependency wave); for `wave_index == 0` it is `[OPERATOR_PROMPT_DEP]`.
/// `compressed_waves` = every wave number `< wave_index - 1` (those summaries).
/// `est_budget_tokens` grows with dep count and wave depth.
pub fn scoped_context(dag: &PredictedDag, wave_index: usize, _node: &PredictedNode) -> NodeContext {
    // FULL: the immediately-preceding wave's node ids (feed-forward deps).
    let full_deps: Vec<String> = if wave_index == 0 {
        vec![OPERATOR_PROMPT_DEP.to_string()]
    } else {
        dag.waves
            .get(wave_index - 1)
            .map(|w| w.nodes.iter().map(|n| n.id.clone()).collect())
            .unwrap_or_default()
    };

    // COMPRESSED: every wave strictly before the dependency wave. A wave-0 node
    // has no dep wave (its dep is the prompt) and a wave-1 node's dep wave is 0,
    // so neither has any earlier waves to compress.
    let compressed_waves: Vec<u32> = if wave_index >= 2 {
        dag.waves
            .iter()
            .take(wave_index - 1)
            .map(|w| w.wave_number)
            .collect()
    } else {
        Vec::new()
    };

    // SHARED: representative whiteboard keys — the always-readable commons.
    let whiteboard = vec!["tech_stack".to_string(), "claims".to_string()];

    // BUDGET: monotone in dep count (full slices) and depth (compressed summaries).
    let est_budget_tokens = full_deps.len() as u32 * FULL_TOKENS_PER_DEP
        + compressed_waves.len() as u32 * COMPRESSED_TOKENS_PER_WAVE
        + WHITEBOARD_TOKENS;

    NodeContext {
        full_deps,
        compressed_waves,
        whiteboard,
        est_budget_tokens,
    }
}

/// Render a [`PredictedDag`] into the console's render-agnostic [`Block`]s — the
/// foundation surface. Emits a title header, a classification/confidence line,
/// then per wave a header (marked `∥` when parallelizable) and per node a
/// commitment-toned chip plus role / model-cost / scoped-context detail, with a
/// HITL gate chip when the node asks for approval.
pub fn blocks_for_work(dag: &PredictedDag) -> Vec<Block> {
    let mut blocks = Vec::new();

    // Title.
    let title = if dag.title.is_empty() {
        "Work plan".to_string()
    } else {
        dag.title.clone()
    };
    blocks.push(Block::Header(title));

    // Classification + confidence (one KeyVal carrying both, the planner header).
    let classification = if dag.problem_classification.is_empty() {
        "unclassified".to_string()
    } else {
        dag.problem_classification.clone()
    };
    blocks.push(Block::KeyVal(
        "classification".into(),
        format!(
            "{classification} \u{00b7} {:.0}% confidence",
            dag.confidence * 100.0
        ),
    ));

    // A halt reason (if the planner refused) reads in full — the operator must see it.
    if let Some(reason) = &dag.halt_reason {
        blocks.push(Block::WrappedText {
            text: format!("halt: {reason}"),
            tone: Tone::Gated,
        });
    }

    // Per wave.
    for (wave_index, wave) in dag.waves.iter().enumerate() {
        blocks.push(Block::Gap);
        let parallel = if wave.parallelizable {
            " \u{00b7} \u{2225}"
        } else {
            ""
        };
        blocks.push(Block::Header(format!(
            "Wave {}{parallel}",
            wave.wave_number
        )));

        // Per node.
        for node in &wave.nodes {
            // The skill chip, toned by commitment level.
            blocks.push(Block::Chip {
                label: node.skill_id.clone(),
                tone: commitment_tone(&node.commitment_level),
            });
            // Role.
            blocks.push(Block::KeyVal(
                "  role".into(),
                node.role_description.clone(),
            ));
            // Model / cost / time — vendor-agnostic tier string.
            blocks.push(Block::KeyVal(
                "  model".into(),
                format!(
                    "{} \u{00b7} ${:.2} \u{00b7} {}m",
                    node.model_tier, node.estimated_cost_usd, node.estimated_minutes
                ),
            ));
            // The scoped-context partition legend (the compact one-line cue).
            blocks.push(Block::KeyVal("  ctx".into(), context_hint(node)));

            // INSPECTOR block group: the contracts + the per-node context slice,
            // computed from the DAG structure (the agent-context-partitioner view).
            blocks.extend(inspector_blocks(dag, wave_index, node));

            // The HITL pause: a gate chip when this node wants the operator first.
            if node.ask_user_before_proceeding {
                blocks.push(Block::Chip {
                    label: "gate \u{00b7} needs you".into(),
                    tone: Tone::Gated,
                });
            }
        }
    }

    blocks
}

/// The INSPECTOR block group for one node: its input/output contracts (only when
/// non-empty) plus the scoped-context slice — what the agent-context-partitioner
/// would hand this node, derived from the DAG structure. Pulled out of
/// [`blocks_for_work`] so it is independently legible and testable.
///
/// Renders, under the node's existing chip/role/model lines:
///   - `  ⊢ in`  / `  ⊣ out`  — the contracts (KeyVals, skipped when empty),
///   - a `context` sub-section: `◖ full` / `◖ compressed` / `◖ shared` /
///     `◖ budget`, each a KeyVal whose key carries the partition name so the
///     operator (and tests) can read the slice. Long values use [`Block::WrappedText`]
///     so a wide dep list never truncates.
fn inspector_blocks(dag: &PredictedDag, wave_index: usize, node: &PredictedNode) -> Vec<Block> {
    let mut blocks = Vec::new();

    // Contracts — only when the node actually carries them.
    if !node.input_contract.trim().is_empty() {
        blocks.push(Block::KeyVal(
            "  \u{22a2} in".into(),
            node.input_contract.clone(),
        ));
    }
    if !node.output_contract.trim().is_empty() {
        blocks.push(Block::KeyVal(
            "  \u{22a3} out".into(),
            node.output_contract.clone(),
        ));
    }

    // The scoped slice, computed from the DAG structure.
    let ctx = scoped_context(dag, wave_index, node);

    // A faint sub-section label so the partition reads as a group.
    blocks.push(Block::WrappedText {
        text: "  context \u{2014} scoped slice".into(),
        tone: Tone::Resting,
    });

    // FULL: direct-dependency outputs (prior wave), verbatim.
    let full = if ctx.full_deps.is_empty() {
        "deps: (none)".to_string()
    } else {
        format!("deps: {}", ctx.full_deps.join(", "))
    };
    blocks.push(Block::KeyVal("  \u{25d6} full".into(), full));

    // COMPRESSED: earlier-wave summaries (bounded ~2k tok).
    let compressed = if ctx.compressed_waves.is_empty() {
        "none (nothing earlier to fold)".to_string()
    } else {
        let waves = ctx
            .compressed_waves
            .iter()
            .map(|w| w.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!("wave summaries {} \u{2191} ~2k tok", waves)
    };
    blocks.push(Block::KeyVal("  \u{25d6} compressed".into(), compressed));

    // SHARED: the whiteboard commons.
    blocks.push(Block::KeyVal(
        "  \u{25d6} shared".into(),
        format!("whiteboard: {}", ctx.whiteboard.join(", ")),
    ));

    // BUDGET: the token estimate — everything else is pruned.
    let budget_k = (ctx.est_budget_tokens as f64 / 1000.0 * 10.0).round() / 10.0;
    blocks.push(Block::KeyVal(
        "  \u{25d6} budget".into(),
        format!("~{}k tok \u{00b7} rest pruned", budget_k),
    ));

    blocks
}

/// A representative plan used by rendering tests and isolated visual tooling.
/// The live Work surface never calls this function.
/// The three nodes deliberately span the three commitment levels so the toned
/// chips are visible, and one node carries the HITL gate.
#[cfg(test)]
pub fn fixture() -> PredictedDag {
    PredictedDag {
        title: "Ship provider settings flow".into(),
        problem_classification: "well-structured".into(),
        confidence: 0.86,
        halt_reason: None,
        estimated_total_minutes: 40.0,
        estimated_total_cost_usd: 0.42,
        topology: Some("dag".into()),
        waves: vec![
            PredictedWave {
                wave_number: 1,
                parallelizable: false,
                nodes: vec![PredictedNode {
                    id: "research-api-patterns".into(),
                    skill_id: "api-architect".into(),
                    role_description: "Survey the existing settings + provider contracts".into(),
                    why: "Grounds the new flow in the shapes already in the codebase".into(),
                    commitment_level: "COMMITTED".into(),
                    input_contract: "Repo layout + current settings module".into(),
                    output_contract: "A provider-settings contract sketch".into(),
                    model_tier: "sonnet".into(),
                    estimated_minutes: 8.0,
                    estimated_cost_usd: 0.07,
                    cascade_depth: 2,
                    ask_user_before_proceeding: false,
                }],
            },
            PredictedWave {
                wave_number: 2,
                parallelizable: true,
                nodes: vec![
                    PredictedNode {
                        id: "implement-settings-ui".into(),
                        skill_id: "beautiful-gui-design".into(),
                        role_description: "Build the provider-settings panel".into(),
                        why: "The flow needs a real, accessible surface".into(),
                        commitment_level: "TENTATIVE".into(),
                        input_contract: "The provider-settings contract".into(),
                        output_contract: "A wired settings panel".into(),
                        model_tier: "opus".into(),
                        estimated_minutes: 16.0,
                        estimated_cost_usd: 0.22,
                        cascade_depth: 1,
                        ask_user_before_proceeding: false,
                    },
                    PredictedNode {
                        id: "write-tests".into(),
                        skill_id: "test-automation-expert".into(),
                        role_description: "Add regression coverage for the new flow".into(),
                        why: "The UI changes need confidence before landing".into(),
                        commitment_level: "EXPLORATORY".into(),
                        input_contract: "Existing component behavior".into(),
                        output_contract: "Passing tests for the changed flow".into(),
                        model_tier: "haiku".into(),
                        estimated_minutes: 10.0,
                        estimated_cost_usd: 0.05,
                        cascade_depth: 0,
                        ask_user_before_proceeding: false,
                    },
                ],
            },
            PredictedWave {
                wave_number: 3,
                parallelizable: false,
                nodes: vec![PredictedNode {
                    id: "ship-and-deploy".into(),
                    skill_id: "rust-app-distribution".into(),
                    role_description: "Cut the release once the gate is green".into(),
                    why: "Landing a settings flow touches the signed build".into(),
                    commitment_level: "TENTATIVE".into(),
                    input_contract: "Green CI + the wired panel".into(),
                    output_contract: "A signed, notarized release".into(),
                    model_tier: "sonnet".into(),
                    estimated_minutes: 6.0,
                    estimated_cost_usd: 0.08,
                    cascade_depth: 0,
                    ask_user_before_proceeding: true,
                }],
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_round_trips_a_minimal_dag() {
        // A small, real next_move-shaped payload (field names match the TS JSON).
        let json = r#"{
            "title": "Ship API endpoint with tests",
            "problem_classification": "well-structured",
            "confidence": 0.9,
            "estimated_total_minutes": 20,
            "estimated_total_cost_usd": 0.12,
            "topology": "dag",
            "waves": [
                {
                    "wave_number": 1,
                    "parallelizable": true,
                    "nodes": [
                        {
                            "id": "write-tests",
                            "skill_id": "vitest-testing-patterns",
                            "role_description": "Add regression coverage",
                            "why": "The UI changes need confidence",
                            "input_contract": "Existing component behavior",
                            "output_contract": "Passing tests for the changed flow",
                            "commitment_level": "COMMITTED",
                            "model_tier": "haiku",
                            "estimated_minutes": 10,
                            "estimated_cost_usd": 0.03,
                            "cascade_depth": 1,
                            "ask_user_before_proceeding": false
                        }
                    ]
                }
            ]
        }"#;
        let dag = parse(json).expect("parse a well-formed next_move payload");
        assert_eq!(dag.title, "Ship API endpoint with tests");
        assert_eq!(dag.problem_classification, "well-structured");
        assert!((dag.confidence - 0.9).abs() < 1e-9);
        assert_eq!(dag.waves.len(), 1);
        assert!(dag.waves[0].parallelizable);
        assert_eq!(dag.waves[0].nodes.len(), 1);
        let node = &dag.waves[0].nodes[0];
        assert_eq!(node.skill_id, "vitest-testing-patterns");
        assert_eq!(node.model_tier, "haiku");
        assert_eq!(node.commitment_level, "COMMITTED");
        assert!(!node.ask_user_before_proceeding);
    }

    #[test]
    fn parse_tolerates_missing_optional_fields() {
        // Only the title is present; everything else defaults — no error.
        let dag =
            parse(r#"{ "title": "bare" }"#).expect("missing optionals must default, not error");
        assert_eq!(dag.title, "bare");
        assert_eq!(dag.problem_classification, "");
        assert_eq!(dag.confidence, 0.0);
        assert!(dag.waves.is_empty());
        assert!(dag.halt_reason.is_none());
    }

    #[test]
    fn empty_dag_renders_a_title_header_and_no_chips() {
        // The empty (populated-but-no-waves) case still renders cleanly.
        let dag = PredictedDag::default();
        let blocks = blocks_for_work(&dag);
        assert!(
            !blocks.is_empty(),
            "even an empty DAG renders its header line"
        );
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Header(_))),
            "must emit a title Header"
        );
        // No waves ⇒ no node chips.
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::Chip { .. })),
            "an empty DAG has no node chips"
        );
    }

    #[test]
    fn fixture_renders_non_empty_with_title_and_a_chip_per_node() {
        let dag = fixture();
        let blocks = blocks_for_work(&dag);
        assert!(!blocks.is_empty(), "fixture must render blocks");

        // The first block is the title Header.
        match &blocks[0] {
            Block::Header(t) => assert!(!t.is_empty(), "title header must carry text"),
            other => panic!("first block must be the title Header, got {other:?}"),
        }

        // Count nodes across all waves, and the skill chips (commitment-toned).
        // Each node emits >= 1 chip (the skill chip); gated nodes emit a 2nd.
        let node_count: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
        assert!(node_count >= 3, "the fixture is a real multi-node DAG");
        let chip_count = blocks
            .iter()
            .filter(|b| matches!(b, Block::Chip { .. }))
            .count();
        assert!(
            chip_count >= node_count,
            "at least one chip per node (got {chip_count} chips for {node_count} nodes)"
        );

        // A header per wave (plus the title) — proves the wave structure renders.
        let header_count = blocks
            .iter()
            .filter(|b| matches!(b, Block::Header(_)))
            .count();
        assert_eq!(
            header_count,
            1 + dag.waves.len(),
            "one title header + one header per wave"
        );

        // The gated node (wave 3) emits a "needs you" gate chip.
        let has_gate_chip = blocks.iter().any(|b| {
            matches!(b, Block::Chip { label, tone }
            if label.contains("needs you") && *tone == Tone::Gated)
        });
        assert!(
            has_gate_chip,
            "the HITL-gated node must surface a gate chip"
        );
    }

    #[test]
    fn parallelizable_wave_marks_the_header() {
        let dag = fixture();
        let blocks = blocks_for_work(&dag);
        // Wave 2 is parallelizable in the fixture — its header carries the ∥ mark.
        let has_parallel_marker = blocks.iter().any(|b| {
            matches!(b, Block::Header(t)
            if t.starts_with("Wave 2") && t.contains('\u{2225}'))
        });
        assert!(
            has_parallel_marker,
            "a parallelizable wave header must carry the ∥ mark"
        );
        // Wave 1 is sequential — its header has no ∥.
        let wave1_plain = blocks.iter().any(|b| {
            matches!(b, Block::Header(t)
            if t == "Wave 1")
        });
        assert!(wave1_plain, "a sequential wave header carries no ∥ mark");
    }

    #[test]
    fn commitment_tone_distinguishes_the_three_levels() {
        assert_eq!(commitment_tone("COMMITTED"), Tone::Accent);
        assert_eq!(commitment_tone("TENTATIVE"), Tone::Engaged);
        assert_eq!(commitment_tone("EXPLORATORY"), Tone::Resting);
        // Case-insensitive (the planner may emit any casing).
        assert_eq!(commitment_tone("committed"), Tone::Accent);
        // The three real levels map to three distinct tones.
        assert_ne!(commitment_tone("COMMITTED"), commitment_tone("TENTATIVE"));
        assert_ne!(commitment_tone("TENTATIVE"), commitment_tone("EXPLORATORY"));
        assert_ne!(commitment_tone("COMMITTED"), commitment_tone("EXPLORATORY"));
        // An unknown level falls back to the neutral default.
        assert_eq!(commitment_tone("???"), Tone::Default);
    }

    #[test]
    fn to_json_round_trips_through_parse() {
        // The render handoff: serialize the live DAG to the proto's JSON shape,
        // then parse it straight back — the same bytes the Vello proto reads.
        let dag = fixture();
        let json = to_json(&dag).expect("a DAG serializes to JSON");
        let back = parse(&json).expect("the serialized JSON parses straight back in");
        assert_eq!(back.title, dag.title);
        assert_eq!(back.waves.len(), dag.waves.len());
        let orig_nodes: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
        let back_nodes: usize = back.waves.iter().map(|w| w.nodes.len()).sum();
        assert_eq!(back_nodes, orig_nodes, "no nodes lost in the round-trip");
        // A field on a deep node survives verbatim (the vendor-agnostic tier).
        assert_eq!(
            back.waves[1].nodes[0].model_tier,
            dag.waves[1].nodes[0].model_tier
        );
        assert_eq!(
            back.waves[2].nodes[0].ask_user_before_proceeding,
            dag.waves[2].nodes[0].ask_user_before_proceeding,
            "the HITL gate flag survives the round-trip"
        );
    }

    #[test]
    fn captured_intent_does_not_invent_nodes_or_provider_truth() {
        let snapshot = crate::agent::WorkSnapshot {
            intent: serde_json::json!({
                "intentId": "work_intent_1",
                "goal": { "text": "Consolidate work creation" }
            }),
            plan: Some(serde_json::json!({
                "state": "intent-captured",
                "shape": "unshaped",
                "confidence": 0,
                "evidence": "Intent is durable; planner unavailable.",
                "nodeSpecs": []
            })),
            execution: None,
        };
        let dag = from_work_snapshot(&snapshot);
        assert_eq!(dag.title, "Consolidate work creation");
        assert!(dag.waves.is_empty(), "an empty daemon plan stays empty");
        assert_eq!(dag.confidence, 0.0);
        assert_eq!(
            dag.halt_reason.as_deref(),
            Some("Intent is durable; planner unavailable.")
        );
        let json = to_json(&dag).expect("projection serializes");
        assert!(!json.contains("claude"));
        assert!(!json.contains("provider"));
    }

    #[test]
    fn only_daemon_node_specs_become_visual_nodes() {
        let snapshot = crate::agent::WorkSnapshot {
            intent: serde_json::json!({
                "intentId": "work_intent_2",
                "goal": { "text": "Build one governed node" }
            }),
            plan: Some(serde_json::json!({
                "state": "planned",
                "shape": "single-node",
                "confidence": 0.91,
                "nodeSpecs": [{
                    "nodeId": "agent_node_1",
                    "wave": 1,
                    "roleDescription": "Inspect daemon truth",
                    "capabilityTier": "reasoning",
                    "requiresApproval": true
                }]
            })),
            execution: None,
        };
        let dag = from_work_snapshot(&snapshot);
        assert_eq!(dag.waves.len(), 1);
        assert_eq!(dag.waves[0].nodes.len(), 1);
        assert_eq!(dag.waves[0].nodes[0].id, "agent_node_1");
        assert_eq!(dag.waves[0].nodes[0].model_tier, "reasoning");
        assert!(dag.waves[0].nodes[0].ask_user_before_proceeding);
    }

    #[test]
    fn parse_accepts_a_windags_next_move_shaped_payload() {
        // A representative windags `next_move` JSON (snake_case fields matching the
        // TS PredictedDAG -> serde) parses into a renderable DAG. This is the exact
        // shape the live windags hook will hand back when a provider key is valid.
        let json = r#"{
            "title": "Wire the Work prompt box to the Vello renderer",
            "problem_classification": "well-structured",
            "confidence": 0.78,
            "halt_reason": null,
            "estimated_total_minutes": 35,
            "estimated_total_cost_usd": 0.31,
            "topology": "dag",
            "waves": [
                {
                    "wave_number": 1,
                    "parallelizable": false,
                    "nodes": [
                        {
                            "id": "serialize-dag",
                            "skill_id": "api-architect",
                            "role_description": "Add Serialize so the console can emit the proto JSON",
                            "why": "Closes the loop to the Vello renderer with one source of truth",
                            "commitment_level": "COMMITTED",
                            "input_contract": "The PredictedDag types",
                            "output_contract": "A to_json that round-trips through parse",
                            "model_tier": "sonnet",
                            "estimated_minutes": 6,
                            "estimated_cost_usd": 0.05,
                            "cascade_depth": 2,
                            "ask_user_before_proceeding": false
                        }
                    ]
                },
                {
                    "wave_number": 2,
                    "parallelizable": true,
                    "nodes": [
                        {
                            "id": "render-action",
                            "skill_id": "beautiful-gui-design",
                            "role_description": "Add the Render graph action that shells capture.sh",
                            "why": "Operator needs a PNG receipt of the daemon WorkPlan",
                            "commitment_level": "TENTATIVE",
                            "input_contract": "A serialized DAG on disk",
                            "output_contract": "An opened PNG",
                            "model_tier": "gemini",
                            "estimated_minutes": 12,
                            "estimated_cost_usd": 0.09,
                            "cascade_depth": 0,
                            "ask_user_before_proceeding": true
                        }
                    ]
                }
            ]
        }"#;
        let dag = parse(json).expect("a windags next_move payload parses");
        assert_eq!(dag.title, "Wire the Work prompt box to the Vello renderer");
        assert_eq!(dag.problem_classification, "well-structured");
        assert_eq!(dag.waves.len(), 2);
        assert!(dag.waves[1].parallelizable);
        // The vendor-agnostic tier survives (gemini, not coerced to a Claude tier).
        assert_eq!(dag.waves[1].nodes[0].model_tier, "gemini");
        assert!(
            dag.waves[1].nodes[0].ask_user_before_proceeding,
            "the HITL gate parsed"
        );
        // It renders to blocks (title header + a chip per node) without panicking.
        let blocks = blocks_for_work(&dag);
        let node_count: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
        let chip_count = blocks
            .iter()
            .filter(|b| matches!(b, Block::Chip { .. }))
            .count();
        assert!(
            chip_count >= node_count,
            "at least one chip per parsed node"
        );
    }

    #[test]
    fn scoped_context_wave0_node_sees_only_the_prompt() {
        // A wave-0 node's FULL slice is the operator prompt sentinel; nothing
        // earlier exists, so no compressed wave summaries.
        let dag = fixture();
        let node = &dag.waves[0].nodes[0];
        let ctx = scoped_context(&dag, 0, node);
        assert_eq!(ctx.full_deps, vec![OPERATOR_PROMPT_DEP.to_string()]);
        assert!(
            ctx.compressed_waves.is_empty(),
            "wave-0 has nothing earlier to compress"
        );
        // The whiteboard commons are always present.
        assert!(ctx.whiteboard.contains(&"tech_stack".to_string()));
    }

    #[test]
    fn scoped_context_wave2_node_deps_prior_wave_and_compresses_wave0() {
        // A wave-2 node's FULL deps are the wave-1 node ids (feed-forward), and
        // wave 0 (strictly before the dep wave) is folded into the compressed slice.
        let dag = fixture();
        let node = &dag.waves[2].nodes[0];
        let ctx = scoped_context(&dag, 2, node);

        let wave1_ids: Vec<String> = dag.waves[1].nodes.iter().map(|n| n.id.clone()).collect();
        assert_eq!(
            ctx.full_deps, wave1_ids,
            "deps = the immediately-preceding wave's nodes"
        );
        assert!(
            !ctx.full_deps.is_empty(),
            "the fixture's wave 1 has nodes to depend on"
        );

        // Wave 0 is the only wave strictly before the dep wave (wave 1).
        assert_eq!(ctx.compressed_waves, vec![dag.waves[0].wave_number]);
    }

    #[test]
    fn scoped_context_wave1_node_has_no_compressed_waves() {
        // A wave-1 node depends on wave 0 directly; there is nothing *before*
        // wave 0, so its compressed slice is empty.
        let dag = fixture();
        let node = &dag.waves[1].nodes[0];
        let ctx = scoped_context(&dag, 1, node);
        let wave0_ids: Vec<String> = dag.waves[0].nodes.iter().map(|n| n.id.clone()).collect();
        assert_eq!(ctx.full_deps, wave0_ids);
        assert!(
            ctx.compressed_waves.is_empty(),
            "wave-1's dep wave is 0; nothing earlier"
        );
    }

    #[test]
    fn est_budget_grows_with_dep_count_and_wave_depth() {
        // Deeper waves accumulate compressed summaries, so the budget is monotone
        // increasing across the fixture's waves (which also gain deps with depth).
        let dag = fixture();
        let b0 = scoped_context(&dag, 0, &dag.waves[0].nodes[0]).est_budget_tokens;
        let b1 = scoped_context(&dag, 1, &dag.waves[1].nodes[0]).est_budget_tokens;
        let b2 = scoped_context(&dag, 2, &dag.waves[2].nodes[0]).est_budget_tokens;
        assert!(
            b1 >= b0,
            "wave 1 deps the full prior wave; >= the prompt-only budget"
        );
        assert!(
            b2 > b1,
            "wave 2 adds a compressed summary on top of its deps"
        );

        // Directly: more direct deps ⇒ bigger full slice ⇒ bigger budget.
        let mut wide = PredictedDag::default();
        wide.waves.push(PredictedWave {
            wave_number: 0,
            parallelizable: true,
            nodes: vec![
                PredictedNode {
                    id: "a".into(),
                    ..Default::default()
                },
                PredictedNode {
                    id: "b".into(),
                    ..Default::default()
                },
                PredictedNode {
                    id: "c".into(),
                    ..Default::default()
                },
            ],
        });
        wide.waves.push(PredictedWave {
            wave_number: 1,
            parallelizable: false,
            nodes: vec![PredictedNode {
                id: "sink".into(),
                ..Default::default()
            }],
        });
        let three_dep_budget = scoped_context(&wide, 1, &wide.waves[1].nodes[0]).est_budget_tokens;
        // The wave-0 (prompt-only, 1 dep) node has a smaller budget than the
        // wave-1 node that depends on three upstream nodes.
        let one_dep_budget = scoped_context(&wide, 0, &wide.waves[0].nodes[0]).est_budget_tokens;
        assert!(
            three_dep_budget > one_dep_budget,
            "more deps ⇒ larger token budget"
        );
    }

    #[test]
    fn blocks_render_partition_markers_and_contracts() {
        // The INSPECTOR slice surfaces: the contracts (in/out KeyVals) and the
        // four partition markers (full / compressed / shared / budget).
        let dag = fixture();
        let blocks = blocks_for_work(&dag);

        let has_full = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("full")));
        let has_compressed = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("compressed")));
        let has_shared = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("shared")));
        let has_budget = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("budget")));
        assert!(
            has_full,
            "a node must surface the FULL (deps) partition marker"
        );
        assert!(
            has_compressed,
            "a node must surface the COMPRESSED partition marker"
        );
        assert!(
            has_shared,
            "a node must surface the SHARED (whiteboard) partition marker"
        );
        assert!(
            has_budget,
            "a node must surface the BUDGET partition marker"
        );

        // The budget marker carries the pruning legend + a token estimate.
        let budget_reads_pruned = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(k, v)
            if k.contains("budget") && v.contains("pruned") && v.contains("tok"))
        });
        assert!(
            budget_reads_pruned,
            "the budget marker reads '~Nk tok · rest pruned'"
        );

        // The contracts render as KeyVals carrying the fixture's contract text.
        let has_in_contract = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(_, v)
            if v.contains("Repo layout"))
        });
        let has_out_contract = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(_, v)
            if v.contains("provider-settings contract sketch"))
        });
        assert!(has_in_contract, "the input_contract renders as a KeyVal");
        assert!(has_out_contract, "the output_contract renders as a KeyVal");
    }

    #[test]
    fn full_marker_names_the_prior_wave_deps() {
        // The deepest node's FULL marker lists the wave-1 node ids by name — the
        // operator can read exactly which upstream outputs it gets verbatim.
        let dag = fixture();
        let blocks = blocks_for_work(&dag);
        let wave1_first = dag.waves[1].nodes[0].id.clone();
        let names_a_dep = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(k, v)
            if k.contains("full") && v.contains(&wave1_first))
        });
        assert!(
            names_a_dep,
            "the FULL marker names the prior-wave dep ids (e.g. {wave1_first})"
        );

        // And a wave-0 node's FULL marker names the operator prompt sentinel.
        let names_prompt = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(k, v)
            if k.contains("full") && v.contains(OPERATOR_PROMPT_DEP))
        });
        assert!(
            names_prompt,
            "a wave-0 node's FULL marker is the operator prompt"
        );
    }

    #[test]
    fn contracts_are_skipped_when_empty() {
        // A node with no contracts emits no in/out KeyVals but still its context slice.
        let mut dag = PredictedDag::default();
        dag.waves.push(PredictedWave {
            wave_number: 0,
            parallelizable: false,
            nodes: vec![PredictedNode {
                id: "bare".into(),
                skill_id: "research".into(),
                commitment_level: "COMMITTED".into(),
                // input_contract / output_contract left empty.
                ..Default::default()
            }],
        });
        let blocks = blocks_for_work(&dag);
        let has_in = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("in")));
        let has_out = blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("out")));
        assert!(!has_in, "no input_contract ⇒ no in KeyVal");
        assert!(!has_out, "no output_contract ⇒ no out KeyVal");
        // The context slice still renders.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k.contains("budget"))));
    }

    #[test]
    fn model_tier_is_vendor_agnostic() {
        // A non-Claude tier string renders without special-casing.
        let mut dag = PredictedDag::default();
        dag.waves.push(PredictedWave {
            wave_number: 1,
            parallelizable: false,
            nodes: vec![PredictedNode {
                skill_id: "research".into(),
                model_tier: "gemini".into(),
                estimated_cost_usd: 0.01,
                estimated_minutes: 3.0,
                commitment_level: "COMMITTED".into(),
                ..Default::default()
            }],
        });
        let blocks = blocks_for_work(&dag);
        let has_gemini = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(k, v)
            if k.contains("model") && v.contains("gemini"))
        });
        assert!(
            has_gemini,
            "model_tier renders generically (gemini, not just claude)"
        );
    }
}
