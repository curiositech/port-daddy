# Recording Visual Artifacts of pd-console (and the Vello surfaces)

How to turn the live gpui console — or a bespoke Vello/wgpu surface like `pd-timeline-proto` — into a **PNG / MOV / GIF artifact**, and specifically how to do it **fully in the background**: no window stealing your physical monitor, ideally no OS compositor in the loop at all.

This is the standing answer to the limitation both capture scripts already document:

> *"macOS may deny capture in a headless/automation context ('could not create image from display'). Run this from a Terminal that has Screen Recording permission."* — [`capture-gpui.sh`](../scripts/capture-gpui.sh), [`pd-timeline-proto/scripts/capture.sh`](../../pd-timeline-proto/scripts/capture.sh)

That limitation is real and it is a TCC (Screen Recording permission) wall, not a bug. The methods below are the two ways around it.

## TL;DR

| I want to record… | Use | One-liner |
|---|---|---|
| A **Vello/wgpu surface** (`pd-timeline-proto`), headless / in CI | **A** — offscreen render + ffmpeg | `PD_TIMELINE_RENDER_OFFSCREEN=out.mp4 cargo run --release` |
| The **whole gpui shell**, off your physical monitor | **B** — headless virtual display | run the app on a BetterDisplay/dummy-HDMI screen, capture that display |
| Interactive **PR screenshots** of the shell | **0** — live-window capture | `core/pd-console/scripts/capture-gpui.sh` (needs a permitted Terminal) |

Only **Method A** is truly window-free and TCC-free (it's the one wired in code). **B** runs the real app but still needs Screen-Recording permission; it just frees your physical screen. The rest of this doc explains why the split falls this way and the gotchas in each.

---

## The load-bearing constraint

Per [ADR-0086 — Operator Console Rendering Stack](../../../docs/adr/0086-operator-console-rendering-stack.md), the console is a **gpui shell** that hosts **Vello/wgpu viz surfaces**. That split decides how you record:

- **gpui's own render loop is bolted to a platform window** (`NSWindow` + `CADisplayLink`). There is no first-class headless gpui renderer — you cannot ask the element tree (panes, widgets, glow, beacons) to draw into a buffer with no window. To capture the *shell*, something has to render a real window somewhere.
- **A Vello/wgpu surface owns its own `wgpu::Device`/`Queue`** (see `core/pd-timeline-proto/src/scene.rs`). You can drive that render with **no window at all** — point it at an offscreen texture and read the pixels back.

So the method you pick is dictated by *what you're filming*, not preference:

| What you're recording | Layer | Method | Truly headless? |
|---|---|---|---|
| The whole console / a pane | gpui shell | **Method 0** (today) or **Method B** | 0: no · B: off your monitor, still needs TCC |
| A bespoke vector/shader surface | Vello/wgpu (e.g. `pd-timeline-proto`) | **Method A** | Yes — no window, CI-able |

---

## Method 0 — Live-window capture (what we ship today)

Both [`capture-gpui.sh`](../scripts/capture-gpui.sh) and [`pd-timeline-proto/scripts/capture.sh`](../../pd-timeline-proto/scripts/capture.sh) launch the real window and grab it with:

```
screencapture -x -o -l<CGWindowID>          # still PNG
screencapture -x -V6  -l<CGWindowID>        # 6s MOV
```

The `-l<CGWindowID>` (looked up via Quartz `CGWindowListCopyWindowInfo`, keyed on owner name / PID) grabs **that window's own backing store regardless of z-order**, so a terminal in front can't occlude the shot. That's the clever part and it's worth keeping for the **interactive PR-screenshot flow**.

**The catch:** it needs a real window *and* Screen Recording (TCC) permission for the running process. In a detached agent / CI runner, TCC denies it and you get a black frame or `could not create image from display`. It is **not** a background path. Use it from a permitted Terminal, for the human-in-the-loop "every gpui diff ships window screenshots" rule.

---

## Method A — Offscreen render → read back → encode (the headless path)

Fully background. **Available for the Vello/wgpu surface** (`pd-timeline-proto` and any future T3 surface), because that surface renders through our own `wgpu` stack — redirect it from the windowed swapchain to an offscreen texture and you no longer need a window, a compositor, or TCC permission. This is the CI-able, bit-reproducible path.

### Run it (wired in `pd-timeline-proto`)

```bash
cd core/pd-timeline-proto
PD_TIMELINE_RENDER_OFFSCREEN=docs/timeline-headless.mp4 cargo run --release
```

No window opens; frames stream straight to ffmpeg. Tunables (all optional):

| Env var | Default | Meaning |
|---|---|---|
| `PD_TIMELINE_RENDER_OFFSCREEN` | _(unset)_ | Output path. **Setting it selects the headless path** and bypasses winit entirely. |
| `PD_TIMELINE_RENDER_SECS` | `6.0` | Clip length; the playhead sweeps 0→1 across it. |
| `PD_TIMELINE_RENDER_FPS` | `60` | Frame rate. |
| `PD_TIMELINE_RENDER_W` / `_H` | `2560` / `1440` | Physical pixels. |
| `PD_TIMELINE_RENDER_SCALE` | `2.0` | Logical→physical scale (2× ≈ retina; layout is computed in logical px). |

Requires `ffmpeg` on `PATH` (`brew install ffmpeg`). The whole thing runs in CI / a detached agent — no window, no compositor, no Screen-Recording (TCC) permission.

### Shape (what the implementation does — see `src/main.rs::render_offscreen`)
1. **Headless device.** `RenderContext::device(None)` — a wgpu device with *no compatible surface*. That `None` is the headless seam (still Metal under the hood on macOS).
2. **Offscreen texture, not a surface.** Vello's `render_to_texture` writes through a compute **storage binding**, so the target must be **`Rgba8Unorm` + `STORAGE_BINDING`** (plus `COPY_SRC` to read it back). Note: it's RGBA, *not* the BGRA you'd use for a swapchain blit — so the readback feeds ffmpeg as `-pix_fmt rgba`.
3. **Synthetic clock, not `CADisplayLink`.** `playhead = frame / (total_frames-1)` — one deterministic sweep. Same data + size → byte-identical frames. This is the whole win over Method 0/B: golden-frame-safe, no vsync jitter.
4. **Copy texture → buffer.** `copy_texture_to_buffer`. **`bytes_per_row` padded to `wgpu::COPY_BYTES_PER_ROW_ALIGNMENT` (256)** — un-pad each row on readback or every frame shears diagonally.
5. **Map + read.** `slice.map_async(MapMode::Read)` then `device.poll(Maintain::Wait)` (mandatory — without it you read stale/garbage pixels), un-pad rows, `unmap()`.
6. **Encode.** Raw RGBA streamed to ffmpeg stdin:

```
ffmpeg -y -f rawvideo -pix_fmt rgba -s 2560x1440 -r 60 -i - \
       -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4
```

For a GIF, encode the MP4 first, then a two-pass `palettegen`/`paletteuse` — never one-pass GIF quantization.

### Gotchas that cost an afternoon
- **256-byte row padding** — un-pad on readback (the usual "sheared video" cause).
- **Channel order** — vello `render_to_texture` is `Rgba8Unorm` → `-pix_fmt rgba`. (A swapchain path would be BGRA; don't copy that habit here.) Red/blue swapped means you got this wrong.
- **`STORAGE_BINDING` on the target** — omit it and vello can't write the texture at all.
- **Premultiplied alpha** — if capturing transparency, un-premultiply before encode or edges fringe.
- **`device.poll(Wait)`** before reading the mapped buffer is not optional.

**Status: wired.** `render_offscreen` in `core/pd-timeline-proto/src/main.rs` implements all of the above behind `PD_TIMELINE_RENDER_OFFSCREEN`. The live-window `capture.sh` (Method 0) remains for interactive PR stills. For the **gpui shell** there is still no Method-A equivalent — the element tree can't render windowless (see the constraint above), so the shell uses Method B.

---

## Method B — Headless virtual display (record the whole shell, off your monitor)

When you need the **entire gpui console** — panes, widgets, hover motion, the lane surface — you can't escape the window, so give it a screen that isn't your monitor.

1. **Create a virtual display** — [BetterDisplay](https://github.com/waydabber/BetterDisplay) virtual display, or a physical **dummy HDMI/headless plug**. The OS treats it as a real screen, the compositor + `CADisplayLink` keep rendering at full cadence, but nothing shows on your physical monitor.
2. **Place the console window on that display** (move it there, or make the virtual display primary for the run).
3. **Record that display** — ScreenCaptureKit (modern, per-display, hardware-encoded), `ffmpeg -f avfoundation -i "<display-index>"`, or `screencapture -V`. Target the **virtual** display.

**Trade-offs:** real app, zero rendering-code changes, real cadence, captures exactly what a user sees — but it still needs Screen Recording (TCC) permission (it's a screen capture), it's **non-deterministic** (wall-clock vsync, jitter, dropped frames under load), and it films a live compositor — so kill any stray `.repeat()` animations and confirm idle is 0 re-renders before rolling, or the clip captures churn. The win over Method 0 is purely that it **frees your physical screen** so the take can run unattended while you work.

---

## Decision

```
Recording a pd-console visual artifact, want it in the background
        │
        ├─ Is it a Vello/wgpu surface (pd-timeline-proto, future T3)? ─yes─▶ METHOD A
        │     offscreen wgpu texture + ffmpeg · no window · no TCC · CI-able · deterministic
        │
        └─ Need the whole gpui shell / a pane? ──────────────────────────▶ METHOD B
              virtual display + screen capture · real app · off your monitor · still needs TCC
                                                                            │
        Interactive PR screenshots from a permitted Terminal? ─────────────▶ METHOD 0 (capture-gpui.sh)
```

**Never** foreground the app on your physical monitor and capture the main display — that's neither headless nor reproducible and it blocks the machine for the length of the take. If you reach for that, you wanted Method B.

---

### See also
- [`../scripts/capture-gpui.sh`](../scripts/capture-gpui.sh) — Method 0 for the gpui shell (per-pane window stills).
- [`../../pd-timeline-proto/scripts/capture.sh`](../../pd-timeline-proto/scripts/capture.sh) — Method 0 for the Vello surface; the target to upgrade to Method A.
- [ADR-0086 — Operator Console Rendering Stack](../../../docs/adr/0086-operator-console-rendering-stack.md) — the gpui-shell / Vello-surface split this doc keys off.
- The `rust-gpui-motion` skill (`references/07-headless-recording.md`) — the framework-level version of this guidance.
