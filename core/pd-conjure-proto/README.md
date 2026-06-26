# pd-conjure-proto — Conjure VELLO GRAPH slice

The **VELLO GRAPH** slice of the Conjure feature: render a `PredictedDag` (the
windags `next_move` planner output, mirrored from `pd-console::conjure`) as a
beautiful **wave-column node-graph** with **Vello + Parley**, captured
**OFFSCREEN** to a PNG. No window, no Screen-Recording / TCC permission. This is
the **Rung-1** path (NOT bare Metal), per
[`docs/CONJURE-DAG-SURFACE.md`](../pd-console/docs/CONJURE-DAG-SURFACE.md) (proposed — designed-not-built).

It mirrors the stack and the headless capture of `pd-timeline-proto` /
`pd-flag-proto`, and is likewise **excluded from the `core/` workspace** (its own
empty `[workspace]` + own `Cargo.lock`) so the heavy wgpu/Vello/Parley dep tree
stays out of the Linux `rust-console` CI job.

## What it draws

- **Layout** — wave columns: `x = wave_number`, nodes stacked and centered
  vertically within a column (ported from the React-Flow math in
  `workgroup-ai/packages/cli/src/visualize-dag.ts`).
- **Node card** — a rounded-rect panel (peniko fill + commitment-styled stroke +
  left accent rail + header strip) with Parley-shaped text: `skill_id` eyebrow,
  `role_description`, and a model/cost footer. `model_tier` is rendered
  **verbatim** — it may be `gemini` / `codex` / `groq`, never coerced to Claude.
- **Edges** — feed-forward cubic beziers between consecutive waves, styled by the
  target node's `commitment_level`:
  - `COMMITTED` → solid + accent glow (canary),
  - `TENTATIVE` → dashed (cobalt),
  - `EXPLORATORY` → dotted + faint.
- **Gate marker** — a danger-red dot + ring + "gate" label when
  `ask_user_before_proceeding` (the HITL pause).
- **Maritime palette** — bg ebony `#1e1b18`, panel `#2b2724`, accent canary
  `#ffdb33`, success `#6dd3a8`, danger `#f26475`, cobalt `#7fc4ff`, ink `#f5f5f0`.

## Run (offscreen, headless)

```sh
cd core/pd-conjure-proto
cargo run --release                       # fixture.json -> conjure-dag-vello.png
cargo run --release -- my-dag.json out.png
# or:
scripts/capture.sh [INPUT.json] [OUTPUT.png]
```

The input JSON matches the `PredictedDag` field names exactly, so
`conjure::fixture()` serialized to JSON (the bundled `fixture.json`) deserializes
straight in — the proto does **not** depend on the gpui crate.

## Why release, not debug

On macOS 15+ (Darwin 25) the parley/fontique system-font scan trips objc2
0.5.2's **debug-only** message-signature verification — a spurious `'q'` vs `'Q'`
return-encoding check on Core Text's `NSFastEnumeration`. That check is
`#[cfg(debug_assertions)]`, so a **release** build (debug_assertions off) skips it
and the font scan completes; the message send itself is ABI-correct. Debug builds
panic in `fontique::scan::scan_paths`.

## Offscreen capture (Method-A)

1. `RenderContext::device(None)` → a headless wgpu device (no surface, lands on
   Metal on macOS, opens no window).
2. `Renderer` with `surface_format: None` (offscreen only).
3. `render_to_texture` into an `Rgba8Unorm` texture (`STORAGE_BINDING | COPY_SRC`).
4. `copy_texture_to_buffer` (256-byte row alignment), `map_async`, `block_on_wgpu`.
5. Crop padded rows, encode RGBA8 → PNG.
