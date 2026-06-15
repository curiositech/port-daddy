use anyhow::Result;
use clap::{Parser, Subcommand};
use pd_mesh::{EventHead, QuicMeshConfig};
use pd_runtime::{BackendCapacity, BackendReadiness};
use pd_tui::{render_text_summary, DashboardState};

#[derive(Debug, Parser)]
#[command(name = "pd-rs")]
#[command(about = "Port Daddy Rust kernel control plane")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Show local kernel status.
    Status,
    /// Run or inspect the local Rust daemon.
    Daemon {
        #[arg(long)]
        once: bool,
    },
    /// Open the Ratatui operator surface.
    Tui {
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

fn daemon(once: bool) -> Result<()> {
    if once {
        println!("pd-rs daemon once: local socket loop not started in this scaffold");
    } else {
        println!("pd-rs daemon: local Unix socket server is the next implementation slice");
    }
    Ok(())
}

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

fn mesh() -> Result<()> {
    let config = QuicMeshConfig::default();
    let head = EventHead::genesis("local-daemon");
    println!("mesh bind: {}", config.bind_addr);
    println!("mesh alpn: {}", String::from_utf8_lossy(&config.alpn));
    println!("anchor auth required: {}", config.require_anchor_auth);
    println!("local event head: {}@{}", head.daemon_id, head.sequence);
    Ok(())
}

fn jobs() -> Result<()> {
    println!("jobs: empty");
    println!("lease policy: expiring leases, mandatory AgentContextFrame before backend run");
    Ok(())
}

fn rooms() -> Result<()> {
    println!("rooms: empty");
    println!("routing policy: local first, mesh-scoped after authenticated peer handshakes");
    Ok(())
}
