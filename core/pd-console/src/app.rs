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

use crate::pane::{Block, Tone};
use std::sync::mpsc;

/// Operator control messages sent from the GPUI view (button clicks) back to the
/// background refresh thread, which owns the surfaces and performs the daemon
/// mutation. Keeps the foreground thread free of async/tokio.
#[derive(Debug, Clone)]
pub enum ControlMsg {
    /// Grab the wheel: interrupt the agent the Lane is watching.
    InterruptLane,
}

// ── Nav items ────────────────────────────────────────────────────────────────

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
    NavItem { id: "lineage",  label: "Lineage",  icon: "icons/nav/lineage.svg",  key: "g" },
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
    pub active_nav: usize,
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

        // Open on the requested pane if its id matches a NAV entry, else Fleet.
        let active_nav = initial_pane
            .and_then(|id| NAV.iter().position(|n| n.id == id))
            .unwrap_or(0);

        Self {
            active_nav,
            pane_blocks,
            daemon_url,
            focus_handle: cx.focus_handle(),
            control_tx,
            control_flash: None,
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

    fn blocks_for_active(&self) -> Vec<Block> {
        self.pane_blocks
            .get(self.active_nav)
            .cloned()
            .unwrap_or_default()
    }
}

impl Focusable for ConsoleView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for ConsoleView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.active_nav;
        let blocks = self.blocks_for_active();
        let daemon_url = self.daemon_url.clone();
        let active_nav_name = NAV.get(active).map(|n| n.label).unwrap_or("—");
        let active_nav_icon = NAV.get(active).map(|n| n.icon).unwrap_or("icons/nav/fleet.svg");
        // The Lane is the only steerable surface so far — show its wheel bar.
        let is_lane = NAV.get(active).map(|n| n.id == "lane").unwrap_or(false);
        let control_flash = self.control_flash.clone();

        div()
            .key_context("console")
            .track_focus(&self.focus_handle)
            .size_full()
            .bg(rgb(C_BG))
            .flex()
            .flex_col()
            .font_family("General Sans")
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _window, cx| {
                let idx = NAV.iter().position(|n| n.key == ev.keystroke.key.as_str());
                if let Some(i) = idx {
                    this.active_nav = i;
                    cx.notify();
                }
            }))
            // Body
            .child(
                div()
                    .flex()
                    .flex_1()
                    .overflow_hidden()
                    // ── Sidebar ──
                    .child(
                        div()
                            .w(px(96.0))
                            .h_full()
                            .bg(rgb(C_PANEL))
                            .flex()
                            .flex_col()
                            .py(px(8.0))
                            // Logo — SVG glyph (animated monogram + radar ring)
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .px(px(8.0))
                                    .py(px(10.0))
                                    .mb(px(2.0))
                                    .border_b_1()
                                    .border_color(rgb(C_BORDER))
                                    .child(
                                        svg()
                                            .path("icons/pd-glyph.svg")
                                            .w(px(32.0))
                                            .h(px(32.0))
                                            .text_color(rgb(C_ACCENT))
                                    )
                            )
                            // Nav items — clickable (sets active_nav) AND driven by
                            // the key handler above. Each is an id'd interactive div
                            // so the whole row is a hit target, not just decoration.
                            .children(
                                NAV.iter().enumerate().map(|(i, item)| {
                                    div()
                                        .id(item.id)
                                        .on_click(cx.listener(move |this, _ev, _window, cx| {
                                            this.active_nav = i;
                                            cx.notify();
                                        }))
                                        .child(SidebarItem {
                                            icon: item.icon,
                                            label: item.label,
                                            index: i,
                                            active: i == active,
                                        })
                                })
                            )
                    )
                    // ── Divider ──
                    .child(div().w(px(1.0)).bg(rgb(C_BORDER)))
                    // ── Main content ──
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .overflow_hidden()
                            // Pane header
                            .child(
                                div()
                                    .px(px(16.0))
                                    .py(px(10.0))
                                    .border_b_1()
                                    .border_color(rgb(C_BORDER))
                                    .flex()
                                    .items_center()
                                    .gap(px(10.0))
                                    .child(
                                        svg()
                                            .path(active_nav_icon)
                                            .w(px(16.0))
                                            .h(px(16.0))
                                            .text_color(rgb(C_ACCENT))
                                    )
                                    .child(
                                        div()
                                            .text_color(rgb(C_INK))
                                            .text_size(px(15.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(active_nav_name)
                                    )
                            )
                            // Pane blocks
                            .child(
                                div()
                                    .flex_1()
                                    .overflow_hidden()
                                    .flex()
                                    .flex_col()
                                    .children(blocks.into_iter().map(render_block))
                            )
                            // ── Steering bar (Lane only) — "grab the wheel" ──
                            .when(is_lane, |content| {
                                content.child(
                                    div()
                                        .px(px(16.0))
                                        .py(px(8.0))
                                        .border_t_1()
                                        .border_color(rgb(C_BORDER))
                                        .flex()
                                        .items_center()
                                        .gap(px(10.0))
                                        // Interrupt button — POSTs /agents/:id/interrupt
                                        // via the background thread; the control message
                                        // returns on the stream (closed loop).
                                        .child(
                                            div()
                                                .id("lane-interrupt")
                                                .px(px(14.0))
                                                .py(px(6.0))
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
                    )
            )
            // ── Status bar ──
            .child(
                div()
                    .h(px(24.0))
                    .px(px(16.0))
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .bg(rgb(C_PANEL))
                    .border_t_1()
                    .border_color(rgb(C_BORDER))
                    .child(
                        div()
                            .text_color(rgb(C_MUTED))
                            .text_size(px(13.0))
                            .font_family("IBM Plex Mono")
                            .child(format!("daemon  {daemon_url}"))
                    )
                    .child(div().text_color(rgb(C_MUTED)).text_size(px(13.0)).child("·"))
                    .child(
                        div()
                            .text_color(rgb(C_MUTED))
                            .text_size(px(13.0))
                            .child("pd-console v0.2.0")
                    )
            )
    }
}
