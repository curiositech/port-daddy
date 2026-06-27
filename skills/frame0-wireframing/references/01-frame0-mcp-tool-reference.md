# Frame0 MCP Tool Reference

Accurate parameter contracts for every Frame0 MCP tool, verified against the live MCP tool schemas
(June 2026). Tool names are prefixed `mcp__frame0__` at the wire level; below they're given bare.
**Required** params are marked; everything else is optional with its default noted.

> Prerequisite: the **Frame0 desktop app must be running** — the MCP bridges to it over a local port
> (e.g. `localhost:58320`). If calls fail with a connection/`request_api_token` error, the app is closed;
> ask the user to launch Frame0.

## The shape & coordinate model

- **Absolute coordinate system.** `left`/`top` are absolute canvas coordinates (top-left origin, +x right,
  +y down). A frame placed at some origin; children you create with explicit `left`/`top` should fall inside it.
- **`parentId`** attaches a shape to a parent (typically a frame). Parented shapes move/group with the parent.
  Always pass `parentId: <frameId>` for a screen's contents.
- **`move_shape` is RELATIVE** — it takes `dx`/`dy` deltas, not a destination. To place something precisely,
  create it near where it goes, then nudge.
- **Every create call returns the new shape's `id`.** Capture it: connectors, `set_link`, `group`,
  `align_shapes`, `move_shape`, `update_shape`, `delete_shape` all address shapes by ID.
- **Colors are hex strings** (`"#000000"`). For wireframes keep fills `#FFFFFF` and strokes `#000000`/grey.

## Pages

A Frame0 document has pages; each page holds frames and shapes. **You must add a page before creating a frame.**

| Tool | Required | Optional (default) | Notes |
|---|---|---|---|
| `add_page` | `name` | — | The new page **becomes the current page**. Do this before `create_frame`. |
| `get_current_page_id` | — | — | Returns the active page's ID. |
| `get_all_pages` | — | `exportShapes`(false) | List pages; set `exportShapes:true` to include each page's shapes. |
| `get_page` | — | `pageId`(current), `exportShapes`(true) | Full data for one page; defaults to current page. |
| `set_current_page_by_id` | `pageId` | — | Switch active page. |
| `duplicate_page` | `pageId` | `name` | Clone a page (e.g. a screen variant). |
| `update_page` | `pageId`, `name` | — | Rename a page. |
| `delete_page` | `pageId` | — | Remove a page. |

## Frames (screens)

| Tool | Required | Optional (default) | Notes |
|---|---|---|---|
| `create_frame` | `frameType`, `name` | `fillColor`(`#ffffff`) | `frameType` ∈ `phone` \| `tablet` \| `desktop` \| `browser` \| `watch` \| `tv`. **Add a page first.** Returns the `frameId` you pass as every child's `parentId`. |

## Shapes

### create_rectangle
Required: `name`, `left`, `top`, `width`, `height`.
Optional: `corners`(`[0,0,0,0]`), `fillColor`(`#ffffff`), `strokeColor`(`#000000`), `parentId`.
- `corners` is `[left-top, right-top, right-bottom, left-bottom]` radii — e.g. `[8,8,8,8]` for a card, `[6,6,6,6]`
  for a button, `[20,20,20,20]` for a pill.
- The workhorse for buttons, inputs, cards, panels, bars, image placeholders.

### create_text
Required: `name`, `left`, `top`, `text`.
Optional: `type`(label\|paragraph\|heading\|link\|normal), `fontSize`, `fontColor`(`#000000`), `width`, `parentId`.
- **`text`**: plain text only. Use a real **newline char (0x0A)**, never the literal `\n`. **No HTML/CSS.**
- **Auto-sizes** to its content; the schema explicitly says position must be adjusted afterward with `move_shape`
  based on the resulting width/height. So: create, read back size if needed, nudge.
- For `type:"paragraph"`, **set `width`** (at create or via `update_shape`) so the text wraps.
- `type` picks the role/weight: `heading` for titles, `label` for buttons/captions, `link` for navigable text.

### create_ellipse
Required: `name`, `left`, `top`, `width`, `height`.
Optional: `fillColor`(`#ffffff`), `strokeColor`(`#000000`), `parentId`.
- Square (`width==height`) = avatar/radio/status dot.

### create_icon
Required: `name`, `left`, `top`, `size`.
Optional: `strokeColor`(`#000000`), `parentId`.
- `size` ∈ `small`(16×16) \| `medium`(24×24) \| `large`(32×32) \| `extra-large`(48×48).
- **`name` must be a real icon name** — Frame0 ships ~1,500 sketch-style glyphs derived from **Lucide**. Discover
  valid names with **`search_icons`** first.
- ⚠️ **Schema wording gotcha**: `create_icon`'s description says the name should come from a `get_available_icons`
  tool. The tool actually exposed over this MCP is **`search_icons`**. Use `search_icons`.

### search_icons
Required: none. Optional: `keyword`.
- Filters icons by name or tags, case-insensitive. Returns valid icon names to feed `create_icon`.
- Call it once per distinct glyph you need (e.g. `search`, `menu`, `user`, `chevron-right`, `plus`, `bell`).

### create_line
Required: `name`, `x1`, `y1`, `x2`, `y2`.
Optional: `strokeColor`(`#000000`), `parentId`.
- A straight segment by endpoints. Dividers, tab underlines, rules.

### create_polygon
Required: `name`, `points` (≥3, each `{x,y}`).
Optional: `closed`(true), `fillColor`(`#ffffff`), `strokeColor`(`#000000`), `parentId`.
- Custom shapes: chevrons, triangles, badges, callout arrows. `closed:false` makes a polyline.

### create_image
Required: `name`, `mimeType`, `imageData`, `left`, `top`.
Optional: `parentId`.
- `mimeType` ∈ `image/png` \| `image/jpeg` \| `image/webp` \| `image/svg+xml`. `imageData` is base64.
- Use to drop a real screenshot/logo to trace — but a screenshot pulls toward hi-fi, so use sparingly in a wireframe.

## Connectors (relationships / flow arrows)

### create_connector
Required: `name`, `startId`, `endId`.
Optional: `startArrowhead`(`none`), `endArrowhead`(`none`), `strokeColor`(`#000000`), `parentId`.
- Connects two **existing** shapes by ID — create both endpoints first, capture IDs, then connect.
- Arrowhead enums are rich: `arrow`, `solid-arrow`, `triangle`, `triangle-filled`, `circle`, `circle-filled`,
  `diamond`, `bar`, `cross`, `dot`, plus ER crowfoot variants (`crowfoot-one`, `crowfoot-many`,
  `crowfoot-zero-one`, …). For a flow arrow use `endArrowhead:"arrow"`.

## Edit operations

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `move_shape` | `shapeId`, `dx`, `dy` | — | **Relative** move by delta. Not absolute. |
| `update_shape` | `shapeId` | `name`,`width`,`height`,`fillColor`,`strokeColor`,`fontColor`,`fontSize`,`text`,`corners` | Mutate props in place — e.g. set a paragraph's `width`, recolor, retext. |
| `duplicate_shape` | `shapeId` | `dx`,`dy`,`parentId` | Clone + offset. Ideal for repeating list rows (`dy: rowHeight`). |
| `delete_shape` | `shapeId` | — | Remove a shape. |
| `align_shapes` | `alignType`, `shapeIdArray` | — | `alignType` ∈ align-left/right/top/bottom, align-horizontal-center, align-vertical-center, distribute-horizontally, distribute-vertically, bring-to-front, send-to-back. Center a label over its button; distribute a row of icons. |
| `group` | `shapeIdArray` | `parentId` | Group shapes; returns a group ID. Group a button's rect+label so they move together. |
| `ungroup` | `groupId` | — | Reverse `group`. |

## Links & export

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `set_link` | `shapeId`, `linkType` | `pageId`(if `page`), `url`(if `web`) | `linkType` ∈ `none` \| `web` \| `page` \| `action:backward`. `page` → navigate to another page (needs `pageId`); `web` → open `url`; `action:backward` → "go back". This is what makes a wireframe a clickable prototype. |
| `export_page_as_image` | — | `pageId`(current), `format`(`image/png`) | Export a whole page. `format` ∈ png\|jpeg\|webp. Use to share for review. |
| `export_shape_as_image` | `shapeId` | `format`(`image/png`) | Export a single shape/frame. |

## Quick gotcha checklist

- Add a **page before** a frame.
- Children of a screen need **`parentId: frameId`**.
- **`move_shape` is delta-based**, not absolute.
- **`search_icons` before `create_icon`** (ignore the schema's `get_available_icons` wording).
- Text: real newline (0x0A), no `\n`, no HTML; paragraphs need a `width`.
- **Create endpoints before connectors**; create target **pages before `set_link`**.
- Keep it **grayscale** — color is a mockup concern.
