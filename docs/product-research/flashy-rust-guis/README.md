# Flashy, GPU-Accelerated Rust GUIs — a teardown for the pd-console glow-up

**What this is.** A researched, cited survey of the most beautiful, flashy,
design-heavy, GPU-accelerated Rust GUI apps and frameworks — what they are, *how*
they achieve their visuals (GPU path, shaders, animation, theming, blur), with
harvested code, screenshots, and a concrete **"what pd-console should steal"**
conclusion. It feeds the native **pd-console** operator console, which is built on
**gpui 0.2.2** (`core/pd-console/Cargo.toml`) — Metal on macOS, gated behind a
`gpui` feature.

**How to read it.**
- This file = ranked teardown + recurring techniques + the steal-list.
- [`CONCLUSIONS.md`](./CONCLUSIONS.md) = the punchy top-10 + exact next moves.
- [`gallery/IMAGES.md`](./gallery/IMAGES.md) = canonical image URLs + descriptions; `gallery/*.png|gif` = downloaded static captures.
- [`snippets/`](./snippets) = harvested, cited code — one file per technique.
- [`templates/`](./templates) = 4 gpui-flavored drop-ins (glass card, glow pulse, animated gradient bg, stat card).
- [`docs/product-research/flashy-rust-guis/scripts/fetch-gallery.sh`](./scripts/fetch-gallery.sh) = re-fetch the static images.

Cross-reference the repo skills `rust-gpui-motion`, `gpui-shaders`, and
`vello-parley-rendering` when implementing.

---

## TL;DR — the 5 coolest, ranked by flash

1. **Makepad** — *the* flashiest Rust UI. Every widget background/border/glyph is a
   live, hot-reloadable **MPSL shader** (`fn pixel(self) -> vec4` with first-class
   `Sdf2d`). Ironfish synth + Robrix prove it ships. The catch: the flash is welded
   to Makepad's own renderer/DSL — you reimplement the technique, you don't embed it.
2. **Rerun** — the most beautiful *shipped* app here. egui chrome around GPU data
   viewports via a custom **`re_renderer`** (wgpu): instanced sphere-impostor point
   clouds, **jump-flood selection outlines**, pooled GPU resources, paint-callback
   compositing. The blueprint for a data-heavy operator console.
3. **Vello / Xilem (Linebender)** — a **compute-shader** 2D vector renderer on wgpu:
   animated analytic Gaussian shadows (`draw_blurred_rounded_rect`), gradient brushes
   that rotate independently of geometry, MSAA16 SVG art. The cleanest "paint engine
   behind another UI" escape hatch.
4. **Zed / GPUI** — our own framework, and genuinely flashy: "render the UI like a
   videogame" — a custom instanced shader **per primitive**, rounded rects via SDF,
   drop shadows via closed-form **erf** (Figma's trick), Oklab gradient interpolation,
   glyph-atlas text at 120 FPS.
5. **Warp** — GPU terminal (custom Rust UI + Metal, GPUI's ancestor). "Everything is
   3 primitives" (rects, images, glyphs), lazy glyph atlas, **subpixel kerning**,
   ~1.9 ms redraws. Proof a text-heavy console can be both minimal and 144 fps.

Honorable mentions: **iced** (the `shader` widget = raw wgpu in the tree; glass-cube
demo), **egui** (`egui_wgpu` paint callback — the portable pattern), **Slint**
(declarative gradient/shadow/easing, the Energy-Monitor demo), **Bevy UI**
(`UiMaterial` = cleanest WGSL-on-a-UI-node), **Freya** (raw Skia canvas + SkSL),
**Lapce/Floem** (Vello-backed editor), **Ruffle** (a whole MIT/Apache WGSL **filter
library**: blur/glow/bevel/color-matrix), **Rio** (the real Rust+wgpu CRT terminal).

---

## Ranked teardown

### 1. Makepad — shader-driven everything · MIT OR Apache-2.0
- **What.** A creative dev platform (wasm/WebGL, macOS/Metal, Windows/DX11,
  Linux/OpenGL) with a live-editable design language (`live_design!`) and a UI runtime
  where **every widget is a shader**. Flagships: **Ironfish** synth, **Robrix** Matrix
  client, the fractal-zoom Mandelbrot demo. Live: https://makepad.dev/
- **How.** MPSL (Makepad Shader Language) transpiles one source to Metal/DX/GLSL/WebGL.
  Draw structs derive `Live`; a `#[repr(C)]` struct is the uniform block and
  `fn pixel(self) -> vec4` is the fragment program, attached inside the hot-reloadable
  `live_design!` DSL. SDF drawing is first-class (`Sdf2d::viewport` → `sdf.box/circle`,
  `sdf.fill/stroke/glow`). A declarative `animator` interpolates shader uniforms
  (hover/down/focus), feeding straight into `fn pixel`.
- **Code.** [`snippets/makepad-sdf-shader.mpsl`](./snippets/makepad-sdf-shader.mpsl).
  Source: https://makepad.rs/guide/start/makepad-framework-architecture
- **For pd-console.** **Reimplement, don't embed.** No "render a Makepad scene to a
  texture" hatch exists. Borrow the *idea* — an SDF rounded-rect + glow + bevel
  fragment shader — in gpui's wgpu path, or route through Vello. gpui already does
  SDF rounded rects, so extending its shaders in the Makepad style is the closest path.

### 2. Rerun — egui + wgpu + custom `re_renderer` · MIT OR Apache-2.0
- **What.** A multimodal data viewer. Hero: a 3D point-cloud viewport with axis gizmo,
  camera frustum, gradient skybox, and a timeline transport strip
  ([gallery/rerun-hero.png](./gallery/rerun-hero.png)).
- **How.** All UI chrome is **egui** (immediate mode); the 2D/3D viewports are
  `re_renderer` output (a wgpu renderer: Vulkan/Metal/D3D12/GLES/WebGPU) composited
  into egui via the **`egui_wgpu` paint-callback** sharing egui's `Device`/`Queue`.
  Concrete renderers (`PointCloudRenderer`, `LinesRenderer`, instanced `MeshRenderer`,
  `DepthCloudRenderer`) created lazily; **pooled** bind-groups/pipelines/buffers; draw
  phases Opaque/Transparent/OutlineMask/Picking; **selection outlines via jump
  flooding (JFA)**; **points = instanced billboarded quads expanded in the vertex
  shader** → perspective sphere impostors.
- **Code.** [`snippets/rerun-sphere-quad.wgsl`](./snippets/rerun-sphere-quad.wgsl) ·
  [`snippets/egui-wgpu-paint-callback.rs`](./snippets/egui-wgpu-paint-callback.rs).
  Source: https://github.com/rerun-io/rerun (`crates/viewer/re_renderer`)
- **For pd-console.** This is the **reference architecture**: retained UI chrome around
  GPU data viewports stitched in via paint callbacks, pooled resources, JFA outline for
  hover/selection. Steal the pattern wholesale.

### 3. Vello / Xilem / Linebender — compute-centric GPU 2D vector · Apache-2.0 OR MIT
- **What.** **Vello** = a Skia-class 2D renderer on wgpu that pushes the whole pipeline
  (flatten/bin/tile/raster) onto the GPU via **compute + prefix-sum** parallelism,
  avoiding per-clip intermediate textures. **Xilem** = a reactive UI (React/SwiftUI/Elm
  flavored) on Masonry + Vello + Parley. **Peniko/Kurbo/Parley** = the brush/geometry/
  text vocabulary. Vello splash = the GhostScript tiger ([gallery/vello-splash-tiger.png](./gallery/vello-splash-tiger.png)).
- **How.** wgpu/WebGPU; compute kernels; configurable AA (`AaConfig::Msaa16` /
  `Msaa8` / analytic Area). Flashy primitives: `draw_blurred_rounded_rect` (animated
  **analytic** Gaussian shadow — no ping-pong), brush transforms decoupled from
  geometry, linear/two-point-radial/sweep gradients × Pad/Repeat/Reflect, nested clips,
  blend grids. (Newer **Vello CPU** / **Vello Hybrid** sparse-strips variants exist —
  confirm against their crate READMEs.)
- **Code.** [`snippets/vello-blurred-rect-and-gradient.rs`](./snippets/vello-blurred-rect-and-gradient.rs).
  Source: https://raw.githubusercontent.com/linebender/vello/main/examples/scenes/src/test_scenes.rs
- **For pd-console.** **High applicability as a paint hatch.** Vello draws a `Scene`
  into a wgpu texture; have a gpui element own that texture and composite it. This is
  the single most promising route to effects gpui can't do natively (true content
  blur, arbitrary SVG/Bézier art, animated gradient brushes). Risk: sharing the
  `wgpu::Device`/queue + frame sync. **Kurbo/Peniko are usable standalone** as the
  geometry/brush model. Xilem itself is a *competing* framework — don't embed it.

### 4. Zed / GPUI — "render the UI like a videogame" · Apache-2.0 (gpui crate)
- **What.** Our framework. Zed editor at 120 FPS; the flashiest GPUI showcase is
  **longbridge/gpui-component** (shadcn-style gallery, virtualized tables, charts —
  runs in-browser as wasm). Also **Loungy** (translucent launcher), **Hummingbird**
  (music player).
- **How.** No general vector lib — a **dedicated instanced shader per primitive**
  (quads, shadows, glyphs/icons as alpha sprites, images as polychrome sprites).
  **Rounded rects via SDF** (`quad_sdf`); **drop shadows via closed-form Gaussian =
  erf** (Evan Wallace / Figma trick — only 4 samples, plus inset shadows);
  **gradients interpolated in Oklab** on the GPU (the real "OKLCH" story — themes are
  hex, the *gradient pipeline* is perceptual); **text** = OS-shaped glyphs rasterized
  once into a bin-packed alpha **atlas**, tinted in-shader. Backends now live in
  separate `gpui_wgpu` (WGSL + a wasm/web target) and `gpui_macos` (Metal) crates.
  High-level API is a Tailwind-like `div()` builder; `.with_animation` +
  `Animation`/easing/`Transformation`; `canvas()` + `PathBuilder` is the in-engine
  custom-paint hatch (fills/strokes beziers + dashes — **no Vello needed for 2D art**).
- **Code.** [`snippets/gpui-shadow-erf.wgsl`](./snippets/gpui-shadow-erf.wgsl) ·
  [`snippets/gpui-rounded-rect-oklab.wgsl`](./snippets/gpui-rounded-rect-oklab.wgsl) ·
  [`snippets/gpui-animation-gradient-canvas.rs`](./snippets/gpui-animation-gradient-canvas.rs).
  Source: https://github.com/zed-industries/zed (`crates/gpui`, `crates/gpui_wgpu`) ·
  blog https://zed.dev/blog/videogame
- **For pd-console.** This is home turf. Most "flash" (gradients, shadows, animation,
  rounded panels, custom 2D paint) is **first-class in the element tree** — see the
  four [`templates/`](./templates). **The one gap: no backdrop/content blur** → real
  glassmorphism needs the Vello / custom-wgpu hatch.

### 5. Warp — custom Rust UI + Metal (GPUI's ancestor) · closed source
- **What.** GPU terminal; command+output **blocks** UI ([gallery note](./gallery/IMAGES.md)).
- **How.** Custom Rust UI framework "essentially a browser," Flutter-inspired, by
  Nathan Sobo (→ later GPUI). **"Everything is 3 primitives"** (rects, images, glyphs),
  ~200-line shaders each. **Lazy glyph atlas** rasterized once; **subpixel positioning
  (3 horizontal subpixels) for correct kerning**; ~1.9 ms average redraw, 400+ fps.
- **Code.** Client is closed; the rectangle/glyph Metal technique is a blog sample
  (⚠️ no LICENSE in `warpdotdev/samples` — attribution-only). Source:
  https://www.warp.dev/blog/how-to-draw-styled-rectangles-using-the-gpu-and-metal
- **For pd-console.** The text path is the lesson: minimal primitives + lazy atlas +
  subpixel kerning is how a text-dense console stays crisp and fast.

### The framework field (flashiest examples)
| Framework | GPU path | Flashy demo | Custom-shader hatch | Borrow for pd-console |
|---|---|---|---|---|
| **iced** | wgpu (+tiny-skia CPU) | glass-cube `custom_shader`, `solar_system` | `widget::shader` (Program/Primitive → raw wgpu) | the prepare/render split; `cubes.wgsl` is liftable WGSL |
| **egui** | wgpu via eframe | the demo, `custom3d_wgpu` | `egui_wgpu::CallbackTrait` | **the paint-callback pattern** (Rerun uses it) |
| **Slint** | Skia / femtovg(+wgpu) | Energy Monitor, slide_puzzle | renderer-level | declarative gradient/shadow + spring easing + "glow = f(metric)" |
| **Bevy UI** | wgpu render graph | `ui_material` rainbow banner | `UiMaterial` + `AsBindGroup` + WGSL | **cleanest WGSL-on-a-UI-node**; SDF border math ports verbatim |
| **Freya** | Skia (skia-safe) | gradient borders, raw canvas | raw `skia_safe::Canvas` (SkSL) | raw-canvas-beside-tree idea (port SkSL→WGSL) |
| **Floem/Lapce** | Vello / vger (wgpu) | the Lapce editor | via peniko/Vello | the retained `Renderer` trait model |
| **Dioxus/Blitz** | webview / **Blitz=Vello** | Blitz CSS demos (pre-alpha) | CSS-driven | only if you want HTML/CSS authoring |

Per-framework code: [`iced-shader-widget.rs`](./snippets/iced-shader-widget.rs) +
[`iced-cubes.wgsl`](./snippets/iced-cubes.wgsl),
[`egui-wgpu-paint-callback.rs`](./snippets/egui-wgpu-paint-callback.rs),
[`bevy-ui-material.rs`](./snippets/bevy-ui-material.rs) +
[`bevy-ui-material.wgsl`](./snippets/bevy-ui-material.wgsl),
[`slint-gradient-shadow.slint`](./snippets/slint-gradient-shadow.slint),
[`freya-skia-canvas.rs`](./snippets/freya-skia-canvas.rs).

---

## Recurring techniques (the actual toolbox)

Each links to harvested, cited code in [`snippets/`](./snippets). WGSL is the lingua
franca — wgpu transpiles WGSL→MSL on Metal via naga, so WGSL drops into gpui's backend.

1. **SDF everything** — signed distance fields give crisp edges at any zoom + free AA +
   outline + glow from one threshold. The dominant console primitive (rounded
   panels/pills) and the basis of GPU text. → [`sdf-shapes-and-text.glsl`](./snippets/sdf-shapes-and-text.glsl), and gpui's own [`gpui-rounded-rect-oklab.wgsl`](./snippets/gpui-rounded-rect-oklab.wgsl).
2. **Closed-form (erf) drop shadows** — analytic Gaussian of a box; 4 samples, no
   blur kernel; inset variant. → [`gpui-shadow-erf.wgsl`](./snippets/gpui-shadow-erf.wgsl); Vello's analytic `draw_blurred_rounded_rect`.
3. **Embed-a-shader-in-a-UI-rect** — the one pattern three ways (iced `shader::Program`,
   egui `CallbackTrait`, Bevy `UiMaterial`): allocate rect → build/upload GPU buffers
   from state → issue a wgpu draw into the composited target. → [`egui-wgpu-paint-callback.rs`](./snippets/egui-wgpu-paint-callback.rs), [`iced-shader-widget.rs`](./snippets/iced-shader-widget.rs), [`bevy-ui-material.rs`](./snippets/bevy-ui-material.rs).
4. **OKLab/OKLCH perceptual color** — interpolate gradients/heatmaps in Oklab so
   saturated ramps stay vivid (no gray dead-zone). GPUI already does this. → [`oklab-color.glsl`](./snippets/oklab-color.glsl).
5. **Animated gradients via cosine palettes** — `a+b·cos(2π(c·t+d))`: one quad, a time
   uniform, banding-free living backdrop. → [`animated-gradient-cosine-palette.glsl`](./snippets/animated-gradient-cosine-palette.glsl).
6. **Glassmorphism / backdrop blur** — dual-filter Kawase: downsample/upsample chain,
   log-scaling cost. **The gpui gap.** → [`dual-kawase-backdrop-blur.glsl`](./snippets/dual-kawase-backdrop-blur.glsl) (GPL — math only) or the MIT/Apache [`ruffle-blur-and-colormatrix.wgsl`](./snippets/ruffle-blur-and-colormatrix.wgsl).
7. **Bloom / glow** — bright-pass → blur → additive composite + tonemap; alerts/LEDs
   bleed genuine light. → [`bloom-pipeline.glsl`](./snippets/bloom-pipeline.glsl).
8. **Dithering (Bayer / blue-noise)** — kill 8-bit banding in dark gradients; add retro
   texture. → [`dither-bayer-4x4.glsl`](./snippets/dither-bayer-4x4.glsl).
9. **GPU particle fields** — compute-update storage buffer + instanced draw; 100k+
   particles, zero CPU. Ambient "telemetry swarm." → [`particles-boids-compute.wgsl`](./snippets/particles-boids-compute.wgsl).
10. **CRT / scanline** — cassette-futurism post pass (barrel + scanlines). Honest note:
    in a TUI the retro look is the *terminal's* shader (Rio), not the app. → [`crt-scanline.glsl`](./snippets/crt-scanline.glsl).
11. **Spring/overshoot easing + "glow = f(metric)"** — Slint's `cubic-bezier(...,1.75)`
    settle and shadow-alpha bound to a live value. → [`slint-gradient-shadow.slint`](./snippets/slint-gradient-shadow.slint).
12. **Ready-made WGSL filter library** — Ruffle's `render/wgpu/shaders/filter/`
    (blur/glow/bevel/color-matrix) is MIT/Apache and already WGSL. → [`ruffle-blur-and-colormatrix.wgsl`](./snippets/ruffle-blur-and-colormatrix.wgsl).

---

## What pd-console should steal (prioritized)

**Tier 1 — ship now, pure gpui element tree (no hatch):**
- **OKLab gradient faces on every panel/stat tile** + soft erf drop shadows + the
  warm logo palette (coral/lime/sky/lavender/amber). → [`templates/stat_card.rs`](./templates/stat_card.rs), [`templates/animated_gradient_bg.rs`](./templates/animated_gradient_bg.rs).
- **Pulsing status glow bound to telemetry** (Slint's "glow = f(load)" via
  `.with_animation` driving a drop shadow). → [`templates/glow_pulse.rs`](./templates/glow_pulse.rs).
- **`canvas()` + `PathBuilder`** for sparklines / port maps / DAG edges — no extra
  renderer needed.

**Tier 2 — high impact, needs the Vello / custom-wgpu hatch:**
- **Real glassmorphic panels** (the one thing gpui can't do natively). Composite a
  Vello scene or a dual-Kawase pass behind a gpui element. → [`templates/glass_card.rs`](./templates/glass_card.rs) (faked) + [`snippets/ruffle-blur-and-colormatrix.wgsl`](./snippets/ruffle-blur-and-colormatrix.wgsl) (real, MIT/Apache WGSL).
- **A data viewport** (port graph / live throughput) composited Rerun-style via a
  paint callback, with a **JFA selection outline**.
- **Bloom on alerts** so critical states genuinely emit light.

**Tier 3 — identity / flair:**
- **Cassette-futurism CRT post pass** as an optional theme for the retro-operator vibe.
- **Ambient particle field** backdrop (boids compute) at low opacity.
- **Dithered dark gradients** to kill banding and add texture.

**The honest constraint to design around:** gpui has **no backdrop blur** and **no
user-pluggable shader API**. Anything beyond gradients/shadows/animation/custom-paint
(glass, bloom, CRT, particles, noise) requires forking `gpui_wgpu`/`gpui_macos` or
compositing a Vello / raw-wgpu pass into a custom element. Budget that hatch up front.

See [`CONCLUSIONS.md`](./CONCLUSIONS.md) for the top-10 + exact next moves, and
[`LICENSES`](#licensing--provenance) below before vendoring anything.

---

## Licensing & provenance

| Source | License | Safe to vendor? |
|---|---|---|
| gpui crate, gpui_wgpu/gpui_macos shaders | **Apache-2.0** | Yes (we depend on it) |
| Zed *repo* app code, gpui-component | **NOASSERTION** (mixed/custom) | Verify per-file |
| Vello / Peniko / Kurbo / Parley / Xilem | Apache-2.0 OR MIT | Yes |
| Makepad / Ironfish / Robrix | MIT OR Apache-2.0 | Yes (but you reimplement, not embed) |
| iced, egui, Bevy, bevy_egui, Floem(MIT), Freya(MIT), Blitz | MIT or MIT/Apache | Yes |
| Rerun, Ruffle, wgpu boids | MIT OR Apache-2.0 | **Yes — best license-clean WGSL sources** |
| **Slint** (framework) | **GPLv3 / royalty-free / commercial** | Pattern only — don't vendor |
| **Warp samples** | **no LICENSE** | Attribution only |
| **dual-Kawase (alex47)** | **GPL-3.0** | Math only — reimplement |
| LearnOpenGL code | MIT (prose CC BY-NC) | Per-snippet |
| IQ palettes/SDF | MIT (no inline header) | Yes, with attribution |
| Ottosson OKLab | Public domain OR MIT | Yes |
| wessles CRT | MIT (in-file header) | Yes, with attribution |

**Best license-clean copy-from sources:** Ruffle's `filter/*.wgsl`, wgpu `boids`,
egui `custom3d_wgpu`, Ottosson OKLab, IQ palettes/SDF, `hughsk/glsl-dither`, and
gpui's own shaders.
