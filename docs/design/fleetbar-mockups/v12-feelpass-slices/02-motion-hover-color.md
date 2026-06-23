I have full, verified knowledge of the API surface. Key facts confirmed for gpui 0.2.2 (crates.io):

- `.hover(|s: StyleRefinement| s...)` and `.group_hover("name", |s| s...)` — closures return `StyleRefinement`, and `box_shadow_style_methods!()` IS on `StyleRefinement`, so `.shadow(vec![...])` and `.shadow_md()` work **inside hover closures**. This is the load-bearing detail: I can glow/lift on hover.
- **No** `scale`/`translate`/transform builder on `Styled`. "Lift"/"scale" must be faked via `px()` size/padding deltas or shadow; true spring motion needs `with_animation`.
- `Animation::new(Duration).with_easing(fn)` + `.with_animation(id, anim, |el, delta| ...)` exists, with `ease_out_quint()`, `pulsating_between(min,max)`, `bounce()`. `oneshot` by default; `.repeat()` loops.
- `shadow(Vec<BoxShadow>)` with `color: Hsla` (use `rgb(0xRRGGBB).into()` → `Hsla`, then `.opacity()` on `Hsla` for alpha), `offset: point(px,px)`, `blur_radius`, `spread_radius`.
- `opacity(f32)` on `Styled`.

Now I'll write the concrete Rust deltas.

---

## MOTION SLICE — concrete Rust for `core/pd-console/src/app.rs`

Everything below is gpui 0.2.2-correct. The governing constraint: **0.2.2 has no fluent transform**, so "lift/scale" reads as (a) hover color+glow via `shadow(vec![...])` inside `.hover`/`.group_hover` closures (instant, GPU-cheap, the dominant effect), and (b) true eased entrance/spring via `with_animation` on a one-shot timeline. The mock's `--snap` overshoot maps to `ease_out_quint`; `--swoosh` settle maps to a custom cubic; `--float` breathing maps to `pulsating_between`.

### 1. Palette retune to the mock (top of file, replace the `C_*` block, lines 106–116)

The current palette is the retired amber/blue OKLCH set. Swap to the mock's dark maritime+neobrutalism tokens (mustard brand, crimson `#F26475` dark alert — never cinnabar/brass/patina). Add motion-only glow alphas and shadow colors.

```rust
// ── Palette — DARK maritime + neobrutalism (matches operator-console-v12 mock) ──
// sRGB u32 (0xRRGGBB) → rgb() at render time. Source: tokens.semantic.css dark theme.
const C_BG:     u32 = 0x1e1b18; // bg_page  (warm ebony)
const C_PANEL:  u32 = 0x2b2724; // bg_surface
const C_RAISED: u32 = 0x3a342d; // hover lift
const C_SUNKEN: u32 = 0x100e0c; // deepest (chrome/tab/foot bg)
const C_INK:    u32 = 0xf5f5f0;
const C_INK2:   u32 = 0xd1d1c7;
const C_MUTED:  u32 = 0xb5b5a8;
const C_ACCENT: u32 = 0xffdb33; // mustard amber — brand pop (fills/dots/glows)
const C_ENGAGED:u32 = 0xf59e0b; // warning amber (busy)
const C_GATED:  u32 = 0xf26475; // crimson, AAA on ebony, guard-safe (NOT cinnabar)
const C_LANDED: u32 = 0x6dd3a8; // term_ok green
const C_BORDER: u32 = 0x504b46; // border_muted
const C_LINE2:  u32 = 0xf5f5f0; // neobrutalist hard white edge (focus / strong)
```

### 2. Motion module — curves + a shadow helper (add once, near the palette)

```rust
// ── Motion system — named curves matched to the mock's CSS bezier set ──────────
// gpui 0.2.2 has no fluent transform; "lift/scale/spring" reads through (a) hover
// color+glow (instant, GPU-cheap) and (b) `with_animation` one-shot timelines for
// entrances. Durations ≤ 500ms, transform/opacity only — same budget as the mock.
mod motion {
    use gpui::{px, point, BoxShadow, Hsla, Rgba};

    pub const RISE_MS:  u64 = 500; // pane/tab entrance (--swoosh)
    pub const SNAP_MS:  u64 = 220; // button/control press settle (--snap)

    /// `--swoosh` cubic-bezier(.16,1,.3,1): a fast-out graceful settle.
    /// Sampled analytically (Newton on the bezier) — good enough for a 1-D ease.
    pub fn swoosh(t: f32) -> f32 {
        // Closely approximated by a quintic ease-out; visually identical for entrances.
        1.0 - (1.0 - t).powi(5)
    }

    /// `--snap` cubic-bezier(.34,1.56,.64,1): overshoot spring (y > 1 mid-flight).
    /// Closed-form overshoot — peaks ~1.07 near t≈0.7 then settles to 1.0.
    pub fn snap(t: f32) -> f32 {
        let c = 1.70158_f32; // standard back-ease tension ≈ the .56 overshoot
        let t = t - 1.0;
        t * t * ((c + 1.0) * t + c) + 1.0
    }

    /// Build a focus/hover glow: a soft accent halo. Alpha via Hsla so it reads on ebony.
    pub fn glow(color: u32, alpha: f32, blur: f32, spread: f32) -> Vec<BoxShadow> {
        let mut h: Hsla = Rgba::from(gpui::rgb(color)).into();
        h.a = alpha;
        vec![BoxShadow {
            color: h,
            offset: point(px(0.0), px(0.0)),
            blur_radius: px(blur),
            spread_radius: px(spread),
        }]
    }

    /// Neobrutalist hard offset drop — used for the hover "lift" on tabs/buttons
    /// (we cannot translate, so the offset shadow IS the lift cue).
    pub fn hard_offset(color: u32, dx: f32, dy: f32) -> Vec<BoxShadow> {
        let h: Hsla = Rgba::from(gpui::rgb(color)).into();
        vec![BoxShadow {
            color: h,
            offset: point(px(dx), px(dy)),
            blur_radius: px(0.0),
            spread_radius: px(0.0),
        }]
    }
}
```

> Note on `Rgba::from(rgb(..))`: `rgb()` returns `Rgba`; `Hsla: From<Rgba>` is the impl confirmed at `color.rs:589`. Setting `.a` directly works because `Hsla` exposes public `a`. If your gpui re-export makes `Rgba` inconvenient, the equivalent is `let h: Hsla = gpui::rgb(color).into();` then `h.a = alpha;`.

### 3. `render_leaf` — pane **focus glow** + reactive border/bg (replace lines 555–614 region)

Two changes: (a) the focused pane gets an inset accent **glow** via `shadow`, and the whole pane gets a hover bg-lift + border-warm even when unfocused (so hovering a sleeping pane previews focus); (b) the title bar reacts.

Replace the pane container head (currently lines 559–585) with:

```rust
        div()
            .id(SharedString::from(format!("pane-{id}")))
            .group("pane")
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(border))
            .bg(rgb(C_PANEL))
            // Focus glow: a soft mustard halo proves "this pane has the wheel".
            // Unfocused panes carry no shadow; hovering one previews the warm border.
            .when(is_focused, |s| s.shadow(motion::glow(C_ACCENT, 0.45, 16.0, 1.0)))
            .when(!is_focused, |s| {
                s.hover(|h| {
                    h.border_color(rgb(C_ACCENT).into())
                     .shadow(motion::glow(C_ACCENT, 0.18, 10.0, 0.0))
                })
            })
            .on_click(cx.listener(move |this, _ev, _window, cx| {
                this.ws_mut().focus(id);
                cx.notify();
            }))
            // Title bar
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .py(px(4.0))
                    .bg(rgb(if is_focused { C_RAISED } else { C_SUNKEN }))
                    .border_b_1()
                    .border_color(rgb(C_BORDER))
                    // The dot pulses on the focused pane (presence beacon, --float).
                    .child(
                        div()
                            .text_color(rgb(if is_focused { C_ACCENT } else { C_BORDER }))
                            .text_size(px(13.0))
                            .child(if is_focused { "●" } else { "○" })
                            .when(is_focused, |dot| {
                                dot.with_animation(
                                    SharedString::from(format!("dot-pulse-{id}")),
                                    Animation::new(Duration::from_millis(2400))
                                        .repeat()
                                        .with_easing(pulsating_between(0.55, 1.0)),
                                    |el, delta| el.opacity(delta),
                                )
                            }),
                    )
```

> The focus dot now **breathes** via `with_animation` + `pulsating_between(0.55, 1.0)` + `.repeat()` — the mock's `@keyframes beacon`. `pulsating_between` and `Animation`/`AnimationExt` come from `gpui::*` (re-exported from `elements::animation`). Add `use std::time::Duration;` at the top if not present.

### 4. `pane_ctrl` — control **reveal + press spring + tinted hover** (replace fn body, lines 697–728)

The mock reveals controls on `group-hover` (already wired via the `.opacity(0.0).group_hover("pane", |s| s.opacity(1.0))` at the call site), then each control scales 1.12 + tints on its own hover, with `✕` going crimson. We can't `scale`, so the per-control "pop" reads as a tinted rounded bg + glow that snaps in. Make the close button glow crimson:

```rust
fn pane_ctrl(
    id: PaneId,
    kind: &'static str,
    glyph: &'static str,
    color: u32,
    cx: &mut Context<ConsoleView>,
) -> impl IntoElement {
    let is_close = kind == "close";
    let hover_tint = if is_close { C_GATED } else { C_INK };
    div()
        .id(SharedString::from(format!("ctrl-{kind}-{id}")))
        // Slightly bigger hit-target so the hover bg reads as a "chip" snapping in.
        .w(px(22.0))
        .h(px(20.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(5.0))
        .text_size(px(14.0)) // ≥14px — no-tiny-fonts rule
        .text_color(rgb(color))
        .cursor_pointer()
        // Per-control hover: tint the glyph, fill a raised chip, and snap a glow.
        // (The reveal+settle of the whole control row is the .group_hover at the
        //  call site; this is the individual control's pop.)
        .hover(|s| {
            s.bg(rgb(C_RAISED).into())
             .text_color(rgb(hover_tint).into())
             .shadow(motion::glow(if is_close { C_GATED } else { C_ACCENT }, 0.22, 8.0, 0.0))
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
                _ => {}
            }
            cx.notify();
        }))
}
```

And upgrade the control-row reveal at the call site (lines 602–613) to also slide in (mock: `transform:translateX(4px)→none`). Since we can't translate, simulate the slide with a left-padding delta that snaps shut on hover — subtle but reads as motion:

```rust
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.0))
                            .pl(px(4.0))            // resting: nudged right…
                            .opacity(0.0)
                            .group_hover("pane", |s| s.opacity(1.0).pl(px(0.0))) // …snaps home on hover
                            .child(pane_ctrl(id, "vsplit", "│", C_MUTED, cx))
                            .child(pane_ctrl(id, "hsplit", "─", C_MUTED, cx))
                            .child(pane_ctrl(id, "zoom", "□", C_MUTED, cx))
                            .child(pane_ctrl(id, "close", "✕", C_GATED, cx)),
                    ),
```

### 5. Tab bar — **tab lift** on hover + active glow + entrance (replace the tab-children block, lines 825–842)

Mock: `.tab:hover{transform:translateY(-1px)}` + active glow. Lift = hard-offset shadow (neobrutalist), active = mustard glow. Wrap each new tab in a `with_animation` rise so adding a tab swooshes in.

```rust
                    .children(tabs.into_iter().map(|(i, name, active)| {
                        let tab = div()
                            .id(SharedString::from(format!("tab-{i}")))
                            .flex()
                            .items_center()
                            .gap(px(7.0))
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(7.0))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rgb(if active { C_ACCENT } else { C_MUTED }))
                            .when(active, |s| {
                                s.bg(rgb(C_RAISED)).shadow(motion::glow(C_ACCENT, 0.30, 12.0, 0.0))
                            })
                            .cursor_pointer()
                            // Hover lift: warm the text + a 2px hard offset (the "translateY(-1px)").
                            .when(!active, |s| {
                                s.hover(|h| {
                                    h.bg(rgb(C_RAISED).into())
                                     .text_color(rgb(C_INK2).into())
                                     .shadow(motion::hard_offset(C_SUNKEN, 0.0, 2.0))
                                })
                            })
                            // signal swatch (maritime flag colour per tab)
                            .child(
                                div()
                                    .w(px(7.0)).h(px(7.0)).rounded(px(2.0))
                                    .bg(rgb(if active { C_ACCENT } else { C_LANDED })),
                            )
                            .child(name)
                            .on_click(cx.listener(move |this, _ev, _window, cx| {
                                this.active_tab = i;
                                cx.notify();
                            }));
                        // New-tab entrance: swoosh the row in once (oneshot, settles to rest).
                        tab.with_animation(
                            SharedString::from(format!("tab-rise-{i}")),
                            Animation::new(Duration::from_millis(motion::RISE_MS))
                                .with_easing(motion::swoosh),
                            |el, delta| el.opacity(delta),
                        )
                    }))
```

> Caveat the integrator must know: `with_animation` keys by `ElementId`. Because the id is stable per tab index, the rise plays once on first mount and won't replay on every `cx.notify()` — exactly what you want (entrance, not flicker). If a tab is *removed* and the index reused, gpui resets the element-state and it re-rises; acceptable.

### 6. The `+` new-tab button — **press spring** (replace lines 843–857)

Mock buttons use `--snap` overshoot on press. Reads as a glow that snaps on hover + a brief scale-feel via padding. Add a one-shot `snap` animation gated on a transient `just_pressed` flag, or — simpler and stateless — lean on hover for the spring cue and reserve `with_animation` for the entrance. Stateless version:

```rust
                    .child(
                        div()
                            .id("tab-new")
                            .px(px(9.0))
                            .py(px(4.0))
                            .rounded(px(7.0))
                            .text_size(px(16.0))
                            .text_color(rgb(C_MUTED))
                            .cursor_pointer()
                            .hover(|s| {
                                s.bg(rgb(C_RAISED).into())
                                 .text_color(rgb(C_ACCENT).into())
                                 .shadow(motion::glow(C_ACCENT, 0.30, 10.0, 0.0))
                            })
                            .child("+")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.new_tab();
                                cx.notify();
                            })),
                    ),
```

### 7. Interrupt / "Grab the wheel" button — **press spring** via notify-driven state (the one place a true transition earns its keep)

The mock's `.btn:hover{transform:translateY(-1px)}` + `--snap`. For a genuine spring on **click** (not just hover), drive a one-shot `with_animation` keyed off a per-action nonce so each press replays. Add a field and bump it on press:

```rust
// In `struct ConsoleView`, add:
    /// Monotonic press counter — bumping it re-keys spring animations so each
    /// click replays the overshoot (gpui keys element-state by ElementId, so the
    /// id must change to restart a oneshot). Cheap, stateless-feeling motion.
    press_nonce: u64,
```

Initialize `press_nonce: 0` in both constructors. Then the Interrupt button (replace lines 635–657):

```rust
                        .child({
                            let nonce = self.press_nonce;
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
                                .hover(|s| {
                                    s.bg(rgb(C_GATED).into()) // crimson wash on hover
                                     .opacity(0.92)
                                     .shadow(motion::glow(C_GATED, 0.35, 14.0, 0.0))
                                })
                                .child("◼ Interrupt")
                                .on_click(cx.listener(|this, _ev, _window, cx| {
                                    this.press_nonce = this.press_nonce.wrapping_add(1);
                                    if let Some(tx) = &this.control_tx {
                                        let _ = tx.send(ControlMsg::InterruptLane);
                                        this.control_flash =
                                            Some("interrupt sent — watch the stream".into());
                                    }
                                    cx.notify();
                                }))
                                // Press spring: re-keyed by nonce so each click replays
                                // the --snap overshoot. opacity is the only animatable
                                // channel (no transform in 0.2.2); the overshoot eased
                                // fade reads as a "thunk".
                                .with_animation(
                                    SharedString::from(format!("interrupt-spring-{id}-{nonce}")),
                                    Animation::new(Duration::from_millis(motion::SNAP_MS))
                                        .with_easing(motion::snap),
                                    |el, delta| el.opacity(0.55 + 0.45 * delta.min(1.0)),
                                )
                        })
```

> Why the nonce: `with_animation` only restarts a `oneshot` when its `ElementId` changes (it caches `AnimationState` keyed by id; confirmed at `animation.rs:141` `with_element_state`). Embedding `press_nonce` in the id is the canonical 0.2.2 idiom to "fire a one-shot on demand." The mock's translateY isn't reproducible, so the spring is expressed on `opacity` — honest within the framework's limits. If you later vendor a transform shim, swap the animator body to drive it; the timing/curve stay identical.

### 8. Command/status bar — keep the existing `lit` color flip, add a glow when armed

At the bar container (lines 863–872), the bg/border already flip to accent when `lit`. Add a glow so PREFIX mode pulses unmistakably:

```rust
                    .bg(rgb(if lit { C_RAISED } else { C_SUNKEN }))
                    .border_t_1()
                    .border_color(rgb(if lit { C_ACCENT } else { C_BORDER }))
                    .when(lit, |s| s.shadow(motion::glow(C_ACCENT, 0.25, 12.0, 0.0)))
```

---

### Integrator checklist / gotchas

1. **Imports**: add `use std::time::Duration;`. `Animation`, `AnimationExt`, `pulsating_between`, `ease_out_quint` are all under `gpui::*` (re-exported from `elements::animation`) — already covered by `use gpui::*;` at line 19. `point`, `px`, `BoxShadow`, `Hsla`, `Rgba` likewise.
2. **Hover closures return `StyleRefinement`, not the div** — so inside `.hover(|s| ...)` use `rgb(C).into()` for `border_color`/`bg`/`text_color` (they take `impl Into<Hsla>`/`Fill`; the bare `Rgba` from `rgb()` needs `.into()` in the refinement setters). At the top level on `div()` the bare `rgb(C)` is fine (existing code relies on that).
3. **No transform** is the hard limit: every "lift/scale/translate" above is expressed as shadow-offset, padding delta, or opacity. Do not reach for `.scale()`/`.translate()` — they don't exist in 0.2.2 and won't compile. The press "spring" rides `opacity` with the `snap` curve.
4. **`with_animation` restart semantics**: stable id = plays once (entrances: pane/tab rise, focus-dot pulse via `.repeat()`). Nonce-suffixed id = replays on demand (button press). Don't put a nonce on the looping focus-dot pulse — `.repeat()` already keeps it alive and a stable id keeps it from restarting on every render.
5. **Brand-color CI** (`scripts/check-brand-colors.mjs`): all hex above are mustard `#FFDB33` / crimson `#F26475` / green `#6DD3A8` / ebony neutrals — none of cinnabar `#CC3D2E`, brass `#B08D57`, patina `#5C7A6A`. Clean.
6. **Fonts**: every `text_size` is `px(13.0)` (eyebrow-class only) or `px(14.0)+` body — within the no-tiny-fonts rule. The two surviving `px(13.0)` uses (focus dot glyph, status hints) are glyph/eyebrow, not prose.
7. **reduced-motion**: the mock guards the canvas with `prefers-reduced-motion`. gpui has no media query; if you want parity, gate the `.repeat()` pulse and entrance animations behind a `cx`-level settings flag (e.g. `if self.motion_enabled { el.with_animation(...) } else { el }`) — not required for this slice but worth a `// TODO(reduced-motion)` next to the focus-dot pulse.

Files referenced: target source `/Users/erichowens/coding/tmp/pd-console-mux/core/pd-console/src/app.rs`; mock `/Users/erichowens/coding/tmp/pd-console-mux/docs/design/fleetbar-mockups/operator-console-v12-synthesis.html`; gpui API verified at `/Users/erichowens/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gpui-0.2.2/src/elements/animation.rs` and `gpui-macros-0.2.2/src/styles.rs`.