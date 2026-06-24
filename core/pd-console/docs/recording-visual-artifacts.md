# Recording Visual Artifacts of pd-console (and the Vello surfaces)

How to turn the live gpui console — or a bespoke Vello/wgpu surface like `pd-timeline-proto` — into a **PNG / MOV / GIF artifact**, and specifically how to do it **fully in the background**: no window stealing your physical monitor, ideally no OS compositor in the loop at all.

This is the standing answer to the limitation both capture scripts already document:

> *"macOS may deny capture in a headless/automation context ('could not create image from display'). Run this from a Terminal that has Screen Recording permission."* — [`capture-gpui.sh`](../scripts/capture-gpui.sh), [`pd-timeline-proto/scripts/capture.sh`](../../pd-timeline-proto/scripts/capture.sh)

That limitation is real and it is a TCC (Screen Recording permission) wall, not a bug. The methods below are the two ways around it.

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

### Shape
1. **Render target is an offscreen texture, not a surface.** `wgpu::Texture`, sized to the artifact, usage `RENDER_ATTACHMENT | COPY_SRC`, format matched to the pipeline (`Bgra8UnormSrgb` is typical on Metal — note **BGRA** order).
2. **Drive a synthetic clock, not `CADisplayLink`.** Advance `t += 1.0/fps` per frame and render the Vello scene at each `t`. This is the whole win: deterministic, golden-frame-safe, decoupled from vsync jitter. (Reuse the autoplay path `pd-timeline-proto` already exposes via `PD_TIMELINE_AUTOPLAY=1`, but tick it from your loop instead of the display link.)
3. **Copy texture → buffer.** `encoder.copy_texture_to_buffer(...)`. **`bytes_per_row` must be padded to `wgpu::COPY_BYTES_PER_ROW_ALIGNMENT` (256)** — un-pad each row on readback or every frame shears diagonally.
4. **Map + read.** `buffer.slice(..).map_async(MapMode::Read)`, then `device.poll(Maintain::Wait)` (mandatory — without it you read stale/garbage pixels), copy bytes out, `unmap()`.
5. **Encode** — pipe raw frames to ffmpeg over stdin:

```
ffmpeg -y -f rawvideo -pix_fmt bgra -s 1920x1080 -r 60 -i - \
       -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4
```

For a GIF, encode the MP4 first, then a two-pass `palettegen`/`paletteuse` — never one-pass GIF quantization.

### Gotchas that cost an afternoon
- **256-byte row padding** — un-pad on readback (the usual "sheared video" cause).
- **Channel order** — `Bgra8UnormSrgb` → `-pix_fmt bgra`. Red/blue swapped means you got this wrong.
- **Premultiplied alpha** — if capturing transparency, un-premultiply before encode or edges fringe.
- **`device.poll(Wait)`** before reading the mapped buffer is not optional.
- **sRGB double-convert** — if the target is `*Srgb` and ffmpeg also assumes sRGB you gamma-shift; pick one place to convert.

**Status:** not yet wired in `pd-timeline-proto` — its `capture.sh` is still Method 0 (live window + `screencapture`). This is the documented next step to make timeline artifacts CI-reproducible. Implementing it means adding an offscreen-render mode behind a flag (e.g. `PD_TIMELINE_RENDER_OFFSCREEN=out.mp4`) that bypasses the gpui window entirely.

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
