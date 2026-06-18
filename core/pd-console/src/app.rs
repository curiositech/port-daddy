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

use crate::mux::{Dir, Node, PaneId, SurfaceKind, Workspace};
use crate::pane::{Block, Tone};
use std::sync::mpsc;

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
}

/// Which command line is open at the bottom of the console.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmdKind {
    /// Kick off a new job. Buffer is `[backend] <prompt>`.
    Spawn,
    /// Talk to the cartographer. Buffer is the message.
    Cartographer,
}

impl CmdKind {
    fn prompt(&self) -> &'static str {
        match self {
            CmdKind::Spawn => "spawn",
            CmdKind::Cartographer => "cartographer",
        }
    }
}

/// An open command line: a prompt kind plus the text typed so far.
#[derive(Debug, Clone)]
pub struct CommandLine {
    kind: CmdKind,
    buffer: String,
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
];

// ── Palette — pre-computed from DARK OKLCH theme ──────────────────────────────
// All values are sRGB u32 (0xRRGGBB), passed through rgb() at render time.

const C_BG:     u32 = 0x1a1917;
const C_PANEL:  u32 = 0x1f1e1b;
const C_RAISED: u32 = 0x252420;
const C_INK:    u32 = 0xf2f0eb;
const C_INK2:   u32 = 0xd4cfc7;
const C_MUTED:  u32 = 0xa09a90;
const C_ACCENT: u32 = 0xe3b56d; // amber
const C_ENGAGED:u32 = 0x6b8fd4; // blue
const C_GATED:  u32 = 0xd4736b; // warm red
const C_LANDED: u32 = 0x6bd4a0; // green
const C_BORDER: u32 = 0x2e2c28;

fn tone_rgb(tone: &Tone) -> u32 {
    match tone {
        Tone::Default    => C_INK2,
        Tone::Accent     => C_ACCENT,
        Tone::Engaged    => C_ENGAGED,
        Tone::Gated      => C_GATED,
        Tone::Resting    => C_MUTED,
        Tone::Landed     => C_LANDED,
        Tone::Conflicted => C_GATED,
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
                .text_color(rgb(C_ACCENT))
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
                        .text_color(rgb(C_MUTED))
                        .text_size(px(14.0))
                        .w(px(150.0))
                        .flex_shrink_0()
                        .child(key)
                )
                .child(
                    div()
                        .text_color(rgb(C_INK))
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
                .hover(|s| s.bg(rgb(C_RAISED)))
                .children(
                    cells.into_iter().enumerate().map(|(i, cell)| {
                        div()
                            .text_color(rgb(if i == 0 { C_ACCENT } else { C_INK2 }))
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
        Block::Spark(_) => {
            div()
                .px(px(16.0))
                .py(px(4.0))
                .text_color(rgb(C_MUTED))
                .text_size(px(13.0))
                .child("▁▂▃▄▅▆▇")
                .into_any_element()
        }
        Block::Gap => {
            div().h(px(8.0)).into_any_element()
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
        let ink = if self.active { C_INK } else { C_MUTED };
        div()
            .px(px(10.0))
            .py(px(6.0))
            .mx(px(4.0))
            .my(px(1.0))
            .rounded(px(6.0))
            .cursor_pointer()
            .when(self.active, |s| {
                s.bg(rgb(C_RAISED))
                 .border_l_2()
                 .border_color(rgb(C_ACCENT))
            })
            .hover(|s| s.bg(rgb(C_RAISED)))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(3.0))
            .child(
                svg()
                    .path(self.icon)
                    .w(px(18.0))
                    .h(px(18.0))
                    .text_color(rgb(if self.active { C_ACCENT } else { C_MUTED }))
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
    /// The pane tree — the tmux-style spatial multiplexer. Replaces the old
    /// single `active_nav` selection: the window is now a tree of panes, each
    /// showing a surface, with one focused. See `crate::mux`.
    workspace: Workspace,
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
            workspace: Self::default_workspace(initial_pane.as_deref()),
            leader_armed: false,
            command: None,
            pane_blocks,
            daemon_url,
            focus_handle: cx.focus_handle(),
            control_tx,
            control_flash: None,
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

    /// Map a surface to the blocks the background refresh thread has fetched
    /// for it. Existing live panels resolve through `pane_blocks`; surfaces
    /// without a backing fetcher yet render an honest placeholder.
    fn blocks_for_surface(&self, surface: &SurfaceKind) -> Vec<Block> {
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
                let s = self.workspace.focused_surface().clone();
                self.workspace.split(Dir::Row, s);
            }
            "-" => {
                let s = self.workspace.focused_surface().clone();
                self.workspace.split(Dir::Col, s);
            }
            "x" => {
                self.workspace.close();
            }
            "o" | "tab" => self.workspace.focus_next(),
            "O" => self.workspace.focus_prev(),
            // Double-prefix (Ctrl-A Ctrl-A) cycles focus — fast tmux idiom.
            "a" if ctrl => self.workspace.focus_next(),
            // Resize the focused pane.
            "=" | "+" => { self.workspace.resize(0.15); }
            "_" => { self.workspace.resize(-0.15); }
            // Open command lines.
            "n" => self.command = Some(CommandLine { kind: CmdKind::Spawn, buffer: String::new() }),
            "t" => self.command = Some(CommandLine { kind: CmdKind::Cartographer, buffer: String::new() }),
            // Any nav key swaps the focused pane's surface — "hop context".
            other => {
                if let Some(item) = NAV.iter().find(|n| n.key == other) {
                    self.workspace.swap_surface(surface_for_nav_id(item.id));
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
        if text.is_empty() {
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
        }
    }

    /// Push fresh data for all panes from the background refresh loop.
    /// Each entry is (nav_index, blocks_for_that_pane).
    pub fn update_panes(&mut self, updates: Vec<(usize, Vec<Block>)>) {
        for (idx, blocks) in updates {
            if let Some(slot) = self.pane_blocks.get_mut(idx) {
                *slot = blocks;
            }
        }
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
        let border = if is_focused { C_ACCENT } else { C_BORDER };
        let title_color = if is_focused { C_ACCENT } else { C_MUTED };
        let control_flash = self.control_flash.clone();

        div()
            .id(SharedString::from(format!("pane-{id}")))
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(border))
            .bg(rgb(C_PANEL))
            .on_click(cx.listener(move |this, _ev, _window, cx| {
                this.workspace.focus(id);
                cx.notify();
            }))
            // Title bar
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .py(px(5.0))
                    .bg(rgb(if is_focused { C_RAISED } else { C_PANEL }))
                    .border_b_1()
                    .border_color(rgb(C_BORDER))
                    .child(
                        div()
                            .text_color(rgb(if is_focused { C_ACCENT } else { C_BORDER }))
                            .text_size(px(13.0))
                            .child(if is_focused { "●" } else { "○" }),
                    )
                    .child(
                        div()
                            .text_color(rgb(title_color))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(label),
                    ),
            )
            // Surface body
            .child(
                div()
                    .flex_1()
                    .overflow_hidden()
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
                        .border_color(rgb(C_BORDER))
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
                                .border_color(rgb(C_GATED))
                                .text_color(rgb(C_GATED))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(C_RAISED)))
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
                                    .text_color(rgb(C_MUTED))
                                    .text_size(px(13.0))
                                    .child(flash),
                            )
                        }),
                )
            })
            .into_any_element()
    }
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
        SurfaceKind::CartographerChat | SurfaceKind::FileTree { .. } => None,
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
        let focused = self.workspace.focused();
        let armed = self.leader_armed;
        let command = self.command.clone();
        let lit = armed || command.is_some();
        let pane_count = self.workspace.pane_count();
        // Clone the tree shape so we can render it while `cx` is borrowed for
        // the key/click listeners below.
        let root = self.workspace.root.clone();
        let tree = self.render_node(&root, focused, cx);

        div()
            .key_context("console")
            .track_focus(&self.focus_handle)
            .size_full()
            .bg(rgb(C_BG))
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
            // The pane tree fills the window — this is the multiplexer.
            .child(div().flex_1().overflow_hidden().child(tree))
            // ── Command / status bar ──
            .child(
                div()
                    .h(px(26.0))
                    .px(px(12.0))
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .bg(rgb(if lit { C_RAISED } else { C_PANEL }))
                    .border_t_1()
                    .border_color(rgb(if lit { C_ACCENT } else { C_BORDER }))
                    .child(if let Some(cmd) = command.as_ref() {
                        // Open command line — type, Enter submits, Esc cancels.
                        div()
                            .flex()
                            .gap(px(8.0))
                            .items_center()
                            .child(
                                div()
                                    .text_color(rgb(C_ACCENT))
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(format!("{}", cmd.kind.prompt())),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .text_color(rgb(C_INK))
                                    .text_size(px(14.0))
                                    .font_family("IBM Plex Mono")
                                    .child(format!("› {}▏", cmd.buffer)),
                            )
                            .child(
                                div()
                                    .text_color(rgb(C_MUTED))
                                    .text_size(px(13.0))
                                    .child("⏎ send · esc cancel"),
                            )
                    } else if armed {
                        div()
                            .text_color(rgb(C_ACCENT))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(
                                "PREFIX  |  | split · - vsplit · x close · o next · =/_ resize · n new-job · t cartographer · [1-9 s m p h c d l] surface",
                            )
                    } else {
                        div()
                            .text_color(rgb(C_MUTED))
                            .text_size(px(13.0))
                            .font_family("IBM Plex Mono")
                            .child(format!(
                                "daemon {daemon_url}  ·  {pane_count} panes  ·  Ctrl-A → n new-job · t cartographer · | split  ·  pd-console v0.3.0"
                            ))
                    }),
            )
    }
}
