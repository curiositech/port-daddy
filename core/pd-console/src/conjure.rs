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
use serde::{Deserialize, Serialize};

/// Top-level planner output. Mirrors the TS `PredictedDAG`. Optional/extra fields
/// carry `#[serde(default)]` so a partial windags payload still deserializes.
/// `Serialize` is what closes the loop to the Vello renderer: the console
/// serializes its live `PredictedDag` back out to the exact JSON shape
/// `pd-conjure-proto` reads (`fixture.json`), so a prompt-derived DAG renders to
/// a PNG without any second source of truth.
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

/// Parse a windags `next_move` JSON payload into a [`PredictedDag`]. Tolerant of
/// missing optional fields (all carry `#[serde(default)]`), so a partial response
/// still yields a renderable DAG rather than an error.
pub fn parse(json: &str) -> anyhow::Result<PredictedDag> {
    let dag = serde_json::from_str::<PredictedDag>(json)?;
    Ok(dag)
}

/// Serialize a [`PredictedDag`] to the exact JSON shape `pd-conjure-proto` reads
/// (its `fixture.json` / first CLI arg). Pretty-printed so a written handoff file
/// is human-legible. This is the other half of the render handoff: the console
/// owns the live DAG, writes it here, and the Vello proto renders it to a PNG —
/// one source of truth, round-tripped through serde.
pub fn to_json(dag: &PredictedDag) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(dag)?)
}

/// Build a [`PredictedDag`] for an operator prompt.
///
/// LIVE WINDAGS HOOK (TODO — this slice ships the fixture path):
///   The real planner is `windags_next_move` (the MCP tool) /
///   `workgroup-ai` `next-move --json --legacy-predictor`. Neither is a clean
///   one-shot from this binary today:
///     - the MCP server is stdio and gathers repo context itself (no prompt arg
///       on the CLI — it auto-derives intent from git/files), and is deprecated
///       behind `--legacy-predictor`;
///     - it needs a *valid* provider key. In the build environment the stored
///       `~/.windags/providers.json` anthropic key returned 401 invalid x-api-key,
///       so no live DAG could be produced for this slice.
///   When a clean hook lands, replace the body below with:
///     1. spawn `windags next-move --json --legacy-predictor` (or POST the MCP
///        tool) with `ANTHROPIC_API_KEY` in env and the prompt as the
///        conversation summary,
///     2. read stdout, `parse(json)` it,
///     3. on any error fall back to `seeded_from_prompt(prompt)` (below) so the
///        surface is never empty.
///   The prompt → PredictedDag → Block UI → PNG wiring is identical either way;
///   only this function's body swaps from fixture-seeded to live.
///
/// Until then this returns the real 3-wave [`fixture`] DAG re-titled with the
/// operator's prompt, so the typed intent visibly drives the rendered graph
/// (the title header + the PNG caption both echo it) instead of a static label.
pub fn from_prompt(prompt: &str) -> PredictedDag {
    seeded_from_prompt(prompt)
}

/// The deterministic fixture-seeded DAG for a prompt: the [`fixture`] topology
/// with its title replaced by the (trimmed) operator prompt. Pulled out so the
/// future live path can call it as the offline fallback, and so it is unit-test
/// targetable without a network/provider.
pub fn seeded_from_prompt(prompt: &str) -> PredictedDag {
    let mut dag = fixture();
    let trimmed = prompt.trim();
    if !trimmed.is_empty() {
        dag.title = trimmed.to_string();
    }
    dag
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
/// The partitioner's contract (from the Conjure design / `ScopedAccumulator`):
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
pub fn blocks_for_conjure(dag: &PredictedDag) -> Vec<Block> {
    let mut blocks = Vec::new();

    // Title.
    let title = if dag.title.is_empty() {
        "Conjure \u{2014} predicted DAG".to_string()
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
/// [`blocks_for_conjure`] so it is independently legible and testable.
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

// ── DISPATCH ──────────────────────────────────────────────────────────────────
//
// Turn predicted nodes into real spawn requests, routed by `model_tier` to the
// right vendor, and run them through the console's EXISTING spawn path (the same
// `DaemonClient::spawn` the operator's manual Spawn command uses, which calls the
// daemon's existing multi-vendor spawner `lib/spawner.ts`). This module owns only
// the pure request-shaping + HITL gating; `app.rs`/`main.rs` own the transport.
//
// HONEST FRAMING: live dispatch is env-dependent — it needs the daemon up and the
// target vendor CLI installed + launchable (codex / claude-cli already pass
// readiness; gemini if installed). The Giant Squid Harness (ADR-0091, Proposed /
// NOT BUILT) is the FUTURE coordination upgrade for richer in-loop vendor-hook
// orchestration. This slice wires + tests the spawn path; it does not depend on
// the daemon being up to compile or to unit-test the request shaping.

use crate::agent::{backend_for_tier, Backend};

/// A spawn request shaped from one [`PredictedNode`], ready to hand to the
/// console's existing spawn path. The fields map 1:1 onto `DaemonClient::spawn`
/// args: `backend` (vendor chosen by `model_tier`), `goal` (the agent's task
/// prompt, built from the node's role + why), and `skill_id` (the skill the
/// agent loads). The transport layer adds the project/channel and calls `spawn`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchRequest {
    /// Stable node id this request came from (for the dispatched-note + alerts).
    pub node_id: String,
    /// The vendor to spawn on, resolved from `model_tier` via the multi-vendor map.
    pub backend: Backend,
    /// The skill the spawned agent loads (e.g. "api-architect").
    pub skill_id: String,
    /// The agent's task prompt: the node's role plus its rationale.
    pub goal: String,
    /// The capability/vendor tier string the node carried (for display).
    pub model_tier: String,
}

/// Build the spawn request for a single node — the multi-vendor routing happens
/// here: `backend = backend_for_tier(node.model_tier)`. The goal is the node's
/// `role_description` (what to do) plus its `why` (the rationale) so the spawned
/// agent has the same grounding the operator sees in the Conjure surface. The
/// skill id is passed straight through so the agent loads the predicted skill.
pub fn dispatch_request_for(node: &PredictedNode) -> DispatchRequest {
    let mut goal = node.role_description.trim().to_string();
    let why = node.why.trim();
    if !why.is_empty() {
        // Keep the prompt self-describing: the role is the instruction, the
        // why is the context. A spawned agent reads both.
        goal = format!("{goal}\n\nWhy this matters: {why}");
    }
    DispatchRequest {
        node_id: node.id.clone(),
        backend: backend_for_tier(&node.model_tier),
        skill_id: node.skill_id.clone(),
        goal,
        model_tier: node.model_tier.clone(),
    }
}

/// Select the nodes that "Dispatch DAG" should auto-spawn, RESPECTING THE HITL
/// GATE: a node with `ask_user_before_proceeding` is **excluded** here (it must
/// be dispatched one at a time via an explicit confirm, never swept up in a
/// dispatch-all). Returns one [`DispatchRequest`] per eligible node, in wave
/// order, so the caller can fire them through the existing spawn path.
pub fn dispatch_targets(dag: &PredictedDag) -> Vec<DispatchRequest> {
    dag.waves
        .iter()
        .flat_map(|w| w.nodes.iter())
        .filter(|n| !n.ask_user_before_proceeding)
        .map(dispatch_request_for)
        .collect()
}

/// How many nodes in the DAG are HITL-gated (held back from dispatch-all) — used
/// to honestly tell the operator "dispatched N, held back M for your approval".
pub fn gated_node_count(dag: &PredictedDag) -> usize {
    dag.waves
        .iter()
        .flat_map(|w| w.nodes.iter())
        .filter(|n| n.ask_user_before_proceeding)
        .count()
}

// ── LIVE GENERATION (claude:cli, the Max seat — NO API key) ─────────────────────
//
// The operator types intent; we ask `claude -p "<DAG_GEN_PROMPT>"` to bloom a real
// PredictedDAG tailored to that intent. This runs the Max-seat CLI in print mode
// (headless, no API key — the user's interactive Claude Code login), parses ONLY
// the JSON it returns, and on ANY error falls back to `seeded_from_prompt(prompt)`
// (the fixture) so the surface is NEVER empty/broken. The pure pieces below
// (`augmented_path`, `dag_gen_prompt`, `parse_claude_dag_output`) are unit-tested
// in the headless repl bin; the live spawn in `generate_dag_via_cli` is an
// integration path (env-dependent on the claude binary) and is not unit-tested.

/// Build a PATH that finds developer tools even when the process did NOT inherit a
/// login shell's PATH — the exact failure mode of a macOS .app launched from
/// Finder (no `cargo`, no `claude`: "command not found"). We PREPEND the canonical
/// tool dirs (`~/.cargo/bin`, `~/.local/bin`, Homebrew, the system bins) to
/// whatever PATH we did inherit, so a shelled `cargo`/`claude` resolves. Returns a
/// single `:`-joined string suitable for `.env("PATH", …)`.
pub fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    // Highest-priority dirs first; these are the homes of cargo + the claude CLI.
    let mut dirs: Vec<String> = Vec::new();
    if !home.is_empty() {
        dirs.push(format!("{home}/.cargo/bin"));
        dirs.push(format!("{home}/.local/bin"));
    }
    for sys in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(sys.to_string());
    }
    // Append the inherited PATH (deduplicated) so nothing the user already had is lost.
    if let Ok(existing) = std::env::var("PATH") {
        for seg in existing.split(':') {
            let seg = seg.trim();
            if !seg.is_empty() && !dirs.iter().any(|d| d == seg) {
                dirs.push(seg.to_string());
            }
        }
    }
    dirs.join(":")
}

/// Resolve the `claude` CLI binary: prefer the known install path
/// (`~/.local/bin/claude`), then fall back to the bare name `claude` (resolved
/// against [`augmented_path`] by the spawned process). Returns the absolute path
/// when it exists on disk, else the bare name so PATH resolution can take over.
pub fn claude_binary() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let local = std::path::PathBuf::from(&home).join(".local/bin/claude");
        if local.exists() {
            return local.to_string_lossy().into_owned();
        }
    }
    "claude".to_string()
}

/// The prompt handed to `claude -p` to bloom a tailored DAG. It pins the EXACT
/// serde schema of [`PredictedDag`]/[`PredictedWave`]/[`PredictedNode`] and demands
/// raw JSON (no prose, no code fences) so [`parse_claude_dag_output`] can read it.
/// It asks for a small, real plan (3–5 nodes across 2–4 waves) that VARIES the
/// `model_tier` across vendors and gates EXACTLY ONE node behind the HITL flag.
pub fn dag_gen_prompt(prompt: &str) -> String {
    let intent = prompt.trim();
    format!(
        "You are a planning oracle for a multi-agent orchestrator. The operator's \
intent is:\n\n\"{intent}\"\n\n\
Output ONLY a single JSON object (no prose, no markdown, no code fences) that is a \
predicted DAG of skill-equipped agent nodes tailored to that intent. Use EXACTLY \
this schema (snake_case keys):\n\
{{\n\
  \"title\": string (echo/refine the operator intent),\n\
  \"problem_classification\": \"well-structured\" | \"ill-structured\" | \"wicked\",\n\
  \"confidence\": number in 0..1,\n\
  \"estimated_total_minutes\": number,\n\
  \"estimated_total_cost_usd\": number,\n\
  \"topology\": \"dag\",\n\
  \"waves\": [\n\
    {{\n\
      \"wave_number\": integer (1-based),\n\
      \"parallelizable\": boolean,\n\
      \"nodes\": [\n\
        {{\n\
          \"id\": string (kebab-case, stable),\n\
          \"skill_id\": string (a concrete skill, e.g. \"api-architect\"),\n\
          \"role_description\": string (what this agent does in context),\n\
          \"why\": string (why this skill, why now),\n\
          \"commitment_level\": \"COMMITTED\" | \"TENTATIVE\" | \"EXPLORATORY\",\n\
          \"input_contract\": string (what it needs from upstream),\n\
          \"output_contract\": string (what it delivers),\n\
          \"model_tier\": one of \"sonnet\", \"opus\", \"gemini\", \"codex\" (VARY across nodes),\n\
          \"estimated_minutes\": number,\n\
          \"estimated_cost_usd\": number,\n\
          \"cascade_depth\": integer (how many downstream nodes depend on this one),\n\
          \"ask_user_before_proceeding\": boolean\n\
        }}\n\
      ]\n\
    }}\n\
  ]\n\
}}\n\n\
Constraints: 3 to 5 nodes total across 2 to 4 waves; the `model_tier` values must \
span at least two different vendors (mix sonnet/opus with gemini and/or codex); \
set `ask_user_before_proceeding` to true on EXACTLY ONE node (the riskiest, e.g. a \
ship/deploy/irreversible step) and false on all others. Respond with the JSON only."
    )
}

/// Robustly extract a [`PredictedDag`] from whatever `claude -p` printed. Handles:
///   - a clean raw JSON object,
///   - a ```json … ``` (or bare ``` … ```) fenced block,
///   - leading/trailing prose around an embedded `{ … }` object.
/// Strategy: strip code fences, then take the substring from the FIRST `{` to the
/// LAST `}` (the outer object) and [`parse`] it. Returns an error on anything that
/// does not yield a valid DAG, so the caller can fall back to the fixture.
pub fn parse_claude_dag_output(raw: &str) -> anyhow::Result<PredictedDag> {
    use anyhow::{anyhow, Context};
    let mut text = raw.trim().to_string();

    // Strip a fenced block if present: ```json\n … \n``` or ```\n … \n```.
    if let Some(start) = text.find("```") {
        // Drop everything up to and including the opening fence line.
        let after_open = &text[start + 3..];
        // The opening fence may carry a language tag (e.g. "json"); skip to EOL.
        let body_start = after_open.find('\n').map(|i| i + 1).unwrap_or(0);
        let body = &after_open[body_start..];
        // Drop the closing fence (and anything after it).
        let body = match body.find("```") {
            Some(end) => &body[..end],
            None => body,
        };
        text = body.trim().to_string();
    }

    // Take the outer object: first '{' through last '}'.
    let open = text
        .find('{')
        .ok_or_else(|| anyhow!("no JSON object found in claude output"))?;
    let close = text
        .rfind('}')
        .ok_or_else(|| anyhow!("no closing brace found in claude output"))?;
    if close < open {
        return Err(anyhow!("malformed JSON braces in claude output"));
    }
    let json = &text[open..=close];
    let dag = parse(json).context("parsing the claude-emitted DAG JSON")?;
    // A DAG with no waves is not useful — treat it as a failure so we fall back.
    if dag.waves.is_empty() {
        return Err(anyhow!("claude returned a DAG with no waves"));
    }
    Ok(dag)
}

/// Generate a real [`PredictedDag`] for `prompt` by shelling the Max-seat `claude`
/// CLI in print mode (`claude -p "<DAG_GEN_PROMPT>"`). MUST run off the gpui render
/// thread (a CLI round-trip is multi-second). Resolves the binary via
/// [`claude_binary`] and runs it with an augmented PATH (so a Finder-launched .app
/// still finds `claude`). On ANY failure — binary missing, non-zero exit, garbage
/// output — it returns [`seeded_from_prompt`] (the fixture, re-titled with the
/// prompt) so the Conjure surface is never empty or broken.
pub fn generate_dag_via_cli(prompt: &str) -> anyhow::Result<PredictedDag> {
    let bin = claude_binary();
    let gen_prompt = dag_gen_prompt(prompt);
    let output = std::process::Command::new(&bin)
        .arg("-p")
        .arg(&gen_prompt)
        .env("PATH", augmented_path())
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            match parse_claude_dag_output(&stdout) {
                Ok(mut dag) => {
                    // Keep the operator's exact intent as the title if claude blanked it.
                    if dag.title.trim().is_empty() {
                        dag.title = prompt.trim().to_string();
                    }
                    Ok(dag)
                }
                Err(_) => Ok(seeded_from_prompt(prompt)),
            }
        }
        // Non-zero exit or spawn failure (e.g. binary missing) → the fixture fallback.
        _ => Ok(seeded_from_prompt(prompt)),
    }
}

/// A real 3-wave fixture DAG mirroring `docs/CONJURE-DAG-SURFACE.md` — the
/// foundation surface renders this until the windags call lands (later slice).
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
        let blocks = blocks_for_conjure(&dag);
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
        let blocks = blocks_for_conjure(&dag);
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
    fn from_prompt_titles_the_dag_with_the_operator_intent() {
        // The prompt visibly drives the rendered DAG: the title header echoes it.
        let dag = from_prompt("  Add a retry budget to the dispatcher  ");
        assert_eq!(
            dag.title, "Add a retry budget to the dispatcher",
            "trimmed prompt becomes the title"
        );
        // It's a real, renderable multi-wave DAG (the fixture topology), not empty.
        assert!(
            dag.waves.len() >= 3,
            "a prompt-derived DAG carries the real wave structure"
        );
        let blocks = blocks_for_conjure(&dag);
        match &blocks[0] {
            Block::Header(t) => assert_eq!(t, "Add a retry budget to the dispatcher"),
            other => panic!("first block must be the prompt title header, got {other:?}"),
        }
        // And it round-trips to the proto's JSON shape with the prompt title intact.
        let json = to_json(&dag).expect("prompt-derived DAG serializes");
        let back = parse(&json).expect("prompt-derived DAG round-trips");
        assert_eq!(back.title, "Add a retry budget to the dispatcher");
    }

    #[test]
    fn from_prompt_empty_keeps_the_fixture_title() {
        // An empty/whitespace prompt must not blank the title — keep the fixture's.
        let dag = from_prompt("   ");
        assert_eq!(
            dag.title,
            fixture().title,
            "empty prompt falls back to the fixture title"
        );
        assert!(!dag.waves.is_empty());
    }

    #[test]
    fn parse_accepts_a_windags_next_move_shaped_payload() {
        // A representative windags `next_move` JSON (snake_case fields matching the
        // TS PredictedDAG -> serde) parses into a renderable DAG. This is the exact
        // shape the live windags hook will hand back when a provider key is valid.
        let json = r#"{
            "title": "Wire the Conjure prompt box to the Vello renderer",
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
                            "why": "Operator needs the PNG of the DAG they conjured",
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
        assert_eq!(
            dag.title,
            "Wire the Conjure prompt box to the Vello renderer"
        );
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
        let blocks = blocks_for_conjure(&dag);
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
        let blocks = blocks_for_conjure(&dag);

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
        let blocks = blocks_for_conjure(&dag);
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
        let blocks = blocks_for_conjure(&dag);
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
        let blocks = blocks_for_conjure(&dag);
        let has_gemini = blocks.iter().any(|b| {
            matches!(b, Block::KeyVal(k, v)
            if k.contains("model") && v.contains("gemini"))
        });
        assert!(
            has_gemini,
            "model_tier renders generically (gemini, not just claude)"
        );
    }

    // ── DISPATCH ──────────────────────────────────────────────────────────────

    #[test]
    fn dispatch_request_builds_backend_goal_and_skill() {
        // A fixture node → a spawn request: vendor from model_tier, goal carrying
        // the role_description, skill_id passed through.
        let node = PredictedNode {
            id: "build-panel".into(),
            skill_id: "beautiful-gui-design".into(),
            role_description: "Build the provider-settings panel".into(),
            why: "The flow needs a real, accessible surface".into(),
            model_tier: "gemini".into(),
            ..Default::default()
        };
        let req = dispatch_request_for(&node);
        // The vendor is chosen by the tier (multi-vendor: gemini, not claude).
        assert_eq!(req.backend, Backend::Gemini);
        // The skill the agent loads is the node's skill.
        assert_eq!(req.skill_id, "beautiful-gui-design");
        // The goal contains the role_description AND the rationale.
        assert!(req.goal.contains("Build the provider-settings panel"));
        assert!(req
            .goal
            .contains("The flow needs a real, accessible surface"));
        // The node id is carried for the dispatched-note / alert.
        assert_eq!(req.node_id, "build-panel");
    }

    #[test]
    fn dispatch_request_goal_survives_empty_why() {
        let node = PredictedNode {
            id: "n".into(),
            skill_id: "research".into(),
            role_description: "Survey the codebase".into(),
            why: String::new(),
            model_tier: "opus".into(),
            ..Default::default()
        };
        let req = dispatch_request_for(&node);
        assert_eq!(req.backend, Backend::ClaudeCli, "opus → Claude Code");
        assert_eq!(
            req.goal, "Survey the codebase",
            "no why ⇒ goal is just the role"
        );
    }

    #[test]
    fn dispatch_all_excludes_hitl_gated_nodes() {
        // The fixture's release node is HITL-gated; dispatch-all must skip it and
        // count it as held back, while every un-gated node produces a request.
        let dag = fixture();
        let total: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
        let gated = gated_node_count(&dag);
        assert!(gated >= 1, "the fixture has at least one HITL-gated node");

        let targets = dispatch_targets(&dag);
        assert_eq!(
            targets.len(),
            total - gated,
            "dispatch-all skips the gated node(s)"
        );

        // None of the produced requests come from a gated node id.
        let gated_ids: Vec<String> = dag
            .waves
            .iter()
            .flat_map(|w| w.nodes.iter())
            .filter(|n| n.ask_user_before_proceeding)
            .map(|n| n.id.clone())
            .collect();
        for req in &targets {
            assert!(
                !gated_ids.contains(&req.node_id),
                "a HITL-gated node ({}) must never be auto-dispatched",
                req.node_id
            );
        }
    }

    #[test]
    fn dispatch_targets_span_multiple_vendors() {
        // The fixture spans Claude tiers (opus/sonnet/haiku) → ClaudeCli; a synthetic
        // gemini node proves the targets really route to different vendors.
        let mut dag = fixture();
        dag.waves[0].nodes[0].model_tier = "gemini".into();
        let backends: Vec<Backend> = dispatch_targets(&dag).iter().map(|r| r.backend).collect();
        assert!(
            backends.contains(&Backend::Gemini),
            "a gemini node routes to Gemini"
        );
        assert!(
            backends.contains(&Backend::ClaudeCli),
            "the claude-tier nodes route to Claude Code"
        );
        // Genuinely multi-vendor: at least two distinct backends in the dispatch set.
        let distinct = backends.iter().filter(|&&b| b == Backend::Gemini).count() >= 1
            && backends
                .iter()
                .filter(|&&b| b == Backend::ClaudeCli)
                .count()
                >= 1;
        assert!(
            distinct,
            "dispatch spans Gemini AND Claude Code — multi-vendor"
        );
    }

    // ── LIVE GENERATION (claude:cli) — pure-helper tests ────────────────────────

    #[test]
    fn augmented_path_contains_the_developer_tool_dirs() {
        // The Finder-launched-.app fix: the PATH we hand a subprocess must include
        // ~/.cargo/bin (for `cargo`) and ~/.local/bin (for `claude`) even when the
        // process inherited a bare PATH.
        let path = augmented_path();
        assert!(
            path.contains(".cargo/bin"),
            "PATH must include ~/.cargo/bin (cargo): {path}"
        );
        assert!(
            path.contains(".local/bin"),
            "PATH must include ~/.local/bin (claude): {path}"
        );
        // The system bins are present too, so basic tooling resolves.
        assert!(path.contains("/usr/bin"), "PATH must include /usr/bin");
        // It is a colon-joined, non-empty list.
        assert!(
            path.split(':').count() >= 4,
            "PATH should carry several dirs: {path}"
        );
    }

    #[test]
    fn dag_gen_prompt_is_non_empty_and_embeds_the_intent_and_schema() {
        let p = dag_gen_prompt("  Add a retry budget to the dispatcher  ");
        assert!(
            !p.trim().is_empty(),
            "the generation prompt must be non-empty"
        );
        // The operator intent is woven in (trimmed).
        assert!(
            p.contains("Add a retry budget to the dispatcher"),
            "prompt embeds the intent"
        );
        // It pins the serde schema keys so claude emits the right shape.
        assert!(p.contains("problem_classification"));
        assert!(p.contains("ask_user_before_proceeding"));
        assert!(p.contains("model_tier"));
        // It demands raw JSON (no fences).
        assert!(
            p.to_lowercase().contains("json only")
                || p.to_lowercase().contains("only a single json")
        );
    }

    #[test]
    fn parse_claude_output_reads_a_fenced_json_block() {
        // The common case: claude wraps the object in a ```json fence.
        let raw = "Here is the plan:\n\n```json\n{\n  \"title\": \"Ship it\",\n  \"waves\": [\n    { \"wave_number\": 1, \"parallelizable\": false, \"nodes\": [ { \"id\": \"n1\", \"skill_id\": \"api-architect\", \"model_tier\": \"sonnet\" } ] }\n  ]\n}\n```\n\nHope that helps!";
        let dag = parse_claude_dag_output(raw).expect("a fenced JSON block parses");
        assert_eq!(dag.title, "Ship it");
        assert_eq!(dag.waves.len(), 1);
        assert_eq!(dag.waves[0].nodes[0].skill_id, "api-architect");
        assert_eq!(dag.waves[0].nodes[0].model_tier, "sonnet");
    }

    #[test]
    fn parse_claude_output_reads_a_raw_object() {
        // A clean raw object (no fence, no prose) parses directly.
        let raw = r#"{ "title": "Raw plan", "problem_classification": "well-structured", "waves": [ { "wave_number": 1, "parallelizable": true, "nodes": [ { "id": "x", "skill_id": "research", "model_tier": "gemini" } ] } ] }"#;
        let dag = parse_claude_dag_output(raw).expect("a raw JSON object parses");
        assert_eq!(dag.title, "Raw plan");
        assert_eq!(dag.waves[0].nodes[0].model_tier, "gemini");
    }

    #[test]
    fn parse_claude_output_reads_an_object_with_surrounding_prose() {
        // Prose on both sides of an unfenced object — take first '{' .. last '}'.
        let raw = "Sure! {\"title\":\"Inline\",\"waves\":[{\"wave_number\":1,\"parallelizable\":false,\"nodes\":[{\"id\":\"a\",\"skill_id\":\"s\",\"model_tier\":\"opus\"}]}]} Done.";
        let dag = parse_claude_dag_output(raw).expect("an embedded object parses");
        assert_eq!(dag.title, "Inline");
        assert_eq!(dag.waves[0].nodes[0].model_tier, "opus");
    }

    #[test]
    fn parse_claude_output_errors_on_garbage() {
        // Non-JSON garbage must error (so the caller falls back to the fixture).
        assert!(parse_claude_dag_output("I'm sorry, I can't help with that.").is_err());
        assert!(parse_claude_dag_output("").is_err());
        // A JSON object with no waves is also a failure (not a useful DAG).
        assert!(parse_claude_dag_output(r#"{ "title": "empty" }"#).is_err());
    }

    #[test]
    fn generate_dag_via_cli_falls_back_to_the_fixture_when_claude_is_unavailable() {
        // Point HOME at a temp dir with no claude binary so the spawn fails; the
        // function must still return a renderable, prompt-titled DAG (never error).
        // (~/coding/tmp is the durable scratch root per house rules — never /tmp.)
        let scratch = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join("coding/tmp/pd-console-conjure-test-home");
        let _ = std::fs::create_dir_all(&scratch);
        let prev_home = std::env::var("HOME").ok();
        // SAFETY: single-threaded test; we restore HOME immediately after.
        unsafe {
            std::env::set_var("HOME", &scratch);
        }
        // Also blank PATH so the bare `claude` name can't resolve to a real install.
        let prev_path = std::env::var("PATH").ok();
        unsafe {
            std::env::set_var("PATH", "");
        }

        let dag = generate_dag_via_cli("Add a retry budget to the dispatcher")
            .expect("generation must never error — it falls back to the fixture");
        // The fallback is the fixture re-titled with the operator intent.
        assert_eq!(dag.title, "Add a retry budget to the dispatcher");
        assert!(!dag.waves.is_empty(), "the fallback DAG is renderable");

        // Restore the environment.
        unsafe {
            match prev_home {
                Some(h) => std::env::set_var("HOME", h),
                None => std::env::remove_var("HOME"),
            }
            match prev_path {
                Some(p) => std::env::set_var("PATH", p),
                None => std::env::remove_var("PATH"),
            }
        }
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
