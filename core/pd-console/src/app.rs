//! pd-console GPUI application — native window, sidebar nav, pane content.
//!
//! Layout:
//!   ┌─ sidebar 96px ─┬──────────── main pane ─────────────┐
//!   │  pd             │  [pane header]                     │
//!   │  ──────         │                                    │
//!   │  ⚓ Fleet  1    │   active pane blocks               │
//!   │  🧭 Cockpit 2   │                                    │
//!   │  🚀 Sorties 3   │                                    │
//!   │  ...            │                                    │
//!   └────────────────┴─────────────────────────────────────┘
//!   ┌─ status bar ───────────────────────────────────────┐
//!   │  daemon: <resolved-url>  ·  pd-console 0.2         │
//!   └────────────────────────────────────────────────────┘
//!
//! Keys 1-9, s, m, p, h, c switch panels.

use gpui::prelude::*;
use gpui::*;

use crate::agent::{Backend, ModelCatalog, Tier};
pub use crate::chat::ChatUpdate;
use crate::chat::{chat_display_text, chat_error_display_text, ChatLog, ChatMsg, ChatState};
use crate::dispatch_pane::DispatchHead;
use crate::mux::{default_operator_workspace, Dir, Node, PaneId, SurfaceKind, Workspace};
use crate::palette::{Theme, ThemeMode};
use crate::pane::{Alert, AlertLevel, Block, OperatorTurn, Pane, Tone};
use crate::tokens;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc;
use std::time::Duration;

/// Operator control messages sent from the GPUI view (button clicks) back to the
/// background refresh thread, which owns the surfaces and performs the daemon
/// mutation. Keeps the foreground thread free of async/tokio.
#[derive(Debug, Clone)]
pub enum ControlMsg {
    /// Grab the wheel: interrupt the agent the Lane is watching.
    InterruptLane,
    /// Kick off a new top-level agent: `POST /spawn` with a backend + prompt +
    /// an optional resolved model id (from the capability tier the operator picked).
    Spawn {
        backend: String,
        prompt: String,
        model: Option<String>,
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
    /// Operator chat: a turn UP the tube on the stable per-conversation channel
    /// (`console-chat`). The background thread binds a real conversational
    /// responder on the first turn (spawns a Claude Code agent on the channel,
    /// `POST /spawn`), then `tube_send`s subsequent turns and `tube_poll`s replies
    /// DOWN the same channel — both off the gpui executor. Replies flow back over
    /// the [`ChatUpdate`] bus.
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
    /// Generate a predicted DAG LIVE from the operator's prompt via the Max-seat
    /// `claude` CLI (print mode, NO API key). Runs on a blocking worker
    /// (`conjure::generate_dag_via_cli`): `claude -p "<DAG_GEN_PROMPT>"`, parse the
    /// JSON it returns, fall back to the prompt-seeded fixture on any error. The
    /// resulting DAG is pushed back to the view over the Conjure-update channel,
    /// which swaps to the Conjure surface AND kicks the inline Vello render.
    ConjureGenerate {
        prompt: String,
    },
    /// Render the live Conjure DAG to a PNG via the Vello proto. Carries the DAG
    /// already serialized to the proto's JSON shape (the foreground owns the DAG;
    /// serializing on the gpui thread is cheap and keeps the worker self-contained)
    /// plus a short title for the success flash. The background thread writes the
    /// JSON where the proto reads it, shells `pd-conjure-proto/scripts/capture.sh`
    /// (RELEASE + UNSANDBOXED — required: debug fontique panics on macOS 15 and the
    /// Metal readback is SIGKILLed under a sandbox), then `open`s the PNG. The
    /// shell-out runs on a blocking worker so it never stalls the refresh loop and
    /// never touches the gpui render thread.
    RenderConjureGraph {
        dag_json: String,
        title: String,
    },
    /// Dispatch the committed (non-HITL-gated) Conjure nodes to live agents. Each
    /// request carries the vendor backend chosen by the node's `model_tier`
    /// (the multi-vendor map), the goal prompt (role + why), and the skill id. The
    /// worker spawns each through the SAME `DaemonClient::spawn` the manual Spawn
    /// command uses (the daemon's existing multi-vendor spawner), and surfaces each
    /// outcome as an Alert — Info with the agent id on launch, Error on a refusal.
    /// `gated` is how many nodes were held back behind the HITL gate, reported so
    /// the operator knows the dispatch was partial by design.
    ConjureDispatch {
        requests: Vec<ConjureDispatchRequest>,
        gated: usize,
    },
    /// Switch the whole console to another daemon berth (ADR-0084). The producer
    /// swaps its `DaemonClient` so every pane's next refresh hits the new daemon.
    RebindDaemon {
        url: String,
    },
    /// Steer the galaxy pane's query (control socket `galaxy` command): the
    /// producer thread owns the pane, so params travel the same channel as
    /// every other operator mutation.
    GalaxyParams {
        window_hours: Option<u32>,
        min_tokens: Option<u32>,
    },
    /// Toggle galaxy clustering (cluster=false skips k-means + MI labels
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
    /// Propose a dispatch into the review queue: `POST /dispatches`.
    ProposeDispatch {
        goal: String,
    },
    /// Launch a sortie mission: `POST /sorties` (projectDir from PD_CONSOLE_WORKDIR).
    LaunchSortie {
        goal: String,
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
    /// Convene a parley from a session-galaxy selection: `POST /parley/call`.
    /// `parties` are DEDUPED AGENT ids (`fleet_transcripts.spawned_agent_id` —
    /// never transcript/session ids; parley DMs parties via agent inbox). The
    /// daemon 400s below 2 distinct ids; the UI disables the button first, and
    /// any rejection body comes back verbatim on the alert bus.
    GalaxyParley {
        surface: String,
        reason: String,
        parties: Vec<String>,
    },
    /// Fetch one galaxy session's full detail: `GET /galaxy/session/:id`
    /// (`:id` = the transcript id from a clicked point). The parsed
    /// [`crate::galaxy_pane::GalaxyDetail`] returns on the dedicated galaxy bus
    /// (mirroring the conjure bus), drained into the view's detail drawer.
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
}

/// A flattened, transport-ready spawn request for one Conjure node — the wire
/// form of `conjure::DispatchRequest` carried across the control channel to the
/// background worker. `backend` is the daemon spawner id string (e.g. "gemini",
/// "claude-cli") already resolved from the node's `model_tier`.
#[derive(Debug, Clone)]
pub struct ConjureDispatchRequest {
    pub node_id: String,
    pub backend: String,
    pub skill_id: String,
    pub goal: String,
    pub model_tier: String,
}

/// A push from the background worker back to the view about the Conjure surface.
/// The worker owns the claude:cli round-trip and the Vello render (both blocking);
/// it streams the results back here so the foreground can update `conjure_dag` /
/// `conjure_png_path` and `cx.notify()` without ever blocking the render thread.
#[derive(Debug, Clone)]
pub enum ConjureUpdate {
    /// A freshly-generated DAG (claude:cli, or the fixture fallback). The view
    /// stores it, swaps to the Conjure surface, and clears the stale PNG so the
    /// inline graphic shows a "rendering…" placeholder until the new PNG lands.
    Dag(crate::conjure::PredictedDag),
    /// The path to the rendered Vello PNG for the current DAG — shown INLINE at the
    /// top of the Conjure surface (gpui `img(path)`).
    Png(std::path::PathBuf),
}

/// A push from the background worker back to the view about the Galaxy surface:
/// the parsed session detail for a clicked point, or the daemon's real failure
/// (surfaced in the drawer, never swallowed). Rides its own small bus alongside
/// the conjure/chat buses in `main.rs`.
#[derive(Debug, Clone)]
pub enum GalaxyUpdate {
    Detail(crate::galaxy_pane::GalaxyDetail),
    DetailError(String),
}

/// Resolve the default (pre-rendered fixture) Conjure PNG path. Honors the
/// `PD_CONJURE_PROTO_DIR` override (a packaged app points at its installed copy);
/// otherwise it is the sibling `pd-conjure-proto` crate's `conjure-dag-vello.png`,
/// located via `CARGO_MANIFEST_DIR` at build time. Mirrors `main::conjure_proto_dir`
/// so the default inline graphic and the live render write/read the same file.
pub fn default_conjure_png() -> Option<std::path::PathBuf> {
    let proto = if let Ok(dir) = std::env::var("PD_CONJURE_PROTO_DIR") {
        std::path::PathBuf::from(dir)
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("pd-conjure-proto"))?
    };
    Some(proto.join("conjure-dag-vello.png"))
}

/// Which command line is open at the bottom of the console.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmdKind {
    /// Kick off a new job. Buffer is `[backend] <prompt>`.
    Spawn,
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
    /// Conjure a predicted DAG from an operator prompt. Buffer is the free-text
    /// intent ("ship a settings flow with tests"). On submit it produces a
    /// `PredictedDag` (the windags `next_move` path when reachable, else the
    /// prompt-seeded fixture), stores it in `ConsoleView::conjure_dag`, and swaps
    /// the focused pane to the Conjure surface. Handled locally (no daemon round-trip).
    Conjure,
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
    /// Propose a dispatch. Buffer is the goal text. → `POST /dispatches`.
    Propose,
    /// Launch a sortie. Buffer is the goal/prompt. → `POST /sorties`.
    Sortie,
    /// Claim a port for an identity. Buffer is the identity. → `POST /claim`.
    Claim,
    /// Release a claimed port. Buffer is the identity. → `DELETE /release`.
    Release,
    /// Kill (unregister) an agent. Buffer is the agent id. → `DELETE /agents/:id`.
    Kill,
    /// Interrupt a specific agent. Buffer is the agent id. → `POST /agents/:id/interrupt`.
    InterruptAgent,
    /// Convene a parley over the current galaxy selection. Buffer is the
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
            CmdKind::Spawn => "spawn",
            CmdKind::Cartographer => "cartographer",
            CmdKind::LaneMessage => "message agent",
            CmdKind::DispatchReject => "reject reason",
            CmdKind::AddPane => "add pane",
            CmdKind::Conjure => "conjure",
            CmdKind::UseDaemon => "use daemon",
            CmdKind::Note => "note",
            CmdKind::Begin => "begin (identity)",
            CmdKind::Done => "done (summary)",
            CmdKind::Propose => "propose (goal)",
            CmdKind::Sortie => "sortie (goal)",
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
    /// Returns an owned `String` because the Spawn hint's backend list is
    /// GENERATED from [`Backend::ALL`] (see [`spawn_backend_hint`]) rather than
    /// hardcoded, so it always reflects the real backend set — Groq, LM Studio,
    /// and any future backend appear automatically and the hint can never drift
    /// out of sync with what the picker actually offers.
    fn placeholder(&self) -> String {
        match self {
            CmdKind::Spawn => {
                format!(
                    "claude: summarize the open PRs   (backend: task — try {})",
                    spawn_backend_hint()
                )
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
                "fleet · cost · roadmap · lane · dispatch · chat · files · alerts · conjure…"
                    .to_string()
            }
            CmdKind::Conjure => {
                "describe the work — windags blooms a predicted DAG of skill-equipped agents"
                    .to_string()
            }
            CmdKind::UseDaemon => format!(
                "prod · latest · dev-latest · :{} · berth name…",
                crate::berths::STABLE_PORT
            ),
            CmdKind::Note => "record an operator note in Port Daddy memory…".to_string(),
            CmdKind::Begin => "port-daddy:console:task".to_string(),
            CmdKind::Done => "what changed, what was validated, what remains…".to_string(),
            CmdKind::Propose => "describe the dispatch goal for the review queue…".to_string(),
            CmdKind::Sortie => "describe the sortie mission to launch…".to_string(),
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
            CmdKind::Verb => {
                "note/begin/done/propose/sortie/claim/release/kill/interrupt …".to_string()
            }
        }
    }
}

/// The backend names shown in the Spawn placeholder hint, generated from
/// [`Backend::ALL`] so the hint never drifts from the real backend set. We
/// curate to the commonly-reached vendors plus the local options — but pulled
/// from the live enum (never a hand-kept literal), so adding a backend to
/// `Backend::ALL` surfaces it here for free. `custom` is omitted (it is an
/// escape hatch, not a starting suggestion).
fn spawn_backend_hint() -> String {
    Backend::ALL
        .into_iter()
        .filter(|b| *b != Backend::Custom)
        .map(|b| b.as_str())
        .collect::<Vec<_>>()
        .join(" · ")
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
        id: "conjure",
        label: "Conjure",
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
        "conjure" => SurfaceKind::Conjure,
        nav => surface_for_nav_id(nav),
    }
}

fn launcher_id_for_surface(surface: &SurfaceKind) -> Option<String> {
    match surface {
        SurfaceKind::CartographerChat => Some("chat".to_string()),
        SurfaceKind::FileTree { .. } => Some("files".to_string()),
        SurfaceKind::Hitl => Some("alerts".to_string()),
        SurfaceKind::Conjure => Some("conjure".to_string()),
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
        "plan" => return Some(SurfaceKind::Conjure),
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

/// An open command line: a prompt kind plus the text typed so far. For `Spawn`
/// it also carries the structured picker state (chosen backend + tier) the
/// operator selects from inline chips before typing the free-text prompt.
#[derive(Debug, Clone)]
pub struct CommandLine {
    kind: CmdKind,
    buffer: String,
    /// Spawn picker: chosen backend (None → still choosing).
    backend: Option<Backend>,
    /// Spawn picker: chosen capability tier (None → still choosing).
    tier: Option<Tier>,
    /// Whether the chosen backend offers tiers (set from the ModelCatalog when
    /// the backend is picked, so `spawn_step` stays catalog-free).
    tier_applies: bool,
}

/// Which step of the Spawn structured picker is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpawnStep {
    Backend,
    Tier,
    Prompt,
}

impl CommandLine {
    fn new(kind: CmdKind) -> Self {
        Self {
            kind,
            buffer: String::new(),
            backend: None,
            tier: None,
            tier_applies: false,
        }
    }

    fn with_buffer(kind: CmdKind, buffer: String) -> Self {
        let mut cmd = Self::new(kind);
        cmd.buffer = buffer;
        cmd
    }

    /// The active step for a Spawn command: pick a backend, then a tier, then
    /// type the prompt. Backends with no tiers in the config skip the tier step.
    fn spawn_step(&self) -> SpawnStep {
        if self.backend.is_none() {
            SpawnStep::Backend
        } else if self.tier.is_none() && self.tier_applies {
            SpawnStep::Tier
        } else {
            SpawnStep::Prompt
        }
    }

    /// True once the picker is done and we're typing the prompt.
    fn spawn_ready(&self) -> bool {
        self.kind != CmdKind::Spawn || self.spawn_step() == SpawnStep::Prompt
    }
}

/// Backends matching the picker filter (case-insensitive prefix on label or id).
fn filtered_backends(filter: &str) -> Vec<Backend> {
    let f = filter.trim().to_lowercase();
    Backend::ALL
        .into_iter()
        .filter(|b| {
            f.is_empty()
                || b.as_str().to_lowercase().starts_with(&f)
                || b.label().to_lowercase().contains(&f)
        })
        .collect()
}

/// Tiers the config defines for this backend, matching the picker filter. Only
/// tiers with a resolved model are shown — the set is data, not hard-coded.
fn filtered_tiers(catalog: &ModelCatalog, backend: Backend, filter: &str) -> Vec<Tier> {
    let f = filter.trim().to_lowercase();
    Tier::ALL
        .into_iter()
        .filter(|t| catalog.resolve(backend, *t).is_some())
        .filter(|t| {
            f.is_empty() || t.as_str().starts_with(&f) || t.label().to_lowercase().contains(&f)
        })
        .collect()
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
        | "conjure" => t.accent,
        "roadmap" | "planner" | "adrs" | "memory" | "lineage" | "substrate" | "galaxy" => t.landed,
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

/// Honour a reduced-motion preference (`PD_CONSOLE_REDUCED_MOTION=1`). gpui has
/// no `@media (prefers-reduced-motion)`, so this is the native opt-out: when set,
/// motion resolves to its final state instantly (orientation cues like the hover
/// glow stay; only the travel is dropped).
fn reduced_motion() -> bool {
    std::env::var("PD_CONSOLE_REDUCED_MOTION")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
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
        const W: f32 = 46.0;
        const H: f32 = 28.0;
        const STRIPS: usize = 14;
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
                    .text_size(px(14.0))
                    .font_weight(FontWeight::BOLD)
                    .child(letter.to_string()),
            )
    }
}

pub(crate) fn render_block(block: Block, motion: FlagMotion) -> impl IntoElement {
    let t = current_theme();
    match block {
        Block::Header(text) => div()
            .mx(px(tokens::SPACE_3))
            .mt(px(tokens::SPACE_3))
            .mb(px(tokens::SPACE_1))
            .px(px(tokens::SPACE_3))
            .py(px(tokens::SPACE_2))
            .rounded(px(tokens::RADIUS_MD))
            .border_1()
            .border_color(rgb(t.line))
            .bg(rgb(t.raised))
            .shadow(motion::hard_offset(t.sunken, 0.0, 2.0))
            .flex()
            .items_center()
            .gap(px(tokens::SPACE_2))
            .child(
                div()
                    .w(px(5.0))
                    .h(px(18.0))
                    .rounded(px(tokens::RADIUS_SM))
                    .bg(rgb(t.accent)),
            )
            .child(
                div()
                    .text_color(rgb(t.ink))
                    .text_size(px(tokens::TEXT_HEADER))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(text),
            )
            .into_any_element(),
        Block::KeyVal(key, val) => div()
            .flex()
            .items_start()
            .gap(px(tokens::SPACE_3))
            .mx(px(tokens::SPACE_3))
            .my(px(2.0))
            .px(px(tokens::SPACE_3))
            .py(px(tokens::SPACE_2))
            .rounded(px(tokens::RADIUS_MD))
            .border_1()
            .border_color(rgb(t.line))
            .bg(tone_wash(t.raised, 0xd8))
            .hover(|s| {
                let t = current_theme();
                s.border_color(rgb(t.accent))
                    .bg(rgb(t.raised))
                    .shadow(motion::glow(t.accent, 0.16, 10.0, 0.0))
            })
            .child(
                div()
                    .text_color(rgb(t.muted))
                    .text_size(px(tokens::TEXT_CAPTION))
                    .font_weight(FontWeight::SEMIBOLD)
                    .w(px(132.0))
                    .flex_shrink_0()
                    .child(key),
            )
            .child(
                div()
                    .text_color(rgb(t.ink))
                    .text_size(px(tokens::TEXT_BODY))
                    .font_family("IBM Plex Mono")
                    .child(val),
            )
            .into_any_element(),
        Block::Row(cells) => div()
            .flex()
            .items_center()
            .gap(px(tokens::SPACE_3))
            .mx(px(tokens::SPACE_3))
            .my(px(2.0))
            .px(px(tokens::SPACE_3))
            .py(px(tokens::SPACE_2))
            .rounded(px(tokens::RADIUS_MD))
            .border_1()
            .border_color(rgb(t.line))
            .bg(rgb(t.panel))
            .hover(|s| {
                let t = current_theme();
                s.bg(rgb(t.raised))
                    .border_color(rgb(t.accent))
                    .shadow(motion::hard_offset(t.sunken, 0.0, 1.0))
            })
            .children(cells.into_iter().enumerate().map(|(i, cell)| {
                div()
                    .text_color(rgb(if i == 0 {
                        current_theme().accent_ink
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
                .rounded(px(tokens::RADIUS_LG))
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
                                .rounded(px(tokens::RADIUS_SM))
                                .border_1()
                                .border_color(rgb(color_u32))
                                .px(px(tokens::SPACE_1))
                                .py(px(1.0))
                                .text_color(rgb(color_u32))
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
                                .rounded(px(tokens::RADIUS_SM))
                                .border_1()
                                .border_color(rgb(color_u32))
                                .px(px(tokens::SPACE_1))
                                .py(px(1.0))
                                .text_color(rgb(color_u32))
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
                        .rounded(px(tokens::RADIUS_SM))
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
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_1))
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(color)
                .bg(tone_wash(color_u32, 0x20))
                .text_color(color)
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .shadow(motion::glow(color_u32, 0.10, 8.0, 0.0))
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
            div()
                .flex()
                .items_center()
                .gap(px(tokens::SPACE_3))
                .mx(px(tokens::SPACE_3))
                .my(px(2.0))
                .px(px(tokens::SPACE_3))
                .py(px(tokens::SPACE_2))
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(rgb(t.line))
                .bg(tone_wash(color, 0x16))
                .shadow(motion::hard_offset(t.sunken, 0.0, 1.0))
                .hover(|s| {
                    let t = current_theme();
                    s.border_color(rgb(color))
                        .bg(rgb(t.raised))
                        .shadow(motion::glow(color, 0.18, 10.0, 0.0))
                })
                .child(WavingFlag {
                    letter,
                    color,
                    motion,
                })
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
            .rounded(px(tokens::RADIUS_MD))
            .border_1()
            .border_color(rgb(t.line))
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
                .rounded(px(tokens::RADIUS_MD))
                .border_1()
                .border_color(rgb(color))
                .bg(tone_wash(color, 0x18))
                .text_color(rgb(color))
                .text_size(px(tokens::TEXT_BODY))
                .font_family("IBM Plex Mono")
                .shadow(motion::glow(color, 0.14, 12.0, 0.0))
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
        Block::ControlButton { label, enabled, why_disabled, .. } => div()
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
            .rounded(px(6.0))
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
    daemon_url: String,
    /// Provider→tier→model map, loaded from config (not compiled-in), so the
    /// Spawn picker resolves models that can change without a rebuild.
    catalog: ModelCatalog,
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
    /// Dispatch id pending a reject reason (set when the operator opens the reject line).
    reject_target: Option<String>,
    /// In-flight pane-divider drag (grab-the-rope resize); `None` when idle.
    dragging: Option<DragState>,
    /// Laid-out bounds of each split container, keyed by tree path, captured via a
    /// canvas overlay so the drag handler can map a mouse position to a weight.
    split_bounds: Rc<RefCell<HashMap<Vec<usize>, Bounds<Pixels>>>>,
    /// The Conjure surface's predicted DAG — live-generated from the operator's
    /// prompt via the Max-seat `claude` CLI (with the fixture as the offline
    /// fallback), rendered through the Block UI AND the inline Vello graphic.
    conjure_dag: crate::conjure::PredictedDag,
    /// Path to the rendered Vello PNG of `conjure_dag`, shown INLINE at the top of
    /// the Conjure surface. `None` until a render lands (the surface shows a
    /// "rendering graph…" placeholder). Auto-refreshed whenever the DAG changes.
    conjure_png_path: Option<std::path::PathBuf>,
    /// The node the operator clicked in the live Conjure canvas — drives the
    /// inspector drawer (full role/contracts/why/model/cost). `None` ⇒ no drawer.
    conjure_selected: Option<String>,
    /// The pane launcher overlay — an animated grid of surface tiles. `Ctrl-A Space`
    /// (or the ⊞ button) opens it; clicking a tile swaps the focused pane's surface.
    launcher_open: bool,
    /// True once the first pane refresh has landed. Until then the launch splash
    /// (the brand boot flash) covers the chrome.
    booted: bool,
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
    // ── Session Galaxy state (rendered by `galaxy_canvas`; pub(crate) because
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
    /// Camera for the normalized Galaxy world: edge padding, zoom, and pan.
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
}

impl ConsoleView {
    pub fn new(daemon_url: String, initial_pane: Option<String>, cx: &mut Context<Self>) -> Self {
        Self::with_control(daemon_url, initial_pane, None, cx)
    }

    /// Advance the flag wave one frame and keep ticking until it settles.
    /// Driven by `cx.on_next_frame` — safe to schedule from anywhere, unlike
    /// `window.request_animation_frame()` which panics outside paint (it calls
    /// `current_view()`, whose entity stack is empty in an event handler).
    fn tick_flag_motion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
        if !self.flag_ticking {
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
            daemon_url,
            catalog: ModelCatalog::load(),
            focus_handle: cx.focus_handle(),
            control_tx,
            control_flash: None,
            alerts: Vec::new(),
            dispatch_head: None,
            reject_target: None,
            dragging: None,
            split_bounds: Rc::new(RefCell::new(HashMap::new())),
            conjure_dag: crate::conjure::fixture(),
            // Seed the inline graphic from the PRE-RENDERED fixture PNG so the
            // default Conjure view shows the node-graph immediately (no blank
            // pane on first open). Only set when the file actually exists.
            conjure_png_path: default_conjure_png().filter(|p| p.exists()),
            conjure_selected: None,
            // Screenshot/demo hook (mirrors `--pane`): open the launcher on startup
            // so capture tooling can grab it without injecting a keystroke.
            launcher_open: std::env::var("PD_CONSOLE_OPEN_LAUNCHER").is_ok(),
            // Flipped true once the first pane refresh lands (see update_panes).
            // Splash suppression (screenshot hook + PD_CONSOLE_NO_SPLASH opt-out)
            // lives in render()'s gate, not here.
            booted: false,
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
        }
    }

    /// The opening layout: a fleet overview beside a stacked agent-lane /
    /// roadmap column — proof of multiplex on first launch. `initial` (if a
    /// known nav id) becomes the focused pane's surface.
    fn default_workspace(initial: Option<&str>) -> Workspace {
        // Resolve `--pane <id>` through the full surface resolver (NAV ids AND
        // non-NAV surfaces like `conjure`/`plan`/`chat`/`files`), so screenshot
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
        // Conjure renders its (foundation-slice) fixture DAG through the Block UI
        // — no background NAV pane, no windags call yet.
        if matches!(surface, SurfaceKind::Conjure) {
            return crate::conjure::blocks_for_conjure(&self.conjure_dag);
        }
        // The Harbor Editor surface backs the file with a Loro CRDT buffer (P1):
        // the opener becomes a Loro replica keyed to the operator's PD identity,
        // and each line renders with per-PeerID authorship in the gutter. The file
        // read is bounded by EditorPane's line cap, so this synchronous load can't
        // wedge the render; P2+ swaps the local read for a daemon/blob fetch.
        if let SurfaceKind::Editor { path, region } = surface {
            let identity = crate::editor_pane::resolve_operator_identity();
            let mut pane =
                crate::editor_pane::EditorPane::new_with_identity(path.clone(), *region, identity);
            pane.load();
            return pane.view();
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
            "n" => self.command = Some(CommandLine::new(CmdKind::Spawn)),
            "t" => self.command = Some(CommandLine::new(CmdKind::Cartographer)),
            // Insert a new pane of a chosen kind (the add-pane picker).
            "i" => self.command = Some(CommandLine::new(CmdKind::AddPane)),
            // Switch which daemon berth the console talks to (the Daemons pane lists names).
            "u" => self.command = Some(CommandLine::new(CmdKind::UseDaemon)),
            // Operator verb palette (vim-`:`): one entry point for every write
            // (note/begin/done/propose/sortie/claim/release/kill/interrupt).
            ":" => self.command = Some(CommandLine::new(CmdKind::Verb)),
            // Direct single-key shortcuts for the most-used operator writes
            // (free letters, no NAV/leader collision):
            //   f note · e propose · U sortie · r begin · q done · j claim · Q release · X kill
            "f" => self.command = Some(CommandLine::new(CmdKind::Note)),
            "e" => self.command = Some(CommandLine::new(CmdKind::Propose)),
            "U" => self.command = Some(CommandLine::new(CmdKind::Sortie)),
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

    /// Feed one keystroke into the open command line. `key` is the gpui key name
    /// (for enter/escape/backspace/space); `typed` is the actual character for
    /// printable input (case-preserving via `keystroke.key_char`).
    fn handle_command_key(&mut self, key: &str, typed: Option<&str>, cx: &mut Context<Self>) {
        // The Spawn structured picker intercepts keys while choosing a backend or
        // tier: digits 1-9 pick the Nth visible chip, Enter takes the first,
        // typing filters, Backspace steps back. Once a prompt is being typed it
        // falls through to the normal command-line handling below.
        if self
            .command
            .as_ref()
            .map(|c| !c.spawn_ready())
            .unwrap_or(false)
        {
            self.handle_spawn_pick_key(key, typed);
            cx.notify();
            return;
        }
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
        let text = self.chat_input.trim().to_string();
        if text.is_empty() {
            return;
        }
        self.chat_input.clear();
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

    /// Key handling while the Spawn picker is choosing a backend or tier.
    fn handle_spawn_pick_key(&mut self, key: &str, typed: Option<&str>) {
        match key {
            "escape" => self.command = None,
            "backspace" => {
                // Refine the filter, else step back: tier → backend → cancel.
                if let Some(cmd) = self.command.as_mut() {
                    if !cmd.buffer.is_empty() {
                        cmd.buffer.pop();
                    } else if cmd.tier.is_some() {
                        cmd.tier = None;
                    } else if cmd.backend.is_some() {
                        cmd.backend = None;
                    } else {
                        self.command = None;
                    }
                }
            }
            "enter" => self.spawn_pick_index(0), // take the first visible chip
            _ => {
                if let Some(ch) = typed {
                    // A digit is a hotkey for the Nth visible chip (backend/tier
                    // labels carry no digits, so this never clashes with filtering).
                    if let Ok(n) = ch.trim().parse::<usize>() {
                        if n >= 1 {
                            self.spawn_pick_index(n - 1);
                            return;
                        }
                    }
                    if let Some(cmd) = self.command.as_mut() {
                        cmd.buffer.push_str(ch);
                    }
                }
            }
        }
    }

    /// Select the Nth currently-visible chip for the active picker step.
    fn spawn_pick_index(&mut self, idx: usize) {
        let catalog = &self.catalog;
        let Some(cmd) = self.command.as_mut() else {
            return;
        };
        match cmd.spawn_step() {
            SpawnStep::Backend => {
                if let Some(b) = filtered_backends(&cmd.buffer).get(idx).copied() {
                    cmd.backend = Some(b);
                    cmd.tier_applies = catalog.has_tiers(b);
                    cmd.buffer.clear();
                }
            }
            SpawnStep::Tier => {
                if let Some(bk) = cmd.backend {
                    if let Some(t) = filtered_tiers(catalog, bk, &cmd.buffer).get(idx).copied() {
                        cmd.tier = Some(t);
                        cmd.buffer.clear();
                    }
                }
            }
            SpawnStep::Prompt => {}
        }
    }

    /// Click-select a specific backend chip.
    fn spawn_pick_backend(&mut self, b: Backend) {
        let applies = self.catalog.has_tiers(b);
        if let Some(cmd) = self.command.as_mut() {
            cmd.backend = Some(b);
            cmd.tier_applies = applies;
            cmd.buffer.clear();
        }
    }

    /// Click-select a specific tier chip.
    fn spawn_pick_tier(&mut self, t: Tier) {
        if let Some(cmd) = self.command.as_mut() {
            cmd.tier = Some(t);
            cmd.buffer.clear();
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
                self.control_flash = Some(format!(
                    "unknown verb '{verb}' — try note/begin/done/propose/sortie/claim/release/kill/interrupt"
                ));
            }
            return;
        }
        // Reject and Done may submit empty (Reject falls back to a default reason;
        // Done's summary is optional; GalaxyParley falls back to the contract's
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
        // Conjure: the operator's prompt is generated into a real PredictedDag LIVE
        // by the Max-seat `claude` CLI (print mode, NO API key) on a background
        // worker, which streams the DAG back over the Conjure-update channel —
        // swapping to the Conjure surface AND auto-rendering the inline Vello PNG.
        // We swap surfaces and seed the prompt-titled fixture IMMEDIATELY so the
        // operator sees a graph instantly; the live DAG replaces it when it lands.
        // If there's no control plane (an isolated test view), fall back to the
        // local fixture path so the surface is still populated.
        if cmd.kind == CmdKind::Conjure {
            // Optimistic seed so the surface is never blank during the CLI round-trip.
            self.conjure_dag = crate::conjure::from_prompt(&text);
            // A fresh DAG means the old PNG is stale — show the fixture PNG (if any)
            // as a holding graphic until the live render lands.
            self.conjure_png_path = default_conjure_png().filter(|p| p.exists());
            self.ws_mut().swap_surface(SurfaceKind::Conjure);
            if let Some(tx) = &self.control_tx {
                let _ = tx.send(ControlMsg::ConjureGenerate {
                    prompt: text.clone(),
                });
                self.control_flash =
                    Some("generating with claude:cli… the DAG + Vello graphic land below".into());
            } else {
                self.control_flash = Some(format!(
                    "conjured “{}” — {} waves (no control plane: fixture path)",
                    self.conjure_dag.title.clone(),
                    self.conjure_dag.waves.len()
                ));
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
            CmdKind::Spawn => {
                // Structured picker result: backend chosen from chips, tier
                // resolved to a model id. Fall back to free-text `backend: prompt`
                // only if no backend was picked (e.g. a future headless caller).
                let (backend, prompt, model) = if let Some(b) = cmd.backend {
                    // Resolve the model from the runtime config at the moment of
                    // spawn — never compiled-in, so it can't go stale in the binary.
                    let model = cmd.tier.and_then(|t| self.catalog.resolve(b, t));
                    (b.as_str().to_string(), text.clone(), model)
                } else {
                    let (b, p) = split_backend(&text);
                    (b, p, None)
                };
                let label = match cmd.tier {
                    Some(t) if cmd.tier_applies => format!("{backend}·{}", t.as_str()),
                    _ => backend.clone(),
                };
                let _ = tx.send(ControlMsg::Spawn {
                    backend: backend.clone(),
                    prompt,
                    model,
                });
                self.control_flash =
                    Some(format!("spawning a {label} agent — streaming live below"));
                // Immediately surface the live agent lane so the operator SEES the
                // streaming response to the command they just issued. This closes
                // the GUI loop: click Spawn → type → Send → watch it run. The lane
                // auto-targets the newest active agent on its next refresh.
                self.ws_mut()
                    .swap_surface(SurfaceKind::AgentTranscript { agent_id: None });
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
                    self.control_flash = Some("dispatch rejected".into());
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
            CmdKind::Propose => {
                let _ = tx.send(ControlMsg::ProposeDispatch { goal: text });
                self.control_flash = Some("dispatch proposed → review queue".into());
            }
            CmdKind::Sortie => {
                let _ = tx.send(ControlMsg::LaunchSortie { goal: text });
                self.control_flash = Some("sortie launching → watch Sorties".into());
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
                    self.control_flash =
                        Some("steer needs a message — nothing was sent".into());
                    return;
                }
                let _ = tx.send(ControlMsg::HarborControl {
                    verb: "steer".into(),
                    argument: Some(text),
                });
                self.control_flash = Some(
                    "steer queued — watch the node's transcript for the guidance turn".into(),
                );
            }
            // AddPane, Conjure, UseDaemon, and Verb are handled locally above
            // (early return) — never reach here.
            CmdKind::AddPane | CmdKind::Conjure | CmdKind::UseDaemon | CmdKind::Verb => {}
        }
    }

    /// Kick off the Vello render of the current Conjure DAG. Serializes the DAG to
    /// the proto's JSON shape on the foreground (cheap), then hands it to the
    /// background thread, which writes the JSON, shells `capture.sh` (release +
    /// unsandboxed) and `open`s the PNG. The gpui thread never blocks on the
    /// build/render — it only flips a flash and fires the message.
    fn render_conjure_graph(&mut self) {
        let title = self.conjure_dag.title.clone();
        match crate::conjure::to_json(&self.conjure_dag) {
            Ok(dag_json) => {
                if let Some(tx) = &self.control_tx {
                    let _ = tx.send(ControlMsg::RenderConjureGraph { dag_json, title });
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

    /// Dispatch the committed (non-HITL-gated) nodes of the current Conjure DAG to
    /// live agents — the DISPATCH slice. Each node routes to the vendor backend its
    /// `model_tier` names (the multi-vendor map in `agent::backend_for_tier`) and is
    /// spawned through the EXACT spawn path the manual Spawn command uses
    /// (`DaemonClient::spawn` → the daemon's existing multi-vendor spawner). HITL-
    /// gated nodes (`ask_user_before_proceeding`) are EXCLUDED here by
    /// `conjure::dispatch_targets`; they need an explicit per-node confirm, so a
    /// "Dispatch DAG" sweep never auto-launches them. The foreground only shapes the
    /// requests + flips a flash; the worker performs the spawns and reports each
    /// outcome as an Alert (the same surface the Spawn command uses).
    ///
    /// HONEST FRAMING: live launch is env-dependent — the daemon must be up and the
    /// target vendor CLI installed + launchable. The Giant Squid Harness (ADR-0091,
    /// Proposed / not built) is the FUTURE upgrade for richer in-loop vendor-hook
    /// coordination; this slice wires the real spawn path, not that harness.
    fn dispatch_conjure_dag(&mut self) {
        let targets = crate::conjure::dispatch_targets(&self.conjure_dag);
        let gated = crate::conjure::gated_node_count(&self.conjure_dag);
        if targets.is_empty() {
            // A firm "wall" tone — the dispatch is held (all gated) or empty.
            crate::audio::play(crate::audio::Cue::Gate);
            self.control_flash = Some(if gated > 0 {
                format!(
                    "nothing to dispatch — all {gated} node(s) are HITL-gated; confirm each one"
                )
            } else {
                "nothing to dispatch — the DAG has no nodes".into()
            });
            return;
        }
        let requests: Vec<ConjureDispatchRequest> = targets
            .into_iter()
            .map(|r| ConjureDispatchRequest {
                node_id: r.node_id,
                backend: r.backend.as_str().to_string(),
                skill_id: r.skill_id,
                goal: r.goal,
                model_tier: r.model_tier,
            })
            .collect();
        let count = requests.len();
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::ConjureDispatch { requests, gated });
            // A confident rising sweep — committed nodes are launching to their vendors.
            crate::audio::play(crate::audio::Cue::Dispatch);
            let held = if gated > 0 {
                format!(" · {gated} held for your gate")
            } else {
                String::new()
            };
            self.control_flash = Some(format!(
                "dispatching {count} node(s) to their vendors…{held} watch Alerts"
            ));
        } else {
            // No control plane (an isolated test view): nothing to spawn against.
            self.control_flash = Some("dispatch unavailable — no control plane".into());
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
                    .rounded(px(14.0))
                    .border_1()
                    .border_color(rgb(if is_current { tone } else { t.line }))
                    .bg(rgb(t.raised))
                    .cursor_pointer()
                    // Hover "lift" (no transforms): brighter card, tone border, and a
                    // wide tone-coloured bloom — the big apparent-motion cue.
                    .hover(move |s| {
                        let t = current_theme();
                        s.bg(rgb(t.panel))
                            .border_color(rgb(tone))
                            .shadow(motion::glow(tone, 0.55, 32.0, 3.0))
                    })
                    // Icon sits in a big tone-washed chip so colour reads even at a glance.
                    .child(
                        div()
                            .w(px(layout.icon_box))
                            .h(px(layout.icon_box))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px((layout.icon_box * 0.22).clamp(8.0, 16.0)))
                            .bg(tone_wash(tone, 0x26))
                            .child(
                                svg()
                                    .path(item.icon)
                                    .w(px(layout.icon))
                                    .h(px(layout.icon))
                                    .text_color(rgb(tone)),
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
                            .rounded(px(7.0))
                            .bg(tone_wash(tone, 0x1c))
                            .text_color(rgb(t.muted))
                            .text_size(px(layout.key_size))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(format!("⌃A {}", item.key)),
                    )
                    // Owns its glow only in the static cases; the breathing branch below
                    // owns it via the animation (one motion owner per surface).
                    .when(is_current && reduced, |s| {
                        s.shadow(motion::glow(tone, 0.5, 22.0, 2.0))
                    })
                    .on_click(cx.listener(move |this, _ev, _window, cx| {
                        this.ws_mut().swap_surface(surface_for_launcher_id(id));
                        this.launcher_open = false;
                        this.control_flash = Some(format!("→ {id}"));
                        cx.notify();
                    }));

                if reduced {
                    // Reduced motion: no travel, but keep the current-tile glow (above)
                    // for orientation. All tiles render at rest.
                    tile.into_any_element()
                } else if is_current {
                    // The pane you're on *breathes* a tone-coloured glow — a single
                    // looping owner, scoped to this modal overlay (so it only runs
                    // while the launcher is open). This is the "where am I" beacon.
                    tile.with_animation(
                        SharedString::from(format!("launch-breathe-{id}")),
                        Animation::new(Duration::from_millis(2200))
                            .repeat()
                            .with_easing(pulsating_between(0.0, 1.0)),
                        move |el, delta| {
                            el.shadow(motion::glow(
                                tone,
                                0.30 + 0.40 * delta,
                                16.0 + 16.0 * delta,
                                1.0,
                            ))
                        },
                    )
                    .into_any_element()
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
                    .rounded(px(22.0))
                    .bg(rgb(t.panel))
                    .border_1()
                    .border_color(rgb(t.line))
                    .shadow(motion::glow(t.accent, 0.28, 40.0, 1.0))
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
            AlertLevel::Warn => format!("⚑ {} — {head}", alert.title),
            AlertLevel::Info => format!("✓ {}", alert.title),
        });
        self.alerts.insert(0, alert);
        // Steady state: cap the log so a long session can't leak memory.
        const ALERT_CAP: usize = 100;
        if self.alerts.len() > ALERT_CAP {
            self.alerts.truncate(ALERT_CAP);
        }
    }

    /// Apply one Conjure update pushed from the background worker: either a fresh
    /// live-generated DAG (claude:cli) or a rendered Vello PNG path. A new DAG
    /// swaps the focused pane to the Conjure surface so the operator SEES the
    /// generated graph; a PNG just slots into the inline graphic.
    pub fn apply_conjure_update(&mut self, update: ConjureUpdate) {
        match update {
            ConjureUpdate::Dag(dag) => {
                let waves = dag.waves.len();
                let title = dag.title.clone();
                self.conjure_dag = dag;
                // A fresh DAG — drop any node selection from the prior graph.
                self.conjure_selected = None;
                // The new DAG hasn't been rendered yet — drop the stale PNG so the
                // surface shows the "rendering graph…" placeholder until it lands.
                self.conjure_png_path = None;
                self.ws_mut().swap_surface(SurfaceKind::Conjure);
                // The signature "bloom" sting — a DAG just materialized from a prompt.
                crate::audio::play(crate::audio::Cue::Bloom);
                self.control_flash = Some(format!(
                    "claude:cli conjured “{title}” — {waves} waves · rendering the Vello graphic…"
                ));
            }
            ConjureUpdate::Png(path) => {
                self.conjure_png_path = Some(path);
            }
        }
    }

    pub fn update_panes(
        &mut self,
        updates: Vec<(usize, Vec<Block>)>,
        dispatch_head: Option<DispatchHead>,
        galaxy: crate::galaxy_pane::GalaxySnapshot,
    ) {
        // First refresh dismisses the launch splash (idempotent thereafter).
        if !self.booted {
            self.booted = true;
        }
        for (idx, blocks) in updates {
            if let Some(slot) = self.pane_blocks.get_mut(idx) {
                *slot = blocks;
            }
        }
        self.dispatch_head = dispatch_head;
        // Fresh galaxy frame: prune selection/hover of points that slid out of
        // the map window, so a parley can never target a vanished session.
        let ids: HashSet<&str> = galaxy.points.iter().map(|p| p.id.as_str()).collect();
        self.galaxy_selected.retain(|id| ids.contains(id.as_str()));
        if self
            .galaxy_hover
            .as_ref()
            .is_some_and(|h| !ids.contains(h.as_str()))
        {
            self.galaxy_hover = None;
        }
        self.galaxy = galaxy;
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
            ScriptRequest::Focus { pane } => match surface_for_query(&pane) {
                Some(surface) => {
                    self.ws_mut().swap_surface(surface);
                    json!({"ok": true, "focused": self.ws().focused_surface().label()})
                }
                None => json!({
                    "ok": false,
                    "error": format!("unknown pane \"{pane}\""),
                    "panes": NAV.iter().map(|n| n.id).collect::<Vec<_>>(),
                }),
            },
            ScriptRequest::State { pane } => {
                let target = pane.unwrap_or_else(|| {
                    nav_id_for_surface(self.ws().focused_surface())
                        .unwrap_or("fleet")
                        .to_string()
                });
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
                if target == "galaxy" {
                    out["galaxy"] = json!({
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

    /// Cycle the galaxy window through the 4-stop contract (24→72→168→720h);
    /// the canvas's window chip calls this.
    pub(crate) fn cycle_galaxy_window(&mut self) {
        let next = crate::galaxy_pane::next_window_hours(self.galaxy.window_hours);
        if let Some(tx) = &self.control_tx {
            let _ = tx.send(ControlMsg::GalaxyParams {
                window_hours: Some(next),
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
        self.ws_mut()
            .swap_surface(SurfaceKind::Editor { path, region: None });
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
        let motion = self.flag_motion; // Copy snapshot for this frame's flags.
        let is_agent = matches!(surface, SurfaceKind::AgentTranscript { .. });
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
        // The Conjure surface (focused) gets the "Render graph" action bar — the
        // discoverable control that ships the live DAG to the Vello PNG renderer.
        let is_conjure = matches!(surface, SurfaceKind::Conjure);
        // The Galaxy surface renders the bespoke interactive scatter canvas
        // (galaxy_canvas.rs) instead of the generic Block list — the daemon
        // precomputed the layout; the canvas only places, hits, and selects.
        let is_galaxy = nav_id_for_surface(surface) == Some("galaxy");
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
        let conjure_flash = self.control_flash.clone();
        // The rendered Vello PNG (if any) for the inline node-graph at the top of
        // the Conjure surface. `None` ⇒ a tasteful "rendering graph…" placeholder.
        let conjure_png = if is_conjure {
            self.conjure_png_path.clone()
        } else {
            None
        };
        let conjure_title = self.conjure_dag.title.clone();
        let conjure_wave_count = self.conjure_dag.waves.len();
        // How many nodes "Dispatch DAG" would spawn (non-HITL-gated) vs hold back.
        let conjure_dispatch_count = crate::conjure::dispatch_targets(&self.conjure_dag).len();
        let conjure_gated_count = crate::conjure::gated_node_count(&self.conjure_dag);
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
        let gate_flash = self.control_flash.clone();
        let cond_flash = self.control_flash.clone();
        let fleet_flash = self.control_flash.clone();
        let border = if is_focused {
            current_theme().accent_ink
        } else {
            current_theme().line
        };
        let title_color = if is_focused {
            current_theme().accent_ink
        } else {
            current_theme().muted
        };
        let control_flash = self.control_flash.clone();

        div()
            .id(SharedString::from(format!("pane-{id}")))
            // Hover group: the title-bar controls reveal only when this pane is
            // hovered (macOS window-control feel).
            .group("pane")
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(border))
            .bg(rgb(current_theme().panel))
            // Focus glow: a soft mustard halo proves "this pane has the wheel".
            // Unfocused panes preview the warm border + faint glow on hover.
            .when(is_focused, |s| s.shadow(motion::glow(current_theme().accent, 0.45, 16.0, 1.0)))
            .when(!is_focused, |s| {
                s.hover(|h| {
                    h.border_color(rgb(current_theme().accent))
                        .shadow(motion::glow(current_theme().accent, 0.18, 10.0, 0.0))
                })
            })
            .on_click(cx.listener(move |this, _ev, _window, cx| {
                this.ws_mut().focus(id);
                cx.notify();
            }))
            // Title bar: focus dot · label · spacer · hover controls
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .py(px(4.0))
                    .bg(rgb(if is_focused { current_theme().raised } else { current_theme().panel }))
                    .border_b_1()
                    .border_color(rgb(current_theme().line))
                    .child({
                        // The focused pane's dot breathes (presence beacon, the mock's
                        // @keyframes beacon) via a looping with_animation; idle panes are static.
                        let dot = div()
                            .text_color(rgb(if is_focused { current_theme().accent } else { current_theme().line }))
                            .text_size(px(13.0))
                            .child(if is_focused { "●" } else { "○" });
                        if is_focused {
                            dot.with_animation(
                                SharedString::from(format!("dot-pulse-{id}")),
                                Animation::new(Duration::from_millis(2400))
                                    .repeat()
                                    .with_easing(pulsating_between(0.55, 1.0)),
                                |el, delta| el.opacity(delta),
                            )
                            .into_any_element()
                        } else {
                            dot.into_any_element()
                        }
                    })
                    .child(
                        div()
                            .text_color(rgb(title_color))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(label),
                    )
                    // Spacer pushes the controls to the right edge.
                    .child(div().flex_1())
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
            // The Conjure surface leads with the INLINE Vello node-graph (the
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
                    .when(is_conjure, |body| {
                        // The LIVE native canvas is the default view (animated,
                        // interactive); the Vello PNG is an optional poster below,
                        // shown only once the operator renders it.
                        body.child(conjure_canvas(
                            id,
                            &self.conjure_dag,
                            self.conjure_selected.as_deref(),
                            cx,
                        ))
                        .when_some(conjure_png, |b, path| {
                            b.child(conjure_graphic(id, Some(path), &conjure_title))
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
                    None if is_daemons => body.children(daemon_rows),
                    // Galaxy: the interactive embedding map (points, marquee,
                    // hover readout, selection bar, detail drawer).
                    None if is_galaxy => {
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
                    // Every other surface: the generic read-agnostic Block
                    // renderer — except the two interactive Harbor blocks,
                    // which need cx listeners (clickable roster rows and
                    // compliance-gated control buttons; ch18 C3).
                    None => {
                        let mut b = body;
                        for blk in blocks {
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
                                .rounded(px(6.0))
                                .bg(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().bg))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| {
                                    s.shadow(motion::glow(
                                        current_theme().accent,
                                        0.30,
                                        10.0,
                                        0.0,
                                    ))
                                })
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
                                .rounded(px(6.0))
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
                                .rounded(px(6.0))
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
                                .rounded(px(6.0))
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
                                .rounded(px(6.0))
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
                                .rounded(px(6.0))
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
                                    Some(h) => format!("⚑ Review gate · {} awaiting", h.count),
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
                                    .gap(px(8.0))
                                    .child(dispatch_gate_btn(
                                        "approve", "✓ Approve", current_theme().landed, h.id.clone(), cx,
                                    ))
                                    .child(dispatch_gate_btn(
                                        "reject", "✗ Reject…", current_theme().gated, h.id.clone(), cx,
                                    ))
                                    .child(dispatch_gate_btn(
                                        "cancel", "⊘ Cancel", current_theme().muted, h.id.clone(), cx,
                                    )),
                            )
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
            // ── Conjure render action (focused Conjure surface) — the discoverable
            //    "open the Vello PNG of this DAG" control. Serializes the live DAG
            //    to the proto's JSON, shells capture.sh (release+unsandboxed), then
            //    opens the PNG — all on the background/blocking worker, never the
            //    gpui thread. Mirrors the dispatch/conductor gate footer pattern. ──
            .when(is_conjure && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .id("conjure-render")
                                .px(px(12.0))
                                .py(px(5.0))
                                .rounded(px(6.0))
                                .border_1()
                                .border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| {
                                    s.bg(rgb(current_theme().raised))
                                        .shadow(motion::glow(current_theme().accent, 0.24, 8.0, 0.0))
                                })
                                .child("\u{25c8} Render graph")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.render_conjure_graph();
                                    cx.notify();
                                })),
                        )
                        // ── Dispatch DAG — spawn the committed (non-HITL-gated) nodes
                        //    to their vendors (model_tier → backend), each through the
                        //    SAME DaemonClient::spawn the manual Spawn command uses.
                        //    Disabled-looking (muted) when there is nothing to send. ──
                        .when(conjure_dispatch_count > 0, |row| {
                            row.child(
                                div()
                                    .id("conjure-dispatch")
                                    .px(px(12.0))
                                    .py(px(5.0))
                                    .rounded(px(6.0))
                                    .border_1()
                                    .border_color(rgb(current_theme().accent))
                                    .text_color(rgb(current_theme().accent_ink))
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .cursor_pointer()
                                    .hover(|s| {
                                        s.bg(rgb(current_theme().raised))
                                            .shadow(motion::glow(current_theme().accent, 0.24, 8.0, 0.0))
                                    })
                                    .child(format!("\u{2693} Dispatch DAG ({conjure_dispatch_count})"))
                                    .on_click(cx.listener(|this, _ev, _window, cx| {
                                        this.dispatch_conjure_dag();
                                        cx.notify();
                                    })),
                            )
                        })
                        .child(
                            div()
                                .text_color(rgb(current_theme().muted))
                                .text_size(px(13.0))
                                .child(format!(
                                    "{conjure_wave_count} waves \u{00b7} dispatch {conjure_dispatch_count} to vendors \u{00b7} {conjure_gated_count} gated \u{00b7} Vello \u{2192} PNG"
                                )),
                        )
                        .when_some(conjure_flash, |bar, flash| {
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
                                .child("\u{2693} Agent ops \u{2014} target by id"),
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
                                .child(fleet_ops_btn("kill", "\u{2715} Kill agent\u{2026}", current_theme().conflict, cx))
                                .child(fleet_ops_btn("interrupt", "\u{25fc} Interrupt\u{2026}", current_theme().gated, cx)),
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
    /// Selected/active: a solid tone wash + a gated breathing halo (static under
    /// reduced motion).
    selected: bool,
    /// Stretch to fill the row (a list item) instead of hugging its content.
    full_width: bool,
}

/// The console's one clickable-control primitive — reuse it for every operator
/// button (daemon rows, future toolbar actions, gates) instead of hand-rolling a
/// `div`. Motion is composed the gpui way, **no transforms**: hover lifts via a
/// soft `glow` (free GPU-side `.hover` lane, no notify), press sinks via the
/// `sunken` bg + a 1px `hard_offset`, and a `selected` button breathes a halo
/// through a single `with_animation` owner (reduced-motion resolves it to a
/// static glow — orientation kept, travel dropped). Colours read from theme
/// roles so it survives the `Ctrl-A g` light⇄dark flip.
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
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(if opts.selected { color } else { t.line }))
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
                .rounded(px(tokens::RADIUS_SM))
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
        .hover(move |s| {
            s.bg(rgb(current_theme().raised))
                .border_color(rgb(color))
                .shadow(motion::glow(color, 0.22, 10.0, 0.0))
        })
        .active(move |s| {
            s.bg(rgb(current_theme().sunken))
                .shadow(motion::hard_offset(color, 0.0, 1.0))
        })
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            on_click(this, cx);
            cx.notify();
        }));

    // Selected → a breathing halo. One animation owner, id keyed per-button so
    // siblings don't share a clock; reduced motion drops to a static glow.
    if opts.selected && !reduced_motion() {
        row.with_animation(
            SharedString::from(format!("btn-pulse-{id}")),
            Animation::new(Duration::from_millis(2000))
                .repeat()
                .with_easing(pulsating_between(0.5, 1.0)),
            move |el, delta| {
                el.shadow(motion::glow(
                    color,
                    0.10 + delta * 0.28,
                    6.0 + delta * 8.0,
                    0.0,
                ))
            },
        )
        .into_any_element()
    } else if opts.selected {
        row.shadow(motion::glow(color, 0.30, 10.0, 0.0))
            .into_any_element()
    } else {
        row.into_any_element()
    }
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
        .rounded(px(tokens::RADIUS_MD))
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
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(color))
        .text_color(rgb(color))
        .text_size(px(tokens::TEXT_BODY))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .child(label)
        .hover(move |s| {
            s.bg(rgb(current_theme().raised))
                .shadow(motion::glow(color, 0.22, 8.0, 0.0))
        })
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
fn vendor_accent(tier: &str) -> u32 {
    let t = current_theme();
    let s = tier.to_ascii_lowercase();
    let has = |n: &str| s.contains(n);
    if has("opus") || has("sonnet") || has("haiku") || has("claude") {
        t.accent
    } else if has("gemini") {
        t.landed
    } else if has("codex") || has("gpt") || has("o1") || has("o3") {
        0x_b6_9c_ff // violet — no palette role, matches the Vello codex chip
    } else if has("groq") || has("llama") || has("mixtral") {
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

/// One live, interactive node card in the Conjure canvas. Themed to the same
/// maritime palette as the Vello render: a commitment-colored border + rail, a
/// vendor chip, a cost/time footer, an HITL gate marker, hover-lift, and — for
/// COMMITTED nodes — a continuously BREATHING glow (the "presence beacon", a
/// looping `with_animation`) so the graph is visibly alive, not a static image.
/// Clicking the card selects it, opening the inspector drawer.
fn conjure_card(
    id: PaneId,
    node: &crate::conjure::PredictedNode,
    is_selected: bool,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let theme = current_theme();
    let accent = commitment_accent(&node.commitment_level);
    let committed = node.commitment_level.eq_ignore_ascii_case("COMMITTED");
    let tentative = node.commitment_level.eq_ignore_ascii_case("TENTATIVE");
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
    let border = if is_selected { theme.accent } else { accent };
    let bg = if is_selected {
        theme.raised
    } else {
        theme.panel
    };

    let card = div()
        .id(SharedString::from(format!("conjure-card-{id}-{nid}")))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .w(px(248.0))
        .p(px(12.0))
        .rounded(px(12.0))
        .border_1()
        .border_color(rgb(border))
        .bg(rgb(bg))
        .cursor_pointer()
        .hover(move |s| {
            s.bg(rgb(theme.raised))
                .border_color(rgb(theme.accent))
                .shadow(motion::glow(theme.accent, 0.34, 16.0, 1.0))
        })
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.conjure_selected = Some(nid.clone());
            crate::audio::play(crate::audio::Cue::Tick);
            cx.notify();
        }))
        // Header: a commitment-colored skill eyebrow + an optional HITL gate flag.
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(accent))
                        .child(skill),
                )
                .when(gate, |r| {
                    r.child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(theme.gated))
                            .child("\u{26d4} GATE"),
                    )
                }),
        )
        // Role — what this agent does in context.
        .child(
            div()
                .text_size(px(14.0))
                .text_color(rgb(theme.ink))
                .child(role),
        )
        // Footer: a vendor model-tier chip + a success-tinted cost/time line.
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded_full()
                        .border_1()
                        .border_color(rgb(vchip))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(vchip))
                        .child(model),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(rgb(theme.landed))
                        .child(metrics),
                ),
        );

    if committed {
        // The breathing glow — a looping halo that proves the graph is live.
        card.with_animation(
            SharedString::from(format!("conjure-pulse-{id}-{}", node.id)),
            Animation::new(Duration::from_millis(2200))
                .repeat()
                .with_easing(pulsating_between(0.0, 1.0)),
            move |el, delta| el.shadow(motion::glow(accent, 0.16 + 0.30 * delta, 15.0, 0.0)),
        )
        .into_any_element()
    } else {
        let a = if tentative { 0.16 } else { 0.07 };
        card.shadow(motion::glow(accent, a, 10.0, 0.0))
            .into_any_element()
    }
}

/// The LIVE, interactive Conjure node-graph rendered natively in gpui — the
/// default view of the Conjure surface. Replaces the static Vello PNG as the
/// primary graphic: wave columns of [`conjure_card`]s (commitment-themed,
/// breathing, hover-lit, clickable), an editorial header, and — when a node is
/// selected — a full inspector drawer. The Vello PNG remains reachable as an
/// optional "poster" beneath, rendered on demand by the "Render graph" action.
fn conjure_canvas(
    id: PaneId,
    dag: &crate::conjure::PredictedDag,
    selected: Option<&str>,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let theme = current_theme();
    let n_nodes: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
    let title = if dag.title.is_empty() {
        "predicted DAG".to_string()
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
                .map(|node| conjure_card(id, node, selected == Some(node.id.as_str()), cx))
                .collect();
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(theme.muted))
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
        .map(|node| conjure_inspector(node, cx));

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
                    "\u{2693} CONJURE \u{00b7} LIVE PREDICTED DAG \u{00b7} {}",
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
                .id(SharedString::from(format!("conjure-cols-{id}")))
                .flex()
                .gap(px(30.0))
                .py(px(8.0))
                .overflow_x_scroll()
                .children(columns),
        )
        .when_some(inspector, |c, insp| c.child(insp))
        .into_any_element()
}

/// The node inspector drawer — the rich click-inspection the operator asked for:
/// every field of the selected node, in full, with a close affordance.
fn conjure_inspector(
    node: &crate::conjure::PredictedNode,
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
        .rounded(px(12.0))
        .border_1()
        .border_color(rgb(accent))
        .bg(rgb(theme.raised))
        .shadow(motion::glow(accent, 0.18, 14.0, 0.0))
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
                        .id("conjure-inspector-close")
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .text_size(px(13.0))
                        .text_color(rgb(theme.muted))
                        .hover(move |s| s.text_color(rgb(theme.ink)).bg(rgb(theme.panel)))
                        .on_click(cx.listener(|this, _ev, _window, cx| {
                            this.conjure_selected = None;
                            cx.notify();
                        }))
                        .child("\u{2715} close"),
                ),
        )
        .child(row("role", node.role_description.clone()))
        .when(!node.why.is_empty(), |c| c.child(row("why", node.why.clone())))
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
                    .child("\u{26d4} HITL gate \u{2014} this node stops for your confirmation before it runs"),
            )
        })
        .into_any_element()
}

/// The INLINE Vello node-graph at the top of the Conjure surface — the beautiful
/// default view the operator most wants. When a PNG has been rendered, it shows
/// the graph image sized to fit the pane (capped width, rounded, maritime frame);
/// until then it shows a tasteful "rendering graph…" placeholder so the region is
/// never blank. The image is loaded from an ABSOLUTE path via `gpui::img(PathBuf)`
/// (a `Resource::Path` read directly off disk — NOT through the embedded asset
/// source), so it works for the live-rendered PNG outside the `assets/` dir.
fn conjure_graphic(id: PaneId, png: Option<std::path::PathBuf>, title: &str) -> impl IntoElement {
    let frame = div()
        .id(SharedString::from(format!("conjure-graphic-{id}")))
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
            "\u{2693} PREDICTED DAG \u{00b7} {}",
            title.to_uppercase()
        )));

    match png {
        Some(path) => frame.child(eyebrow).child(
            // The Vello PNG, framed and sized to fit the pane width. The image is
            // read straight off disk (PathBuf ⇒ Resource::Path).
            div()
                .w_full()
                .rounded(px(10.0))
                .border_1()
                .border_color(rgb(current_theme().line))
                .bg(rgb(current_theme().bg))
                .overflow_hidden()
                .child(
                    img(path)
                        .w_full()
                        .max_w(px(900.0))
                        .h(px(360.0))
                        .object_fit(ObjectFit::Contain)
                        .rounded(px(10.0)),
                ),
        ),
        None => frame.child(eyebrow).child(
            // Placeholder: a calm maritime card while the offscreen Vello render
            // builds (release build is multi-second on first run).
            div()
                .w_full()
                .h(px(360.0))
                .max_w(px(900.0))
                .rounded(px(10.0))
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
        .px(px(11.0))
        .py(px(5.0))
        .rounded(px(6.0))
        .border_1()
        .border_color(rgb(current_theme().line))
        .text_color(rgb(current_theme().ink2))
        .text_size(px(13.0))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| {
            s.border_color(rgb(accent))
                .text_color(rgb(current_theme().accent_ink))
                .shadow(motion::glow(accent, 0.20, 8.0, 0.0))
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
    let (icon, label) = match theme.mode {
        ThemeMode::Dark => ("☀", "Light"),
        ThemeMode::Light => ("◐", "Dark"),
    };
    div()
        .id("theme-toggle")
        .px(px(tokens::SPACE_2))
        .py(px(tokens::SPACE_1))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(theme.line))
        .bg(rgb(theme.panel))
        .text_color(rgb(theme.ink2))
        .text_size(px(tokens::TEXT_CAPTION))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .flex()
        .items_center()
        .gap(px(tokens::SPACE_1))
        .hover(|s| {
            let t = current_theme();
            s.bg(rgb(t.raised))
                .border_color(rgb(t.accent))
                .text_color(rgb(t.accent_ink))
                .shadow(motion::glow(t.accent, 0.24, 10.0, 0.0))
        })
        .child(div().text_size(px(tokens::TEXT_BODY)).child(icon))
        .child(label)
        .on_click(cx.listener(|this, _ev, _window, cx| {
            toggle_theme();
            this.control_flash = Some(format!("theme → {}", current_theme().mode.label()));
            cx.notify();
        }))
}

// ── Operator chat — bespoke bubbles + the rolled-own composer ─────────────────

/// One chat bubble (bespoke, not a `Block`). Operator turns sit right-aligned in
/// an accent-bordered raised card with a soft accent glow; agent replies sit
/// left-aligned in a panel card with a cobalt left rail (mirrors `render_block`'s
/// header rail). Each blooms in once (220ms swoosh fade) unless reduced-motion is
/// set, in which case it renders static at full opacity.
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
            .rounded(px(tokens::RADIUS_LG))
            .border_1()
            .border_color(rgb(t.accent))
            .bg(rgb(t.raised))
            .shadow(motion::glow(t.accent, 0.10, 8.0, 0.0))
            .child(eyebrow)
            .child(body)
    } else {
        // The cobalt rail is a child div (a fixed-width colored strip), exactly the
        // render_block Header rail idiom — guaranteed across gpui border helpers.
        div()
            .max_w(px(560.0))
            .flex()
            .overflow_hidden()
            .rounded(px(tokens::RADIUS_LG))
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

/// The chat error banner — a refused send/spawn, surfaced (never swallowed).
fn chat_error_banner(reason: &str) -> AnyElement {
    let t = current_theme();
    div()
        .mx(px(tokens::SPACE_3))
        .my(px(tokens::SPACE_1))
        .px(px(tokens::SPACE_3))
        .py(px(tokens::SPACE_2))
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
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
                .rounded(px(tokens::RADIUS_LG))
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
                .rounded(px(tokens::RADIUS_MD))
                .bg(rgb(t.accent))
                .text_color(rgb(t.bg))
                .text_size(px(tokens::TEXT_CAPTION))
                .font_weight(FontWeight::SEMIBOLD)
                .cursor_pointer()
                .hover(|s| s.shadow(motion::glow(t.accent, 0.30, 10.0, 0.0)))
                .child("Send")
                .on_click(cx.listener(|this, _ev, _window, cx| {
                    this.submit_chat();
                    cx.notify();
                })),
        )
        .into_any_element()
}

/// Render the open command line. For a Spawn still choosing backend/tier it
/// shows the inline chip picker; otherwise the prompt field + Send/Cancel.
fn render_open_command(
    cmd: &CommandLine,
    catalog: &ModelCatalog,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    if cmd.kind == CmdKind::Spawn && !cmd.spawn_ready() {
        return render_spawn_picker(cmd, catalog, cx);
    }
    // Prompt step (or any non-Spawn command): label + input + Send/Cancel.
    let prompt_label = if cmd.kind == CmdKind::Spawn {
        // Breadcrumb of the picked backend (+ tier) so the operator sees exactly
        // what Send will launch.
        let b = cmd.backend.map(|b| b.as_str()).unwrap_or("spawn");
        match cmd.tier {
            Some(t) => format!("{b}·{}", t.as_str()),
            None => b.to_string(),
        }
    } else {
        cmd.kind.prompt().to_string()
    };
    let placeholder = if cmd.kind == CmdKind::Spawn {
        "describe the task for this agent — Send to launch & stream".to_string()
    } else {
        cmd.kind.placeholder()
    };
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
                .rounded(px(6.0))
                .bg(rgb(current_theme().accent))
                .text_color(rgb(current_theme().bg))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .cursor_pointer()
                .hover(|s| s.shadow(motion::glow(current_theme().accent, 0.30, 10.0, 0.0)))
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
                .rounded(px(6.0))
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

/// The inline Spawn picker: a breadcrumb, a step hint, and a row of option chips
/// (`N  Label`) for the discrete known set — backends, then capability tiers.
/// Type to filter, press the digit to pick, or click. This is the "dropdown that
/// expands as you type with hotkeys" pattern instead of free-text syntax.
fn render_spawn_picker(
    cmd: &CommandLine,
    catalog: &ModelCatalog,
    cx: &mut Context<ConsoleView>,
) -> AnyElement {
    let step = cmd.spawn_step();
    let chosen = cmd.backend.map(|b| b.as_str()).unwrap_or("");
    let hint = match step {
        SpawnStep::Backend => "pick a backend — type to filter, digit = hotkey",
        SpawnStep::Tier => "pick a tier — high / mid / low",
        SpawnStep::Prompt => "",
    };
    let mut row = div()
        .flex()
        .flex_wrap()
        .gap(px(6.0))
        .items_center()
        .w_full()
        .child(
            div()
                .text_color(rgb(current_theme().accent_ink))
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(format!("spawn {chosen}").trim().to_string()),
        )
        .child(
            div()
                .text_color(rgb(current_theme().muted))
                .text_size(px(13.0))
                .child(hint),
        );
    match step {
        SpawnStep::Backend => {
            for (i, b) in filtered_backends(&cmd.buffer).into_iter().enumerate() {
                let hot = i + 1;
                row = row.child(
                    div()
                        .id(SharedString::from(format!("pick-b-{}", b.as_str())))
                        .px(px(9.0))
                        .py(px(4.0))
                        .rounded(px(6.0))
                        .border_1()
                        .border_color(rgb(current_theme().line))
                        .text_color(rgb(current_theme().ink2))
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .cursor_pointer()
                        .hover(|s| {
                            s.border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                        })
                        .child(format!("{hot}  {}", b.label()))
                        .on_click(cx.listener(move |this, _ev, _window, cx| {
                            this.spawn_pick_backend(b);
                            cx.notify();
                        })),
                );
            }
        }
        SpawnStep::Tier => {
            let backend = cmd.backend.unwrap_or(Backend::Claude);
            for (i, t) in filtered_tiers(catalog, backend, &cmd.buffer)
                .into_iter()
                .enumerate()
            {
                let hot = i + 1;
                row = row.child(
                    div()
                        .id(SharedString::from(format!("pick-t-{}", t.as_str())))
                        .px(px(9.0))
                        .py(px(4.0))
                        .rounded(px(6.0))
                        .border_1()
                        .border_color(rgb(current_theme().line))
                        .text_color(rgb(current_theme().ink2))
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .cursor_pointer()
                        .hover(|s| {
                            s.border_color(rgb(current_theme().accent))
                                .text_color(rgb(current_theme().accent_ink))
                        })
                        .child(format!("{hot}  {}", t.label()))
                        .on_click(cx.listener(move |this, _ev, _window, cx| {
                            this.spawn_pick_tier(t);
                            cx.notify();
                        })),
                );
            }
        }
        SpawnStep::Prompt => {}
    }
    if !cmd.buffer.is_empty() {
        row = row.child(
            div()
                .text_color(rgb(current_theme().ink))
                .text_size(px(13.0))
                .font_family("IBM Plex Mono")
                .child(format!("/{}", cmd.buffer)),
        );
    }
    row.into_any_element()
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
                this.control_flash = Some("dispatch approved \u{2192} landing".into());
            }
            "cancel" => {
                if let Some(tx) = &this.control_tx {
                    let _ = tx.send(ControlMsg::DispatchCancel { id: id.clone() });
                }
                this.control_flash = Some("dispatch cancelled".into());
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
/// `None` for an unknown verb so the caller can flash a hint. Aliases keep the
/// muscle memory short (`spawn`/`new`, `cartographer`/`chat`).
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
        "note" => CmdKind::Note,
        "begin" => CmdKind::Begin,
        "done" | "end" => CmdKind::Done,
        "propose" | "dispatch" => CmdKind::Propose,
        "sortie" => CmdKind::Sortie,
        "claim" => CmdKind::Claim,
        "release" => CmdKind::Release,
        "kill" => CmdKind::Kill,
        "interrupt" | "stop" => CmdKind::InterruptAgent,
        "spawn" | "new" => CmdKind::Spawn,
        "cartographer" | "chat" => CmdKind::Cartographer,
        "lane" | "agent" | "message" | "steer" => CmdKind::LaneMessage,
        "pane" | "addpane" => CmdKind::AddPane,
        _ => return None,
    };
    Some((kind, arg))
}

/// Split a spawn command into `(backend, prompt)`. If the first whitespace
/// token is a known backend it is consumed as the backend; otherwise the whole
/// string is the prompt and the backend defaults to `claude-cli`.
fn split_backend(text: &str) -> (String, String) {
    const BACKENDS: &[&str] = &[
        "ollama",
        "claude",
        "claude-cli",
        "gemini",
        "cloudflare",
        "codex",
        "aider",
        "custom",
    ];
    if let Some((first, rest)) = text.split_once(char::is_whitespace) {
        if BACKENDS.contains(&first) && !rest.trim().is_empty() {
            return (first.to_string(), rest.trim().to_string());
        }
    }
    ("claude-cli".to_string(), text.to_string())
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
        .rounded(px(4.0))
        .text_size(px(14.0))
        .text_color(rgb(color))
        .cursor_pointer()
        // Hover pop: tint the glyph (crimson for close, ink otherwise), fill a
        // raised chip, and snap a glow — the per-control "press" cue.
        .hover(move |s| {
            let t = current_theme();
            let (tint, glow) = if kind == "close" {
                (t.gated, t.gated)
            } else {
                (t.ink, t.accent)
            };
            s.bg(rgb(t.raised))
                .text_color(rgb(tint))
                .shadow(motion::glow(glow, 0.22, 8.0, 0.0))
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
        .rounded(px(tokens::RADIUS_MD))
        .border_1()
        .border_color(rgb(if selected { t.accent } else { t.line }))
        .bg(rgb(if selected { t.raised } else { t.panel }))
        .when(selected, |s| s.shadow(motion::glow(t.accent, 0.25, 10.0, 0.0)))
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
                .text_color(rgb(row_tone))
                .text_size(px(13.0))
                .font_weight(FontWeight::BOLD)
                .flex_shrink_0()
                .child(format!("⚑{flag}")),
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
        .rounded(px(tokens::RADIUS_MD))
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
                    s.border_color(rgb(t.accent))
                        .shadow(motion::glow(t.accent, 0.2, 8.0, 0.0))
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
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            this.ws_mut().focus(id);
            if is_dir {
                // Descend: rebind the FileTree root to this directory.
                this.ws_mut().bind_entity(Some(path.clone()));
            } else {
                // Open the file in the Harbor Editor surface.
                this.ws_mut().swap_surface(SurfaceKind::Editor {
                    path: path.clone(),
                    region: None,
                });
            }
            cx.notify();
        }))
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
        // Hitl renders from the foreground alert log; Conjure from a fixture DAG —
        // neither is backed by a bg NAV pane.
        SurfaceKind::CartographerChat
        | SurfaceKind::FileTree { .. }
        | SurfaceKind::Editor { .. }
        | SurfaceKind::Hitl
        | SurfaceKind::Conjure => None,
    }
}

impl Focusable for ConsoleView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
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

/// The always-visible NAV rail — the GUI replacement for `Ctrl-A <key>` surface
/// switching. Click a surface name to swap the focused pane to it; the active
/// surface is highlighted. Keyboard chords still work as unadvertised
/// accelerators, but nothing here requires them. (#32 retired: the chord is made
/// unnecessary, not consistent — the operator hates leader-key core movement.)
fn render_nav_rail(active: Option<&str>, cx: &mut Context<ConsoleView>) -> impl IntoElement {
    let active = active.map(|s| s.to_string());
    div()
        .id("nav-rail")
        .flex()
        .flex_col()
        .flex_none()
        .w(px(152.0))
        .h_full()
        .overflow_y_scroll()
        .bg(rgb(current_theme().panel))
        .border_r_1()
        .border_color(rgb(current_theme().line))
        .py(px(6.0))
        // Eyebrow header — the allowed 12px exception (uppercase, weight ≥600).
        .child(
            div()
                .px(px(12.0))
                .pb(px(4.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(current_theme().muted))
                .child("NAVIGATE"),
        )
        .children(NAV.iter().map(|item| {
            let nav_id: &'static str = item.id;
            let is_active = active.as_deref() == Some(nav_id);
            let accent = current_theme().accent;
            div()
                .id(SharedString::from(format!("nav-{nav_id}")))
                .mx(px(6.0))
                .my(px(1.0))
                .px(px(10.0))
                .py(px(5.0))
                .rounded(px(6.0))
                .text_size(px(14.0))
                .font_weight(if is_active {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::MEDIUM
                })
                .text_color(rgb(if is_active {
                    current_theme().accent_ink
                } else {
                    current_theme().ink2
                }))
                .cursor_pointer()
                .when(is_active, |s| {
                    s.bg(rgb(current_theme().raised))
                        .shadow(motion::glow(accent, 0.28, 10.0, 0.0))
                })
                .when(!is_active, |s| {
                    s.hover(move |h| {
                        h.bg(rgb(current_theme().raised))
                            .text_color(rgb(current_theme().accent_ink))
                    })
                })
                .child(item.label)
                .on_click(cx.listener(move |this, _ev, _window, cx| {
                    this.ws_mut().swap_surface(surface_for_nav_id(nav_id));
                    cx.notify();
                }))
        }))
}

impl Render for ConsoleView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        }

        let daemon_url = self.daemon_url.clone();
        let focused = self.ws().focused();
        // Which NAV surface the focused pane is showing — drives the rail highlight.
        let active_nav = nav_id_for_surface(self.ws().focused_surface()).map(|s| s.to_string());
        let armed = self.leader_armed;
        let command = self.command.clone();
        let lit = armed || command.is_some();
        let pane_count = self.ws().pane_count();
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
                // Galaxy camera pan: right/middle drag keeps moving even if the
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
                // Galaxy marquee: while a rectangle-select is live, track the far
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
                // Galaxy marquee release: convert the pixel rect to normalized
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
            .font_family("General Sans")
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
                } else if this.focused_is_chat() {
                    // The focused chat pane captures printable keys into its composer
                    // (no native input widget) — the load-bearing "make it actually
                    // type" path. Ctrl-A still arms the leader (checked above first).
                    let shift = ev.keystroke.modifiers.shift;
                    this.handle_chat_key(key.as_str(), key_char.as_deref(), shift, cx);
                }
            }))
            // ── Tab bar (named workspaces, like tmux windows) ──
            .child(
                div()
                    .h(px(28.0))
                    // The window titlebar is transparent (traffic lights drawn at
                    // x≈12–64), so the tab strip must start clear of them or the
                    // first tab + "+" hide behind the OS controls. Inset the left
                    // edge past the light cluster; this whole bar is the drag region.
                    .pl(px(78.0))
                    .pr(px(6.0))
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .bg(rgb(current_theme().panel))
                    .border_b_1()
                    .border_color(rgb(current_theme().line))
                    // Persistent brand lockup — the P·d mark + "PORT DADDY",
                    // pinned at the top-left of the chrome on every pane/tab.
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(7.0))
                            .px(px(4.0))
                            .child(
                                svg()
                                    .path("icons/pd-mark-glyph.svg")
                                    .w(px(18.0))
                                    .h(px(18.0))
                                    .text_color(rgb(current_theme().accent_ink)),
                            )
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgb(current_theme().ink))
                                    .child("PORT DADDY"),
                            )
                            .child(
                                div()
                                    .w(px(1.0))
                                    .h(px(16.0))
                                    .bg(rgb(current_theme().line)),
                            ),
                    )
                    .children(tabs.into_iter().map(|(i, name, active)| {
                        div()
                            .id(SharedString::from(format!("tab-{i}")))
                            .px(px(10.0))
                            .py(px(3.0))
                            .rounded(px(5.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rgb(if active { current_theme().accent_ink } else { current_theme().muted }))
                            // Active tab: raised + a mustard glow. Inactive: lift on hover
                            // (a hard offset shadow stands in for the mock's translateY(-1px)).
                            .when(active, |s| {
                                s.bg(rgb(current_theme().raised))
                                    .shadow(motion::glow(current_theme().accent, 0.30, 12.0, 0.0))
                            })
                            .cursor_pointer()
                            .when(!active, |s| {
                                s.hover(|h| {
                                    let t = current_theme();
                                    h.bg(rgb(t.raised)).text_color(rgb(t.ink2)).shadow(motion::hard_offset(t.sunken, 0.0, 2.0))
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
                            .rounded(px(5.0))
                            .text_size(px(15.0))
                            .text_color(rgb(current_theme().muted))
                            .cursor_pointer()
                            .hover(|s| {
                                let t = current_theme();
                                s.bg(rgb(t.raised)).text_color(rgb(t.accent_ink)).shadow(motion::glow(t.accent, 0.30, 10.0, 0.0))
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
                            .rounded(px(5.0))
                            .text_size(px(15.0))
                            .text_color(rgb(current_theme().muted))
                            .cursor_pointer()
                            .hover(|s| {
                                let t = current_theme();
                                s.bg(rgb(t.raised))
                                    .text_color(rgb(t.accent_ink))
                                    .shadow(motion::glow(t.accent, 0.30, 10.0, 0.0))
                            })
                            .child("⊞")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.launcher_open = true;
                                cx.notify();
                            })),
                    )
                    .child(div().flex_1())
                    .child(theme_toggle_btn(cx)),
            )
            // ── Body row: clickable NAV rail (the GUI replacement for the
            // Ctrl-A <key> surface switch the operator hates) + the pane tree.
            // Click a surface name to swap the focused pane — no leader key. ──
            .child(
                div()
                    .flex_1()
                    .overflow_hidden()
                    .flex()
                    .flex_row()
                    .child(render_nav_rail(active_nav.as_deref(), cx))
                    .child(div().flex_1().overflow_hidden().child(body)),
            )
            // ── Operator toolbar: always-visible GUI affordances. No leader keys,
            // no memorized syntax — click a button, a placeholder-guided input
            // opens, type, hit Send. This is what makes the console an operator
            // surface instead of a CLI with hidden options. ──
            .child(
                div()
                    .h(px(36.0))
                    .px(px(12.0))
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .bg(rgb(current_theme().panel))
                    .border_t_1()
                    .border_color(rgb(current_theme().line))
                    .child(
                        div()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(current_theme().muted))
                            .child("ACT"),
                    )
                    .child(command_bar_btn(CmdKind::Spawn, "Spawn agent", cx))
                    .child(command_bar_btn(CmdKind::Cartographer, "Ask cartographer", cx))
                    .child(command_bar_btn(CmdKind::AddPane, "Add pane", cx))
                    .child(command_bar_btn(CmdKind::UseDaemon, "Use daemon", cx))
                    // Conjure: always visible, next to the other ACT verbs. Click to
                    // open the prompt input — type intent, Send blooms a predicted
                    // DAG, the focused pane swaps to the Conjure surface to render it,
                    // and "Render graph" there opens the Vello PNG. The discoverable
                    // way in — no hidden keystroke. Uses the shared command_bar_btn so
                    // it inherits the placeholder-guided input the other verbs use.
                    .child(command_bar_btn(CmdKind::Conjure, "Conjure", cx))
                    // Alerts (HITL): always visible, glows red on errors, click to
                    // open the full untruncated log — the discoverable way to read
                    // a failure (no hidden keystroke).
                    .child({
                        let n = self.alerts.len();
                        let has_err = self.alerts.iter().any(|a| a.level == AlertLevel::Error);
                        let label = if n == 0 {
                            "Alerts".to_string()
                        } else if has_err {
                            format!("⚑ Alerts ({n})")
                        } else {
                            format!("Alerts ({n})")
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
                            .px(px(11.0))
                            .py(px(5.0))
                            .rounded(px(6.0))
                            .border_1()
                            .border_color(rgb(border))
                            .text_color(rgb(text))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .cursor_pointer()
                            .when(has_err, |s| s.shadow(motion::glow(current_theme().gated, 0.25, 8.0, 0.0)))
                            .hover(|s| {
                                s.text_color(rgb(current_theme().accent_ink))
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
                    // PREFIX / command mode glows unmistakably.
                    .when(lit, |s| s.shadow(motion::glow(current_theme().accent, 0.25, 12.0, 0.0)))
                    .child(if let Some(cmd) = command.as_ref() {
                        // Open command line — chip picker (Spawn) or prompt + Send.
                        render_open_command(cmd, &self.catalog, cx)
                    } else if armed {
                        div()
                            .text_color(rgb(current_theme().accent_ink))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(
                                "PREFIX  |  | split · - vsplit · x close · z zoom · o next · =/_ resize · w new-tab · [ ] tabs · n new-job · t cartographer · i insert-pane · : verb-palette (note/begin/done/propose/sortie/claim/release/kill/interrupt) · [1-9…] surface",
                            )
                            .into_any_element()
                    } else {
                        div()
                            .text_color(rgb(current_theme().muted))
                            .text_size(px(13.0))
                            .font_family("IBM Plex Mono")
                            .child(format!(
                                "daemon {daemon_url}  ·  {pane_count} panes  ·  Ctrl-A → space launcher · n new-job · i insert-pane · | split  ·  {}",
                                build_stamp()
                            ))
                            .into_any_element()
                    }),
            )
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
    fn picker_matches_conjure_surface() {
        // Both the surface name and its alias "plan" resolve to Conjure.
        assert!(matches!(
            surface_for_query("conjure"),
            Some(SurfaceKind::Conjure)
        ));
        assert!(matches!(
            surface_for_query("plan"),
            Some(SurfaceKind::Conjure)
        ));
        // Conjure is not backed by a NAV pane — it renders the fixture DAG.
        assert!(nav_id_for_surface(&SurfaceKind::Conjure).is_none());
        assert_eq!(
            launcher_id_for_surface(&SurfaceKind::Conjure).as_deref(),
            Some("conjure")
        );
    }

    #[test]
    fn launcher_exposes_every_foreground_surface() {
        let ids = launcher_items()
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        for id in ["chat", "files", "alerts", "conjure"] {
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
        assert!(matches!(
            surface_for_launcher_id("conjure"),
            SurfaceKind::Conjure
        ));
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
                "propose land the console PR",
                CmdKind::Propose,
                "land the console PR",
            ),
            (
                "sortie refactor the executor",
                CmdKind::Sortie,
                "refactor the executor",
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
        // Aliases keep muscle memory short.
        assert!(matches!(
            parse_verb("dispatch land it"),
            Some((CmdKind::Propose, _))
        ));
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
