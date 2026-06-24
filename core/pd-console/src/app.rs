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

use crate::dispatch_pane::DispatchHead;
use crate::mux::{Dir, Node, PaneId, SurfaceKind, Workspace};
use crate::pane::{Block, Pane, Tone};
use crate::palette::{Theme, ThemeMode};
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
    /// Kick off a new top-level agent: `POST /spawn` with a backend + prompt.
    Spawn { backend: String, prompt: String },
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
    /// Add an operator note: `POST /notes` with `{ content }`.
    AddNote { content: String },
    /// Begin a coordination session: `POST /sugar/begin` (durable lifecycle).
    BeginSession { identity: String },
    /// End the active coordination session: `POST /sugar/done` (optional summary).
    EndSession { summary: Option<String> },
    /// Propose a dispatch into the review queue: `POST /dispatches`.
    ProposeDispatch { goal: String },
    /// Launch a sortie mission: `POST /sorties` (projectDir from PD_CONSOLE_WORKDIR).
    LaunchSortie { goal: String },
    /// Claim a port for an identity: `POST /claim` — Port Daddy's core verb.
    ClaimPort { identity: String },
    /// Release a claimed port by identity: `DELETE /release`.
    ReleasePort { identity: String },
    /// Kill (unregister) an agent: `DELETE /agents/:id`.
    KillAgent { agent_id: String },
    /// Interrupt a specific agent by id: `POST /agents/:id/interrupt`. Broadens
    /// the Lane's interrupt to any agent named from the Fleet/Cockpit roster.
    InterruptAgent { agent_id: String },
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
            CmdKind::DispatchReject => "reject reason",
            CmdKind::AddPane => "add pane",
            CmdKind::Note => "note",
            CmdKind::Begin => "begin (identity)",
            CmdKind::Done => "done (summary)",
            CmdKind::Propose => "propose (goal)",
            CmdKind::Sortie => "sortie (goal)",
            CmdKind::Claim => "claim (identity)",
            CmdKind::Release => "release (identity)",
            CmdKind::Kill => "kill (agent id)",
            CmdKind::InterruptAgent => "interrupt (agent id)",
            CmdKind::Verb => ":",
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
    let trimmed = query.trim();
    // `:edit <path>` (or `edit <path>`) opens the Harbor Editor surface on a file.
    // Keep the raw (case-preserving) path — file systems are case-sensitive.
    if let Some(path) = trimmed
        .strip_prefix(":edit ")
        .or_else(|| trimmed.strip_prefix("edit "))
    {
        let path = path.trim();
        if !path.is_empty() {
            return Some(SurfaceKind::Editor { path: path.to_string(), region: None });
        }
    }
    let q = trimmed.to_lowercase();
    if q.is_empty() {
        return None;
    }
    // The operator control plane is the default top surface; make "operator"/"op"
    // resolve to it explicitly (ahead of the generic NAV prefix scan).
    if q == "op" || "operator".starts_with(&q) {
        return Some(SurfaceKind::Operator);
    }
    if "chat".starts_with(&q) || "cartographer".starts_with(&q) {
        return Some(SurfaceKind::CartographerChat);
    }
    if "files".starts_with(&q) || "tree".starts_with(&q) || "filetree".starts_with(&q) {
        return Some(SurfaceKind::FileTree { root: None });
    }
    NAV.iter()
        .find(|n| {
            n.key == q || n.id.starts_with(&q) || n.label.to_lowercase().starts_with(&q)
        })
        .map(|n| surface_for_nav_id(n.id))
}

/// An open command line: a prompt kind plus the text typed so far.
#[derive(Debug, Clone)]
pub struct CommandLine {
    kind: CmdKind,
    buffer: String,
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
    NavItem { id: "operator", label: "Operator", icon: "icons/nav/cockpit.svg",  key: "`" },
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
    NavItem { id: "parley",   label: "Parley",   icon: "icons/nav/parley.svg",   key: "j" },
    NavItem { id: "conductor",label: "Conductor",icon: "icons/nav/dispatch.svg", key: "k" },
    // ── Local-surface tiles (no producer slot — they render from disk, not the
    //    2s daemon poll). Kept AFTER the 23 producer-backed entries so the
    //    NAV-index == producer-slot invariant (slots 0..=22 in main.rs) holds.
    //    Editor needs a path, so its tile opens the file tree to pick one; Files
    //    opens the file tree directly. Discoverability fix: the editor was
    //    previously only reachable by typing a path, never from the launcher.
    NavItem { id: "editor",   label: "Editor",   icon: "icons/nav/editor.svg",   key: "e" },
    NavItem { id: "files",    label: "Files",    icon: "icons/nav/files.svg",    key: "f" },
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

/// Honour a reduced-motion preference (`PD_CONSOLE_REDUCED_MOTION=1`). gpui has
/// no `@media (prefers-reduced-motion)`, so this is the native opt-out: when set,
/// motion resolves to its final state instantly (orientation cues like the hover
/// glow stay; only the travel is dropped).
fn reduced_motion() -> bool {
    std::env::var("PD_CONSOLE_REDUCED_MOTION")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
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

/// A tone-tinted surface fill (badge / pill background): the tone color at low
/// alpha so the pill reads as "this meaning" without shouting. Alpha rides on
/// `Hsla` exactly like the motion glows — one place resolves Tone→OKLCH→rgb.
fn tone_surface(color: u32, alpha: f32) -> gpui::Hsla {
    let mut h: gpui::Hsla = gpui::rgb(color).into();
    h.a = alpha;
    h
}

/// A faint tone tint for a card's border — the card's meaning is legible at the
/// edge without coloring the whole panel (hierarchy by tint, not flood).
fn tone_border(color: u32) -> gpui::Hsla {
    tone_surface(color, 0.45)
}

/// The standing card "lift" — a soft drop-shadow under every Card. gpui 0.2.x
/// has no transform, so this BoxShadow IS the elevation (the design rule: real
/// raise via shadow, not a fake scale). The shadow is the theme's darkest token
/// (`sunken`) at low alpha — warm-dark, not a hardcoded black — so the lift
/// reads correctly in both light and dark palettes. Offset down + blurred.
fn card_elevation() -> Vec<gpui::BoxShadow> {
    use gpui::{point, px, BoxShadow, Hsla};
    let mut h: Hsla = gpui::rgb(current_theme().sunken).into();
    h.a = 0.55;
    vec![BoxShadow {
        color: h,
        offset: point(px(0.0), px(2.0)),
        blur_radius: px(16.0),
        spread_radius: px(0.0),
    }]
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

        // ── Rich GUI vocabulary — the native, designed faces ─────────────────
        Block::Card { title, tone, children } => {
            let t = current_theme();
            let tint = tone_rgb(&tone);
            // Real elevation: a soft dark drop-shadow gives the card lift (gpui
            // 0.2.x has no transform/scale, so BoxShadow IS the "raise"). The
            // border is a faint tone tint so the card's meaning reads at a glance
            // without coloring the whole surface.
            let mut card = div()
                .mx(px(16.0))
                .my(px(8.0))
                .p(px(16.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .rounded(px(12.0))
                .bg(rgb(t.panel))
                .border_1()
                .border_color(tone_border(tint))
                .shadow(card_elevation());
            if let Some(title) = title {
                card = card.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .pb(px(4.0))
                        // A short tone bar at the title's left edge — the card's
                        // semantic "spine" (meaning by position + a thin accent,
                        // never color-as-the-only-signal).
                        .child(
                            div()
                                .w(px(3.0))
                                .h(px(16.0))
                                .rounded_full()
                                .bg(rgb(tint)),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.ink))
                                .text_size(px(16.0))
                                .font_weight(FontWeight::BOLD)
                                .child(title),
                        ),
                );
            }
            // Children render recursively — a Card composes any vocabulary. The
            // inner blocks lose the outer px(16) gutter (the card supplies its own
            // padding), so wrap them flush.
            card.children(children.into_iter().map(render_block_flush))
                .into_any_element()
        }

        Block::Badge { label, tone } => {
            let tint = tone_rgb(&tone);
            div()
                .flex()
                .items_center()
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded_full()
                        .bg(tone_surface(tint, 0.16))
                        .text_color(rgb(tint))
                        .text_size(px(13.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(label),
                )
                .into_any_element()
        }

        Block::Bar { fraction, tone, label } => {
            let t = current_theme();
            let tint = tone_rgb(&tone);
            let frac = fraction.clamp(0.0, 1.0);
            div()
                .px(px(16.0))
                .py(px(6.0))
                .flex()
                .flex_col()
                .gap(px(4.0))
                .when_some(label, |c, lbl| {
                    c.child(
                        div()
                            .text_color(rgb(t.muted))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(lbl),
                    )
                })
                // The track: a full-width rounded sunken rail.
                .child(
                    div()
                        .w_full()
                        .h(px(8.0))
                        .rounded_full()
                        .bg(rgb(t.sunken))
                        // The fill: a fraction of the track, tone-colored. relative()
                        // gives a true proportional width — a REAL bar, not text.
                        .child(
                            div()
                                .h_full()
                                .w(relative(frac.max(0.02)))
                                .rounded_full()
                                .bg(rgb(tint)),
                        ),
                )
                .into_any_element()
        }

        Block::Metric { label, value, tone } => {
            let t = current_theme();
            let tint = tone_rgb(&tone);
            div()
                .px(px(16.0))
                .py(px(6.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                // The big number — real type hierarchy (size + weight).
                .child(
                    div()
                        .text_color(rgb(tint))
                        .text_size(px(26.0))
                        .font_weight(FontWeight::BOLD)
                        .font_family("IBM Plex Mono")
                        .child(value),
                )
                // The label beneath — small, muted, tracked-out eyebrow.
                .child(
                    div()
                        .text_color(rgb(t.muted))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(label.to_uppercase()),
                )
                .into_any_element()
        }

        Block::MetricRow(metrics) => {
            let t = current_theme();
            div()
                .flex()
                .flex_row()
                .gap(px(12.0))
                .px(px(16.0))
                .py(px(8.0))
                .children(metrics.into_iter().map(|(label, value, tone)| {
                    let tint = tone_rgb(&tone);
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .p(px(10.0))
                        .rounded(px(8.0))
                        .bg(rgb(t.sunken))
                        .child(
                            div()
                                .text_color(rgb(tint))
                                .text_size(px(24.0))
                                .font_weight(FontWeight::BOLD)
                                .font_family("IBM Plex Mono")
                                .child(value),
                        )
                        .child(
                            div()
                                .text_color(rgb(t.muted))
                                .text_size(px(12.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(label.to_uppercase()),
                        )
                }))
                .into_any_element()
        }

        Block::ActionRow { icon, title, subtitle, action, badge } => {
            let t = current_theme();
            let mut row = div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .px(px(16.0))
                .py(px(8.0))
                .rounded(px(8.0))
                .hover(|s| s.bg(rgb(current_theme().raised)));
            // Leading flag glyph — a tone-colored ICS square (never an emoji).
            if let Some(glyph) = icon {
                row = row.child(
                    div()
                        .w(px(24.0))
                        .h(px(24.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .flex_shrink_0()
                        .rounded(px(4.0))
                        .border_1()
                        .border_color(rgb(t.accent_ink))
                        .bg(rgb(t.raised))
                        .text_color(rgb(t.accent_ink))
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .child(glyph.to_string()),
                );
            }
            // Title + subtitle stacked, taking the available width.
            row = row.child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_color(rgb(t.ink))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    )
                    .when_some(subtitle, |c, sub| {
                        c.child(
                            div()
                                .text_color(rgb(t.muted))
                                .text_size(px(13.0))
                                .child(sub),
                        )
                    }),
            );
            // Right-aligned badge pill.
            if let Some((b_label, b_tone)) = badge {
                let tint = tone_rgb(&b_tone);
                row = row.child(
                    div()
                        .flex_shrink_0()
                        .px(px(8.0))
                        .py(px(3.0))
                        .rounded_full()
                        .bg(tone_surface(tint, 0.16))
                        .text_color(rgb(tint))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(b_label),
                );
            }
            // Monospace action chip — the operator's next keystroke.
            if let Some(act) = action {
                row = row.child(
                    div()
                        .flex_shrink_0()
                        .px(px(8.0))
                        .py(px(3.0))
                        .rounded(px(6.0))
                        .bg(rgb(t.sunken))
                        .border_1()
                        .border_color(rgb(t.line))
                        .text_color(rgb(t.accent_ink))
                        .text_size(px(13.0))
                        .font_family("IBM Plex Mono")
                        .child(act),
                );
            }
            row.into_any_element()
        }
    }
}

/// Render a block flush inside a Card — Cards supply their own px(16) padding, so
/// child blocks must drop the outer gutter to avoid double-indenting. We re-emit
/// the rich children unchanged (they already sit at px(16), which inside the
/// card's own px(16) reads as a clean inset) but strip the gutter from the flat
/// text primitives so a Card's body lines up with its title spine.
fn render_block_flush(block: Block) -> impl IntoElement {
    match block {
        // Flat text primitives inside a card: zero the horizontal gutter so they
        // align with the card's title (the card already pads).
        Block::KeyVal(key, val) => {
            let t = current_theme();
            div()
                .flex()
                .gap(px(8.0))
                .py(px(3.0))
                .child(
                    div()
                        .text_color(rgb(t.muted))
                        .text_size(px(14.0))
                        .w(px(140.0))
                        .flex_shrink_0()
                        .child(key),
                )
                .child(
                    div()
                        .text_color(rgb(t.ink))
                        .text_size(px(14.0))
                        .font_family("IBM Plex Mono")
                        .child(val),
                )
                .into_any_element()
        }
        Block::ActionRow { .. }
        | Block::Bar { .. }
        | Block::Metric { .. }
        | Block::MetricRow(_)
        | Block::Badge { .. } => {
            // Rich children: strip the px(16) gutter the standalone renderer adds
            // by wrapping in a negative-margin-free flush container. We re-render
            // through the main path then pull it left via mx(-16) so it fills the
            // card's content box edge-to-edge.
            div().mx(px(-16.0)).child(render_block(block)).into_any_element()
        }
        other => render_block(other).into_any_element(),
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
    /// Stable focus handle — created once and focused on open. Recreating it per
    /// render (the old `cx.focus_handle()` in render) meant nothing stayed
    /// focused, so the keyboard nav never received key events.
    focus_handle: FocusHandle,
    /// Channel to the background thread for operator mutations (Interrupt etc.).
    /// `None` when running without a control plane (e.g. an isolated test view).
    control_tx: Option<mpsc::Sender<ControlMsg>>,
    /// Transient confirmation shown after a control action ("interrupt sent").
    control_flash: Option<String>,
    /// Head-of-queue dispatch the review gate acts on (from the background refresh).
    dispatch_head: Option<DispatchHead>,
    /// Dispatch id pending a reject reason (set when the operator opens the reject line).
    reject_target: Option<String>,
    /// The pane launcher overlay — an animated grid of surface tiles. `Ctrl-A Space`
    /// (or the ⊞ button) opens it; clicking a tile swaps the focused pane's surface.
    launcher_open: bool,
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
            focus_handle: cx.focus_handle(),
            control_tx,
            control_flash: None,
            dispatch_head: None,
            reject_target: None,
            // Screenshot/demo hook (mirrors `--pane`): open the launcher on startup
            // so capture tooling can grab it without injecting a keystroke.
            launcher_open: std::env::var("PD_CONSOLE_OPEN_LAUNCHER").is_ok(),
        }
    }

    /// The opening layout: a fleet overview beside a stacked agent-lane /
    /// roadmap column — proof of multiplex on first launch. `initial` (if a
    /// known nav id) becomes the focused pane's surface.
    fn default_workspace(initial: Option<&str>) -> Workspace {
        // The Operator control plane is the operator's most-wanted view, so it is
        // the primary surface (leaf id 1) and the focused pane on launch. The
        // fleet/lane/roadmap columns ride alongside it.
        let mut ws = Workspace::new(SurfaceKind::Operator);
        ws.split(Dir::Row, SurfaceKind::AgentTranscript { agent_id: None }); // operator | lane
        ws.split(Dir::Col, SurfaceKind::Roadmap); // lane / roadmap
        ws.focus(1); // start focused on the Operator pane (first leaf id)
        if let Some(nav) = initial {
            if NAV.iter().any(|n| n.id == nav) {
                ws.swap_surface(surface_for_nav_id(nav));
            } else if let Some(surface) = surface_for_query(nav) {
                // Non-NAV surfaces (e.g. `--pane filetree`, `--pane "edit <path>"`)
                // route through the command-palette resolver so screenshot tooling
                // can open the Harbor Editor / FileTree without keystroke injection.
                ws.swap_surface(surface);
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
            "n" => self.command = Some(CommandLine { kind: CmdKind::Spawn, buffer: String::new() }),
            "t" => self.command = Some(CommandLine { kind: CmdKind::Cartographer, buffer: String::new() }),
            // Insert a new pane of a chosen kind (the add-pane picker).
            "i" => self.command = Some(CommandLine { kind: CmdKind::AddPane, buffer: String::new() }),
            // Operator verb palette (vim-`:`): one entry point for every write
            // (note/begin/done/propose/sortie/claim/release/kill). `v` is an
            // ASCII alias for terminals that swallow `:` after the leader.
            ":" | "v" => self.command = Some(CommandLine { kind: CmdKind::Verb, buffer: String::new() }),
            // Direct single-key shortcuts for the most-used operator writes
            // (free letters, no NAV/leader collision):
            //   f note · e propose · u sortie · r begin · q done · j claim · Q release · X kill
            "f" => self.command = Some(CommandLine { kind: CmdKind::Note, buffer: String::new() }),
            "e" => self.command = Some(CommandLine { kind: CmdKind::Propose, buffer: String::new() }),
            "u" => self.command = Some(CommandLine { kind: CmdKind::Sortie, buffer: String::new() }),
            "r" => self.command = Some(CommandLine { kind: CmdKind::Begin, buffer: String::new() }),
            "q" => self.command = Some(CommandLine { kind: CmdKind::Done, buffer: String::new() }),
            "j" => self.command = Some(CommandLine { kind: CmdKind::Claim, buffer: String::new() }),
            "Q" => self.command = Some(CommandLine { kind: CmdKind::Release, buffer: String::new() }),
            "X" => self.command = Some(CommandLine { kind: CmdKind::Kill, buffer: String::new() }),
            // The visual pane launcher — an animated grid of surface tiles.
            "space" => self.launcher_open = true,
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

    /// Dispatch a submitted command to the background thread (which owns the
    /// daemon client and performs the POST).
    fn submit_command(&mut self, cmd: CommandLine) {
        let text = cmd.buffer.trim().to_string();
        // The verb palette (`:`) re-dispatches: its first token names a concrete
        // write, the rest is that write's argument. Resolve it into the real
        // CommandLine and submit THAT, so the per-verb paths below run unchanged.
        if cmd.kind == CmdKind::Verb {
            if let Some((kind, arg)) = parse_verb(&text) {
                self.submit_command(CommandLine { kind, buffer: arg });
            } else if !text.is_empty() {
                let verb = text.split_whitespace().next().unwrap_or("");
                self.control_flash = Some(format!("unknown verb '{verb}' — try note/begin/done/propose/sortie/claim/release/kill"));
            }
            return;
        }
        // Reject and Done may submit empty (Reject falls back to a default reason;
        // Done's summary is optional); every other verb needs text.
        if text.is_empty() && cmd.kind != CmdKind::DispatchReject && cmd.kind != CmdKind::Done {
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
        let Some(tx) = &self.control_tx else { return };
        match cmd.kind {
            CmdKind::Spawn => {
                let (backend, prompt) = split_backend(&text);
                let _ = tx.send(ControlMsg::Spawn {
                    backend: backend.clone(),
                    prompt,
                });
                self.control_flash = Some(format!("spawning a {backend} agent…"));
            }
            CmdKind::Cartographer => {
                let _ = tx.send(ControlMsg::Cartographer { text });
                self.control_flash = Some("sent to cartographer — watch the lane".into());
            }
            CmdKind::DispatchReject => {
                if let Some(id) = self.reject_target.take() {
                    let reason = if text.len() >= 3 { text } else { "rejected via console".into() };
                    let _ = tx.send(ControlMsg::DispatchReject { id, reason });
                    self.control_flash = Some("dispatch rejected".into());
                }
            }
            CmdKind::Note => {
                let _ = tx.send(ControlMsg::AddNote { content: text });
                self.control_flash = Some("note added → check Memory".into());
            }
            CmdKind::Begin => {
                let _ = tx.send(ControlMsg::BeginSession { identity: text.clone() });
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
                let _ = tx.send(ControlMsg::ClaimPort { identity: text.clone() });
                self.control_flash = Some(format!("claiming port for {text}…"));
            }
            CmdKind::Release => {
                let _ = tx.send(ControlMsg::ReleasePort { identity: text.clone() });
                self.control_flash = Some(format!("releasing {text}…"));
            }
            CmdKind::Kill => {
                let _ = tx.send(ControlMsg::KillAgent { agent_id: text.clone() });
                self.control_flash = Some(format!("killing agent {text}…"));
            }
            CmdKind::InterruptAgent => {
                let _ = tx.send(ControlMsg::InterruptAgent { agent_id: text.clone() });
                self.control_flash = Some(format!("interrupting agent {text}…"));
            }
            // AddPane and Verb are handled locally above (early return) — never reach here.
            CmdKind::AddPane | CmdKind::Verb => {}
        }
    }

    /// The pane launcher overlay (Ctrl-A Space / the ⊞ button): an animated grid
    /// of surface tiles. Click — or press a tile's Ctrl-A key — to swap the
    /// focused pane to that surface. Motion discipline (rust-gpui-motion): no
    /// transforms — entrance is a one-shot staggered opacity fade (one owner per
    /// tile, no repeat()); hover "lift" is a BoxShadow glow; reduced-motion
    /// renders tiles at full opacity but keeps the hover glow for orientation.
    fn render_launcher(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = current_theme();
        let reduced = reduced_motion();
        let current = nav_id_for_surface(self.ws().focused_surface()).map(|s| s.to_string());
        let n = NAV.len().max(1);
        let cols = 5usize; // tiles per row — explicit grid (flex_wrap height isn't summed).

        let mut tiles: Vec<AnyElement> = NAV.iter().enumerate().map(|(i, nav)| {
            let id = nav.id;
            let is_current = current.as_deref() == Some(nav.id);
            let tile = div()
                .id(SharedString::from(format!("launch-{id}")))
                .w(px(112.0))
                .h(px(96.0))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(6.0))
                .rounded(px(12.0))
                .border_1()
                .border_color(rgb(if is_current { t.accent_ink } else { t.line }))
                .bg(rgb(t.raised))
                .cursor_pointer()
                // The focused pane's current surface gets a standing glow ring.
                .when(is_current, |s| s.shadow(motion::glow(t.accent, 0.30, 14.0, 1.0)))
                // Hover "lift" = a brighter card + a wider/softer glow (no scale()).
                .hover(move |s| {
                    let t = current_theme();
                    s.bg(rgb(t.panel))
                        .border_color(rgb(t.accent_ink))
                        .shadow(motion::glow(t.accent, 0.42, 22.0, 2.0))
                })
                .child(
                    svg()
                        .path(nav.icon)
                        .w(px(30.0))
                        .h(px(30.0))
                        .text_color(rgb(if is_current { t.accent_ink } else { t.ink })),
                )
                .child(
                    div()
                        .text_color(rgb(t.ink))
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(nav.label),
                )
                .child(
                    div()
                        .text_color(rgb(t.muted))
                        .text_size(px(11.0))
                        .child(format!("⌃A {}", nav.key)),
                )
                .on_click(cx.listener(move |this, _ev, _window, cx| {
                    this.ws_mut().swap_surface(surface_for_nav_id(id));
                    this.launcher_open = false;
                    this.control_flash = Some(format!("→ {id}"));
                    cx.notify();
                }));

            if reduced {
                // Reduced-motion: resolve to the FINAL state (full opacity, the
                // standing-glow only on the current tile). Orientation cues stay;
                // only the travel is dropped. No animation owner is created.
                tile.into_any_element()
            } else {
                // One-shot staggered fade+lift — the stagger lives in the curve
                // (a per-tile phase offset), so each tile stays its own SINGLE
                // animation owner with NO `.repeat()` (the idle window never
                // re-renders once the entrance settles). Motion is composed from
                // opacity + a growing BoxShadow glow only (gpui 0.2.x has no
                // transform, so the "lift" IS the shadow — never a fake scale).
                let start = (i as f32 / n as f32) * 0.5;
                let accent = t.accent;
                tile.with_animation(
                    SharedString::from(format!("launch-in-{id}")),
                    Animation::new(Duration::from_millis(360)).with_easing(ease_in_out),
                    move |el, delta| {
                        // Local fraction: this tile's own 0→1 progress after its
                        // phase offset. One animated layout fraction, one owner.
                        let p = ((delta - start) / (1.0 - start)).clamp(0.0, 1.0);
                        // Opacity rises; the lift-shadow grows from flat to raised
                        // as the tile settles (blur 0→14, alpha 0→0.30).
                        el.opacity(p)
                            .shadow(motion::glow(accent, 0.30 * p, 14.0 * p, 1.0 * p))
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
            let take = tiles.len().min(cols);
            let row: Vec<AnyElement> = tiles.drain(0..take).collect();
            rows.push(div().flex().gap(px(10.0)).children(row).into_any_element());
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
                    .gap(px(14.0))
                    .p(px(22.0))
                    .max_w(px(760.0))
                    .rounded(px(16.0))
                    .bg(rgb(t.panel))
                    .border_1()
                    .border_color(rgb(t.line))
                    .shadow(motion::glow(t.accent, 0.22, 30.0, 1.0))
                    .child(
                        div()
                            .text_color(rgb(t.accent_ink))
                            .text_size(px(16.0))
                            .font_weight(FontWeight::BOLD)
                            .child("Jump to a pane"),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.0))
                            .children(rows),
                    )
                    .child(
                        div()
                            .text_color(rgb(t.muted))
                            .text_size(px(12.0))
                            .child("click a tile · press its ⌃A key · Esc to close"),
                    ),
            )
            .into_any_element()
    }

    /// Push fresh data for all panes from the background refresh loop.
    /// Each entry is (nav_index, blocks_for_that_pane); `dispatch_head` is the
    /// head-of-queue dispatch for the review gate (None when the queue is empty).
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
    fn render_node(&self, node: &Node, focused: PaneId, cx: &mut Context<Self>) -> AnyElement {
        match node {
            Node::Split { dir, children } => {
                let total: f32 = children.iter().map(|c| c.weight).sum::<f32>().max(0.0001);
                let mut container = div().flex().size_full().overflow_hidden();
                container = match dir {
                    Dir::Row => container.flex_row(),
                    Dir::Col => container.flex_col(),
                };
                for child in children {
                    let frac = child.weight / total;
                    container = container.child(
                        div()
                            .flex_basis(relative(frac))
                            .flex_grow()
                            .flex_shrink()
                            .overflow_hidden()
                            .child(self.render_node(&child.node, focused, cx)),
                    );
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
        // The fleet/cockpit surfaces (focused) get the agent ops gate (kill /
        // interrupt). Both read `/agents`, so they share the roster.
        let is_fleet_ops = matches!(nav_id_for_surface(surface), Some("fleet") | Some("cockpit"));
        // The FileTree surface (P0 Harbor wiring): clickable rows — a file row
        // opens the Editor surface; a directory row descends (rebinds the root).
        let filetree: Option<(Option<String>, Vec<FileEntry>)> = match surface {
            SurfaceKind::FileTree { root } => {
                Some((root.clone(), filetree_entries(root.as_deref()).unwrap_or_default()))
            }
            _ => None,
        };
        let dispatch_head = self.dispatch_head.clone();
        let gate_flash = self.control_flash.clone();
        let cond_flash = self.control_flash.clone();
        let fleet_flash = self.control_flash.clone();
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
            .child({
                let body = div()
                    .id(SharedString::from(format!("pane-body-{id}")))
                    .flex_1()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col();
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
                    // Every other surface: the generic read-agnostic Block renderer.
                    None => body.children(blocks.into_iter().map(render_block)),
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
                                .text_size(px(13.0))
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
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            .into_any_element()
    }
}

/// One fleet/cockpit agent-ops button. Both open a targeted command line that
/// takes the agent id: `kill` → `CmdKind::Kill` (DELETE /agents/:id); `interrupt`
/// → reuses the Lane's interrupt path scoped to the typed agent. Opening a
/// command line (rather than acting on a phantom selection) keeps the trigger
/// real — the operator names the agent, then the ControlMsg fires on submit.
fn fleet_ops_btn(
    action: &'static str,
    label: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    div()
        .id(SharedString::from(format!("fleetops-{action}")))
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
                "kill" => {
                    this.command = Some(CommandLine { kind: CmdKind::Kill, buffer: String::new() });
                }
                "interrupt" => {
                    this.command = Some(CommandLine { kind: CmdKind::InterruptAgent, buffer: String::new() });
                }
                _ => {}
            }
            cx.notify();
        }))
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
                    this.command = Some(CommandLine { kind: CmdKind::DispatchReject, buffer: String::new() });
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
    let kind = match verb.to_lowercase().as_str() {
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
                    this.command = Some(CommandLine { kind: CmdKind::AddPane, buffer: String::new() });
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
                .text_color(rgb(if is_dir { current_theme().accent_ink } else { current_theme().ink }))
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
                this.ws_mut()
                    .swap_surface(SurfaceKind::Editor { path: path.clone(), region: None });
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
        "operator" => SurfaceKind::Operator,
        // Local-disk surfaces. Editor needs a path, so its launcher tile opens
        // the file tree to choose one (clicking a file row swaps to the Editor);
        // Files opens the same tree directly.
        "editor" | "files" => SurfaceKind::FileTree { root: None },
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
        SurfaceKind::Operator => Some("operator"),
        SurfaceKind::Panel { nav } => Some(nav.as_str()),
        // Local-disk surfaces map to their launcher tiles so the grid highlights
        // the current one. They have NO producer slot, so `blocks_for_surface`
        // must early-return for them (it does: FileTree/Editor are handled before
        // the `nav_id_for_surface → pane_blocks[i]` lookup).
        SurfaceKind::FileTree { .. } => Some("files"),
        SurfaceKind::Editor { .. } => Some("editor"),
        SurfaceKind::CartographerChat => None,
    }
}

impl Focusable for ConsoleView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for ConsoleView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let daemon_url = self.daemon_url.clone();
        let focused = self.ws().focused();
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
                self.render_node(&root, focused, cx)
            }
        };
        // The pane launcher overlay (when open) is the last child so it paints on top.
        let launcher = if self.launcher_open {
            Some(self.render_launcher(cx))
        } else {
            None
        };

        div()
            .key_context("console")
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
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
                    } else if let Some(item) = NAV.iter().find(|n| n.key == key) {
                        this.ws_mut().swap_surface(surface_for_nav_id(item.id));
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
                }
            }))
            // ── Tab bar (named workspaces, like tmux windows) ──
            .child(
                div()
                    .h(px(28.0))
                    .px(px(6.0))
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
                    ),
            )
            // The pane tree (or a maximized pane) fills the window.
            .child(div().flex_1().overflow_hidden().child(body))
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
                        // Open command line — type, Enter submits, Esc cancels.
                        div()
                            .flex()
                            .gap(px(8.0))
                            .items_center()
                            .child(
                                div()
                                    .text_color(rgb(current_theme().accent_ink))
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(format!("{}", cmd.kind.prompt())),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .text_color(rgb(current_theme().ink))
                                    .text_size(px(14.0))
                                    .font_family("IBM Plex Mono")
                                    .child(format!("› {}▏", cmd.buffer)),
                            )
                            .child(
                                div()
                                    .text_color(rgb(current_theme().muted))
                                    .text_size(px(13.0))
                                    .child(if cmd.kind == CmdKind::AddPane {
                                        "fleet·cost·roadmap·lane·dispatch·chat·files… ⏎ add".to_string()
                                    } else {
                                        "⏎ send · esc cancel".to_string()
                                    }),
                            )
                    } else if armed {
                        div()
                            .text_color(rgb(current_theme().accent_ink))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(
                                "PREFIX  |  | split · - vsplit · x close · z zoom · o next · =/_ resize · w new-tab · [ ] tabs · n new-job · t cartographer · i insert-pane · : verb-palette (note/begin/done/propose/sortie/claim/release/kill) · [1-9…] surface",
                            )
                    } else {
                        div()
                            .text_color(rgb(current_theme().muted))
                            .text_size(px(13.0))
                            .font_family("IBM Plex Mono")
                            .child(format!(
                                "daemon {daemon_url}  ·  {pane_count} panes  ·  Ctrl-A → space launcher · n new-job · i insert-pane · | split  ·  {}",
                                build_stamp()
                            ))
                    }),
            )
            // Pane launcher overlay — last child, paints over everything.
            .children(launcher)
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
        assert!(!matches!(surface_for_query(":edit "), Some(SurfaceKind::Editor { .. })));
    }

    #[test]
    fn filetree_entries_list_dirs_first_then_files() {
        // The crate's own src/ has both files and (no) subdirs; assert the sort
        // contract against a synthesized listing instead of the real FS shape.
        let dir = std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join("coding/tmp/pd-harbor-ft-test"))
            .unwrap_or_else(|_| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/ft-test"));
        std::fs::create_dir_all(dir.join("zsub")).unwrap();
        std::fs::write(dir.join("afile.txt"), "x").unwrap();
        std::fs::write(dir.join("bfile.txt"), "y").unwrap();
        let entries = filetree_entries(Some(&dir.to_string_lossy())).expect("listing");
        // Directory ("zsub/") sorts before files despite z > a/b alphabetically.
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "zsub/");
        let files: Vec<&str> = entries.iter().filter(|e| !e.is_dir).map(|e| e.name.as_str()).collect();
        assert_eq!(files, vec!["afile.txt", "bfile.txt"]);
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

    #[test]
    fn parse_verb_routes_every_write() {
        // Each operator write resolves to its concrete CmdKind, arg preserved.
        let cases = [
            ("note shipped the gate", CmdKind::Note, "shipped the gate"),
            ("begin port-daddy:console:main", CmdKind::Begin, "port-daddy:console:main"),
            ("propose land the console PR", CmdKind::Propose, "land the console PR"),
            ("sortie refactor the executor", CmdKind::Sortie, "refactor the executor"),
            ("claim port-daddy:api:main", CmdKind::Claim, "port-daddy:api:main"),
            ("release port-daddy:api:main", CmdKind::Release, "port-daddy:api:main"),
            ("kill agent-xyz", CmdKind::Kill, "agent-xyz"),
            ("interrupt agent-xyz", CmdKind::InterruptAgent, "agent-xyz"),
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
        assert_eq!(parse_verb("end wrapped up"), Some((CmdKind::Done, "wrapped up".to_string())));
        // Aliases keep muscle memory short.
        assert!(matches!(parse_verb("dispatch land it"), Some((CmdKind::Propose, _))));
        assert!(matches!(parse_verb("chat hey carto"), Some((CmdKind::Cartographer, _))));
        assert!(matches!(parse_verb("stop agent-1"), Some((CmdKind::InterruptAgent, _))));
    }

    #[test]
    fn parse_verb_rejects_unknown_and_is_case_insensitive() {
        assert!(parse_verb("frobnicate the widget").is_none());
        assert!(parse_verb("").is_none());
        // Case folds on the verb token.
        assert!(matches!(parse_verb("KILL agent-7"), Some((CmdKind::Kill, _))));
    }
}
