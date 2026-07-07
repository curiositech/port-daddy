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
//!   :edit <path>              open the Harbor Editor on a file and drain its
//!                             live edit-sync + coordination channels (P3)
//!   <text>                    send a turn to the active agent (over tube)
//!   :quit
//!
//! This is the answer to "I want to talk to you from inside pd-console, not
//! iterm2" — at the engine layer, runnable today.

#[path = "../activity_pane.rs"]  mod activity_pane;
#[path = "../active_agents_pane.rs"] mod active_agents_pane;
#[path = "../adrs_pane.rs"]      mod adrs_pane;
#[path = "../agent.rs"]          mod agent;
// Audio is GUI-only at runtime, but its synth/mute logic is pure and unit-tested
// here (the headless repl is the test gate; the GPUI bin can't be `--test`-built).
#[allow(dead_code)]
#[path = "../audio.rs"]          mod audio;
#[path = "../berths.rs"]         mod berths; // named daemon picker data (ADR-0084)
#[allow(dead_code)]
#[path = "../buffer.rs"]         mod buffer;
// The operator-chat MODEL is gpui-free (ChatMsg/ChatLog/ChatState) so the three
// render states are unit-tested here, in the headless test gate.
#[allow(dead_code)]
#[path = "../chat.rs"]           mod chat;
#[path = "../daemon_pane.rs"]    mod daemon_pane; // daemon picker surface (tests)
#[path = "../claims_pane.rs"]    mod claims_pane;
// cloud_fleet_pane is GPUI-free (no maritime/gpui), so it compiles in this bin.
#[path = "../cloud_fleet_pane.rs"] mod cloud_fleet_pane;
#[path = "../cockpit_pane.rs"]   mod cockpit_pane;
#[allow(dead_code)]
#[path = "../conjure.rs"]        mod conjure;
#[path = "../dispatch_pane.rs"]  mod dispatch_pane;
#[allow(dead_code)]
#[path = "../editor_pane.rs"]    mod editor_pane;
#[allow(dead_code)]
#[path = "../editor_claims.rs"]  mod editor_claims;
#[allow(dead_code)]
#[path = "../editor_commit_gate.rs"] mod editor_commit_gate;
#[allow(dead_code)]
#[path = "../editor_sync.rs"]    mod editor_sync;
#[allow(dead_code)]
#[path = "../editor_wedge.rs"]   mod editor_wedge;
// maritime's gpui FlagBadge is now #[cfg(feature = "gpui")]-gated, so the pure
// Flag/flag_for_state compile here and the fleet pane renders in the REPL too.
#[path = "../fleet_pane.rs"]     mod fleet_pane;
#[path = "../grid.rs"]           mod grid; // launcher-grid data + 1:1 invariant tests
#[path = "../harbor_pane.rs"]    mod harbor_pane; // Agent Node roster+detail (ch18 C3)
#[path = "../maritime.rs"]       mod maritime;
#[path = "../health_pane.rs"]    mod health_pane;
#[path = "../inbox_pane.rs"]     mod inbox_pane;
#[path = "../lane_pane.rs"]      mod lane_pane;
#[allow(dead_code)]
#[path = "../mux.rs"]            mod mux;
#[path = "../lineage_pane.rs"]   mod lineage_pane;
#[path = "../notes_pane.rs"]     mod notes_pane;
#[path = "../pane.rs"]           mod pane;
#[path = "../peek_pane.rs"]      mod peek_pane;
#[path = "../planner_pane.rs"]   mod planner_pane;
#[path = "../prs_pane.rs"]       mod prs_pane;
#[path = "../roadmap_pane.rs"]   mod roadmap_pane;
#[path = "../sessions_pane.rs"]  mod sessions_pane;
#[path = "../substrate_pane.rs"] mod substrate_pane;
#[path = "../parley_pane.rs"]    mod parley_pane;
#[path = "../suggest_pane.rs"]   mod suggest_pane;
#[path = "../term.rs"]           mod term;
#[path = "../theme.rs"]          mod theme;
#[path = "../util.rs"]           mod util;

use agent::{AgentManager, Backend};
use active_agents_pane::ActiveAgentsPane;
use anyhow::Result;
use dispatch_pane::DispatchQueuePane;
use fleet_pane::FleetPane;
use harbor_pane::HarborPane;
use lane_pane::LanePane;
use lineage_pane::LineagePane;
use pane::{OperatorTurn, PaneRegistry, Subscription, SurfaceAction};
use substrate_pane::SubstratePane;
use parley_pane::ParleyPane;
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
            ":harness <backend> <prompt> · :new <backend> <prompt> · :agents · :switch <n> · :lane · :lane-message <text> · :harbor · :edit <path> · :quit",
            Sem::Muted
        )
    );
    println!();
}

async fn drain_active_subscription(reg: &mut PaneRegistry, mgr: &AgentManager, window: Duration) {
    match reg.active().and_then(|p| p.subscription()) {
        Some(Subscription::Agent { agent_id }) => {
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
        // The Harbor Editor lane (P3 wire stage 1) — the headless twin of the gpui
        // producer's editor drain. Follow the file's TWO isolated channels: the
        // edit-sync lane (durable Loro ops + lossy presence → `on_edit_frame`) and the
        // coordination lane (region claims → `on_coord_frame`). One `subscribe_channel`
        // per channel is the isolation; a single `window` deadline bounds the drain, and
        // either channel closing ends it — mirroring the Agent arm's `None => break`.
        Some(Subscription::Editor { channel, coord_channel }) => {
            let active = reg.active;
            let mut edit_rx = mgr.daemon().subscribe_channel(&channel);
            let mut coord_rx = mgr.daemon().subscribe_channel(&coord_channel);
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
    reg.register(Box::new(LineagePane::new()));
    reg.register(Box::new(SubstratePane::new()));
    reg.register(Box::new(ParleyPane::new()));
    reg.register(Box::new(ActiveAgentsPane::new()));
    reg.register(Box::new(HarborPane::new()));

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

        if line == ":quit" || line == ":q" {
            break;
        } else if line == ":dispatch" {
            // Refresh the dispatch pane then render it.
            reg.active = reg.panes.iter().position(|p| p.id() == "dispatch").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
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
            // `:edit`s rebind rather than pile up panes.
            let pane = editor_pane::EditorPane::new(path.to_string(), None);
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
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            drain_active_subscription(&mut reg, &mgr, Duration::from_millis(1_200)).await;
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":lane" || line == ":interrupt" || line.starts_with(":lane-message ") || line.starts_with(":steer ") {
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
                    .mutate_active(mgr.daemon(), SurfaceAction::Interrupt { reason: Some("operator stop".into()) })
                    .await
                {
                    Ok(()) => ok(&style, "interrupt sent — watch the stream for control.interrupt"),
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
                    Ok(()) => ok(&style, "message sent — watch the lane for the echoed operator turn"),
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
            reg.active = reg.panes.iter().position(|p| p.id() == "harbor").unwrap_or(0);
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
                let argument = parts.next().map(str::trim).filter(|a| !a.is_empty()).map(String::from);
                match reg
                    .mutate_active(mgr.daemon(), SurfaceAction::Control { verb: verb.clone(), argument })
                    .await
                {
                    Ok(()) => ok(&style, &format!("{verb} queued — watch the control history")),
                    Err(e) => err(&style, &format!("{verb} refused: {e}")),
                }
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":lineage" {
            // RCP-14 discourse argument graph for PD_LINEAGE_CHANNEL (default
            // "discourse"). Refresh + render one tick of the lineage surface.
            reg.active = reg.panes.iter().position(|p| p.id() == "lineage").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":substrate" {
            // RCP-7a/12 pheromone substrate — coverage + active signals (raw →
            // effective). Refresh + render one tick of the substrate surface.
            reg.active = reg.panes.iter().position(|p| p.id() == "substrate").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":parley" {
            // RCP-2a convene decision over the channel's unresolved contradictions.
            reg.active = reg.panes.iter().position(|p| p.id() == "parley").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":roster" || line == ":live-agents" {
            reg.active = reg.panes.iter().position(|p| p.id() == "active-agents").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":fleet" {
            // Declarative ships from pd-fleet.yml with live lifecycle (GET /fleet):
            // sailing / cooldown / dry-dock / paused / armed, each an ICS flag.
            reg.active = reg.panes.iter().position(|p| p.id() == "fleet").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if let Some(p) = reg.active() {
                print!("{}", term::render_blocks(&p.view(), &style));
            }
        } else if line == ":agents" {
            if mgr.agents.is_empty() {
                println!("  {}", style.paint("(no agents — :harness <backend> <prompt>)", Sem::Muted));
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
                        Backend::ALL.iter().map(|b| b.as_str()).collect::<Vec<_>>().join(" ")
                    ),
                ),
                Some(backend) => match mgr.create_agent(backend, prompt).await {
                    Ok((n, out)) => {
                        // Surface the real launch result — including the inline
                        // output one-shot backends return in the spawn response,
                        // and any guard block (budget / worktree / wallet).
                        if let Some(reason) = out.error.filter(|_| out.status == "failed" || out.status == "blocked") {
                            err(&style, &format!("agent {n} {} — {reason}", out.status));
                        } else {
                            ok(&style, &format!("created agent {n} on {} ({})", backend.as_str(), out.status));
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
                        Backend::ALL.iter().map(|b| b.as_str()).collect::<Vec<_>>().join(" ")
                    ),
                ),
                Some(backend) => match mgr.create_harnessed_agent(backend, prompt).await {
                    Ok((n, out)) => {
                        if let Some(reason) = out.error.filter(|_| out.status == "failed" || out.status == "blocked") {
                            err(&style, &format!("harnessed agent {n} {} — {reason}", out.status));
                        } else {
                            ok(&style, &format!("harnessed agent {n} on {} ({})", backend.as_str(), out.status));
                            println!("  {}", style.paint("squid hooks requested · use :agents then talk normally", Sem::Muted));
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
