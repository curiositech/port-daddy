# CONCLUSIONS — top 10 takeaways + exact next moves for pd-console

pd-console is a native **gpui 0.2.2** (Metal) operator console. Here is what the
flashy-Rust-GUI survey concludes, and precisely what to do next.

---

## Top 10 takeaways

1. **gpui is already a "render the UI like a videogame" engine.** A custom instanced
   shader per primitive, SDF rounded rects, closed-form (erf) drop shadows, Oklab
   gradient interpolation, glyph-atlas text at 120 FPS. We are not starting from a flat
   toolkit — most "flash" is a method call away. (Source: zed.dev/blog/videogame.)

2. **The single biggest gpui gap is backdrop/content blur.** Its only "blur" is the
   analytic drop shadow. **Real glassmorphism over live content is impossible in the
   element tree.** Every other framework that does it (Slint, Freya, browsers) blurs a
   copy of the framebuffer. Plan a Vello-or-wgpu hatch if glass is part of the identity.

3. **There is one universal "embed a shader in a UI rect" pattern**, seen three ways
   (egui `CallbackTrait`, iced `shader::Program/Primitive`, Bevy `UiMaterial`):
   allocate rect → upload GPU buffers from state → issue a wgpu draw into the composited
   target. **Rerun ships its entire 3D viewer this way.** This is exactly how pd-console
   should host any custom effect/viewport. egui's "store the pipeline in a render-lifetime
   resource map, not app state" is the cleanest variant.

4. **Rerun is the reference architecture for a data-heavy console**: retained chrome +
   GPU data viewports via paint callbacks + pooled GPU resources + **jump-flood (JFA)
   selection outlines** + instanced sphere-impostor points. Copy this shape for a live
   port/throughput/DAG viewport.

5. **OKLab is the cheap, high-leverage color win.** Two matrix multiplies + a cube root
   per fragment make saturated gradients and heatmaps stay vivid instead of graying
   mid-mix. gpui supports `ColorSpace::Oklab` on gradients today — use it everywhere,
   and author the theme ramps perceptually.

6. **SDF is the through-line of every crisp UI here** (gpui, Makepad, Bevy, Warp). One
   distance field → fill + AA + outline + glow from thresholds. It's the right model for
   panels, pills, and zoom-invariant labels (SDF/MSDF text).

7. **Makepad is the flashiest, but unembeddable.** Its live-shader-per-widget magic is
   welded to its own renderer/DSL — there's no scene-to-texture hatch. Treat its MPSL
   shaders as *reference implementations* to port, not code to import.

8. **Vello is the best "paint engine behind gpui."** It renders a `Scene` to a wgpu
   texture (compute pipeline, analytic blurs, rotating gradient brushes, MSAA16 SVG).
   The clean escape hatch for anything gpui can't draw — at the cost of sharing the
   wgpu device/queue and frame sync. Kurbo/Peniko are usable standalone as geometry/brush.

9. **The best license-clean shader sources are Ruffle, wgpu, egui, and the math papers.**
   Ruffle's `render/wgpu/shaders/filter/` is a ready-made MIT/Apache **WGSL** library
   (blur/glow/bevel/color-matrix). wgpu `boids` (particles), Ottosson OKLab (public
   domain), IQ palettes/SDF (MIT) round it out. **Avoid** Slint (GPLv3), the Warp sample
   (no license), and alex47 dual-Kawase (GPL — reimplement the math).

10. **Flash is cheap if it's GPU-resident and honest.** A pulsing glow bound to real
    load, an Oklab gradient face, a dithered dark backdrop, and a soft erf shadow buy
    90% of the "premium" feel with zero custom shaders. Save the hatch (glass, bloom,
    CRT, particles) for deliberate identity moments — and don't ship Potemkin effects
    (a CRT filter over fake data reads as fake).

---

## Exact next moves for pd-console's visual identity

**Move 1 — Land the Tier-1 element-tree kit (this week, no hatch).**
Wire the four [`templates/`](./templates) into pd-console: `stat_card`,
`animated_gradient_bg`, `glow_pulse`, `glass_card` (faked). Bind `glow_pulse`'s halo to
a real metric (port count / agent load), not time. Author every gradient with
`ColorSpace::Oklab` and the warm logo palette. Acceptance: a service tile, a backdrop
wash, and a live status dot rendering at 120 FPS.

**Move 2 — Prove the custom-wgpu hatch with ONE effect.**
Stand up a single custom gpui element that owns a wgpu texture and runs Ruffle's
MIT/Apache `blur.wgsl` over a copy of the region behind it → a **real** glass panel.
This de-risks the whole Tier-2 list (glass, bloom, viewports) because they all reuse the
same prepare/paint seam. If the device/queue sharing is painful, fall back to compositing
a **Vello** scene instead. Acceptance: one genuinely frosted panel over the live UI.

**Move 3 — Build the data viewport, Rerun-style.**
A port/throughput/DAG viewport composited via the paint callback from Move 2, with a
**JFA selection outline** on hover. Pool the pipeline/bind-group/buffers. Acceptance:
hovering a node draws a clean silhouette; 60+ fps with hundreds of nodes.

**Move 4 — Define the identity moments (pick, don't sprinkle).**
Choose 2–3 deliberate flourishes: (a) **bloom** on critical/alert states; (b) an
optional **cassette-futurism CRT** theme; (c) a low-opacity **particle field** backdrop
(boids compute). Each is a post pass on the Move-2 seam. Acceptance: alerts visibly emit
light; the CRT theme is toggleable; the particle field never costs CPU.

**Move 5 — Lock the theme system on OKLCH + dithering.**
Author all ramps in OKLCH (fix L,C sweep H for status; fix H sweep L for elevation), and
add a final **Bayer/blue-noise dither** pass over dark gradients to kill banding.
Acceptance: no visible banding in dark panels; status colors read evenly green→amber→red.

**Sequencing:** Move 1 is independent and ships immediately. Moves 2→3→4 are a chain
(all reuse the hatch). Move 5 can run in parallel with 1. Cross-reference the
`rust-gpui-motion`, `gpui-shaders`, and `vello-parley-rendering` skills throughout.

**The honest risk:** the Tier-2/3 effects all hinge on Move 2. If sharing gpui's
wgpu device with a custom pass or Vello proves harder than a session allows, that's a
real cost to surface — not something to "fix" by quietly dropping glass/bloom from the
design. Build the hatch once, properly, and the rest is reuse.
