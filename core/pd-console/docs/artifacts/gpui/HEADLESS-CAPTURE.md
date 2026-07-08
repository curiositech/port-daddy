# Headless offscreen capture for pd-console

**Problem it solves.** Capturing pd-console's pixels for visual proof was blocked
here: `scripts/proof/capture-proof.sh` renders the real GPUI window onto a
**BetterDisplay virtual monitor** and grabs it with `screencapture` /
ScreenCaptureKit — which needs **Screen-Recording (TCC) permission** and a
**virtual display**. A headless agent shell has neither, and creating a virtual
monitor is now forbidden (an agent once did exactly that chasing GPUI pixels). This
module gives a **window-free, display-free, TCC-free, fork-free** path to a real PNG.

## What metacraft-labs/isonim-gpui actually does (and doesn't)

isonim-gpui's "headless GPUI rendering" (`rust/gpui-nim-shim/tests/gpui_rendering.rs`)
drives its shadow-tree through **GPUI's real element pipeline via `TestAppContext`**
(`cx.add_window(...)`, `cx.read_window(...)`) with **no window and no display**, then
asserts on the resulting **element / layout tree** (tags, child counts, styles,
bounds). It **produces no pixels** — GPUI's test/headless platform uses a **stub
renderer** that runs layout + paint but rasterizes nothing. So isonim's technique is
a *headless render-pipeline test*, **not** a render-to-image. It ports cleanly to our
`gpui = 0.2.2` pin (`Application::headless()` and `TestAppContext` both exist), but it
can never write a PNG. We ported it faithfully anyway — see below — because it is
genuinely useful as a no-display pipeline smoke.

## Why true GPU-pixel offscreen capture will NOT port to gpui 0.2.2

There is **no public path from a rendered GPUI scene to CPU pixels** in gpui 0.2.2.
Verified against the pinned crate source
(`~/.cargo/registry/.../gpui-0.2.2/src`):

| Needed piece | Status in 0.2.2 | Consequence |
|---|---|---|
| `MetalRenderer` (drives Metal) | in `platform/mac/` behind a **private** `mod mac;` | not reachable from a dependent crate |
| `InstanceBufferPool` (arg to `MetalRenderer::new`) | `pub(crate)` | can't construct a renderer |
| Headless / test platform renderer | **stub** (no rasterization) | `Application::headless()` + `TestAppContext` yield no pixels |
| Extract a `Window`'s `Scene` | no public accessor | can't feed a scene to a renderer you own |
| Read back a drawable texture | none (`draw()` presents a `CAMetalLayer` drawable internally) | no `getBytes` hook |
| Any scene→image / screenshot API | none (`to_image_data` is **SVG→RenderImage** only) | nothing to call |

The Metal render target is a `CAMetalLayer` drawable that gpui acquires and presents
inside `MetalRenderer::draw(&Scene)`; every seam you'd need to redirect it offscreen
and read it back is crate-private. **This is a fork-level change, not a downstream
one.**

### Concrete delta to unlock real GPU pixels (pick one)

1. **Patch/vendor gpui 0.2.2** to add an offscreen entrypoint, e.g.
   `pub fn render_scene_offscreen(scene: &Scene, size: Size<DevicePixels>) -> RenderImage`
   that renders into an `MTLTexture` with `framebufferOnly = false` and `getBytes`
   the result. Requires making `platform::mac` (or a thin shim) `pub` and exposing
   `MetalRenderer` + a texture render target. ~150–300 LOC in the fork; then wire
   pd-console's `Window` draw to hand its `Scene` to it.
2. **Bump gpui** to a version that ships offscreen rendering upstream, then wire that
   API here. (Off-limits under the current 0.2.2 pin; tracked as a separate decision.)

Until one lands, the honest options are: (a) the **Block-model raster** below (real
pixels, not Metal), or (b) the old virtual-display + TCC capture (agent-unsafe).

## What this module integrates

`src/headless_capture.rs` (new; feature-independent so it runs on the cheap non-gpui
gate and from any agent shell):

- **`render_blocks(&[Block], &Theme, width) → Canvas`** rasterizes pd-console's
  render-agnostic `Block` primitives — the *same* values the GPUI and ratatui faces
  paint — using the **real locked OKLCH theme** (`theme::DARK`, `Tone::color`). Every
  `Block` variant renders (headers, key/vals, rows, tone chips, ICS flag squares,
  node roster rows with liveness + badges, sparklines, control buttons, chat turns,
  wrapped text, artifact refs).
- **Zero-dependency PNG encoder** (`Canvas::to_png`) — hand-rolled CRC-32, Adler-32,
  and stored-DEFLATE zlib. No new crates.
- **`capture_to_path(path)`** — the runtime entrypoint behind
  `pd-console --headless-capture <path>` (a thin hook in `main.rs`, before any
  window/daemon init).
- **isonim technique, ported**: `#[cfg(all(test, feature = "gpui"))] mod gpui_headless`
  — a plain `#[test]` (this crate has no `#[gpui::test]` precedent) that builds a
  headless `TestAppContext::single()`, mounts a view, and drives GPUI's real element
  pipeline with **no display**. Proves the pipeline runs; it does not (and cannot)
  read pixels.

  **Run status (honest):** `cargo test --features gpui` currently aborts crate-wide
  with a **SIGBUS inside the `libgpui_macros` proc-macro** while expanding the existing
  panes' derives. This is **pre-existing** — proven by disabling this module and
  observing the identical crash — and off any CI path (the macOS gate runs
  `cargo build --features gpui`, which is **green**, as is this hook). So the isonim
  test is API-verified against the gpui 0.2.2 source but is currently un-runnable until
  that separate toolchain crash is fixed. The Block raster above needs none of this and
  is fully proven on the cheap non-gpui gate (`cargo test --bin pd-console-repl`).

This is a faithful **third face** of the one-pane model ("one pane, two faces" → now
three: GPUI Metal, ratatui, and this offscreen raster). It is watermarked in-image
and labeled everywhere so it is **never mistaken for a Metal framebuffer capture**.

## Provenance of `headless-capture-sample.png`

- Renderer: `render_blocks(sample_console_blocks(), &theme::DARK, 960)` → `to_png()`.
- Source: `src/headless_capture.rs`, a deterministic offline `Block` tree (no daemon,
  no network). Not a screenshot of the GPUI app.
- Reproduce (no gpui build, seconds):
  `cargo test --bin pd-console-repl headless_capture` **or**
  `scripts/proof/headless-capture.sh`.
- The bottom red band in the image states its own provenance.
