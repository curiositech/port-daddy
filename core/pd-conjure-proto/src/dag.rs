//! The `PredictedDag` data shape — a serde-portable mirror of
//! `pd-console/src/conjure.rs`'s `PredictedDag` / `PredictedWave` /
//! `PredictedNode`. Duplicated here (not depended-on) so this proto does NOT
//! pull the gpui crate; the field names match the JSON exactly, so
//! `conjure::fixture()` serialized to JSON (see `fixture.json`) deserializes
//! straight in. All optional fields carry `#[serde(default)]` so a partial
//! jury_rig `next_move` payload still yields a renderable DAG.

use serde::Deserialize;

/// Top-level planner output. Mirrors `conjure::PredictedDag`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PredictedDag {
    pub title: String,
    #[serde(default)]
    pub problem_classification: String,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub halt_reason: Option<String>,
    #[serde(default)]
    pub waves: Vec<PredictedWave>,
    #[serde(default)]
    pub estimated_total_minutes: f64,
    #[serde(default)]
    pub estimated_total_cost_usd: f64,
    #[serde(default)]
    pub topology: Option<String>,
}

/// One execution wave. Mirrors `conjure::PredictedWave`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PredictedWave {
    #[serde(default)]
    pub wave_number: u32,
    #[serde(default)]
    pub parallelizable: bool,
    #[serde(default)]
    pub nodes: Vec<PredictedNode>,
}

/// A single predicted unit of work. Mirrors `conjure::PredictedNode`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PredictedNode {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub skill_id: String,
    #[serde(default)]
    pub role_description: String,
    #[serde(default)]
    pub why: String,
    /// "COMMITTED" | "TENTATIVE" | "EXPLORATORY" — free string; styling derived.
    #[serde(default)]
    pub commitment_level: String,
    #[serde(default)]
    pub input_contract: String,
    #[serde(default)]
    pub output_contract: String,
    /// Vendor-agnostic capability tier label — rendered VERBATIM
    /// ("opus"/"sonnet"/"haiku"/"gemini"/"codex"/"groq"/…), never coerced to Claude.
    #[serde(default)]
    pub model_tier: String,
    #[serde(default)]
    pub estimated_minutes: f64,
    #[serde(default)]
    pub estimated_cost_usd: f64,
    #[serde(default)]
    pub cascade_depth: u32,
    /// Interactive clients stop and ask before executing this node (the HITL gate).
    #[serde(default)]
    pub ask_user_before_proceeding: bool,
}

/// Parse a jury_rig-shaped JSON payload into a [`PredictedDag`]. Tolerant of
/// missing optionals (all `#[serde(default)]`).
pub fn parse(json: &str) -> anyhow::Result<PredictedDag> {
    Ok(serde_json::from_str::<PredictedDag>(json)?)
}

/// The three commitment levels, normalized.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Commitment {
    Committed,
    Tentative,
    Exploratory,
    Unknown,
}

impl Commitment {
    pub fn of(level: &str) -> Self {
        match level.trim().to_ascii_uppercase().as_str() {
            "COMMITTED" => Commitment::Committed,
            "TENTATIVE" => Commitment::Tentative,
            "EXPLORATORY" => Commitment::Exploratory,
            _ => Commitment::Unknown,
        }
    }
}

/// A feed-forward edge. Mirrors the React-Flow layout in
/// `workgroup-ai/packages/cli/src/visualize-dag.ts`: every node in wave `w`
/// depends on every node in wave `w-1`, and the edge is styled by the *target*
/// node's commitment level.
pub struct Edge {
    pub source: String,
    pub target: String,
    pub commitment: Commitment,
}

/// Build feed-forward edges between consecutive waves (ported from
/// `visualize-dag.ts::buildEdges`). There is no per-node dependency field on
/// `PredictedNode`, so each wave fully connects to the prior one.
pub fn build_edges(dag: &PredictedDag) -> Vec<Edge> {
    let mut edges = Vec::new();
    for w in 1..dag.waves.len() {
        let prev = &dag.waves[w - 1].nodes;
        let curr = &dag.waves[w].nodes;
        for s in prev {
            for t in curr {
                edges.push(Edge {
                    source: s.id.clone(),
                    target: t.id.clone(),
                    commitment: Commitment::of(&t.commitment_level),
                });
            }
        }
    }
    edges
}
