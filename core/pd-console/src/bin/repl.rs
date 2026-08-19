#![recursion_limit = "1024"]
//! pd-console — headless emergency face for daemon truth.
//!
//!   :work <goal>              capture one provider-neutral WorkIntent
//!   :gates                    show pending human review gates
//!   :lane                     show the watched agent's live work chat
//!   :lane-message <text>      send an operator turn to the watched agent
//!                             supports @file/@photo/@skill/@tool markers
//!   :harbor                   Agent Node roster + detail (binder ch18 C3)
//!   :harbor select <n>        select roster row n (retargets the detail)
//!   :harbor control <verb> [arg]
//!                             issue a compliance-gated control (steer/pause/
//!                             interrupt/checkpoint/successor/retire)
//!   :edit <path>              open the Harbor Editor on a file and drain its
//!                             live edit-sync + coordination channels (P3)
//!   :quit

#[path = "../active_agents_pane.rs"]
mod active_agents_pane;
#[path = "../activity_pane.rs"]
mod activity_pane;
#[path = "../adrs_pane.rs"]
mod adrs_pane;
#[path = "../agent.rs"]
mod agent;
// Audio is GUI-only at runtime, but its synth/mute logic is pure and unit-tested
// here (the headless repl is the test gate; the GPUI bin can't be `--test`-built).
#[allow(dead_code)]
#[path = "../audio.rs"]
mod audio;
#[path = "../berths.rs"]
mod berths; // named daemon picker data (ADR-0084)
#[allow(dead_code)]
#[path = "../buffer.rs"]
mod buffer;
// The operator-chat MODEL is gpui-free (ChatMsg/ChatLog/ChatState) so the three
// render states are unit-tested here, in the headless test gate.
#[allow(dead_code)]
#[path = "../chat.rs"]
mod chat;
#[path = "../claims_pane.rs"]
mod claims_pane;
#[path = "../daemon_pane.rs"]
mod daemon_pane; // daemon picker surface (tests)
                 // cloud_fleet_pane is GPUI-free (no maritime/gpui), so it compiles in this bin.
#[path = "../cloud_fleet_pane.rs"]
mod cloud_fleet_pane;
#[path = "../cockpit_pane.rs"]
mod cockpit_pane;
#[path = "../dispatch_pane.rs"]
mod dispatch_pane;
#[allow(dead_code)]
#[path = "../editor_claims.rs"]
mod editor_claims;
#[allow(dead_code)]
#[path = "../editor_commit_gate.rs"]
mod editor_commit_gate;
#[allow(dead_code)]
#[path = "../editor_pane.rs"]
mod editor_pane;
#[allow(dead_code)]
#[path = "../editor_sync.rs"]
mod editor_sync;
#[allow(dead_code)]
#[path = "../editor_wedge.rs"]
mod editor_wedge;
#[allow(dead_code)]
#[path = "../work_plan.rs"]
mod work_plan;
// maritime's gpui FlagBadge is now #[cfg(feature = "gpui")]-gated, so the pure
// Flag/flag_for_state compile here and the fleet pane renders in the REPL too.
#[path = "../fleet_pane.rs"]
mod fleet_pane;
// Session-galaxy engine (parsing + hit-testing + selection math) — gpui-free by
// design; its #[cfg(test)] suite runs HERE, in the rust-console CI gate. The
// geometry helpers are canvas-only at runtime, hence the dead_code allow.
#[allow(dead_code)]
#[path = "../galaxy_pane.rs"]
mod galaxy_pane;
#[path = "../grid.rs"]
mod grid; // launcher-grid data + 1:1 invariant tests
#[path = "../harbor_pane.rs"]
mod harbor_pane; // Agent Node roster+detail (ch18 C3)
#[path = "../health_pane.rs"]
mod health_pane;
#[path = "../inbox_pane.rs"]
mod inbox_pane;
#[path = "../lane_pane.rs"]
mod lane_pane;
#[path = "../lineage_pane.rs"]
mod lineage_pane;
#[path = "../maritime.rs"]
mod maritime;
#[allow(dead_code)]
#[path = "../mux.rs"]
mod mux;
#[path = "../notes_pane.rs"]
mod notes_pane;
#[path = "../pane.rs"]
mod pane;
#[path = "../parley_pane.rs"]
mod parley_pane;
#[path = "../peek_pane.rs"]
mod peek_pane;
#[path = "../planner_pane.rs"]
mod planner_pane;
#[path = "../prs_pane.rs"]
mod prs_pane;
#[path = "../roadmap_pane.rs"]
mod roadmap_pane;
#[allow(dead_code)] // parse/serve are exercised by tests; the server runs only in the gpui bin
#[path = "../script.rs"]
mod script; // control-socket scripting (parse + serve tests)
#[path = "../sessions_pane.rs"]
mod sessions_pane;
#[path = "../substrate_pane.rs"]
mod substrate_pane;
#[path = "../suggest_pane.rs"]
mod suggest_pane;
#[path = "../syntax.rs"]
mod syntax;
#[path = "../term.rs"]
mod term;
#[path = "../theme.rs"]
mod theme;
#[path = "../util.rs"]
mod util;
// Offscreen Block→PNG raster (agent-safe, no display/TCC/gpui). Included here so the
// headless capture + its PNG-encoder tests run on the cheap non-gpui gate too.
#[path = "../headless_capture.rs"]
mod headless_capture;

use active_agents_pane::ActiveAgentsPane;
use agent::DaemonClient;
use anyhow::Result;
use dispatch_pane::DispatchQueuePane;
use fleet_pane::FleetPane;
use galaxy_pane::GalaxyPane;
use harbor_pane::HarborPane;
use lane_pane::LanePane;
use lineage_pane::LineagePane;
use pane::{OperatorTurn, Pane, PaneRegistry, Subscription, SurfaceAction};
use parley_pane::ParleyPane;
use planner_pane::PlannerPane;
use std::io::{self, Write};
use std::time::Duration;
use substrate_pane::SubstratePane;
use term::{Sem, TermStyle};

/// Left-rail banner (Clack idiom) in the locked theme. Plain mode degrades
/// to the same layout without escapes — no width math, no broken boxes.
fn banner(style: &TermStyle, daemon_url: &str) {
    let rail = |s: &str| style.paint(s, Sem::Resting);
    println!(
        "{}  {}  {}",
        rail("┌"),
        style.bold(&style.paint("pd-console", Sem::Accent)),
        style.paint("conversation multiplexer · on the PD bus", Sem::Muted),
    );
    println!(
        "{}  {} {}",
        rail("│"),
        style.paint("daemon", Sem::Muted),
        style.paint(daemon_url, Sem::Ink),
    );
    println!(
        "{}  {}",
        rail("└"),
        style.paint(
            ":work <goal> · :planner · :roster · :lane · :lane-message <text> · :harbor · :edit <path> · :quit",
            Sem::Muted
        )
    );
    println!();
}

async fn drain_active_subscription(
    reg: &mut PaneRegistry,
    daemon: &DaemonClient,
    window: Duration,
) {
    match reg.active().and_then(|p| p.subscription()) {
        Some(Subscription::Agent { agent_id }) => {
            let active = reg.active;
            let mut rx = daemon.subscribe_agent(&agent_id);
            let deadline = tokio::time::Instant::now() + window;
            loop {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match tokio::time::timeout(remaining, rx.recv()).await {
                    Ok(Some(env)) => {
                        if let Some(p) = reg.panes.get_mut(active) {
                            p.on_stream(&env);
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
        }
        // The Harbor Editor lane (P3 wire stage 1) — the headless twin of the gpui
        // producer's editor drain. Follow the file's TWO isolated channels: the
        // edit-sync lane (durable Loro ops + lossy presence → `on_edit_frame`) and the
        // coordination lane (region claims → `on_coord_frame`). One `subscribe_channel`
        // per channel is the isolation; a single `window` deadline bounds the drain, and
        // either channel closing ends it — mirroring the Agent arm's `None => break`.
        Some(Subscription::Editor { channel, coord_channel }) => {
            let active = reg.active;
            let mut edit_rx = daemon.subscribe_channel(&channel);
            let mut coord_rx = daemon.subscribe_channel(&coord_channel);
            let sleep = tokio::time::sleep(window);
            tokio::pin!(sleep);
            loop {
                tokio::select! {
                    _ = &mut sleep => break,
                    m = edit_rx.recv() => match m {
                        Some(msg) => {
                            if let Some(p) = reg.panes.get_mut(active) {
                                p.on_edit_frame(&msg.text);
                            }
                        }
                        None => break,
                    },
                    m = coord_rx.recv() => match m {
                        Some(msg) => {
                            if let Some(p) = reg.panes.get_mut(active) {
                                p.on_coord_frame(&msg.text);
                            }
                        }
                        None => break,
                    },
                }
            }
        }
        None => {}
    }
}

fn retired_repl_command_guidance(line: &str) -> Option<&'static str> {
    if line.trim() == ":galaxy" {
        Some("Galaxy was renamed to Sextant; use :sextant.")
    } else {
        None
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let style = TermStyle::detect(&theme::DARK);
    let daemon = match DaemonClient::discover() {
        Ok(client) => client,
        Err(e) => {
            eprintln!("  {} daemon discovery failed: {e}", "✗");
            return Ok(());
        }
    };

    // `--capture-planner <path.png>`: refresh the Planner pane against the live
    // daemon and rasterize its Block view to a PNG, then exit. The purpose is
    // CI-grade visual evidence on Linux — the Block rasterizer is one of the
    // console's real renderers, so this PNG is the pane as the console draws
    // it, not a mock. Same design as the gpui bin's `--headless-capture`.
    let argv: Vec<String> = std::env::args().collect();
    if let Some(pos) = argv.iter().position(|a| a == "--capture-planner") {
        let path = argv
            .get(pos + 1)
            .ok_or_else(|| anyhow::anyhow!("--capture-planner requires a <path.png>"))?;
        let mut pane = PlannerPane::new();
        pane.refresh(&daemon).await?;
        let png = headless_capture::render_blocks(&pane.view(), &theme::DARK, 1180).to_png();
        std::fs::write(path, &png)?;
        println!("planner capture written: {path}");
        return Ok(());
    }

    banner(&style, daemon.base());

    // Build the pane registry — register all panes once at startup.
    let mut reg = PaneRegistry::default();
    reg.register(Box::new(DispatchQueuePane::new()));
    reg.register(Box::new(FleetPane::new()));
    reg.register(Box::new(LanePane::new()));
    reg.register(Box::new(LineagePane::new()));
    reg.register(Box::new(SubstratePane::new()));
    reg.register(Box::new(ParleyPane::new()));
    reg.register(Box::new(ActiveAgentsPane::new()));
    reg.register(Box::new(HarborPane::new()));
    reg.register(Box::new(GalaxyPane::new()));
    reg.register(Box::new(PlannerPane::new()));

    let ok = |s: &TermStyle, msg: &str| println!("  {} {msg}", s.paint("✓", Sem::Landed));
    let err = |s: &TermStyle, msg: &str| println!("  {} {msg}", s.paint("✗", Sem::Gated));

    let stdin = io::stdin();
    loop {
        print!("{} ", style.paint("»", Sem::Accent));
        io::stdout().flush().ok();
        let mut line = String::new();
        if stdin.read_line(&mut line)? == 0 {
            break; // EOF
        }
        let line = line.trim_end().to_string();
        if line.is_empty() {
            continue;
        }

        if let Some(message) = retired_repl_command_guidance(&line) {
            err(&style, message);
        } else if line == ":quit" || line == ":q" {
            break;
        } else if line == ":gates" {
            // Refresh the legacy dispatch projection as a human-gate queue.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "dispatch")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":dispatch" {
            err(
                &style,
                ":dispatch is retired; use :gates for review truth or :work <goal> to start work",
            );
        } else if let Some(path) = line
            .strip_prefix(":edit ")
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            // The Harbor Editor surface (P3 wire stage 1). Bind a real EditorPane to the
            // file, load its Loro buffer, then drain its live edit-sync + coordination
            // channels exactly as `:lane` drains an agent stream — the headless proof
            // that the editor lane is wired end to end (the same `drain_active_subscription`
            // path the gpui producer runs). Reuse the single "editor" slot so repeated
            // `:edit`s rebind rather than pile up panes. Key the local Loro replica to
            // the operator's LIVE `pd whoami` identity (same as the GPUI producer's
            // OpenEditor), so authorship + claims agree across the two faces — never the
            // DEFAULT_IDENTITY fallback (Copilot #729).
            let pane = editor_pane::EditorPane::new_with_identity(
                path.to_string(),
                None,
                editor_pane::resolve_operator_identity(),
            );
            match reg.panes.iter().position(|p| p.id() == "editor") {
                Some(pos) => {
                    reg.panes[pos] = Box::new(pane);
                    reg.active = pos;
                }
                None => {
                    reg.register(Box::new(pane));
                    reg.active = reg.panes.len() - 1;
                }
            }
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            drain_active_subscription(&mut reg, &daemon, Duration::from_millis(1_200)).await;
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":lane"
            || line == ":interrupt"
            || line.starts_with(":lane-message ")
            || line.starts_with(":steer ")
        {
            // The live Lane surface (headless rendering of one tick). `:lane`
            // refreshes + renders; `:interrupt` additionally grabs the wheel —
            // POST /agents/:id/interrupt on the watched agent (the closed loop).
            // `:lane-message` sends a normal operator turn up agent:<id>.
            reg.active = reg.panes.iter().position(|p| p.id() == "lane").unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if line == ":interrupt" {
                match reg
                    .mutate_active(
                        &daemon,
                        SurfaceAction::Interrupt {
                            reason: Some("operator stop".into()),
                        },
                    )
                    .await
                {
                    Ok(()) => ok(
                        &style,
                        "interrupt sent — watch the stream for control.interrupt",
                    ),
                    Err(e) => err(&style, &format!("interrupt failed: {e}")),
                }
            } else if let Some(text) = line
                .strip_prefix(":lane-message ")
                .or_else(|| line.strip_prefix(":steer "))
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                match reg
                    .mutate_active(
                        &daemon,
                        SurfaceAction::OperatorTurn {
                            turn: OperatorTurn::parse(text),
                        },
                    )
                    .await
                {
                    Ok(()) => ok(
                        &style,
                        "message sent — watch the lane for the echoed operator turn",
                    ),
                    Err(e) => err(&style, &format!("message failed: {e}")),
                }
            }
            drain_active_subscription(&mut reg, &daemon, Duration::from_millis(1_200)).await;
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":harbor"
            || line.starts_with(":harbor select ")
            || line.starts_with(":harbor control ")
        {
            // The Agent Node roster + detail surface (binder ch18 C3). One
            // headless tick: refresh, optionally select a row / issue a
            // compliance-gated control, then render. The GPUI face makes rows
            // and controls clickable; this face proves the same pane headless.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "harbor")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(rest) = line.strip_prefix(":harbor select ") {
                match rest.trim().parse::<usize>() {
                    Ok(index) => {
                        match reg
                            .mutate_active(&daemon, SurfaceAction::SelectRow { index })
                            .await
                        {
                            Ok(()) => {
                                // Repopulate the detail for the new selection.
                                if let Err(e) = reg.refresh_active(&daemon).await {
                                    err(&style, &format!("refresh failed: {e}"));
                                }
                            }
                            Err(e) => err(&style, &format!("select failed: {e}")),
                        }
                    }
                    Err(_) => err(&style, "usage: :harbor select <row-index>"),
                }
            } else if let Some(rest) = line.strip_prefix(":harbor control ") {
                let mut parts = rest.trim().splitn(2, ' ');
                let verb = parts.next().unwrap_or("").to_string();
                let argument = parts
                    .next()
                    .map(str::trim)
                    .filter(|a| !a.is_empty())
                    .map(String::from);
                match reg
                    .mutate_active(
                        &daemon,
                        SurfaceAction::Control {
                            verb: verb.clone(),
                            argument,
                        },
                    )
                    .await
                {
                    Ok(()) => ok(
                        &style,
                        &format!("{verb} queued — watch the control history"),
                    ),
                    Err(e) => err(&style, &format!("{verb} refused: {e}")),
                }
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":lineage" {
            // RCP-14 discourse argument graph for PD_LINEAGE_CHANNEL (default
            // "discourse"). Refresh + render one tick of the lineage surface.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "lineage")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":substrate" {
            // RCP-7a/12 pheromone substrate — coverage + active signals (raw →
            // effective). Refresh + render one tick of the substrate surface.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "substrate")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":parley" {
            // RCP-2a convene decision over the channel's unresolved contradictions.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "parley")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":sextant" {
            // Sextant — the daemon's embedding map of recent sessions,
            // rendered headlessly (session count + cluster chips/terms).
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "sextant")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":roster" || line == ":live-agents" {
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "active-agents")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":planner" || line == ":gantt" || line == ":roadmap" {
            // The roadmap's critical-path Gantt — the same PlannerPane the GPUI
            // window leads with, rendered headlessly so Linux CI and operators
            // without a window can read the schedule (and capture evidence).
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "planner")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":fleet" {
            // Declarative ships from pd-fleet.yml with live lifecycle (GET /fleet):
            // sailing / cooldown / dry-dock / paused / armed, each an ICS flag.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "fleet")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(&daemon).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":agents" {
            err(
                &style,
                ":agents was a local hosted-agent list; use :roster for daemon truth",
            );
        } else if let Some(rest) = line.strip_prefix(":switch ") {
            let _ = rest;
            err(
                &style,
                ":switch was local-only state; select an AgentNode in Harbor instead",
            );
        } else if let Some(rest) = line.strip_prefix(":new ") {
            let _ = rest;
            err(
                &style,
                ":new is retired; use :work <goal> so the daemon owns planning and Body selection",
            );
        } else if let Some(rest) = line.strip_prefix(":harness ") {
            let _ = rest;
            err(
                &style,
                ":harness is retired; Squid attachment belongs to the daemon WorkPlan path",
            );
        } else if let Some(goal) = line.strip_prefix(":work ") {
            match daemon.capture_work_intent(goal).await {
                Ok(receipt) => {
                    let duplicate = if receipt.duplicate {
                        " · idempotent replay"
                    } else {
                        ""
                    };
                    ok(
                        &style,
                        &format!(
                            "WorkIntent {} · plan {} · trace {}{}",
                            receipt.snapshot.intent_id(),
                            receipt.snapshot.plan_state(),
                            receipt.correlation_id,
                            duplicate
                        ),
                    );
                    println!("  {}", style.paint(&receipt.next_action, Sem::Muted));
                }
                Err(error) => err(
                    &style,
                    &format!("WorkIntent capture failed: {error} · no AgentRun started"),
                ),
            }
        } else {
            err(
                &style,
                "unknown command; use :work <goal>, :planner, :roster, :lane, :harbor, or :quit",
            );
        }
    }
    println!("{}", style.paint("out.", Sem::Muted));
    Ok(())
}

#[cfg(test)]
mod repl_migration_tests {
    use super::*;

    #[test]
    fn retired_galaxy_command_points_to_sextant() {
        assert_eq!(
            retired_repl_command_guidance(":galaxy"),
            Some("Galaxy was renamed to Sextant; use :sextant.")
        );
        assert_eq!(
            retired_repl_command_guidance(" :galaxy "),
            Some("Galaxy was renamed to Sextant; use :sextant.")
        );
        assert_eq!(retired_repl_command_guidance(":sextant"), None);
        assert_eq!(retired_repl_command_guidance("galaxy"), None);
    }
}
