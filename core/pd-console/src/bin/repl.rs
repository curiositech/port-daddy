#![recursion_limit = "1024"]
//! pd-console — the operator console. Engine milestone: a headless conversation
//! multiplexer, on the PD bus, backend-agnostic. The GPUI shell renders this next.
//!
//!   :new <backend> <prompt>   create a plain top-level agent
//!   :harness <backend> <prompt>
//!                             create a Squid-harnessed tube-bound agent
//!   :agents                   list hosted agents
//!   :switch <n>               make agent n active
//!   :dispatch                 show the dispatch queue (sorties awaiting review)
//!   :lane                     show the watched agent's live work chat
//!   :lane-message <text>      send an operator turn to the watched agent
//!                             supports @file/@photo/@skill/@tool markers
//!   :harbor                   Agent Node roster + detail (binder ch18 C3)
//!   :harbor select <n>        select roster row n (retargets the detail)
//!   :harbor control <verb> [arg]
//!                             issue a compliance-gated control (steer/pause/
//!                             interrupt/checkpoint/successor/retire)
//!   <text>                    send a turn to the active agent (over tube)
//!   :quit
//!
//! This is the answer to "I want to talk to you from inside pd-console, not
//! iterm2" — at the engine layer, runnable today.

#[path = "../activity_pane.rs"]  mod activity_pane;
#[path = "../agent.rs"]          mod agent;
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
#[path = "../chat.rs"]           mod chat;
#[path = "../daemon_pane.rs"]    mod daemon_pane; // daemon picker surface (tests)
#[path = "../claims_pane.rs"]    mod claims_pane;
#[allow(dead_code)]
#[path = "../conjure.rs"]
mod conjure;
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
// maritime's gpui FlagBadge is now #[cfg(feature = "gpui")]-gated, so the pure
// Flag/flag_for_state compile here and the fleet pane renders in the REPL too.
#[path = "../fleet_pane.rs"]     mod fleet_pane;
// Session-galaxy engine (parsing + hit-testing + selection math) — gpui-free by
// design; its #[cfg(test)] suite runs HERE, in the rust-console CI gate. The
// geometry helpers are canvas-only at runtime, hence the dead_code allow.
#[path = "../galaxy_pane.rs"]
mod galaxy_pane;
#[path = "../grid.rs"]           mod grid; // launcher-grid data + 1:1 invariant tests
#[path = "../harbor_pane.rs"]    mod harbor_pane; // Agent Node roster+detail (ch18 C3)
#[path = "../maritime.rs"]       mod maritime;
#[path = "../health_pane.rs"]    mod health_pane;
#[path = "../lane_pane.rs"]      mod lane_pane;
#[allow(dead_code)]
#[path = "../mux.rs"]            mod mux;
#[path = "../pane.rs"]           mod pane;
#[path = "../planner_pane.rs"]   mod planner_pane;
#[allow(dead_code)] // parse/serve are exercised by tests; the server runs only in the gpui bin
#[path = "../script.rs"]
mod script; // control-socket scripting (parse + serve tests)
#[path = "../sessions_pane.rs"]  mod sessions_pane;
#[path = "../syntax.rs"]
mod syntax;
#[path = "../term.rs"]           mod term;
#[path = "../theme.rs"]          mod theme;
#[path = "../util.rs"]           mod util;
// Offscreen Block→PNG raster (agent-safe, no display/TCC/gpui). Included here so the
// headless capture + its PNG-encoder tests run on the cheap non-gpui gate too.
#[path = "../headless_capture.rs"]
mod headless_capture;

use agent::{AgentManager, Backend};
use anyhow::Result;
use dispatch_pane::DispatchQueuePane;
use fleet_pane::FleetPane;
use galaxy_pane::GalaxyPane;
use harbor_pane::HarborPane;
use lane_pane::LanePane;
use pane::{OperatorTurn, PaneRegistry, Subscription, SurfaceAction};
use std::io::{self, Write};
use std::time::Duration;
use term::{ColorMode, Sem, TermStyle};

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
            ":harness <backend> <prompt> · :new <backend> <prompt> · :agents · :switch <n> · :lane · :lane-message <text> · :harbor · :quit",
            Sem::Muted
        )
    );
    println!();
}

async fn drain_active_subscription(reg: &mut PaneRegistry, mgr: &AgentManager, window: Duration) {
    let Some(Subscription::Agent { agent_id }) = reg.active().and_then(|p| p.subscription()) else {
        return;
    };

    let active = reg.active;
    let mut rx = mgr.daemon().subscribe_agent(&agent_id);
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
    let mut mgr = match AgentManager::new() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("  {} daemon discovery failed: {e}", "✗");
            return Ok(());
        }
    };
    banner(&style, mgr.daemon().base());

    // Build the pane registry — register all panes once at startup.
    let mut reg = PaneRegistry::default();
    reg.register(Box::new(DispatchQueuePane::new()));
    reg.register(Box::new(FleetPane::new()));
    reg.register(Box::new(LanePane::new()));
    reg.register(Box::new(HarborPane::new()));
    reg.register(Box::new(GalaxyPane::new()));

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
        } else if line == ":dispatch" {
            // Refresh the dispatch pane then render it.
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "dispatch")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
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
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if line == ":interrupt" {
                match reg
                    .mutate_active(
                        mgr.daemon(),
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
                        mgr.daemon(),
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
            drain_active_subscription(&mut reg, &mgr, Duration::from_millis(1_200)).await;
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
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(rest) = line.strip_prefix(":harbor select ") {
                match rest.trim().parse::<usize>() {
                    Ok(index) => {
                        match reg
                            .mutate_active(mgr.daemon(), SurfaceAction::SelectRow { index })
                            .await
                        {
                            Ok(()) => {
                                // Repopulate the detail for the new selection.
                                if let Err(e) = reg.refresh_active(mgr.daemon()).await {
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
                        mgr.daemon(),
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
        } else if line == ":sextant" {
            // Sextant — the daemon's embedding map of recent sessions,
            // rendered headlessly (session count + cluster chips/terms).
            reg.active = reg
                .panes
                .iter()
                .position(|p| p.id() == "sextant")
                .unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
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
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":agents" {
            if mgr.agents.is_empty() {
                println!(
                    "  {}",
                    style.paint("(no agents — :harness <backend> <prompt>)", Sem::Muted)
                );
            }
            for (n, a) in &mgr.agents {
                let mark = if mgr.active == Some(*n) {
                    style.paint("●", Sem::Engaged)
                } else {
                    " ".into()
                };
                println!(
                    "  {mark} {} {:<11} {}  {}",
                    style.paint(&n.to_string(), Sem::Accent),
                    a.backend.as_str(),
                    a.id,
                    style.paint(&format!("[{}]", a.channel), Sem::Muted),
                );
            }
        } else if let Some(rest) = line.strip_prefix(":switch ") {
            match rest.trim().parse::<u64>() {
                Ok(n) if mgr.agents.contains_key(&n) => {
                    mgr.active = Some(n);
                    ok(&style, &format!("active: agent {n}"));
                }
                _ => err(&style, "no such agent"),
            }
        } else if let Some(rest) = line.strip_prefix(":new ") {
            let mut it = rest.splitn(2, ' ');
            let bk = it.next().unwrap_or("");
            let prompt = it.next().unwrap_or("").trim();
            match Backend::parse(bk) {
                None => err(
                    &style,
                    &format!(
                        "unknown backend '{bk}'. one of: {}",
                        Backend::ALL
                            .iter()
                            .map(|b| b.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    ),
                ),
                Some(backend) => match mgr.create_agent(backend, prompt).await {
                    Ok((n, out)) => {
                        // Surface the real launch result — including the inline
                        // output one-shot backends return in the spawn response,
                        // and any guard block (budget / worktree / wallet).
                        if let Some(reason) = out
                            .error
                            .filter(|_| out.status == "failed" || out.status == "blocked")
                        {
                            err(&style, &format!("agent {n} {} — {reason}", out.status));
                        } else {
                            ok(
                                &style,
                                &format!(
                                    "created agent {n} on {} ({})",
                                    backend.as_str(),
                                    out.status
                                ),
                            );
                            if let Some(text) = out.output.filter(|t| !t.trim().is_empty()) {
                                println!(
                                    "  {} {}",
                                    style.paint(&format!("{}:", backend.as_str()), Sem::Engaged),
                                    text,
                                );
                            }
                        }
                    }
                    Err(e) => err(&style, &format!("spawn failed: {e}")),
                },
            }
        } else if let Some(rest) = line.strip_prefix(":harness ") {
            let mut it = rest.splitn(2, ' ');
            let bk = it.next().unwrap_or("");
            let prompt = it.next().unwrap_or("").trim();
            match Backend::parse(bk) {
                None => err(
                    &style,
                    &format!(
                        "unknown backend '{bk}'. one of: {}",
                        Backend::ALL
                            .iter()
                            .map(|b| b.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    ),
                ),
                Some(backend) => match mgr.create_harnessed_agent(backend, prompt).await {
                    Ok((n, out)) => {
                        if let Some(reason) = out
                            .error
                            .filter(|_| out.status == "failed" || out.status == "blocked")
                        {
                            err(
                                &style,
                                &format!("harnessed agent {n} {} — {reason}", out.status),
                            );
                        } else {
                            ok(
                                &style,
                                &format!(
                                    "harnessed agent {n} on {} ({})",
                                    backend.as_str(),
                                    out.status
                                ),
                            );
                            println!(
                                "  {}",
                                style.paint(
                                    "squid hooks requested · use :agents then talk normally",
                                    Sem::Muted
                                )
                            );
                            if let Some(text) = out.output.filter(|t| !t.trim().is_empty()) {
                                println!(
                                    "  {} {}",
                                    style.paint(&format!("{}:", backend.as_str()), Sem::Engaged),
                                    text,
                                );
                            }
                        }
                    }
                    Err(e) => err(&style, &format!("harness spawn failed: {e}")),
                },
            }
        } else {
            // a turn to the active agent
            if let Err(e) = mgr.send(&line).await {
                err(&style, &e.to_string());
                continue;
            }
            // Drain replies for a short window — braille spinner while waiting.
            // No cursor-hide escapes, so an interrupt can never ghost the cursor.
            const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
            let spin = style.mode != ColorMode::Plain;
            for tick in 0..20 {
                if spin {
                    print!(
                        "\r  {} {}",
                        style.paint(FRAMES[tick % FRAMES.len()], Sem::Accent),
                        style.paint("waiting for reply…", Sem::Muted),
                    );
                    io::stdout().flush().ok();
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
                match mgr.poll_active().await {
                    Ok(msgs) => {
                        let msgs: Vec<agent::TubeMsg> = msgs;
                        if !msgs.is_empty() && spin {
                            print!("\r{}\r", " ".repeat(30)); // clear spinner line
                        }
                        for m in &msgs {
                            println!(
                                "  {} {}",
                                style.paint(&format!("{}:", m.sender), Sem::Engaged),
                                m.text
                            );
                        }
                        if !msgs.is_empty() {
                            break;
                        }
                    }
                    Err(e) => {
                        if spin {
                            print!("\r{}\r", " ".repeat(30));
                        }
                        err(&style, &format!("poll: {e}"));
                        break;
                    }
                }
            }
            if spin {
                print!("\r{}\r", " ".repeat(30));
                io::stdout().flush().ok();
            }
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
