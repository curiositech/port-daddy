---
name: gpui-rust-console
version: 0.1.0
description: >
  Build beautiful, production-quality native macOS console apps with GPUI 0.2.x
  (Zed's GPU-accelerated Rust UI). Covers rendering patterns, layout, scrollable
  lists, keyboard nav, tooltips, animations, async threading, and the specific
  idioms needed for pd-console.
author: port-daddy
tags: [gpui, rust, ui, native, macos, console]
pairs-with:
  - daemon-development
  - git-best-practices
---

# GPUI Rust Console Skill

## When to invoke

Use this skill when:
- Building or extending `core/pd-console/` (GPUI-based native macOS operator console)
- Adding panes, panels, interactive elements, or visual polish to a GPUI app
- Debugging GPUI rendering, layout, focus, or event-handling issues
- Choosing between GPUI architecture patterns (Entity vs struct, uniform_list vs list, etc.)

---

## Core Architecture: pd-console

```
main.rs          — Application entry, FsAssets, window + two-thread refresh pipeline
app.rs           — ConsoleView (Render impl), NAV items, palette constants, block renderer
agent.rs         — DaemonClient (HTTP via reqwest/tokio), discover() resolver
fleet_pane.rs    — Fleet data + Pane impl
maritime.rs      — ICS flag colors + FlagBadge
theme.rs         — OKLCH theme constants
pane.rs          — Block enum + Pane trait
dispatch_pane.rs — Dispatch panel
```

**Threading model:** reqwest/tokio CANNOT run in GPUI's smol executor. Pattern:

```rust
// Producer: std thread + tokio mini-runtime
let (tx, rx) = mpsc::channel::<Vec<Block>>();
std::thread::spawn(move || {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all().build().expect("tokio rt");
    rt.block_on(async move {
        let client = DaemonClient::new(url);
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if tx.send(data).is_err() { break; }
        }
    });
});

// Consumer: GPUI foreground executor (smol, safe on main thread)
let bg = cx.background_executor().clone();
let async_cx = cx.to_async();
cx.foreground_executor().spawn(async move {
    loop {
        bg.timer(Duration::from_millis(500)).await;
        while let Ok(blocks) = rx.try_recv() {
            let _ = async_cx.update(|app| {
                let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                    view.update_fleet(blocks.clone());
                    cx.notify();
                });
            });
        }
    }
}).detach();
```

---

## Render vs RenderOnce

- `Render` (mutable): stateful views with lifecycle, holds `cx.focus_handle()`, responds to events. Most panes.
- `RenderOnce` (immutable): pure presentation, called once per render cycle. `SidebarItem`, row cells, chips.

```rust
#[derive(IntoElement)]
struct SidebarItem { active: bool, label: &'static str, glyph: &'static str }

impl RenderOnce for SidebarItem {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .px(px(10.0)).py(px(6.0)).rounded(px(6.0)).cursor_pointer()
            .when(self.active, |s| s.bg(rgb(C_RAISED)).border_l_2().border_color(rgb(C_ACCENT)))
            .hover(|s| s.bg(rgb(C_RAISED)))
            .child(div().text_size(px(16.0)).child(self.glyph))
            .child(div().text_color(rgb(if self.active { C_INK } else { C_MUTED })).text_size(px(11.0)).child(self.label))
    }
}
```

---

## Layout System (Taffy flexbox)

| Method | CSS equiv |
|--------|-----------|
| `.flex()` / `.flex_1()` | flex container; flex-grow: 1 |
| `.flex_col()` | flex-direction: column |
| `.gap(px(8.0))` | gap: 8px |
| `.overflow_hidden()` | clip children; REQUIRED for scrollable panes |
| `.overflow_y_scroll()` | enable vertical scroll + scrollbar |
| `.w(px(96.0))`, `.h(px(24.0))` | fixed dimensions |
| `.size_full()` | width: 100%; height: 100% |
| `.border_l_2()`, `.border_b_1()` | border sides |

**Three-panel layout skeleton (sidebar + divider + main):**

```rust
div().flex().flex_1().overflow_hidden()
    // Sidebar
    .child(div().w(px(96.0)).h_full().bg(rgb(C_PANEL)).flex().flex_col()
        .children(nav_items))
    // Divider
    .child(div().w(px(1.0)).bg(rgb(C_BORDER)))
    // Main (header + scrollable body)
    .child(div().flex_1().flex().flex_col()
        .child(div().px(px(16.0)).py(px(10.0)).border_b_1().border_color(rgb(C_BORDER))
            .child("Pane Header"))
        .child(div().flex_1().overflow_hidden().child(content)))
```

---

## Scrollable Lists

**UniformList** (same-height rows — use for agent/fleet tables):

```rust
use gpui::uniform_list;

uniform_list(
    cx,                 // &mut Context<Self>
    "agents-list",      // unique id string
    self.agents.len(),
    |this, range, _, cx| {
        this.agents[range.clone()]
            .iter()
            .map(|a| render_agent_row(a))
            .collect()
    },
)
.track_scroll(&self.scroll_handle)  // optional: programmatic scroll
```

**List** (variable heights — use when mixing headers, gaps, chips):

```rust
use gpui::{list, ListState};

let state = ListState::new(items.len(), ListAlignment::Top, px(16.0), {
    let items = items.clone();
    move |ix, _, _| items[ix].render().into_any_element()
});
list(state).size_full()
```

---

## Hover, Focus, Active States

```rust
div()
    .hover(|s| s.bg(rgb(C_RAISED)).cursor_pointer())
    .active(|s| s.bg(rgb(C_ENGAGED)))
    .focus(|s| s.border_l_2().border_color(rgb(C_ACCENT)))

// Conditional styling
.when(is_selected, |s| s.bg(rgb(C_RAISED)).text_color(rgb(C_ACCENT)))
.when(!is_selected, |s| s.text_color(rgb(C_INK2)))
```

**FocusHandle** (for keyboard-focusable views):

```rust
pub struct MyPane {
    focus_handle: FocusHandle,
}
impl MyPane {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self { focus_handle: cx.focus_handle() }
    }
}
impl Render for MyPane {
    fn render(&mut self, _, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .track_focus(&self.focus_handle)
            .key_context("my-pane")
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
                // handle keys
                cx.notify();
            }))
    }
}
```

---

## Keyboard Navigation

```rust
.on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
    match ev.keystroke.key.as_str() {
        "ArrowDown" => this.selected = (this.selected + 1).min(this.items.len() - 1),
        "ArrowUp"   => this.selected = this.selected.saturating_sub(1),
        "Enter"     => this.activate_selected(),
        "Escape"    => this.dismiss(),
        _           => return,
    }
    cx.notify();
}))
```

**Key strings:** `"ArrowUp"`, `"ArrowDown"`, `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"`, `"0"`–`"9"`, `"a"`–`"z"`, `"cmd-s"`, `"ctrl-shift-p"`, `"shift-ArrowUp"`

---

## Tooltips

```rust
div()
    .tooltip(|_, _| {
        div()
            .bg(rgb(0x2a2825))
            .text_color(rgb(0xd4cfc7))
            .px(px(8.0)).py(px(4.0))
            .rounded(px(4.0))
            .text_size(px(13.0))
            .child("ICS Kilo — desire to communicate")
            .into_any_view()
    })
```

---

## Animations

```rust
use gpui::Animation;
use std::time::Duration;

div()
    .with_animation(
        "fade-in",
        Animation::new(Duration::from_millis(200)),
        |el, delta| el.opacity(delta),  // delta: 0.0 → 1.0
    )
```

**Easing:** `linear`, `quadratic`, `ease_in_out`, `ease_out_quint`, `bounce(easing)`

---

## Asset Loading (SVG icons)

```rust
struct FsAssets { base: std::path::PathBuf }
impl FsAssets {
    fn locate() -> Self {
        Self { base: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets") }
    }
}
impl AssetSource for FsAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match std::fs::read(self.base.join(path)) {
            Ok(b) => Ok(Some(Cow::Owned(b))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(std::fs::read_dir(self.base.join(path))
            .map(|rd| rd.filter_map(|e| e.ok().and_then(|e| e.file_name().into_string().ok()).map(SharedString::from)).collect())
            .unwrap_or_default())
    }
}

// Usage in main():
Application::new().with_assets(FsAssets::locate()).run(|cx| {
    // ...
    svg().path("icons/pd-glyph.svg").w(px(32.0)).h(px(32.0)).text_color(rgb(C_ACCENT))
});
```

---

## pd-console Palette (OKLCH dark theme)

```rust
const C_BG:     u32 = 0x1a1917;  // deep charcoal
const C_PANEL:  u32 = 0x1f1e1b;
const C_RAISED: u32 = 0x252420;  // hover surface
const C_INK:    u32 = 0xf2f0eb;  // primary text
const C_INK2:   u32 = 0xd4cfc7;  // secondary text
const C_MUTED:  u32 = 0xa09a90;  // metadata
const C_ACCENT: u32 = 0xe3b56d;  // amber — active/header
const C_ENGAGED:u32 = 0x6b8fd4;  // blue — running agents
const C_GATED:  u32 = 0xd4736b;  // warm red — blocked/error
const C_LANDED: u32 = 0x6bd4a0;  // green — done/healthy
const C_BORDER: u32 = 0x2e2c28;  // dividers
```

Typography: `"General Sans"` for UI chrome, `"IBM Plex Mono"` for code/values.

---

## Performance Anti-patterns

| Anti-pattern | Fix |
|---|---|
| `cx.notify()` every frame | Only call on meaningful state change |
| Cloning `Vec<T>` in render | Use `Rc<T>` or lazy views |
| `Entity<T>` for pure display | Use `RenderOnce` struct instead |
| Rendering 1000+ items flat | Use `uniform_list` (virtual scroll) |
| `overflow_scroll` without height constraint | Always wrap in bounded parent |
| Hardcoded colors inline | Pre-compute palette as `const u32` |

---

## Guard: No Hardcoded Port/URL

`core/` paths are enforced by `tests/unit/no-hardcoded-daemon-url.test.js` and `no-hardcoded-daemon-port.test.js`.

- `9876` may only appear in `agent.rs` (the Rust resolver, allowlisted)
- `http://127.0.0.1:9876` same
- Doc comments (ASCII art, JSDoc examples) with the literal WILL be caught — use `<resolved-url>` placeholder instead
- `tui-mocks.html` and similar design docs in `docs/` are scanned via the merge commit — fix cinnabar before it lands in main

---

## Text Input (No Built-in Widget)

GPUI 0.2.x does NOT ship a text input widget. Options:

1. **Build minimal input (~300 LOC):** implement `Element` trait, track cursor/selection as byte indices, use `TextLayout` for glyph measurement, handle `KeyDownEvent` + `MouseDownEvent`
2. **Command palette overlay:** stateless display pane + full-screen text-entry overlay when `/` pressed
3. **Defer:** for v1 console, use keyboard-only nav with no text input required

For `pd tube` cockpit pane, the overlay pattern is recommended — user presses Enter to open input, types, Enter to send.

---

## CI Requirements

- `cargo check` must pass
- `cargo test --bin pd-console-repl` with `RUST_MIN_STACK=16777216` (GPUI proc-macros overflow Linux rustc stack)
- No `9876` or `http://127.0.0.1:9876` literals in `core/` source (except `agent.rs` allowlist)
- Brand colors: no retired Harbor Heritage cinnabar red anywhere in tracked files (see website-v2/docs/design/BRAND.md)
