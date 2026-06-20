I have everything I need. Both themes' exact tokens are in the mock's `:root`/`[data-theme='light']`/`[data-theme='dark']` blocks. Here is the concrete gpui-0.2.2 Rust for the theme slice.

---

## 1. New file: `core/pd-console/src/theme.rs`

A `Theme` struct holding every color role the render uses, two const palettes matched 1:1 to the v12 mock tokens, a `ThemeMode` enum, and the tone accessor. All values are sRGB `u32` (consumed by gpui's `rgb()` at render time — `rgba()` for the few alpha cases).

```rust
//! pd-console theme — light + dark palettes matched to the maritime + neobrutalism
//! token system (design/tokens/*.json → the v12 synthesis mock's :root vars).
//!
//! Brand is mustard-amber #FFDB33 (--accent). Alert is crimson — #C41E30 in light,
//! #F26475 in dark (--gated). NEVER cinnabar #CC3D2E / brass #B08D57 / patina
//! #5C7A6A — scripts/check-brand-colors.mjs fails CI on those.
//!
//! Every color the renderer reads lives here as a *role*. app.rs calls
//! `self.theme().<role>()` instead of a hardcoded `C_*` const, so flipping
//! `ThemeMode` re-skins the whole console on the next `cx.notify()`.

use crate::pane::Tone;
use gpui::{rgb, rgba, Rgba};

/// Which palette is live. Flipped by the leader command `Ctrl-A g`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

impl ThemeMode {
    /// Toggle for the leader key.
    pub fn toggled(self) -> Self {
        match self {
            ThemeMode::Light => ThemeMode::Dark,
            ThemeMode::Dark => ThemeMode::Light,
        }
    }
    /// Short label for the status bar (`◐ dark` / `◐ light`).
    pub fn label(self) -> &'static str {
        match self {
            ThemeMode::Light => "light",
            ThemeMode::Dark => "dark",
        }
    }
}

/// A complete palette. Every field is one render role; values are sRGB 0xRRGGBB.
/// Roles map 1:1 onto the mock's CSS custom properties (named in each comment).
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    pub mode: ThemeMode,

    // ── surfaces ──
    pub bg: u32,        // --bg     page
    pub panel: u32,     // --panel  surface
    pub raised: u32,    // --raised hover lift / elevated
    pub sunken: u32,    // --sunken chrome / footers / inset

    // ── ink ──
    pub ink: u32,       // --ink    headings / strong body
    pub ink2: u32,      // --ink2   body
    pub muted: u32,     // --muted  subtle / meta

    // ── borders ──
    pub line: u32,      // --line   muted divider
    pub line2: u32,     // --line2  neobrutalist hard edge

    // ── brand + accent-as-text ──
    pub accent: u32,     // --accent     mustard fills/dots/glows
    pub accent_ink: u32, // --accent-ink accent-as-text (darkened in light for AAA)

    // ── status (carry meaning only) ──
    pub engaged: u32,   // --engaged busy/working amber
    pub gated: u32,     // --gated   attention crimson (NEVER cinnabar)
    pub landed: u32,    // --landed  success green
    pub resting: u32,   // --resting idle slate
    pub conflict: u32,  // --conflict (== gated)
    pub mayday: u32,    // --mayday  severity
    pub cobalt: u32,    // --cobalt  signal-blue / info

    // ── ICS maritime signal flags ──
    pub flag_charlie: u32,  // --flag-charlie
    pub flag_kilo: u32,     // --flag-kilo
    pub flag_uniform: u32,  // --flag-uniform
    pub flag_november: u32, // --flag-november
    pub flag_lima: u32,     // --flag-lima
}

/// LIGHT palette — warm paper, mustard brand, crimson alert (#C41E30).
/// Source: mock `:root, [data-theme='light']`.
const LIGHT: Theme = Theme {
    mode: ThemeMode::Light,
    bg: 0xf5f5f0,
    panel: 0xffffff,
    raised: 0xfff9e0,
    sunken: 0xf0eddf,
    ink: 0x1e1b18,
    ink2: 0x2b2a26,
    muted: 0x3f3d38,
    line: 0xd4c5a9,
    line2: 0x1e1b18,
    accent: 0xffdb33,
    accent_ink: 0x8a5a00,
    engaged: 0xb8860b,
    gated: 0xc41e30,
    landed: 0x15803d,
    resting: 0x6b6457,
    conflict: 0xc41e30,
    mayday: 0x8b1622,
    cobalt: 0x003f7f,
    flag_charlie: 0x15803d,
    flag_kilo: 0x003f7f,
    flag_uniform: 0xb8860b,
    flag_november: 0xc41e30,
    flag_lima: 0x3f3d38,
};

/// DARK palette — warm ebony, mustard brand, crimson alert (#F26475).
/// Source: mock `[data-theme='dark']`.
const DARK: Theme = Theme {
    mode: ThemeMode::Dark,
    bg: 0x1e1b18,
    panel: 0x2b2724,
    raised: 0x3a342d,
    sunken: 0x100e0c,
    ink: 0xf5f5f0,
    ink2: 0xd1d1c7,
    muted: 0xb5b5a8,
    line: 0x504b46,
    line2: 0xf5f5f0,
    accent: 0xffdb33,
    accent_ink: 0xffdb33,
    engaged: 0xf59e0b,
    gated: 0xf26475,
    landed: 0x6dd3a8,
    resting: 0x8a8378,
    conflict: 0xf26475,
    mayday: 0x8b1622,
    cobalt: 0x7fc4ff,
    flag_charlie: 0x6dd3a8,
    flag_kilo: 0x1e3a8a,
    flag_uniform: 0xedc531,
    flag_november: 0xf26475,
    flag_lima: 0xb5b5a8,
};

impl Theme {
    /// The palette for a given mode.
    pub fn for_mode(mode: ThemeMode) -> Theme {
        match mode {
            ThemeMode::Light => LIGHT,
            ThemeMode::Dark => DARK,
        }
    }

    /// Status color for a pane `Tone`. Replaces the old free `tone_rgb`.
    pub fn tone(&self, tone: &Tone) -> u32 {
        match tone {
            Tone::Default => self.ink2,
            Tone::Accent => self.accent_ink, // accent-AS-TEXT, AAA in light
            Tone::Engaged => self.engaged,
            Tone::Gated => self.gated,
            Tone::Resting => self.resting,
            Tone::Landed => self.landed,
            Tone::Conflicted => self.conflict,
        }
    }

    // ── Premixed translucent fills (the mock's rgba(...) hover washes). gpui's
    //    rgba() takes 0xRRGGBBAA. Derived from the role color + an alpha byte so
    //    they track the active theme instead of being hardcoded per-mode. ──

    /// Faint accent wash — surface-palette hover glow background.
    pub fn accent_wash(&self) -> Rgba {
        rgba((self.accent << 8) | 0x1f) // ~12% alpha
    }
    /// Faint gated wash — destructive control hover (close, deny).
    pub fn gated_wash(&self) -> Rgba {
        rgba((self.gated << 8) | 0x24) // ~14% alpha
    }
    /// Faint landed wash — approve hover.
    pub fn landed_wash(&self) -> Rgba {
        rgba((self.landed << 8) | 0x1f)
    }
}
```

Two gpui-0.2.2 notes the integrator must keep:
- `rgb(u32)` takes `0xRRGGBB`; `rgba(u32)` takes `0xRRGGBBAA`. The `<< 8 | alpha` trick builds the 8-digit form from a 6-digit role + an alpha byte, so washes follow the theme. Both return `Rgba`, which every `.bg(..)` / `.text_color(..)` / `.border_color(..)` accepts.
- `Theme` is `Copy` (all `u32`/enum fields), so handing a snapshot to a closure is a cheap move, not a borrow of `self`.

---

## 2. `app.rs` wiring

### 2a. Imports + delete the old palette block

Add to the existing `use` cluster near the top:

```rust
use crate::theme::{Theme, ThemeMode};
```

And in `src/lib.rs` (or wherever modules are declared) add `mod theme;` alongside `mod mux;` / `mod pane;`.

**Delete** the entire `// ── Palette ──` block (the `const C_BG … C_BORDER` lines, current 103–116) and the free `fn tone_rgb` (118–128). Both are replaced by `Theme`.

### 2b. Add `theme_mode` to `ConsoleView`

```rust
pub struct ConsoleView {
    tabs: Vec<Tab>,
    active_tab: usize,
    leader_armed: bool,
    command: Option<CommandLine>,
    pane_blocks: Vec<Vec<Block>>,
    daemon_url: String,
    focus_handle: FocusHandle,
    control_tx: Option<mpsc::Sender<ControlMsg>>,
    control_flash: Option<String>,
    /// Active palette. Flipped by `Ctrl-A g`; re-skins on next `cx.notify()`.
    theme_mode: ThemeMode,
}
```

Initialize it in `with_control` (default to dark, the shipped look):

```rust
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
            theme_mode: ThemeMode::Dark,
        }
```

Add the accessor next to `ws()` / `ws_mut()`:

```rust
    /// The live palette snapshot. `Copy`, so callers can move it into closures.
    fn theme(&self) -> Theme {
        Theme::for_mode(self.theme_mode)
    }
```

### 2c. The leader toggle — `Ctrl-A g`

In `leader_command`, add a `"g"` arm. Put it before the catch-all `other =>` (a nav item with `key == "g"` would otherwise shadow it; none exists today, but order makes intent explicit):

```rust
            // Flip the palette (light ⇄ dark). Re-skins the whole console.
            "g" => { self.theme_mode = self.theme_mode.toggled(); }
```

The trailing `cx.notify()` already in `leader_command` re-renders with the new palette. Update the PREFIX help string (line ~906) to advertise it — append `· g theme`.

### 2d. Thread `Theme` through the render methods

`render_block` and `pane_ctrl` are free functions; give them a `&Theme` (it's `Copy`, pass by value or ref — ref is fine and avoids churn). `render_node` / `render_leaf` are methods, so they read `self.theme()`.

**`render_block`** — new signature and every `C_*` → `theme.<role>`:

```rust
fn render_block(block: Block, theme: &Theme) -> impl IntoElement {
    match block {
        Block::Header(text) => div()
            .px(px(16.0)).pt(px(12.0)).pb(px(6.0))
            .text_color(rgb(theme.accent_ink))   // was C_ACCENT
            .text_size(px(15.0))
            .font_weight(FontWeight::SEMIBOLD)
            .child(text)
            .into_any_element(),
        Block::KeyVal(key, val) => div()
            .flex().gap(px(8.0)).px(px(16.0)).py(px(3.0))
            .child(div()
                .text_color(rgb(theme.muted))     // was C_MUTED
                .text_size(px(14.0)).w(px(150.0)).flex_shrink_0()
                .child(key))
            .child(div()
                .text_color(rgb(theme.ink))        // was C_INK
                .text_size(px(14.0)).font_family("IBM Plex Mono")
                .child(val))
            .into_any_element(),
        Block::Row(cells) => div()
            .flex().gap(px(16.0)).px(px(16.0)).py(px(4.0))
            .hover(|s| s.bg(rgb(theme.raised)))    // was C_RAISED
            .children(cells.into_iter().enumerate().map(|(i, cell)| {
                div()
                    .text_color(rgb(if i == 0 { theme.accent_ink } else { theme.ink2 }))
                    .text_size(px(14.0)).font_family("IBM Plex Mono").flex_shrink_0()
                    .child(cell)
            }))
            .into_any_element(),
        Block::Chip { label, tone } => {
            let color = rgb(theme.tone(&tone));    // was tone_rgb(&tone)
            div()
                .mx(px(16.0)).mt(px(4.0)).mb(px(8.0)).px(px(10.0)).py(px(3.0))
                .rounded_full().border_1()
                .border_color(color).text_color(color)
                .text_size(px(13.0)).child(label)
                .into_any_element()
        }
        Block::Spark(_) => div()
            .px(px(16.0)).py(px(4.0))
            .text_color(rgb(theme.muted))
            .text_size(px(13.0)).child("▁▂▃▄▅▆▇")
            .into_any_element(),
        Block::Gap => div().h(px(8.0)).into_any_element(),
    }
}
```

The only behavioral change: `Block::Header` and `Row` cell-0 now use `accent_ink` (accent-as-text) rather than the raw mustard fill. In dark, `accent_ink == accent` (both `#FFDB33`) so it's identical to today; in light, `#FFDB33` text on white paper is unreadable, so the mock's `accent_ink == #8A5A00` is what keeps headers AAA. This is the single most important correctness point of the slice.

**Call site** in `render_leaf` (the body `.children(...)`), capture the theme once and move it into the map closure:

```rust
        let theme = self.theme();
        // ...
            .child(
                div().flex_1().overflow_hidden().flex().flex_col()
                    .children(blocks.into_iter().map(move |b| render_block(b, &theme))),
            )
```

**`pane_ctrl`** — add a `theme: Theme` param (Copy, so move it into the `on_click` listener too). The caller already passes a `color: u32`; keep that, but resolve hover from the theme:

```rust
fn pane_ctrl(
    id: PaneId,
    kind: &'static str,
    glyph: &'static str,
    color: u32,
    theme: Theme,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    div()
        .id(SharedString::from(format!("ctrl-{kind}-{id}")))
        .px(px(5.0)).py(px(1.0)).rounded(px(4.0))
        .text_size(px(13.0)).text_color(rgb(color)).cursor_pointer()
        // close hovers crimson-wash; the rest lift to raised.
        .hover(move |s| if kind == "close" {
            s.bg(theme.gated_wash()).text_color(rgb(theme.gated))
        } else {
            s.bg(rgb(theme.raised))
        })
        .child(glyph)
        .on_click(cx.listener(move |this, _ev, _window, cx| {
            // …unchanged match on `kind`…
            cx.notify();
        }))
}
```

### 2e. `render_leaf` — replace its `C_*` reads

At the top of `render_leaf`, snapshot the theme and recompute the local color vars:

```rust
        let theme = self.theme();
        let label = surface.label();
        let blocks = self.blocks_for_surface(surface);
        let is_agent = matches!(surface, SurfaceKind::AgentTranscript { .. });
        let border = if is_focused { theme.accent } else { theme.line };
        let title_color = if is_focused { theme.accent_ink } else { theme.muted };
        let control_flash = self.control_flash.clone();
```

Then mechanically swap the rest of the method:
- pane outer `.border_color(rgb(border))` (already a var) · `.bg(rgb(theme.panel))`
- title bar `.bg(rgb(if is_focused { theme.raised } else { theme.panel }))` · `.border_color(rgb(theme.line))`
- focus dot `.text_color(rgb(if is_focused { theme.accent } else { theme.line }))` (the mustard dot stays a *fill*-color glyph; `accent` not `accent_ink`)
- label `.text_color(rgb(title_color))`
- hover controls: pass `theme` into each `pane_ctrl(...)` and use theme colors for the per-control tints:
  ```rust
  .child(pane_ctrl(id, "vsplit", "│", theme.muted, theme, cx))
  .child(pane_ctrl(id, "hsplit", "─", theme.muted, theme, cx))
  .child(pane_ctrl(id, "zoom",   "□", theme.muted, theme, cx))
  .child(pane_ctrl(id, "close",  "✕", theme.gated, theme, cx))
  ```
- steering bar (`when(is_agent && is_focused …)`): `.border_color(rgb(theme.line))`; the Interrupt button `.border_color(rgb(theme.gated))` · `.text_color(rgb(theme.gated))` · hover `.hover(move |s| s.bg(theme.gated_wash()))`; flash text `.text_color(rgb(theme.muted))`.

### 2f. `render()` — replace its `C_*` reads

At the top of `render`, after the existing locals:

```rust
        let theme = self.theme();
```

Swap throughout:
- root `.bg(rgb(theme.bg))`
- tab bar `.bg(rgb(theme.sunken))` (mock uses `--sunken` for the tab strip, not panel) · `.border_color(rgb(theme.line))`
- each tab `.text_color(rgb(if active { theme.accent_ink } else { theme.muted }))` · active `.when(active, |s| s.bg(rgb(theme.raised)))` · `.hover(|s| s.bg(rgb(theme.raised)))`
- `+` new-tab `.text_color(rgb(theme.muted))` · hover `.hover(move |s| s.bg(rgb(theme.raised)).text_color(rgb(theme.accent_ink)))`
- command/status bar `.bg(rgb(if lit { theme.raised } else { theme.panel }))` · `.border_color(rgb(if lit { theme.accent } else { theme.line }))`
- command-line prompt `.text_color(rgb(theme.accent_ink))`, buffer `.text_color(rgb(theme.ink))`, hint `.text_color(rgb(theme.muted))`
- armed PREFIX line `.text_color(rgb(theme.accent_ink))`
- idle status line `.text_color(rgb(theme.muted))` and append the theme to the text: `… · pd-console v0.3.0 · {} theme", …, theme.mode.label())`

One borrow note for gpui-0.2.2: closures passed to `.hover(...)` / `cx.listener(...)` that read `theme` must `move` (it's `Copy`, so the outer `theme` stays usable). Where a closure also needs `theme` *and* the listener mutates `this`, capture `theme` by copy before the `cx.listener` call — don't reach through `self` inside the listener, since `self` there is the fresh `&mut ConsoleView` (`this`), and `this.theme()` is also valid if you prefer recomputing.

---

## 3. The `g` keybinding is already routed

No change to `on_key_down` is needed — `Ctrl-A` arms `leader_armed`, the next key dispatches through `leader_command`, and the new `"g"` arm flips `theme_mode`. The existing trailing `cx.notify()` re-renders. That's the whole runtime toggle.

---

## Summary of what changes

- **New** `core/pd-console/src/theme.rs` — `Theme` struct (every render role), `LIGHT`/`DARK` const palettes matched 1:1 to the v12 mock tokens, `ThemeMode` enum with `toggled()`/`label()`, `tone()` accessor (replaces `tone_rgb`), and theme-tracking translucent washes via `rgba`.
- **`app.rs`**: delete `const C_*` block + `tone_rgb`; add `theme_mode: ThemeMode` (default `Dark`) to `ConsoleView` + `fn theme()`; add `"g"` arm in `leader_command`; thread `&Theme`/`Theme` into `render_block` and `pane_ctrl`; replace every `C_*` read in `render_node`/`render_leaf`/`render` with `theme.<role>`.
- **`lib.rs`**: `mod theme;`.

Key correctness points: `accent` (mustard fill, for dots/focus rings/borders) vs `accent_ink` (accent-as-text, `#8A5A00` in light for AAA on paper, `#FFDB33` in dark) are distinct roles — headers, tab labels, prompts, and Row cell-0 use `accent_ink`; dots/focus borders use `accent`. Alert is `gated` = `#C41E30` light / `#F26475` dark, never cinnabar. All body/caption text stays ≥13px (eyebrows) / ≥14px (body), unchanged from the existing sizes.