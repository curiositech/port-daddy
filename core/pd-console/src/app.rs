//! pd-console GPUI application — native window, sidebar nav, pane content.
//!
//! Layout:
//!   ┌─ sidebar 96px ─┬──────────── main pane ─────────────┐
//!   │  pd             │  [pane header]                     │
//!   │  ──────         │                                    │
//!   │  Fleet  1       │   active pane blocks               │
//!   │  Cockpit 2      │                                    │
//!   │  Runs 3         │                                    │
//!   │  ...            │                                    │
//!   └────────────────┴─────────────────────────────────────┘
//!   ┌─ status bar ───────────────────────────────────────┐
//!   │  daemon: <resolved-url>  ·  pd-console 0.2         │
//!   └────────────────────────────────────────────────────┘
//!
//! Keys 1-9, s, m, p, h, c switch panels.

use gpui::prelude::*;
use gpui::*;

pub use crate::chat::ChatUpdate;
use crate::chat::{chat_display_text, chat_error_display_text, ChatLog, ChatMsg, ChatState};
use crate::dispatch_pane::DispatchHead;
use crate::editor_input::{EditorInput, TextEdit};
use crate::editor_sync::PresenceState;
use crate::editor_view::{
    editor_hit_position, editor_text_layout, editor_visual_position_for_byte, editor_wrap_columns,
    wrap_byte_ranges, BLAME_COL_CHARS,
};
use crate::mux::{default_operator_workspace, Dir, Node, PaneId, SurfaceKind, Workspace};
use crate::palette::{Theme, ThemeMode};
use crate::pane::{Alert, AlertLevel, Block, OperatorTurn, Pane, Tone};
use crate::shell_drawer::{
    terminal_key_bytes, ShellEvent, ShellStatus, ShellTerminal, TerminalColor,
};
use crate::story_linework::{corner_ticks, micro_flag, state_stripe};
use crate::tokens;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use unicode_segmentation::UnicodeSegmentation;

/// Operator control messages sent from the GPUI view (button clicks) back to the
/// background refresh thread, which owns the surfaces and performs the daemon
/// mutation. Keeps the foreground thread free of async/tokio.
#[derive(Debug, Clone)]
pub enum ControlMsg {
    /// Grab the wheel: interrupt the agent the Lane is watching.
    InterruptLane,
    /// The console's sole work-creation command. The daemon captures a
    /// WorkIntent and initial WorkPlan through the Surface Gateway; the GUI
    /// never chooses a provider, body, model, topology, node, or run.
    SubmitWorkIntent {
        goal: String,
    },
    /// Send a turn to the cartographer over its tube channel: `POST /msg/cartographer`.
    Cartographer {
        text: String,
    },
    /// Send an operator turn to the agent currently watched by the Lane. This is
    /// a real `agent:<id>` tube message; the Lane stream echoes it as `agent.tube`.
    MessageLane {
        text: String,
    },
    /// Operator chat turn. An already-bound governed run receives it over its
    /// tube. Without one, the daemon captures a WorkIntent for the conversation;
    /// the console never spawns a provider-specific responder itself.
    ChatSend {
        text: String,
    },
    /// Operator review-gate verdicts on the head dispatch.
    DispatchAccept {
        id: String,
    },
    DispatchReject {
        id: String,
        reason: String,
    },
    DispatchCancel {
        id: String,
    },
    /// Conductor operator control (ADR-0060): halt/pause/resume a fleet lineage.
    /// `root_id: None` = the whole fleet (global emergency stop).
    FleetHalt {
        root_id: Option<String>,
    },
    FleetPause {
        root_id: Option<String>,
    },
    FleetResume {
        root_id: Option<String>,
    },
    /// Render the live WorkPlan graph to a PNG via the Vello proto. Carries the DAG
    /// already serialized to the proto's JSON shape (the foreground owns the DAG;
    /// serializing on the gpui thread is cheap and keeps the worker self-contained)
    /// plus a short title for the success flash. The background thread writes the
    /// JSON where the proto reads it, shells `pd-conjure-proto/scripts/capture.sh`
    /// (RELEASE + UNSANDBOXED — required: debug fontique panics on macOS 15 and the
    /// Metal readback is SIGKILLed under a sandbox), then `open`s the PNG. The
    /// shell-out runs on a blocking worker so it never stalls the refresh loop and
    /// never touches the gpui render thread.
    RenderWorkGraph {
        dag_json: String,
        title: String,
    },
    /// Switch the whole console to another daemon berth (ADR-0084). The producer
    /// swaps its `DaemonClient` so every pane's next refresh hits the new daemon.
    RebindDaemon {
        url: String,
    },
    /// Steer the Sextant pane's query (control socket `sextant` command): the
    /// producer thread owns the pane, so params travel the same channel as
    /// every other operator mutation.
    GalaxyParams {
        window_hours: Option<u32>,
        min_tokens: Option<u32>,
    },
    /// Toggle Sextant clustering (cluster=false skips k-means + MI labels
    /// daemon-side); same producer-owned channel as GalaxyParams.
    GalaxyCluster {
        enabled: bool,
    },
    /// Add an operator note: `POST /notes` with `{ content }`.
    AddNote {
        content: String,
    },
    /// Begin a coordination session: `POST /sugar/begin` (durable lifecycle).
    BeginSession {
        identity: String,
    },
    /// End the active coordination session: `POST /sugar/done` (optional summary).
    EndSession {
        summary: Option<String>,
    },
    /// Claim a port for an identity: `POST /claim` — Port Daddy's core verb.
    ClaimPort {
        identity: String,
    },
    /// Release a claimed port by identity: `DELETE /release`.
    ReleasePort {
        identity: String,
    },
    /// Kill (unregister) an agent: `DELETE /agents/:id`.
    KillAgent {
        agent_id: String,
    },
    /// Interrupt a specific agent by id: `POST /agents/:id/interrupt`. Broadens
    /// the Lane's interrupt to any agent named from the Fleet/Cockpit roster.
    InterruptAgent {
        agent_id: String,
    },
    /// Convene a parley from a Sextant selection: `POST /parley/call`.
    /// `parties` are DEDUPED AGENT ids (`fleet_transcripts.spawned_agent_id` —
    /// never transcript/session ids; parley DMs parties via agent inbox). The
    /// daemon 400s below 2 distinct ids; the UI disables the button first, and
    /// any rejection body comes back verbatim on the alert bus.
    GalaxyParley {
        surface: String,
        reason: String,
        parties: Vec<String>,
    },
    /// Fetch one Sextant session's full detail through `GET /galaxy/session/:id`
    /// (`:id` = the transcript id from a clicked point). The parsed
    /// [`crate::galaxy_pane::GalaxyDetail`] returns on the dedicated Sextant bus
    /// (mirroring the WorkPlan bus), drained into the view's detail drawer.
    GalaxyDetail {
        transcript_id: String,
    },
    /// Select a roster row on the Harbor surface (binder ch18 C3): clicking a
    /// NodeRow retargets the conjoined detail pane — never an id typed.
    HarborSelect {
        index: usize,
    },
    /// Issue a compliance-gated control verb against the Harbor's selected
    /// node. The pane re-checks its gate, then POSTs the F0 ControlCommand;
    /// the daemon is the sole authorizer. `argument` carries a steer message
    /// or checkpoint reason.
    HarborControl {
        verb: String,
        argument: Option<String>,
    },
    /// Bind the producer's live Harbor Editor lane to a file (P3 wire stage 1). Sent
    /// when the operator opens an `Editor` surface (FileTree click / `:edit <path>`).
    /// The producer constructs a persistent [`crate::editor_pane::EditorPane`] on this
    /// path, loads its Loro buffer, and follows its [`Subscription::Editor`] — draining
    /// doc-op + presence frames off the edit-sync channel and claim frames off the
    /// coordination channel into the pane, the same way the Lane/Harbor lanes follow an
    /// agent stream. `region` carries the optional highlighted line span.
    OpenEditor {
        path: String,
        region: Option<(u32, u32)>,
    },
    /// One accepted foreground keystroke as the exact incremental Loro delta,
    /// plus its resulting caret/selection. The producer imports this frame into
    /// its live-lane mirror and broadcasts it; it never recreates the edit.
    EditorLocalChange {
        path: String,
        frame: Option<String>,
        presence: PresenceState,
    },
}

/// Producer-to-window editor edge. Remote frames are carried alongside the
/// already-rendered collaboration Blocks so the foreground Loro authority stays
/// converged before the next local keystroke.
#[derive(Debug, Clone)]
pub struct EditorUpdate {
    pub path: String,
    pub blocks: Vec<Block>,
    pub remote_frames: Vec<String>,
}

/// A push from the daemon worker back to the Work surface. Runtime truth is a
/// daemon snapshot/receipt; PNG is a render artifact of that truth only.
#[derive(Debug, Clone)]
pub enum WorkUpdate {
    Receipt(crate::agent::WorkIntentReceipt),
    Execution(crate::agent::WorkExecutionReceipt),
    Snapshot(crate::agent::WorkSnapshot),
    /// The path to the rendered Vello PNG for the current DAG — shown INLINE at the
    /// top of the Work surface (gpui `img(path)`).
    Png(std::path::PathBuf),
}

/// A push from the background worker back to the view about the Sextant surface:
/// the parsed session detail for a clicked point, or the daemon's real failure
/// (surfaced in the drawer, never swallowed). Rides its own small bus alongside
/// the WorkPlan/chat buses in `main.rs`.
#[derive(Debug, Clone)]
pub enum GalaxyUpdate {
    Detail(crate::galaxy_pane::GalaxyDetail),
    DetailError(String),
}

/// Which command line is open at the bottom of the console.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmdKind {
    /// Capture operator intent through the daemon-owned Surface Gateway.
    Work,
    /// Talk to the cartographer. Buffer is the message.
    Cartographer,
    /// Talk to the agent currently watched by the Lane. Buffer is the message.
    LaneMessage,
    /// Reject the head dispatch with a reason (the human-gate "modify/why" path).
    /// The target dispatch id is held in `ConsoleView::reject_target`.
    DispatchReject,
    /// Add a new split pane of a chosen surface kind. Buffer is a surface name
    /// (nav label/id/key prefix, e.g. "cost", "fleet", "chat"). Handled locally.
    AddPane,
    /// Switch the console to another daemon berth (ADR-0084). Buffer is a berth
    /// name, `:port`, or a tier alias ("stable"/"dev-latest"); resolved against
    /// `~/.port-daddy/dev-daemons.json`. See the Daemons pane for the names.
    UseDaemon,
    /// Add an operator note. Buffer is the note text. → `POST /notes`.
    Note,
    /// Begin a coordination session. Buffer is the identity. → `POST /sugar/begin`.
    Begin,
    /// End the active session. Buffer is an optional summary. → `POST /sugar/done`.
    Done,
    /// Claim a port for an identity. Buffer is the identity. → `POST /claim`.
    Claim,
    /// Release a claimed port. Buffer is the identity. → `DELETE /release`.
    Release,
    /// Kill (unregister) an agent. Buffer is the agent id. → `DELETE /agents/:id`.
    Kill,
    /// Interrupt a specific agent. Buffer is the agent id. → `POST /agents/:id/interrupt`.
    InterruptAgent,
    /// Convene a parley over the current Sextant selection. Buffer is the
    /// operator's reason (empty = the contract's default reason); the parties/
    /// surface are computed from `ConsoleView::galaxy_selected` at submit time.
    /// → `POST /parley/call`.
    GalaxyParley,
    /// Steer the Harbor's selected Agent Node (ch18 C3). Buffer is the steer
    /// message injected before the node's next turn. → `POST /agent-nodes/:id/control`.
    HarborSteer,
    /// The operator verb palette (vim-`:` style). Buffer is `<verb> <args>`; the
    /// first token selects an operator write, the rest are its arguments. One
    /// keybinding (`Ctrl-A :`) reaches every write without exhausting the
    /// single-letter leader namespace. `submit_command` re-dispatches into the
    /// concrete verb's path.
    Verb,
}

impl CmdKind {
    fn prompt(&self) -> &'static str {
        match self {
            CmdKind::Work => "work",
            CmdKind::Cartographer => "cartographer",
            CmdKind::LaneMessage => "message agent",
            CmdKind::DispatchReject => "reject reason",
            CmdKind::AddPane => "add pane",
            CmdKind::UseDaemon => "use daemon",
            CmdKind::Note => "note",
            CmdKind::Begin => "begin (identity)",
            CmdKind::Done => "done (summary)",
            CmdKind::Claim => "claim (identity)",
            CmdKind::Release => "release (identity)",
            CmdKind::Kill => "kill (agent id)",
            CmdKind::InterruptAgent => "interrupt (agent id)",
            CmdKind::GalaxyParley => "parley reason",
            CmdKind::HarborSteer => "steer node (message)",
            CmdKind::Verb => ":",
        }
    }

    /// Ghost text shown in the input when empty — the GUI must never demand
    /// syntax the operator has to guess. This is the discoverability the hidden
    /// leader-key command line never had.
    ///
    /// Returns an owned `String` because some hints include discovered runtime
    /// values such as the canonical daemon port.
    fn placeholder(&self) -> String {
        match self {
            CmdKind::Work => {
                "describe the outcome; Port Daddy captures intent before choosing a plan or body…"
                    .to_string()
            }
            CmdKind::Cartographer => {
                "Ask the cartographer about the roadmap, then watch the lane stream the reply…"
                    .to_string()
            }
            CmdKind::LaneMessage => {
                "Message, @file path, @photo path, @skill id, or @tool name…".to_string()
            }
            CmdKind::DispatchReject => {
                "Why reject this? The reason is sent back to the agent.".to_string()
            }
            CmdKind::AddPane => {
                "fleet · cost · roadmap · lane · work · chat · files · alerts…".to_string()
            }
            CmdKind::UseDaemon => format!(
                "prod · latest · dev-latest · :{} · berth name…",
                crate::berths::STABLE_PORT
            ),
            CmdKind::Note => "record an operator note in Port Daddy memory…".to_string(),
            CmdKind::Begin => "port-daddy:console:task".to_string(),
            CmdKind::Done => "what changed, what was validated, what remains…".to_string(),
            CmdKind::Claim => "project:stack:context".to_string(),
            CmdKind::Release => "project:stack:context".to_string(),
            CmdKind::Kill => "agent-id".to_string(),
            CmdKind::InterruptAgent => "agent-id".to_string(),
            CmdKind::GalaxyParley => {
                "why convene these agents? Enter sends — empty uses the default reason".to_string()
            }
            CmdKind::HarborSteer => {
                "guidance for the selected node — injected before its next turn…".to_string()
            }
            CmdKind::Verb => "work/note/begin/done/claim/release/kill/interrupt …".to_string(),
        }
    }
}

/// Version + build-freshness of the running binary, for the status bar.
/// The build time is the executable's own mtime (via `age_short`), so it is the
/// honest "did my rebuild actually land?" readout — if you just reinstalled, it
/// reads "built now"; a stale launcher reads "built 3d ago".
fn build_stamp() -> String {
    let ver = env!("CARGO_PKG_VERSION");
    let built = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::metadata(&p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| crate::util::age_short(d.as_millis() as i64));
    match built {
        Some(age) => format!("pd-console v{ver} · built {age} ago"),
        None => format!("pd-console v{ver}"),
    }
}

#[derive(Debug, Clone, Copy)]
struct LauncherItem {
    id: &'static str,
    label: &'static str,
    icon: &'static str,
    key: &'static str,
}

const EXTRA_LAUNCHER_ITEMS: &[LauncherItem] = &[
    LauncherItem {
        id: "chat",
        label: "Chat",
        icon: "icons/nav/cockpit.svg",
        key: "c",
    },
    LauncherItem {
        id: "files",
        label: "Files",
        icon: "icons/nav/claims.svg",
        key: "y",
    },
    LauncherItem {
        id: "alerts",
        label: "Alerts",
        icon: "icons/nav/health.svg",
        key: "a",
    },
    LauncherItem {
        id: "work",
        label: "Work",
        icon: "icons/nav/roadmap.svg",
        key: "v",
    },
];

fn launcher_items() -> Vec<LauncherItem> {
    NAV.iter()
        .map(|nav| LauncherItem {
            id: nav.id,
            label: nav.label,
            icon: nav.icon,
            key: nav.key,
        })
        .chain(EXTRA_LAUNCHER_ITEMS.iter().copied())
        .collect()
}

fn surface_for_launcher_id(id: &str) -> SurfaceKind {
    match id {
        "chat" => SurfaceKind::CartographerChat,
        "files" => SurfaceKind::FileTree { root: None },
        "alerts" => SurfaceKind::Hitl,
        "work" => SurfaceKind::Work,
        nav => surface_for_nav_id(nav),
    }
}

fn launcher_id_for_surface(surface: &SurfaceKind) -> Option<String> {
    match surface {
        SurfaceKind::CartographerChat => Some("chat".to_string()),
        SurfaceKind::FileTree { .. } => Some("files".to_string()),
        SurfaceKind::Hitl => Some("alerts".to_string()),
        SurfaceKind::Work => Some("work".to_string()),
        _ => nav_id_for_surface(surface).map(str::to_string),
    }
}

/// Resolve a typed surface name to a `SurfaceKind` for the add-pane picker.
/// Matches every launcher tile by label/id/key, plus older aliases operators
/// have already learned.
fn surface_for_query(query: &str) -> Option<SurfaceKind> {
    let trimmed = query.trim();
    // `:edit <path>` (or `edit <path>`) opens the Harbor Editor surface on a file.
    // Keep the raw (case-preserving) path — file systems are case-sensitive.
    if let Some(path) = trimmed
        .strip_prefix(":edit ")
        .or_else(|| trimmed.strip_prefix("edit "))
    {
        let path = path.trim();
        if !path.is_empty() {
            return Some(SurfaceKind::Editor {
                path: path.to_string(),
                region: None,
            });
        }
    }
    let q = trimmed.to_lowercase();
    if q.is_empty() {
        return None;
    }
    match q.as_str() {
        "cartographer" => return Some(SurfaceKind::CartographerChat),
        "tree" | "filetree" => return Some(SurfaceKind::FileTree { root: None }),
        "hitl" => return Some(SurfaceKind::Hitl),
        "work" | "plan" => return Some(SurfaceKind::Work),
        "roadmap" => return Some(SurfaceKind::Roadmap),
        "coast" => {
            return Some(SurfaceKind::Panel {
                nav: "coast-guard".to_string(),
            });
        }
        _ => {}
    }
    launcher_items()
        .into_iter()
        .find(|n| n.key == q || n.id.starts_with(&q) || n.label.to_lowercase().starts_with(&q))
        .map(|n| surface_for_launcher_id(n.id))
}

fn retired_galaxy_pane_reply(pane: &str) -> Option<serde_json::Value> {
    if pane.trim().eq_ignore_ascii_case("galaxy") {
        Some(serde_json::json!({
            "ok": false,
            "error": "pane galaxy was renamed to sextant; use pane=sextant.",
        }))
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy)]
struct LauncherLayout {
    cols: usize,
    tile_w: f32,
    tile_h: f32,
    icon_box: f32,
    icon: f32,
    label_size: f32,
    key_size: f32,
    gap: f32,
    card_pad: f32,
    card_w: f32,
    card_h: f32,
    title_size: f32,
}

fn launcher_layout(viewport_w: f32, viewport_h: f32, item_count: usize) -> LauncherLayout {
    let card_w = (viewport_w - 32.0).clamp(320.0, 1120.0);
    let card_h = (viewport_h - 32.0).clamp(300.0, 820.0);
    let card_pad = if viewport_w < 640.0 || viewport_h < 520.0 {
        12.0
    } else if viewport_w < 900.0 || viewport_h < 700.0 {
        18.0
    } else {
        26.0
    };
    let gap = if viewport_w < 700.0 || viewport_h < 560.0 {
        6.0
    } else {
        10.0
    };
    let header_h = if viewport_h < 560.0 {
        54.0
    } else if viewport_h < 720.0 {
        76.0
    } else {
        102.0
    };
    let footer_h = 18.0;
    let inner_w = (card_w - card_pad * 2.0).max(240.0);
    let inner_h = (card_h - card_pad * 2.0 - header_h - footer_h).max(140.0);
    let max_cols = item_count.clamp(1, 8);
    let mut best = (1usize, 120.0f32, 86.0f32, 0.0f32);
    for cols in 2..=max_cols {
        let rows = item_count.div_ceil(cols);
        let tile_w = (inner_w - gap * (cols.saturating_sub(1) as f32)) / cols as f32;
        let tile_h = (inner_h - gap * (rows.saturating_sub(1) as f32)) / rows as f32;
        let fit_score = (tile_w / 170.0).min(tile_h / 150.0);
        let usable = (tile_w / 80.0).min(tile_h / 58.0);
        let score = fit_score + usable.min(1.0) * 0.18 + cols as f32 * 0.004;
        if score > best.3 {
            best = (cols, tile_w, tile_h, score);
        }
    }
    let tile_w = best.1.clamp(82.0, 170.0);
    let tile_h = best.2.clamp(62.0, 150.0);
    let icon_box = (tile_h * 0.42).clamp(30.0, 74.0);
    LauncherLayout {
        cols: best.0,
        tile_w,
        tile_h,
        icon_box,
        icon: (icon_box * 0.54).clamp(18.0, 40.0),
        label_size: (tile_h / 8.2).clamp(11.0, 18.0),
        key_size: (tile_h / 11.0).clamp(9.0, 13.0),
        gap,
        card_pad,
        card_w,
        card_h,
        title_size: if viewport_h < 560.0 { 18.0 } else { 24.0 },
    }
}

/// An open command line: a prompt kind plus the text typed so far.
#[derive(Debug, Clone)]
pub struct CommandLine {
    kind: CmdKind,
    buffer: String,
}

impl CommandLine {
    fn new(kind: CmdKind) -> Self {
        Self {
            kind,
            buffer: String::new(),
        }
    }

    fn with_buffer(kind: CmdKind, buffer: String) -> Self {
        let mut cmd = Self::new(kind);
        cmd.buffer = buffer;
        cmd
    }
}

/// An in-flight pane-divider drag (grab-the-rope resize): which split (by tree
/// path from the root), which boundary (the left child's index), and the axis.
#[derive(Debug, Clone)]
struct DragState {
    path: Vec<usize>,
    left: usize,
    dir: Dir,
}

/// One named tab — an independent pane tree, plus an optional zoomed (maximized)
/// pane that fills the tab while set.
#[derive(Debug, Clone)]
struct Tab {
    name: String,
    workspace: Workspace,
    zoomed: Option<PaneId>,
}

// ── Nav items ────────────────────────────────────────────────────────────────
// The grid data (`NavItem`, `NAV`) and the slot map (`SLOT_PANE_IDS`) live in the
// gpui-free `crate::grid` module so they compile into the headless REPL bin too,
// where the 1:1 invariant tests run under the rust-console CI gate.
use crate::grid::NAV;

/// ADHD-friendly launcher colour-coding: each pane *category* gets a distinct,
/// vivid maritime hue so the eye can navigate the grid by colour instead of
/// reading all 22 labels. Uses only on-brand palette tokens (signal-flag +
/// status hues), never an invented hex.
///
/// - **Live** (agents in motion) → `cobalt` (sky blue)
/// - **Control** (operator levers) → `accent` (amber brand)
/// - **Knowledge** (settled docs/graphs) → `landed` (mint)
/// - **Records** (observability readouts) → `gated` (coral)
fn launcher_tone(id: &str, t: &Theme) -> u32 {
    match id {
        "fleet" | "cockpit" | "sorties" | "lane" | "peek" | "chat" | "files" => t.cobalt,
        "dispatch" | "conductor" | "parley" | "suggest" | "coast" | "coast-guard" | "claims"
        | "work" => t.accent,
        "roadmap" | "planner" | "adrs" | "memory" | "lineage" | "substrate" | "sextant" => t.landed,
        _ => t.gated, // activity, sessions, inbox, prs, health, ledger
    }
}

/// A faint wash of a tile's tone for chip/pill backgrounds (`color` at `alpha`).
fn tone_wash(color: u32, alpha: u8) -> Rgba {
    rgba((color << 8) | alpha as u32)
}

/// Pick a high-contrast ink (near-black or near-white) for a label sitting ON a
/// solid `color` chip — a Rec.601 luma threshold so a badge stays ≥4.5:1 legible
/// regardless of the tone's hue or the active light/dark theme.
fn knockout_ink(color: u32) -> u32 {
    let r = ((color >> 16) & 0xff) as f32;
    let g = ((color >> 8) & 0xff) as f32;
    let b = (color & 0xff) as f32;
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if luma > 140.0 {
        0x10_10_14
    } else {
        0xf5_f5_f7
    }
}

/// One entry in the launcher's colour legend: a filled dot + a category label,
/// so the hue-coding is self-explaining rather than something to memorise.
fn launcher_legend_chip(label: &'static str, color: u32) -> impl IntoElement {
    let t = current_theme();
    div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .w(px(11.0))
                .h(px(11.0))
                .rounded(px(6.0))
                .bg(rgb(color)),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(label),
        )
}

// ── Live palette — light + dark, from `crate::palette` (maritime/neobrutalism) ──
// One process-global mode (a single window), flipped by `Ctrl-A g`. `current_theme()`
// is a captureless fn so it drops into every `rgb(...)` site — including hover/click
// closures, which then re-read the live theme — with no borrow/lifetime threading.
// 0 = light, 1 = dark (default = the shipped look).
static THEME_MODE: AtomicU8 = AtomicU8::new(1);
// 0 = full motion, 1 = reduced motion. The visible chrome control can change
// this at runtime; the environment variable only seeds the starting value.
static MOTION_MODE: AtomicU8 = AtomicU8::new(0);

pub(crate) fn current_theme() -> Theme {
    let mode = if THEME_MODE.load(Ordering::Relaxed) == 0 {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    };
    Theme::for_mode(mode)
}

/// Flip light ⇄ dark (the `Ctrl-A g` leader command). Re-skins on next `cx.notify()`.
fn toggle_theme() {
    let next = if THEME_MODE.load(Ordering::Relaxed) == 0 {
        1
    } else {
        0
    };
    THEME_MODE.store(next, Ordering::Relaxed);
    crate::audio::play(crate::audio::Cue::Toggle);
}

fn reduced_motion() -> bool {
    MOTION_MODE.load(Ordering::Relaxed) == 1
}

fn toggle_motion() {
    let next = if reduced_motion() { 0 } else { 1 };
    MOTION_MODE.store(next, Ordering::Relaxed);
    crate::audio::play(crate::audio::Cue::Toggle);
}

/// `PD_CONSOLE_NO_SPLASH` opt-out — suppresses the launch splash entirely.
/// Read once (env is fixed for the process); the render gate consults this.
fn splash_disabled() -> bool {
    static V: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *V.get_or_init(|| std::env::var("PD_CONSOLE_NO_SPLASH").is_ok())
}

#[derive(Clone, Copy)]
struct SplashBrandPalette {
    cobalt: u32,
    seafoam: u32,
    amber: u32,
    grid: u32,
}

fn splash_brand_palette(mode: ThemeMode) -> SplashBrandPalette {
    match mode {
        ThemeMode::Light => SplashBrandPalette {
            cobalt: 0x2076fe,
            seafoam: 0x12b88f,
            amber: 0xf5a623,
            grid: 0xdce3eb,
        },
        ThemeMode::Dark => SplashBrandPalette {
            cobalt: 0x2076fe,
            seafoam: 0x20deb0,
            amber: 0xffb505,
            grid: 0x243247,
        },
    }
}

fn splash_flip_turn(delta: f32) -> f32 {
    let delta = delta.clamp(0.0, 1.0);
    if delta < 0.15 {
        0.0
    } else if delta < 0.45 {
        0.5 * ease_in_out((delta - 0.15) / 0.30)
    } else if delta < 0.65 {
        0.5
    } else if delta < 0.85 {
        0.5 + 0.5 * ease_in_out((delta - 0.65) / 0.20)
    } else {
        1.0
    }
}

fn splash_static_layer(path: &'static str, color: u32) -> Svg {
    svg()
        .path(path)
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .text_color(rgb(color))
}

fn splash_spin_layer(
    path: &'static str,
    color: u32,
    id: &'static str,
    duration_ms: u64,
    reverse: bool,
) -> AnyElement {
    let layer = splash_static_layer(path, color);
    if reduced_motion() {
        return layer.into_any_element();
    }
    let direction = if reverse { -1.0 } else { 1.0 };
    layer
        .with_animation(
            id,
            Animation::new(Duration::from_millis(duration_ms)).repeat(),
            move |layer, delta| {
                layer.with_transformation(Transformation::rotate(radians(
                    std::f32::consts::TAU * delta * direction,
                )))
            },
        )
        .into_any_element()
}

fn splash_flip_layer(path: &'static str, color: u32, id: &'static str) -> AnyElement {
    let layer = splash_static_layer(path, color);
    if reduced_motion() {
        return layer.into_any_element();
    }
    layer
        .with_animation(
            id,
            Animation::new(Duration::from_millis(6000)).repeat(),
            |layer, delta| {
                layer.with_transformation(Transformation::rotate(radians(
                    std::f32::consts::TAU * splash_flip_turn(delta),
                )))
            },
        )
        .into_any_element()
}

fn render_splash_mark(brand: SplashBrandPalette) -> AnyElement {
    div()
        .relative()
        .w(px(140.0))
        .h(px(140.0))
        .child(splash_static_layer(
            "icons/pd-splash-radar-grid.svg",
            brand.grid,
        ))
        .child(splash_spin_layer(
            "icons/pd-splash-radar-slow.svg",
            brand.seafoam,
            "pd-splash-radar-slow",
            10000,
            false,
        ))
        .child(splash_spin_layer(
            "icons/pd-splash-radar-mid.svg",
            brand.amber,
            "pd-splash-radar-mid",
            7000,
            true,
        ))
        .child(splash_spin_layer(
            "icons/pd-splash-radar-fast.svg",
            brand.cobalt,
            "pd-splash-radar-fast",
            5000,
            false,
        ))
        .child(splash_flip_layer(
            "icons/pd-splash-glyph-p.svg",
            brand.cobalt,
            "pd-splash-glyph-p",
        ))
        .child(splash_flip_layer(
            "icons/pd-splash-glyph-d.svg",
            brand.seafoam,
            "pd-splash-glyph-d",
        ))
        .child(splash_flip_layer(
            "icons/pd-splash-glyph-overlap.svg",
            brand.amber,
            "pd-splash-glyph-overlap",
        ))
        .child(splash_static_layer("icons/pd-splash-hub.svg", brand.cobalt))
        .into_any_element()
}

/// Seed the starting palette from `PD_CONSOLE_THEME` (`light` | `dark`); default dark.
/// Call once at startup before the window opens.
pub fn init_theme_from_env() {
    if let Ok(v) = std::env::var("PD_CONSOLE_THEME") {
        if v.eq_ignore_ascii_case("light") {
            THEME_MODE.store(0, Ordering::Relaxed);
        } else if v.eq_ignore_ascii_case("dark") {
            THEME_MODE.store(1, Ordering::Relaxed);
        }
    }
}

/// Seed reduced motion from `PD_CONSOLE_REDUCED_MOTION`; the title deck exposes
/// the same preference as a visible runtime control, so operators are not sent
/// to an environment file for routine presentation settings.
pub fn init_motion_from_env() {
    let reduced = std::env::var("PD_CONSOLE_REDUCED_MOTION")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    MOTION_MODE.store(u8::from(reduced), Ordering::Relaxed);
}

fn tone_rgb(tone: &Tone) -> u32 {
    current_theme().tone(tone)
}

// ── Motion — gpui 0.2.2 has no fluent transform, so "lift/glow/spring" reads
// through hover color + box-shadow (instant, GPU-cheap) and with_animation
// one-shot/looping timelines. Curves match the mock's bezier set. ≤500ms.
pub(crate) mod motion {
    use gpui::{point, px, BoxShadow, Hsla};

    pub const RISE_MS: u64 = 500;

    /// `--swoosh`: graceful fast-out settle (≈ quintic ease-out).
    pub fn swoosh(t: f32) -> f32 {
        1.0 - (1.0 - t).powi(5)
    }

    /// A soft halo glow (focus ring / hover). Alpha rides on `Hsla`.
    pub fn glow(color: u32, alpha: f32, blur: f32, spread: f32) -> Vec<BoxShadow> {
        let mut h: Hsla = gpui::rgb(color).into();
        h.a = alpha;
        vec![BoxShadow {
            color: h,
            offset: point(px(0.0), px(0.0)),
            blur_radius: px(blur),
            spread_radius: px(spread),
        }]
    }

    /// Neobrutalist hard offset drop — the hover "lift" cue (no translate in 0.2.2).
    pub fn hard_offset(color: u32, dx: f32, dy: f32) -> Vec<BoxShadow> {
        let h: Hsla = gpui::rgb(color).into();
        vec![BoxShadow {
            color: h,
            offset: point(px(dx), px(dy)),
            blur_radius: px(0.0),
            spread_radius: px(0.0),
        }]
    }
}

// ── FileTree directory listing ───────────────────────────────────────────────

/// One row in the FileTree surface: a child of the listed directory.
#[derive(Debug, Clone)]
struct FileEntry {
    /// Display name (basename), with a trailing `/` for directories.
    name: String,
    /// Absolute path to open / descend into.
    path: String,
    is_dir: bool,
}

/// Resolve the FileTree root: an explicit `root`, else the current working
/// directory (the operator's repo). Returns the canonical-ish path string.
fn filetree_root(root: Option<&str>) -> String {
    match root {
        Some(r) if !r.is_empty() => r.to_string(),
        _ => std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| ".".into()),
    }
}

/// Read `root`'s immediate children: directories first (alpha), then files
/// (alpha). Hidden dotfiles are kept (a repo's `.github` etc. matter). Errors and
/// huge dirs are bounded so the surface can't wedge.
fn filetree_entries(root: Option<&str>) -> std::result::Result<Vec<FileEntry>, String> {
    let dir = filetree_root(root);
    let mut entries: Vec<FileEntry> = Vec::new();
    let read = std::fs::read_dir(&dir).map_err(|e| format!("{dir}: {e}"))?;
    for ent in read.flatten() {
        let path = ent.path();
        let is_dir = path.is_dir();
        let name = ent.file_name().to_string_lossy().into_owned();
        entries.push(FileEntry {
            name: if is_dir { format!("{name}/") } else { name },
            path: path.to_string_lossy().into_owned(),
            is_dir,
        });
        if entries.len() >= 1000 {
            break; // bound: never enumerate an absurd directory in the render path
        }
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// The FileTree surface as read-only `Block`s (the terminal face + the GPUI
/// fallback when not specially rendered). The interactive, clickable GPUI version
/// lives in `render_leaf`'s FileTree body.
fn filetree_blocks(root: Option<&str>) -> Vec<Block> {
    let dir = filetree_root(root);
    let mut blocks = vec![Block::Header(format!("files {dir}"))];
    match filetree_entries(root) {
        Err(e) => blocks.push(Block::KeyVal("error".into(), e)),
        Ok(entries) if entries.is_empty() => {
            blocks.push(Block::KeyVal("status".into(), "empty directory".into()));
        }
        Ok(entries) => {
            for e in entries {
                blocks.push(Block::Row(vec![
                    if e.is_dir { "▸".into() } else { " ".into() },
                    e.name,
                ]));
            }
        }
    }
    blocks
}

// ── Block renderer ───────────────────────────────────────────────────────────

/// Per-frame pole movement that drives the flag wave (the model headlessly
/// recorded in `core/pd-flag-proto`). A flag's fly edge trails OPPOSITE the pole
/// velocity — scroll down → cloth trails up; resize/pan right → cloth trails
/// left — and `phase` only advances while moving, so a still flag does not
/// animate (zero idle re-render). `Copy` so a snapshot rides into `render_block`.
#[derive(Clone, Copy, Default)]
pub struct FlagMotion {
    pub vx: f32, // horizontal pole velocity (resize / pane-move); + = rightward
    pub vy: f32, // vertical pole velocity (scroll); + = downward
    pub phase: f32,
}

fn smoothstep(u: f32) -> f32 {
    u * u * (3.0 - 2.0 * u)
}

/// Scale a packed 0xRRGGBB color by a brightness factor (cloth fold shading).
fn scale_rgb(c: u32, f: f32) -> u32 {
    let f = f.clamp(0.0, 1.4);
    let r = ((((c >> 16) & 0xff) as f32) * f).min(255.0) as u32;
    let g = ((((c >> 8) & 0xff) as f32) * f).min(255.0) as u32;
    let b = (((c & 0xff) as f32) * f).min(255.0) as u32;
    (r << 16) | (g << 8) | b
}

/// A small waving signal flag drawn as shaded cloth strips via gpui's T2 paint
/// API (`canvas` + `PathBuilder` + `paint_path`), driven by `FlagMotion`. The
/// letter rides centered on top. Replaces the old flat badge in `Block::Flag`.
#[derive(IntoElement)]
struct WavingFlag {
    letter: char,
    color: u32,
    motion: FlagMotion,
}

impl RenderOnce for WavingFlag {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        const W: f32 = 26.0;
        const H: f32 = 18.0;
        const STRIPS: usize = 10;
        const LEAN: f32 = 0.40; // fly-edge trail per unit velocity
        const IDLE_DROOP: f32 = 0.12; // gentle hang at rest
        const RIPPLE_GAIN: f32 = 0.42; // ripple amplitude per unit speed
        const RIPPLE_WAVES: f32 = 1.5;

        let FlagMotion { vx, vy, phase } = self.motion;
        let base = self.color;
        let letter = self.letter;
        let speed = (vx * vx + vy * vy).sqrt().min(1.6);

        div()
            .relative()
            .w(px(W))
            .h(px(H))
            .child(
                canvas(
                    |_bounds, _window, _cx| (),
                    move |bounds, _prepaint, window, _cx| {
                        let ox = f32::from(bounds.origin.x);
                        let oy = f32::from(bounds.origin.y);
                        let bw = f32::from(bounds.size.width);
                        let bh = f32::from(bounds.size.height);
                        // Inset the cloth so droop/ripple stay inside the badge.
                        let ft = oy + 0.14 * bh;
                        let fh = 0.60 * bh;
                        let two_pi = std::f32::consts::TAU;
                        let dx = |u: f32| smoothstep(u) * (-vx) * LEAN * bw;
                        let dy = |u: f32| {
                            smoothstep(u) * (-vy) * LEAN * fh
                                + IDLE_DROOP * fh * u * u
                                + RIPPLE_GAIN
                                    * fh
                                    * speed
                                    * u
                                    * (two_pi * RIPPLE_WAVES * u - phase).sin()
                        };
                        for j in 0..STRIPS {
                            let u0 = j as f32 / STRIPS as f32;
                            let u1 = (j + 1) as f32 / STRIPS as f32;
                            let x0 = ox + u0 * bw + dx(u0);
                            let x1 = ox + u1 * bw + dx(u1);
                            let d0 = dy(u0);
                            let d1 = dy(u1);
                            let um = 0.5 * (u0 + u1);
                            let fold = (two_pi * RIPPLE_WAVES * um - phase).cos();
                            let light = 0.82 + 0.34 * fold * (speed / 1.6) + 0.06 * um;
                            let mut pb = PathBuilder::fill();
                            pb.move_to(point(px(x0), px(ft + d0)));
                            pb.line_to(point(px(x1), px(ft + d1)));
                            pb.line_to(point(px(x1), px(ft + fh + d1)));
                            pb.line_to(point(px(x0), px(ft + fh + d0)));
                            pb.close();
                            if let Ok(path) = pb.build() {
                                window.paint_path(path, rgb(scale_rgb(base, light)));
                            }
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
            .child(
                div()
                    .absolute()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(rgb(0x0d141f))
                    .text_size(px(10.0))
                    .font_weight(FontWeight::BOLD)
                    .child(letter.to_string()),
            )
    }
}

/// The Harbor editor's code surface: ONE `uniform_list` over pre-tokenized
/// lines — only the visible window is painted, scroll state rides `scroll`.
/// This replaces the per-line `Block::Row` card path (border + rounding +
/// margins + hover per line — the "every line is a button" bug).
#[derive(Clone, Default)]
struct EditorPaintState {
    caret: Option<(u32, usize)>,
    selection: BTreeMap<u32, std::ops::Range<usize>>,
    marked: BTreeMap<u32, std::ops::Range<usize>>,
}

fn paint_ranges_for_text(
    text: &str,
    range: std::ops::Range<usize>,
) -> BTreeMap<u32, std::ops::Range<usize>> {
    let mut result = BTreeMap::new();
    if range.is_empty() {
        return result;
    }
    let mut line_start = 0usize;
    for (index, raw) in text.split_inclusive('\n').enumerate() {
        let content_len = raw.strip_suffix('\n').map_or(raw.len(), str::len);
        let content_end = line_start + content_len;
        let start = range.start.max(line_start).min(content_end);
        let end = range.end.max(line_start).min(content_end);
        if start < end {
            result.insert((index + 1) as u32, start - line_start..end - line_start);
        }
        line_start += raw.len();
        if line_start >= range.end {
            break;
        }
    }
    result
}

fn editor_paint_state(input: &EditorInput, text: &str) -> EditorPaintState {
    let selection = input.selection();
    let caret = selection.is_empty().then(|| {
        let byte = input.cursor().min(text.len());
        let line_start = text[..byte].rfind('\n').map_or(0, |ix| ix + 1);
        let line = text[..byte].bytes().filter(|b| *b == b'\n').count() as u32 + 1;
        (line, byte - line_start)
    });
    EditorPaintState {
        caret,
        selection: paint_ranges_for_text(text, selection),
        marked: input
            .marked_range()
            .map(|range| paint_ranges_for_text(text, range))
            .unwrap_or_default(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EditorVisualRow {
    line_index: usize,
    range: std::ops::Range<usize>,
    continuation: bool,
    final_segment: bool,
}

fn editor_visual_rows(
    lines: &[crate::pane::CodeLine],
    wrap_columns: Option<usize>,
) -> std::sync::Arc<[EditorVisualRow]> {
    let mut rows = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let ranges = wrap_columns
            .map(|columns| wrap_byte_ranges(&line.text, columns))
            .unwrap_or_else(|| vec![0..line.text.len()]);
        let final_index = ranges.len().saturating_sub(1);
        rows.extend(
            ranges
                .into_iter()
                .enumerate()
                .map(|(segment, range)| EditorVisualRow {
                    line_index,
                    range,
                    continuation: segment > 0,
                    final_segment: segment == final_index,
                }),
        );
    }
    rows.into()
}

fn render_code_buffer(
    pane_id: PaneId,
    lines: std::sync::Arc<[crate::pane::CodeLine]>,
    gutter_cols: u8,
    bands: Vec<crate::pane::CodeBand>,
    scroll: Option<UniformListScrollHandle>,
    input: Option<EditorPaintState>,
    options: Option<&EditorRenderOptions>,
) -> AnyElement {
    let t = current_theme();
    let show_blame = options.is_some_and(|options| options.show_blame);
    let blame = options.and_then(|options| options.blame.clone());
    let wrap_columns = options
        .filter(|options| options.wrap_lines)
        .and_then(|options| options.viewport_width)
        .map(|width| editor_wrap_columns(width, gutter_cols as f32, show_blame));
    let rows = editor_visual_rows(&lines, wrap_columns);
    let count = rows.len();
    let list = uniform_list(
        SharedString::from(format!("code-{pane_id}")),
        count,
        move |range: std::ops::Range<usize>, _window, _cx| {
            range
                .map(|ix| {
                    let row = &rows[ix];
                    let line = &lines[row.line_index];
                    let blame_line = blame
                        .as_deref()
                        .and_then(|lines| lines.get(line.number.saturating_sub(1) as usize));
                    render_code_segment(
                        line,
                        row,
                        gutter_cols,
                        &bands,
                        input.as_ref(),
                        blame_line,
                        show_blame,
                    )
                })
                .collect::<Vec<_>>()
        },
    )
    .size_full();
    let list = match scroll {
        Some(handle) => list.track_scroll(handle),
        None => list,
    };
    div()
        .size_full()
        .bg(rgb(t.sunken))
        .font_family("IBM Plex Mono")
        .text_size(px(tokens::TEXT_BODY))
        .text_color(rgb(t.ink2))
        .child(list)
        .into_any_element()
}

/// One code line: fixed height, NO margin/border/rounding/hover — a thin
/// always-reserved band rail, a line-number gutter, an optional author tag,
/// and the text as ONE shaped element with per-run syntax highlights (the
/// batched-runs technique — never a div per token). Claim/wedge bands paint
/// as a full-width background wash BEHIND the text; adjacent banded lines
/// merge into one continuous band because lines have zero vertical gap.
fn render_code_line(
    line: &crate::pane::CodeLine,
    gutter_cols: u8,
    bands: &[crate::pane::CodeBand],
    input: Option<&EditorPaintState>,
) -> AnyElement {
    let row = EditorVisualRow {
        line_index: line.number.saturating_sub(1) as usize,
        range: 0..line.text.len(),
        continuation: false,
        final_segment: true,
    };
    render_code_segment(line, &row, gutter_cols, bands, input, None, false)
}

fn render_code_segment(
    line: &crate::pane::CodeLine,
    row: &EditorVisualRow,
    gutter_cols: u8,
    bands: &[crate::pane::CodeBand],
    input: Option<&EditorPaintState>,
    blame: Option<&crate::git_blame::BlameLine>,
    show_blame: bool,
) -> AnyElement {
    let t = current_theme();
    // Last covering band wins (the pane pushes the conflict wedge last).
    let band = bands.iter().rev().find(|b| b.covers(line.number));
    let num = if row.continuation {
        format!("{:>width$}", "↳", width = gutter_cols as usize)
    } else {
        format!("{:>width$}", line.number, width = gutter_cols as usize)
    };

    // Per-run color highlights over one text element; Plain runs inherit the
    // container's ink2 so only colored spans carry a HighlightStyle.
    let mut highlights: Vec<(std::ops::Range<usize>, HighlightStyle)> = Vec::new();
    let text_len = line.text.len();
    let mut at = 0usize;
    for (len, kind) in &line.runs {
        let start = at.min(text_len);
        let end = at.saturating_add(*len as usize).min(text_len);
        let visible_start = start.max(row.range.start);
        let visible_end = end.min(row.range.end);
        if !matches!(kind, crate::pane::SyntaxKind::Plain) && visible_start < visible_end {
            highlights.push((
                visible_start - row.range.start..visible_end - row.range.start,
                HighlightStyle {
                    color: Some(rgb(t.syntax(*kind)).into()),
                    ..Default::default()
                },
            ));
        }
        at = end;
        if at >= text_len {
            break;
        }
    }
    if let Some(range) = input.and_then(|state| state.selection.get(&line.number)) {
        let start = range.start.max(row.range.start);
        let end = range.end.min(row.range.end);
        if start < end {
            highlights.push((
                start - row.range.start..end - row.range.start,
                HighlightStyle {
                    background_color: Some(tone_wash(t.accent, 0x55).into()),
                    ..Default::default()
                },
            ));
        }
    }
    if let Some(range) = input.and_then(|state| state.marked.get(&line.number)) {
        let start = range.start.max(row.range.start);
        let end = range.end.min(row.range.end);
        if start < end {
            highlights.push((
                start - row.range.start..end - row.range.start,
                HighlightStyle {
                    underline: Some(UnderlineStyle {
                        color: Some(rgb(t.accent_ink).into()),
                        thickness: px(1.0),
                        wavy: false,
                    }),
                    ..Default::default()
                },
            ));
        }
    }
    let author_tag = (!row.continuation)
        .then(|| line.author_tag.clone())
        .flatten();
    let caret_col = input
        .and_then(|state| state.caret)
        .filter(|(number, _)| *number == line.number)
        .and_then(|(_, byte)| {
            let in_segment = byte >= row.range.start
                && (byte < row.range.end || (row.final_segment && byte == row.range.end));
            in_segment.then(|| {
                line.text[row.range.start..byte.min(row.range.end)]
                    .graphemes(true)
                    .count()
            })
        });
    let text = line.text[row.range.clone()].to_string();
    let blame_label = (!row.continuation)
        .then(|| blame.map(compact_blame_label))
        .flatten();

    div()
        .h(px(tokens::CODE_LINE_H))
        .w_full()
        .flex()
        .items_center()
        .when_some(band, |d, b| d.bg(tone_wash(t.tone(&b.tone), 0x2b)))
        // 2px band rail — ALWAYS reserved so text never shifts when a band
        // appears; colored only under a band.
        .child(
            div()
                .w(px(2.0))
                .h_full()
                .flex_shrink_0()
                .when_some(band, |d, b| d.bg(rgb(t.tone(&b.tone)))),
        )
        // Line number — always present, muted, right-aligned by mono padding.
        .child(
            div()
                .pl(px(6.0))
                .pr(px(8.0))
                .flex_shrink_0()
                .text_color(rgb(t.muted))
                .child(num),
        )
        // Author column — ALWAYS visible (per-line authorship is the Harbor
        // editor's point): a tight monospace tag, toned by author — operator
        // lines subtle (Resting), agent lines distinct (Engaged).
        .child(
            div()
                .w(px(2.0 * tokens::CODE_CH + 6.0))
                .flex_shrink_0()
                .text_color(rgb(t.tone(&line.author_tone)))
                .when_some(author_tag, |d, tag| d.child(SharedString::new(tag))),
        )
        .when(show_blame, |line_row| {
            line_row.child(
                div()
                    .w(px(BLAME_COL_CHARS * tokens::CODE_CH + 8.0))
                    .pr(px(8.0))
                    .flex_shrink_0()
                    .overflow_hidden()
                    .text_color(rgb(t.muted))
                    .when_some(blame_label, |d, label| d.child(label)),
            )
        })
        .child(
            div()
                .relative()
                .h_full()
                .flex_1()
                .flex()
                .items_center()
                .child(StyledText::new(SharedString::new(text)).with_highlights(highlights))
                .when_some(caret_col, |d, column| {
                    d.child(
                        div()
                            .absolute()
                            .left(px(column as f32 * tokens::CODE_CH))
                            .top(px(2.0))
                            .bottom(px(2.0))
                            .w(px(1.5))
                            .bg(rgb(t.accent_ink)),
                    )
                }),
        )
        .into_any_element()
}

fn compact_blame_label(blame: &crate::git_blame::BlameLine) -> String {
    if blame.is_working_tree() {
        return "working tree"
            .graphemes(true)
            .take(BLAME_COL_CHARS as usize)
            .collect();
    }
    let author = blame
        .author
        .split_whitespace()
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("unknown");
    let label = format!("{} · {author}", blame.short_commit());
    label
        .graphemes(true)
        .take(BLAME_COL_CHARS as usize)
        .collect()
}

pub(crate) fn render_block(block: Block, motion: FlagMotion) -> impl IntoElement {
    let t = current_theme();
    match block {
        // Fallback for a CodeBuffer landing on a generic (non-editor) surface:
        // a plain tight stack, capped so an unvirtualized context can't wedge.
        // The editor surface never takes this path — render_leaf routes its
        // CodeBuffer through render_code_buffer (uniform_list).
        Block::CodeBuffer {
            lines,
            gutter_cols,
            bands,
            ..
        } => div()
            .flex()
            .flex_col()
            .font_family("IBM Plex Mono")
            .text_size(px(tokens::TEXT_BODY))
            .text_color(rgb(t.ink2))
            .bg(rgb(t.sunken))
            .children(
                lines
                    .iter()
                    .take(500)
                    .map(|line| render_code_line(line, gutter_cols, &bands, None)),
            )
            .into_any_element(),
        Block::Header(text) => div()
            .mx(px(16.0))
            .mt(px(12.0))
            .h(px(38.0))
            .flex()
            .items_center()
            .border_b_1()
            .border_color(rgb(t.line))
            .child(
                div()
                    .font_family("IBM Plex Mono")
                    .text_color(rgb(t.muted))
                    .text_size(px(12.0))
                    .font_weight(FontWeight::BOLD)
                    .child(text.to_ascii_uppercase()),
            )
            .into_any_element(),
        Block::KeyVal(key, val) => {
            if key == "active" {
                div()
                    .h(px(62.0))
                    .mx(px(16.0))
                    .flex()
                    .border_b_1()
                    .border_color(rgb(t.line))
                    .child(
                        div()
                            .flex_1()
                            .px(px(14.0))
                            .flex()
                            .items_center()
                            .bg(rgb(t.raised))
                            .text_color(rgb(t.ink2))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::BOLD)
                            .child("ACTIVE / CONFIRMED"),
                    )
                    .child(
                        div()
                            .w(px(112.0))
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(rgb(t.engaged))
                            .text_color(rgb(knockout_ink(t.engaged)))
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .child(val),
                    )
                    .into_any_element()
            } else {
                div()
                    .flex()
                    .items_center()
                    .h(px(38.0))
                    .mx(px(16.0))
                    .border_b_1()
                    .border_color(rgb(t.line))
                    .bg(rgb(t.panel))
                    .hover(|s| {
                        let t = current_theme();
                        s.bg(rgb(t.raised))
                    })
                    .child(div().w(px(2.0)).h_full().flex_shrink_0().bg(rgb(t.line2)))
                    .child(
                        div()
                            .ml(px(11.0))
                            .text_color(rgb(t.muted))
                            .text_size(px(11.0))
                            .font_family("IBM Plex Mono")
                            .w(px(150.0))
                            .flex_shrink_0()
                            .child(key.to_ascii_uppercase()),
                    )
                    .child(
                        div()
                            .text_color(rgb(t.ink))
                            .text_size(px(tokens::TEXT_BODY))
                            .font_family("IBM Plex Mono")
                            .child(val),
                    )
                    .into_any_element()
            }
        }
        Block::Row(cells) => div()
            .flex()
            .items_center()
            .gap(px(12.0))
            .mx(px(16.0))
            .min_h(px(48.0))
            .border_b_1()
            .border_color(rgb(t.line))
            .bg(rgb(t.panel))
            .hover(|s| {
                let t = current_theme();
                s.bg(rgb(t.raised))
            })
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .child(div().w(px(9.0)).h(px(18.0)).bg(rgb(t.accent)))
                    .child(div().w(px(9.0)).h(px(18.0)).bg(rgb(t.engaged))),
            )
            .children(cells.into_iter().enumerate().map(|(i, cell)| {
                div()
                    .text_color(rgb(if i == 0 {
                        current_theme().ink
                    } else {
                        current_theme().ink2
                    }))
                    .text_size(px(tokens::TEXT_BODY))
                    .font_family("IBM Plex Mono")
                    .flex_shrink_0()
                    .when(i == 0, |s| s.min_w(px(22.0)).font_weight(FontWeight::BOLD))
                    .child(cell)
            }))
            .into_any_element(),
        Block::ChatTurn {
            speaker,
            text,
            tone,
        } => {
            let color_u32 = tone_rgb(&tone);
            let mine = matches!(
                speaker.trim().to_ascii_lowercase().as_str(),
                "you" | "operator"
            );
            let label = if speaker.trim().is_empty() {
                "agent".to_string()
            } else {
                chat_display_text(&speaker)
            };
            let body = chat_display_text(&text);
            let bubble = div()
                .max_w(px(680.0))
                .flex()
                .overflow_hidden()
                .border_1()
                .border_color(rgb(if mine { t.accent } else { t.line }))
                .bg(rgb(if mine { t.raised } else { t.panel }))
                .when(!mine, |b| {
                    b.child(div().w(px(4.0)).flex_shrink_0().bg(rgb(color_u32)))
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(tokens::SPACE_1))
                        .px(px(tokens::SPACE_3))
                        .py(px(tokens::SPACE_2))
                        .child(
                            div()
                                .text_color(rgb(if mine { t.accent_ink } else { color_u32 }))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(label),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink))
                                .text_size(px(tokens::TEXT_BODY))
                                .whitespace_normal()
                                .child(body),
                        ),
                );
            let row = div()
                .w_full()
                .flex()
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_1));
            if mine {
                row.child(div().flex_1()).child(bubble).into_any_element()
            } else {
                row.child(bubble).child(div().flex_1()).into_any_element()
            }
        }
        Block::TranscriptLine { text, tone } => {
            let color_u32 = tone_rgb(&tone);
            div()
                .flex()
                .items_start()
                .gap(px(tokens::SPACE_2))
                .mx(px(tokens::SPACE_3))
                .my(px(1.0))
                .px(px(tokens::SPACE_2))
                .py(px(3.0))
                .child(
                    div()
                        .mt(px(6.0))
                        .w(px(6.0))
                        .h(px(6.0))
                        .rounded(px(3.0))
                        .bg(rgb(color_u32))
                        .flex_shrink_0(),
                )
                .child(
                    div()
                        .flex_1()
                        .text_color(rgb(t.ink))
                        .text_size(px(tokens::TEXT_BODY))
                        .child(text),
                )
                .into_any_element()
        }
        Block::ArtifactRef {
            label,
            path,
            preview,
            tone,
        } => {
            let color_u32 = tone_rgb(&tone);
            let preview = preview.unwrap_or_else(|| "open / preview in current worktree".into());
            div()
                .mx(px(tokens::SPACE_3))
                .my(px(2.0))
                .px(px(tokens::SPACE_2))
                .py(px(tokens::SPACE_2))
                .border_l_2()
                .border_color(rgb(color_u32))
                .bg(tone_wash(color_u32, 0x12))
                .flex()
                .items_start()
                .gap(px(tokens::SPACE_2))
                .child(
                    div()
                        .mt(px(1.0))
                        .text_color(rgb(color_u32))
                        .text_size(px(tokens::TEXT_BODY))
                        .font_weight(FontWeight::BOLD)
                        .child("▣"),
                )
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_w(px(0.0))
                        .flex_wrap()
                        .items_center()
                        .gap(px(tokens::SPACE_2))
                        .child(
                            div()
                                .bg(rgb(color_u32))
                                .px(px(tokens::SPACE_1))
                                .py(px(1.0))
                                .text_color(rgb(knockout_ink(color_u32)))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("ARTIFACT"),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink))
                                .text_size(px(tokens::TEXT_BODY))
                                .font_family("IBM Plex Mono")
                                .child(path),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink2))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .child(label),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.muted))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .child(preview),
                        ),
                )
                .into_any_element()
        }
        Block::ImageArtifact {
            label,
            path,
            preview,
            image_path,
            tone,
        } => {
            let color_u32 = tone_rgb(&tone);
            let preview = preview.unwrap_or_else(|| "screenshot evidence".into());
            let mut content = div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w(px(0.0))
                .gap(px(tokens::SPACE_2))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(tokens::SPACE_2))
                        .child(
                            div()
                                .bg(rgb(color_u32))
                                .px(px(tokens::SPACE_1))
                                .py(px(1.0))
                                .text_color(rgb(knockout_ink(color_u32)))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("SCREENSHOT"),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink))
                                .text_size(px(tokens::TEXT_BODY))
                                .font_family("IBM Plex Mono")
                                .child(path.clone()),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink2))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .child(label),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.muted))
                                .text_size(px(tokens::TEXT_CAPTION))
                                .child(preview),
                        ),
                );
            if let Some(image_path) = image_path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .map(std::path::PathBuf::from)
                .filter(|p| p.exists())
            {
                content = content.child(
                    div()
                        .w(px(280.0))
                        .max_w_full()
                        .h(px(156.0))
                        .border_1()
                        .border_color(rgb(t.line))
                        .bg(rgb(t.bg))
                        .overflow_hidden()
                        .child(
                            img(image_path)
                                .w_full()
                                .h_full()
                                .object_fit(ObjectFit::Contain),
                        ),
                );
            }
            div()
                .mx(px(tokens::SPACE_3))
                .my(px(2.0))
                .px(px(tokens::SPACE_2))
                .py(px(tokens::SPACE_2))
                .border_l_2()
                .border_color(rgb(color_u32))
                .bg(tone_wash(color_u32, 0x12))
                .flex()
                .items_start()
                .gap(px(tokens::SPACE_2))
                .child(
                    div()
                        .mt(px(1.0))
                        .text_color(rgb(color_u32))
                        .text_size(px(tokens::TEXT_BODY))
                        .font_weight(FontWeight::BOLD)
                        .child("▣"),
                )
                .child(content)
                .into_any_element()
        }
        Block::Chip { label, tone } => {
            let color_u32 = tone_rgb(&tone);
            let color = rgb(color_u32);
            div()
                .mx(px(tokens::SPACE_3))
                .my(px(tokens::SPACE_1))
                .px(px(8.0))
                .py(px(3.0))
                .bg(color)
                .text_color(rgb(knockout_ink(color_u32)))
                .font_family("IBM Plex Mono")
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::BOLD)
                .child(label)
                .into_any_element()
        }
        Block::Flag {
            letter,
            label,
            tone,
        } => {
            // The signal flag is now a waving cloth (WavingFlag, T2 paint) that
            // reacts to pane scroll/resize via `motion`; the letter rides it.
            let color = tone_rgb(&tone);
            let pair = match tone {
                Tone::Engaged => t.accent,
                Tone::Landed => t.engaged,
                Tone::Gated => t.conflict,
                Tone::Conflicted | Tone::Alarm => t.gated,
                Tone::Accent | Tone::Default | Tone::Resting => t.line2,
            };
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .mx(px(16.0))
                .min_h(px(50.0))
                .border_b_1()
                .border_color(rgb(t.line))
                .bg(rgb(t.panel))
                .hover(|s| {
                    let t = current_theme();
                    s.bg(rgb(t.raised))
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .child(WavingFlag {
                            letter,
                            color,
                            motion,
                        })
                        .child(div().w(px(8.0)).h(px(18.0)).bg(rgb(pair))),
                )
                .child(
                    div()
                        .text_color(rgb(t.ink))
                        .text_size(px(tokens::TEXT_BODY))
                        .font_weight(FontWeight::MEDIUM)
                        .child(label),
                )
                .into_any_element()
        }
        Block::Spark(_) => div()
            .mx(px(tokens::SPACE_3))
            .my(px(tokens::SPACE_1))
            .px(px(tokens::SPACE_3))
            .py(px(tokens::SPACE_2))
            .bg(rgb(t.sunken))
            .text_color(rgb(t.landed))
            .text_size(px(tokens::TEXT_HEADER))
            .font_family("IBM Plex Mono")
            .child("▁▂▃▄▅▆▇")
            .into_any_element(),
        Block::Gap => div().h(px(tokens::SPACE_2)).into_any_element(),
        Block::WrappedText { text, tone } => {
            // Full, wrapping, never-truncated — the operator reads it all.
            let color = tone_rgb(&tone);
            div()
                .mx(px(tokens::SPACE_3))
                .my(px(tokens::SPACE_1))
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .border_l_2()
                .border_color(rgb(color))
                .bg(tone_wash(color, 0x18))
                .text_color(rgb(color))
                .text_size(px(tokens::TEXT_BODY))
                .font_family("IBM Plex Mono")
                .child(text)
                .into_any_element()
        }
        // Interactive Harbor blocks are routed to their cx-aware renderers in
        // render_leaf (they need click listeners this free function can't
        // build). Reaching here means a non-Harbor surface emitted one; paint
        // a legible inert fallback rather than panicking.
        Block::NodeRow { name, meta, .. } => div()
            .mx(px(tokens::SPACE_3))
            .my(px(2.0))
            .text_color(rgb(t.ink))
            .text_size(px(tokens::TEXT_BODY))
            .child(format!("{name} — {meta}"))
            .into_any_element(),
        Block::ControlButton {
            label,
            enabled,
            why_disabled,
            ..
        } => div()
            .mx(px(tokens::SPACE_3))
            .my(px(2.0))
            .text_color(rgb(t.muted))
            .text_size(px(tokens::TEXT_BODY))
            .child(if enabled {
                format!("[ {label} ]")
            } else {
                format!("( {label} ) {}", why_disabled.unwrap_or_default())
            })
            .into_any_element(),
    }
}

// ── Sidebar nav item (clickable) ──────────────────────────────────────────────

#[allow(dead_code)] // retained for the slice-3 surface picker; tree shell no longer uses the fixed sidebar
#[derive(IntoElement)]
struct SidebarItem {
    icon: &'static str,
    label: &'static str,
    index: usize,
    active: bool,
}

impl RenderOnce for SidebarItem {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let ink = if self.active {
            current_theme().ink
        } else {
            current_theme().muted
        };
        div()
            .px(px(10.0))
            .py(px(6.0))
            .mx(px(4.0))
            .my(px(1.0))
            .cursor_pointer()
            .when(self.active, |s| {
                s.bg(rgb(current_theme().raised))
                    .border_l_2()
                    .border_color(rgb(current_theme().accent_ink))
            })
            .hover(|s| s.bg(rgb(current_theme().raised)))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(3.0))
            .child(
                svg()
                    .path(self.icon)
                    .w(px(18.0))
                    .h(px(18.0))
                    .text_color(rgb(if self.active {
                        current_theme().accent_ink
                    } else {
                        current_theme().muted
                    })),
            )
            .child(
                div()
                    .text_color(rgb(ink))
                    .text_size(px(13.0))
                    .font_weight(FontWeight::MEDIUM)
                    .child(self.label),
            )
    }
}

// ── Main console view ─────────────────────────────────────────────────────────

pub struct ConsoleView {
    /// Named tabs — each an independent pane tree (like tmux windows). The
    /// active tab's workspace is what renders.
    tabs: Vec<Tab>,
    active_tab: usize,
    /// True after the leader key (Ctrl-A) is pressed; the next keystroke is a
    /// multiplexer command (split / close / focus / swap-surface) rather than
    /// passing through. Disarms after one command. tmux muscle-memory.
    leader_armed: bool,
    /// An open command line (kick-off-job / talk-to-cartographer). `Some` means
    /// keystrokes type into the buffer instead of acting as commands; Enter
    /// submits, Escape cancels.
    command: Option<CommandLine>,
    pane_blocks: Vec<Vec<Block>>,
    /// The producer's LIVE Harbor Editor blocks (P3 wire stage 2): `(bound_path,
    /// view())` folded from the background edit-sync + coordination lanes — presence
    /// cursors, region claims, and the wedge conflict/gate bands. `None` until an editor
    /// surface opens. `blocks_for_surface` prefers these (when the bound path matches)
    /// over a cold synchronous load, so the running window shows the LIVE wedge — not a
    /// static file re-read that never saw the collaboration lanes.
    editor_blocks: Option<(String, Vec<Block>)>,
    daemon_url: String,
    /// Provider→tier→model map, loaded from config (not compiled-in), so the
    /// Spawn picker resolves models that can change without a rebuild.
    /// Stable focus handle — created once and focused on open. Recreating it per
    /// render (the old `cx.focus_handle()` in render) meant nothing stayed
    /// focused, so the keyboard nav never received key events.
    focus_handle: FocusHandle,
    /// Channel to the background thread for operator mutations (Interrupt etc.).
    /// `None` when running without a control plane (e.g. an isolated test view).
    control_tx: Option<mpsc::Sender<ControlMsg>>,
    /// Transient confirmation shown after a control action ("interrupt sent").
    control_flash: Option<String>,
    /// The accumulated alert log (the HITL dead-letter queue): every captured
    /// action failure/outcome, newest first, bounded so an all-day session can't
    /// leak memory (Release It! steady state). The status bar shows the head;
    /// the HITL surface shows the full list untruncated.
    alerts: Vec<Alert>,
    /// Head-of-queue dispatch the review gate acts on (from the background refresh).
    dispatch_head: Option<DispatchHead>,
    /// HITL interruptions gate (contract §4): open-ask count, the blocking
    /// critical ask's title, known/unknown, and the web answer deep link.
    /// Drives the window-wide banner and the dispatch-gate refusal.
    hitl_gate: crate::interruptions::HitlGate,
    /// Dispatch id pending a reject reason (set when the operator opens the reject line).
    reject_target: Option<String>,
    /// In-flight pane-divider drag (grab-the-rope resize); `None` when idle.
    dragging: Option<DragState>,
    /// Laid-out bounds of each split container, keyed by tree path, captured via a
    /// canvas overlay so the drag handler can map a mouse position to a weight.
    split_bounds: Rc<RefCell<HashMap<Vec<usize>, Bounds<Pixels>>>>,
    /// Read-only visual projection of the daemon-owned WorkPlan. Empty daemon
    /// nodeSpecs stay empty; this state never manufactures a runnable plan.
    work_plan_graph: crate::work_plan::PredictedDag,
    /// Path to the rendered Vello PNG of `work_plan_graph`, shown INLINE at the top of
    /// the Work surface. `None` until a render lands (the surface shows a
    /// "rendering graph…" placeholder). Auto-refreshed whenever the DAG changes.
    work_graph_png_path: Option<std::path::PathBuf>,
    /// Durable WorkIntent identity from the latest daemon snapshot.
    work_intent_id: Option<String>,
    /// Current daemon-authored plan state, including honest unplanned/unknown states.
    work_plan_state: String,
    /// Trace handle returned by the Surface Gateway command receipt.
    work_correlation_id: Option<String>,
    /// Recovery/progression instruction returned by the daemon.
    work_next_action: Option<String>,
    /// Honest runtime state returned by WorkIntent.start. This is named as a
    /// compatibility execution projection until AgentRun ledger materialization
    /// lands; the GUI never upgrades it into a native AgentRun claim.
    work_execution_state: String,
    work_execution_id: Option<String>,
    work_execution_projection: Option<String>,
    work_execution_session: Option<String>,
    work_execution_worktree: Option<String>,
    /// The node the operator clicked in the live Work canvas — drives the
    /// inspector drawer (full role/contracts/why/model/cost). `None` ⇒ no drawer.
    work_selected_node: Option<String>,
    /// The pane launcher overlay — an animated grid of surface tiles. `Ctrl-A Space`
    /// (or the ⊞ button) opens it; clicking a tile swaps the focused pane's surface.
    launcher_open: bool,
    /// True once the first pane refresh has landed. Until then the launch splash
    /// (the brand boot flash) covers the chrome.
    booted: bool,
    /// Current `/health` reachability from the same refresh cycle that supplies
    /// pane truth. Kept separate from `booted` so stale chrome cannot claim a
    /// dead named daemon is connected.
    daemon_connected: bool,
    /// Pole movement driving the waving flags — scroll feeds `vy`, viewport-width
    /// change feeds `vx`; both decay to rest each frame (see WavingFlag / pd-flag-proto).
    flag_motion: FlagMotion,
    /// Last viewport width, to derive horizontal (resize/pan) velocity per frame.
    prev_viewport_w: f32,
    /// True while a flag-settle loop is scheduled (one at a time, idempotent kick).
    flag_ticking: bool,
    /// Operator chat transcript (bubbles) + a transient transport error. Folded by
    /// the background thread over the [`ChatUpdate`] bus; the pane renders it.
    chat: ChatLog,
    /// The chat composer's rolled-own text buffer — gpui 0.2.2 has no native input,
    /// so keydown pushes `key_char` here (case-preserving) the same way the command
    /// line does, and Enter submits a turn up the tube.
    chat_input: String,
    // ── Sextant state (rendered by `galaxy_canvas`; pub(crate) because
    // the bespoke canvas module reads them — the two-layer rule keeps all the
    // math in `galaxy_pane`, all the pixels there, and only state here). ──
    /// The latest map frame from the producer thread (points + clusters with
    /// daemon-precomputed normalized coords).
    pub(crate) galaxy: crate::galaxy_pane::GalaxySnapshot,
    /// Selected point ids (transcript ids). Click = select-one; ⌘-click toggles;
    /// a marquee drag unions. Pruned when points leave the map window.
    pub(crate) galaxy_selected: HashSet<String>,
    /// The point under the cursor (drives the fixed hover readout strip).
    pub(crate) galaxy_hover: Option<String>,
    /// Camera for the normalized Sextant world: edge padding, zoom, and pan.
    pub(crate) galaxy_viewport: crate::galaxy_pane::GalaxyViewport,
    /// In-flight rectangle select: (anchor, current) in WINDOW pixels. The root
    /// mouse handlers own the update/complete arms (divider-drag pattern).
    pub(crate) galaxy_drag: Option<(Point<Pixels>, Point<Pixels>)>,
    /// In-flight pan gesture: last pointer position in WINDOW pixels. Right or
    /// middle drag moves the map without colliding with left-drag marquee.
    pub(crate) galaxy_pan: Option<Point<Pixels>>,
    /// The map's laid-out bounds, captured by a canvas prepaint each frame (the
    /// split_bounds pattern; one frame stale is fine at the 500ms drain cadence)
    /// so drag/hover pixel positions convert to normalized map coords.
    pub(crate) galaxy_bounds: Rc<RefCell<Option<Bounds<Pixels>>>>,
    /// The clicked session's parsed detail (the drawer). `None` ⇒ closed.
    pub(crate) galaxy_detail: Option<crate::galaxy_pane::GalaxyDetail>,
    /// The daemon's real failure fetching a detail — shown in the drawer slot,
    /// never swallowed.
    pub(crate) galaxy_detail_error: Option<String>,
    /// Live Harbor-editor state, keyed by `editor_key(path, region)`. Created
    /// ONCE per opened file by `ensure_editor_states` (render top, `&mut self`)
    /// and read by `blocks_for_surface`. The OLD path constructed a fresh
    /// `EditorPane` inside every render — a `pd whoami` subprocess + a full
    /// disk read + a Loro doc build PER FRAME; this map is that fix.
    editors: HashMap<String, EditorSurfaceState>,
    /// Persistent native PTY terminal. The shell process outlives drawer
    /// visibility so closing and reopening never destroys operator context.
    shell: ShellTerminal,
    /// Whether the PTY surface is currently raised over the pane tree.
    shell_open: bool,
}

/// One opened editor surface: the persistent pane (buffer + claims + wedge)
/// and the `uniform_list` scroll handle its code view tracks.
struct EditorSurfaceState {
    pane: crate::editor_pane::EditorPane,
    scroll: UniformListScrollHandle,
    input: EditorInput,
    input_bounds: Option<Bounds<Pixels>>,
    wrap_lines: bool,
    show_blame: bool,
    blame: EditorBlameState,
    blame_rx: Option<mpsc::Receiver<std::result::Result<Vec<crate::git_blame::BlameLine>, String>>>,
}

#[derive(Clone)]
enum EditorBlameState {
    Off,
    Loading,
    Ready(std::sync::Arc<[crate::git_blame::BlameLine]>),
    Stale,
    Error(String),
}

#[derive(Clone)]
struct EditorRenderOptions {
    wrap_lines: bool,
    show_blame: bool,
    blame: Option<std::sync::Arc<[crate::git_blame::BlameLine]>>,
    blame_status: String,
    syntax_label: String,
    viewport_width: Option<f32>,
}

fn invalidate_editor_blame(state: &mut EditorSurfaceState) {
    if matches!(
        state.blame,
        EditorBlameState::Loading | EditorBlameState::Ready(_)
    ) {
        state.blame = EditorBlameState::Stale;
        state.blame_rx = None;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditorPlacement {
    ReplaceFocused,
    SplitRight,
}

/// Stable map key for an Editor surface binding.
fn editor_key(path: &str, region: Option<(u32, u32)>) -> String {
    match region {
        Some((s, e)) => format!("{path}:{s}-{e}"),
        None => path.to_string(),
    }
}

fn editor_surface_state(
    path: String,
    region: Option<(u32, u32)>,
    identity: String,
) -> EditorSurfaceState {
    let mut pane = crate::editor_pane::EditorPane::new_with_identity(path, region, identity);
    pane.load();
    // Demo seam (env-gated, never on by default): merge a second Loro replica's
    // lines into the opened buffer so the author column visibly differentiates
    // operator vs agent authorship. This exercises the real CRDT merge path on a
    // demo copy only; the file on disk is never written.
    if std::env::var("PD_CONSOLE_DEMO_AUTHORS").is_ok() {
        if let Some(buf) = pane.buffer() {
            let agent = crate::buffer::HarborBuffer::empty("port-daddy:editor:demo-agent");
            if agent.apply_remote_ops(&buf.export_ops()).is_ok() {
                agent.insert_authored(
                    0,
                    "// [agent replica] merged these two lines over the tube —\n// [agent replica] note the distinct author tag + tone in the gutter.\n",
                );
                let _ = buf.apply_remote_ops(&agent.export_ops());
            }
        }
    }
    EditorSurfaceState {
        pane,
        scroll: UniformListScrollHandle::new(),
        input: EditorInput::default(),
        input_bounds: None,
        wrap_lines: false,
        show_blame: false,
        blame: EditorBlameState::Off,
        blame_rx: None,
    }
}

/// Prepare the file completely before mutating the pane tree. A failed read
/// leaves both the workspace and editor cache untouched, which is the critical
/// navigation invariant for permission-denied files.
fn open_editor_transaction(
    workspace: &mut Workspace,
    editors: &mut HashMap<String, EditorSurfaceState>,
    path: String,
    region: Option<(u32, u32)>,
    identity: String,
    placement: EditorPlacement,
) -> std::result::Result<(), String> {
    let key = editor_key(&path, region);
    let ready = editors
        .get(&key)
        .is_some_and(|state| state.pane.buffer().is_some() && state.pane.load_error().is_none());
    if !ready {
        let candidate = editor_surface_state(path.clone(), region, identity);
        if let Some(reason) = candidate.pane.load_error() {
            return Err(format!(
                "Could not open {path}: {reason}. Your current view was kept."
            ));
        }
        editors.insert(key, candidate);
    }

    let surface = SurfaceKind::Editor { path, region };
    match placement {
        EditorPlacement::ReplaceFocused => workspace.swap_surface(surface),
        EditorPlacement::SplitRight => {
            workspace.split(Dir::Row, surface);
        }
    }
    Ok(())
}

fn editor_recovery_root(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.to_string_lossy().into_owned())
}

fn editor_error_from_blocks(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::KeyVal(key, value) if key == "error" => Some(value.clone()),
        _ => None,
    })
}

/// Collect every Editor surface binding under a pane-tree node.
fn collect_editor_surfaces(node: &Node, out: &mut Vec<(String, String, Option<(u32, u32)>)>) {
    match node {
        Node::Leaf {
            surface: SurfaceKind::Editor { path, region },
            ..
        } => {
            out.push((editor_key(path, *region), path.clone(), *region));
        }
        Node::Leaf { .. } => {}
        Node::Split { children, .. } => {
            for child in children {
                collect_editor_surfaces(&child.node, out);
            }
        }
    }
}

fn same_galaxy_snapshot(
    a: &crate::galaxy_pane::GalaxySnapshot,
    b: &crate::galaxy_pane::GalaxySnapshot,
) -> bool {
    a.computed_at == b.computed_at
        && a.last_error == b.last_error
        && a.window_hours == b.window_hours
        && a.cluster == b.cluster
        && a.points.len() == b.points.len()
        && a.clusters.len() == b.clusters.len()
        && a.points.iter().zip(&b.points).all(|(left, right)| {
            left.id == right.id
                && left.session_id == right.session_id
                && left.agent_id == right.agent_id
                && left.ship == right.ship
                && left.project == right.project
                && left.purpose == right.purpose
                && left.status == right.status
                && left.x == right.x
                && left.y == right.y
                && left.cluster_id == right.cluster_id
                && left.snippet == right.snippet
                && left.pr_number == right.pr_number
                && left.tail_tokens == right.tail_tokens
        })
        && a.clusters.iter().zip(&b.clusters).all(|(left, right)| {
            left.id == right.id
                && left.label == right.label
                && left.terms == right.terms
                && left.size == right.size
                && left.cx == right.cx
                && left.cy == right.cy
        })
}

impl ConsoleView {
    pub fn new(daemon_url: String, initial_pane: Option<String>, cx: &mut Context<Self>) -> Self {
        let cwd = crate::shell_drawer::default_cwd();
        let shell = ShellTerminal::disconnected(
            cwd,
            "CLI drawer is unavailable in this isolated console view.",
        );
        Self::with_control(daemon_url, initial_pane, None, shell, cx)
    }

    /// Advance the flag wave one frame and keep ticking until it settles.
    /// Driven by `cx.on_next_frame` — safe to schedule from anywhere, unlike
    /// `window.request_animation_frame()` which panics outside paint (it calls
    /// `current_view()`, whose entity stack is empty in an event handler).
    fn tick_flag_motion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if reduced_motion() {
            self.flag_motion.vx = 0.0;
            self.flag_motion.vy = 0.0;
            self.flag_ticking = false;
            cx.notify();
            return;
        }
        let speed = (self.flag_motion.vx.powi(2) + self.flag_motion.vy.powi(2)).sqrt();
        self.flag_motion.phase += speed * 0.9;
        self.flag_motion.vx *= 0.86;
        self.flag_motion.vy *= 0.86;
        let still_moving =
            (self.flag_motion.vx.powi(2) + self.flag_motion.vy.powi(2)).sqrt() > 0.012;
        if still_moving {
            cx.on_next_frame(window, |this, window, cx| this.tick_flag_motion(window, cx));
        } else {
            self.flag_motion.vx = 0.0;
            self.flag_motion.vy = 0.0;
            self.flag_ticking = false;
        }
        cx.notify();
    }

    /// Start the settle loop if it isn't already running (idempotent).
    fn kick_flag_motion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !reduced_motion() && !self.flag_ticking {
            self.flag_ticking = true;
            cx.on_next_frame(window, |this, window, cx| this.tick_flag_motion(window, cx));
        }
    }

    /// Construct with a control channel so the Lane's Interrupt button can reach
    /// the background thread that owns the surfaces.
    pub fn with_control(
        daemon_url: String,
        initial_pane: Option<String>,
        control_tx: Option<mpsc::Sender<ControlMsg>>,
        shell: ShellTerminal,
        cx: &mut Context<Self>,
    ) -> Self {
        // Initialize one slot per NAV entry with a "connecting…" placeholder
        let pane_blocks = NAV
            .iter()
            .map(|nav| {
                vec![
                    Block::Header(nav.label.into()),
                    Block::KeyVal("status".into(), "connecting…".into()),
                ]
            })
            .collect();

        Self {
            tabs: vec![Tab {
                name: "main".into(),
                workspace: Self::default_workspace(initial_pane.as_deref()),
                zoomed: None,
            }],
            active_tab: 0,
            leader_armed: false,
            command: None,
            pane_blocks,
            editor_blocks: None,
            daemon_url,
            focus_handle: cx.focus_handle(),
            control_tx,
            control_flash: None,
            alerts: Vec::new(),
            dispatch_head: None,
            hitl_gate: crate::interruptions::HitlGate::default(),
            reject_target: None,
            dragging: None,
            split_bounds: Rc::new(RefCell::new(HashMap::new())),
            work_plan_graph: crate::work_plan::empty_work_projection(),
            work_graph_png_path: None,
            work_intent_id: None,
            work_plan_state: "unplanned".into(),
            work_correlation_id: None,
            work_next_action: Some(
                "Submit a WorkIntent; the daemon owns planning, runtime admission, and body selection.".into(),
            ),
            work_execution_state: "not-started".into(),
            work_execution_id: None,
            work_execution_projection: None,
            work_execution_session: None,
            work_execution_worktree: None,
            work_selected_node: None,
            // Screenshot/demo hook (mirrors `--pane`): open the launcher on startup
            // so capture tooling can grab it without injecting a keystroke.
            launcher_open: std::env::var("PD_CONSOLE_OPEN_LAUNCHER").is_ok(),
            // Flipped true once the first pane refresh lands (see update_panes).
            // Splash suppression (screenshot hook + PD_CONSOLE_NO_SPLASH opt-out)
            // lives in render()'s gate, not here.
            booted: false,
            daemon_connected: false,
            flag_motion: FlagMotion::default(),
            prev_viewport_w: 0.0,
            flag_ticking: false,
            chat: ChatLog::default(),
            chat_input: String::new(),
            galaxy: crate::galaxy_pane::GalaxySnapshot::default(),
            galaxy_selected: HashSet::new(),
            galaxy_hover: None,
            galaxy_viewport: crate::galaxy_pane::GalaxyViewport::default(),
            galaxy_drag: None,
            galaxy_pan: None,
            galaxy_bounds: Rc::new(RefCell::new(None)),
            galaxy_detail: None,
            galaxy_detail_error: None,
            editors: HashMap::new(),
            shell,
            shell_open: std::env::var("PD_CONSOLE_OPEN_CLI").is_ok(),
        }
    }

    /// Ensure a persistent [`EditorSurfaceState`] exists for every Editor
    /// surface in every tab. Runs at the top of `render` (`&mut self`): opening
    /// a file costs one `pd whoami` + one disk read ONCE, and every later frame
    /// is a map lookup. States for closed files are retained (cheap, and they
    /// keep claims/wedge state alive across a reopen within the session).
    fn ensure_editor_states(&mut self) {
        // Collect first: walking the tree borrows self.tabs immutably.
        let mut wanted: Vec<(String, String, Option<(u32, u32)>)> = Vec::new();
        for tab in &self.tabs {
            collect_editor_surfaces(&tab.workspace.root, &mut wanted);
        }
        for (key, path, region) in wanted {
            if !self.editors.contains_key(&key) {
                let identity = crate::editor_pane::resolve_operator_identity();
                self.editors
                    .insert(key, editor_surface_state(path, region, identity));
            }
        }
        let mut blame_errors = Vec::new();
        for state in self.editors.values_mut() {
            let received = state.blame_rx.as_ref().map(mpsc::Receiver::try_recv);
            match received {
                Some(Ok(Ok(lines))) => {
                    state.blame = EditorBlameState::Ready(lines.into());
                    state.blame_rx = None;
                }
                Some(Ok(Err(reason))) => {
                    state.blame = EditorBlameState::Error(reason.clone());
                    state.blame_rx = None;
                    blame_errors.push(reason);
                }
                Some(Err(mpsc::TryRecvError::Disconnected)) => {
                    let reason = "Git blame worker stopped before returning a result".to_string();
                    state.blame = EditorBlameState::Error(reason.clone());
                    state.blame_rx = None;
                    blame_errors.push(reason);
                }
                Some(Err(mpsc::TryRecvError::Empty)) | None => {}
            }
        }
        if let Some(reason) = blame_errors.pop() {
            self.control_flash = Some(format!("Git blame unavailable: {reason}"));
        }
    }

    /// The opening layout: a fleet overview beside a stacked agent-lane /
    /// roadmap column — proof of multiplex on first launch. `initial` (if a
    /// known nav id) becomes the focused pane's surface.
    fn default_workspace(initial: Option<&str>) -> Workspace {
        // Resolve `--pane <id>` through the full surface resolver (NAV ids AND
        // non-NAV surfaces like `work`/`plan`/`chat`/`files`), so screenshot
        // tooling and deep-links can open any surface, not just NAV-rail panes.
        default_operator_workspace(initial.and_then(surface_for_query))
    }

    // ── Active-tab accessors ─────────────────────────────────────────────────
    fn ws(&self) -> &Workspace {
        &self.tabs[self.active_tab].workspace
    }
    fn ws_mut(&mut self) -> &mut Workspace {
        &mut self.tabs[self.active_tab].workspace
    }
    fn open_editor(
        &mut self,
        path: String,
        region: Option<(u32, u32)>,
        placement: EditorPlacement,
    ) -> std::result::Result<(), String> {
        let identity = crate::editor_pane::resolve_operator_identity();
        let active_tab = self.active_tab;
        open_editor_transaction(
            &mut self.tabs[active_tab].workspace,
            &mut self.editors,
            path.clone(),
            region,
            identity,
            placement,
        )?;
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::OpenEditor { path, region });
        }
        Ok(())
    }

    fn toggle_editor_wrap(&mut self, key: &str) -> bool {
        let Some(state) = self.editors.get_mut(key) else {
            return false;
        };
        state.wrap_lines = !state.wrap_lines;
        self.control_flash = Some(format!(
            "Editor line wrap {}",
            if state.wrap_lines { "on" } else { "off" }
        ));
        true
    }

    fn toggle_editor_blame(&mut self, key: &str) -> bool {
        let Some(state) = self.editors.get_mut(key) else {
            return false;
        };
        state.show_blame = !state.show_blame;
        if state.show_blame
            && matches!(
                state.blame,
                EditorBlameState::Off | EditorBlameState::Stale | EditorBlameState::Error(_)
            )
        {
            let path = std::path::PathBuf::from(state.pane.path_str());
            let contents = state.pane.text().unwrap_or_default();
            let (tx, rx) = mpsc::channel();
            state.blame = EditorBlameState::Loading;
            state.blame_rx = Some(rx);
            std::thread::spawn(move || {
                let _ = tx.send(crate::git_blame::load_with_contents(&path, &contents));
            });
        }
        self.control_flash = Some(format!(
            "Git blame {}",
            if state.show_blame { "on" } else { "off" }
        ));
        true
    }

    fn focused_failed_editor_path(&self) -> Option<String> {
        let SurfaceKind::Editor { path, region } = self.ws().focused_surface() else {
            return None;
        };
        let local_failed = self
            .editors
            .get(&editor_key(path, *region))
            .is_some_and(|state| state.pane.load_error().is_some());
        let live_failed = self
            .editor_blocks
            .as_ref()
            .is_some_and(|(live_path, blocks)| {
                live_path == path && editor_error_from_blocks(blocks).is_some()
            });
        (local_failed || live_failed).then(|| path.clone())
    }

    fn return_editor_to_files(&mut self, pane_id: PaneId, path: &str) {
        self.ws_mut().focus(pane_id);
        self.ws_mut().swap_surface(SurfaceKind::FileTree {
            root: editor_recovery_root(path),
        });
        self.control_flash = Some("Returned to Files. The unreadable file was not opened.".into());
    }

    fn recover_failed_editor(&mut self) -> bool {
        let Some(path) = self.focused_failed_editor_path() else {
            return false;
        };
        let pane_id = self.ws().focused();
        self.return_editor_to_files(pane_id, &path);
        true
    }
    fn zoomed(&self) -> Option<PaneId> {
        self.tabs[self.active_tab].zoomed
    }
    /// Toggle maximize on a pane within the active tab.
    fn toggle_zoom(&mut self, id: PaneId) {
        let t = &mut self.tabs[self.active_tab];
        t.zoomed = if t.zoomed == Some(id) { None } else { Some(id) };
    }
    /// Open a fresh tab and focus it.
    fn new_tab(&mut self) {
        let n = self.tabs.len() + 1;
        self.tabs.push(Tab {
            name: format!("tab {n}"),
            workspace: Workspace::new(SurfaceKind::Fleet),
            zoomed: None,
        });
        self.active_tab = self.tabs.len() - 1;
    }
    /// Close a tab (never the last one); keep the active index valid.
    fn close_tab(&mut self, idx: usize) {
        if self.tabs.len() <= 1 || idx >= self.tabs.len() {
            return;
        }
        self.tabs.remove(idx);
        if self.active_tab >= self.tabs.len() {
            self.active_tab = self.tabs.len() - 1;
        }
    }
    fn switch_tab(&mut self, delta: isize) {
        let n = self.tabs.len() as isize;
        self.active_tab = (((self.active_tab as isize + delta) % n + n) % n) as usize;
    }

    /// Map a surface to the blocks the background refresh thread has fetched
    /// for it. Existing live panels resolve through `pane_blocks`; surfaces
    /// without a backing fetcher yet render an honest placeholder.
    fn blocks_for_surface(&self, surface: &SurfaceKind) -> Vec<Block> {
        // The HITL surface is foreground-only — it reads the in-process alert log
        // (the DLQ), not a background-refreshed NAV pane. Render it untruncated.
        if matches!(surface, SurfaceKind::Hitl) {
            return self.blocks_for_hitl();
        }
        // Operator chat is foreground-only too — it reads the in-process transcript
        // (the GPUI shell renders bespoke bubbles, but the terminal face + tests
        // read these render-agnostic blocks from the same model).
        if matches!(surface, SurfaceKind::CartographerChat) {
            return self.chat.blocks();
        }
        // Work is foreground-owned but projects only daemon snapshots received
        // over the dedicated Work bus.
        if matches!(surface, SurfaceKind::Work) {
            return crate::work_plan::blocks_for_work(&self.work_plan_graph);
        }
        // The Harbor Editor surface reads its PERSISTENT pane (buffer + claims
        // + wedge), created once by `ensure_editor_states`. view() on an
        // unchanged buffer is an Arc refcount bump (see EditorPane::code_snapshot)
        // — the old path built a fresh EditorPane (a `pd whoami` subprocess + a
        // full disk read + a Loro doc) inside EVERY render.
        if let SurfaceKind::Editor { path, region } = surface {
            // WIRE STAGE 2 — prefer the producer's LIVE editor pane: the background lane
            // folds presence cursors, region claims, and wedge conflict/gate bands into
            // it, and pushes its `view()` here on each edge. Use it only when its bound
            // path matches this surface (guards a mid-rebind race to another file). When
            // no live snapshot has landed yet — or it's for a different file — fall back
            // to the persistent `self.editors` state (opened once by
            // `ensure_editor_states`) so the surface still renders honestly.
            if let Some((live_path, blocks)) = &self.editor_blocks {
                if live_path == path {
                    return blocks.clone();
                }
            }
            return match self.editors.get(&editor_key(path, *region)) {
                Some(state) => state.pane.view(),
                // First frame before ensure_editor_states ran (shouldn't happen
                // — render calls it first) or a headless caller: honest state.
                None => vec![
                    Block::Header(format!("edit {path}")),
                    Block::KeyVal("status".into(), "opening…".into()),
                ],
            };
        }
        // The FileTree surface renders an interactive directory listing — but the
        // clickable rows are built in `render_leaf` (Blocks are non-interactive);
        // here we emit the same listing as read-only Blocks so the terminal face
        // (`term.rs`) shows the tree too.
        if let SurfaceKind::FileTree { root } = surface {
            return filetree_blocks(root.as_deref());
        }
        match nav_id_for_surface(surface) {
            Some(nav_id) => NAV
                .iter()
                .position(|n| n.id == nav_id)
                .and_then(|i| self.pane_blocks.get(i).cloned())
                .unwrap_or_default(),
            None => vec![
                Block::Header(surface.label()),
                Block::KeyVal("status".into(), "live wiring lands in slice 3".into()),
            ],
        }
    }

    /// The HITL / Alerts surface: every captured action failure or outcome,
    /// newest-first, with FULL untruncated detail (the operator finally reads
    /// the whole daemon rejection). Each alert: a level chip + title + the
    /// never-ellipsized detail + a separator.
    fn blocks_for_hitl(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Alerts — HITL".into())];
        if self.alerts.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "all clear — no alerts".into(),
            ));
            return blocks;
        }
        blocks.push(Block::KeyVal(
            "total".into(),
            format!("{} (newest first)", self.alerts.len()),
        ));
        blocks.push(Block::Gap);
        for a in &self.alerts {
            blocks.push(Block::Chip {
                label: a.level.label().into(),
                tone: a.level.tone(),
            });
            blocks.push(Block::KeyVal("  what".into(), a.title.clone()));
            blocks.push(Block::WrappedText {
                text: a.detail.clone(),
                tone: a.level.tone(),
            });
            blocks.push(Block::Gap);
        }
        blocks
    }

    /// The Daemons surface as interactive [`console_button`]s (one per berth) —
    /// the clickable form of the picker. The active berth (its url == the live
    /// `daemon_url`) renders selected (washed + breathing halo); clicking any row
    /// fires `ControlMsg::RebindDaemon`, the same path the `u` command uses, so
    /// the producer swaps the client and every pane re-fetches from it.
    fn daemon_button_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let active = self.daemon_url.trim_end_matches('/').to_string();
        let t = current_theme();
        let mut rows: Vec<AnyElement> = Vec::new();
        // A baked still of the living-harbor water shader (pd-harbor-proto /
        // harbor.wgsl, rendered offscreen) as an on-brand banner over the picker.
        // A *baked* still, not a live pass: a 30fps embed would re-render the whole
        // console every frame (idle must stay at 0 re-renders); the live
        // render-to-texture backdrop is the ADR-0086 path-2 follow-up.
        rows.push(harbor_banner());
        for berth in crate::berths::discover() {
            let color = daemon_tone_color(&berth.tier, &t);
            let glyph = berth
                .tier
                .chars()
                .next()
                .unwrap_or('?')
                .to_ascii_uppercase();
            let url = berth.url();
            let selected = url == active;
            let summary = berth.display();
            rows.push(console_button(
                format!("daemon-{}", berth.port),
                berth.label.clone(),
                color,
                ButtonOpts {
                    leading: Some((glyph, color)),
                    trailing: Some(format!(":{}", berth.port)),
                    selected,
                    full_width: true,
                },
                cx,
                move |this, _cx| {
                    if let Some(tx) = &this.control_tx {
                        let _ = tx.send(ControlMsg::RebindDaemon { url: url.clone() });
                    }
                    this.control_flash = Some(format!("\u{2192} daemon {summary}"));
                    this.daemon_url = url.clone();
                },
            ));
        }
        rows.push(
            div()
                .px(px(tokens::SPACE_3))
                .pt(px(tokens::SPACE_2))
                .text_color(rgb(t.muted))
                .text_size(px(tokens::TEXT_CAPTION))
                .child("click a daemon to switch — or press u")
                .into_any_element(),
        );
        rows
    }

    /// Handle one multiplexer command after the leader key. Disarming is done
    /// by the caller.
    fn leader_command(&mut self, key: &str, ctrl: bool, cx: &mut Context<Self>) {
        match key {
            // Splits duplicate the focused surface (tmux behaviour); swap after.
            "|" | "\\" => {
                let s = self.ws_mut().focused_surface().clone();
                self.ws_mut().split(Dir::Row, s);
            }
            "-" => {
                let s = self.ws_mut().focused_surface().clone();
                self.ws_mut().split(Dir::Col, s);
            }
            "x" => {
                self.ws_mut().close();
            }
            "o" | "tab" => self.ws_mut().focus_next(),
            "O" => self.ws_mut().focus_prev(),
            // Double-prefix (Ctrl-A Ctrl-A) cycles focus — fast tmux idiom.
            "a" if ctrl && self.shell_open => {
                let _ = self.shell.send(vec![0x01]);
            }
            "a" if ctrl => self.ws_mut().focus_next(),
            // Resize the focused pane.
            "=" | "+" => {
                self.ws_mut().resize(0.15);
            }
            "_" => {
                self.ws_mut().resize(-0.15);
            }
            // Flip the palette (light ⇄ dark) — re-skins the whole console.
            "g" => toggle_theme(),
            // The PTY is global chrome, not a pane: it rises over any operator
            // surface and preserves its process when hidden.
            "`" | "grave" => self.shell_open = !self.shell_open,
            // Maximize / restore the focused pane.
            "z" => {
                let id = self.ws().focused();
                self.toggle_zoom(id);
            }
            // Tabs (tmux windows): w = new, [ / ] = prev / next.
            "w" => self.new_tab(),
            "]" => self.switch_tab(1),
            "[" => self.switch_tab(-1),
            // Open command lines.
            "n" => self.command = Some(CommandLine::new(CmdKind::Work)),
            "t" => self.command = Some(CommandLine::new(CmdKind::Cartographer)),
            // Insert a new pane of a chosen kind (the add-pane picker).
            "i" => self.command = Some(CommandLine::new(CmdKind::AddPane)),
            // Switch which daemon berth the console talks to (the Daemons pane lists names).
            "u" => self.command = Some(CommandLine::new(CmdKind::UseDaemon)),
            // Operator verb palette (vim-`:`): one entry point for every write
            // (work/note/begin/done/claim/release/kill/interrupt).
            ":" => self.command = Some(CommandLine::new(CmdKind::Verb)),
            // Direct single-key shortcuts for the most-used operator writes
            // (free letters, no NAV/leader collision):
            //   f note · e work · r begin · q done · j claim · Q release · X kill
            "f" => self.command = Some(CommandLine::new(CmdKind::Note)),
            "e" => self.command = Some(CommandLine::new(CmdKind::Work)),
            "r" => self.command = Some(CommandLine::new(CmdKind::Begin)),
            "q" => self.command = Some(CommandLine::new(CmdKind::Done)),
            "j" => self.command = Some(CommandLine::new(CmdKind::Claim)),
            "Q" => self.command = Some(CommandLine::new(CmdKind::Release)),
            "X" => self.command = Some(CommandLine::new(CmdKind::Kill)),
            // The visual pane launcher — an animated grid of surface tiles.
            "space" => self.launcher_open = true,
            // Any launcher key swaps the focused pane's surface — "hop context".
            other => {
                if let Some(item) = launcher_items().into_iter().find(|n| n.key == other) {
                    self.ws_mut().swap_surface(surface_for_launcher_id(item.id));
                }
            }
        }
        cx.notify();
    }

    pub fn apply_shell_event(&mut self, event: ShellEvent) {
        self.shell.apply(event);
    }

    fn handle_shell_key(
        &mut self,
        key: &str,
        typed: Option<&str>,
        modifiers: Modifiers,
        cx: &mut Context<Self>,
    ) {
        if let Some(bytes) = terminal_key_bytes(
            key,
            typed,
            modifiers.control,
            modifiers.alt,
            modifiers.platform,
            modifiers.function,
        ) {
            if !self.shell.send(bytes) {
                self.control_flash = Some(
                    "PTY_INPUT_CHANNEL_CLOSED · input did not reach the shell · next: relaunch pd-console"
                        .into(),
                );
            }
        }
        cx.notify();
    }

    /// Feed one keystroke into the open command line. `key` is the gpui key name
    /// (for enter/escape/backspace/space); `typed` is the actual character for
    /// printable input (case-preserving via `keystroke.key_char`).
    fn handle_command_key(&mut self, key: &str, typed: Option<&str>, cx: &mut Context<Self>) {
        match key {
            "enter" => {
                if let Some(cmd) = self.command.take() {
                    self.submit_command(cmd);
                }
            }
            "escape" => self.command = None,
            "backspace" => {
                if let Some(cmd) = self.command.as_mut() {
                    cmd.buffer.pop();
                }
            }
            "space" => {
                if let Some(cmd) = self.command.as_mut() {
                    cmd.buffer.push(' ');
                }
            }
            _ => {
                // Only accept genuine printable characters; ignore bare modifiers,
                // arrows, function keys, etc. (their key_char is None).
                if let Some(ch) = typed {
                    if let Some(cmd) = self.command.as_mut() {
                        cmd.buffer.push_str(ch);
                    }
                }
            }
        }
        cx.notify();
    }

    /// Is the focused pane the operator chat? Drives the keydown router (chat
    /// captures printable keys into its composer when focused, like a text field —
    /// gpui 0.2.2 has no native input, so the root focus handle does the capturing).
    fn focused_is_chat(&self) -> bool {
        matches!(self.ws().focused_surface(), SurfaceKind::CartographerChat)
    }

    fn focused_editor_key(&self) -> Option<String> {
        match self.ws().focused_surface() {
            SurfaceKind::Editor { path, region } => Some(editor_key(path, *region)),
            _ => None,
        }
    }

    fn presence_for_editor(state: &EditorSurfaceState, text: &str) -> PresenceState {
        let (cursor_line, cursor_col) = state.input.presence_cursor(text);
        let (anchor_line, anchor_col) = state.input.presence_anchor(text);
        let visual_top = state.scroll.0.borrow().base_handle.logical_scroll_top().0;
        let wrap_columns = state
            .input_bounds
            .filter(|_| state.wrap_lines)
            .map(|bounds| {
                let gutter_cols = text.split('\n').count().max(1).to_string().len() as f32;
                editor_wrap_columns(
                    f32::from(bounds.size.width),
                    gutter_cols,
                    state.show_blame,
                )
            });
        let line_for_visual_row = |visual_row| {
            editor_hit_position(text, visual_row, 0, wrap_columns)
                .map(|(line, _)| line as u32 + 1)
        };
        let top_line = line_for_visual_row(visual_top).unwrap_or(1);
        let last_line = text.split('\n').count().max(1) as u32;
        let bottom_line = line_for_visual_row(visual_top.saturating_add(80)).unwrap_or(last_line);
        PresenceState {
            cursor_line,
            cursor_col,
            anchor_line,
            anchor_col,
            top_line,
            bottom_line,
        }
    }

    fn apply_focused_editor_edit<F>(&mut self, prepare: F, cx: &mut Context<Self>) -> bool
    where
        F: FnOnce(&mut EditorInput, &str) -> Option<TextEdit>,
    {
        let Some(key) = self.focused_editor_key() else {
            return false;
        };
        let outcome = {
            let Some(state) = self.editors.get_mut(&key) else {
                return false;
            };
            let Some(before) = state.pane.text() else {
                return false;
            };
            let prior_input = state.input.clone();
            let Some(edit) = prepare(&mut state.input, &before) else {
                return true;
            };
            match state
                .pane
                .apply_local_text_edit(edit.range.clone(), &edit.text)
            {
                Ok(frame) => {
                    let after = state.pane.text().unwrap_or_default();
                    state.input.reconcile(&after);
                    invalidate_editor_blame(state);
                    let presence = Self::presence_for_editor(state, &after);
                    state.pane.set_local_presence(presence);
                    Ok((state.pane.path_str().to_string(), frame, presence))
                }
                Err(reason) => {
                    state.input = prior_input;
                    Err(reason)
                }
            }
        };

        match outcome {
            Ok((path, frame, presence)) => {
                // The foreground buffer paints the keystroke immediately. The
                // producer's collaboration Blocks return after importing this
                // exact delta; until then they must not cover the newer local view.
                if self
                    .editor_blocks
                    .as_ref()
                    .is_some_and(|(live_path, _)| live_path == &path)
                {
                    self.editor_blocks = None;
                }
                if let Some(tx) = &self.control_tx {
                    let _ = tx.send(ControlMsg::EditorLocalChange {
                        path,
                        frame: Some(frame),
                        presence,
                    });
                }
            }
            Err(reason) => {
                self.control_flash = Some(reason);
                crate::audio::play(crate::audio::Cue::Gate);
            }
        }
        cx.notify();
        true
    }

    fn move_focused_editor<F>(&mut self, update: F, cx: &mut Context<Self>) -> bool
    where
        F: FnOnce(&mut EditorInput, &str),
    {
        let Some(key) = self.focused_editor_key() else {
            return false;
        };
        let change = {
            let Some(state) = self.editors.get_mut(&key) else {
                return false;
            };
            let Some(text) = state.pane.text() else {
                return false;
            };
            update(&mut state.input, &text);
            let presence = Self::presence_for_editor(state, &text);
            state.pane.set_local_presence(presence);
            (state.pane.path_str().to_string(), presence)
        };
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::EditorLocalChange {
                path: change.0,
                frame: None,
                presence: change.1,
            });
        }
        cx.notify();
        true
    }

    fn handle_editor_key(
        &mut self,
        key: &str,
        modifiers: Modifiers,
        cx: &mut Context<Self>,
    ) -> bool {
        let select = modifiers.shift;
        match key {
            "left" => self.move_focused_editor(|input, text| input.left(text, select), cx),
            "right" => self.move_focused_editor(|input, text| input.right(text, select), cx),
            "up" => self.move_focused_editor(|input, text| input.vertical(text, -1, select), cx),
            "down" => self.move_focused_editor(|input, text| input.vertical(text, 1, select), cx),
            "home" => self.move_focused_editor(|input, text| input.home(text, select), cx),
            "end" => self.move_focused_editor(|input, text| input.end(text, select), cx),
            "backspace" => self.apply_focused_editor_edit(
                |input, text| {
                    let range = input.backspace_range(text)?;
                    Some(input.replace_bytes(text, range, ""))
                },
                cx,
            ),
            "delete" => self.apply_focused_editor_edit(
                |input, text| {
                    let range = input.delete_range(text)?;
                    Some(input.replace_bytes(text, range, ""))
                },
                cx,
            ),
            "enter" => self.apply_focused_editor_edit(
                |input, text| Some(input.replace_bytes(text, input.selection(), "\n")),
                cx,
            ),
            "tab" => self.apply_focused_editor_edit(
                |input, text| Some(input.replace_bytes(text, input.selection(), "    ")),
                cx,
            ),
            "a" if modifiers.platform => {
                self.move_focused_editor(|input, text| input.select_all(text), cx)
            }
            "c" if modifiers.platform => {
                if let Some(key) = self.focused_editor_key() {
                    if let Some(state) = self.editors.get(&key) {
                        if let Some(text) = state.pane.text() {
                            let range = state.input.selection();
                            if !range.is_empty() {
                                cx.write_to_clipboard(ClipboardItem::new_string(
                                    text[range].to_string(),
                                ));
                            }
                        }
                    }
                }
                true
            }
            "x" if modifiers.platform => {
                let copied = self.focused_editor_key().and_then(|key| {
                    let state = self.editors.get(&key)?;
                    let text = state.pane.text()?;
                    let range = state.input.selection();
                    (!range.is_empty()).then(|| text[range].to_string())
                });
                if let Some(text) = copied {
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                    self.apply_focused_editor_edit(
                        |input, text| Some(input.replace_bytes(text, input.selection(), "")),
                        cx,
                    )
                } else {
                    true
                }
            }
            "v" if modifiers.platform => {
                let paste = cx
                    .read_from_clipboard()
                    .and_then(|item| item.text())
                    .unwrap_or_default();
                self.apply_focused_editor_edit(
                    move |input, text| Some(input.replace_bytes(text, input.selection(), &paste)),
                    cx,
                )
            }
            "escape" => self.move_focused_editor(|input, _| input.unmark(), cx),
            _ => false,
        }
    }

    fn handle_editor_mouse_down(&mut self, event: &MouseDownEvent, cx: &mut Context<Self>) {
        let Some(key) = self.focused_editor_key() else {
            return;
        };
        let target = self.editors.get(&key).and_then(|state| {
            let bounds = state.input_bounds?;
            let text = state.pane.text()?;
            let top = state.scroll.0.borrow().base_handle.logical_scroll_top().0;
            let (gutter_px, wrap_columns) = editor_text_layout(
                &text,
                f32::from(bounds.size.width),
                state.wrap_lines,
                state.show_blame,
            );
            let row = ((f32::from(event.position.y - bounds.top()) / tokens::CODE_LINE_H).floor()
                as isize)
                .max(0) as usize;
            let column = ((f32::from(event.position.x - bounds.left()) - gutter_px)
                / tokens::CODE_CH)
                .floor()
                .max(0.0) as usize;
            let (line, column) = editor_hit_position(&text, top + row, column, wrap_columns)?;
            let utf16 = state.input.utf16_index_for_line_column(&text, line, column);
            Some(
                state
                    .input
                    .byte_range_for_utf16(&text, &(utf16..utf16))
                    .start,
            )
        });
        if let Some(target) = target {
            let select = event.modifiers.shift;
            let _ = self.move_focused_editor(
                move |input, text| input.move_to_byte(text, target, select),
                cx,
            );
        }
    }

    /// Feed one keystroke into the chat composer. Mirrors `handle_command_key`'s
    /// rolled-own buffer (no native widget): Enter submits the turn; Shift+Enter
    /// inserts a newline; Backspace pops; Space/printable chars push (case-preserving
    /// via `keystroke.key_char`); bare modifiers/arrows/function keys are ignored.
    fn handle_chat_key(
        &mut self,
        key: &str,
        typed: Option<&str>,
        shift: bool,
        cx: &mut Context<Self>,
    ) {
        match key {
            "enter" if shift => self.chat_input.push('\n'),
            "enter" => self.submit_chat(),
            "backspace" => {
                self.chat_input.pop();
            }
            "space" => self.chat_input.push(' '),
            _ => {
                if let Some(ch) = typed {
                    self.chat_input.push_str(ch);
                }
            }
        }
        cx.notify();
    }

    /// Submit the composed chat turn: optimistically show the operator's bubble,
    /// clear the composer, fire the send earcon, and hand the text to the
    /// background transport thread (which owns the daemon client / tube). Without a
    /// control plane (an isolated test view) the surface is honest about being
    /// view-only rather than pretending to send.
    fn submit_chat(&mut self) {
        if self.send_chat_turn(self.chat_input.clone()) {
            self.chat_input.clear();
        }
    }

    fn send_chat_turn(&mut self, text: impl Into<String>) -> bool {
        let text = text.into().trim().to_string();
        if text.is_empty() {
            return false;
        }
        // Optimistic: the operator's turn appears the instant they press Enter.
        self.chat.push_mine(text.clone());
        crate::audio::play(crate::audio::Cue::Confirm);
        match &self.control_tx {
            Some(tx) => {
                let _ = tx.send(ControlMsg::ChatSend { text });
            }
            None => {
                self.chat
                    .set_error("no control plane — chat is view-only in this build");
            }
        }
        true
    }

    /// Fold one transport push into the chat transcript: a real reply down the tube
    /// (with the receive earcon) or a transport error (surfaced in the error state).
    pub fn apply_chat_update(&mut self, update: ChatUpdate) {
        match update {
            ChatUpdate::Reply(msg) => {
                // A reply is always agent-side (mine = false), by construction.
                self.chat.push_agent(msg.sender, msg.text);
                crate::audio::play(crate::audio::Cue::Receive);
            }
            ChatUpdate::Error(reason) => self.chat.set_error(reason),
        }
    }

    /// Dispatch a submitted command to the background thread (which owns the
    /// daemon client and performs the POST).
    fn submit_command(&mut self, cmd: CommandLine) {
        let text = cmd.buffer.trim().to_string();
        // The verb palette (`:`) re-dispatches: its first token names a concrete
        // write, the rest is that write's argument. Resolve it into the real
        // CommandLine and submit THAT, so the per-verb paths below run unchanged.
        if cmd.kind == CmdKind::Verb {
            if let Some((kind, arg)) = parse_verb(&text) {
                self.submit_command(CommandLine::with_buffer(kind, arg));
            } else if !text.is_empty() {
                let verb = text.split_whitespace().next().unwrap_or("");
                self.control_flash = Some(if is_legacy_launch_verb(verb) {
                    format!(
                        "'{verb}' is retired in pd-console — use 'work <goal>'; old launch words no longer own runtime state"
                    )
                } else {
                    format!(
                        "unknown verb '{verb}' — try work/note/begin/done/claim/release/kill/interrupt"
                    )
                });
            }
            return;
        }
        // Reject and Done may submit empty (Reject falls back to a default reason;
        // Done's summary is optional; Sextant parley falls back to the contract's
        // default reason); every other verb needs text.
        if text.is_empty()
            && cmd.kind != CmdKind::DispatchReject
            && cmd.kind != CmdKind::Done
            && cmd.kind != CmdKind::GalaxyParley
        {
            return;
        }
        // AddPane is a purely local UI mutation (split a new pane of the chosen
        // surface) — no daemon round-trip, so handle it before the tx guard.
        if cmd.kind == CmdKind::AddPane {
            match surface_for_query(&text) {
                Some(SurfaceKind::Editor { path, region }) => {
                    match self.open_editor(path, region, EditorPlacement::SplitRight) {
                        Ok(()) => self.control_flash = Some(format!("added pane: {text}")),
                        Err(reason) => {
                            self.control_flash = Some(reason);
                            crate::audio::play(crate::audio::Cue::Error);
                        }
                    }
                }
                Some(surface) => {
                    self.ws_mut().split(Dir::Row, surface);
                    self.control_flash = Some(format!("added pane: {text}"));
                }
                None => {
                    self.control_flash = Some(format!("no surface matches '{text}'"));
                }
            }
            return;
        }
        // UseDaemon resolves a berth name/`:port`/tier locally (reads the registry)
        // then asks the producer to swap the client. Handled before the tx guard so
        // the "no match" feedback works even without a control channel.
        if cmd.kind == CmdKind::UseDaemon {
            let berths = crate::berths::discover();
            if let Some(berth) = crate::berths::resolve(&berths, &text) {
                let url = berth.url();
                let summary = berth.display();
                if let Some(tx) = &self.control_tx {
                    let _ = tx.send(ControlMsg::RebindDaemon { url: url.clone() });
                }
                self.control_flash = Some(format!("-> daemon {summary}"));
                self.daemon_url = url;
            } else {
                self.control_flash = Some(format!("no daemon matches '{text}'"));
            }
            return;
        }
        // Clone the sender (owned) so we can also mutate the workspace below
        // without holding an immutable borrow of `self` across `ws_mut()`.
        let Some(tx) = self.control_tx.clone() else {
            return;
        };
        match cmd.kind {
            CmdKind::Work => {
                let _ = tx.send(ControlMsg::SubmitWorkIntent { goal: text });
                self.control_flash = Some(
                    "capturing WorkIntent through the daemon — no provider or run has been selected"
                        .into(),
                );
                self.work_plan_graph = crate::work_plan::pending_work_projection();
                self.work_graph_png_path = None;
                self.ws_mut().swap_surface(SurfaceKind::Work);
            }
            CmdKind::Cartographer => {
                let _ = tx.send(ControlMsg::Cartographer { text });
                self.control_flash =
                    Some("sent to cartographer — streaming the reply below".into());
                // Same loop for the cartographer: jump to the lane to watch the
                // reply stream rather than leaving the operator guessing where it went.
                self.ws_mut()
                    .swap_surface(SurfaceKind::AgentTranscript { agent_id: None });
            }
            CmdKind::LaneMessage => {
                let turn = OperatorTurn::parse(&text);
                if turn.is_empty() {
                    self.control_flash =
                        Some("add a message, attachment, skill, or tool request first".into());
                    return;
                }
                let context = turn.context_summary();
                let _ = tx.send(ControlMsg::MessageLane { text });
                self.control_flash = Some(if context.is_empty() {
                    "sent to watched agent — watch the chat stream".into()
                } else {
                    format!("sent to watched agent with {context}")
                });
                self.ws_mut()
                    .swap_surface(SurfaceKind::AgentTranscript { agent_id: None });
            }
            CmdKind::DispatchReject => {
                if let Some(id) = self.reject_target.take() {
                    let reason = if text.len() >= 3 {
                        text
                    } else {
                        "rejected via console".into()
                    };
                    let _ = tx.send(ControlMsg::DispatchReject { id, reason });
                    self.control_flash = Some("gate rejected".into());
                }
            }
            CmdKind::Note => {
                let _ = tx.send(ControlMsg::AddNote { content: text });
                self.control_flash = Some("note added → check Memory".into());
            }
            CmdKind::Begin => {
                let _ = tx.send(ControlMsg::BeginSession {
                    identity: text.clone(),
                });
                self.control_flash = Some(format!("begin session: {text}"));
            }
            CmdKind::Done => {
                let summary = if text.is_empty() { None } else { Some(text) };
                let _ = tx.send(ControlMsg::EndSession { summary });
                self.control_flash = Some("session ended".into());
            }
            CmdKind::Claim => {
                let _ = tx.send(ControlMsg::ClaimPort {
                    identity: text.clone(),
                });
                self.control_flash = Some(format!("claiming port for {text}…"));
            }
            CmdKind::Release => {
                let _ = tx.send(ControlMsg::ReleasePort {
                    identity: text.clone(),
                });
                self.control_flash = Some(format!("releasing {text}…"));
            }
            CmdKind::Kill => {
                let _ = tx.send(ControlMsg::KillAgent {
                    agent_id: text.clone(),
                });
                self.control_flash = Some(format!("killing agent {text}…"));
            }
            CmdKind::InterruptAgent => {
                let _ = tx.send(ControlMsg::InterruptAgent {
                    agent_id: text.clone(),
                });
                self.control_flash = Some(format!("interrupting agent {text}…"));
            }
            CmdKind::GalaxyParley => {
                // Parties are AGENT ids (never transcript/session ids) — recompute
                // from the live selection at submit time so a pruned map can't
                // ship stale parties. Below 2 distinct agents the daemon 400s,
                // so refuse here with the reason instead of a doomed round-trip.
                let parties =
                    crate::galaxy_pane::distinct_agents(&self.galaxy.points, &self.galaxy_selected);
                if parties.len() < 2 {
                    self.control_flash = Some(
                        "parley needs ≥2 distinct agents — select sessions from ≥2 agents first"
                            .into(),
                    );
                    return;
                }
                let surface = crate::galaxy_pane::parley_surface(
                    &self.galaxy.points,
                    &self.galaxy.clusters,
                    &self.galaxy_selected,
                );
                let reason = if text.is_empty() {
                    crate::galaxy_pane::default_reason(
                        &self.galaxy.points,
                        &self.galaxy.clusters,
                        &self.galaxy_selected,
                    )
                } else {
                    text
                };
                let n_parties = parties.len();
                let _ = tx.send(ControlMsg::GalaxyParley {
                    surface,
                    reason,
                    parties,
                });
                crate::audio::play(crate::audio::Cue::Dispatch);
                self.control_flash = Some(format!(
                    "convening parley with {n_parties} agents — outcome lands in Alerts"
                ));
            }
            CmdKind::HarborSteer => {
                if text.trim().is_empty() {
                    self.control_flash = Some("steer needs a message — nothing was sent".into());
                    return;
                }
                let _ = tx.send(ControlMsg::HarborControl {
                    verb: "steer".into(),
                    argument: Some(text),
                });
                self.control_flash =
                    Some("steer queued — watch the node's transcript for the guidance turn".into());
            }
            // AddPane, UseDaemon, and Verb are handled locally above
            // (early return) — never reach here.
            CmdKind::AddPane | CmdKind::UseDaemon | CmdKind::Verb => {}
        }
    }

    /// Kick off the Vello render of the current WorkPlan graph. Serializes the DAG to
    /// the proto's JSON shape on the foreground (cheap), then hands it to the
    /// background thread, which writes the JSON, shells `capture.sh` (release +
    /// unsandboxed) and `open`s the PNG. The gpui thread never blocks on the
    /// build/render — it only flips a flash and fires the message.
    fn render_work_graph(&mut self) {
        let title = self.work_plan_graph.title.clone();
        match crate::work_plan::to_json(&self.work_plan_graph) {
            Ok(dag_json) => {
                if let Some(tx) = &self.control_tx {
                    let _ = tx.send(ControlMsg::RenderWorkGraph { dag_json, title });
                    self.control_flash = Some(
                        "rendering the DAG with Vello… the PNG opens when the build lands".into(),
                    );
                } else {
                    // No control plane (an isolated test view): nothing to shell out to.
                    self.control_flash = Some("render unavailable — no control plane".into());
                }
            }
            Err(e) => {
                self.control_flash = Some(format!("could not serialize the DAG: {e}"));
            }
        }
    }

    /// The pane launcher overlay (Ctrl-A Space / the ⊞ button): an animated grid
    /// of surface tiles. Click — or press a tile's Ctrl-A key — to swap the
    /// focused pane to that surface. Motion discipline (rust-gpui-motion): no
    /// transforms — entrance is a one-shot staggered opacity fade (one owner per
    /// tile, no repeat()); hover "lift" is a BoxShadow glow; reduced-motion
    /// renders tiles at full opacity but keeps the hover glow for orientation.
    fn render_launcher(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = current_theme();
        let reduced = reduced_motion();
        let current = launcher_id_for_surface(self.ws().focused_surface());
        let items = launcher_items();
        let n = items.len().max(1);
        let viewport = window.viewport_size();
        let layout = launcher_layout(f32::from(viewport.width), f32::from(viewport.height), n);

        let mut tiles: Vec<AnyElement> = items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let item = *item;
                let id = item.id;
                let is_current = current.as_deref() == Some(item.id);
                let tone = launcher_tone(id, &t); // ADHD colour-coding: navigate by hue.

                // Big chunky tile — sized for low-friction targeting and legibility.
                let tile = div()
                    .id(SharedString::from(format!("launch-{id}")))
                    .w(px(layout.tile_w))
                    .h(px(layout.tile_h))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px((layout.gap + 2.0).min(12.0)))
                    .border_1()
                    .border_t_2()
                    .border_color(rgb(if is_current { tone } else { t.line }))
                    .bg(rgb(t.raised))
                    .cursor_pointer()
                    .hover(move |s| {
                        let t = current_theme();
                        s.bg(rgb(t.panel)).border_color(rgb(tone))
                    })
                    // Icon sits in a big tone-washed chip so colour reads even at a glance.
                    .child(
                        div()
                            .w(px(layout.icon_box))
                            .h(px(layout.icon_box))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(rgb(tone))
                            .child(
                                svg()
                                    .path(item.icon)
                                    .w(px(layout.icon))
                                    .h(px(layout.icon))
                                    .text_color(rgb(knockout_ink(tone))),
                            ),
                    )
                    .child(
                        div()
                            .text_color(rgb(t.ink))
                            .text_size(px(layout.label_size))
                            .font_weight(FontWeight::BOLD)
                            .child(item.label),
                    )
                    .child(
                        div()
                            .px(px(7.0))
                            .py(px(2.0))
                            .border_1()
                            .border_color(rgb(tone))
                            .text_color(rgb(tone))
                            .text_size(px(layout.key_size))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(format!("⌃A {}", item.key)),
                    )
                    .on_click(cx.listener(move |this, _ev, _window, cx| {
                        this.ws_mut().swap_surface(surface_for_launcher_id(id));
                        this.launcher_open = false;
                        this.control_flash = Some(format!("→ {id}"));
                        cx.notify();
                    }));

                if reduced || is_current {
                    tile.into_any_element()
                } else {
                    // One-shot staggered entrance fade — the stagger lives in the
                    // opacity curve, so each tile stays its own single animation owner.
                    let start = (i as f32 / n as f32) * 0.6;
                    tile.with_animation(
                        SharedString::from(format!("launch-in-{id}")),
                        Animation::new(Duration::from_millis(360)).with_easing(ease_in_out),
                        move |el, delta| {
                            let o = ((delta - start) / (1.0 - start)).clamp(0.0, 1.0);
                            el.opacity(o)
                        },
                    )
                    .into_any_element()
                }
            })
            .collect();

        // Group tiles into explicit rows. flex_wrap's wrapped height isn't summed
        // back into the parent in Taffy here, so the card bg stopped short of the
        // last row; rows stacked in a flex_col measure correctly and the bg fits.
        let mut rows: Vec<AnyElement> = Vec::new();
        while !tiles.is_empty() {
            let take = tiles.len().min(layout.cols);
            let row: Vec<AnyElement> = tiles.drain(0..take).collect();
            rows.push(
                div()
                    .flex()
                    .gap(px(layout.gap))
                    .children(row)
                    .into_any_element(),
            );
        }

        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            // Scrim: a full-size sibling behind the card. Clicking it (i.e.
            // anywhere outside the card) dismisses; clicks on the card don't
            // reach it (siblings don't bubble into each other).
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .bg(rgba(0x05060acc))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _ev, _window, cx| {
                            this.launcher_open = false;
                            cx.notify();
                        }),
                    ),
            )
            .child(
                div()
                    // Occlude so a press on the card (a tile) can't fall through to
                    // the scrim's on_mouse_down — without this the scrim closes the
                    // launcher on press, the re-render drops the tiles, and the
                    // tile's on_click (needs the release) never fires: "Jump to a
                    // pane" looked like it did nothing.
                    .occlude()
                    .flex()
                    .flex_col()
                    .gap(px(layout.gap + 6.0))
                    .p(px(layout.card_pad))
                    .w(px(layout.card_w))
                    .h(px(layout.card_h))
                    .bg(rgb(t.panel))
                    .border_1()
                    .border_color(rgb(t.line))
                    // Header: big title + a colour legend, so the hue-coding is
                    // self-explaining at a glance (ADHD-friendly navigation).
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .text_color(rgb(t.accent_ink))
                                    .text_size(px(layout.title_size))
                                    .font_weight(FontWeight::BOLD)
                                    .child("Jump to a pane"),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(16.0))
                                    .child(launcher_legend_chip("Live", t.cobalt))
                                    .child(launcher_legend_chip("Control", t.accent))
                                    .child(launcher_legend_chip("Knowledge", t.landed))
                                    .child(launcher_legend_chip("Records", t.gated)),
                            ),
                    )
                    .child(div().flex().flex_col().gap(px(layout.gap)).children(rows))
                    .child(
                        div()
                            .text_color(rgb(t.muted))
                            .text_size(px(13.0))
                            .child("click a tile · press its ⌃A key · Esc to close"),
                    ),
            )
            .into_any_element()
    }

    /// Push fresh data for all panes from the background refresh loop.
    /// Each entry is (nav_index, blocks_for_that_pane); `dispatch_head` is the
    /// head-of-queue dispatch for the review gate (None when the queue is empty).
    /// Accept one captured alert from the bus: flash it immediately (the truthful
    /// replacement for the old optimistic "spawning…" lie) and accumulate it in
    /// the bounded HITL log, newest first.
    pub fn push_alert(&mut self, alert: Alert) {
        // Immediate feedback: a short head; the full detail lives in the log /
        // HITL surface (never truncated at the source).
        let head: String = alert
            .detail
            .lines()
            .next()
            .unwrap_or(&alert.detail)
            .chars()
            .take(120)
            .collect();
        self.control_flash = Some(match alert.level {
            AlertLevel::Error => format!("✕ {} — {head}", alert.title),
            AlertLevel::Warn => format!("WARN · {} — {head}", alert.title),
            AlertLevel::Info => format!("✓ {}", alert.title),
        });
        self.alerts.insert(0, alert);
        // Steady state: cap the log so a long session can't leak memory.
        const ALERT_CAP: usize = 100;
        if self.alerts.len() > ALERT_CAP {
            self.alerts.truncate(ALERT_CAP);
        }
    }

    fn clear_work_projection_failure(&mut self) {
        let failure_title = "Work projection unavailable";
        self.alerts.retain(|alert| alert.title != failure_title);
        if self
            .control_flash
            .as_deref()
            .is_some_and(|flash| flash.contains(failure_title))
        {
            self.control_flash = None;
        }
    }

    /// Apply daemon-backed Work truth or a visual artifact derived from it.
    /// Command receipts focus the Work surface; background rehydration never
    /// steals focus from the operator.
    pub fn apply_work_update(&mut self, update: WorkUpdate) {
        match update {
            WorkUpdate::Receipt(receipt) => {
                self.clear_work_projection_failure();
                let intent_id = receipt.snapshot.intent_id().to_string();
                let plan_state = receipt.snapshot.plan_state().to_string();
                let dag = crate::work_plan::from_work_snapshot(&receipt.snapshot);
                let duplicate = receipt.duplicate;
                let status = receipt.status;
                self.work_plan_graph = dag;
                self.work_selected_node = None;
                self.work_graph_png_path = None;
                self.work_intent_id = Some(intent_id.clone());
                self.work_plan_state = plan_state.clone();
                self.work_correlation_id = Some(receipt.correlation_id.clone());
                self.work_next_action = Some(receipt.next_action);
                self.work_execution_state = "starting".into();
                self.work_execution_id = None;
                self.work_execution_projection = None;
                self.work_execution_session = None;
                self.work_execution_worktree = None;
                self.ws_mut().swap_surface(SurfaceKind::Work);
                self.control_flash = Some(format!(
                    "WorkIntent {status}: {intent_id} · plan {plan_state} · correlation {}{}",
                    receipt.correlation_id,
                    if duplicate {
                        " · idempotent replay"
                    } else {
                        ""
                    }
                ));
            }
            WorkUpdate::Execution(receipt) => {
                self.clear_work_projection_failure();
                self.work_intent_id = Some(receipt.snapshot.intent_id().to_string());
                self.work_plan_state = receipt.snapshot.plan_state().to_string();
                self.work_plan_graph = crate::work_plan::from_work_snapshot(&receipt.snapshot);
                self.work_correlation_id = Some(receipt.correlation_id.clone());
                self.work_next_action = Some(receipt.next_action);
                self.work_execution_state = receipt.state.clone();
                self.work_execution_id = Some(receipt.dispatch_id.clone());
                self.work_execution_projection = Some(receipt.projection.clone());
                self.work_execution_session = receipt.session_id.clone();
                self.work_execution_worktree = receipt.worktree_path.clone();
                self.ws_mut()
                    .swap_surface(SurfaceKind::AgentTranscript { agent_id: None });
                self.control_flash = Some(format!(
                    "WorkIntent runtime {}: {} · {}{}{}",
                    receipt.status,
                    receipt.state,
                    receipt.dispatch_id,
                    if receipt.launched_this_tick > 0 {
                        format!(" · {} worker claim processed", receipt.launched_this_tick)
                    } else {
                        String::new()
                    },
                    if receipt.duplicate {
                        " · idempotent replay"
                    } else {
                        ""
                    }
                ));
            }
            WorkUpdate::Snapshot(snapshot) => {
                self.clear_work_projection_failure();
                self.work_intent_id = Some(snapshot.intent_id().to_string());
                self.work_plan_state = snapshot.plan_state().to_string();
                self.work_plan_graph = crate::work_plan::from_work_snapshot(&snapshot);
                self.work_selected_node = None;
                self.work_graph_png_path = None;
            }
            WorkUpdate::Png(path) => {
                self.work_graph_png_path = Some(path);
            }
        }
    }

    /// Fold a producer refresh into the view. Returns whether anything the
    /// render reads actually CHANGED — the caller `cx.notify()`s ONLY on true,
    /// so an idle console (every pane re-fetching identical state on the 2s
    /// cycle) schedules ZERO repaints instead of a full-window repaint per tick.
    pub fn update_panes(
        &mut self,
        updates: Vec<(usize, Vec<Block>)>,
        dispatch_head: Option<DispatchHead>,
        galaxy: crate::galaxy_pane::GalaxySnapshot,
        daemon_connected: bool,
        hitl_gate: crate::interruptions::HitlGate,
    ) -> bool {
        // First refresh dismisses the launch splash (a real visual change).
        let mut changed = !self.booted;
        self.booted = true;
        if self.daemon_connected != daemon_connected {
            self.daemon_connected = daemon_connected;
            changed = true;
        }
        for (idx, blocks) in updates {
            if let Some(slot) = self.pane_blocks.get_mut(idx) {
                if *slot != blocks {
                    *slot = blocks;
                    changed = true;
                }
            }
        }
        if self.dispatch_head != dispatch_head {
            self.dispatch_head = dispatch_head;
            changed = true;
        }
        if self.hitl_gate != hitl_gate {
            self.hitl_gate = hitl_gate;
            changed = true;
        }

        // Fresh galaxy frame: prune selection/hover of points that slid out of
        // the map window, so a parley can never target a vanished session.
        let ids: HashSet<&str> = galaxy.points.iter().map(|p| p.id.as_str()).collect();
        let selected_before = self.galaxy_selected.len();
        self.galaxy_selected.retain(|id| ids.contains(id.as_str()));
        if self.galaxy_selected.len() != selected_before {
            changed = true;
        }
        if self
            .galaxy_hover
            .as_ref()
            .is_some_and(|h| !ids.contains(h.as_str()))
        {
            self.galaxy_hover = None;
            changed = true;
        }
        if !same_galaxy_snapshot(&self.galaxy, &galaxy) {
            self.galaxy = galaxy;
            changed = true;
        }
        changed
    }

    /// Answer one scripting request (control socket, `--control-sock`). Runs
    /// on the foreground with full view access; every reply is JSON the caller
    /// can parse without screenshots. Mutations that belong to the producer
    /// thread (galaxy params, daemon rebind) are forwarded over `control_tx` —
    /// the same channel every operator button uses, so scripting can never
    /// reach state the UI couldn't.
    pub fn handle_script(&mut self, req: crate::script::ScriptRequest) -> serde_json::Value {
        use crate::script::{alert_to_json, block_to_json, ScriptRequest};
        use serde_json::json;
        match req {
            ScriptRequest::Ping => json!({
                "ok": true,
                "daemon": self.daemon_url,
                "booted": self.booted,
                "focused": self.ws().focused_surface().label(),
            }),
            ScriptRequest::Panes => json!({
                "ok": true,
                "panes": NAV.iter().map(|n| n.id).collect::<Vec<_>>(),
                "focused": self.ws().focused_surface().label(),
            }),
            ScriptRequest::Focus { pane } => {
                if let Some(reply) = retired_galaxy_pane_reply(&pane) {
                    reply
                } else {
                    match surface_for_query(&pane) {
                        Some(SurfaceKind::Editor { path, region }) => {
                            match self.open_editor(path, region, EditorPlacement::ReplaceFocused) {
                                Ok(()) => json!({
                                    "ok": true,
                                    "focused": self.ws().focused_surface().label(),
                                }),
                                Err(error) => json!({
                                    "ok": false,
                                    "error": error,
                                    "focused": self.ws().focused_surface().label(),
                                }),
                            }
                        }
                        Some(surface) => {
                            self.ws_mut().swap_surface(surface);
                            json!({"ok": true, "focused": self.ws().focused_surface().label()})
                        }
                        None => json!({
                            "ok": false,
                            "error": format!("unknown pane \"{pane}\""),
                            "panes": NAV.iter().map(|n| n.id).collect::<Vec<_>>(),
                        }),
                    }
                }
            }
            ScriptRequest::State { pane } => {
                if pane.is_none() {
                    if let SurfaceKind::Editor { path, region } = self.ws().focused_surface() {
                        let key = editor_key(path, *region);
                        return match self.editors.get(&key) {
                            Some(state) => {
                                let blame = match &state.blame {
                                    EditorBlameState::Off => "off",
                                    EditorBlameState::Loading => "loading",
                                    EditorBlameState::Ready(_) => "ready",
                                    EditorBlameState::Stale => "stale",
                                    EditorBlameState::Error(_) => "error",
                                };
                                json!({
                                    "ok": true,
                                    "pane": "editor",
                                    "path": path,
                                    "text": state.pane.text(),
                                    "wrap": state.wrap_lines,
                                    "showBlame": state.show_blame,
                                    "blame": blame,
                                    "syntax": crate::syntax::lang_for_path(path).label(),
                                })
                            }
                            None => json!({
                                "ok": false,
                                "pane": "editor",
                                "path": path,
                                "error": "focused editor state is not loaded",
                            }),
                        };
                    }
                }
                let target = pane.unwrap_or_else(|| {
                    nav_id_for_surface(self.ws().focused_surface())
                        .unwrap_or("fleet")
                        .to_string()
                });
                if let Some(reply) = retired_galaxy_pane_reply(&target) {
                    return reply;
                }
                let Some(idx) = NAV.iter().position(|n| n.id == target) else {
                    return json!({
                        "ok": false,
                        "error": format!("unknown pane \"{target}\""),
                        "panes": NAV.iter().map(|n| n.id).collect::<Vec<_>>(),
                    });
                };
                let blocks: Vec<serde_json::Value> = self
                    .pane_blocks
                    .get(idx)
                    .map(|bs| bs.iter().map(block_to_json).collect::<Vec<_>>())
                    .unwrap_or_default();
                let mut out = json!({"ok": true, "pane": target, "blocks": blocks});
                if target == "sextant" {
                    out["sextant"] = json!({
                        "computedAt": self.galaxy.computed_at,
                        "error": self.galaxy.last_error,
                        "points": self.galaxy.points.iter().map(|p| json!({
                            "id": p.id,
                            "agentId": p.agent_id,
                            "x": p.x,
                            "y": p.y,
                            "cluster": p.cluster_id,
                            "purpose": p.purpose,
                        })).collect::<Vec<_>>(),
                        "clusters": self.galaxy.clusters.iter().map(|c| json!({
                            "id": c.id,
                            "label": c.label,
                            "size": c.size,
                        })).collect::<Vec<_>>(),
                        "selected": self.galaxy_selected.iter().cloned().collect::<Vec<_>>(),
                        "viewport": {
                            "zoom": self.galaxy_viewport.zoom,
                            "panX": self.galaxy_viewport.pan_x,
                            "panY": self.galaxy_viewport.pan_y,
                        },
                    });
                }
                out
            }
            ScriptRequest::Galaxy {
                window_hours,
                min_tokens,
                cluster,
            } => match &self.control_tx {
                Some(tx) => {
                    if window_hours.is_some() || min_tokens.is_some() {
                        let _ = tx.send(ControlMsg::GalaxyParams {
                            window_hours,
                            min_tokens,
                        });
                    }
                    if let Some(enabled) = cluster {
                        let _ = tx.send(ControlMsg::GalaxyCluster { enabled });
                    }
                    json!({
                        "ok": true,
                        "note": "params applied on the next 2s refresh",
                        "windowHours": window_hours,
                        "minTokens": min_tokens,
                        "cluster": cluster,
                    })
                }
                None => {
                    json!({"ok": false, "error": "no control channel (view constructed without one)"})
                }
            },
            ScriptRequest::Chat { text } => {
                let control_plane = self.control_tx.is_some();
                if self.send_chat_turn(text.clone()) {
                    json!({
                        "ok": true,
                        "chat": {
                            "sent": true,
                            "text": text,
                            "controlPlane": control_plane,
                        },
                    })
                } else {
                    json!({"ok": false, "error": "chat needs non-empty \"text\""})
                }
            }
            ScriptRequest::Work { goal } => {
                let control_plane = self.control_tx.is_some();
                self.submit_command(CommandLine::with_buffer(CmdKind::Work, goal.clone()));
                json!({
                    "ok": control_plane,
                    "work": {
                        "submitted": control_plane,
                        "goal": goal,
                        "authority": "daemon-work-intent",
                    },
                    "error": if control_plane {
                        serde_json::Value::Null
                    } else {
                        serde_json::Value::String("no control channel (view constructed without one)".into())
                    },
                })
            }
            ScriptRequest::Rebind { url } => match &self.control_tx {
                Some(tx) => {
                    let _ = tx.send(ControlMsg::RebindDaemon { url: url.clone() });
                    self.daemon_url = url.clone();
                    json!({"ok": true, "daemon": url})
                }
                None => {
                    json!({"ok": false, "error": "no control channel (view constructed without one)"})
                }
            },
            ScriptRequest::Alerts => json!({
                "ok": true,
                "alerts": self.alerts.iter().map(alert_to_json).collect::<Vec<_>>(),
            }),
        }
    }

    /// Set the Sextant window through the producer-owned channel used by the
    /// control socket's `sextant` command.
    pub(crate) fn set_galaxy_window(&mut self, hours: u32) {
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::GalaxyParams {
                window_hours: Some(hours),
                min_tokens: None,
            });
        }
    }

    /// Toggle daemon-side clustering; the canvas's cluster chip calls this.
    pub(crate) fn toggle_galaxy_cluster(&mut self) {
        let next = !self.galaxy.cluster;
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::GalaxyCluster { enabled: next });
        }
    }

    pub(crate) fn begin_galaxy_pan(&mut self, position: Point<Pixels>) {
        self.galaxy_pan = Some(position);
        self.galaxy_drag = None;
    }

    pub(crate) fn end_galaxy_pan(&mut self) {
        self.galaxy_pan = None;
    }

    pub(crate) fn galaxy_pan_to(&mut self, position: Point<Pixels>) {
        let Some(last) = self.galaxy_pan else {
            self.galaxy_pan = Some(position);
            return;
        };
        let bounds = *self.galaxy_bounds.borrow();
        if let Some(b) = bounds {
            self.galaxy_viewport.pan_by_screen_delta(
                f32::from(position.x) - f32::from(last.x),
                f32::from(position.y) - f32::from(last.y),
                f32::from(b.size.width),
                f32::from(b.size.height),
            );
            self.galaxy_hover = None;
        }
        self.galaxy_pan = Some(position);
    }

    pub(crate) fn galaxy_zoom_at_position(&mut self, position: Point<Pixels>, factor: f32) {
        let anchor = {
            let bounds = *self.galaxy_bounds.borrow();
            bounds
                .map(|b| {
                    let w = f32::from(b.size.width).max(1.0);
                    let h = f32::from(b.size.height).max(1.0);
                    (
                        (f32::from(position.x) - f32::from(b.origin.x)) / w,
                        (f32::from(position.y) - f32::from(b.origin.y)) / h,
                    )
                })
                .unwrap_or((0.5, 0.5))
        };
        self.galaxy_viewport
            .zoom_at(factor, anchor.0.clamp(0.0, 1.0), anchor.1.clamp(0.0, 1.0));
        self.galaxy_hover = None;
    }

    pub(crate) fn galaxy_zoom_center(&mut self, factor: f32) {
        self.galaxy_viewport.zoom_at(factor, 0.5, 0.5);
        self.galaxy_hover = None;
    }

    pub(crate) fn galaxy_fit_view(&mut self) {
        self.galaxy_viewport.fit_points(&self.galaxy.points);
        self.galaxy_hover = None;
    }

    pub(crate) fn galaxy_reset_view(&mut self) {
        self.galaxy_viewport.reset();
        self.galaxy_hover = None;
    }

    /// Open a galaxy-detail file row in the Editor surface (read-only host).
    pub(crate) fn open_galaxy_file(&mut self, pane_id: PaneId, path: String) {
        self.ws_mut().focus(pane_id);
        if let Err(reason) = self.open_editor(path, None, EditorPlacement::ReplaceFocused) {
            self.control_flash = Some(reason);
            crate::audio::play(crate::audio::Cue::Error);
        }
    }

    /// Fold one galaxy push from the background worker into the drawer state:
    /// a parsed session detail, or the daemon's real failure (shown, not eaten).
    pub fn apply_galaxy_update(&mut self, update: GalaxyUpdate) {
        match update {
            GalaxyUpdate::Detail(detail) => {
                self.galaxy_detail = Some(detail);
                self.galaxy_detail_error = None;
                crate::audio::play(crate::audio::Cue::Receive);
            }
            GalaxyUpdate::DetailError(reason) => {
                self.galaxy_detail = None;
                self.galaxy_detail_error = Some(reason);
                crate::audio::play(crate::audio::Cue::Error);
            }
        }
    }

    /// Open the parley-reason command line for the current galaxy selection
    /// (the canvas' "Initiate parley" button lands here; `CommandLine` is
    /// app-private, so the module boundary crosses through this method).
    pub(crate) fn open_galaxy_parley_command(&mut self) {
        self.command = Some(CommandLine::new(CmdKind::GalaxyParley));
        self.control_flash =
            Some("type a reason for the parley — Enter sends (empty uses the default)".into());
    }

    /// Ask the background thread for one session's full detail
    /// (`GET /galaxy/session/:id`); the reply lands via [`Self::apply_galaxy_update`].
    pub(crate) fn request_galaxy_detail(&mut self, transcript_id: String) {
        self.galaxy_detail = None;
        match &self.control_tx {
            Some(tx) => {
                self.galaxy_detail_error = None;
                let _ = tx.send(ControlMsg::GalaxyDetail { transcript_id });
            }
            None => {
                // No control plane (an isolated test view): be honest rather
                // than leaving a silent forever-loading drawer.
                self.galaxy_detail_error =
                    Some("no control plane — session detail is unavailable in this build".into());
            }
        }
    }

    /// Fold a producer editor edge into the window. A remote op is imported into
    /// every foreground pane bound to the path before its collaboration Blocks
    /// become visible, keeping the next local keystroke on the converged CRDT.
    pub fn apply_editor_update(&mut self, update: EditorUpdate) {
        for frame in &update.remote_frames {
            for state in self.editors.values_mut() {
                if state.pane.path_str() == update.path {
                    let _ = state.pane.ingest_frame(frame);
                    if let Some(text) = state.pane.text() {
                        state.input.reconcile(&text);
                    }
                    invalidate_editor_blame(state);
                }
            }
        }
        self.editor_blocks = Some((update.path, update.blocks));
    }

    /// The launch splash — a centered brand lockup (spinning radar mark + "Port Daddy") shown
    /// until the first pane refresh lands (see `update_panes`). The radar layers
    /// use native GPUI transforms and honor `PD_CONSOLE_REDUCED_MOTION`; the
    /// overlay covers the chrome via a full-size opaque surface painted last.
    fn render_splash(&self) -> AnyElement {
        let t = current_theme();
        let brand = splash_brand_palette(t.mode);
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .occlude()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(16.0))
            .bg(rgb(t.bg))
            .child(render_splash_mark(brand))
            .child(
                div()
                    .flex()
                    .items_center()
                    .text_size(px(34.0))
                    .font_weight(FontWeight::BLACK)
                    .child(div().text_color(rgb(brand.cobalt)).child("Port"))
                    .child(div().text_color(rgb(brand.seafoam)).child(" Daddy")),
            )
            .child(
                div()
                    .text_size(px(13.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(t.muted))
                    .child("CONSOLE · connecting…"),
            )
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(rgb(t.muted))
                    .child(build_stamp()),
            )
            .into_any_element()
    }

    /// Recursively render the pane tree. Splits become weighted flex
    /// containers (so `resize` is visible); leaves render their surface.
    fn render_node(
        &self,
        node: &Node,
        focused: PaneId,
        path: &[usize],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match node {
            Node::Split { dir, children } => {
                let total: f32 = children.iter().map(|c| c.weight).sum::<f32>().max(0.0001);
                let mut container = div().relative().flex().size_full().overflow_hidden();
                container = match dir {
                    Dir::Row => container.flex_row(),
                    Dir::Col => container.flex_col(),
                };
                // Capture this split's laid-out bounds (keyed by tree path) so the
                // drag handler can convert a mouse position into a weight fraction.
                let key = path.to_vec();
                let sb = self.split_bounds.clone();
                container = container.child(
                    canvas(
                        move |bounds: Bounds<Pixels>, _window, _cx| {
                            sb.borrow_mut().insert(key.clone(), bounds);
                        },
                        |_bounds, _prepaint, _window, _cx| {},
                    )
                    .absolute()
                    .size_full(),
                );
                let n = children.len();
                for (i, child) in children.iter().enumerate() {
                    let frac = child.weight / total;
                    let mut child_path = path.to_vec();
                    child_path.push(i);
                    container = container.child(
                        div()
                            .flex_basis(relative(frac))
                            .flex_grow()
                            .flex_shrink()
                            .overflow_hidden()
                            .child(self.render_node(&child.node, focused, &child_path, cx)),
                    );
                    // A draggable "mooring line" divider after every child but the last.
                    if i + 1 < n {
                        container = container.child(split_divider(path.to_vec(), i, *dir, cx));
                    }
                }
                container.into_any_element()
            }
            Node::Leaf { id, surface } => self.render_leaf(*id, surface, *id == focused, cx),
        }
    }

    /// Render one leaf: a bordered pane with a title bar (focus-highlighted) and
    /// its surface blocks. A focused agent transcript also gets the steering bar.
    fn render_leaf(
        &self,
        id: PaneId,
        surface: &SurfaceKind,
        is_focused: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let label = surface.label();
        let blocks = self.blocks_for_surface(surface);
        let editor_failure = match surface {
            SurfaceKind::Editor { path, .. } => {
                editor_error_from_blocks(&blocks).map(|reason| (path.clone(), reason))
            }
            _ => None,
        };
        let sparse_status = story_sparse_status(&blocks);
        let motion = self.flag_motion; // Copy snapshot for this frame's flags.
        let is_agent = matches!(surface, SurfaceKind::AgentTranscript { .. });
        // The Harbor editor renders its CodeBuffer through a virtualized
        // uniform_list (its own scroll), never the generic page-scroll body.
        let is_editor = matches!(surface, SurfaceKind::Editor { .. });
        let editor_scroll = match surface {
            SurfaceKind::Editor { path, region } => self
                .editors
                .get(&editor_key(path, *region))
                .map(|s| s.scroll.clone()),
            _ => None,
        };
        let editor_input = match surface {
            SurfaceKind::Editor { path, region } => self
                .editors
                .get(&editor_key(path, *region))
                .and_then(|state| {
                    state
                        .pane
                        .text()
                        .map(|text| editor_paint_state(&state.input, &text))
                }),
            _ => None,
        };
        let editor_options = match surface {
            SurfaceKind::Editor { path, region } => {
                self.editors.get(&editor_key(path, *region)).map(|state| {
                    let (blame_status, blame) = if !state.show_blame {
                        ("OFF".to_string(), None)
                    } else {
                        match &state.blame {
                            EditorBlameState::Off => ("OFF".to_string(), None),
                            EditorBlameState::Loading => ("LOADING".to_string(), None),
                            EditorBlameState::Ready(lines) => {
                                ("ON".to_string(), Some(lines.clone()))
                            }
                            EditorBlameState::Stale => ("STALE".to_string(), None),
                            EditorBlameState::Error(reason) => (format!("ERROR · {reason}"), None),
                        }
                    };
                    EditorRenderOptions {
                        wrap_lines: state.wrap_lines,
                        show_blame: state.show_blame,
                        blame,
                        blame_status,
                        syntax_label: crate::syntax::lang_for_path(path).label().to_string(),
                        viewport_width: state
                            .input_bounds
                            .map(|bounds| f32::from(bounds.size.width)),
                    }
                })
            }
            _ => None,
        };
        // The dispatch surface (focused) gets the interactive review GATE.
        // The Daemons surface renders interactive picker buttons instead of plain
        // text blocks (built here so the on_click listeners can borrow cx).
        let is_daemons = nav_id_for_surface(surface) == Some("daemons");
        let daemon_rows = if is_daemons {
            self.daemon_button_rows(cx)
        } else {
            Vec::new()
        };
        let is_dispatch = nav_id_for_surface(surface) == Some("dispatch");
        let is_conductor = nav_id_for_surface(surface) == Some("conductor");
        // The Work surface (focused) gets the "Render graph" action bar — the
        // discoverable control that ships the live DAG to the Vello PNG renderer.
        let is_work = matches!(surface, SurfaceKind::Work);
        // The Sextant surface renders the bespoke interactive scatter canvas
        // (galaxy_canvas.rs) instead of the generic Block list — the daemon
        // precomputed the layout; the canvas only places, hits, and selects.
        let is_sextant = nav_id_for_surface(surface) == Some("sextant");
        // The chat surface renders bespoke bubbles (from view state) + a focused
        // composer, NOT the generic Block list. Snapshot the transcript for this frame.
        let is_chat = matches!(surface, SurfaceKind::CartographerChat);
        let chat_msgs: Vec<ChatMsg> = if is_chat {
            self.chat.messages.clone()
        } else {
            Vec::new()
        };
        let chat_error: Option<String> = if is_chat {
            self.chat.error.clone()
        } else {
            None
        };
        let chat_state: Option<ChatState> = if is_chat {
            Some(self.chat.state())
        } else {
            None
        };
        let chat_input = if is_chat {
            self.chat_input.clone()
        } else {
            String::new()
        };
        let chat_reduced = reduced_motion();
        let work_flash = self.control_flash.clone();
        // The rendered Vello PNG (if any) for the inline node-graph at the top of
        // the Work surface. `None` ⇒ a tasteful "rendering graph…" placeholder.
        let work_graph_png = if is_work {
            self.work_graph_png_path.clone()
        } else {
            None
        };
        let work_title = self.work_plan_graph.title.clone();
        let work_wave_count = self.work_plan_graph.waves.len();
        let work_intent_id = self
            .work_intent_id
            .clone()
            .unwrap_or_else(|| "no intent".into());
        let work_plan_state = self.work_plan_state.clone();
        let work_correlation_id = self.work_correlation_id.clone();
        let work_next_action = self.work_next_action.clone();
        let work_execution_state = self.work_execution_state.clone();
        let work_execution_id = self.work_execution_id.clone();
        let work_execution_projection = self.work_execution_projection.clone();
        let work_execution_session = self.work_execution_session.clone();
        let work_execution_worktree = self.work_execution_worktree.clone();
        // The FileTree surface (P0 Harbor wiring): clickable rows — a file row
        // opens the Editor surface; a directory row descends (rebinds the root).
        let filetree: Option<(Option<String>, Vec<FileEntry>)> = match surface {
            SurfaceKind::FileTree { root } => Some((
                root.clone(),
                filetree_entries(root.as_deref()).unwrap_or_default(),
            )),
            _ => None,
        };
        // The fleet/cockpit surfaces (focused) get the agent ops gate (kill /
        // interrupt). Both read `/agents`, so they share the roster.
        let is_fleet_ops = matches!(nav_id_for_surface(surface), Some("fleet") | Some("cockpit"));
        let dispatch_head = self.dispatch_head.clone();
        // HITL contract §4.3: an open CRITICAL interruption refuses new
        // fleet-dispatch work (the review gate's Approve), showing the ask's
        // title as the reason and deep-linking the web answer surface.
        let hitl_critical = self.hitl_gate.critical_title.clone();
        let hitl_link = self.hitl_gate.deep_link.clone();
        let gate_flash = self.control_flash.clone();
        let cond_flash = self.control_flash.clone();
        let fleet_flash = self.control_flash.clone();
        let panel_title = label.to_ascii_uppercase();
        let panel_signal = match nav_id_for_surface(surface) {
            _ if is_work => 0x006b5f,
            Some("cockpit" | "roadmap") => 0x006b5f,
            Some("ledger" | "cost") => current_theme().engaged,
            Some("claims" | "parley" | "sessions") => current_theme().landed,
            _ => current_theme().accent,
        };
        let control_flash = self.control_flash.clone();

        div()
            .id(SharedString::from(format!("pane-{id}")))
            .relative()
            // Hover group: the title-bar controls reveal only when this pane is
            // hovered (macOS window-control feel).
            .group("pane")
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(current_theme().line))
            .bg(rgb(current_theme().panel))
            .on_click(cx.listener(move |this, _ev, window, cx| {
                this.ws_mut().focus(id);
                window.focus(&this.focus_handle);
                cx.notify();
            }))
            // One knockout zone per pane, matching apps.html's panel headers.
            .child(
                div()
                    .h(px(42.0))
                    .flex()
                    .items_center()
                    .bg(rgb(current_theme().panel))
                    .border_b_1()
                    .border_color(rgb(current_theme().line))
                    .child(
                        div()
                            .h_full()
                            .px(px(13.0))
                            .flex()
                            .items_center()
                            .bg(rgb(if is_focused { panel_signal } else {
                                current_theme().raised
                            }))
                            .text_color(rgb(if is_focused {
                                knockout_ink(panel_signal)
                            } else {
                                current_theme().ink2
                            }))
                            .font_family("IBM Plex Mono")
                            .text_size(px(12.0))
                            .font_weight(FontWeight::BOLD)
                            .child(panel_title),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(7.0))
                            .mr(px(10.0))
                            .font_family("IBM Plex Mono")
                            .text_size(px(11.0))
                            .text_color(rgb(current_theme().muted))
                            .child(
                                div()
                                    .w(px(6.0))
                                    .h(px(6.0))
                                    .rounded(px(3.0))
                                    .bg(rgb(if is_focused {
                                        current_theme().landed
                                    } else {
                                        current_theme().resting
                                    })),
                            )
                            .child(if is_focused { "live" } else { "idle" }),
                    )
                    // Hover controls — invisible until the pane is hovered.
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.0))
                            .opacity(0.0)
                            .group_hover("pane", |s| s.opacity(1.0))
                            .child(pane_ctrl(id, "addpane", "+", current_theme().accent_ink, cx))
                            .child(pane_ctrl(id, "vsplit", "│", current_theme().muted, cx))
                            .child(pane_ctrl(id, "hsplit", "─", current_theme().muted, cx))
                            .child(pane_ctrl(id, "zoom", "□", current_theme().muted, cx))
                            .child(pane_ctrl(id, "close", "✕", current_theme().gated, cx)),
                    ),
            )
            // Surface body — scrollable so long rosters/ledgers/transcripts are
            // reachable instead of clipped (needs a stable id for scroll state).
            // The Work surface leads with the INLINE Vello node-graph (the
            // beautiful default view), then the per-node text/partition/contracts.
            .child({
                let body = div()
                    .id(SharedString::from(format!("pane-body-{id}")))
                    .flex_1()
                    .overflow_y_scroll()
                    // Scrolling the pane gives the flags their vertical pole velocity;
                    // they trail the motion and settle (render() drives the decay).
                    .on_scroll_wheel(cx.listener(|this, ev: &ScrollWheelEvent, window, cx| {
                        let dy = match ev.delta {
                            ScrollDelta::Pixels(p) => f32::from(p.y),
                            ScrollDelta::Lines(p) => p.y * 18.0,
                        };
                        this.flag_motion.vy = (this.flag_motion.vy - dy / 50.0).clamp(-1.6, 1.6);
                        this.kick_flag_motion(window, cx);
                    }))
                    .flex()
                    .flex_col()
                    .gap(px(if is_daemons { tokens::SPACE_2 } else { 0.0 }))
                    .px(px(if is_daemons { tokens::SPACE_3 } else { 0.0 }))
                    .pt(px(if is_daemons { tokens::SPACE_2 } else { 0.0 }))
                    .when(is_work, |body| {
                        // The LIVE native canvas is the default view (animated,
                        // interactive); the Vello PNG is an optional poster below,
                        // shown only once the operator renders it.
                        body.child(work_graph_canvas(
                            id,
                            &self.work_plan_graph,
                            self.work_selected_node.as_deref(),
                            cx,
                        ))
                        .when_some(work_graph_png, |b, path| {
                            b.child(work_graphic(id, Some(path), &work_title))
                        })
                    });
                match filetree {
                    // FileTree: interactive clickable rows (open file / descend dir).
                    Some((root, entries)) => {
                        let dir = filetree_root(root.as_deref());
                        let mut b = body.child(
                            div()
                                .px(px(16.0))
                                .pt(px(12.0))
                                .pb(px(6.0))
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(15.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(format!("files {dir}")),
                        );
                        for entry in entries {
                            b = b.child(render_filetree_row(id, entry, cx));
                        }
                        b
                    }
                    // Harbor editor: fixed header blocks (title/legend/claim
                    // flags/nudges) + ONE flex_1 virtualized code surface. The
                    // generic page-scroll `body` is deliberately NOT used —
                    // the uniform_list owns the wheel and paints only the
                    // visible line window.
                    None if editor_failure.is_some() => {
                        let (path, reason) = editor_failure
                            .expect("editor failure guard guarantees recovery details");
                        body.child(render_editor_open_failure(id, path, reason, cx))
                    }
                    None if is_editor => {
                        let editor_key_for_controls = match surface {
                            SurfaceKind::Editor { path, region } => editor_key(path, *region),
                            _ => String::new(),
                        };
                        let mut head = div().flex().flex_col().flex_shrink_0();
                        if let Some(options) = editor_options.clone() {
                            head = head.child(render_editor_toolbar(
                                id,
                                editor_key_for_controls,
                                &options,
                                cx,
                            ));
                        }
                        let mut code: Option<AnyElement> = None;
                        for blk in blocks {
                            match blk {
                                // `show_authors` is a legend hint (the agent
                                // flag in the head blocks) — the author column
                                // itself always renders per line.
                                Block::CodeBuffer { lines, gutter_cols, bands, .. } => {
                                    code = Some(render_code_buffer(
                                        id,
                                        lines,
                                        gutter_cols,
                                        bands,
                                        editor_scroll.clone(),
                                        editor_input.clone(),
                                        editor_options.as_ref(),
                                    ));
                                }
                                other => head = head.child(render_block(other, motion)),
                            }
                        }
                        div()
                            .id(SharedString::from(format!("pane-body-editor-{id}")))
                            .flex_1()
                            .overflow_hidden()
                            .flex()
                            .flex_col()
                            .child(head)
                            .when_some(code, |b, c| {
                                b.child(
                                    div()
                                        .relative()
                                        .flex_1()
                                        .overflow_hidden()
                                        .cursor(CursorStyle::IBeam)
                                        .child(c)
                                        // Keep the hit-test/input layer mounted even
                                        // while this pane is inactive. The first click
                                        // must both focus the pane and place the caret.
                                        .child(
                                            div()
                                                .absolute()
                                                .size_full()
                                                .on_mouse_down(
                                                    MouseButton::Left,
                                                    cx.listener(move |this, event, window, cx| {
                                                        this.ws_mut().focus(id);
                                                        window.focus(&this.focus_handle);
                                                        this.handle_editor_mouse_down(event, cx);
                                                    }),
                                                )
                                                .child(EditorInputElement {
                                                    view: cx.entity(),
                                                }),
                                        ),
                                )
                            })
                    }
                    None if is_daemons => body.children(daemon_rows),
                    // Sextant: the interactive embedding map (points, marquee,
                    // hover readout, selection bar, detail drawer).
                    None if is_sextant => {
                        body.child(crate::galaxy_canvas::render_galaxy(self, id, cx))
                    }
                    // Chat: bespoke bubbles from view state (three states: empty
                    // invitation / populated transcript / error banner) — never the
                    // generic Block list.
                    None if is_chat => {
                        let mut b = body;
                        if matches!(chat_state, Some(ChatState::Empty)) {
                            b = b.child(chat_empty_state());
                        }
                        if let Some(reason) = &chat_error {
                            b = b.child(chat_error_banner(reason));
                        }
                        for (i, m) in chat_msgs.iter().enumerate() {
                            b = b.child(chat_bubble(i, m, chat_reduced));
                        }
                        b
                    }
                    None if sparse_status.is_some() => {
                        body.child(story_sparse_poster(
                            id,
                            surface,
                            sparse_status.as_deref().unwrap_or_default(),
                        ))
                    }
                    // Every other surface: the generic read-agnostic Block
                    // renderer — except the two interactive Harbor blocks,
                    // which need cx listeners (clickable roster rows and
                    // compliance-gated control buttons; ch18 C3).
                    None => {
                        let mut b = body;
                        for (index, blk) in blocks.into_iter().enumerate() {
                            if index == 0
                                && matches!(&blk, Block::Header(text) if text.eq_ignore_ascii_case(&label))
                            {
                                continue;
                            }
                            b = match blk {
                                blk @ Block::NodeRow { .. } => {
                                    b.child(render_harbor_node_row(id, blk, cx))
                                }
                                blk @ Block::ControlButton { .. } => {
                                    b.child(render_harbor_control(id, blk, cx))
                                }
                                other => b.child(render_block(other, motion)),
                            };
                        }
                        b
                    }
                }
            })
            // Steering bar — only the focused agent transcript grabs the wheel.
            .when(is_agent && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(6.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .id(SharedString::from(format!("message-{id}")))
                                .px(px(12.0))
                                .py(px(5.0))
                                .bg(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().bg))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().accent_ink)))
                                .child("Message")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.command = Some(CommandLine::new(CmdKind::LaneMessage));
                                    this.control_flash =
                                        Some("type a turn for the watched agent".into());
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("attach-file-{id}")))
                                .px(px(10.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("+ File")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.command = Some(CommandLine::with_buffer(
                                        CmdKind::LaneMessage,
                                        "@file ".into(),
                                    ));
                                    this.control_flash =
                                        Some("attach a file path for the watched agent".into());
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("attach-photo-{id}")))
                                .px(px(10.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("+ Photo")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.command = Some(CommandLine::with_buffer(
                                        CmdKind::LaneMessage,
                                        "@photo ".into(),
                                    ));
                                    this.control_flash =
                                        Some("attach an image path for the watched agent".into());
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("invoke-skill-{id}")))
                                .px(px(10.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().engaged))
                                .text_color(rgb(current_theme().engaged))
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("# Skill")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.command = Some(CommandLine::with_buffer(
                                        CmdKind::LaneMessage,
                                        "@skill ".into(),
                                    ));
                                    this.control_flash =
                                        Some("name a skill for the watched agent".into());
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("request-tool-{id}")))
                                .px(px(10.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().engaged))
                                .text_color(rgb(current_theme().engaged))
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("/ Tool")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.command = Some(CommandLine::with_buffer(
                                        CmdKind::LaneMessage,
                                        "@tool ".into(),
                                    ));
                                    this.control_flash =
                                        Some("name a tool request for the watched agent".into());
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("interrupt-{id}")))
                                .px(px(12.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().gated))
                                .text_color(rgb(current_theme().gated))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("◼ Interrupt")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    if let Some(tx) = &this.control_tx {
                                        let _ = tx.send(ControlMsg::InterruptLane);
                                        this.control_flash =
                                            Some("interrupt sent — watch the stream".into());
                                        cx.notify();
                                    }
                                })),
                        )
                        .when_some(control_flash, |bar, flash| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            // Chat composer — only the focused chat pane mounts the input bar. This
            // is the rolled-own text field: the root focus handle captures keys and
            // routes them to handle_chat_key when chat is focused (gpui has no native input).
            .when(is_chat && is_focused, |content| {
                content.child(chat_composer(&chat_input, chat_reduced, cx))
            })
            // ── Dispatch review GATE (focused dispatch surface) — the operator's
            //    supervisor-worker veto: shows the head dispatch's intent + cost
            //    (stop-conditions) and Approve / Reject / Cancel. human-gate-designer:
            //    context + cost, never binary-only (Reject opens a reason line). ──
            .when(is_dispatch && is_focused, |content| {
                let head = dispatch_head.clone();
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .flex_col()
                        .gap(px(6.0))
                        .child(
                            div()
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(match &head {
                                    Some(h) => format!("REVIEW GATE · {} awaiting", h.count),
                                    None => "Review gate · queue empty".to_string(),
                                }),
                        )
                        .when_some(head.clone(), |c, h| {
                            let goal: String = h.goal.chars().take(78).collect();
                            let fmt = |o: Option<f64>| {
                                o.map(|v| format!("${v:.2}")).unwrap_or_else(|| "—".into())
                            };
                            c.child(
                                div()
                                    .text_color(rgb(current_theme().ink2))
                                    .text_size(px(14.0))
                                    .child(format!("intent: {goal}")),
                            )
                            .child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .font_family("IBM Plex Mono")
                                    .child(format!(
                                        "state {} · budget {} · spent {}",
                                        h.state,
                                        fmt(h.budget_usd),
                                        fmt(h.cost_usd)
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.0))
                                    // HITL §4.3: while a CRITICAL ask is open, the
                                    // console refuses to start new fleet work. The
                                    // Approve affordance is replaced by an honest
                                    // refusal carrying the ask's title — never a
                                    // silently dead button.
                                    .when_some(hitl_critical.clone(), |c, blocked_by| {
                                        c.child(
                                            div()
                                                .px(px(10.0))
                                                .py(px(4.0))
                                                .border_1()
                                                .border_color(rgb(current_theme().gated))
                                                .text_color(rgb(current_theme().gated))
                                                .text_size(px(13.0))
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .child(format!(
                                                    "\u{26d4} Approve blocked \u{2014} critical interruption open: {blocked_by}"
                                                )),
                                        )
                                    })
                                    .when(hitl_critical.is_none(), |c| {
                                        c.child(dispatch_gate_btn(
                                            "approve", "✓ Approve", current_theme().landed, h.id.clone(), cx,
                                        ))
                                    })
                                    .child(dispatch_gate_btn(
                                        "reject", "✗ Reject…", current_theme().gated, h.id.clone(), cx,
                                    ))
                                    .child(dispatch_gate_btn(
                                        "cancel", "⊘ Cancel", current_theme().muted, h.id.clone(), cx,
                                    )),
                            )
                            // Deep-link to the session-gated web answer surface
                            // (answer/ack is never in-app by design).
                            .when(hitl_critical.is_some(), |c| {
                                let link = hitl_link
                                    .clone()
                                    .unwrap_or_else(|| "/account/interruptions".into());
                                c.child(
                                    div()
                                        .text_color(rgb(current_theme().muted))
                                        .text_size(px(13.0))
                                        .child(format!("answer / ack \u{2192} {link}")),
                                )
                            })
                        })
                        .when_some(gate_flash, |c, flash| {
                            c.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            // ── Conductor operator GATE (focused conductor surface) — grab the
            //    wheel on the fleet: HALT (SIGTERM->SIGKILL + refund) / PAUSE
            //    (stop admitting) / RESUME. ADR-0060. MVP = whole-fleet scope;
            //    per-root targeting is a fast-follow (needs a ConductorHead).
            .when(is_conductor && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .flex_col()
                        .gap(px(6.0))
                        .child(
                            div()
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("\u{2388} Fleet control \u{2014} grab the wheel (ADR-0060)"),
                        )
                        .child(
                            div()
                                .text_color(rgb(current_theme().muted))
                                .text_size(px(13.0))
                                .child("whole-fleet scope \u{00b7} halt SIGTERM\u{2192}SIGKILL, refunds bonds"),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(8.0))
                                .child(conductor_gate_btn("halt", "\u{23fb} Halt Fleet", current_theme().conflict, cx))
                                .child(conductor_gate_btn("pause", "\u{23f8} Pause", current_theme().gated, cx))
                                .child(conductor_gate_btn("resume", "\u{25b6} Resume", current_theme().landed, cx)),
                        )
                        .when_some(cond_flash, |c, flash| {
                            c.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            // WorkPlan proof controls. Rendering is available only when the daemon
            // actually supplied nodes; an intent-captured placeholder is never
            // promoted into a decorative fake graph.
            .when(is_work && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .when(work_wave_count > 0, |row| row.child(
                            div()
                                .id("work-plan-render")
                                .px(px(12.0))
                                .py(px(5.0))
                                .border_1()
                                .border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(current_theme().raised)))
                                .child("RENDER GRAPH")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.render_work_graph();
                                    cx.notify();
                                })),
                        ))
                        .child(
                            div()
                                .text_color(rgb(current_theme().muted))
                                .text_size(px(13.0))
                                .child(format!(
                                    "{work_plan_state} \u{00b7} {work_intent_id} \u{00b7} runtime {work_execution_state} \u{00b7} {work_wave_count} daemon-authored wave(s)"
                                )),
                        )
                        .when_some(work_execution_id, |bar, execution_id| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().engaged))
                                    .text_size(px(12.0))
                                    .child(format!("receipt {execution_id}")),
                            )
                        })
                        .when_some(work_execution_projection, |bar, projection| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(12.0))
                                    .child(projection),
                            )
                        })
                        .when_some(work_execution_session, |bar, session| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(12.0))
                                    .child(format!("session {session}")),
                            )
                        })
                        .when_some(work_execution_worktree, |bar, worktree| {
                            bar.child(
                                div()
                                    .flex_1()
                                    .overflow_hidden()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(12.0))
                                    .child(format!("worktree {worktree}")),
                            )
                        })
                        .when_some(work_correlation_id, |bar, correlation| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(12.0))
                                    .child(format!("trace {correlation}")),
                            )
                        })
                        .when_some(work_next_action, |bar, action| {
                            bar.child(
                                div()
                                    .flex_1()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(12.0))
                                    .child(action),
                            )
                        })
                        .when_some(work_flash, |bar, flash| {
                            bar.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            // ── Fleet/Cockpit agent ops GATE (focused roster surface) — the
            //    operator's per-agent wheel: Kill (DELETE /agents/:id, unregister)
            //    and Interrupt (POST /agents/:id/interrupt). Both open a targeted
            //    command line that takes the agent id, rather than faking a row
            //    selection the data model doesn't carry — honest, no dead button. ──
            .when(is_fleet_ops && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .flex_col()
                        .gap(px(6.0))
                        .child(
                            div()
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .font_family("IBM Plex Mono")
                                .child("AGENT OPS · TARGET BY ID"),
                        )
                        .child(
                            div()
                                .text_color(rgb(current_theme().muted))
                                .text_size(px(14.0))
                                .child("kill = DELETE /agents/:id (unregister) \u{00b7} interrupt = stop a run"),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(8.0))
                                .child(fleet_ops_btn("kill", "KILL AGENT", current_theme().conflict, cx))
                                .child(fleet_ops_btn("interrupt", "INTERRUPT", current_theme().gated, cx)),
                        )
                        .when_some(fleet_flash, |c, flash| {
                            c.child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(14.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            // Paint focus ticks last so title and body backgrounds cannot cover
            // them. Focus is a boundary, never a glow.
            .children(if is_focused {
                corner_ticks(format!("pane-{id}"), current_theme().ink)
            } else {
                Vec::new()
            })
            .into_any_element()
    }
}

/// The one place an operator-action button's visual state machine lives —
/// default / hover / active (press), on the 8pt token grid (`tokens.rs`). The
/// dispatch review gate and the Conductor fleet gate both build on this; they
/// differ only in the click handler they pass. (Per-button keyboard
/// focus-visible is a GPUI focus-group follow-up; the actions stay reachable via
/// the focused pane.)
/// Options for [`console_button`] — the reusable interactive-control primitive.
/// Everything optional defaults off, so a bare button is `ButtonOpts::default()`.
#[derive(Default)]
struct ButtonOpts {
    /// Leading badge: one glyph (e.g. a tier initial) on a tone-washed chip.
    leading: Option<(char, u32)>,
    /// Dimmed trailing text pushed to the right edge (a port, a shortcut hint).
    trailing: Option<String>,
    /// Selected/active: a solid tone wash plus a semantic color edge.
    selected: bool,
    /// Stretch to fill the row (a list item) instead of hugging its content.
    full_width: bool,
}

/// The console's one clickable-control primitive — reuse it for every operator
/// button (daemon rows, future toolbar actions, gates) instead of hand-rolling a
/// `div`. The story-linework control language is flat: a hairline box, a
/// semantic left edge for selection, and a quiet fill on hover/press. Colours
/// read from theme roles so it survives the `Ctrl-A g` light/dark flip.
fn console_button(
    id: impl Into<SharedString>,
    label: impl Into<String>,
    color: u32,
    opts: ButtonOpts,
    cx: &mut Context<ConsoleView>,
    on_click: impl Fn(&mut ConsoleView, &mut Context<ConsoleView>) + 'static,
) -> AnyElement {
    let id: SharedString = id.into();
    let t = current_theme();

    let mut row = div()
        .id(id.clone())
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .border_1()
        .border_color(rgb(if opts.selected { color } else { t.line }))
        .when(opts.selected, |s| s.border_l_2())
        .cursor_pointer();
    if opts.full_width {
        row = row.w_full();
    }
    if opts.selected {
        row = row.bg(tone_wash(color, 0x22));
    }
    if let Some((glyph, badge)) = opts.leading {
        // Solid tone chip + luminance-picked knockout letter — high contrast and
        // crisp (matches the maritime flag badges), never a same-hue-on-same-hue
        // wash. Flex-shrink-0 so a long label can't squeeze the badge.
        row = row.child(
            div()
                .flex_shrink_0()
                .w(px(22.0))
                .h(px(18.0))
                .flex()
                .items_center()
                .justify_center()
                .bg(rgb(badge))
                .text_color(rgb(knockout_ink(badge)))
                .text_size(px(tokens::TEXT_EYEBROW))
                .font_weight(FontWeight::BOLD)
                .child(glyph.to_string()),
        );
    }
    row = row.child(
        div()
            .text_color(rgb(color))
            .text_size(px(tokens::TEXT_BODY))
            .font_weight(FontWeight::SEMIBOLD)
            .child(label.into()),
    );
    if let Some(trailing) = opts.trailing {
        row = row.child(div().flex_1()).child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(tokens::TEXT_CAPTION))
                .child(trailing),
        );
    }

    // Cheap GPU-side interaction lane — restyles without a notify or re-render.
    row = row
        .hover(move |s| s.bg(rgb(current_theme().raised)).border_color(rgb(color)))
        .active(move |s| s.bg(tone_wash(color, 0x28)))
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            on_click(this, cx);
            cx.notify();
        }));

    row.into_any_element()
}

/// A baked still of the living-harbor water shader as a bounded banner. The
/// asset is a single offscreen-rendered frame of `pd-harbor-proto/harbor.wgsl`
/// (Method-A, no window), kept at the panel's accent border. `ObjectFit::Cover`
/// crops to the band rather than stretching the 2:1 frame. Static by design —
/// no per-frame re-render — which also makes it reduced-motion-correct for free.
fn harbor_banner() -> AnyElement {
    div()
        .h(px(132.0))
        .w_full()
        .flex_shrink_0()
        .overflow_hidden()
        .border_1()
        .border_color(rgb(current_theme().line))
        .mb(px(tokens::SPACE_2))
        .child(
            img("harbor-backdrop.png")
                .size_full()
                .object_fit(ObjectFit::Cover),
        )
        .into_any_element()
}

/// Tier → theme colour for a daemon berth (meaning, resolved to a theme role so
/// the light⇄dark flip re-skins it): stable = mint "landed", dev-latest = cobalt,
/// a named codebase berth = amber "engaged".
fn daemon_tone_color(tier: &str, t: &Theme) -> u32 {
    match tier {
        "stable" => t.landed,
        "dev-latest" => t.cobalt,
        _ => t.engaged,
    }
}

fn gate_btn(
    id: impl Into<SharedString>,
    label: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
    on_click: impl Fn(&mut ConsoleView, &mut Context<ConsoleView>) + 'static,
) -> impl IntoElement {
    div()
        .id(id.into())
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_1))
        .border_1()
        .border_color(rgb(color))
        .text_color(rgb(color))
        .text_size(px(tokens::TEXT_BODY))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| s.bg(tone_wash(color, 0x22)))
        .active(|s| s.bg(rgb(current_theme().sunken)))
        .child(label)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            on_click(this, cx);
            cx.notify();
        }))
}

/// One fleet/cockpit agent-ops button. Both open a targeted command line that
/// takes the agent id: `kill` → `CmdKind::Kill` (DELETE /agents/:id); `interrupt`
/// → reuses the Lane's interrupt path scoped to the typed agent. Opening a
/// command line keeps the trigger honest: the operator names the agent, then the
/// ControlMsg fires on submit.
fn fleet_ops_btn(
    action: &'static str,
    label: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    console_button(
        SharedString::from(format!("fleetops-{action}")),
        label,
        color,
        ButtonOpts::default(),
        cx,
        move |this, _cx| match action {
            "kill" => {
                this.command = Some(CommandLine::new(CmdKind::Kill));
            }
            "interrupt" => {
                this.command = Some(CommandLine::new(CmdKind::InterruptAgent));
            }
            _ => {}
        },
    )
}

/// Commitment → render accent (mirrors the Vello scene's `commitment_color`):
/// COMMITTED is the strongest signal (canary), EXPLORATORY the faintest.
fn commitment_accent(level: &str) -> u32 {
    let t = current_theme();
    match level.to_ascii_uppercase().as_str() {
        "COMMITTED" => t.accent,
        "TENTATIVE" => t.cobalt,
        "EXPLORATORY" => t.muted,
        _ => t.line,
    }
}

/// Vendor-distinct chip accent (mirrors the Vello scene's `vendor_accent`): the
/// tier label renders verbatim, but the chip color reads the vendor family so the
/// operator scans vendors at a glance.
///
/// This is a DISPLAY-ONLY lookup against the WorkPlan/predicted-DAG's own
/// `model_tier` vocabulary (vendor nicknames — "opus"/"sonnet"/"haiku"/
/// "gemini"/"codex"/"gpt"/"o1"/"o3"/"groq"/"llama"/"mixtral", see
/// work_plan.rs's `PredictedNode::model_tier`) — it never selects a backend
/// or spawns anything (per this crate's own doc comment: "the console has no
/// backend/model selection or direct spawn... launch path", agent.rs:1-6).
///
/// EXACT-token match, not substring `contains()` (ADR-0057 model-abstraction
/// unification — `contains()` is exactly the keyword/substring-NLP pattern
/// the house rule forbids, and it risks a false-positive chip color on any
/// tier label that merely CONTAINS a vendor nickname as a substring of an
/// unrelated word). An unrecognized token falls through to the neutral
/// `t.muted` — never a vendor default.
fn vendor_accent(tier: &str) -> u32 {
    let t = current_theme();
    let s = tier.to_ascii_lowercase();
    let tokens: Vec<&str> = s
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|tok| !tok.is_empty())
        .collect();
    let has_any = |names: &[&str]| tokens.iter().any(|tok| names.contains(tok));
    if has_any(&["opus", "sonnet", "haiku", "claude"]) {
        t.accent
    } else if has_any(&["gemini"]) {
        t.landed
    } else if has_any(&["codex", "gpt", "o1", "o3"]) {
        0x_b6_9c_ff // violet — no palette role, matches the Vello codex chip
    } else if has_any(&["groq", "llama", "mixtral"]) {
        t.engaged
    } else {
        t.muted
    }
}

/// Truncate to `max` chars on a char boundary, with an ellipsis.
fn trunc_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let kept: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{kept}\u{2026}")
    }
}

/// One interactive node in the WorkPlan wave deck. Wave color owns the boundary;
/// commitment and HITL remain explicit text so color never carries state alone.
fn work_node_card(
    id: PaneId,
    node: &crate::work_plan::PredictedNode,
    wave_color: u32,
    is_selected: bool,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let theme = current_theme();
    let commitment_color = commitment_accent(&node.commitment_level);
    let vchip = vendor_accent(&node.model_tier);
    let nid = node.id.clone();
    let skill = trunc_chars(&node.skill_id, 30);
    let role = trunc_chars(&node.role_description, 116);
    let model = if node.model_tier.is_empty() {
        "\u{2014}".to_string()
    } else {
        trunc_chars(&node.model_tier, 14)
    };
    let metrics = format!(
        "${:.2} \u{00b7} {:.0}m{}",
        node.estimated_cost_usd,
        node.estimated_minutes,
        if node.cascade_depth > 0 {
            format!(" \u{00b7} casc {}", node.cascade_depth)
        } else {
            String::new()
        }
    );
    let gate = node.ask_user_before_proceeding;
    let border = if gate {
        theme.gated
    } else if is_selected {
        theme.accent_ink
    } else {
        wave_color
    };
    let bg = if is_selected {
        theme.raised
    } else {
        theme.panel
    };

    div()
        .id(SharedString::from(format!("work-plan-card-{id}-{nid}")))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        .min_h(px(132.0))
        .p(px(14.0))
        .border_1()
        .border_t_2()
        .border_color(rgb(border))
        .bg(rgb(bg))
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(theme.raised)).border_color(rgb(theme.accent_ink)))
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.work_selected_node = Some(nid.clone());
            crate::audio::play(crate::audio::Cue::Tick);
            cx.notify();
        }))
        // Header: skill plus a textual lifecycle marker.
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(theme.ink))
                        .child(skill),
                )
                .child(
                    div()
                        .px(px(5.0))
                        .py(px(2.0))
                        .bg(rgb(if gate { theme.gated } else { commitment_color }))
                        .text_color(rgb(knockout_ink(if gate {
                            theme.gated
                        } else {
                            commitment_color
                        })))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .child(if gate {
                            "GATE".to_string()
                        } else {
                            node.commitment_level.to_uppercase()
                        }),
                ),
        )
        // Role — what this agent does in context.
        .child(
            div()
                .text_size(px(14.0))
                .text_color(rgb(theme.ink))
                .child(role),
        )
        // Footer: solid provider knockout plus cost/time receipt.
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(3.0))
                        .bg(rgb(vchip))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(knockout_ink(vchip)))
                        .child(model),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(rgb(theme.landed))
                        .child(metrics),
                ),
        )
        .into_any_element()
}

/// The LIVE, interactive WorkPlan graph rendered natively in gpui — the
/// default view of the Work surface. Replaces the static Vello PNG as the
/// primary graphic: wave columns of [`work_node_card`]s (commitment-themed,
/// breathing, hover-lit, clickable), an editorial header, and — when a node is
/// selected — a full inspector drawer. The Vello PNG remains reachable as an
/// optional "poster" beneath, rendered on demand by the "Render graph" action.
fn work_graph_canvas(
    id: PaneId,
    dag: &crate::work_plan::PredictedDag,
    selected: Option<&str>,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let theme = current_theme();
    let n_nodes: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
    let title = if dag.title.is_empty() {
        "work plan".to_string()
    } else {
        dag.title.clone()
    };
    let classification = if dag.problem_classification.is_empty() {
        "unclassified".to_string()
    } else {
        dag.problem_classification.clone()
    };
    let meta = format!(
        "{classification}  \u{00b7}  {} waves  \u{00b7}  {} nodes  \u{00b7}  ~{:.0}m  \u{00b7}  ${:.2}  \u{00b7}  {:.0}% confidence",
        dag.waves.len(),
        n_nodes,
        dag.estimated_total_minutes,
        dag.estimated_total_cost_usd,
        dag.confidence * 100.0,
    );

    // Wave columns — a horizontal lane per wave, each a stack of node cards.
    let columns: Vec<AnyElement> = dag
        .waves
        .iter()
        .map(|wave| {
            let wave_color = if wave
                .nodes
                .iter()
                .any(|node| node.ask_user_before_proceeding)
            {
                theme.gated
            } else if wave.parallelizable {
                theme.accent
            } else if wave.wave_number == 1 {
                theme.engaged
            } else {
                theme.landed
            };
            let cap = format!(
                "WAVE {}  {}",
                wave.wave_number,
                if wave.parallelizable {
                    "//  PARALLEL"
                } else {
                    "\u{00b7}  SERIAL"
                }
            );
            let cards: Vec<AnyElement> = wave
                .nodes
                .iter()
                .map(|node| {
                    work_node_card(id, node, wave_color, selected == Some(node.id.as_str()), cx)
                })
                .collect();
            div()
                .flex_1()
                .min_w(px(250.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(wave_color))
                        .child(cap),
                )
                .children(cards)
                .into_any_element()
        })
        .collect();

    // The selected node's full inspector (role, why, contracts, model, cost…).
    let inspector: Option<AnyElement> = selected
        .and_then(|sel| {
            dag.waves
                .iter()
                .flat_map(|w| &w.nodes)
                .find(|n| n.id == sel)
        })
        .map(|node| work_node_inspector(node, cx));

    div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .px(px(12.0))
        .pt(px(12.0))
        .pb(px(8.0))
        // Eyebrow.
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(theme.accent_ink))
                .child(SharedString::from(format!(
                    "WORK \u{00b7} DAEMON PLAN \u{00b7} {}",
                    title.to_uppercase()
                ))),
        )
        // Meta strip.
        .child(
            div()
                .text_size(px(14.0))
                .text_color(rgb(theme.muted))
                .font_family("IBM Plex Mono")
                .child(meta),
        )
        // The scrolling wave-column canvas.
        .child(
            div()
                .id(SharedString::from(format!("work-plan-cols-{id}")))
                .flex()
                .gap(px(20.0))
                .py(px(8.0))
                .overflow_x_scroll()
                .children(columns),
        )
        .when_some(inspector, |c, insp| c.child(insp))
        .into_any_element()
}

/// The node inspector drawer — the rich click-inspection the operator asked for:
/// every field of the selected node, in full, with a close affordance.
fn work_node_inspector(
    node: &crate::work_plan::PredictedNode,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let theme = current_theme();
    let accent = commitment_accent(&node.commitment_level);
    let row = |k: &'static str, v: String| {
        div()
            .flex()
            .gap(px(10.0))
            .child(
                div()
                    .w(px(140.0))
                    .flex_shrink_0()
                    .text_size(px(13.0))
                    .text_color(rgb(theme.muted))
                    .child(k),
            )
            .child(
                div()
                    .flex_1()
                    .text_size(px(13.0))
                    .text_color(rgb(theme.ink2))
                    .child(v),
            )
    };

    div()
        .mt(px(6.0))
        .p(px(14.0))
        .border_1()
        .border_l_2()
        .border_color(rgb(accent))
        .bg(rgb(theme.raised))
        .flex()
        .flex_col()
        .gap(px(6.0))
        // Title row: skill id + commitment + a close ✕.
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(15.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(accent))
                        .child(SharedString::from(format!(
                            "{}  \u{00b7}  {}",
                            node.skill_id,
                            node.commitment_level.to_uppercase()
                        ))),
                )
                .child(
                    div()
                        .id("work-plan-inspector-close")
                        .px(px(8.0))
                        .py(px(2.0))
                        .border_l_1()
                        .border_color(rgb(theme.line))
                        .cursor_pointer()
                        .text_size(px(13.0))
                        .text_color(rgb(theme.muted))
                        .hover(move |s| s.text_color(rgb(theme.ink)).bg(rgb(theme.panel)))
                        .on_click(cx.listener(|this, _ev, _window, cx| {
                            this.work_selected_node = None;
                            cx.notify();
                        }))
                        .child("\u{2715} close"),
                ),
        )
        .child(row("role", node.role_description.clone()))
        .when(!node.why.is_empty(), |c| {
            c.child(row("why", node.why.clone()))
        })
        .when(!node.input_contract.is_empty(), |c| {
            c.child(row("input contract", node.input_contract.clone()))
        })
        .when(!node.output_contract.is_empty(), |c| {
            c.child(row("output contract", node.output_contract.clone()))
        })
        .child(row(
            "model tier",
            if node.model_tier.is_empty() {
                "\u{2014}".to_string()
            } else {
                node.model_tier.clone()
            },
        ))
        .child(row(
            "estimate",
            format!(
                "${:.2}  \u{00b7}  {:.0} min  \u{00b7}  cascade {}",
                node.estimated_cost_usd, node.estimated_minutes, node.cascade_depth
            ),
        ))
        .when(node.ask_user_before_proceeding, |c| {
            c.child(
                div()
                    .text_size(px(13.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(theme.gated))
                    .child(
                        "HITL GATE \u{2014} this node stops for your confirmation before it runs",
                    ),
            )
        })
        .into_any_element()
}

/// The INLINE Vello node-graph at the top of the Work surface — the beautiful
/// default view the operator most wants. When a PNG has been rendered, it shows
/// the graph image sized to fit the pane (capped width, rounded, maritime frame);
/// until then it shows a tasteful "rendering graph…" placeholder so the region is
/// never blank. The image is loaded from an ABSOLUTE path via `gpui::img(PathBuf)`
/// (a `Resource::Path` read directly off disk — NOT through the embedded asset
/// source), so it works for the live-rendered PNG outside the `assets/` dir.
fn work_graphic(id: PaneId, png: Option<std::path::PathBuf>, title: &str) -> impl IntoElement {
    let frame = div()
        .id(SharedString::from(format!("work-plan-graphic-{id}")))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .px(px(12.0))
        .pt(px(12.0))
        .pb(px(8.0));

    // An eyebrow label above the graphic (12px is allowed for an uppercase,
    // tracked-out, ≥600-weight eyebrow per the type-accessibility rule).
    let eyebrow = div()
        .text_color(rgb(current_theme().muted))
        .text_size(px(12.0))
        .font_weight(FontWeight::SEMIBOLD)
        .child(SharedString::from(format!(
            "PREDICTED DAG \u{00b7} {}",
            title.to_uppercase()
        )));

    match png {
        Some(path) => frame.child(eyebrow).child(
            // The Vello PNG, framed and sized to fit the pane width. The image is
            // read straight off disk (PathBuf ⇒ Resource::Path).
            div()
                .w_full()
                .border_1()
                .border_color(rgb(current_theme().line))
                .bg(rgb(current_theme().bg))
                .overflow_hidden()
                .child(
                    img(path)
                        .w_full()
                        .max_w(px(900.0))
                        .h(px(360.0))
                        .object_fit(ObjectFit::Contain),
                ),
        ),
        None => frame.child(eyebrow).child(
            // Placeholder: a calm maritime card while the offscreen Vello render
            // builds (release build is multi-second on first run).
            div()
                .w_full()
                .h(px(360.0))
                .max_w(px(900.0))
                .border_1()
                .border_color(rgb(current_theme().line))
                .bg(rgb(current_theme().raised))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_color(rgb(current_theme().accent_ink))
                        .text_size(px(15.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("rendering graph\u{2026}"),
                )
                .child(
                    div()
                        .text_color(rgb(current_theme().muted))
                        .text_size(px(14.0))
                        .child("the Vello node-graph appears here when the offscreen render lands"),
                ),
        ),
    }
}

/// One always-visible operator-toolbar button. Clicking it opens the matching
/// GUI input (placeholder-guided, no leader key, no memorized syntax) — the
/// discoverable face of the spawn / cartographer / add-pane commands. This is
/// the difference between an operator console and a CLI with hidden options.
fn command_bar_btn(
    kind: CmdKind,
    label: &'static str,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let accent = current_theme().accent;
    div()
        .id(SharedString::from(format!("cmdbar-{}", kind.prompt())))
        .h_full()
        .px(px(12.0))
        .flex()
        .items_center()
        .border_l_1()
        .border_color(rgb(current_theme().line))
        .text_color(rgb(current_theme().ink2))
        .font_family("IBM Plex Mono")
        .text_size(px(12.0))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| {
            s.bg(rgb(current_theme().raised))
                .border_color(rgb(accent))
                .text_color(rgb(current_theme().accent_ink))
        })
        .child(label)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.command = Some(CommandLine::new(kind));
            cx.notify();
        }))
}

/// Visible light/dark control. The old `Ctrl-A g` path still works; this makes
/// the theme a discoverable operator action in the chrome.
fn theme_toggle_btn(cx: &mut Context<ConsoleView>) -> impl IntoElement {
    let theme = current_theme();
    let label = match theme.mode {
        ThemeMode::Dark => "LIGHT",
        ThemeMode::Light => "DARK",
    };
    div()
        .id("theme-toggle")
        .px(px(tokens::SPACE_2))
        .py(px(tokens::SPACE_1))
        .border_1()
        .border_color(rgb(theme.line))
        .bg(rgb(theme.panel))
        .text_color(rgb(theme.ink2))
        .text_size(px(tokens::TEXT_CAPTION))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .flex()
        .items_center()
        .hover(|s| {
            let t = current_theme();
            s.bg(rgb(t.raised))
                .border_color(rgb(t.accent))
                .text_color(rgb(t.accent_ink))
        })
        .child(label)
        .on_click(cx.listener(|this, _ev, _window, cx| {
            toggle_theme();
            this.control_flash = Some(format!("theme → {}", current_theme().mode.label()));
            cx.notify();
        }))
}

/// Visible motion policy control. Reduced motion is a state-preserving mode:
/// travel and pulses stop immediately while color, edge, and labels remain.
fn motion_toggle_btn(cx: &mut Context<ConsoleView>) -> impl IntoElement {
    let reduced = reduced_motion();
    let theme = current_theme();
    div()
        .id("motion-toggle")
        .px(px(tokens::SPACE_2))
        .py(px(tokens::SPACE_1))
        .border_1()
        .border_color(rgb(if reduced { theme.engaged } else { theme.line }))
        .bg(rgb(theme.panel))
        .text_color(rgb(if reduced { theme.engaged } else { theme.ink2 }))
        .text_size(px(tokens::TEXT_CAPTION))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(|style| {
            let t = current_theme();
            style
                .bg(rgb(t.raised))
                .border_color(rgb(t.accent))
                .text_color(rgb(t.accent_ink))
        })
        .child(if reduced {
            "MOTION REDUCED"
        } else {
            "MOTION ON"
        })
        .on_click(cx.listener(|this, _event, _window, cx| {
            toggle_motion();
            if reduced_motion() {
                this.flag_motion.vx = 0.0;
                this.flag_motion.vy = 0.0;
                this.flag_ticking = false;
            }
            this.control_flash = Some(if reduced_motion() {
                "motion reduced; state edges remain visible".into()
            } else {
                "motion enabled".into()
            });
            cx.notify();
        }))
}

// ── Operator chat — bespoke bubbles + the rolled-own composer ─────────────────

/// One chat turn in the shared linework grammar. Operator and agent alignment is
/// retained; square boundaries and a cobalt rail carry identity without cards.
fn chat_bubble(idx: usize, msg: &ChatMsg, reduced: bool) -> AnyElement {
    let t = current_theme();
    let mine = msg.mine;
    let sender_label = if mine {
        "you".to_string()
    } else {
        chat_display_text(&msg.sender)
    };

    // Eyebrow: who spoke (caption weight) — color = meaning, plus the label so a
    // role is never conveyed by color alone.
    let eyebrow = div()
        .text_color(rgb(t.muted))
        .text_size(px(tokens::TEXT_CAPTION))
        .font_weight(FontWeight::SEMIBOLD)
        .child(sender_label);
    let body = div()
        .text_color(rgb(if mine { t.accent_ink } else { t.ink }))
        .text_size(px(tokens::TEXT_BODY))
        .child(chat_display_text(&msg.text));

    let bubble: Div = if mine {
        div()
            .max_w(px(560.0)) // ~62ch at 14px
            .flex()
            .flex_col()
            .gap(px(tokens::SPACE_1))
            .px(px(tokens::SPACE_3))
            .py(px(tokens::SPACE_2))
            .border_1()
            .border_color(rgb(t.accent))
            .bg(rgb(t.raised))
            .child(eyebrow)
            .child(body)
    } else {
        // The cobalt rail is a child div (a fixed-width colored strip), exactly the
        // render_block Header rail idiom — guaranteed across gpui border helpers.
        div()
            .max_w(px(560.0))
            .flex()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(t.line))
            .bg(rgb(t.panel))
            .child(div().w(px(4.0)).bg(rgb(t.cobalt)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(tokens::SPACE_1))
                    .px(px(tokens::SPACE_3))
                    .py(px(tokens::SPACE_2))
                    .child(eyebrow)
                    .child(body),
            )
    };

    // Bloom-in: a one-shot 220ms swoosh fade. Reduced-motion → static full opacity.
    let bubble_el: AnyElement = if reduced {
        bubble.into_any_element()
    } else {
        bubble
            .with_animation(
                SharedString::from(format!("chat-bloom-{idx}")),
                Animation::new(Duration::from_millis(220)).with_easing(motion::swoosh),
                |el: Div, delta| el.opacity(delta),
            )
            .into_any_element()
    };

    // Alignment via spacer divs (no justify_* dependency): mine → push right,
    // agent → push left.
    let row = div()
        .w_full()
        .flex()
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_1));
    if mine {
        row.child(div().flex_1())
            .child(bubble_el)
            .into_any_element()
    } else {
        row.child(bubble_el)
            .child(div().flex_1())
            .into_any_element()
    }
}

/// The empty chat state — an honest invitation, never a blank pane.
fn chat_empty_state() -> AnyElement {
    let t = current_theme();
    div()
        .flex()
        .flex_col()
        .gap(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_4))
        .pt(px(tokens::SPACE_4))
        .child(
            div()
                .text_color(rgb(t.ink))
                .text_size(px(tokens::TEXT_BODY_LG))
                .font_weight(FontWeight::SEMIBOLD)
                .child("Talk to the cartographer"),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(tokens::TEXT_BODY))
                .child(
                    "Type below and press Enter. Your turn rides up the console-chat tube; \
                     replies stream back here as they land.",
                ),
        )
        .into_any_element()
}

/// The chat error banner: a refused transport or WorkIntent capture, never swallowed.
fn chat_error_banner(reason: &str) -> AnyElement {
    let t = current_theme();
    div()
        .mx(px(tokens::SPACE_3))
        .my(px(tokens::SPACE_1))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .border_1()
        .border_l_2()
        .border_color(rgb(t.gated))
        .bg(tone_wash(t.gated, 0x1c))
        .child(
            div()
                .text_color(rgb(t.gated))
                .text_size(px(tokens::TEXT_BODY))
                .font_weight(FontWeight::SEMIBOLD)
                .child(chat_error_display_text(reason)),
        )
        .into_any_element()
}

/// The blinking composer caret — a painted "▏" in accent, pulsed over 1100ms
/// (skipped under reduced-motion: a static caret).
fn chat_caret(reduced: bool) -> AnyElement {
    let t = current_theme();
    let caret = div()
        .text_color(rgb(t.accent))
        .text_size(px(tokens::TEXT_BODY))
        .child("\u{258F}");
    if reduced {
        return caret.into_any_element();
    }
    caret
        .with_animation(
            SharedString::from("chat-caret"),
            Animation::new(Duration::from_millis(1100))
                .repeat()
                .with_easing(pulsating_between(0.0, 1.0)),
            |el, delta| el.opacity(delta),
        )
        .into_any_element()
}

/// The chat composer row — a sunken field that shows the rolled-own `chat_input`
/// buffer (or a ghost placeholder) + the blinking caret, with a Send button. The
/// load-bearing text input: gpui 0.2.2 has no native field, so keydown fills the
/// buffer and this renders it.
fn chat_composer(input: &str, reduced: bool, cx: &mut Context<ConsoleView>) -> AnyElement {
    let t = current_theme();
    div()
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .border_t_1()
        .border_color(rgb(t.line))
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .items_center()
                .gap(px(4.0))
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .bg(rgb(t.sunken))
                .border_1()
                .border_color(rgb(t.line))
                .child(
                    div()
                        .text_color(rgb(t.accent_ink))
                        .text_size(px(tokens::TEXT_BODY))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("\u{203A}"),
                )
                .child({
                    let field = div()
                        .flex_1()
                        .min_w(px(0.0))
                        .text_size(px(tokens::TEXT_BODY))
                        .font_family("IBM Plex Mono");
                    if input.is_empty() {
                        field.text_color(rgb(t.muted)).child(
                            "Message the cartographer…  (Enter to send · Shift+Enter newline)",
                        )
                    } else {
                        field.text_color(rgb(t.ink)).child(chat_display_text(input))
                    }
                })
                .child(chat_caret(reduced)),
        )
        .child(
            div()
                .id("chat-send")
                .flex_shrink_0()
                .min_w(px(54.0))
                .px(px(12.0))
                .py(px(5.0))
                .bg(rgb(t.accent))
                .text_color(rgb(t.bg))
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .cursor_pointer()
                .hover(|s| s.bg(rgb(t.accent_ink)))
                .child("Send")
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    this.submit_chat();
                    cx.notify();
                })),
        )
        .into_any_element()
}

/// Render the open command line: one label, one text field, Send/Cancel.
fn render_open_command(cmd: &CommandLine, cx: &mut Context<ConsoleView>) -> AnyElement {
    let prompt_label = cmd.kind.prompt().to_string();
    let placeholder = cmd.kind.placeholder();
    div()
        .flex()
        .gap(px(8.0))
        .items_center()
        .w_full()
        .child(
            div()
                .text_color(rgb(current_theme().accent_ink))
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(prompt_label),
        )
        .child({
            let field = div()
                .flex_1()
                .text_size(px(14.0))
                .font_family("IBM Plex Mono");
            if cmd.buffer.is_empty() {
                field
                    .text_color(rgb(current_theme().muted))
                    .child(placeholder.to_string())
            } else {
                field
                    .text_color(rgb(current_theme().ink))
                    .child(format!("› {}▏", cmd.buffer))
            }
        })
        .child(
            div()
                .id("cmd-send")
                .px(px(12.0))
                .py(px(4.0))
                .bg(rgb(current_theme().accent))
                .text_color(rgb(current_theme().bg))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .cursor_pointer()
                .hover(|s| s.bg(rgb(current_theme().accent_ink)))
                .child("Send")
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    if let Some(cmd) = this.command.take() {
                        this.submit_command(cmd);
                    }
                    cx.notify();
                })),
        )
        .child(
            div()
                .id("cmd-cancel")
                .px(px(8.0))
                .py(px(4.0))
                .border_l_1()
                .border_color(rgb(current_theme().line))
                .text_color(rgb(current_theme().muted))
                .text_size(px(13.0))
                .cursor_pointer()
                .hover(|s| s.text_color(rgb(current_theme().ink2)))
                .child("Cancel")
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    this.command = None;
                    cx.notify();
                })),
        )
        .into_any_element()
}

/// One dispatch review-gate button. Approve/Cancel fire a verdict immediately;
/// Reject opens a reason command line (the human-gate "why" path) targeting `id`.
fn dispatch_gate_btn(
    action: &'static str,
    label: &'static str,
    color: u32,
    id: String,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    gate_btn(
        format!("gate-{action}"),
        label,
        color,
        cx,
        move |this, _cx| match action {
            "approve" => {
                if let Some(tx) = &this.control_tx {
                    let _ = tx.send(ControlMsg::DispatchAccept { id: id.clone() });
                }
                this.control_flash = Some("gate approved \u{2192} landing".into());
            }
            "cancel" => {
                if let Some(tx) = &this.control_tx {
                    let _ = tx.send(ControlMsg::DispatchCancel { id: id.clone() });
                }
                this.control_flash = Some("gate cancelled".into());
            }
            "reject" => {
                this.reject_target = Some(id.clone());
                this.command = Some(CommandLine::new(CmdKind::DispatchReject));
            }
            _ => {}
        },
    )
}

/// One Conductor fleet-control button (ADR-0060): halt/pause/resume the whole
/// fleet (global scope) — the operator's emergency wheel.
fn conductor_gate_btn(
    action: &'static str,
    label: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    gate_btn(
        format!("fleet-{action}"),
        label,
        color,
        cx,
        move |this, _cx| {
            if let Some(tx) = &this.control_tx {
                let msg = match action {
                    "halt" => Some(ControlMsg::FleetHalt { root_id: None }),
                    "pause" => Some(ControlMsg::FleetPause { root_id: None }),
                    "resume" => Some(ControlMsg::FleetResume { root_id: None }),
                    _ => None,
                };
                if let Some(m) = msg {
                    let _ = tx.send(m);
                }
            }
            this.control_flash = Some(match action {
                "halt" => {
                    "fleet halt sent \u{2192} SIGTERM\u{2192}SIGKILL, bonds refunded".to_string()
                }
                "pause" => "fleet paused \u{2192} no new admissions".to_string(),
                "resume" => "fleet resumed".to_string(),
                _ => String::new(),
            });
        },
    )
}

/// Parse a verb-palette line (`<verb> <args>`) into its concrete `CmdKind` plus
/// the trimmed argument string. The verb is the first whitespace-delimited token;
/// everything after is the argument (which may be empty for `done`). Returns
/// `None` for an unknown or retired launch verb so the caller can show migration
/// guidance instead of quietly aliasing a second runtime model.
fn parse_verb(text: &str) -> Option<(CmdKind, String)> {
    let trimmed = text.trim();
    let (verb, arg) = match trimmed.split_once(char::is_whitespace) {
        Some((v, rest)) => (v, rest.trim().to_string()),
        None => (trimmed, String::new()),
    };
    let verb = verb.to_lowercase();
    match verb.as_str() {
        "attach" | "file" => return Some((CmdKind::LaneMessage, format!("@file {arg}"))),
        "photo" | "image" => return Some((CmdKind::LaneMessage, format!("@photo {arg}"))),
        "skill" => return Some((CmdKind::LaneMessage, format!("@skill {arg}"))),
        "tool" => return Some((CmdKind::LaneMessage, format!("@tool {arg}"))),
        _ => {}
    }
    let kind = match verb.as_str() {
        "work" => CmdKind::Work,
        "note" => CmdKind::Note,
        "begin" => CmdKind::Begin,
        "done" | "end" => CmdKind::Done,
        "claim" => CmdKind::Claim,
        "release" => CmdKind::Release,
        "kill" => CmdKind::Kill,
        "interrupt" | "stop" => CmdKind::InterruptAgent,
        "cartographer" | "chat" => CmdKind::Cartographer,
        "lane" | "message" | "steer" => CmdKind::LaneMessage,
        "pane" | "addpane" => CmdKind::AddPane,
        _ => return None,
    };
    Some((kind, arg))
}

fn is_legacy_launch_verb(verb: &str) -> bool {
    matches!(
        verb.trim().to_ascii_lowercase().as_str(),
        "agent" | "conjure" | "dispatch" | "new" | "propose" | "sortie" | "spawn"
    )
}

/// One macOS-style pane control (split / zoom / close). Targets a specific pane
/// `id` (it focuses that pane first, so a click acts where the cursor is, not on
/// whatever was focused before).
fn pane_ctrl(
    id: PaneId,
    kind: &'static str,
    glyph: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    div()
        .id(SharedString::from(format!("ctrl-{kind}-{id}")))
        .px(px(5.0))
        .py(px(1.0))
        .text_size(px(14.0))
        .text_color(rgb(color))
        .cursor_pointer()
        // Hover is a quiet fill and tint; pane focus remains the corner-tick cue.
        .hover(move |s| {
            let t = current_theme();
            let tint = if kind == "close" { t.gated } else { t.ink };
            s.bg(rgb(t.raised)).text_color(rgb(tint))
        })
        .child(glyph)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            match kind {
                "vsplit" => {
                    this.ws_mut().focus(id);
                    let s = this.ws_mut().focused_surface().clone();
                    this.ws_mut().split(Dir::Row, s);
                }
                "hsplit" => {
                    this.ws_mut().focus(id);
                    let s = this.ws_mut().focused_surface().clone();
                    this.ws_mut().split(Dir::Col, s);
                }
                "zoom" => this.toggle_zoom(id),
                "close" => {
                    this.ws_mut().focus(id);
                    this.ws_mut().close();
                }
                // Mouse-driven "add a pane of a kind": focus this pane, then open
                // the surface picker (same flow as Ctrl-A i).
                "addpane" => {
                    this.ws_mut().focus(id);
                    this.command = Some(CommandLine::new(CmdKind::AddPane));
                }
                _ => {}
            }
            cx.notify();
        }))
}

/// One clickable FileTree row. Activating a **file** focuses this pane and swaps
/// it to the Harbor Editor surface on that file; activating a **directory**
/// rebinds the FileTree root to descend (the existing expand behavior). This is
/// the P0 `FileTree → open-in-Editor` wiring.
/// Clickable Harbor roster row (binder ch18 C3): clicking selects the node and
/// retargets the conjoined detail pane — the operator never types an id. Live
/// rows carry the breathing dot + engaged tone; historical rows are hollow.
fn render_harbor_node_row(
    id: PaneId,
    block: Block,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let Block::NodeRow {
        index,
        selected,
        live,
        flag,
        name,
        badge,
        badge_tone,
        meta,
        age,
        tone,
    } = block
    else {
        unreachable!("render_harbor_node_row called with a non-NodeRow block");
    };
    let t = current_theme();
    let row_tone = tone_rgb(&tone);
    let badge_color = tone_rgb(&badge_tone);
    div()
        .id(SharedString::from(format!("harbor-row-{id}-{index}")))
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .mx(px(tokens::SPACE_3))
        .my(px(2.0))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .border_1()
        .when(selected, |s| s.border_l_2())
        .border_color(rgb(if selected { t.accent } else { t.line }))
        .bg(rgb(if selected { t.raised } else { t.panel }))
        .cursor_pointer()
        .hover(|s| {
            let t = current_theme();
            s.bg(rgb(t.raised)).border_color(rgb(t.accent))
        })
        // Live vs historical: filled breathing marker vs hollow static one.
        .child(
            div()
                .text_color(rgb(row_tone))
                .text_size(px(13.0))
                .flex_shrink_0()
                .child(if live { "●" } else { "○" }),
        )
        .child(
            div()
                .flex()
                .items_center()
                .flex_shrink_0()
                .child(div().w(px(7.0)).h(px(10.0)).bg(rgb(row_tone)))
                .child(div().w(px(7.0)).h(px(10.0)).bg(rgb(badge_color)))
                .child(
                    div()
                        .ml(px(4.0))
                        .text_color(rgb(row_tone))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .child(flag.to_string()),
                ),
        )
        .child(
            div()
                .text_color(rgb(t.ink))
                .text_size(px(tokens::TEXT_BODY))
                .font_weight(FontWeight::SEMIBOLD)
                .child(name),
        )
        .child(
            div()
                .text_color(rgb(badge_color))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(badge),
        )
        .child(
            div()
                .flex_1()
                .text_color(rgb(t.muted))
                .text_size(px(13.0))
                .font_family("IBM Plex Mono")
                .overflow_hidden()
                .child(meta),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(13.0))
                .font_family("IBM Plex Mono")
                .flex_shrink_0()
                .child(age),
        )
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.ws_mut().focus(id);
            if let Some(tx) = &this.control_tx {
                let _ = tx.send(ControlMsg::HarborSelect { index });
            }
            cx.notify();
        }))
}

/// A compliance-gated Harbor control (steer/pause/interrupt/checkpoint/
/// successor/retire). Enabled buttons dispatch the control; `steer` opens the
/// message entry first. Disabled buttons render inert with their exact
/// `why_disabled` cause beside them — an honest gate, never a dead affordance.
fn render_harbor_control(
    id: PaneId,
    block: Block,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let Block::ControlButton {
        verb,
        label,
        enabled,
        why_disabled,
        primary,
    } = block
    else {
        unreachable!("render_harbor_control called with a non-ControlButton block");
    };
    let t = current_theme();
    let row = div()
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_3))
        .mx(px(tokens::SPACE_3))
        .my(px(2.0));
    let button = div()
        .id(SharedString::from(format!("harbor-ctl-{id}-{verb}")))
        .px(px(tokens::SPACE_3))
        .py(px(4.0))
        .border_1()
        .text_size(px(tokens::TEXT_BODY))
        .font_weight(FontWeight::SEMIBOLD)
        .flex_shrink_0();
    if enabled {
        let verb_for_click = verb.clone();
        row.child(
            button
                .border_color(rgb(if primary { t.accent } else { t.line }))
                .bg(rgb(if primary { t.raised } else { t.panel }))
                .text_color(rgb(if primary { t.accent_ink } else { t.ink }))
                .cursor_pointer()
                .hover(|s| {
                    let t = current_theme();
                    s.bg(rgb(t.raised)).border_color(rgb(t.accent))
                })
                .on_click(cx.listener(move |this, _ev, _window, cx| {
                    if verb_for_click == "steer" {
                        // Steer needs a message: open the entry line; submit
                        // sends ControlMsg::HarborControl with the text.
                        this.command = Some(CommandLine::new(CmdKind::HarborSteer));
                    } else if let Some(tx) = &this.control_tx {
                        let _ = tx.send(ControlMsg::HarborControl {
                            verb: verb_for_click.clone(),
                            argument: None,
                        });
                        this.control_flash = Some(format!(
                            "{verb_for_click} queued — watch for the acknowledgement event"
                        ));
                    }
                    cx.notify();
                }))
                .child(label),
        )
    } else {
        row.child(
            button
                .border_color(rgb(t.line))
                .bg(rgb(t.panel))
                .text_color(rgb(t.muted))
                .opacity(0.55)
                .child(label),
        )
        .child(
            div()
                .text_color(rgb(t.muted))
                .text_size(px(13.0))
                .child(why_disabled.unwrap_or_else(|| "unavailable".into())),
        )
    }
}

fn render_filetree_row(
    id: PaneId,
    entry: FileEntry,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let is_dir = entry.is_dir;
    let path = entry.path.clone();
    let marker = if is_dir { "▸" } else { " " };
    div()
        .id(SharedString::from(format!("ftrow-{id}-{}", entry.path)))
        .flex()
        .gap(px(10.0))
        .px(px(16.0))
        .py(px(3.0))
        .cursor_pointer()
        .hover(|s| s.bg(rgb(current_theme().raised)))
        .child(
            div()
                .w(px(12.0))
                .flex_shrink_0()
                .text_color(rgb(current_theme().muted))
                .text_size(px(14.0))
                .child(marker),
        )
        .child(
            div()
                .text_color(rgb(if is_dir {
                    current_theme().accent_ink
                } else {
                    current_theme().ink
                }))
                .text_size(px(14.0))
                .font_family("IBM Plex Mono")
                .child(entry.name.clone()),
        )
        .on_click(cx.listener(move |this, _ev, window, cx| {
            this.ws_mut().focus(id);
            window.focus(&this.focus_handle);
            if is_dir {
                // Descend: rebind the FileTree root to this directory.
                this.ws_mut().bind_entity(Some(path.clone()));
            } else {
                // The file is fully read into its Loro buffer BEFORE the pane tree
                // changes. Permission errors therefore leave this FileTree and its
                // root intact instead of stranding the operator in an error pane.
                if let Err(reason) =
                    this.open_editor(path.clone(), None, EditorPlacement::ReplaceFocused)
                {
                    this.control_flash = Some(reason);
                    crate::audio::play(crate::audio::Cue::Error);
                }
            }
            cx.notify();
        }))
}

/// A failed legacy/deep-linked editor surface must always have an obvious way
/// home. Normal file-tree opens are transactional and never reach this state,
/// but stale scripts and daemon messages can still bind an unreadable path.
fn render_editor_open_failure(
    id: PaneId,
    path: String,
    reason: String,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let t = current_theme();
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&path)
        .to_string();
    let path_for_click = path.clone();

    div()
        .flex_1()
        .flex()
        .items_center()
        .justify_center()
        .p(px(tokens::SPACE_4))
        .child(
            div()
                .w_full()
                .max_w(px(680.0))
                .border_1()
                .border_color(rgb(t.line))
                .bg(rgb(t.raised))
                .child(div().h(px(4.0)).w_full().bg(rgb(t.gated)))
                .child(
                    div()
                        .p(px(tokens::SPACE_4))
                        .flex()
                        .flex_col()
                        .gap(px(tokens::SPACE_3))
                        .child(
                            div()
                                .font_family("IBM Plex Mono")
                                .text_size(px(18.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(rgb(t.ink))
                                .child(format!("Could not open {filename}")),
                        )
                        .child(
                            div()
                                .font_family("IBM Plex Mono")
                                .text_size(px(tokens::TEXT_BODY))
                                .text_color(rgb(t.gated))
                                .child(reason),
                        )
                        .child(
                            div()
                                .text_size(px(tokens::TEXT_BODY))
                                .text_color(rgb(t.muted))
                                .child(
                                    "Nothing was changed. Return to Files and choose another file.",
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(tokens::SPACE_3))
                                .child(
                                    div()
                                        .id(SharedString::from(format!(
                                            "editor-open-error-back-{id}"
                                        )))
                                        .border_1()
                                        .border_color(rgb(t.accent))
                                        .bg(rgb(t.accent))
                                        .text_color(rgb(knockout_ink(t.accent)))
                                        .px(px(tokens::SPACE_4))
                                        .py(px(tokens::SPACE_2))
                                        .cursor_pointer()
                                        .font_family("IBM Plex Mono")
                                        .text_size(px(tokens::TEXT_BODY))
                                        .font_weight(FontWeight::BOLD)
                                        .hover(|style| {
                                            style
                                                .bg(rgb(current_theme().accent_ink))
                                                .border_color(rgb(current_theme().accent_ink))
                                        })
                                        .on_click(cx.listener(move |this, _ev, window, cx| {
                                            this.return_editor_to_files(id, &path_for_click);
                                            window.focus(&this.focus_handle);
                                            crate::audio::play(crate::audio::Cue::Tick);
                                            cx.notify();
                                        }))
                                        .child("Back to Files"),
                                )
                                .child(
                                    div()
                                        .text_size(px(tokens::TEXT_BODY))
                                        .text_color(rgb(t.muted))
                                        .child("or press Esc"),
                                ),
                        ),
                ),
        )
        .into_any_element()
}

/// Persistent, inspectable editor-view controls. These affect only this opened
/// view: neither wrapping nor Git provenance mutates the Loro document.
fn render_editor_toolbar(
    id: PaneId,
    editor_key: String,
    options: &EditorRenderOptions,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let t = current_theme();
    let wrap_key = editor_key.clone();
    let blame_key = editor_key;
    let wrap_on = options.wrap_lines;
    let blame_on = options.show_blame;
    let blame_status = if options.blame_status.starts_with("ERROR") {
        "ERROR"
    } else {
        options.blame_status.as_str()
    };

    div()
        .h(px(38.0))
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_2))
        .px(px(tokens::SPACE_3))
        .border_b_1()
        .border_color(rgb(t.line))
        .bg(rgb(t.panel))
        .font_family("IBM Plex Mono")
        .text_size(px(tokens::TEXT_BODY))
        .child(
            div()
                .text_color(rgb(t.muted))
                .child(format!("SYNTAX {}", options.syntax_label)),
        )
        .child(div().text_color(rgb(t.muted)).child(if blame_on {
            "COLUMNS REPLICA + GIT"
        } else {
            "COLUMN REPLICA"
        }))
        .child(div().flex_1())
        .child(
            div()
                .id(SharedString::from(format!("editor-wrap-toggle-{id}")))
                .px(px(tokens::SPACE_2))
                .py(px(tokens::SPACE_1))
                .border_1()
                .border_color(rgb(if wrap_on { t.accent } else { t.line }))
                .bg(rgb(if wrap_on { t.raised } else { t.panel }))
                .text_color(rgb(if wrap_on { t.accent_ink } else { t.ink2 }))
                .cursor_pointer()
                .hover(|style| {
                    style
                        .border_color(rgb(current_theme().accent))
                        .bg(rgb(current_theme().raised))
                })
                .on_click(cx.listener(move |this, _ev, window, cx| {
                    this.ws_mut().focus(id);
                    window.focus(&this.focus_handle);
                    if this.toggle_editor_wrap(&wrap_key) {
                        crate::audio::play(crate::audio::Cue::Tick);
                    }
                    cx.notify();
                }))
                .child(format!("WRAP {}", if wrap_on { "ON" } else { "OFF" })),
        )
        .child(
            div()
                .id(SharedString::from(format!("editor-blame-toggle-{id}")))
                .px(px(tokens::SPACE_2))
                .py(px(tokens::SPACE_1))
                .border_1()
                .border_color(rgb(if blame_on { t.engaged } else { t.line }))
                .bg(rgb(if blame_on { t.raised } else { t.panel }))
                .text_color(rgb(if blame_on { t.engaged } else { t.ink2 }))
                .cursor_pointer()
                .hover(|style| {
                    style
                        .border_color(rgb(current_theme().engaged))
                        .bg(rgb(current_theme().raised))
                })
                .on_click(cx.listener(move |this, _ev, window, cx| {
                    this.ws_mut().focus(id);
                    window.focus(&this.focus_handle);
                    if this.toggle_editor_blame(&blame_key) {
                        crate::audio::play(crate::audio::Cue::Tick);
                    }
                    cx.notify();
                }))
                .child(format!("BLAME {blame_status}")),
        )
        .into_any_element()
}

/// Map an existing nav id to the richest matching surface (semantic where one
/// exists, generic `Panel` otherwise).
fn surface_for_nav_id(nav: &str) -> SurfaceKind {
    match nav {
        "lane" => SurfaceKind::AgentTranscript { agent_id: None },
        "planner" | "roadmap" => SurfaceKind::Roadmap,
        "health" => SurfaceKind::DaemonHealth,
        "fleet" => SurfaceKind::Fleet,
        "sessions" => SurfaceKind::Sessions,
        "dispatch" => SurfaceKind::Dispatch,
        other => SurfaceKind::Panel {
            nav: other.to_string(),
        },
    }
}

/// Inverse: which nav id (if any) backs this surface's live data.
fn nav_id_for_surface(surface: &SurfaceKind) -> Option<&str> {
    match surface {
        SurfaceKind::AgentTranscript { .. } => Some("lane"),
        SurfaceKind::Roadmap => Some("planner"),
        SurfaceKind::DaemonHealth => Some("health"),
        SurfaceKind::Fleet => Some("fleet"),
        SurfaceKind::Sessions => Some("sessions"),
        SurfaceKind::Dispatch => Some("dispatch"),
        SurfaceKind::Panel { nav } => Some(nav.as_str()),
        // HITL and Work are foreground projections, not generic NAV pane fetchers.
        SurfaceKind::CartographerChat
        | SurfaceKind::FileTree { .. }
        | SurfaceKind::Editor { .. }
        | SurfaceKind::Hitl
        | SurfaceKind::Work => None,
    }
}

impl Focusable for ConsoleView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl EntityInputHandler for ConsoleView {
    fn text_for_range(
        &mut self,
        range: std::ops::Range<usize>,
        adjusted_range: &mut Option<std::ops::Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let key = self.focused_editor_key()?;
        let state = self.editors.get(&key)?;
        let text = state.pane.text()?;
        let (slice, adjusted) = state.input.text_for_utf16_range(&text, &range);
        adjusted_range.replace(adjusted);
        Some(slice)
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let key = self.focused_editor_key()?;
        let state = self.editors.get(&key)?;
        let text = state.pane.text()?;
        Some(UTF16Selection {
            range: state.input.selection_utf16(&text),
            reversed: state.input.selection_reversed(),
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<std::ops::Range<usize>> {
        let key = self.focused_editor_key()?;
        let state = self.editors.get(&key)?;
        let text = state.pane.text()?;
        state.input.marked_utf16(&text)
    }

    fn unmark_text(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let _ = self.move_focused_editor(|input, _| input.unmark(), cx);
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<std::ops::Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let replacement = text.to_string();
        let _ = self.apply_focused_editor_edit(
            move |input, before| Some(input.replace(before, range, &replacement, false, None)),
            cx,
        );
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<std::ops::Range<usize>>,
        new_text: &str,
        new_selected_range: Option<std::ops::Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let replacement = new_text.to_string();
        let _ = self.apply_focused_editor_edit(
            move |input, before| {
                Some(input.replace(before, range, &replacement, true, new_selected_range))
            },
            cx,
        );
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: std::ops::Range<usize>,
        element_bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let key = self.focused_editor_key()?;
        let state = self.editors.get(&key)?;
        let text = state.pane.text()?;
        let byte = state.input.byte_range_for_utf16(&text, &range_utf16).start;
        let (gutter_px, wrap_columns) = editor_text_layout(
            &text,
            f32::from(element_bounds.size.width),
            state.wrap_lines,
            state.show_blame,
        );
        let (visual_row, column) = editor_visual_position_for_byte(&text, byte, wrap_columns);
        let top = state.scroll.0.borrow().base_handle.logical_scroll_top().0;
        let visible_row = visual_row.saturating_sub(top) as f32;
        Some(Bounds::new(
            point(
                element_bounds.left() + px(gutter_px + column as f32 * tokens::CODE_CH),
                element_bounds.top() + px(visible_row * tokens::CODE_LINE_H),
            ),
            size(px(2.0), px(tokens::CODE_LINE_H)),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let key = self.focused_editor_key()?;
        let state = self.editors.get(&key)?;
        let bounds = state.input_bounds?;
        let text = state.pane.text()?;
        let top = state.scroll.0.borrow().base_handle.logical_scroll_top().0;
        let (gutter_px, wrap_columns) = editor_text_layout(
            &text,
            f32::from(bounds.size.width),
            state.wrap_lines,
            state.show_blame,
        );
        let row = ((f32::from(point.y - bounds.top()) / tokens::CODE_LINE_H).floor() as isize)
            .max(0) as usize;
        let column = ((f32::from(point.x - bounds.left()) - gutter_px) / tokens::CODE_CH)
            .floor()
            .max(0.0) as usize;
        let (line, column) = editor_hit_position(&text, top + row, column, wrap_columns)?;
        Some(state.input.utf16_index_for_line_column(&text, line, column))
    }
}

struct EditorInputElement {
    view: Entity<ConsoleView>,
}

impl IntoElement for EditorInputElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for EditorInputElement {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.0).into();
        style.size.height = relative(1.0).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Self::PrepaintState {
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.view.read(cx).focus_handle(cx);
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.view.clone()),
            cx,
        );
        self.view.update(cx, |view, cx| {
            if let Some(key) = view.focused_editor_key() {
                if let Some(state) = view.editors.get_mut(&key) {
                    let width_changed = state.input_bounds.is_none_or(|previous| {
                        (f32::from(previous.size.width) - f32::from(bounds.size.width)).abs()
                            >= tokens::CODE_CH
                    });
                    state.input_bounds = Some(bounds);
                    if state.wrap_lines && width_changed {
                        cx.notify();
                    }
                }
            }
        });
    }
}

/// One draggable pane divider — a 6px hit-zone with a centered hairline that
/// thickens/glows on hover; mouse-down arms a `DragState` the window handler reads.
fn split_divider(
    path: Vec<usize>,
    left: usize,
    dir: Dir,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let row = matches!(dir, Dir::Row);
    let key = path
        .iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join("_");
    let mut zone = div()
        .id(SharedString::from(format!("divider-{key}-{left}")))
        .flex_none()
        .occlude()
        .flex()
        .items_center()
        .justify_center()
        .cursor(if row {
            CursorStyle::ResizeLeftRight
        } else {
            CursorStyle::ResizeUpDown
        })
        .hover(|s| s.bg(rgb(current_theme().accent)));
    zone = if row {
        zone.w(px(6.0)).h_full()
    } else {
        zone.h(px(6.0)).w_full()
    };
    let mut line = div().bg(rgb(current_theme().line));
    line = if row {
        line.w(px(1.0)).h_full()
    } else {
        line.h(px(1.0)).w_full()
    };
    zone.child(line)
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, _ev, _window, cx| {
                this.dragging = Some(DragState {
                    path: path.clone(),
                    left,
                    dir,
                });
                cx.notify();
            }),
        )
        .on_mouse_up(
            MouseButton::Left,
            cx.listener(|this, _ev, _window, cx| {
                if this.dragging.take().is_some() {
                    cx.notify();
                }
            }),
        )
}

/// The apps.html navigation deck: stack layers read as colored rules before the
/// operator reads a label. The full 27-surface launcher remains behind the
/// trailing ellipsis, so the compact deck is hierarchy rather than omission.
fn render_story_nav_button(
    query: &'static str,
    label: &'static str,
    active: Option<&str>,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let is_active = active == Some(query)
        || (query == "planner" && active == Some("roadmap"))
        || (query == "ledger" && active == Some("cost"));
    div()
        .id(SharedString::from(format!("deck-nav-{query}-{label}")))
        .h_full()
        .px(px(9.0))
        .flex()
        .items_center()
        .flex_shrink_0()
        .bg(rgb(if is_active {
            current_theme().accent
        } else {
            current_theme().panel
        }))
        .text_color(rgb(if is_active {
            0xfbf7ef
        } else {
            current_theme().muted
        }))
        .font_family("IBM Plex Mono")
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(12.0))
        .cursor_pointer()
        .when(!is_active, |d| {
            d.hover(|h| {
                h.bg(rgb(current_theme().raised))
                    .text_color(rgb(current_theme().ink))
            })
        })
        .child(label)
        .on_click(cx.listener(move |this, _event, _window, cx| {
            if let Some(surface) = surface_for_query(query) {
                this.ws_mut().swap_surface(surface);
            }
            cx.notify();
        }))
        .into_any_element()
}

fn render_story_nav_group(
    layer: &'static str,
    color: u32,
    items: &'static [(&'static str, &'static str)],
    active: Option<&str>,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    div()
        .h_full()
        .flex()
        .flex_shrink_0()
        .border_t_2()
        .border_color(rgb(color))
        .child(
            div()
                .h_full()
                .px(px(7.0))
                .flex()
                .items_center()
                .font_family("IBM Plex Mono")
                .text_size(px(11.0))
                .text_color(rgb(current_theme().resting))
                .child(layer),
        )
        .children(
            items
                .iter()
                .map(|(query, label)| render_story_nav_button(query, label, active, cx)),
        )
        .into_any_element()
}

fn render_story_nav_bar(active: Option<&str>, cx: &mut Context<ConsoleView>) -> AnyElement {
    const L0: &[(&str, &str)] = &[("daemons", "daemon"), ("health", "health")];
    const L1: &[(&str, &str)] = &[
        ("fleet", "fleet"),
        ("claims", "claims"),
        ("parley", "parley"),
        ("sessions", "sessions"),
    ];
    const L2: &[(&str, &str)] = &[
        ("cockpit", "cockpit"),
        ("work", "work"),
        ("planner", "roadmap"),
    ];
    const L3: &[(&str, &str)] = &[("ledger", "ledger"), ("ledger", "cost")];
    let t = current_theme();
    div()
        .id("story-nav-deck")
        .h(px(42.0))
        .w_full()
        .flex()
        .overflow_hidden()
        .bg(rgb(t.panel))
        .border_b_1()
        .border_color(rgb(t.line))
        .child(render_story_nav_group("L0", t.accent, L0, active, cx))
        .child(render_story_nav_group("L1", t.landed, L1, active, cx))
        .child(render_story_nav_group("L2", 0x3f8f87, L2, active, cx))
        .child(render_story_nav_group("L3", t.engaged, L3, active, cx))
        .child(div().flex_1())
        .child(
            div()
                .id("deck-nav-more")
                .h_full()
                .px(px(10.0))
                .flex()
                .items_center()
                .font_family("IBM Plex Mono")
                .text_size(px(14.0))
                .text_color(rgb(t.muted))
                .cursor_pointer()
                .hover(|d| {
                    d.bg(rgb(current_theme().raised))
                        .text_color(rgb(current_theme().ink))
                })
                .child("…")
                .on_click(cx.listener(|this, _event, _window, cx| {
                    this.launcher_open = true;
                    cx.notify();
                })),
        )
        .into_any_element()
}

/// A sparse pane should still look intentional. The ordinary two-line
/// Header+status rendering leaves most of a large operator window as dead gray;
/// detect that honest state and give it the same poster-scale color blocking as
/// story-linework's large signal fields.
fn story_sparse_status(blocks: &[Block]) -> Option<String> {
    if blocks.len() != 2 {
        return None;
    }
    match (&blocks[0], &blocks[1]) {
        (Block::Header(_), Block::KeyVal(key, value)) if key == "status" => Some(value.clone()),
        _ => None,
    }
}

fn story_sparse_poster(id: PaneId, surface: &SurfaceKind, status: &str) -> AnyElement {
    let t = current_theme();
    let nav = nav_id_for_surface(surface).unwrap_or("surface");
    let (eyebrow, left, right, measure, primary, secondary, detail) =
        if status.contains("no fleet running") {
            (
                "L1 / FLEET TRUTH",
                "NO FLEET",
                "RUNNING",
                "0 SHIPS ACTIVE",
                0x003fb8,
                0xcad900,
                "No declared ships are active on this daemon berth.",
            )
        } else if status.contains("all clear") {
            (
                "HUMAN GATES / RECEIPTS",
                "ALL",
                "CLEAR",
                "0 ALERTS",
                0x006b5f,
                0xcad900,
                "No operator action is waiting in the local alert ledger.",
            )
        } else if status.contains("connecting") || status.contains("opening") {
            (
                "HOT BUS / QUERY",
                "WAITING",
                "FOR TRUTH",
                "PENDING",
                0x003fb8,
                0x933fa5,
                "The pane is waiting for its first confirmed daemon response.",
            )
        } else if status.contains("empty") || status.contains("no ") {
            (
                "DURABLE QUERY / EMPTY",
                "NO",
                "ENTRIES",
                "CONFIRMED",
                0x006b5f,
                0xcad900,
                status,
            )
        } else {
            (
                "OPERATOR TRUTH / QUIET",
                "STATE",
                "QUIET",
                "CONFIRMED",
                0x003fb8,
                0x006b5f,
                status,
            )
        };

    let poster = div()
        .id(SharedString::from(format!("story-sparse-poster-{id}")))
        .relative()
        .flex_1()
        .min_h(px(280.0))
        .flex()
        .overflow_hidden()
        .bg(rgb(t.panel))
        .child(
            div()
                .flex_basis(relative(0.43))
                .flex_shrink_0()
                .h_full()
                .p(px(24.0))
                .flex()
                .flex_col()
                .bg(rgb(primary))
                .text_color(rgb(0xfbf7ef))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::BOLD)
                        .child(eyebrow),
                )
                .child(div().flex_1())
                .child(
                    div()
                        .text_size(px(34.0))
                        .font_weight(FontWeight::BOLD)
                        .child(left),
                )
                .child(
                    div()
                        .mt(px(18.0))
                        .flex()
                        .child(div().w(px(28.0)).h(px(18.0)).bg(rgb(0xfbf7ef)))
                        .child(div().w(px(28.0)).h(px(18.0)).bg(rgb(secondary))),
                ),
        )
        .child(
            div()
                .flex_1()
                .h_full()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(118.0))
                        .px(px(24.0))
                        .flex()
                        .items_center()
                        .bg(rgb(secondary))
                        .text_color(rgb(knockout_ink(secondary)))
                        .text_size(px(34.0))
                        .font_weight(FontWeight::BOLD)
                        .child(right),
                )
                .child(
                    div()
                        .flex_1()
                        .p(px(24.0))
                        .flex()
                        .flex_col()
                        .border_l_1()
                        .border_color(rgb(t.line))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(rgb(t.accent_ink))
                                .child(format!("{nav} / {measure}")),
                        )
                        .child(div().flex_1())
                        .child(
                            div()
                                .max_w(px(520.0))
                                .text_size(px(15.0))
                                .text_color(rgb(t.ink2))
                                .child(detail.to_string()),
                        )
                        .child(
                            div()
                                .mt(px(10.0))
                                .text_size(px(11.0))
                                .text_color(rgb(t.muted))
                                .child("CONFIRMED QUERY / NO SPINNER / NEXT ACTION STAYS EXPLICIT"),
                        ),
                ),
        )
        .child(
            div()
                .absolute()
                .bottom_0()
                .left_0()
                .right_0()
                .h(px(4.0))
                .flex()
                .child(div().flex_basis(relative(0.43)).bg(rgb(primary)))
                .child(div().flex_1().bg(rgb(secondary))),
        );

    // This surface can repaint whenever the live PTY or hot bus emits. A
    // render-owned entry animation would restart on those unrelated events and
    // temporarily erase operator truth behind the CLI drawer. Keep the large
    // field stable; motion belongs to the drawer, cloth flags, and live marker.
    poster.into_any_element()
}

fn terminal_rgb(color: TerminalColor, default: u32) -> u32 {
    const ANSI: [u32; 16] = [
        0x17191d, 0xd95d69, 0x78c895, 0xd7b84b, 0x5f8ee4, 0xc27acb, 0x63c5c2, 0xd8d5cd, 0x6f7682,
        0xff8290, 0x9bddae, 0xf1d86b, 0x82adff, 0xe49bed, 0x87e4df, 0xffffff,
    ];
    match color {
        TerminalColor::Default => default,
        TerminalColor::Rgb(red, green, blue) => {
            (u32::from(red) << 16) | (u32::from(green) << 8) | u32::from(blue)
        }
        TerminalColor::Indexed(index) if index < 16 => ANSI[index as usize],
        TerminalColor::Indexed(index) if index < 232 => {
            let cube = index - 16;
            let channel = |value: u8| if value == 0 { 0 } else { 55 + value * 40 };
            let red = channel(cube / 36);
            let green = channel((cube % 36) / 6);
            let blue = channel(cube % 6);
            (u32::from(red) << 16) | (u32::from(green) << 8) | u32::from(blue)
        }
        TerminalColor::Indexed(index) => {
            let gray = 8 + (index - 232) * 10;
            (u32::from(gray) << 16) | (u32::from(gray) << 8) | u32::from(gray)
        }
    }
}

fn shell_failure_strip(
    id: &'static str,
    failure: &crate::shell_drawer::ShellFailure,
    color: u32,
) -> AnyElement {
    let t = current_theme();
    div()
        .id(id)
        .mx(px(10.0))
        .mb(px(8.0))
        .flex()
        .bg(tone_wash(color, 0x20))
        .child(state_stripe(format!("{id}-stripe"), color, 3.0, 52.0))
        .child(
            div()
                .flex_1()
                .px(px(9.0))
                .py(px(6.0))
                .font_family("IBM Plex Mono")
                .text_size(px(12.0))
                .child(
                    div()
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(color))
                        .child(format!("{} · {}", failure.code(), failure.summary())),
                )
                .child(
                    div()
                        .text_color(rgb(t.ink2))
                        .child(failure.detail().to_string()),
                )
                .child(
                    div()
                        .text_color(rgb(color))
                        .child(format!("NEXT · {}", failure.next_action())),
                ),
        )
        .into_any_element()
}

fn render_shell_drawer(view: &ConsoleView, cx: &mut Context<ConsoleView>) -> AnyElement {
    let t = current_theme();
    let (shell_rows, shell_cols) = view.shell.size();
    let live = view.shell.is_live();
    let status_color = match view.shell.status() {
        ShellStatus::Starting => t.engaged,
        ShellStatus::Running => t.landed,
        ShellStatus::Exited(0) => t.resting,
        ShellStatus::Exited(_) | ShellStatus::Failed(_) => t.gated,
    };
    let status_dot = div()
        .id("cli-status-dot")
        .w(px(7.0))
        .h(px(7.0))
        .rounded(px(4.0))
        .bg(rgb(status_color));
    let status_dot: AnyElement = status_dot.into_any_element();
    let retention = view.shell.retention();
    let previous_receipt = view.shell.previous_receipt().cloned();
    let terminal_failure = view.shell.failure().cloned();
    let recovery_failure = view.shell.recovery_failure().cloned();

    let lines = view.shell.styled_lines(15);
    let output_rows = lines.into_iter().map(|line| {
        let mut highlights: Vec<(std::ops::Range<usize>, HighlightStyle)> = line
            .spans
            .into_iter()
            .filter(|span| !span.range.is_empty())
            .map(|span| {
                let background_color = match span.background {
                    TerminalColor::Default => None,
                    color => Some(rgb(terminal_rgb(color, t.sunken)).into()),
                };
                (
                    span.range,
                    HighlightStyle {
                        color: Some(rgb(terminal_rgb(span.foreground, t.ink)).into()),
                        background_color,
                        font_weight: span.bold.then_some(FontWeight::BOLD),
                        font_style: span.italic.then_some(FontStyle::Italic),
                        ..Default::default()
                    },
                )
            })
            .collect();
        if live {
            if let Some(cursor) = line.cursor.filter(|range| !range.is_empty()) {
                highlights.push((
                    cursor,
                    HighlightStyle {
                        color: Some(rgb(t.sunken).into()),
                        background_color: Some(rgb(t.accent_ink).into()),
                        ..Default::default()
                    },
                ));
            }
        }
        div()
            .h(px(17.0))
            .w_full()
            .flex_shrink_0()
            .pl(px(10.0))
            .pr(px(8.0))
            .overflow_hidden()
            .whitespace_nowrap()
            .text_size(px(13.0))
            .text_color(rgb(t.ink))
            .child(
                StyledText::new(SharedString::new(if line.text.is_empty() {
                    " ".to_string()
                } else {
                    line.text
                }))
                .with_highlights(highlights),
            )
    });

    let drawer = div()
        .id("cli-drawer")
        .absolute()
        .left(px(16.0))
        .right(px(16.0))
        .bottom(px(64.0))
        .h(px(360.0))
        .occlude()
        .flex()
        .flex_col()
        .bg(rgb(t.sunken))
        .shadow(vec![BoxShadow {
            color: rgba(0x00000088).into(),
            offset: point(px(0.0), px(-10.0)),
            blur_radius: px(28.0),
            spread_radius: px(1.0),
        }])
        // One large color zone: command context. The rest of the terminal stays
        // quiet enough that state stripes and actual ANSI output can speak.
        .child(
            div()
                .h(px(34.0))
                .w_full()
                .flex_shrink_0()
                .flex()
                .items_center()
                .bg(rgb(t.accent))
                .text_color(rgb(0xffffff))
                .child(state_stripe("cli-header-state", status_color, 5.0, 34.0))
                .child(
                    div()
                        .ml(px(10.0))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(micro_flag("cli-context-flag", 0xffffff, t.engaged, 9.0, 14.0))
                        .child(
                            div()
                                .font_family("IBM Plex Mono")
                                .font_weight(FontWeight::BOLD)
                                .text_size(px(13.0))
                                .child("CLI · PORT DADDY"),
                        ),
                )
                .child(div().flex_1())
                .child(status_dot)
                .child(
                    div()
                        .ml(px(7.0))
                        .font_family("IBM Plex Mono")
                        .text_size(px(12.0))
                        .child(view.shell.status_label()),
                )
                .child(
                    div()
                        .id("cycle-cli-receipt-retention")
                        .ml(px(10.0))
                        .px(px(7.0))
                        .h(px(22.0))
                        .flex()
                        .items_center()
                        .border_1()
                        .border_color(rgba(0xffffff66))
                        .cursor_pointer()
                        .font_family("IBM Plex Mono")
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_size(px(11.0))
                        .hover(|style| style.bg(rgba(0xffffff22)).border_color(rgb(0xffffff)))
                        .child(format!("RECEIPT {}", retention.label().to_uppercase()))
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            let retention = this.shell.cycle_retention();
                            this.control_flash = Some(match retention {
                                crate::shell_drawer::ShellRetention::Off => {
                                    "shell receipt retention off".into()
                                }
                                crate::shell_drawer::ShellRetention::Metadata => {
                                    "shell receipt stores launch metadata; environment and screen excluded".into()
                                }
                                crate::shell_drawer::ShellRetention::Screen => {
                                    "shell receipt stores visible screen; environment excluded".into()
                                }
                            });
                            cx.notify();
                        })),
                )
                .child(
                    div()
                        .id("close-cli-drawer")
                        .ml(px(12.0))
                        .mr(px(10.0))
                        .w(px(22.0))
                        .h(px(22.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .font_family("IBM Plex Mono")
                        .text_size(px(15.0))
                        .hover(|d| d.bg(rgba(0xffffff22)))
                        .child("×")
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.shell_open = false;
                            cx.notify();
                        })),
                ),
        )
        .child(
            div()
                .flex_1()
                .overflow_hidden()
                .flex()
                .bg(rgb(t.sunken))
                .child(state_stripe("cli-output-state", status_color, 3.0, 256.0))
                .child(
                    div()
                        .flex_1()
                        .overflow_hidden()
                        .py(px(8.0))
                        .font_family("JetBrainsMono Nerd Font Mono")
                        .children(output_rows),
                ),
        )
        .when_some(terminal_failure, |drawer, failure| {
            drawer.child(shell_failure_strip("cli-terminal-failure", &failure, t.gated))
        })
        .when_some(recovery_failure, |drawer, failure| {
            drawer.child(shell_failure_strip("cli-recovery-failure", &failure, t.engaged))
        })
        .when_some(previous_receipt, |drawer, receipt| {
            let preview = receipt.screen_preview_label();
            let (rows, cols) = receipt.size();
            drawer.child(
                div()
                    .mx(px(10.0))
                    .mb(px(8.0))
                    .flex()
                    .border_t_1()
                    .border_b_1()
                    .border_color(rgb(t.line))
                    .bg(rgb(t.panel))
                    .child(state_stripe("cli-receipt-stripe", t.engaged, 3.0, 48.0))
                    .child(
                        div()
                            .flex_1()
                            .px(px(9.0))
                            .py(px(5.0))
                            .overflow_hidden()
                            .font_family("IBM Plex Mono")
                            .text_size(px(11.0))
                            .child(
                                div()
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgb(t.engaged))
                                    .child(format!(
                                        "PREVIOUS SHELL RECEIPT · {} · {}",
                                        receipt.age_label(),
                                        receipt.honest_status()
                                    )),
                            )
                            .child(
                                div()
                                    .text_color(rgb(t.muted))
                                    .child(format!(
                                        "{} · launch {} · PTY {rows}x{cols}",
                                        receipt.shell_label(),
                                        receipt.launch_cwd_label()
                                    )),
                            )
                            .when_some(preview, |body, line| {
                                body.child(
                                    div()
                                        .whitespace_nowrap()
                                        .text_color(rgb(t.ink2))
                                        .child(format!("SCREEN RETAINED · {line}")),
                                )
                            }),
                    )
                    .child(
                        div()
                            .id("clear-cli-recovery-receipt")
                            .px(px(9.0))
                            .flex()
                            .items_center()
                            .border_l_1()
                            .border_color(rgb(t.line))
                            .cursor_pointer()
                            .text_color(rgb(t.muted))
                            .font_family("IBM Plex Mono")
                            .text_size(px(11.0))
                            .hover(|style| {
                                style.bg(rgb(current_theme().raised)).text_color(rgb(current_theme().ink))
                            })
                            .child("CLEAR")
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.shell.clear_previous_receipt();
                                this.control_flash = Some("previous shell receipt cleared".into());
                                cx.notify();
                            })),
                    ),
            )
        })
        .child(
            div()
                .h(px(28.0))
                .flex_shrink_0()
                .flex()
                .items_center()
                .gap(px(9.0))
                .px(px(10.0))
                .border_t_1()
                .border_color(rgb(t.line))
                .bg(rgb(t.panel))
                .font_family("JetBrainsMono Nerd Font Mono")
                .text_size(px(11.0))
                .text_color(rgb(t.muted))
                .child(format!(
                    "{} · launch {}",
                    view.shell.shell(),
                    view.shell.launch_cwd_label()
                ))
                .child(div().flex_1())
                .child(format!("PTY {shell_rows}×{shell_cols} · xterm-256color")),
        )
        // Focus ticks paint last so the color-block header and terminal output
        // cannot cover the boundary language.
        .children(corner_ticks("cli", t.accent_ink));

    // The PTY repaints for every output chunk. Render-owned animations restart
    // on those updates and invalidate GPUI's absolute-layer cache, which can
    // erase unrelated pane pixels. The drawer stays static until its transition
    // is owned by explicit view state with a durable start timestamp.
    drawer.into_any_element()
}

impl Render for ConsoleView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Persistent editor state for every open Editor surface — created once
        // per file here (the only `&mut self` point before the tree renders),
        // NEVER inside render_leaf (the old per-frame construct + disk read).
        self.ensure_editor_states();
        // ── Flag motion. Derive horizontal pole velocity from this frame's
        // viewport-width change (resize / pane reflow → left/right); scrolling
        // feeds vy via on_scroll_wheel. A width change kicks the settle loop,
        // which decays the velocity over subsequent frames (cx.on_next_frame).
        {
            let vw = f32::from(window.viewport_size().width);
            if self.prev_viewport_w == 0.0 {
                self.prev_viewport_w = vw;
            }
            let dvw = vw - self.prev_viewport_w;
            self.prev_viewport_w = vw;
            if dvw.abs() > 0.5 {
                self.flag_motion.vx = (self.flag_motion.vx + dvw / 60.0).clamp(-1.6, 1.6);
                self.kick_flag_motion(window, cx);
            }
            // Keep the native PTY and vt100 model aligned with the drawer's
            // measured text width. Resize is idempotent and only emits when the
            // column count changes, so ordinary renders do not write to the PTY.
            let shell_cols = ((vw - 52.0) / 7.8).floor().clamp(40.0, 220.0) as u16;
            let _ = self.shell.resize(15, shell_cols);
        }

        let daemon_url = self.daemon_url.clone();
        let focused = self.ws().focused();
        // Compact deck identity, including non-NAV surfaces such as Work.
        let active_nav = launcher_id_for_surface(self.ws().focused_surface());
        let armed = self.leader_armed;
        let command = self.command.clone();
        let lit = armed || command.is_some();
        let pane_count = self.ws().pane_count();
        let daemon_connected = self.daemon_connected;
        // HITL banner data (contract §4.2): surfaced window-wide when any ask
        // is open; loud red (mayday) when a critical/blocking ask is waiting.
        let hitl_banner = self.hitl_gate.clone();
        let zoomed = self.zoomed();
        // Tab bar data (index, name, is-active).
        let tabs: Vec<(usize, String, bool)> = self
            .tabs
            .iter()
            .enumerate()
            .map(|(i, t)| (i, t.name.clone(), i == self.active_tab))
            .collect();
        // Body: a single maximized pane, or the full tree.
        let body: AnyElement =
            match zoomed.and_then(|zid| self.ws().surface_at(zid).cloned().map(|s| (zid, s))) {
                Some((zid, surf)) => self.render_leaf(zid, &surf, true, cx),
                None => {
                    let root = self.ws().root.clone();
                    self.render_node(&root, focused, &[], cx)
                }
            };
        // The pane launcher overlay (when open) is the last child so it paints on top.
        let launcher = if self.launcher_open {
            Some(self.render_launcher(window, cx))
        } else {
            None
        };
        let shell_drawer = if self.shell_open {
            Some(render_shell_drawer(self, cx))
        } else {
            None
        };
        // The launch splash overlays everything until the first refresh lands.
        // Suppressed for the launcher screenshot hook and the PD_CONSOLE_NO_SPLASH
        // opt-out, so capture tooling / opted-out users never see the boot flash.
        let splash = if !self.booted && !self.launcher_open && !splash_disabled() {
            Some(self.render_splash())
        } else {
            None
        };

        div()
            .key_context("console")
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
            .font_family("IBM Plex Mono")
            // Grab-the-rope: while a divider drag is live, map the global mouse
            // position to the split's weight fraction and resize that boundary.
            .on_mouse_move(cx.listener(|this, ev: &MouseMoveEvent, _window, cx| {
                if let Some(d) = this.dragging.clone() {
                    // The mooring line tracks the boundary, so the cursor sits over
                    // the occluding divider at release and the mouse-up can be
                    // swallowed there. Bulletproof release: any move where Left is
                    // no longer held ends the drag.
                    if ev.pressed_button != Some(MouseButton::Left) {
                        this.dragging = None;
                        cx.notify();
                        return;
                    }
                    let b = this.split_bounds.borrow().get(&d.path).copied();
                    if let Some(b) = b {
                        let (origin, len, pos) = match d.dir {
                            Dir::Row => (f32::from(b.origin.x), f32::from(b.size.width), f32::from(ev.position.x)),
                            Dir::Col => (f32::from(b.origin.y), f32::from(b.size.height), f32::from(ev.position.y)),
                        };
                        let frac = ((pos - origin) / len.max(1.0)).clamp(0.03, 0.97);
                        this.ws_mut().resize_pair(&d.path, d.left, frac);
                        cx.notify();
                    }
                }
                // Sextant camera pan: right/middle drag keeps moving even if the
                // pointer leaves the map child. Left drag remains marquee.
                if this.galaxy_pan.is_some() {
                    if matches!(
                        ev.pressed_button,
                        Some(MouseButton::Right) | Some(MouseButton::Middle)
                    ) {
                        this.galaxy_pan_to(ev.position);
                        cx.notify();
                        return;
                    }
                    this.end_galaxy_pan();
                    cx.notify();
                    return;
                }
                // Sextant marquee: while a rectangle-select is live, track the far
                // corner; auto-cancel when Left is no longer held (same
                // bulletproof-release rule as the divider drag above).
                if this.galaxy_drag.is_some() {
                    if ev.pressed_button != Some(MouseButton::Left) {
                        this.galaxy_drag = None;
                        cx.notify();
                        return;
                    }
                    if let Some((_, end)) = this.galaxy_drag.as_mut() {
                        *end = ev.position;
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _ev: &MouseUpEvent, _window, cx| {
                if this.dragging.take().is_some() {
                    cx.notify();
                }
                // Sextant marquee release: convert the pixel rect to normalized
                // map coords via the captured bounds and UNION the hits into the
                // selection (⌘-free additive sweep; the pure hit test lives in
                // galaxy_pane so the REPL bin gates it).
                if let Some((start, end)) = this.galaxy_drag.take() {
                    let bounds = *this.galaxy_bounds.borrow();
                    if let Some(b) = bounds {
                        let w = f32::from(b.size.width).max(1.0);
                        let h = f32::from(b.size.height).max(1.0);
                        let ox = f32::from(b.origin.x);
                        let oy = f32::from(b.origin.y);
                        // A sub-4px travel is a click on empty space, not a
                        // marquee — don't sweep-select on jitter.
                        let travelled = (f32::from(end.x) - f32::from(start.x)).abs() > 4.0
                            || (f32::from(end.y) - f32::from(start.y)).abs() > 4.0;
                        if travelled {
                            let start_x = (f32::from(start.x) - ox) / w;
                            let start_y = (f32::from(start.y) - oy) / h;
                            let end_x = (f32::from(end.x) - ox) / w;
                            let end_y = (f32::from(end.y) - oy) / h;
                            let (world_start_x, world_start_y) =
                                this.galaxy_viewport.view_to_world(start_x, start_y);
                            let (world_end_x, world_end_y) =
                                this.galaxy_viewport.view_to_world(end_x, end_y);
                            let hits = crate::galaxy_pane::rect_hits(
                                &this.galaxy.points,
                                world_start_x,
                                world_start_y,
                                world_end_x,
                                world_end_y,
                            );
                            if !hits.is_empty() {
                                crate::audio::play(crate::audio::Cue::Tick);
                            }
                            for hit in hits {
                                this.galaxy_selected.insert(hit);
                            }
                        }
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Right, cx.listener(|this, _ev: &MouseUpEvent, _window, cx| {
                if this.galaxy_pan.take().is_some() {
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Middle, cx.listener(|this, _ev: &MouseUpEvent, _window, cx| {
                if this.galaxy_pan.take().is_some() {
                    cx.notify();
                }
            }))
            .bg(rgb(current_theme().bg))
            .flex()
            .flex_col()
            .font_family("IBM Plex Mono")
            // Leader-key dispatcher: Ctrl-A arms; the next keystroke is a
            // multiplexer command (split / close / focus / swap-surface).
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _window, cx| {
                let key = ev.keystroke.key.clone();
                let key_char = ev.keystroke.key_char.clone();
                let ctrl = ev.keystroke.modifiers.control;
                if this.launcher_open {
                    // The launcher owns the keyboard while open: Esc closes; a
                    // tile's key jumps straight to that surface (and sidesteps the
                    // Ctrl-A g theme-toggle collision — here g picks Lineage).
                    if key == "escape" {
                        this.launcher_open = false;
                    } else if let Some(item) = launcher_items().into_iter().find(|n| n.key == key) {
                        this.ws_mut().swap_surface(surface_for_launcher_id(item.id));
                        this.launcher_open = false;
                        this.control_flash = Some(format!("→ {}", item.label));
                    }
                    cx.notify();
                } else if this.command.is_some() {
                    // A command line is open: type into it.
                    this.handle_command_key(key.as_str(), key_char.as_deref(), cx);
                } else if this.leader_armed {
                    this.leader_armed = false;
                    this.leader_command(key.as_str(), ctrl, cx);
                } else if ctrl && key == "a" {
                    this.leader_armed = true;
                    cx.notify();
                } else if this.shell_open {
                    // The raised PTY owns ordinary keys. Global console control
                    // remains reachable through the Ctrl-A leader handled above.
                    this.handle_shell_key(
                        key.as_str(),
                        key_char.as_deref(),
                        ev.keystroke.modifiers,
                        cx,
                    );
                } else if key == "escape" && this.recover_failed_editor() {
                    crate::audio::play(crate::audio::Cue::Tick);
                    cx.notify();
                    cx.stop_propagation();
                } else if this.focused_editor_key().is_some() {
                    // Printable text is delivered by GPUI's platform input
                    // bridge (`EntityInputHandler`) so IME/dead-key composition
                    // works. Navigation, deletion, clipboard, Enter and Tab are
                    // commands and stay on the keydown path.
                    if this.handle_editor_key(
                        key.as_str(),
                        ev.keystroke.modifiers,
                        cx,
                    ) {
                        cx.stop_propagation();
                    }
                } else if this.focused_is_chat() {
                    // The focused chat pane captures printable keys into its composer
                    // (no native input widget) — the load-bearing "make it actually
                    // type" path. Ctrl-A still arms the leader (checked above first).
                    let shift = ev.keystroke.modifiers.shift;
                    this.handle_chat_key(key.as_str(), key_char.as_deref(), shift, cx);
                }
            }))
            // ── Flat title deck. Named workspaces remain here, but the app frame
            // follows apps.html: square, quiet, mono, and bounded by hairlines. ──
            .child(
                div()
                    .h(px(48.0))
                    // The window titlebar is transparent (traffic lights drawn at
                    // x≈12–64), so the tab strip must start clear of them or the
                    // first tab + "+" hide behind the OS controls. Inset the left
                    // edge past the light cluster; this whole bar is the drag region.
                    .pl(px(78.0))
                    .pr(px(6.0))
                    .flex()
                    .items_center()
                    .gap(px(0.0))
                    .bg(rgb(current_theme().panel))
                    .border_b_1()
                    .border_color(rgb(current_theme().line))
                    // Persistent brand lockup as two signal slabs. The identity
                    // reads as color geometry before it reads as text, matching
                    // the split-field typography in story-linework.
                    .child(
                        div()
                            .h_full()
                            .flex()
                            .items_center()
                            .gap(px(0.0))
                            .child(
                                div()
                                    .h_full()
                                    .px(px(12.0))
                                    .flex()
                                    .items_center()
                                    .bg(rgb(current_theme().accent))
                                    .text_color(rgb(0xfbf7ef))
                                    .font_family("IBM Plex Mono")
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::BOLD)
                                    .child("PORT"),
                            )
                            .child(
                                div()
                                    .h_full()
                                    .px(px(12.0))
                                    .flex()
                                    .items_center()
                                    .bg(rgb(current_theme().engaged))
                                    .text_color(rgb(0x17191d))
                                    .font_family("IBM Plex Mono")
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::BOLD)
                                    .child("DADDY"),
                            )
                            .child(
                                div()
                                    .h_full()
                                    .px(px(12.0))
                                    .flex()
                                    .items_center()
                                    .border_r_1()
                                    .border_color(rgb(current_theme().line))
                                    .font_family("IBM Plex Mono")
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(rgb(current_theme().muted))
                                    .child(format!("pd-console · {}", env!("CARGO_PKG_VERSION"))),
                            ),
                    )
                    .children(tabs.into_iter().map(|(i, name, active)| {
                        div()
                            .id(SharedString::from(format!("tab-{i}")))
                            .px(px(10.0))
                            .py(px(3.0))
                            .font_family("IBM Plex Mono")
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rgb(if active { current_theme().accent_ink } else { current_theme().muted }))
                            // Active tab: raised + a mustard glow. Inactive: lift on hover
                            // (a hard offset shadow stands in for the mock's translateY(-1px)).
                            .when(active, |s| {
                                s.border_b_2().border_color(rgb(current_theme().accent))
                            })
                            .cursor_pointer()
                            .when(!active, |s| {
                                s.hover(|h| {
                                    let t = current_theme();
                                    h.bg(rgb(t.raised)).text_color(rgb(t.ink2))
                                })
                            })
                            .child(name)
                            .on_click(cx.listener(move |this, _ev, _window, cx| {
                                this.active_tab = i;
                                cx.notify();
                            }))
                    }))
                    .child(
                        div()
                            .id("tab-new")
                            .px(px(8.0))
                            .py(px(3.0))
                            .text_size(px(15.0))
                            .text_color(rgb(current_theme().muted))
                            .cursor_pointer()
                            .hover(|s| {
                                let t = current_theme();
                                s.bg(rgb(t.raised)).text_color(rgb(t.accent_ink))
                            })
                            .child("+")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.new_tab();
                                cx.notify();
                            })),
                    )
                    // ⊞ — open the pane launcher (the animated surface grid).
                    .child(
                        div()
                            .id("open-launcher")
                            .px(px(8.0))
                            .py(px(3.0))
                            .text_size(px(15.0))
                            .text_color(rgb(current_theme().muted))
                            .cursor_pointer()
                            .hover(|s| {
                                let t = current_theme();
                                s.bg(rgb(t.raised)).text_color(rgb(t.accent_ink))
                            })
                            .child("⊞")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.launcher_open = true;
                                cx.notify();
                            })),
                    )
                    .child(div().flex_1())
                    .child(motion_toggle_btn(cx))
                    .child(theme_toggle_btn(cx))
                    // The terminal is global operator chrome, not a pane. Its
                    // two-block micro-flag and live dot stay visible everywhere.
                    .child({
                        let open = self.shell_open;
                        let live = self.shell.is_live();
                        let state = if live {
                            current_theme().landed
                        } else {
                            current_theme().gated
                        };
                        div()
                            .id("toggle-cli-drawer")
                            .h(px(22.0))
                            .px(px(7.0))
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .cursor_pointer()
                            .border_b_1()
                            .border_color(rgb(if open {
                                current_theme().accent_ink
                            } else {
                                current_theme().line
                            }))
                            .text_color(rgb(if open {
                                current_theme().accent_ink
                            } else {
                                current_theme().ink2
                            }))
                            .hover(|d| {
                                d.bg(rgb(current_theme().raised))
                                    .text_color(rgb(current_theme().accent_ink))
                            })
                            .child(micro_flag(
                                "cli-global-flag",
                                current_theme().accent,
                                state,
                                7.0,
                                10.0,
                            ))
                            .child(
                                div()
                                    .font_family("IBM Plex Mono")
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_size(px(12.0))
                                    .child(">_ CLI"),
                            )
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.shell_open = !this.shell_open;
                                cx.notify();
                            }))
                    })
                    .child(
                        div()
                            .ml(px(10.0))
                            .mr(px(8.0))
                            .child(micro_flag(
                                "title-deck-flag",
                                current_theme().engaged,
                                current_theme().accent,
                                11.0,
                                15.0,
                            )),
                    ),
            )
            .child(render_story_nav_bar(active_nav.as_deref(), cx))
            // ── HITL interruptions banner (docs/hitl-interruptions.md §4): any
            // open operator ask is surfaced window-wide within one poll (≤30 s
            // jittered, so ≤60 s from creation). Critical/blocking asks paint
            // MAYDAY red; clicking opens the session-gated web answer surface —
            // answer/ack is never offered in-app by design. ──
            .when(hitl_banner.open_count > 0, |root| {
                let critical = hitl_banner.critical_title.clone();
                let link = hitl_banner
                    .deep_link
                    .clone()
                    .unwrap_or_else(|| "/account/interruptions".into());
                let n = hitl_banner.open_count;
                let is_critical = critical.is_some();
                let text = match &critical {
                    Some(title) => format!(
                        "\u{26a0} {n} INTERRUPTION{} \u{2014} critical: {title} \u{2014} fleet dispatch blocked \u{00b7} click to answer",
                        if n == 1 { "" } else { "S" },
                    ),
                    None => format!(
                        "\u{26a0} {n} interruption{} awaiting a human \u{00b7} click to answer",
                        if n == 1 { "" } else { "s" },
                    ),
                };
                root.child(
                    div()
                        .id("hitl-banner")
                        .w_full()
                        .px(px(16.0))
                        .py(px(6.0))
                        .bg(rgb(if is_critical {
                            current_theme().mayday
                        } else {
                            current_theme().gated
                        }))
                        .text_color(rgb(0xfbf7ef))
                        .font_family("IBM Plex Mono")
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .cursor_pointer()
                        .child(text)
                        .on_click(move |_ev, _window, _cx| {
                            // Deep-link only: the web surface is where a HUMAN
                            // session answers or acks (bearer tokens can't).
                            if link.starts_with("http") {
                                let _ = std::process::Command::new("open").arg(&link).spawn();
                            }
                        }),
                )
            })
            // ── Body row: clickable NAV rail (the GUI replacement for the
            // Ctrl-A <key> surface switch the operator hates) + the pane tree.
            // Click a surface name to swap the focused pane — no leader key. ──
            .child(
                div()
                    .flex_1()
                    .flex()
                    .overflow_hidden()
                    .p(px(16.0))
                    .bg(rgb(current_theme().sunken))
                    .child(div().flex_1().h_full().overflow_hidden().child(body)),
            )
            // ── Operator toolbar: always-visible GUI affordances. No leader keys,
            // no memorized syntax — click a button, a placeholder-guided input
            // opens, type, hit Send. This is what makes the console an operator
            // surface instead of a CLI with hidden options. ──
            .child(
                div()
                    .h(px(34.0))
                    .pl(px(16.0))
                    .flex()
                    .items_center()
                    .gap(px(0.0))
                    .bg(rgb(current_theme().panel))
                    .border_t_1()
                    .border_color(rgb(current_theme().line))
                    .child(
                        div()
                            .h_full()
                            .px(px(10.0))
                            .flex()
                            .items_center()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(current_theme().muted))
                            .child("ACT"),
                    )
                    .child(command_bar_btn(CmdKind::Work, "Start work", cx))
                    .child(command_bar_btn(CmdKind::Cartographer, "Ask cartographer", cx))
                    .child(command_bar_btn(CmdKind::AddPane, "Add pane", cx))
                    .child(command_bar_btn(CmdKind::UseDaemon, "Use daemon", cx))
                    // Alerts (HITL): always visible, glows red on errors, click to
                    // open the full untruncated log — the discoverable way to read
                    // a failure (no hidden keystroke).
                    .child({
                        let n = self.alerts.len();
                        let has_err = self.alerts.iter().any(|a| a.level == AlertLevel::Error);
                        let label = if n == 0 {
                            "ALERTS".to_string()
                        } else if has_err {
                            format!("PAN-PAN ALERTS ({n})")
                        } else {
                            format!("ALERTS ({n})")
                        };
                        let border = if has_err { current_theme().gated } else { current_theme().line };
                        let text = if n == 0 {
                            current_theme().muted
                        } else if has_err {
                            current_theme().gated
                        } else {
                            current_theme().accent_ink
                        };
                        div()
                            .id("act-alerts")
                            .h_full()
                            .px(px(12.0))
                            .flex()
                            .items_center()
                            .border_l_1()
                            .border_color(rgb(border))
                            .text_color(rgb(text))
                            .font_family("IBM Plex Mono")
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .cursor_pointer()
                            .hover(|s| {
                                s.bg(rgb(current_theme().raised))
                                    .text_color(rgb(current_theme().accent_ink))
                                    .border_color(rgb(current_theme().accent))
                            })
                            .child(label)
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.ws_mut().swap_surface(SurfaceKind::Hitl);
                                cx.notify();
                            }))
                    }),
            )
            // ── Command / status bar ──
            .child(
                div()
                    .h(px(26.0))
                    .px(px(12.0))
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .bg(rgb(if lit { current_theme().raised } else { current_theme().panel }))
                    .border_t_1()
                    .border_color(rgb(if lit { current_theme().accent_ink } else { current_theme().line }))
                    .child(if let Some(cmd) = command.as_ref() {
                        // Open command line for the selected operator action.
                        render_open_command(cmd, cx)
                    } else if armed {
                        div()
                            .text_color(rgb(current_theme().accent_ink))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(
                                "PREFIX  |  | split · - vsplit · x close · z zoom · o next · =/_ resize · w new-tab · [ ] tabs · n work · t cartographer · i insert-pane · : verb-palette (work/note/begin/done/claim/release/kill/interrupt) · [1-9…] surface",
                            )
                            .into_any_element()
                    } else {
                        div()
                            .w_full()
                            .flex()
                            .items_center()
                            .gap(px(9.0))
                            .text_size(px(12.0))
                            .font_family("IBM Plex Mono")
                            .child(div().text_color(rgb(current_theme().muted)).child("daemon"))
                            .child(
                                div()
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgb(if daemon_connected {
                                        current_theme().landed
                                    } else {
                                        current_theme().engaged
                                    }))
                                    .child(if daemon_connected { "connected" } else { "connecting" }),
                            )
                            .child(
                                div()
                                    .w(px(20.0))
                                    .h(px(10.0))
                                    .flex()
                                    .child(div().w(px(10.0)).h_full().bg(rgb(current_theme().engaged)))
                                    .child(div().w(px(10.0)).h_full().bg(rgb(if daemon_connected {
                                        current_theme().landed
                                    } else {
                                        current_theme().gated
                                    }))),
                            )
                            .child(div().text_color(rgb(current_theme().muted)).child(daemon_url.clone()))
                            .child(div().text_color(rgb(current_theme().muted)).child(format!("{pane_count} panes")))
                            .child(div().flex_1())
                            .child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .child(format!("hot bus · PTY event-driven · ^A space · {}", build_stamp())),
                            )
                            .into_any_element()
                    }),
            )
            // Global PTY drawer: above the pane tree, below modal launcher/splash.
            .children(shell_drawer)
            // Pane launcher overlay — last child, paints over everything.
            .children(launcher)
            // Splash paints last so it sits above all chrome while booting.
            .children(splash)
    }
}

#[cfg(test)]
mod add_pane_tests {
    use super::*;

    #[test]
    fn failed_editor_open_preserves_the_file_tree_and_cache() {
        let root = env!("CARGO_MANIFEST_DIR").to_string();
        let original = SurfaceKind::FileTree {
            root: Some(root.clone()),
        };
        let mut workspace = Workspace::new(original.clone());
        let mut editors = HashMap::new();

        let error = open_editor_transaction(
            &mut workspace,
            &mut editors,
            root,
            None,
            "test:operator".into(),
            EditorPlacement::ReplaceFocused,
        )
        .expect_err("reading a directory as a file must fail");

        assert!(error.contains("Could not open"));
        assert_eq!(workspace.focused_surface(), &original);
        assert!(
            editors.is_empty(),
            "failed candidates must not enter the cache"
        );
    }

    #[test]
    fn successful_editor_open_commits_surface_and_cache_together() {
        let path = format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR"));
        let mut workspace = Workspace::new(SurfaceKind::FileTree { root: None });
        let mut editors = HashMap::new();

        open_editor_transaction(
            &mut workspace,
            &mut editors,
            path.clone(),
            None,
            "test:operator".into(),
            EditorPlacement::ReplaceFocused,
        )
        .expect("manifest is readable");

        assert_eq!(
            workspace.focused_surface(),
            &SurfaceKind::Editor {
                path: path.clone(),
                region: None,
            }
        );
        assert!(editors
            .get(&editor_key(&path, None))
            .is_some_and(|state| state.pane.buffer().is_some()));
    }

    #[test]
    fn failed_editor_recovery_returns_to_its_parent_directory() {
        assert_eq!(
            editor_recovery_root("/repo/private/file.rs").as_deref(),
            Some("/repo/private")
        );
        assert!(editor_recovery_root("file.rs").is_none());
    }

    #[test]
    fn picker_matches_nav_by_id_label_and_key() {
        // Dedicated-variant surfaces resolve to their own kind.
        assert!(matches!(
            surface_for_query("fleet"),
            Some(SurfaceKind::Fleet)
        ));
        assert!(matches!(
            surface_for_query("roadmap"),
            Some(SurfaceKind::Roadmap)
        ));
        // The new Cost ledger resolves via the generic Panel path (nav id "ledger").
        match surface_for_query("cost") {
            Some(SurfaceKind::Panel { nav }) => assert_eq!(nav, "ledger"),
            other => panic!("'cost' should map to the ledger panel, got {other:?}"),
        }
        // Match by single-key too (ledger's leader key is 'b').
        match surface_for_query("b") {
            Some(SurfaceKind::Panel { nav }) => assert_eq!(nav, "ledger"),
            other => panic!("key 'b' should map to the ledger panel, got {other:?}"),
        }
    }

    #[test]
    fn retired_galaxy_pane_gets_migration_guidance() {
        let reply = retired_galaxy_pane_reply(" galaxy ").expect("retired pane reply");

        assert_eq!(reply["ok"], false);
        assert_eq!(
            reply["error"],
            "pane galaxy was renamed to sextant; use pane=sextant."
        );
        assert!(retired_galaxy_pane_reply("sextant").is_none());
    }

    #[test]
    fn picker_matches_non_nav_surfaces() {
        assert!(matches!(
            surface_for_query("chat"),
            Some(SurfaceKind::CartographerChat)
        ));
        assert!(matches!(
            surface_for_query("files"),
            Some(SurfaceKind::FileTree { .. })
        ));
        assert!(matches!(
            surface_for_query("tree"),
            Some(SurfaceKind::FileTree { .. })
        ));
        assert!(matches!(
            surface_for_query("alerts"),
            Some(SurfaceKind::Hitl)
        ));
    }

    #[test]
    fn picker_matches_work_surface() {
        // Work and its read-only projection alias resolve to the internal surface.
        assert!(matches!(surface_for_query("work"), Some(SurfaceKind::Work)));
        assert!(matches!(surface_for_query("plan"), Some(SurfaceKind::Work)));
        assert!(surface_for_query("conjure").is_none());
        // Work is not backed by a generic NAV pane.
        assert!(nav_id_for_surface(&SurfaceKind::Work).is_none());
        assert_eq!(
            launcher_id_for_surface(&SurfaceKind::Work).as_deref(),
            Some("work")
        );
    }

    #[test]
    fn launcher_exposes_every_foreground_surface() {
        let ids = launcher_items()
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        for id in ["chat", "files", "alerts", "work"] {
            assert!(ids.contains(&id), "launcher must expose {id}");
        }
        assert!(matches!(
            surface_for_launcher_id("chat"),
            SurfaceKind::CartographerChat
        ));
        assert!(matches!(
            surface_for_launcher_id("files"),
            SurfaceKind::FileTree { .. }
        ));
        assert!(matches!(
            surface_for_launcher_id("alerts"),
            SurfaceKind::Hitl
        ));
        assert!(matches!(surface_for_launcher_id("work"), SurfaceKind::Work));
    }

    #[test]
    fn launcher_keys_are_unique() {
        let items = launcher_items();
        for (i, left) in items.iter().enumerate() {
            for right in items.iter().skip(i + 1) {
                assert_ne!(left.key, right.key, "duplicate launcher key {}", left.key);
            }
        }
    }

    #[test]
    fn launcher_layout_fits_small_viewports() {
        let layout = launcher_layout(640.0, 520.0, launcher_items().len());
        assert!(layout.card_w <= 640.0);
        assert!(layout.card_h <= 520.0);
        assert!(layout.tile_h >= 58.0);
    }

    #[test]
    fn edit_verb_opens_editor_surface_on_a_path() {
        // `:edit <path>` and the bare `edit <path>` both open the Harbor Editor,
        // preserving the path's case (file systems are case-sensitive).
        match surface_for_query(":edit core/pd-console/src/Mux.rs") {
            Some(SurfaceKind::Editor { path, region }) => {
                assert_eq!(path, "core/pd-console/src/Mux.rs");
                assert_eq!(region, None);
            }
            other => panic!("expected Editor surface, got {other:?}"),
        }
        assert!(matches!(
            surface_for_query("edit README.md"),
            Some(SurfaceKind::Editor { .. })
        ));
        // `:edit` with no path is not an Editor open (falls through to nav match).
        assert!(!matches!(
            surface_for_query(":edit "),
            Some(SurfaceKind::Editor { .. })
        ));
    }

    #[test]
    fn filetree_entries_list_dirs_first_then_files() {
        // The crate's own src/ has both files and (no) subdirs; assert the sort
        // contract against a synthesized listing instead of the real FS shape.
        let dir = std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join("coding/tmp/pd-harbor-ft-test"))
            .unwrap_or_else(|_| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/ft-test")
            });
        std::fs::create_dir_all(dir.join("zsub")).unwrap();
        std::fs::write(dir.join("afile.txt"), "x").unwrap();
        std::fs::write(dir.join("bfile.txt"), "y").unwrap();
        let entries = filetree_entries(Some(&dir.to_string_lossy())).expect("listing");
        // Directory ("zsub/") sorts before files despite z > a/b alphabetically.
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "zsub/");
        let files: Vec<&str> = entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(files, vec!["afile.txt", "bfile.txt"]);
    }

    #[test]
    fn picker_is_case_insensitive_and_rejects_unknown() {
        assert!(matches!(
            surface_for_query("FLEET"),
            Some(SurfaceKind::Fleet)
        ));
        assert!(
            surface_for_query("").is_none(),
            "empty query matches nothing"
        );
        assert!(
            surface_for_query("zzzznope").is_none(),
            "unknown surface matches nothing"
        );
    }

    #[test]
    fn build_stamp_carries_version() {
        let stamp = build_stamp();
        assert!(
            stamp.starts_with("pd-console v"),
            "stamp must name the app: {stamp}"
        );
        assert!(
            stamp.contains(env!("CARGO_PKG_VERSION")),
            "stamp must carry the crate version: {stamp}"
        );
    }

    // The launcher-grid 1:1 invariant tests live in `crate::grid` (gpui-free) so
    // they run in the headless REPL bin under the rust-console gate.

    #[test]
    fn parse_verb_routes_every_write() {
        // Each operator write resolves to its concrete CmdKind, arg preserved.
        let cases = [
            ("note shipped the gate", CmdKind::Note, "shipped the gate"),
            (
                "begin port-daddy:console:main",
                CmdKind::Begin,
                "port-daddy:console:main",
            ),
            (
                "work land the console PR",
                CmdKind::Work,
                "land the console PR",
            ),
            (
                "claim port-daddy:api:main",
                CmdKind::Claim,
                "port-daddy:api:main",
            ),
            (
                "release port-daddy:api:main",
                CmdKind::Release,
                "port-daddy:api:main",
            ),
            ("kill agent-xyz", CmdKind::Kill, "agent-xyz"),
            ("interrupt agent-xyz", CmdKind::InterruptAgent, "agent-xyz"),
            (
                "lane keep going but open the diff first",
                CmdKind::LaneMessage,
                "keep going but open the diff first",
            ),
            (
                "attach core/pd-console/src/main.rs",
                CmdKind::LaneMessage,
                "@file core/pd-console/src/main.rs",
            ),
            (
                "photo /tmp/lane proof.png",
                CmdKind::LaneMessage,
                "@photo /tmp/lane proof.png",
            ),
            (
                "skill native-app-designer",
                CmdKind::LaneMessage,
                "@skill native-app-designer",
            ),
            ("tool cargo test", CmdKind::LaneMessage, "@tool cargo test"),
        ];
        for (line, kind, arg) in cases {
            let (k, a) = parse_verb(line).unwrap_or_else(|| panic!("'{line}' must parse"));
            assert_eq!(k, kind, "verb in '{line}' must route to {kind:?}");
            assert_eq!(a, arg, "arg in '{line}' must be preserved");
        }
    }

    #[test]
    fn parse_verb_done_allows_empty_arg_and_aliases() {
        // `done` with no summary is valid (the summary is optional).
        assert_eq!(parse_verb("done"), Some((CmdKind::Done, String::new())));
        assert_eq!(
            parse_verb("end wrapped up"),
            Some((CmdKind::Done, "wrapped up".to_string()))
        );
        // Legacy launch words fail closed instead of aliasing hidden runtimes.
        assert!(parse_verb("dispatch land it").is_none());
        assert!(parse_verb("spawn land it").is_none());
        assert!(parse_verb("sortie land it").is_none());
        assert!(parse_verb("conjure land it").is_none());
        assert!(matches!(
            parse_verb("chat hey carto"),
            Some((CmdKind::Cartographer, _))
        ));
        assert!(matches!(
            parse_verb("steer write the test first"),
            Some((CmdKind::LaneMessage, _))
        ));
        assert!(matches!(
            parse_verb("stop agent-1"),
            Some((CmdKind::InterruptAgent, _))
        ));
    }

    #[test]
    fn parse_verb_rejects_unknown_and_is_case_insensitive() {
        assert!(parse_verb("frobnicate the widget").is_none());
        assert!(parse_verb("").is_none());
        // Case folds on the verb token.
        assert!(matches!(
            parse_verb("KILL agent-7"),
            Some((CmdKind::Kill, _))
        ));
    }
}
