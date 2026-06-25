//! Conjure — the prompt → predicted-DAG surface (foundation slice).
//!
//! The operator types intent; windags blooms a hypertree DAG of skill-equipped
//! agent nodes. This module is the *foundation* slice: the serde-portable
//! `PredictedDag`/`PredictedWave`/`PredictedNode` types (ported from
//! `workgroup-ai/packages/core/src/types/next-move.ts`, field names matching the
//! JSON so a future `windags_next_move` response deserializes straight in) and a
//! render that turns a DAG into the console's render-agnostic [`Block`]s.
//!
//! Explicitly NOT in this slice (later rungs, per `docs/CONJURE-DAG-SURFACE.md`):
//!   - the network call to `windags_next_move`,
//!   - the Vello/GPU node-graph,
//!   - agent dispatch.
//! The surface renders a hardcoded [`fixture`] DAG through the existing Block UI.
//!
//! Vendor-agnostic on purpose: `model_tier` is a free string ("opus" / "sonnet"
//! / "haiku" / "gemini" / "codex" / …) — rendered generically. Dispatch (a later
//! slice) routes through pd's multi-vendor spawner / the Giant Squid Harness
//! (ADR-0091), never a Claude-only assumption.

use crate::pane::{Block, Tone};
use serde::Deserialize;

/// Top-level planner output. Mirrors the TS `PredictedDAG`. Optional/extra fields
/// carry `#[serde(default)]` so a partial windags payload still deserializes.
#[derive(Debug, Clone, Default, Deserialize)]
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
#[derive(Debug, Clone, Default, Deserialize)]
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
#[derive(Debug, Clone, Default, Deserialize)]
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

/// Parse a windags `next_move` JSON payload into a [`PredictedDag`]. Tolerant of
/// missing optional fields (all carry `#[serde(default)]`), so a partial response
/// still yields a renderable DAG rather than an error.
pub fn parse(json: &str) -> anyhow::Result<PredictedDag> {
    let dag = serde_json::from_str::<PredictedDag>(json)?;
    Ok(dag)
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

/// Render a [`PredictedDag`] into the console's render-agnostic [`Block`]s — the
/// foundation surface. Emits a title header, a classification/confidence line,
/// then per wave a header (marked `∥` when parallelizable) and per node a
/// commitment-toned chip plus role / model-cost / scoped-context detail, with a
/// HITL gate chip when the node asks for approval.
pub fn blocks_for_conjure(dag: &PredictedDag) -> Vec<Block> {
    let mut blocks = Vec::new();

    // Title.
    let title = if dag.title.is_empty() { "Conjure \u{2014} predicted DAG".to_string() } else { dag.title.clone() };
    blocks.push(Block::Header(title));

    // Classification + confidence (one KeyVal carrying both, the planner header).
    let classification = if dag.problem_classification.is_empty() {
        "unclassified".to_string()
    } else {
        dag.problem_classification.clone()
    };
    blocks.push(Block::KeyVal(
        "classification".into(),
        format!("{classification} \u{00b7} {:.0}% confidence", dag.confidence * 100.0),
    ));

    // A halt reason (if the planner refused) reads in full — the operator must see it.
    if let Some(reason) = &dag.halt_reason {
        blocks.push(Block::WrappedText { text: format!("halt: {reason}"), tone: Tone::Gated });
    }

    // Per wave.
    for wave in &dag.waves {
        blocks.push(Block::Gap);
        let parallel = if wave.parallelizable { " \u{00b7} \u{2225}" } else { "" };
        blocks.push(Block::Header(format!("Wave {}{parallel}", wave.wave_number)));

        // Per node.
        for node in &wave.nodes {
            // The skill chip, toned by commitment level.
            blocks.push(Block::Chip {
                label: node.skill_id.clone(),
                tone: commitment_tone(&node.commitment_level),
            });
            // Role.
            blocks.push(Block::KeyVal("  role".into(), node.role_description.clone()));
            // Model / cost / time — vendor-agnostic tier string.
            blocks.push(Block::KeyVal(
                "  model".into(),
                format!(
                    "{} \u{00b7} ${:.2} \u{00b7} {}m",
                    node.model_tier, node.estimated_cost_usd, node.estimated_minutes
                ),
            ));
            // The scoped-context partition legend.
            blocks.push(Block::KeyVal("  ctx".into(), context_hint(node)));
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

/// A real 3-wave fixture DAG mirroring `docs/CONJURE-DAG-SURFACE.md` — the
/// foundation surface renders this until the windags call lands (later slice).
/// The three nodes deliberately span the three commitment levels so the toned
/// chips are visible, and one node carries the HITL gate.
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
        let dag = parse(r#"{ "title": "bare" }"#).expect("missing optionals must default, not error");
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
        let blocks = blocks_for_conjure(&dag);
        assert!(!blocks.is_empty(), "even an empty DAG renders its header line");
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
        let blocks = blocks_for_conjure(&dag);
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
        let chip_count = blocks.iter().filter(|b| matches!(b, Block::Chip { .. })).count();
        assert!(
            chip_count >= node_count,
            "at least one chip per node (got {chip_count} chips for {node_count} nodes)"
        );

        // A header per wave (plus the title) — proves the wave structure renders.
        let header_count = blocks.iter().filter(|b| matches!(b, Block::Header(_))).count();
        assert_eq!(
            header_count,
            1 + dag.waves.len(),
            "one title header + one header per wave"
        );

        // The gated node (wave 3) emits a "needs you" gate chip.
        let has_gate_chip = blocks.iter().any(|b| matches!(b, Block::Chip { label, tone }
            if label.contains("needs you") && *tone == Tone::Gated));
        assert!(has_gate_chip, "the HITL-gated node must surface a gate chip");
    }

    #[test]
    fn parallelizable_wave_marks_the_header() {
        let dag = fixture();
        let blocks = blocks_for_conjure(&dag);
        // Wave 2 is parallelizable in the fixture — its header carries the ∥ mark.
        let has_parallel_marker = blocks.iter().any(|b| matches!(b, Block::Header(t)
            if t.starts_with("Wave 2") && t.contains('\u{2225}')));
        assert!(has_parallel_marker, "a parallelizable wave header must carry the ∥ mark");
        // Wave 1 is sequential — its header has no ∥.
        let wave1_plain = blocks.iter().any(|b| matches!(b, Block::Header(t)
            if t == "Wave 1"));
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
        let blocks = blocks_for_conjure(&dag);
        let has_gemini = blocks.iter().any(|b| matches!(b, Block::KeyVal(k, v)
            if k.contains("model") && v.contains("gemini")));
        assert!(has_gemini, "model_tier renders generically (gemini, not just claude)");
    }
}
