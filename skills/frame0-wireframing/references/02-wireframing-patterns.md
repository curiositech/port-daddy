# Wireframing Patterns — UI Element Cookbook

Canonical Frame0 recipes for the UI elements that show up in almost every screen. Each recipe is the
sequence of tool calls (with the params that matter) to build that element inside an already-created frame.
Assume you hold `frameId` from `create_frame`; pass `parentId: frameId` on every shape.

## Layout discipline (do this before placing anything)

- **Grayscale only.** Fills `#FFFFFF`, strokes `#000000` for primary edges, `#777777`/`#999999` for secondary
  text and placeholders. No brand color — that's a mockup. (See `04-when-wireframe-vs-mockup.md`.)
- **Spacing on a coarse grid.** Use an 8px rhythm (8/16/24/32) for gaps and a consistent gutter (16–24px) from
  frame edges. Coarse-but-consistent reads as intentional and keeps the sketch fast to adjust.
- **One job per element.** A wireframe communicates *what goes where and why*, not how it looks. If you're
  reaching for `fontSize`/color to make a point, the layout probably isn't doing the work.
- **Build top-to-bottom**, capture every `id`, then `align_shapes` to tidy rather than re-creating.

## Source standards
- Low-fi wireframes are deliberately monochrome boxes-and-lines that exclude color, real type, and exact
  sizing, to keep focus on structure and flow ([Justinmind](https://www.justinmind.com/wireframe/low-fidelity-vs-high-fidelity-wireframing-is-paper-dead), [Miro](https://miro.com/wireframe/low-fidelity-vs-high-fidelity-wireframes/)).
- The 12 elements nearly every wireframe needs: nav menu, header, content blocks, CTA buttons, form fields,
  image placeholders, cards, sidebars, footers, modals ([Visily](https://www.visily.ai/blog/wireframe-elements/)).
- An empty state must say *why* it's empty and give a clear next action ([Setproduct](https://www.setproduct.com/blog/empty-state-ui-design)).

---

## Button
1. `create_rectangle` — `corners:[6,6,6,6]`, modest height (~40), `fillColor:"#FFFFFF"`, `strokeColor:"#000000"`. Keep `rectId`.
2. `create_text` — `type:"label"`, the button text, placed over the rectangle. Keep `textId`.
3. `align_shapes` — `alignType:"align-horizontal-center"`, `shapeIdArray:[rectId, textId]`; then `align-vertical-center`.
4. Optional `group` `[rectId, textId]` so the button moves as one.

Primary vs secondary in lo-fi: differentiate by **fill** (filled grey rect = primary) not color.

## Text input / field
1. `create_rectangle` — thin (~40 tall), `corners:[4,4,4,4]`, white fill, black stroke.
2. `create_text` — placeholder, `type:"normal"`, `fontColor:"#999999"`, inset ~12px from the left edge.
3. Optional label above: `create_text` `type:"label"`.

A form = a vertical stack of these. Build one, then `duplicate_shape` with `dy` = field pitch and `update_shape`
the text. Put the submit **Button** at the bottom.

## Card
1. `create_rectangle` — container, `corners:[8,8,8,8]`.
2. Optional media: `create_rectangle` placeholder at the top, or `create_icon` (`extra-large`).
3. `create_text` — `type:"heading"` title.
4. `create_text` — `type:"paragraph"`, **set `width`** (≈ card width − padding) so it wraps.
5. Optional footer action: a **Button** or a `link` text.

Card grid: build one card, `group` it, `duplicate_shape` across `dx`/down `dy`, then `align_shapes`
`distribute-horizontally`.

## Navbar / header
1. `create_rectangle` — full content width, short height (~56), white fill, bottom edge implied by a `create_line`.
2. `create_text` — `type:"heading"` brand/title, left, ~16px gutter.
3. Right-side actions: `search_icons` → `create_icon` (`medium`) for e.g. `search`, `bell`, `user`; place right-aligned.
4. `align_shapes` `align-vertical-center` on all bar contents.

## List row (and a list)
1. `create_rectangle` — full width, ~56 tall (a subtle row; often just a `create_line` divider instead of a box).
2. Leading `create_icon` (`medium`) or `create_ellipse` avatar, left.
3. `create_text` primary label; optional secondary `type:"normal"` `fontColor:"#999999"` beneath.
4. Trailing `create_icon "chevron-right"` (`small`), right.
5. `group` the row, then `duplicate_shape` with `dy` = row height to repeat; `align_shapes` `distribute-vertically`.

## Modal / dialog
1. **Scrim**: `create_rectangle` covering the frame, `fillColor:"#000000"` — in lo-fi just imply dim with a light grey
   `#EEEEEE`; the point is to show the panel sits above content.
2. **Panel**: smaller centered `create_rectangle`, `corners:[12,12,12,12]`, white.
3. Content: `create_text` heading + `paragraph` body + a row of **Buttons** (Cancel / Confirm).
4. Optional close `create_icon "x"` (`small`) top-right of the panel.
5. `align_shapes` `align-horizontal-center` the panel within the frame.

## Empty state
1. `create_icon` — `extra-large`, centered (`search`, `inbox`, `folder`, etc. via `search_icons`).
2. `create_text` — `type:"heading"`, a short "Nothing here yet" line, centered.
3. `create_text` — `type:"paragraph"` with `width`, one sentence explaining *why* and what to do.
4. A **Button** CTA ("Add the first item").
5. `align_shapes` `align-horizontal-center` on the whole stack.

## Tab bar / segmented control
1. Row of `create_text` `type:"label"` tab names, evenly spaced (`align_shapes` `distribute-horizontally`).
2. `create_line` under the active tab to mark selection.
3. (Bottom nav variant: a `create_rectangle` bar + `create_icon`s + tiny labels.)

## Image / media placeholder
1. `create_rectangle` at the media size.
2. Either a centered `create_icon "image"` (`large`) or two `create_line`s as an "X" — the universal "image goes here".
Avoid dropping a real `create_image` unless the user explicitly wants to trace a screenshot; it pulls toward hi-fi.

## Reusing an element
The fastest lo-fi workflow is **build once, duplicate, retext**:
`group` the element → `duplicate_shape` (with `dx`/`dy`) → `update_shape` the inner text. For a whole screen
variant, `duplicate_page`.
