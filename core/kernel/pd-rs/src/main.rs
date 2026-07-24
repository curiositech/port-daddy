//! `pd-rs` — the command-line entrypoint for the Port Daddy Rust kernel.
//!
//! This binary is the operator's front door to the kernel crates: it wires `clap` argument
//! parsing to a handful of read-only inspection commands, each of which pretty-prints the
//! state of one kernel subsystem. Today it is a **scaffold** — the commands report
//! configuration and shape (the mesh bind address, the genesis event head, the TUI summary)
//! rather than driving a live daemon. The interactive daemon loop and the Ratatui event loop
//! are the next implementation slices, and the command bodies say so out loud so nobody
//! mistakes the scaffold for the finished control plane.
//!
//! # Commands
//!
//! Running `pd-rs` with no subcommand defaults to [`Command::Status`]. The others each
//! inspect one area: [`Command::Daemon`] (local socket server, not yet started),
//! [`Command::Tui`] (operator dashboard summary via [`pd_tui`]), [`Command::Mesh`] (mesh
//! config and event head via [`pd_mesh`]), and [`Command::Jobs`]/[`Command::Rooms`] (queue
//! and routing policy). `--once` on the daemon/TUI commands asks for a single-shot render
//! instead of a long-running loop.
//!
//! Every handler returns [`anyhow::Result`] so a failure anywhere surfaces as a non-zero exit
//! with a readable error chain rather than a panic.

use anyhow::Result;
use clap::{Parser, Subcommand};
use pd_mesh::{EventHead, QuicMeshConfig};
use pd_runtime::{BackendCapacity, BackendReadiness};
use pd_tui::{render_text_summary, DashboardState};

/// Top-level CLI: an optional subcommand (defaulting to `status`).
#[derive(Debug, Parser)]
#[command(name = "pd-rs")]
#[command(about = "Port Daddy Rust kernel control plane")]
struct Cli {
    /// The subcommand to run; `None` is treated as [`Command::Status`].
    #[command(subcommand)]
    command: Option<Command>,
}

/// The kernel inspection subcommands. Each maps to one handler function below.
#[derive(Debug, Subcommand)]
enum Command {
    /// Show local kernel status.
    Status,
    /// Run or inspect the local Rust daemon.
    Daemon {
        /// Report once and exit instead of running the (not-yet-built) socket loop.
        #[arg(long)]
        once: bool,
    },
    /// Open the Ratatui operator surface.
    Tui {
        /// Print a single text summary instead of entering the interactive event loop.
        #[arg(long)]
        once: bool,
    },
    /// Inspect mesh identity and peer state.
    Mesh,
    /// Inspect the Rust-owned job queue.
    Jobs,
    /// Inspect kernel rooms.
    Rooms,
}

/// Parse arguments and dispatch to the matching handler, defaulting to `status`.
fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Command::Status) {
        Command::Status => status(),
        Command::Daemon { once } => daemon(once),
        Command::Tui { once } => tui(once),
        Command::Mesh => mesh(),
        Command::Jobs => jobs(),
        Command::Rooms => rooms(),
    }
}

/// Print the kernel's headline status: readiness, event-log engine, and the mock backend's
/// capacity. This is the default command and the quickest "is the kernel sane?" check.
fn status() -> Result<()> {
    let capacity = BackendCapacity {
        backend_id: "mock".to_owned(),
        model_id: "context-frame-smoke".to_owned(),
        readiness: BackendReadiness::Ready,
        max_parallel_jobs: 1,
        active_jobs: 0,
    };
    println!("Port Daddy Rust Kernel");
    println!("status: local-only scaffold");
    println!("event log: sqlite-wal ready");
    println!("backend: {} / {}", capacity.backend_id, capacity.model_id);
    println!("context frames: mandatory for Rust-owned runs");
    Ok(())
}

/// Report the daemon slice. The local Unix-socket server is not yet implemented, so this
/// currently just states what `--once` versus long-running mode *will* do.
fn daemon(once: bool) -> Result<()> {
    if once {
        println!("pd-rs daemon once: local socket loop not started in this scaffold");
    } else {
        println!("pd-rs daemon: local Unix socket server is the next implementation slice");
    }
    Ok(())
}

/// Render the operator dashboard as a text summary via [`pd_tui::render_text_summary`]. With
/// `--once` it prints the summary and exits; otherwise it also notes that the interactive
/// Ratatui loop is still to come.
fn tui(once: bool) -> Result<()> {
    let mut state = DashboardState::empty_local();
    state.selected_transaction =
        Some("WorkTransaction detail pane is live; daemon feed next".to_owned());
    if once {
        println!("{}", render_text_summary(&state));
    } else {
        println!("{}", render_text_summary(&state));
        println!("interactive Ratatui event loop is the next implementation slice");
    }
    Ok(())
}

/// Print the mesh identity and local peering posture: bind address, negotiated ALPN, whether
/// anchor auth is required, and this daemon's genesis event head.
fn mesh() -> Result<()> {
    let config = QuicMeshConfig::default();
    let head = EventHead::genesis("local-daemon");
    println!("mesh bind: {}", config.bind_addr);
    println!("mesh alpn: {}", String::from_utf8_lossy(&config.alpn));
    println!("anchor auth required: {}", config.require_anchor_auth);
    println!("local event head: {}@{}", head.daemon_id, head.sequence);
    Ok(())
}

/// Print the job queue and its lease policy. The queue is empty in the scaffold; the policy
/// line documents the invariant that a backend run requires a mandatory `AgentContextFrame`.
fn jobs() -> Result<()> {
    println!("jobs: empty");
    println!("lease policy: expiring leases, mandatory AgentContextFrame before backend run");
    Ok(())
}

/// Print kernel rooms and the routing policy: local-first, widening to mesh scope only after
/// an authenticated peer handshake.
fn rooms() -> Result<()> {
    println!("rooms: empty");
    println!("routing policy: local first, mesh-scoped after authenticated peer handshakes");
    Ok(())
}
