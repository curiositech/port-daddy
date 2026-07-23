# gpui-main headless self-capture — feasibility spike

**Question.** Can pd-console capture its own GPUI/Metal UI **headlessly** (no window,
no virtual display, no Screen-Recording permission, no gpui fork) by upgrading gpui
from the crates.io `0.2.2` pin to a `zed-industries/zed` `main` git-rev?

**Verdict: WORKS — but churny.** The capture API is real, ships on gpui `main`, and
produces true offscreen Metal pixels in *our* toolchain. pd-console itself compiles
clean against gpui-main with a small, purely mechanical patch. The cost is not the
code churn — it is the **Rust 1.95 toolchain floor** and a dependency on an
**unreleased git-rev of a large, fast-moving repo**. Recommendation:
**adopt after gpui stabilizes / publishes the capture API to crates.io** (or when the
team deliberately accepts a pinned zed git-rev + 1.95 CI). Keep the CPU `Block`-raster
"third face" and the Vello capture.sh path for viz until then.

This report supersedes the "will NOT port to 0.2.2" conclusion in
[`artifacts/gpui/HEADLESS-CAPTURE.md`](artifacts/gpui/HEADLESS-CAPTURE.md) for the
`gpui-main` case: gpui `main` added exactly the seams that table listed as missing.

---

## Exact configuration that works

- **gpui git rev:** `7cdf2ae6b62c699670d6dcb04b9c7ffd06a35f1a` (zed `main`, 2026-07-23)
- **crates + features:**
  ```toml
  gpui          = { git = "https://github.com/zed-industries/zed", rev = "7cdf2ae6…", features = ["test-support"] }
  gpui_platform = { git = "https://github.com/zed-industries/zed", rev = "7cdf2ae6…", features = ["test-support"] }
  ```
- **Rust:** **1.95.0** (mandatory — see Toolchain below)
- Proof artifact: [`artifacts/gpui/gpui-main-capture-probe/proof.png`](artifacts/gpui/gpui-main-capture-probe/proof.png)
  — a 1280×720 real Metal offscreen capture; MANIFEST alongside it.

## The capture path that works (and the one that does NOT)

gpui `main` exposes **two** offscreen paths. Only the second gave us pixels here:

1. **`VisualTestAppContext` + `open_offscreen_window`** — opens a *real* AppKit window
   parked at `(-10000,-10000)` and (per its own module docs) captures via
   ScreenCaptureKit. In this harness `capture_screenshot` on that path panicked with
   `render_to_image not implemented for this platform` (the window's `render_to_image`
   fell through to the default trait impl). Also wants Screen-Recording permission.
   **Not the agent-safe path.**

2. **`HeadlessAppContext::with_platform(text_system, assets, renderer_factory)` +
   `gpui_platform::current_headless_renderer()`** — a `TestPlatform` (mocked windows,
   no compositor) wired to a **real `MetalHeadlessRenderer`**. `window.render_to_image()`
   renders the `Scene` to an offscreen Metal texture and reads the pixels back. **No
   window, no display, no TCC.** This is the one to adopt. See `probe-main.rs`.

The pieces the `0.2.2` table listed as private/absent are now public on `main`:
`PlatformHeadlessRenderer` trait + `MetalHeadlessRenderer` (via
`gpui_platform::current_headless_renderer`), `Window::render_to_image()` (public
scene→RgbaImage), and the `HeadlessAppContext` wiring.

**Caveat observed:** with a no-op `AssetSource`, **glyphs did not rasterize** (the flex
layout and fills rendered correctly; the text child was blank). Real pd-console capture
must pass the crate's real `Assets` (the `with_asset_source` / `with_assets` path) so
fonts + SVG icons load. Not a blocker; a wiring detail.

## Toolchain (the real gate #1)

gpui `main` calls `std::hint::cold_path()` in `crates/gpui/src/profiler.rs` **without a
`#![feature]` gate** — i.e. it assumes `cold_path` is *stable*. It stabilized in
**Rust 1.95.0**. Consequences:

- Repo default `rustc` (Homebrew **1.94.0**) → hard fail: `E0658: use of unstable
  library feature 'cold_path'` (issue #136873). rustup `stable` 1.91.1 and
  `nightly-2025-11-20` (1.93) fail the same way.
- zed's own `rust-toolchain.toml` pins `channel = "1.95.0"`.
- **Adopting gpui-main forces pd-console (and the macOS CI gate) onto Rust ≥ 1.95.0.**

## pd-console churn (gate #2 — small and mechanical)

Swapping the pin and building `cargo build --features gpui --bin pd-console` (on 1.95)
compiled all dependencies (gpui-main built cleanly as a dep) and left **9 errors, all
in pd-console's own source — 6 distinct API drifts, ~5 months of gpui evolution:**

| # sites | error | cause | fix |
|---|---|---|---|
| 1 | `Application::new()` gone | **platform split** ("GPUI on the web"): real-platform ctors moved to `gpui_platform` | `gpui_platform::application()` (+ add `gpui_platform` dep) |
| 1 | `DisplayId: Into<u32>` unimpl | `DisplayId` is now `u64`-backed | `let id: u64 = d.id().into();` |
| 1 | `window.focus(&fh)` arity | `focus(&mut self, handle, cx: &mut App)` gained `cx` | `window.focus(&fh, cx)` |
| 3 | `BoxShadow` missing field `inset` | struct gained `pub inset: bool` | add `inset: false` |
| 1 | `track_scroll(handle)` type | takes `&handle` now | `track_scroll(&handle)` |
| 2 | `flex_grow()`/`flex_shrink()` arity | now take an `f32` | `.flex_grow(1.0)` / `.flex_shrink(1.0)` |

**Effort: ~1–2 hours.** After the patch, `cargo build --features gpui --bin pd-console`
is **green on 1.95**, and the non-gpui `cargo build -p pd-console` is unaffected. The
full turnkey diff is
[`artifacts/gpui/gpui-main-capture-probe/adoption.patch`](artifacts/gpui/gpui-main-capture-probe/adoption.patch)
(14 insertions / 8 deletions across 3 files). It is **not applied to this branch** —
see recommendation.

## The self-capture *test* (the prize) — why it is not in this branch

pd-console is a **binary crate with no `lib` target**. A real self-capture test must be
an in-crate `#[cfg(test)]` module, so running it needs `cargo test --features gpui`,
which compiles the whole bin test target — including the existing
`headless_capture::gpui_headless` module (old `TestAppContext::single()`/`add_window`
API that drifted on `main`) **and** a documented pre-existing crate-wide **SIGBUS in the
`gpui_macros` proc-macro** under `cargo test --features gpui`. Wiring a runnable
in-tree capture test therefore means adopting the pin **and** repairing that test path —
out of scope for a bounded spike, and gated behind the same toolchain/rev decision. The
**standalone probe already proves the pixels**; the in-tree test is deferred to the
adoption work.

## Recommendation

**Adopt after gpui stabilizes — do not bump the repo pin now.**

- ✅ The capability is proven end-to-end (real `proof.png`).
- ✅ pd-console is genuinely adoptable (clean build, tiny patch).
- ⚠️ Blocker for *now*: pinning an unreleased zed git-rev of a huge, fast-moving repo,
  plus forcing the whole build + CI onto Rust 1.95. The 9-error patch will re-drift on
  every rev bump.
- ➡️ **Trigger to adopt:** gpui ships a crates.io release exposing
  `HeadlessAppContext` + `current_headless_renderer` + `render_to_image`, **or** the
  team decides to carry a pinned zed rev + 1.95 toolchain deliberately.
- 🅿️ **Until then:** keep `headless_capture.rs` (CPU `Block` raster — faithful third
  face for CI-safe pixels) and the Vello `capture.sh` offscreen path for the work
  graph. This spike's probe + `adoption.patch` are the turnkey reference for the swap.

When adopted, the win is concrete: **agent-self-captured pd-console Metal pixels** with
no window, no virtual display, and no Screen-Recording permission — closing the gap
`HEADLESS-CAPTURE.md` documented as impossible on `0.2.2`.
