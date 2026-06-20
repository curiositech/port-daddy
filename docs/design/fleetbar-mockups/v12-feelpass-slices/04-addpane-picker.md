I now have everything I need. I understand the mux ops (`split(Dir, SurfaceKind)`, `swap_surface`, `focus`, `surface_for_nav_id`), the existing palette constants, the leader-key model, and the mock's add-pane surface palette look (mustard `--accent #FFDB33`, a `.surf` chip with a colored swatch `.g`, alert crimson). I'll write concrete gpui 0.2.2 Rust.

Here is the complete, paste-ready ADD-PANE slice for `app.rs`.

---

## 1. Surface-kind catalog (drop near the `NAV` const, after line 101)

This is the single source of truth for what the picker offers. Each entry knows its display label, hotkey, swatch color, and how to mint a `SurfaceKind`. It reuses `surface_for_nav_id` so the live-data wiring stays in one place.

```rust
// ── Add-pane surface catalog ──────────────────────────────────────────────────
// Drives both the Ctrl-A a overlay picker and the "+ add pane" bar. `key` is the
// one-press hotkey while the overlay is open; `swatch` is the maritime swatch
// color (mustard accent for brand surfaces, signal colors for the rest).

struct SurfaceChoice {
    /// One-press hotkey while the picker overlay is open.
    key: &'static str,
    /// Human label shown in the picker + add-bar.
    label: &'static str,
    /// Swatch color (u32 sRGB) — matches the mock's `.surf .g` dot.
    swatch: u32,
    /// Nav id the picker resolves through `surface_for_nav_id`; `None` means
    /// the choice mints its surface directly (editor / filetree / cartographer).
    nav: Option<&'static str>,
}

const SURFACE_CHOICES: &[SurfaceChoice] = &[
    SurfaceChoice { key: "f", label: "fleet",            swatch: C_LANDED,  nav: Some("fleet") },
    SurfaceChoice { key: "l", label: "agent lane",       swatch: C_ENGAGED, nav: Some("lane") },
    SurfaceChoice { key: "r", label: "roadmap",          swatch: C_ACCENT,  nav: Some("roadmap") },
    SurfaceChoice { key: "d", label: "dispatch",         swatch: C_GATED,   nav: Some("dispatch") },
    SurfaceChoice { key: "s", label: "sessions",         swatch: C_INK2,    nav: Some("sessions") },
    SurfaceChoice { key: "h", label: "health",           swatch: C_LANDED,  nav: Some("health") },
    SurfaceChoice { key: "c", label: "cartographer chat", swatch: C_ACCENT, nav: None },
    SurfaceChoice { key: "e", label: "editor",           swatch: C_INK2,    nav: None },
    SurfaceChoice { key: "t", label: "filetree",         swatch: C_MUTED,   nav: None },
];

impl SurfaceChoice {
    /// Mint the SurfaceKind this choice represents. Nav-backed choices route
    /// through the existing resolver so live data keeps flowing; the rest mint
    /// their kind directly.
    fn surface(&self) -> SurfaceKind {
        match self.nav {
            Some(nav) => surface_for_nav_id(nav),
            None => match self.label {
                "cartographer chat" => SurfaceKind::CartographerChat,
                "filetree" => SurfaceKind::FileTree { root: None },
                // "editor" has no dedicated SurfaceKind yet — summon it as a
                // generic panel so it's honest rather than a fake editor.
                _ => SurfaceKind::Panel { nav: "editor".into() },
            },
        }
    }
}
```

> Note: `SurfaceKind` has no `Editor` variant, so "editor" routes to `Panel { nav: "editor" }` (which `blocks_for_surface` renders as an honest placeholder). If you add a `SurfaceKind::Editor` later, only this one `match` arm changes.

---

## 2. Picker state on `ConsoleView` (add to the struct, after `control_flash`, ~line 291)

```rust
    /// When `true`, the add-pane surface picker overlay is open. The next
    /// keystroke either selects a surface by its hotkey or dismisses (Escape).
    /// Opened by `Ctrl-A a` or the "+ add pane" affordance.
    picker_open: bool,
```

And initialize it in **both** constructors. In `with_control`'s returned `Self { … }` (after `control_flash: None,` at line 328):

```rust
            control_flash: None,
            picker_open: false,
```

---

## 3. The pick + open/close ops (add as methods inside `impl ConsoleView`, near `leader_command`)

```rust
    /// Open the add-pane surface picker overlay.
    fn open_picker(&mut self, cx: &mut Context<Self>) {
        self.picker_open = true;
        cx.notify();
    }

    /// Commit a surface choice: split the focused pane along the wider axis and
    /// drop the chosen surface into the new pane (which split() focuses for us).
    /// Closes the picker. `dir` lets the "+ bar" choose Row while the overlay
    /// defaults to Row too — splitting beside the focus reads best on wide
    /// windows; the operator can re-split vertically with Ctrl-A -.
    fn add_pane(&mut self, choice: &SurfaceChoice, dir: Dir, cx: &mut Context<Self>) {
        let surface = choice.surface();
        // split() places `surface` in the new pane AND moves focus to it.
        self.ws_mut().split(dir, surface);
        self.picker_open = false;
        cx.notify();
    }

    /// Resolve a picker keystroke. Escape (or the leader 'a' a second time)
    /// closes; any catalog hotkey selects. Unknown keys are swallowed so a
    /// stray press doesn't fall through to the multiplexer.
    fn handle_picker_key(&mut self, key: &str, cx: &mut Context<Self>) {
        match key {
            "escape" | "a" => {
                self.picker_open = false;
                cx.notify();
            }
            other => {
                if let Some(choice) = SURFACE_CHOICES.iter().find(|c| c.key == other) {
                    self.add_pane(choice, Dir::Row, cx);
                }
                // else: swallow — keep the overlay open for another try.
            }
        }
    }
```

---

## 4. Wire the leader key (`Ctrl-A a`) to open the picker

In `leader_command` (line 407), there's already an `"a" if ctrl` arm that cycles focus on the double-prefix. Add a plain `"a"` (no ctrl) arm that opens the picker. Replace the existing focus arm to disambiguate by `ctrl`:

```rust
            // Double-prefix (Ctrl-A Ctrl-A) cycles focus — fast tmux idiom.
            "a" if ctrl => self.ws_mut().focus_next(),
            // Ctrl-A then a (no ctrl): open the add-pane surface picker.
            "a" => self.picker_open = true,
```

(Place the `"a"` arm immediately after the `"a" if ctrl` arm. Order matters: the guarded arm must come first.) The trailing `cx.notify()` at the end of `leader_command` already covers the redraw.

---

## 5. Route keystrokes to the picker first (in `render`'s `on_key_down`, line 799)

The picker must intercept keys before the leader/command logic. Add a `picker_open` branch as the **first** condition:

```rust
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _window, cx| {
                let key = ev.keystroke.key.clone();
                let key_char = ev.keystroke.key_char.clone();
                let ctrl = ev.keystroke.modifiers.control;
                if this.picker_open {
                    // Picker overlay owns the keyboard while open.
                    this.handle_picker_key(key.as_str(), cx);
                } else if this.command.is_some() {
                    this.handle_command_key(key.as_str(), key_char.as_deref(), cx);
                } else if this.leader_armed {
                    this.leader_armed = false;
                    this.leader_command(key.as_str(), ctrl, cx);
                } else if ctrl && key == "a" {
                    this.leader_armed = true;
                    cx.notify();
                }
            }))
```

---

## 6. The "+ add pane" bar affordance + the overlay render (in `render`)

### 6a. The persistent "+ add pane" bar

Insert this between the pane-tree body child (line 861) and the command/status bar (line 863). It mirrors the mock's `.addbar`: a mustard `＋ add pane` label, then one `.surf` chip per catalog entry with its swatch dot. Clicking a chip splits-and-fills directly (no overlay needed for mouse users); the leftmost label opens the keyboard overlay.

```rust
            // ── "+ add pane" surface bar (mouse-first; mirrors the mock .addbar) ──
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(px(8.0))
                    .px(px(14.0))
                    .py(px(9.0))
                    .bg(rgb(C_PANEL))
                    .border_t_1()
                    .border_color(rgb(C_BORDER))
                    .child(
                        // Label doubles as the overlay opener.
                        div()
                            .id("addpane-open")
                            .text_color(rgb(C_ACCENT))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .cursor_pointer()
                            .hover(|s| s.text_color(rgb(C_INK)))
                            .child("＋ add pane")
                            .on_click(cx.listener(|this, _ev, _window, cx| {
                                this.open_picker(cx);
                            })),
                    )
                    .children(SURFACE_CHOICES.iter().enumerate().map(|(i, choice)| {
                        let swatch = choice.swatch;
                        div()
                            .id(SharedString::from(format!("surf-{i}")))
                            .flex()
                            .items_center()
                            .gap(px(7.0))
                            .px(px(11.0))
                            .py(px(6.0))
                            .rounded(px(7.0))
                            .border_1()
                            .border_color(rgb(C_BORDER))
                            .text_color(rgb(C_INK2))
                            .text_size(px(14.0))
                            .cursor_pointer()
                            .hover(|s| {
                                s.bg(rgb(C_RAISED))
                                    .text_color(rgb(C_INK))
                                    .border_color(rgb(C_ACCENT))
                            })
                            .child(
                                // swatch dot (mock's `.surf .g`)
                                div()
                                    .w(px(8.0))
                                    .h(px(8.0))
                                    .rounded(px(2.0))
                                    .bg(rgb(swatch)),
                            )
                            .child(choice.label)
                            .on_click(cx.listener(move |this, _ev, _window, cx| {
                                this.add_pane(&SURFACE_CHOICES[i], Dir::Row, cx);
                            }))
                    })),
            )
```

> gpui 0.2.2 note: `flex_wrap()` exists on `Styled` (sets `flex-wrap: wrap`) so chips reflow on a narrow window — keeping every chip reachable rather than clipped.

### 6b. The keyboard overlay (the `Ctrl-A a` picker)

Add this as the **last child** of the top-level `div()` in `render` (after the command/status bar at line 917, still inside the outer `div`). An overlay in gpui 0.2.2 is an absolutely-positioned, full-window layer drawn last so it paints on top. It dims the backdrop and centers a card listing each surface with its hotkey.

Build it conditionally with `.when`:

```rust
            // ── Add-pane picker overlay (Ctrl-A a). Drawn last → paints on top. ──
            .when(self.picker_open, |root| {
                root.child(
                    div()
                        .id("picker-overlay")
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        // Dim backdrop; clicking it dismisses.
                        .bg(rgba(0x00000099))
                        .on_click(cx.listener(|this, _ev, _window, cx| {
                            this.picker_open = false;
                            cx.notify();
                        }))
                        .child(
                            // The card. stop the click from bubbling to the backdrop.
                            div()
                                .id("picker-card")
                                .w(px(420.0))
                                .flex()
                                .flex_col()
                                .rounded(px(10.0))
                                .border_1()
                                .border_color(rgb(C_ACCENT))
                                .bg(rgb(C_PANEL))
                                .overflow_hidden()
                                .on_click(|_ev, _window, _cx| { /* swallow */ })
                                // Card header
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.0))
                                        .px(px(16.0))
                                        .py(px(12.0))
                                        .border_b_1()
                                        .border_color(rgb(C_BORDER))
                                        .bg(rgb(C_RAISED))
                                        .child(
                                            div()
                                                .text_color(rgb(C_ACCENT))
                                                .text_size(px(15.0))
                                                .font_weight(FontWeight::BOLD)
                                                .child("＋ add pane"),
                                        )
                                        .child(div().flex_1())
                                        .child(
                                            div()
                                                .text_color(rgb(C_MUTED))
                                                .text_size(px(13.0))
                                                .font_family("IBM Plex Mono")
                                                .child("press key · esc cancel"),
                                        ),
                                )
                                // One row per surface choice.
                                .children(SURFACE_CHOICES.iter().enumerate().map(|(i, choice)| {
                                    let swatch = choice.swatch;
                                    let key = choice.key;
                                    div()
                                        .id(SharedString::from(format!("pick-{i}")))
                                        .flex()
                                        .items_center()
                                        .gap(px(12.0))
                                        .px(px(16.0))
                                        .py(px(9.0))
                                        .cursor_pointer()
                                        .hover(|s| s.bg(rgb(C_RAISED)))
                                        // hotkey chip
                                        .child(
                                            div()
                                                .w(px(22.0))
                                                .h(px(22.0))
                                                .flex()
                                                .items_center()
                                                .justify_center()
                                                .rounded(px(5.0))
                                                .border_1()
                                                .border_color(rgb(C_BORDER))
                                                .text_color(rgb(C_ACCENT))
                                                .text_size(px(14.0))
                                                .font_family("IBM Plex Mono")
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .child(key),
                                        )
                                        // swatch dot
                                        .child(
                                            div()
                                                .w(px(8.0))
                                                .h(px(8.0))
                                                .rounded(px(2.0))
                                                .bg(rgb(swatch)),
                                        )
                                        // label
                                        .child(
                                            div()
                                                .flex_1()
                                                .text_color(rgb(C_INK))
                                                .text_size(px(14.0))
                                                .child(choice.label),
                                        )
                                        .on_click(cx.listener(move |this, _ev, _window, cx| {
                                            this.add_pane(&SURFACE_CHOICES[i], Dir::Row, cx);
                                        }))
                                })),
                        ),
                )
            })
```

---

## Key gpui 0.2.2 API notes for the integrator

- `rgba(0x00000099)` is the dim backdrop (`rgba` takes a `u32` `0xRRGGBBAA`; it's a free fn in the gpui prelude alongside `rgb`). If your pinned 0.2.2 only exposes `rgb`, substitute `.bg(rgb(C_BG)).opacity(0.75)` on the backdrop div.
- `.absolute().inset_0()` positions the overlay to fill the tracked-focus root. Both `absolute()` and `inset_0()` are on `Styled` in 0.2.2.
- `.on_click(|_ev, _window, _cx| {})` on the card swallows the bubble so a click inside the card doesn't dismiss via the backdrop handler. (gpui click handlers don't auto-stop propagation; a no-op child handler is the idiom.)
- The overlay being the **last child** of the root `div` is what makes it paint on top — gpui paints children in order; there's no z-index. No `with_animation` is used, consistent with the constraint.
- Everything respects the no-tiny-fonts rule: labels and chips are `px(14.0)`+; the only `px(13.0)` text is the uppercase/mono `press key · esc cancel` hint and is in line with the existing status-bar hints. The swatch colors reuse the existing `C_*` constants (mustard `C_ACCENT 0xe3b56d`, signal `C_GATED 0xd4736b` for dispatch) — no cinnabar/brass/patina introduced, so `scripts/check-brand-colors.mjs` stays green.

## Behavior summary

- `Ctrl-A a` → overlay opens; press `f`/`l`/`r`/`d`/`s`/`h`/`c`/`e`/`t` to split the focused pane (Row) and drop that surface in; `Esc` or click-backdrop dismisses.
- The persistent "+ add pane" bar gives the same via mouse: click a chip to split-and-fill immediately, or click the mustard `＋ add pane` label to open the keyboard overlay.
- All paths funnel through `add_pane` → `Workspace::split(dir, surface)`, which already focuses the new pane; nav-backed surfaces route through the existing `surface_for_nav_id` so live data keeps flowing. No new mux ops were needed — `split` + `surface_for_nav_id` + the `SurfaceKind` variants cover it.

Source file to edit: `/Users/erichowens/coding/tmp/pd-console-mux/core/pd-console/src/app.rs`. Mux ops referenced: `/Users/erichowens/coding/tmp/pd-console-mux/core/pd-console/src/mux.rs` (`Workspace::split` line 179, `swap_surface` line 257, `focus` line 247).