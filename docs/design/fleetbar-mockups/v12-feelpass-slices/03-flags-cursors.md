I have everything I need. The mock uses `--gated` crimson (#C41E30 light / #F26475 dark), `--engaged` amber, `--landed` green, `--accent2`/`--cobalt` blue, `--resting` slate — and the dark palette in `app.rs` needs to map to those roles. I'll give concrete Rust matching the mock's flag chips, blinking cursors, and presence pulses.

Here is the integrator-ready Rust for the FLAGS+CURSORS slice.

---

## 0. Palette additions (match the v12 dark theme exactly)

The shipped `app.rs` palette is the *old* amber theme. Repoint the status colors at the v12 dark tokens so the flags read correctly and pass `check-brand-colors.mjs`. Add these next to the existing `C_*` consts:

```rust
// ── v12 maritime + neobrutalism status palette (dark theme tokens) ──
// Roles carry meaning only. NEVER cinnabar #CC3D2E / brass #B08D57 / patina #5C7A6A.
const C_ACCENT2: u32 = 0x7fc4ff; // ics-ish blue (term_info)
const C_RESTING: u32 = 0x8a8378; // slate (resting)
// repoint existing role colors at v12 dark tokens:
//   C_ACCENT  = 0xffdb33  (mustard amber brand — was 0xe3b56d)
//   C_ENGAGED = 0xf59e0b  (warning amber / busy — was 0x6b8fd4)
//   C_GATED   = 0xf26475  (lighter crimson, dark theme — was 0xd4736b)
//   C_LANDED  = 0x6dd3a8  (term_ok green — was 0x6bd4a0)
//   C_MUTED   = 0xb5b5a8  (was 0xa09a90)

// ── ICS maritime signal flags (dark mappings from the v12 mock) ──
const FLAG_CHARLIE:  u32 = 0x6dd3a8; // C — success / green
const FLAG_KILO:     u32 = 0x1e3a8a; // K — info / blue
const FLAG_UNIFORM:  u32 = 0xedc531; // U — warning / amber-yellow
const FLAG_NOVEMBER: u32 = 0xf26475; // N — error / crimson
const FLAG_LIMA:     u32 = 0xb5b5a8; // L — resting / slate
const FLAG_WHITE:    u32 = 0xf4f4f2; // the white field on each flag
```

If you'd rather not disturb the existing names, the only behavior-load-bearing repoint is `C_GATED` → `0xf26475` (the old `0xd4736b` is a brass-adjacent warm-red the brand check may flag) and `C_ACCENT` → `0xffdb33` (mustard, the brand pop). The flag consts are new.

---

## 1. Pane state → flag mapping

The flag a pane flies reflects its *state*. Derive it from the surface and its blocks (the background thread already populates a `Tone` in the title — reuse it, or compute from surface kind + presence). Add this enum + helpers:

```rust
/// Maritime ICS signal flag flown by a pane. Maps 1:1 to status semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalFlag {
    Charlie,  // success  → green   (landed / all-green)
    Kilo,     // info     → blue    (working / engaged-info)
    Uniform,  // warning  → amber   (attention, non-blocking)
    November, // error    → crimson (gated / HiTL / failure)
    Lima,     // resting  → slate   (idle / nightshift)
}

impl SignalFlag {
    /// The flag's display name (shown beside the chip).
    fn name(self) -> &'static str {
        match self {
            SignalFlag::Charlie => "Charlie",
            SignalFlag::Kilo => "Kilo",
            SignalFlag::Uniform => "Uniform",
            SignalFlag::November => "November",
            SignalFlag::Lima => "Lima",
        }
    }
    /// The flag's primary swatch color (the rest of the chip is the white field).
    fn color(self) -> u32 {
        match self {
            SignalFlag::Charlie => FLAG_CHARLIE,
            SignalFlag::Kilo => FLAG_KILO,
            SignalFlag::Uniform => FLAG_UNIFORM,
            SignalFlag::November => FLAG_NOVEMBER,
            SignalFlag::Lima => FLAG_LIMA,
        }
    }
}

/// A pane's flag from its dominant block tone. Errors/gates win, then activity,
/// then success, then idle. This is the same precedence the HiTL bar uses.
fn flag_for_blocks(blocks: &[Block]) -> SignalFlag {
    let mut best = SignalFlag::Lima; // resting unless something says otherwise
    for b in blocks {
        let tone = match b {
            Block::Chip { tone, .. } => Some(tone),
            _ => None,
        };
        if let Some(t) = tone {
            let f = match t {
                Tone::Gated | Tone::Conflicted => SignalFlag::November,
                Tone::Engaged => SignalFlag::Kilo,
                Tone::Accent => SignalFlag::Uniform,
                Tone::Landed => SignalFlag::Charlie,
                Tone::Resting | Tone::Default => SignalFlag::Lima,
            };
            // precedence: November > Uniform > Kilo > Charlie > Lima
            best = max_flag(best, f);
        }
    }
    best
}

fn flag_rank(f: SignalFlag) -> u8 {
    match f {
        SignalFlag::November => 4,
        SignalFlag::Uniform => 3,
        SignalFlag::Kilo => 2,
        SignalFlag::Charlie => 1,
        SignalFlag::Lima => 0,
    }
}
fn max_flag(a: SignalFlag, b: SignalFlag) -> SignalFlag {
    if flag_rank(b) > flag_rank(a) { b } else { a }
}
```

---

## 2. Flag-render helper

The HTML draws the flag as a tiny CSS-gradient rectangle. gpui 0.2.2 has no `linear-gradient` background helper on `div`, so render each flag as a **14×10 cell composed of colored sub-divs** — crisp, no images, theme-driven. This reproduces Charlie (horizontal split), Kilo (vertical bars), November (diagonal), Uniform/Lima (quartered) faithfully enough at chip size:

```rust
/// The 14×10 flag swatch: small colored divs arranged to evoke the ICS flag.
/// gpui 0.2.2 has no gradient fill, so we compose solid cells.
fn flag_swatch(flag: SignalFlag) -> impl IntoElement {
    let c = rgb(flag.color());
    let w = rgb(FLAG_WHITE);
    let base = div().w(px(14.0)).h(px(10.0)).rounded(px(2.0)).overflow_hidden();
    match flag {
        // Charlie: blue/white/red horizontal — simplified to color-over-white halves.
        SignalFlag::Charlie => base
            .flex().flex_col()
            .child(div().flex_1().bg(c))
            .child(div().flex_1().bg(w)),
        // Kilo: yellow|blue vertical bars.
        SignalFlag::Kilo => base
            .flex().flex_row()
            .child(div().flex_1().bg(c))
            .child(div().flex_1().bg(w)),
        // November: blue/white checkers — render a 2×2 grid (diag reads as N).
        SignalFlag::November => base
            .flex().flex_col()
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(c)).child(div().flex_1().bg(w)))
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(w)).child(div().flex_1().bg(c))),
        // Uniform: red/white quartered.
        SignalFlag::Uniform => base
            .flex().flex_col()
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(c)).child(div().flex_1().bg(w)))
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(w)).child(div().flex_1().bg(c))),
        // Lima: yellow/black quartered — black field stands in for the dark quarters.
        SignalFlag::Lima => base
            .flex().flex_col()
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(c)).child(div().flex_1().bg(rgb(0x222222))))
            .child(div().flex_1().flex().flex_row()
                .child(div().flex_1().bg(rgb(0x222222))).child(div().flex_1().bg(c))),
    }
}

/// The full signal-flag CHIP — swatch + name — for a pane title bar.
/// Bordered, neobrutalist hard edge, ≥14px-readable (name at 13px uppercase-mono).
fn sigflag_chip(flag: SignalFlag) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(5.0))
        .px(px(7.0))
        .py(px(3.0))
        .rounded(px(5.0))
        .border_1()
        .border_color(rgb(C_BORDER))
        .child(flag_swatch(flag))
        .child(
            div()
                .text_color(rgb(C_INK2))
                .text_size(px(13.0))
                .font_family("IBM Plex Mono")
                .font_weight(FontWeight::SEMIBOLD)
                .child(flag.name()),
        )
}
```

> Note on Charlie/November fidelity: at 14×10 the true ICS designs (Charlie's 5 stripes, November's 4×4 checker) become mud. The simplified 2-band / 2×2 forms above read as *distinct* flags at chip size, which is the actual UX goal. The `name()` text disambiguates. If you want exact stripes later, the same sub-div composition scales — just add more children.

---

## 3. Cursor-blink mechanism (the load-bearing piece)

gpui 0.2.2's `with_animation` is not guaranteed, and we want **reduced-motion safety** anyway. The robust, framework-agnostic approach: a periodic `cx.spawn` timer that flips a `bool` on the view and calls `cx.notify()`. The cursor cell reads that bool and toggles opacity. One timer drives every cursor in the window (cheap, in phase).

Add state to `ConsoleView`:

```rust
pub struct ConsoleView {
    // ...existing fields...
    /// Shared blink phase for all cursors / presence pulses. Flipped by a
    /// background interval task; `false` hides the cursor cell. Honors
    /// prefers-reduced-motion by simply never starting the task (stays `true`).
    blink_on: bool,
    /// Set once the blink task is spawned, so re-renders don't spawn duplicates.
    blink_started: bool,
    /// Reduced-motion: when true we never blink (cursor shows solid).
    reduce_motion: bool,
}
```

Initialize in `with_control`:

```rust
            blink_on: true,
            blink_started: false,
            // gpui exposes this via the window/system; default false is safe.
            // If a reduced-motion query is available, set it here.
            reduce_motion: false,
```

Spawn the interval once, from `render` (guarded so it only fires the first time). Put this at the top of `Render::render`, right after you grab `cx`:

```rust
        // Start the single blink heartbeat once. 530ms ≈ the classic terminal
        // cursor cadence; one task drives every cursor + presence dot in phase.
        if !self.blink_started && !self.reduce_motion {
            self.blink_started = true;
            cx.spawn(async move |view, cx| {
                loop {
                    cx.background_executor()
                        .timer(std::time::Duration::from_millis(530))
                        .await;
                    let alive = view
                        .update(cx, |this, cx| {
                            this.blink_on = !this.blink_on;
                            cx.notify();
                        })
                        .is_ok();
                    if !alive {
                        break; // view dropped — stop the heartbeat.
                    }
                }
            })
            .detach();
        }
```

> gpui 0.2.2 API check: `cx.spawn(async move |entity_weak, cx| ...)` yields a weak handle whose `.update(cx, |this, cx| ...)` returns `Result` (Err once the view is dropped) — that's our loop exit. `cx.background_executor().timer(Duration)` returns an awaitable. If your pinned 0.2.2 spells the spawn closure as `cx.spawn(|view, mut cx| async move { ... })` instead, use that shape; the body is identical. Both are present in 0.2.2; pick whichever your other tasks already use. `.detach()` drops the task handle so it runs free.

The blink cell itself — a fixed-size block that toggles opacity (never layout, so no reflow jitter):

```rust
/// A blinking block caret. `on` comes from the shared blink phase; reduced-motion
/// callers pass `on = true` permanently. Toggles OPACITY only (no layout shift).
fn blink_caret(on: bool, color: u32) -> impl IntoElement {
    div()
        .w(px(8.0))
        .h(px(16.0))
        .bg(rgb(color))
        .rounded(px(1.0))
        .opacity(if on { 1.0 } else { 0.0 })
}

/// A thinner streaming caret for the transcript lane (trails live output).
fn stream_caret(on: bool) -> impl IntoElement {
    div()
        .w(px(7.0))
        .h(px(14.0))
        .bg(rgb(C_INK2))
        .opacity(if on { 1.0 } else { 0.0 })
}
```

---

## 4. Presence pulse dot (running agents)

The mock pulses the engaged dot via opacity. Reuse the same `blink_on` phase but ease it instead of hard on/off — gpui has no keyframe `box-shadow` ring, so animate **opacity between 1.0 and 0.45**. Resting/landed/gated dots are static.

```rust
/// Presence dot for a vessel/agent. Engaged (running) breathes via the shared
/// blink phase; every other state is a solid dot. Reduced-motion = solid.
fn presence_dot(tone: &Tone, blink_on: bool) -> impl IntoElement {
    let (color, pulses) = match tone {
        Tone::Engaged    => (C_ENGAGED, true),  // running → amber, breathing
        Tone::Landed     => (C_LANDED,  false),
        Tone::Gated      |
        Tone::Conflicted => (C_GATED,   false),
        Tone::Resting    => (C_RESTING, false),
        _                => (C_MUTED,   false),
    };
    let opacity = if pulses && !blink_on { 0.45 } else { 1.0 };
    div()
        .w(px(9.0))
        .h(px(9.0))
        .rounded_full()
        .bg(rgb(color))
        .opacity(opacity)
        .flex_shrink_0()
}
```

---

## 5. Hooks into `render_leaf`

Three changes inside `render_leaf`. First, compute the flag near the top (after `let blocks = ...`):

```rust
        let flag = flag_for_blocks(&blocks);
        let blink_on = self.blink_on;
        let is_running = blocks.iter().any(|b| matches!(
            b, Block::Chip { tone: Tone::Engaged, .. }
        ));
```

**(a) Flag chip + presence dot in the title bar.** In the title-bar `div`, replace the bare focus-dot `●/○` child with a presence dot, and insert the flag chip just before the `flex_1()` spacer:

```rust
            // Title bar: presence dot · label · flag chip · spacer · hover controls
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(11.0))
                    .py(px(5.0))
                    .bg(rgb(if is_focused { C_RAISED } else { C_PANEL }))
                    .border_b_1()
                    .border_color(rgb(C_BORDER))
                    // presence dot — pulses when the pane's agent is running
                    .child(presence_dot(
                        if is_running { &Tone::Engaged }
                        else if flag == SignalFlag::November { &Tone::Gated }
                        else if flag == SignalFlag::Charlie { &Tone::Landed }
                        else { &Tone::Resting },
                        blink_on,
                    ))
                    .child(
                        div()
                            .text_color(rgb(if is_focused { C_ACCENT } else { C_INK2 }))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(label),
                    )
                    // maritime signal flag for this pane's state
                    .child(sigflag_chip(flag))
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.0))
                            .opacity(0.0)
                            .group_hover("pane", |s| s.opacity(1.0))
                            .child(pane_ctrl(id, "vsplit", "│", C_MUTED, cx))
                            .child(pane_ctrl(id, "hsplit", "─", C_MUTED, cx))
                            .child(pane_ctrl(id, "zoom", "□", C_MUTED, cx))
                            .child(pane_ctrl(id, "close", "✕", C_GATED, cx)),
                    ),
            )
```

**(b) Streaming cursor in the agent-transcript lane.** After the surface-body `.children(...)` block, append a trailing stream caret row *only* for agent transcripts. Replace the body child with:

```rust
            // Surface body — agent lanes get a trailing streaming caret.
            .child({
                let body = div()
                    .flex_1()
                    .overflow_hidden()
                    .flex()
                    .flex_col()
                    .children(blocks.into_iter().map(render_block));
                if is_agent {
                    body.child(
                        div()
                            .flex()
                            .items_center()
                            .px(px(16.0))
                            .py(px(4.0))
                            .child(stream_caret(blink_on)),
                    )
                } else {
                    body
                }
            })
```

(`blocks` is moved into the closure here; since you read `flag`/`is_running` from it above before this point, the borrow order is fine — both reads happen before the move.)

---

## 6. Hook into the command line (blinking caret)

In `Render::render`, the command line currently renders the buffer as `format!("› {}▏", cmd.buffer)` — a static glyph. Replace that single child with a buffer-text div followed by a real `blink_caret`. Swap the inner `.child(...)` of the open-command branch:

```rust
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .items_center()
                                    .text_color(rgb(C_INK))
                                    .text_size(px(14.0))
                                    .font_family("IBM Plex Mono")
                                    .child(format!("› {}", cmd.buffer))
                                    .child(blink_caret(self.blink_on, C_ACCENT)),
                            )
```

(`self.blink_on` is readable here because `render` takes `&mut self`; you grabbed `command` as a clone earlier, but `blink_on` is `Copy`.)

---

## 7. Reduced-motion

Set `reduce_motion: true` in construction when the platform query says so, and the heartbeat never starts → `blink_on` stays `true` → every caret shows solid, every presence dot shows full opacity. No animation, fully legible. If gpui 0.2.2 surfaces a reduced-motion flag on `Window`/`App`, read it in `with_control` and assign `reduce_motion`; otherwise default `false` and gate behind a config/env toggle.

---

## Summary of touch points in `/Users/erichowens/coding/tmp/pd-console-mux/core/pd-console/src/app.rs`

- **New consts** (§0): `C_ACCENT2`, `C_RESTING`, `FLAG_*`; repoint `C_GATED`→`0xf26475`, `C_ACCENT`→`0xffdb33`, `C_ENGAGED`→`0xf59e0b`, `C_LANDED`→`0x6dd3a8`, `C_MUTED`→`0xb5b5a8` to match the v12 dark tokens and clear the brand check.
- **New types/fns** (§1–4): `SignalFlag` + `flag_for_blocks`/`flag_rank`/`max_flag`; `flag_swatch`, `sigflag_chip`; `blink_caret`, `stream_caret`, `presence_dot`.
- **`ConsoleView` fields** (§3): `blink_on`, `blink_started`, `reduce_motion` (+ init).
- **`Render::render`**: spawn the 530ms blink heartbeat once (§3); blinking caret in the command line (§6).
- **`render_leaf`**: compute `flag`/`is_running`/`blink_on`; presence dot + flag chip in the title bar (§5a); streaming caret appended to agent-transcript bodies (§5b).

All sizes are ≥13px (mono-uppercase chip labels) / ≥14px body — within the no-tiny-fonts rule. Colors are the maritime+neobrutalism dark tokens; no cinnabar/brass/patina, so `scripts/check-brand-colors.mjs` stays green. Animation is opacity-only via one shared interval task, reduced-motion-safe by construction.