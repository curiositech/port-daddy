#![recursion_limit = "1024"]
//! pd-console — the operator console. Engine milestone: a headless conversation
//! multiplexer, on the PD bus, backend-agnostic. The GPUI shell renders this next.
//!
//!   :new <backend> <prompt>   create a top-level agent (ollama|claude|claude-cli|
//!                             gemini|cloudflare|codex|aider|custom)
//!   :agents                   list hosted agents
//!   :switch <n>               make agent n active
//!   :dispatch                 show the dispatch queue (sorties awaiting review)
//!   <text>                    send a turn to the active agent (over tube)
//!   :quit
//!
//! This is the answer to "I want to talk to you from inside pd-console, not
//! iterm2" — at the engine layer, runnable today.

#[path = "../activity_pane.rs"]  mod activity_pane;
#[path = "../adrs_pane.rs"]      mod adrs_pane;
#[path = "../agent.rs"]          mod agent;
#[path = "../claims_pane.rs"]    mod claims_pane;
#[path = "../cockpit_pane.rs"]   mod cockpit_pane;
#[path = "../dispatch_pane.rs"]  mod dispatch_pane;
// The Harbor Editor pane is gpui-free; re-host it here so its unit tests run on
// the Linux/CI gate (`cargo test --bin pd-console-repl`). The repl doesn't drive
// it yet, hence dead_code.
#[allow(dead_code)]
#[path = "../editor.rs"]         mod editor;
// fleet_pane and maritime are excluded — they pull in GPUI derive macros
// (#[derive(IntoElement)]) which overflow the rustc stack in this non-GPUI binary.
#[path = "../health_pane.rs"]    mod health_pane;
#[path = "../inbox_pane.rs"]     mod inbox_pane;
#[path = "../lane_pane.rs"]      mod lane_pane;
#[allow(dead_code)]
#[path = "../mux.rs"]            mod mux;
#[path = "../lineage_pane.rs"]   mod lineage_pane;
#[path = "../notes_pane.rs"]     mod notes_pane;
#[path = "../pane.rs"]           mod pane;
#[path = "../peek_pane.rs"]      mod peek_pane;
#[path = "../prs_pane.rs"]       mod prs_pane;
#[path = "../roadmap_pane.rs"]   mod roadmap_pane;
#[path = "../sessions_pane.rs"]  mod sessions_pane;
#[path = "../substrate_pane.rs"] mod substrate_pane;
#[path = "../suggest_pane.rs"]   mod suggest_pane;
#[path = "../term.rs"]           mod term;
#[path = "../theme.rs"]          mod theme;
#[path = "../util.rs"]           mod util;

use agent::{AgentManager, Backend};
use anyhow::Result;
use dispatch_pane::DispatchQueuePane;
use lane_pane::LanePane;
use lineage_pane::LineagePane;
use pane::PaneRegistry;
use substrate_pane::SubstratePane;
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
            ":new <backend> <prompt> · :agents · :switch <n> · :dispatch · :lineage · :substrate · <text> · :quit",
            Sem::Muted
        )
    );
    println!();
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
    reg.register(Box::new(LanePane::new()));
    reg.register(Box::new(LineagePane::new()));
    reg.register(Box::new(SubstratePane::new()));

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
        } else if line == ":lane" || line == ":interrupt" {
            // The live Lane surface (headless rendering of one tick). `:lane`
            // refreshes + renders; `:interrupt` additionally grabs the wheel —
            // POST /agents/:id/interrupt on the watched agent (the closed loop).
            reg.active = reg.panes.iter().position(|p| p.id() == "lane").unwrap_or(0);
            if let Err(e) = reg.refresh_active(mgr.daemon()).await {
                err(&style, &format!("refresh failed: {e}"));
            }
            if line == ":interrupt" {
                use pane::SurfaceAction;
                match reg
                    .mutate_active(mgr.daemon(), SurfaceAction::Interrupt { reason: Some("operator stop".into()) })
                    .await
                {
                    Ok(()) => ok(&style, "interrupt sent — watch the stream for control.interrupt"),
                    Err(e) => err(&style, &format!("interrupt failed: {e}")),
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
        } else if line == ":agents" {
            if mgr.agents.is_empty() {
                println!("  {}", style.paint("(no agents — :new <backend> <prompt>)", Sem::Muted));
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
