# pd-conjure-proto — Conjure VELLO GRAPH slice

The **VELLO GRAPH** slice of the Conjure feature: render a `PredictedDag` (the
jury_rig `next_move` planner output, mirrored from `pd-console::conjure`) as a
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
  `#d8dd3c` (palette v2 gold), success `#6dd3a8`, danger `#f26475`, cobalt `#7fc4ff`, ink `#f5f5f0`.

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

## Animated artifact (offscreen → ffmpeg, Method-A)

The same headless device can render the DAG as a **motion** artifact — no window,
no Screen-Recording / TCC — by sweeping an animation clock `t ∈ [0,1]` and
streaming each frame's raw RGBA to **ffmpeg** (mirrors `pd-timeline-proto`'s
`render_offscreen`). Set `PD_CONJURE_RENDER_OFFSCREEN=<out.mp4>`:

```sh
cd core/pd-conjure-proto
# Canonical build-and-settle clip (full t 0→1):
PD_CONJURE_RENDER_OFFSCREEN=docs/artifacts/conjure/conjure-dag.mp4 cargo run --release
```

What animates (tasteful, on the maritime palette):
- **Wave-by-wave bloom-in** — cards fade + scale + rise into place, staggered by
  wave index over the first ~45% of the clip (`scene.rs` `wave_bloom`).
- **Breathing committed glow** — COMMITTED cards' outer glow alpha/blur pulse with
  a cosine of `t` (the "presence beacon"), anchored to **0 at the seam** so the
  static PNG (always `t = 1.0`) is unchanged and the loop has no snap.
- **Flowing edges** — a bright pulse travels source→target along each bezier.

Tunables (env): `PD_CONJURE_RENDER_SECS` (5), `_FPS` (30), `_W`/`_H` (default =
canvas × scale), `_SCALE` (2.0), and `_T_START`/`_T_END` (sub-range of the `t`
timeline — used to cut the **settled half** `[0.5, 1.0]` for a seamless looping
gif; bloom is done and the breathe/pulse complete a whole cycle over that window).

Optimized looping gif (two-pass palettegen/paletteuse, width 960):
```sh
# render the settled-half source, then palette-quantize it
PD_CONJURE_RENDER_OFFSCREEN=/tmp-or-coding-tmp/loop.mp4 \
  PD_CONJURE_RENDER_T_START=0.5 PD_CONJURE_RENDER_T_END=1.0 PD_CONJURE_RENDER_SECS=4 \
  cargo run --release
ffmpeg -y -i loop.mp4 -vf "fps=24,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" pal.png
ffmpeg -y -i loop.mp4 -i pal.png \
  -lavfi "fps=24,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a" \
  -loop 0 docs/artifacts/conjure/conjure-dag.gif
```

Tracked artifacts: `docs/artifacts/conjure/conjure-dag.{mp4,gif}`.

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
