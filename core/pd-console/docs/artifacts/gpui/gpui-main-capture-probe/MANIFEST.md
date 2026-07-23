# gpui-main headless capture probe — proof artifact

## What `proof.png` is

A **real GPUI (zed `main`) headless Metal capture** — 1280×720 RGBA, rendered with
**no on-screen window, no virtual display, no Screen-Recording (TCC) permission, and
no fork of gpui**. The image shows a flex-centered card (yellow `#ffd23f`) on a green
field (`#1e6f3c`), laid out by GPUI's real element/Taffy pipeline and rasterized by
the real Metal renderer, then read back to CPU pixels.

- **dims:** 1280×720 (2× the requested 640×360 logical size — retina scale factor)
- **sha256:** `81928997cb53fc4d3a7cf888373ef6da3a329d4e67aac359fefdb64e7ccbe6ca`
- **sourceLabel:** **REAL gpui-main Metal capture** (not a CPU raster, not a stub).
  The pixels come from `MetalHeadlessRenderer::render_scene_to_image` reading back an
  offscreen Metal texture. This is the true GPU path the pd-console
  `HEADLESS-CAPTURE.md` table said did **not** exist in the `0.2.2` pin.

## How it was produced

Standalone throwaway crate (kept OUT of the repo workspace), sources archived here as
`probe-Cargo.toml` and `probe-main.rs`:

```
gpui         = { git = "https://github.com/zed-industries/zed", rev = "7cdf2ae6b62c699670d6dcb04b9c7ffd06a35f1a", features = ["test-support"] }
gpui_platform= { git = "…zed…", rev = "7cdf2ae6…", features = ["test-support"] }
```

Capture path (the one that actually works — see doc for the path that did NOT):

```
let ts  = gpui_platform::current_platform(false).text_system();
let mut cx = gpui::HeadlessAppContext::with_platform(
    ts, Arc::new(()), || gpui_platform::current_headless_renderer());   // MetalHeadlessRenderer
let win = cx.open_window(size(px(640.), px(360.)), |_, cx| cx.new(|_| Hello))?;
cx.run_until_parked();
let img: image::RgbaImage = cx.capture_screenshot(win.into())?;         // -> render_to_image()
img.save("proof.png")?;
```

## Provenance / environment

- **gpui git rev:** `7cdf2ae6b62c699670d6dcb04b9c7ffd06a35f1a` (zed `main`, 2026-07-23)
- **Rust:** **1.95.0** required (gpui uses `std::hint::cold_path`, stabilized in 1.95).
  Repo default (Homebrew 1.94.0) FAILS with `E0658: unstable library feature cold_path`.
- **Host:** macOS 26.1 (25B78), Apple Silicon, Xcode 26.1.
- **Capture mode:** offscreen Metal texture readback. No AppKit window shown; no TCC
  Screen-Recording prompt; no BetterDisplay/virtual monitor.

## Files here

| file | what |
|---|---|
| `proof.png` | the real gpui-main headless Metal capture |
| `probe-main.rs` | the throwaway probe's `main()` (the working capture path) |
| `probe-Cargo.toml` | the probe's exact deps + rev + features |
| `adoption.patch` | the 7-fix diff that makes **pd-console itself** compile against gpui-main (see feasibility doc) — provided as a turnkey artifact, NOT applied to the tree |
