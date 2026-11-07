# pd-console Story Linework Sandboxes

This directory is the static Story Linework gallery for testing the visual
language before anything reaches the production console. It stays deliberately
separate from `pd-console` itself and from the headless Rust prototype.

Open `index.html` directly in a browser for the gallery. The page is self-contained,
easy to review, and cheap to screenshot without talking to the daemon.

## What Lives Here

- `index.html` / `gallery.css` / `gallery.js` - a four-study gallery with a big
  editorial hero, honest state band, micro-flags, corner ticks, and reduced-motion
  canvas studies.
- `gallery-manifest.json` - machine-readable summary of the studies, source
  references, and promotion gates for this sandbox.
- `scout-synthesis.md` - bounded recommendations from the GPUI fit, motion, and
  shader scout passes.
- `../../../core/pd-story-linework-proto` - headless wgpu prototype for the GPU
  color-block/dither treatment. It is a standalone workspace and is not included
  in `core/Cargo.toml`.

## Artifacts

- `artifacts/gallery-dark.png` - capture of the static gallery in dark mode.
- `artifacts/gallery-light.png` - capture of the static gallery in light mode.
- `../../../core/pd-story-linework-proto/docs/frames/frame_000.png` - deterministic
  headless wgpu still rendered on Metal from the standalone crate.

## Promotion Rules

1. Static gallery proves taste: palette, typography, visual language, and honest
   states are readable in dark and light mode.
2. Headless prototype proves renderability: the shader or vector pass records
   deterministic PNG or GIF artifacts without a GPUI window.
3. GPUI companion proves integration: a later app or `pd-console` bin uses the
   daemon contract, respects reduced motion, and captures on the pd-proof virtual
   display.
4. Production pd-console only receives a concept after all three have visual proof
   and an operator-state mapping.

## Proof Honesty

The browser gallery is a taste sketch. The Rust prototype is headless GPU proof.
A future GPUI window is compositor proof and must be captured through the
pd-console virtual-display harness. Keep those claims separate in screenshots,
PR bodies, and operator-facing docs.

## State Language

- `pending` - visible deadline or retry budget, never a calm spinner.
- `unknown` - explicit receipt gap; operator can inspect or recover.
- `recovering` - active replay/reconcile path with correlation id visible.
- `confirmed` - receipt-backed state with stable proof.
- `dead-letter` - stopped safely, inspectable, replayable only by explicit action.
