# Scout Synthesis

Three read-only scouts looked at the Story Linework references, the static
gallery, the existing Rust prototype crates, GPUI proof docs, and pd-console
visual constraints. Their shared conclusion is that the sandbox should now read
like a small editorial operator brief: big color-block hero, explicit state band,
and four study frames. The evidence boundary still must be strict.

## Architecture

- Use a standalone crate with an empty `[workspace]`, like `pd-harbor-proto`,
  `pd-flag-proto`, and `pd-conjure-proto`.
- Keep wgpu/Metal experiments out of `core/Cargo.toml`, `core/Cargo.lock`, and
  normal Linux CI unless a later slice deliberately promotes them.
- Treat GPUI shell proof and headless shader proof as separate lanes. GPUI 0.2.2
  does not provide honest offscreen pixel capture for the whole shell.
- Do not touch production `core/pd-console` until a concept has deterministic
  artifacts and an operator-state mapping.

## Motion Studies

- Pending receipt tick: one-shot `120-200ms`, then a receipt id or timestamp.
- Unknown holds still: no breathing dot, no spinner, no time-only animation.
- Recovering step ledger: each tick maps to a retry/checkpoint event.
- Dead-letter catch: one short catch glow, then a static slab with cause and next
  action.
- Live panel corner claim: corner brackets appear only when heartbeat/transcript
  evidence proves liveness.
- Harbor claim handoff: soft pending wash, solid confirmed band, one-shot conflict
  hatch.

## Shader Studies

- Token-uniform dither atlas: first gate for any shader work. Replace hard-coded
  color literals with packed theme roles before promoting beyond prototype.
- Operator truth pattern set: confirmed, pending, recovering, unknown, and
  dead-lettered must differ by shape/pattern, not color alone.
- Living harbor, re-grounded: ambient substrate only earns motion when it maps to
  source kind, truth state, heat, or recovery.
- Cut-paper grain shader: no-motion cardstock texture for panels, receipts, and
  proof cards.
- Signal-flag micro atlas: tiny badges where shape carries meaning at 12-20px.
- Provenance watermark: every fixture/specimen/live artifact declares source
  truth.

## First Acceptance Criteria

- Static gallery opens directly from `docs/design/gpui-sandboxes/index.html`.
- `node --check docs/design/gpui-sandboxes/gallery.js` passes.
- Dark and light captures should show the editorial hero, state band, and four
  studies without motion-dependent layout changes.
- `cargo check --manifest-path core/pd-story-linework-proto/Cargo.toml` passes.
- A tiny `PD_STORY_FRAMES=2 cargo run --release` produces PNG frames.
- Any screenshot or GIF from fixture data is labeled as fixture/specimen, not live
  daemon proof.
