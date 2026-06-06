//! pd-console — the operator console. Engine milestone: a headless conversation
//! multiplexer, on the PD bus, backend-agnostic. The GPUI shell renders this next.
//!
//!   :new <backend> <prompt>   create a top-level agent (ollama|claude|claude-cli|
//!                             gemini|cloudflare|codex|aider|custom)
//!   :agents                   list hosted agents
//!   :switch <n>               make agent n active
//!   <text>                    send a turn to the active agent (over tube)
//!   :quit
//!
//! This is the answer to "I want to talk to you from inside pd-console, not
//! iterm2" — at the engine layer, runnable today.

mod agent;
mod theme;

use agent::{AgentManager, Backend};
use anyhow::Result;
use std::io::{self, Write};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    let t = &theme::DARK;
    // No emoji as icon (operator rule): plain typographic banner.
    println!(
        "\x1b[1mpd-console\x1b[0m  ·  conversation multiplexer (engine)  ·  accent #{:06x}  ·  {} / {}",
        t.accent.to_srgb8(),
        t.sans,
        t.mono
    );
    let mut mgr = match AgentManager::new() {
        Ok(m) => {
            println!("   daemon: {}", m.daemon().base());
            m
        }
        Err(e) => {
            eprintln!("   daemon discovery failed: {e}");
            return Ok(());
        }
    };
    println!("   :new <backend> <prompt> · :agents · :switch <n> · <text> · :quit\n");

    let stdin = io::stdin();
    loop {
        print!("» ");
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
        } else if line == ":agents" {
            if mgr.agents.is_empty() {
                println!("  (no agents — :new <backend> <prompt>)");
            }
            for (n, a) in &mgr.agents {
                let mark = if mgr.active == Some(*n) { "●" } else { " " };
                println!("  {mark} {n}  {:<11} {}  [{}]", a.backend.as_str(), a.id, a.channel);
            }
        } else if let Some(rest) = line.strip_prefix(":switch ") {
            match rest.trim().parse::<u64>() {
                Ok(n) if mgr.agents.contains_key(&n) => {
                    mgr.active = Some(n);
                    println!("  → active: agent {n}");
                }
                _ => println!("  no such agent"),
            }
        } else if let Some(rest) = line.strip_prefix(":new ") {
            let mut it = rest.splitn(2, ' ');
            let bk = it.next().unwrap_or("");
            let prompt = it.next().unwrap_or("").trim();
            match Backend::parse(bk) {
                None => println!(
                    "  unknown backend '{bk}'. one of: {}",
                    Backend::ALL.iter().map(|b| b.as_str()).collect::<Vec<_>>().join(" ")
                ),
                Some(backend) => match mgr.create_agent(backend, prompt).await {
                    Ok(n) => println!("  ✓ created top-level agent {n} on {} (voyage on the bus)", backend.as_str()),
                    Err(e) => println!("  ✗ spawn failed: {e}"),
                },
            }
        } else {
            // a turn to the active agent
            if let Err(e) = mgr.send(&line).await {
                println!("  ✗ {e}");
                continue;
            }
            // drain replies for a short window
            for _ in 0..20 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                match mgr.poll_active().await {
                    Ok(msgs) => {
                        for m in &msgs {
                            println!("  {}: {}", m.sender, m.text);
                        }
                        if !msgs.is_empty() {
                            break;
                        }
                    }
                    Err(e) => {
                        println!("  ✗ poll: {e}");
                        break;
                    }
                }
            }
        }
    }
    println!("out.");
    Ok(())
}
