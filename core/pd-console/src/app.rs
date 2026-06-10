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

// ── Nav items ────────────────────────────────────────────────────────────────

struct NavItem {
    id: &'static str,
    label: &'static str,
    glyph: &'static str,
    key: &'static str,
}

const NAV: &[NavItem] = &[
    NavItem { id: "fleet",    label: "Fleet",    glyph: "⚓", key: "1" },
    NavItem { id: "cockpit",  label: "Cockpit",  glyph: "🧭", key: "2" },
    NavItem { id: "sorties",  label: "Sorties",  glyph: "🚀", key: "3" },
    NavItem { id: "claims",   label: "Claims",   glyph: "📌", key: "4" },
    NavItem { id: "peek",     label: "Peek",     glyph: "👁", key: "5" },
    NavItem { id: "roadmap",  label: "Roadmap",  glyph: "🗺", key: "6" },
    NavItem { id: "adrs",     label: "ADRs",     glyph: "📐", key: "7" },
    NavItem { id: "activity", label: "Activity", glyph: "📡", key: "8" },
    NavItem { id: "sessions", label: "Sessions", glyph: "🪝", key: "9" },
    NavItem { id: "inbox",    label: "Inbox",    glyph: "📬", key: "0" },
    NavItem { id: "suggest",  label: "Suggest",  glyph: "🧲", key: "s" },
    NavItem { id: "memory",   label: "Memory",   glyph: "🧠", key: "m" },
    NavItem { id: "prs",      label: "PRs",      glyph: "🔀", key: "p" },
    NavItem { id: "health",   label: "Health",   glyph: "🩺", key: "h" },
    NavItem { id: "coast",    label: "C.Guard",  glyph: "🛡", key: "c" },
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
    glyph: &'static str,
    label: &'static str,
    index: usize,
    active: bool,
}

impl RenderOnce for SidebarItem {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
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
            .gap(px(1.0))
            .child(
                div()
                    .text_size(px(16.0))
                    .child(self.glyph)
            )
            .child(
                div()
                    .text_color(rgb(if self.active { C_INK } else { C_MUTED }))
                    .text_size(px(11.0))
                    .child(self.label)
            )
    }
}

// ── Main console view ─────────────────────────────────────────────────────────

pub struct ConsoleView {
    pub active_nav: usize,
    fleet_blocks: Vec<Block>,
    daemon_url: String,
}

impl ConsoleView {
    pub fn new(daemon_url: String) -> Self {
        Self {
            active_nav: 0,
            fleet_blocks: vec![
                Block::Header("Fleet Roster".into()),
                Block::KeyVal(
                    "status".into(),
                    format!("connecting to daemon at {}…", daemon_url),
                ),
            ],
            daemon_url,
        }
    }

    /// Push fresh fleet data from the background refresh loop.
    pub fn update_fleet(&mut self, blocks: Vec<Block>) {
        self.fleet_blocks = blocks;
    }

    fn blocks_for_active(&self) -> Vec<Block> {
        match self.active_nav {
            0 => self.fleet_blocks.clone(),
            i => {
                let label = NAV.get(i).map(|n| n.label).unwrap_or("—");
                vec![
                    Block::Header(label.into()),
                    Block::KeyVal("status".into(), "panel not yet implemented".into()),
                ]
            }
        }
    }
}

impl Render for ConsoleView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.active_nav;
        let blocks = self.blocks_for_active();
        let daemon_url = self.daemon_url.clone();
        let active_nav_name = NAV.get(active)
            .map(|n| format!("{} {}", n.glyph, n.label))
            .unwrap_or_default();

        div()
            .key_context("console")
            .track_focus(&cx.focus_handle())
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
                            // Nav items — no closures; key handler above drives nav
                            .children(
                                NAV.iter().enumerate().map(|(i, item)| {
                                    SidebarItem {
                                        glyph: item.glyph,
                                        label: item.label,
                                        index: i,
                                        active: i == active,
                                    }
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
