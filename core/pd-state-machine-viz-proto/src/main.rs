//! pd-state-machine-viz-proto CLI — headless-self-capturing Vello/wgpu
//! surface rendering the dispatch review state machine
//! (`lib/dispatch/state-machine.ts`).
//!
//! P0: pure model + layout (`pd_state_machine_viz_proto::model`/`::layout`)
//!     — no GPU, unit-tested in those modules directly.
//! P1: Vello scene construction (`::scene`) — ported from pd-timeline-proto.
//! P2: `::render::render_png` — a single-frame headless render to PNG. No
//!     window, no winit, no Screen-Recording (TCC) permission.
//!
//! Usage:
//!   cargo run --release -- --png out.png
//!   PD_SMV_RENDER_PNG=out.png cargo run --release
//!
//! Without either, prints usage and exits — there is deliberately no
//! windowed mode (see the crate doc comment on why: this surface exists to
//! prove agent-self-capturable headless rendering, not an interactive window).

use anyhow::{Context, Result};

use pd_state_machine_viz_proto::model::StateGraph;
use pd_state_machine_viz_proto::render::{render_png, RenderSpec};

/// The baked runtime-state.json fixture (see
/// `pd_state_machine_viz_proto::model::StateGraph::from_runtime` doc comment
/// for the schema and the honest gap: no editor flow emits this file today —
/// it's a fixture, not live daemon data).
const FIXTURE_JSON: &str = include_str!("../fixtures/runtime-state.sample.json");

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let Some(out_path) = png_out_path() else {
        eprintln!(
            "pd-state-machine-viz-proto: no output requested.\n\
             Usage: cargo run --release -- --png <out.png>\n\
             Or:    PD_SMV_RENDER_PNG=<out.png> cargo run --release\n\
             (No windowed mode — this proto is a headless self-capture surface only.)"
        );
        return Ok(());
    };

    let graph = load_graph()?;
    let playhead = env_f64("PD_SMV_PLAYHEAD", 1.0).clamp(0.0, 1.0);
    let spec = RenderSpec {
        width: env_u32("PD_SMV_RENDER_W", 2400),
        height: env_u32("PD_SMV_RENDER_H", 1000),
        scale: env_f64("PD_SMV_RENDER_SCALE", 2.0),
    };

    render_png(&graph, playhead, spec, &out_path)
}

/// `PD_SMV_RUNTIME_JSON` lets a caller point at a real runtime-state.json
/// once something emits one; falling back to the baked fixture mirrors
/// pd-timeline-proto's live-daemon-then-fixture fallback (`Timeline::load`),
/// adapted to "real file, then fixture" since there is no live route yet.
fn load_graph() -> Result<StateGraph> {
    if let Ok(path) = std::env::var("PD_SMV_RUNTIME_JSON") {
        let json = std::fs::read_to_string(&path)
            .with_context(|| format!("reading PD_SMV_RUNTIME_JSON={path}"))?;
        return StateGraph::from_runtime(&json)
            .with_context(|| format!("parsing runtime-state.json at {path}"));
    }
    StateGraph::from_runtime(FIXTURE_JSON).context("parsing the baked fixture (should never fail)")
}

/// `--png <path>` (either `--png=path` or two args) takes priority over
/// `PD_SMV_RENDER_PNG`.
fn png_out_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    for (i, a) in args.iter().enumerate() {
        if let Some(v) = a.strip_prefix("--png=") {
            return Some(v.to_string());
        }
        if a == "--png" {
            return args.get(i + 1).cloned();
        }
    }
    std::env::var("PD_SMV_RENDER_PNG").ok()
}

fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
