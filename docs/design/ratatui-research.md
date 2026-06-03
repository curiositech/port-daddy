# Ratatui Possibility Space — A Map for Port Daddy's TUI

*Researcher distillation, 2026-05-14. ~2500 words. Designed as a hand-off
brief from a deep-research agent to a creative agent. The full
search-trace lives in the researcher subagent's working memory
(`agentId: afc58e7162e00b064` — reachable via SendMessage for follow-ups).*

## Executive summary (the five do's and three never-promises)

**Build for:** (1) the **HalfBlock + Braille Canvas** axis — true sub-cell
pixel rendering (2×4 dot density via Braille, 2×1 colored pixels via
HalfBlock, 2×2/2×3/2×4 Quadrant/Sextant/Octant via the v0.30 markers) lets
us draw recognizable ICS flag glyphs, gauges, and waveforms inside cells;
(2) **tui-big-text** for neobrutalist hero typography (font8x8 glyphs at
PixelSize::Full/HalfHeight/Quadrant/Sextant — that's our "cost = $4,127"
display); (3) **tachyonfx** for production-grade transitions (fade,
sweep, sliding panels, HSL shifts, 50+ effects, cell-precise filters,
~60fps in tokio loop); (4) **ratatui-image** for actual photographic
imagery on Kitty/iTerm2/Ghostty/WezTerm (sixel/Kitty/iTerm2 protocols,
halfblock fallback); (5) **custom Widget impls + Block::border_set** for
non-default border vocabularies (per-side characters, dashed/double-dashed,
quadrant-based "drop-shadow" effects).

**Never promise:** (1) **true overlapping z-order** beyond the `Clear`-widget
popup pattern — there is no real compositor; (2) **per-pixel anti-aliasing
or smooth gradients across arbitrary regions** — the cell grid is the
limit; you can fake gradients with per-cell RGB stepping, but it will
band; (3) **reliable image rendering across tmux/SSH/Windows Terminal** —
sixel/Kitty support there is partial-to-broken. Halfblock fallback works,
but quality drops.

---

## 1. Stock widget vocabulary

The `ratatui::widgets` module ships these core widgets, all `Widget` or
`StatefulWidget`:

| Widget | What it does | Key styling axes |
|---|---|---|
| `Block` | Container with border + title | Border type, border set (per-side chars), title (top/bottom + left/right alignment), padding, style, title style |
| `Paragraph` | Styled multi-line text | Alignment, wrap (trim or not), scroll offset, block, styled spans |
| `List` / `ListItem` | Stateful selectable list | Highlight style/symbol (`Into<Line>` in 0.30 — can be styled), repeat highlight symbol, direction |
| `Table` / `Row` / `Cell` | Columnar data, stateful selection | Per-column constraints, header, footer, highlight style/symbol, column spacing, segment size |
| `Tabs` | Tab strip | Highlight style, divider, padding, width (auto-calculated in 0.30) |
| `Gauge` | Block-percent progress bar | Ratio or percent, label, gauge style, use_unicode (subcell precision via `█▉▊▋▌▍▎▏`) |
| `LineGauge` | Single-row progress | Filled/unfilled symbols, line set, ratio, label |
| `Sparkline` | Vertical bars from `&[u64]` | Bar set (`▁▂▃▄▅▆▇█`), direction, max value, style |
| `BarChart` | Labeled bar chart | Bar width, gap, group_gap, label style, value style, grouped constructor |
| `Chart` / `Dataset` / `Axis` | Multi-series line/scatter | Marker (Braille/Dot/Block/Bar/HalfBlock), graph type, name, axis bounds/labels/style, legend |
| `Canvas` | Free-form coordinate drawing | Marker (5 base + Quadrant/Sextant/Octant in 0.30), x/y bounds, background color, paint closure |
| `Scrollbar` | Vertical/horizontal scroll indicator | Orientation, symbols (begin/end/thumb/track), state |
| `Calendar::Monthly` | Month grid | Default style, per-date styles, weekday header, month header |
| `Clear` | Erase a region (popups) | None — just clears for overlay rendering |

**`Title` orientation:** top/bottom positions × left/center/right alignment.
Multiple titles per side stack.

**Padding & Margin:** `Padding::new(l,r,t,b)` applies *inside* a Block.
`Margin` shrinks a `Rect` via `.inner(margin)` *outside* widgets, used
during layout. Different roles.

---

## 2. Canvas — the underused superpower

`Canvas` is where ratatui stops being "boxes of text." You set bounds, pick
a `Marker`, and paint coordinate-space shapes that ratatui renders into
cells at sub-cell density.

| Marker | Density per cell | Color flexibility |
|---|---|---|
| `Dot` | 1 point | Full RGB per cell |
| `Block` | 1 full block | Full RGB per cell |
| `Bar` | 1 vertical bar | Full RGB per cell |
| `HalfBlock` | 2 (upper/lower) | Two colors per cell — effectively square pixels |
| `Quadrant` (0.30) | 2×2 = 4 | One color per cell |
| `Sextant` (0.30) | 2×3 = 6 | One color per cell |
| `Octant` (0.30) | 2×4 = 8 | One color per cell |
| `Braille` | 2×4 = 8 dots | One color per cell |

Built-in shapes: `Line`, `Points`, `Rectangle`, `Circle`, `Map` (built-in
world map at Low/High resolution), `Label`. You can implement the `Shape`
trait for custom shapes.

Minimal Braille usage:

```rust
Canvas::default()
    .x_bounds([0.0, 100.0])
    .y_bounds([0.0, 50.0])
    .marker(Marker::Braille)
    .paint(|ctx| {
        ctx.draw(&Line { x1: 0.0, y1: 0.0, x2: 100.0, y2: 50.0,
                         color: Color::Rgb(204, 61, 46) });
        ctx.layer();
        ctx.draw(&Points { coords: &samples, color: Color::Yellow });
    })
```

**For Port Daddy:** Canvas with `HalfBlock` is how we get square colored
pixels — that's our route to recognizable ICS flag glyphs at small sizes.
Mike, Foxtrot, November, Yankee are all geometric shapes that survive 8×8
or 16×16 pixel rendering. Canvas with `Braille` is what `bottom` and
`oha` use for dense waveforms.

---

## 3. Layout machinery

Cassowary-solver-based. Constraints: `Length(u16)`, `Percentage(u16)`,
`Ratio(num, den)`, `Min(u16)`, `Max(u16)`, `Fill(weight)`. Priority order
resolves conflicts (Min highest, Fill lowest). Direction: Horizontal /
Vertical.

**Flex modes** (v0.30 normalized to CSS-flexbox semantics): `Start`, `End`,
`Center`, `SpaceBetween`, `SpaceAround`, `SpaceEvenly`, `Legacy`.

**Nested layouts:** standard pattern is split vertical (header/body/footer),
then split body horizontal (sidebar/main), then split main vertical again.

**`Clear` for overlays:** render `Clear` to a region, then your popup.
This is the ONLY z-order ratatui provides. There is no general
compositor.

**Non-rectangular regions: you can't.** Every region is a `Rect`. To fake a
non-rectangular shape, draw it inside a rect using Canvas + custom shapes
or block-element characters.

---

## 4. Third-party widget ecosystem

| Crate | What it gives us | Status |
|---|---|---|
| `tui-big-text` | Big block typography from font8x8 glyphs. `PixelSize::{Full, HalfHeight, HalfWidth, Quadrant, ThirdHeight, Sextant}` — Sextant gets readable big-text in ~1/3 the rows of Full. | Maintained via `tui-widgets` monorepo |
| `tui-textarea` | Multi-line editor with selection, search, undo/redo, optional vim binds | Active |
| `tui-tree-widget` | Expandable tree, stateful selection | Active |
| `tui-popup` (tui-widgets) | Centered popup, auto-sizing, click-outside-to-close | Active |
| `tui-scrollview` | Render larger-than-viewport content into a virtual buffer | Active |
| `tui-logger` | `log` crate integration, filterable, color-coded log panel | Active |
| `tui-menu` | Nestable dropdown menus | Maintained |
| `tui-term` | Embed a real PTY inside your TUI (run `htop` in a pane) | Active |
| `tui-piechart` | Pie/donut chart, optional high-res mode | Active |
| `throbber-widgets-tui` | 20+ named spinners (BRAILLE_DOUBLE, OOO, ARROW, BLACK_CIRCLE, ...) | Maintained |
| `tui-widget-list` | Heterogeneous list — different widget per row | Active |
| `ratatui-image` | Sixel + Kitty graphics + iTerm2 inline + halfblock fallback. Probes terminal capability. | Active, 1.0 |
| `tachyonfx` | 50+ effects + composition + spatial patterns + cell filters | Very active |
| `tui-realm` | Elm/React-style component framework on top of ratatui | Active |
| `ansi-to-tui` | Convert ANSI-escape strings into styled `Text` | Active |

---

## 5. Color, style, effects

**Color:** `Reset`, 16 named ANSI, `Indexed(u8)` 256-palette, `Rgb(u8,u8,u8)`
truecolor.

**Modifier bitflags:** `BOLD`, `DIM`, `ITALIC`, `UNDERLINED`, `SLOW_BLINK`,
`RAPID_BLINK`, `REVERSED`, `HIDDEN`, `CROSSED_OUT`. Separate
`underline_color` (v0.24) for colored/curly/dashed underlines on Kitty,
WezTerm, iTerm2 3.4+, Ghostty.

**True-color compatibility:**
- ✅ iTerm2, Ghostty, WezTerm, Kitty, Alacritty, modern Windows Terminal,
  tmux 3.0+ with `Tc` cap
- ❌ macOS Terminal.app (256 only), older Windows console pre-10
- Ratatui does NOT auto-fallback. Test on the terminals you ship to.

**Gradients:** no native primitive. Stage one by computing per-cell RGB and
emitting cells. Will band visibly across large regions. Use for 2–3 cell
accents (a banner header), not panel backgrounds.

**Animation = `tachyonfx`.** 50+ effects:
- **Color:** `fade_to/from`, `paint`, `hsl_shift`, `saturate`, `lighten`, `darken`
- **Motion/text:** `coalesce`, `dissolve`, `evolve`, `slide_in/out`, `sweep_in/out`, `explode`, `expand`, `stretch`
- **Control:** `parallel`, `sequence`, `repeat`, `ping_pong`, `delay`, `freeze_at`, `remap_alpha`, `with_duration`
- **Spatial patterns:** Radial, Diamond, Spiral, Diagonal, Checkerboard, Sweep, Wave (FM/AM), Coalesce, Dissolve

```rust
let fx = fx::fade_to(Color::Cyan, Color::Gray, (1000, Interpolation::SineIn));
effects.add_effect(fx);
effects.process_effects(elapsed, frame.buffer_mut(), area);
```

`CellFilter` lets you target effects to cells matching color, content, or
region predicates. Browser-based effect editor exists ("Tachyonfx FTL").

---

## 6. Borders, custom symbols, drop-shadow tricks

| `BorderType` | Corners | Sides | Effect |
|---|---|---|---|
| `Plain` | `┌ ┐ └ ┘` | `─ │` | Default |
| `Rounded` | `╭ ╮ ╰ ╯` | `─ │` | Friendly |
| `Double` | `╔ ╗ ╚ ╝` | `═ ║` | Heavy/document |
| `Thick` | `┏ ┓ ┗ ┛` | `━ ┃` | Heavy weight |
| `QuadrantInside` | quadrant chars `▘▝▖▗` | `▀ ▌` | Pixel-style border fills inside cell |
| `QuadrantOutside` | `▟▙▜▛` | `█ █` | Pixel-style border occupies outside half |

**`Block::border_set(symbols::border::Set { ... })`:** override individual
border characters. Mix-and-match: heavy on top, light elsewhere, or
use custom characters like `▓` for a neobrutalist filled-edge.

**Drop-shadow trick:** render the same Block twice — first at `(x+1, y+1)`
with `Color::Black` and quadrant-fill, then the real block on top.
Cheap, recognizable depth.

---

## 7. State, animation, async, mouse

The `async-template` pattern is production:

- `tokio::select!` on `Event::Key`, `Event::Mouse`, `Event::Resize`,
  `Event::Tick` (logic), `Event::Render` (draw)
- Default frame rate 60fps, tick rate configurable lower (4–30Hz)
- Render only on `Event::Render`, not on every input — avoids redraw
  storms during mouse-move
- Tachyonfx integrates from your draw handler

**Resize:** Crossterm emits `Event::Resize(w,h)` automatically. Layout
recomputes on next render.

**Mouse:** Crossterm supports button events, scroll, drag. Quirks: mouse
capture conflicts with native text selection (users must hold Shift),
inconsistent across tmux/SSH.

**Performance:** diff-renderer only updates changed cells, so static
panels are free. Full-frame fancy-effects at 60fps on 200×60 terminals is
fine. Bottleneck: very dense Canvas-Braille animations + heavy
syntax-highlighted code + tachyonfx on a 4K terminal can occasionally
exceed 16ms on older hardware.

---

## 8. Beautiful TUIs in the wild — what they actually do

- **gitui** — Catppuccin-derived themes, Tabs widget, popups (Clear+Block),
  syntax-highlighted diffs via `syntect`. Disciplined.
- **bottom** — Canvas + Braille for CPU/memory/network graphs. Sub-cell
  density is its signature.
- **oatmeal** — "fancy chat bubbles" via styled `Block` with rounded
  borders, syntax-highlighted code blocks (numbered for copy), TextMate
  theme support. Closest analog for `pd vibe`.
- **presenterm** — leverages Kitty/iTerm2/WezTerm/Ghostty for actual
  inline images + animated gifs, font-size escapes for big text,
  reveal-line-by-line code. Demonstrates "TUI" can look indistinguishable
  from a slide app on capable terminals.
- **scope-tui** — Canvas + Braille oscilloscope. The way to think about
  `pd watch --visual`.
- **chess-tui, crossword, minesweep-rs** — game-grid layouts using
  HalfBlock or Quadrant. Proof non-textual grids work.
- **mdfried** — headers rendered as big-text. Closest existing app to
  neobrutalist TUI typography.
- **yazi** — async I/O for video previews via terminal graphics protocols.

**Consistent techniques that beat the default look:**
(a) Canvas-Braille/HalfBlock for any data viz, never sparklines alone;
(b) Tabs + popups themed, not stock; (c) syntect for code; (d)
ratatui-image when imagery exists; (e) big-text for hero numbers; (f)
custom border sets.

---

## 9. Honest limits — never promise

1. **No real z-order/compositor.** `Clear` is the only erase tool.
2. **No anti-aliasing.** Cell grid (or sub-cell 2×4 dot grid) is the floor.
3. **Truecolor not universal.** macOS Terminal.app and older Win consoles
   render wrong.
4. **Image protocols are non-uniform.** Kitty: best. iTerm2: solid. WezTerm:
   Sixel solid, Kitty buggy. Ghostty: solid Kitty. tmux: passthrough since
   3.4+. Windows Terminal: Sixel since v1.22 (Sept 2024). SSH+tmux: most
   image protocols break.
5. **Multi-line styled spans + wrap interact badly.** `Paragraph::wrap` can
   lose styled-span boundaries on wrap points.
6. **Mouse capture eats native text selection.** Power users hate this.
7. **Performance ceiling at very high cell counts.** 4K terminal with full
   Braille canvases everywhere at 60fps can drop frames on 2018 hardware.
8. **Custom Widgets need explicit Buffer manipulation.** No SVG, no path
   commands.

---

## Recommended design vocabulary for Port Daddy TUI

Maritime + neobrutalist DNA. Cinnabar/canary on warm ebony. No tiny fonts.

**Typography hierarchy (anti-tiny-font rule):**
- Hero numbers (cost totals, port numbers, queue depth): `tui-big-text` at
  `PixelSize::Full` for marquee, `Quadrant` or `Sextant` for sub-heroes.
  Canary yellow on ebony.
- Section headers (panel titles): `Block::title()` with `Modifier::BOLD` in
  cinnabar.
- Body: standard `Paragraph`/`List`/`Table`. Never below default cell size.
- Code (chat code blocks): syntect-highlighted spans, ebony bg, desaturated
  palette so it doesn't fight chrome.

**Borders & chrome (neobrutalist rule):**
- Custom `border::Set` with `▓` heavy fills on the active panel, plain on
  inactive — clear focus signal.
- `QuadrantOutside` borders for "pressed" / selected states.
- Drop-shadow via offset Block at (x+1, y+1) in pure black.
- Title strips: full-width Block with `bg(cinnabar) fg(ebony)` and BOLD.

**Maritime flag glyphs:**
- Canvas with `Marker::HalfBlock` at coord-space (0..16, 0..16). ICS Mike,
  Foxtrot, November, Yankee are all rectilinear and stay recognizable at
  8×8 cells (= 16×16 halfblock pixels).
- For diagonal-split flags (Oscar, Bravo): `Marker::Octant` at 12×12 cells.
- Inline in chat where space is <4 cells: single-char Unicode glyph
  fallback OR a 2-letter code like `[KI]` for Kilo.

**Per-command vocabulary:**

| Command | Primary widgets | Effects | Distinctive |
|---|---|---|---|
| `pd vibe` | `tui-textarea` input, `tui-scrollview` of styled `Paragraph` bubbles (rounded Block), syntect for code, `throbber-widgets-tui` for "agent thinking" | `tachyonfx::fade_in` on new bubbles, `slide_in` from bottom | Cinnabar bubbles for user, ebony+canary border for agent. Flag glyph beside each agent name. |
| `pd watch --visual` | `Canvas` (Braille) for DAG edges, custom `Widget` for nodes (HalfBlock pixel icons), `Sparkline` for tick activity | `sweep_in` on new node, `pulse` on active edges | Non-linear DAG via manual `Position` placement. Edges as Braille lines on Canvas overlay. |
| `pd costs` | `tui-big-text` hero ($X.XX), `Table` for backends, `Sparkline` per-row for 24h trend, `Chart` with Braille marker for cumulative | `evolve` on cost-number changes, `fade_to` on row-update | Big-text dollar amount dominates. Canary on ebony. Sparkline rows in cinnabar. |
| `pd inbox` | `List` with stateful selection, `Paragraph` preview pane with wrap, `Tabs` for actor filter, `Scrollbar` | `slide_in_from_right` for preview, `dissolve` on message-read | Border-set distinguishes unread (heavy ▓) vs read (plain). Tabs styled with cinnabar underline. |

**Color tokens (RGB, truecolor required — we ship Kitty/Ghostty/iTerm2/WezTerm/modern WinTerm):**
- ebony `Rgb(30, 27, 24)`
- cinnabar `Rgb(204, 61, 46)`
- canary `Rgb(247, 207, 71)`
- paper `Rgb(228, 218, 196)`
- slate `Rgb(80, 75, 70)`

**Refuse in mocks** (so we don't promise what we can't ship):
- True overlapping translucent panels — use `Clear`-popups.
- Smooth gradients across large regions — only short header gradients.
- Anti-aliased curves — embrace stair-step or use Braille.
- Animations longer than ~600ms — feels janky beyond that.
- Inline raster images outside `pd vibe` / `pd watch` until terminal
  support is confirmed.

---

## Researcher follow-up handle

Open questions worth a follow-up `SendMessage` (agentId `afc58e7162e00b064`):

- Can Canvas + `Marker::Octant` render the Yankee diagonal-stripe pattern
  at 8×8 cells recognizably? Worth a code-spike answer.
- What's the actual on-screen feel of `tachyonfx::sweep_in` at 60fps in
  Ghostty vs Alacritty? Performance + visual fidelity comparison.
- Does `ratatui-image` survive a tmux session on Ghostty? Need a definitive
  answer before promising imagery in `pd vibe`.
- Best `Block::border_set` configuration for the "neobrutalist filled
  edge"? Concrete `symbols::border::Set` values.
- Is there prior art for FIPA-performative tags as TUI chrome (anywhere)?
- Latest on `ratatui-image` 1.0 perf in non-Kitty terminals — halfblock
  fallback quality at chat-bubble sizes.

---

## Sources

- [Ratatui showcase](https://ratatui.rs/showcase/widgets/)
- [Third-party widgets](https://ratatui.rs/showcase/third-party-widgets/)
- [Apps showcase](https://ratatui.rs/showcase/apps/)
- [v0.30 highlights](https://ratatui.rs/highlights/v030/)
- [Canvas docs](https://docs.rs/ratatui/latest/ratatui/widgets/canvas/struct.Canvas.html)
- [Marker enum](https://docs.rs/ratatui/latest/ratatui/symbols/enum.Marker.html)
- [Layout docs](https://docs.rs/ratatui/latest/ratatui/layout/index.html)
- [BorderType docs](https://docs.rs/ratatui/latest/ratatui/widgets/block/enum.BorderType.html)
- [Color enum](https://docs.rs/ratatui/latest/ratatui/style/enum.Color.html)
- [awesome-ratatui](https://github.com/ratatui/awesome-ratatui)
- [tui-widgets monorepo](https://github.com/joshka/tui-widgets) (home of tui-big-text)
- [tui-textarea](https://github.com/rhysd/tui-textarea)
- [tui-scrollview](https://github.com/joshka/tui-scrollview)
- [throbber-widgets-tui](https://github.com/arkbig/throbber-widgets-tui)
- [tachyonfx](https://github.com/junkdog/tachyonfx)
- [ratatui-image](https://github.com/benjajaja/ratatui-image)
- [gitui](https://github.com/gitui-org/gitui), [bottom](https://github.com/ClementTsang/bottom), [oatmeal](https://github.com/dustinblackman/oatmeal), [presenterm](https://github.com/mfontanini/presenterm), [scope-tui](https://github.com/alemidev/scope-tui)
