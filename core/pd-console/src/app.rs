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
use crate::dispatch_pane::DispatchHead;
use crate::mux::{Dir, Node, PaneId, SurfaceKind, Workspace};
use crate::pane::{Alert, AlertLevel, Block, Tone};
use crate::palette::{Theme, ThemeMode};
use std::sync::atomic::{AtomicU8, Ordering};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
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
    Spawn { backend: String, prompt: String, model: Option<String> },
    /// Send a turn to the cartographer over its tube channel: `POST /msg/cartographer`.
    Cartographer { text: String },
    /// Operator review-gate verdicts on the head dispatch.
    DispatchAccept { id: String },
    DispatchReject { id: String, reason: String },
    DispatchCancel { id: String },
    /// Conductor operator control (ADR-0060): halt/pause/resume a fleet lineage.
    /// `root_id: None` = the whole fleet (global emergency stop).
    FleetHalt { root_id: Option<String> },
    FleetPause { root_id: Option<String> },
    FleetResume { root_id: Option<String> },
}

/// Which command line is open at the bottom of the console.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmdKind {
    /// Kick off a new job. Buffer is `[backend] <prompt>`.
    Spawn,
    /// Talk to the cartographer. Buffer is the message.
    Cartographer,
    /// Reject the head dispatch with a reason (the human-gate "modify/why" path).
    /// The target dispatch id is held in `ConsoleView::reject_target`.
    DispatchReject,
    /// Add a new split pane of a chosen surface kind. Buffer is a surface name
    /// (nav label/id/key prefix, e.g. "cost", "fleet", "chat"). Handled locally.
    AddPane,
}

impl CmdKind {
    fn prompt(&self) -> &'static str {
        match self {
            CmdKind::Spawn => "spawn",
            CmdKind::Cartographer => "cartographer",
            CmdKind::DispatchReject => "reject reason",
            CmdKind::AddPane => "add pane",
        }
    }

    /// Ghost text shown in the input when empty — the GUI must never demand
    /// syntax the operator has to guess. This is the discoverability the hidden
    /// leader-key command line never had.
    fn placeholder(&self) -> &'static str {
        match self {
            CmdKind::Spawn => "claude: summarize the open PRs   (backend: task — try claude · gemini · ollama)",
            CmdKind::Cartographer => "Ask the cartographer about the roadmap, then watch the lane stream the reply…",
            CmdKind::DispatchReject => "Why reject this? The reason is sent back to the agent.",
            CmdKind::AddPane => "fleet · cost · roadmap · lane · dispatch · chat · files…",
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

/// Resolve a typed surface name to a `SurfaceKind` for the add-pane picker.
/// Matches a NAV label/id/key by case-insensitive prefix, plus the two
/// non-nav surfaces ("chat" → cartographer, "files"/"tree" → file tree).
fn surface_for_query(query: &str) -> Option<SurfaceKind> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }
    if "chat".starts_with(&q) || "cartographer".starts_with(&q) {
        return Some(SurfaceKind::CartographerChat);
    }
    if "files".starts_with(&q) || "tree".starts_with(&q) || "filetree".starts_with(&q) {
        return Some(SurfaceKind::FileTree { root: None });
    }
    if "alerts".starts_with(&q) || "hitl".starts_with(&q) {
        return Some(SurfaceKind::Hitl);
    }
    if "conjure".starts_with(&q) || "plan".starts_with(&q) {
        return Some(SurfaceKind::Conjure);
    }
    NAV.iter()
        .find(|n| {
            n.key == q || n.id.starts_with(&q) || n.label.to_lowercase().starts_with(&q)
        })
        .map(|n| surface_for_nav_id(n.id))
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
        Self { kind, buffer: String::new(), backend: None, tier: None, tier_applies: false }
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
        .filter(|t| f.is_empty() || t.as_str().starts_with(&f) || t.label().to_lowercase().contains(&f))
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

#[allow(dead_code)] // label/icon retained for the title-bar + future surface picker
struct NavItem {
    id: &'static str,
    label: &'static str,
    /// SVG asset path (custom stroke icons — never emoji; operator rule).
    icon: &'static str,
    key: &'static str,
}

const NAV: &[NavItem] = &[
    NavItem { id: "fleet",    label: "Fleet",    icon: "icons/nav/fleet.svg",    key: "1" },
    NavItem { id: "cockpit",  label: "Cockpit",  icon: "icons/nav/cockpit.svg",  key: "2" },
    NavItem { id: "sorties",  label: "Sorties",  icon: "icons/nav/sorties.svg",  key: "3" },
    NavItem { id: "claims",   label: "Claims",   icon: "icons/nav/claims.svg",   key: "4" },
    NavItem { id: "peek",     label: "Peek",     icon: "icons/nav/peek.svg",     key: "5" },
    NavItem { id: "roadmap",  label: "Roadmap",  icon: "icons/nav/roadmap.svg",  key: "6" },
    NavItem { id: "adrs",     label: "ADRs",     icon: "icons/nav/adrs.svg",     key: "7" },
    NavItem { id: "activity", label: "Activity", icon: "icons/nav/activity.svg", key: "8" },
    NavItem { id: "sessions", label: "Sessions", icon: "icons/nav/sessions.svg", key: "9" },
    NavItem { id: "inbox",    label: "Inbox",    icon: "icons/nav/inbox.svg",    key: "0" },
    NavItem { id: "suggest",  label: "Suggest",  icon: "icons/nav/suggest.svg",  key: "s" },
    NavItem { id: "memory",   label: "Memory",   icon: "icons/nav/memory.svg",   key: "m" },
    NavItem { id: "prs",      label: "PRs",      icon: "icons/nav/prs.svg",      key: "p" },
    NavItem { id: "health",   label: "Health",   icon: "icons/nav/health.svg",   key: "h" },
    NavItem { id: "coast",    label: "C.Guard",  icon: "icons/nav/coast.svg",    key: "c" },
    NavItem { id: "dispatch", label: "Dispatch", icon: "icons/nav/dispatch.svg", key: "d" },
    NavItem { id: "lane",     label: "Lane",     icon: "icons/nav/sorties.svg",  key: "l" },
    NavItem { id: "ledger",   label: "Cost",     icon: "icons/nav/ledger.svg",   key: "b" },
    NavItem { id: "lineage",  label: "Lineage",  icon: "icons/nav/lineage.svg",  key: "g" },
    NavItem { id: "substrate",label: "Substrate",icon: "icons/nav/substrate.svg",key: "y" },
    NavItem { id: "conductor",label: "Conductor",icon: "icons/nav/dispatch.svg", key: "k" },
];

// ── Live palette — light + dark, from `crate::palette` (maritime/neobrutalism) ──
// One process-global mode (a single window), flipped by `Ctrl-A g`. `current_theme()`
// is a captureless fn so it drops into every `rgb(...)` site — including hover/click
// closures, which then re-read the live theme — with no borrow/lifetime threading.
// 0 = light, 1 = dark (default = the shipped look).
static THEME_MODE: AtomicU8 = AtomicU8::new(1);

fn current_theme() -> Theme {
    let mode = if THEME_MODE.load(Ordering::Relaxed) == 0 {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    };
    Theme::for_mode(mode)
}

/// Flip light ⇄ dark (the `Ctrl-A g` leader command). Re-skins on next `cx.notify()`.
fn toggle_theme() {
    let next = if THEME_MODE.load(Ordering::Relaxed) == 0 { 1 } else { 0 };
    THEME_MODE.store(next, Ordering::Relaxed);
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
mod motion {
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

// ── Block renderer ───────────────────────────────────────────────────────────

fn render_block(block: Block) -> impl IntoElement {
    match block {
        Block::Header(text) => {
            div()
                .px(px(16.0))
                .pt(px(12.0))
                .pb(px(6.0))
                .text_color(rgb(current_theme().accent_ink))
                .text_size(px(15.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(text)
                .into_any_element()
        }
        Block::KeyVal(key, val) => {
            div()
                .flex()
                .gap(px(8.0))
                .px(px(16.0))
                .py(px(3.0))
                .child(
                    div()
                        .text_color(rgb(current_theme().muted))
                        .text_size(px(14.0))
                        .w(px(150.0))
                        .flex_shrink_0()
                        .child(key)
                )
                .child(
                    div()
                        .text_color(rgb(current_theme().ink))
                        .text_size(px(14.0))
                        .font_family("IBM Plex Mono")
                        .child(val)
                )
                .into_any_element()
        }
        Block::Row(cells) => {
            div()
                .flex()
                .gap(px(16.0))
                .px(px(16.0))
                .py(px(4.0))
                .hover(|s| s.bg(rgb(current_theme().raised)))
                .children(
                    cells.into_iter().enumerate().map(|(i, cell)| {
                        div()
                            .text_color(rgb(if i == 0 { current_theme().accent_ink } else { current_theme().ink2 }))
                            .text_size(px(14.0))
                            .font_family("IBM Plex Mono")
                            .flex_shrink_0()
                            .child(cell)
                    })
                )
                .into_any_element()
        }
        Block::Chip { label, tone } => {
            let color = rgb(tone_rgb(&tone));
            div()
                .mx(px(16.0))
                .mt(px(4.0))
                .mb(px(8.0))
                .px(px(10.0))
                .py(px(3.0))
                .rounded_full()
                .border_1()
                .border_color(color)
                .text_color(color)
                .text_size(px(13.0))
                .child(label)
                .into_any_element()
        }
        Block::Flag { letter, label, tone } => {
            let color = rgb(tone_rgb(&tone));
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .px(px(16.0))
                .py(px(3.0))
                .child(
                    // The signal flag itself: a bold square hoist in the flag's
                    // semantic tone, bearing the ICS letter.
                    div()
                        .w(px(22.0))
                        .h(px(22.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(3.0))
                        .border_2()
                        .border_color(color)
                        .bg(rgb(current_theme().raised))
                        .text_color(color)
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .child(letter.to_string()),
                )
                .child(
                    div()
                        .text_color(rgb(current_theme().ink))
                        .text_size(px(14.0))
                        .child(label),
                )
                .into_any_element()
        }
        Block::Spark(_) => {
            div()
                .px(px(16.0))
                .py(px(4.0))
                .text_color(rgb(current_theme().muted))
                .text_size(px(13.0))
                .child("▁▂▃▄▅▆▇")
                .into_any_element()
        }
        Block::Gap => {
            div().h(px(8.0)).into_any_element()
        }
        Block::WrappedText { text, tone } => {
            // Full, wrapping, never-truncated — the operator reads it all.
            div()
                .px(px(16.0))
                .py(px(6.0))
                .text_color(rgb(current_theme().tone(&tone)))
                .text_size(px(14.0))
                .font_family("IBM Plex Mono")
                .child(text)
                .into_any_element()
        }
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
        let ink = if self.active { current_theme().ink } else { current_theme().muted };
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
                    .text_color(rgb(if self.active { current_theme().accent_ink } else { current_theme().muted }))
            )
            .child(
                div()
                    .text_color(rgb(ink))
                    .text_size(px(13.0))
                    .font_weight(FontWeight::MEDIUM)
                    .child(self.label)
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
    /// The Conjure surface's predicted DAG. Foundation slice: a hardcoded fixture
    /// rendered through the Block UI. The windags `next_move` call, the Vello
    /// graph, and dispatch are later slices.
    conjure_dag: crate::conjure::PredictedDag,
}

impl ConsoleView {
    pub fn new(daemon_url: String, initial_pane: Option<String>, cx: &mut Context<Self>) -> Self {
        Self::with_control(daemon_url, initial_pane, None, cx)
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
        let pane_blocks = NAV.iter().map(|nav| {
            vec![
                Block::Header(nav.label.into()),
                Block::KeyVal("status".into(), "connecting…".into()),
            ]
        }).collect();

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
        }
    }

    /// The opening layout: a fleet overview beside a stacked agent-lane /
    /// roadmap column — proof of multiplex on first launch. `initial` (if a
    /// known nav id) becomes the focused pane's surface.
    fn default_workspace(initial: Option<&str>) -> Workspace {
        let mut ws = Workspace::new(SurfaceKind::Fleet);
        ws.split(Dir::Row, SurfaceKind::AgentTranscript { agent_id: None }); // fleet | lane
        ws.split(Dir::Col, SurfaceKind::Roadmap); // lane / roadmap
        ws.focus(1); // start on the fleet pane (first leaf id)
        if let Some(nav) = initial {
            if NAV.iter().any(|n| n.id == nav) {
                ws.swap_surface(surface_for_nav_id(nav));
            }
        }
        ws
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
        // Conjure renders its (foundation-slice) fixture DAG through the Block UI
        // — no background NAV pane, no windags call yet.
        if matches!(surface, SurfaceKind::Conjure) {
            return crate::conjure::blocks_for_conjure(&self.conjure_dag);
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
            blocks.push(Block::KeyVal("status".into(), "all clear — no alerts".into()));
            return blocks;
        }
        blocks.push(Block::KeyVal(
            "total".into(),
            format!("{} (newest first)", self.alerts.len()),
        ));
        blocks.push(Block::Gap);
        for a in &self.alerts {
            blocks.push(Block::Chip { label: a.level.label().into(), tone: a.level.tone() });
            blocks.push(Block::KeyVal("  what".into(), a.title.clone()));
            blocks.push(Block::WrappedText { text: a.detail.clone(), tone: a.level.tone() });
            blocks.push(Block::Gap);
        }
        blocks
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
            "=" | "+" => { self.ws_mut().resize(0.15); }
            "_" => { self.ws_mut().resize(-0.15); }
            // Flip the palette (light ⇄ dark) — re-skins the whole console.
            "g" => toggle_theme(),
            // Maximize / restore the focused pane.
            "z" => { let id = self.ws().focused(); self.toggle_zoom(id); }
            // Tabs (tmux windows): w = new, [ / ] = prev / next.
            "w" => self.new_tab(),
            "]" => self.switch_tab(1),
            "[" => self.switch_tab(-1),
            // Open command lines.
            "n" => self.command = Some(CommandLine::new(CmdKind::Spawn)),
            "t" => self.command = Some(CommandLine::new(CmdKind::Cartographer)),
            // Insert a new pane of a chosen kind (the add-pane picker).
            "i" => self.command = Some(CommandLine::new(CmdKind::AddPane)),
            // Any nav key swaps the focused pane's surface — "hop context".
            other => {
                if let Some(item) = NAV.iter().find(|n| n.key == other) {
                    self.ws_mut().swap_surface(surface_for_nav_id(item.id));
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
        let Some(cmd) = self.command.as_mut() else { return };
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
        // Reject may submit empty (falls back to a default reason); the others need text.
        if text.is_empty() && cmd.kind != CmdKind::DispatchReject {
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
        // Clone the sender (owned) so we can also mutate the workspace below
        // without holding an immutable borrow of `self` across `ws_mut()`.
        let Some(tx) = self.control_tx.clone() else { return };
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
                self.control_flash = Some("sent to cartographer — streaming the reply below".into());
                // Same loop for the cartographer: jump to the lane to watch the
                // reply stream rather than leaving the operator guessing where it went.
                self.ws_mut()
                    .swap_surface(SurfaceKind::AgentTranscript { agent_id: None });
            }
            CmdKind::DispatchReject => {
                if let Some(id) = self.reject_target.take() {
                    let reason = if text.len() >= 3 { text } else { "rejected via console".into() };
                    let _ = tx.send(ControlMsg::DispatchReject { id, reason });
                    self.control_flash = Some("dispatch rejected".into());
                }
            }
            // AddPane is handled locally above (early return) — never reaches here.
            CmdKind::AddPane => {}
        }
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
        let head: String = alert.detail.lines().next().unwrap_or(&alert.detail).chars().take(120).collect();
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

    pub fn update_panes(
        &mut self,
        updates: Vec<(usize, Vec<Block>)>,
        dispatch_head: Option<DispatchHead>,
    ) {
        for (idx, blocks) in updates {
            if let Some(slot) = self.pane_blocks.get_mut(idx) {
                *slot = blocks;
            }
        }
        self.dispatch_head = dispatch_head;
    }

    /// Recursively render the pane tree. Splits become weighted flex
    /// containers (so `resize` is visible); leaves render their surface.
    fn render_node(&self, node: &Node, focused: PaneId, path: &[usize], cx: &mut Context<Self>) -> AnyElement {
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
        let is_agent = matches!(surface, SurfaceKind::AgentTranscript { .. });
        // The dispatch surface (focused) gets the interactive review GATE.
        let is_dispatch = nav_id_for_surface(surface) == Some("dispatch");
        let is_conductor = nav_id_for_surface(surface) == Some("conductor");
        let dispatch_head = self.dispatch_head.clone();
        let gate_flash = self.control_flash.clone();
        let cond_flash = self.control_flash.clone();
        let border = if is_focused { current_theme().accent_ink } else { current_theme().line };
        let title_color = if is_focused { current_theme().accent_ink } else { current_theme().muted };
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
            .child(
                div()
                    .id(SharedString::from(format!("pane-body-{id}")))
                    .flex_1()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .children(blocks.into_iter().map(render_block)),
            )
            // Steering bar — only the focused agent transcript grabs the wheel.
            .when(is_agent && is_focused, |content| {
                content.child(
                    div()
                        .px(px(10.0))
                        .py(px(6.0))
                        .border_t_1()
                        .border_color(rgb(current_theme().line))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
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
            .into_any_element()
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
        "describe the task for this agent — Send to launch & stream"
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
            let field = div().flex_1().text_size(px(14.0)).font_family("IBM Plex Mono");
            if cmd.buffer.is_empty() {
                field.text_color(rgb(current_theme().muted)).child(placeholder.to_string())
            } else {
                field.text_color(rgb(current_theme().ink)).child(format!("› {}▏", cmd.buffer))
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
            for (i, t) in filtered_tiers(catalog, backend, &cmd.buffer).into_iter().enumerate() {
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
    div()
        .id(SharedString::from(format!("gate-{action}")))
        .px(px(12.0))
        .py(px(5.0))
        .rounded(px(6.0))
        .border_1()
        .border_color(rgb(color))
        .text_color(rgb(color))
        .text_size(px(14.0))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(current_theme().raised)).shadow(motion::glow(color, 0.22, 8.0, 0.0)))
        .child(label)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            match action {
                "approve" => {
                    if let Some(tx) = &this.control_tx {
                        let _ = tx.send(ControlMsg::DispatchAccept { id: id.clone() });
                    }
                    this.control_flash = Some("dispatch approved → landing".into());
                }
                "cancel" => {
                    if let Some(tx) = &this.control_tx {
                        let _ = tx.send(ControlMsg::DispatchCancel { id: id.clone() });
                    }
                    this.control_flash = Some("dispatch cancelled".into());
                }
                "reject" => {
                    // Don't reject blind — open a reason line targeting this dispatch.
                    this.reject_target = Some(id.clone());
                    this.command = Some(CommandLine::new(CmdKind::DispatchReject));
                }
                _ => {}
            }
            cx.notify();
        }))
}

/// One conductor fleet-control button (ADR-0060). Fires the verb immediately
/// against the whole fleet (global scope) — the operator's emergency wheel.
fn conductor_gate_btn(
    action: &'static str,
    label: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    div()
        .id(SharedString::from(format!("fleet-{action}")))
        .px(px(12.0))
        .py(px(5.0))
        .rounded(px(6.0))
        .border_1()
        .border_color(rgb(color))
        .text_color(rgb(color))
        .text_size(px(14.0))
        .font_weight(FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |s| s.bg(rgb(current_theme().raised)).shadow(motion::glow(color, 0.22, 8.0, 0.0)))
        .child(label)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
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
                "halt" => "fleet halt sent \u{2192} SIGTERM\u{2192}SIGKILL, bonds refunded".to_string(),
                "pause" => "fleet paused \u{2192} no new admissions".to_string(),
                "resume" => "fleet resumed".to_string(),
                _ => String::new(),
            });
            cx.notify();
        }))
}

/// Split a spawn command into `(backend, prompt)`. If the first whitespace
/// token is a known backend it is consumed as the backend; otherwise the whole
/// string is the prompt and the backend defaults to `claude-cli`.
fn split_backend(text: &str) -> (String, String) {
    const BACKENDS: &[&str] = &[
        "ollama", "claude", "claude-cli", "gemini", "cloudflare", "codex", "aider", "custom",
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
            let (tint, glow) = if kind == "close" { (t.gated, t.gated) } else { (t.ink, t.accent) };
            s.bg(rgb(t.raised)).text_color(rgb(tint)).shadow(motion::glow(glow, 0.22, 8.0, 0.0))
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

/// Map an existing nav id to the richest matching surface (semantic where one
/// exists, generic `Panel` otherwise).
fn surface_for_nav_id(nav: &str) -> SurfaceKind {
    match nav {
        "lane" => SurfaceKind::AgentTranscript { agent_id: None },
        "roadmap" => SurfaceKind::Roadmap,
        "health" => SurfaceKind::DaemonHealth,
        "fleet" => SurfaceKind::Fleet,
        "sessions" => SurfaceKind::Sessions,
        "dispatch" => SurfaceKind::Dispatch,
        other => SurfaceKind::Panel { nav: other.to_string() },
    }
}

/// Inverse: which nav id (if any) backs this surface's live data.
fn nav_id_for_surface(surface: &SurfaceKind) -> Option<&str> {
    match surface {
        SurfaceKind::AgentTranscript { .. } => Some("lane"),
        SurfaceKind::Roadmap => Some("roadmap"),
        SurfaceKind::DaemonHealth => Some("health"),
        SurfaceKind::Fleet => Some("fleet"),
        SurfaceKind::Sessions => Some("sessions"),
        SurfaceKind::Dispatch => Some("dispatch"),
        SurfaceKind::Panel { nav } => Some(nav.as_str()),
        // Hitl renders from the foreground alert log; Conjure from a fixture DAG —
        // neither is backed by a bg NAV pane.
        SurfaceKind::CartographerChat
        | SurfaceKind::FileTree { .. }
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
fn split_divider(path: Vec<usize>, left: usize, dir: Dir, cx: &mut Context<ConsoleView>) -> impl IntoElement {
    let row = matches!(dir, Dir::Row);
    let key = path.iter().map(|x| x.to_string()).collect::<Vec<_>>().join("_");
    let mut zone = div()
        .id(SharedString::from(format!("divider-{key}-{left}")))
        .flex_none()
        .occlude()
        .flex()
        .items_center()
        .justify_center()
        .cursor(if row { CursorStyle::ResizeLeftRight } else { CursorStyle::ResizeUpDown })
        .hover(|s| s.bg(rgb(current_theme().accent)));
    zone = if row { zone.w(px(6.0)).h_full() } else { zone.h(px(6.0)).w_full() };
    let mut line = div().bg(rgb(current_theme().line));
    line = if row { line.w(px(1.0)).h_full() } else { line.h(px(1.0)).w_full() };
    zone.child(line).on_mouse_down(
        MouseButton::Left,
        cx.listener(move |this, _ev, _window, cx| {
            this.dragging = Some(DragState { path: path.clone(), left, dir });
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
                .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
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
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        let body: AnyElement = match zoomed.and_then(|zid| self.ws().surface_at(zid).cloned().map(|s| (zid, s))) {
            Some((zid, surf)) => self.render_leaf(zid, &surf, true, cx),
            None => {
                let root = self.ws().root.clone();
                self.render_node(&root, focused, &[], cx)
            }
        };

        div()
            .key_context("console")
            .track_focus(&self.focus_handle)
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
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _ev: &MouseUpEvent, _window, cx| {
                if this.dragging.take().is_some() {
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
                if this.command.is_some() {
                    // A command line is open: type into it.
                    this.handle_command_key(key.as_str(), key_char.as_deref(), cx);
                } else if this.leader_armed {
                    this.leader_armed = false;
                    this.leader_command(key.as_str(), ctrl, cx);
                } else if ctrl && key == "a" {
                    this.leader_armed = true;
                    cx.notify();
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
                    ),
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
                    // Conjure: always visible. Click to swap the focused pane to the
                    // predicted-DAG surface (foundation slice renders a fixture). The
                    // discoverable way in — no hidden keystroke. Mirrors the Alerts btn.
                    .child(
                        div()
                            .id("act-conjure")
                            .px(px(11.0))
                            .py(px(5.0))
                            .rounded(px(6.0))
                            .border_1()
                            .border_color(rgb(current_theme().line))
                            .text_color(rgb(current_theme().ink2))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .cursor_pointer()
                            .hover(|s| {
                                s.text_color(rgb(current_theme().accent_ink))
                                    .border_color(rgb(current_theme().accent))
                                    .shadow(motion::glow(current_theme().accent, 0.20, 8.0, 0.0))
                            })
                            .child("Conjure")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.ws_mut().swap_surface(SurfaceKind::Conjure);
                                cx.notify();
                            })),
                    )
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
                                "PREFIX  |  | split · - vsplit · x close · z zoom · o next · =/_ resize · w new-tab · [ ] tabs · n new-job · t cartographer · i insert-pane · [1-9…] surface",
                            )
                            .into_any_element()
                    } else {
                        div()
                            .text_color(rgb(current_theme().muted))
                            .text_size(px(13.0))
                            .font_family("IBM Plex Mono")
                            .child(format!(
                                "daemon {daemon_url}  ·  {pane_count} panes  ·  Ctrl-A → n new-job · t cartographer · i insert-pane · | split  ·  {}",
                                build_stamp()
                            ))
                            .into_any_element()
                    }),
            )
    }
}

#[cfg(test)]
mod add_pane_tests {
    use super::*;

    #[test]
    fn picker_matches_nav_by_id_label_and_key() {
        // Dedicated-variant surfaces resolve to their own kind.
        assert!(matches!(surface_for_query("fleet"), Some(SurfaceKind::Fleet)));
        assert!(matches!(surface_for_query("roadmap"), Some(SurfaceKind::Roadmap)));
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
        assert!(matches!(surface_for_query("chat"), Some(SurfaceKind::CartographerChat)));
        assert!(matches!(surface_for_query("files"), Some(SurfaceKind::FileTree { .. })));
        assert!(matches!(surface_for_query("tree"), Some(SurfaceKind::FileTree { .. })));
    }

    #[test]
    fn picker_matches_conjure_surface() {
        // Both the surface name and its alias "plan" resolve to Conjure.
        assert!(matches!(surface_for_query("conjure"), Some(SurfaceKind::Conjure)));
        assert!(matches!(surface_for_query("plan"), Some(SurfaceKind::Conjure)));
        // Conjure is not backed by a NAV pane — it renders the fixture DAG.
        assert!(nav_id_for_surface(&SurfaceKind::Conjure).is_none());
    }

    #[test]
    fn picker_is_case_insensitive_and_rejects_unknown() {
        assert!(matches!(surface_for_query("FLEET"), Some(SurfaceKind::Fleet)));
        assert!(surface_for_query("").is_none(), "empty query matches nothing");
        assert!(surface_for_query("zzzznope").is_none(), "unknown surface matches nothing");
    }

    #[test]
    fn build_stamp_carries_version() {
        let stamp = build_stamp();
        assert!(stamp.starts_with("pd-console v"), "stamp must name the app: {stamp}");
        assert!(stamp.contains(env!("CARGO_PKG_VERSION")), "stamp must carry the crate version: {stamp}");
    }
}
