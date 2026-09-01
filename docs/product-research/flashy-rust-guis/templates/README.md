# Templates — gpui-flavored drop-ins for pd-console

Four reusable elements written to **compile-intent against gpui 0.2.x** (the pin in
`core/pd-console/Cargo.toml` is `gpui = "0.2.2"`). They are reference implementations,
not a built crate — import names track the public `gpui` API as of June 2026, but you
must wire them into pd-console's module tree and reconcile any API drift (`Hsla`
helpers, `AnimationExt`, `FontWeight`, `BoxShadow::spread_radius`) against the exact
`gpui` revision you depend on.

| File | What it gives you | Escape hatch needed? |
|---|---|---|
| `glass_card.rs` | Frosted-glass panel (translucent fill + sheen gradient + light rim + elevation shadow) | **For *true* backdrop blur: yes** — gpui has no content-blur primitive. The faked look needs none. |
| `glow_pulse.rs` | Status LED whose halo breathes (drives a drop-shadow from `.with_animation`) | No (pure element tree). Real bloom = yes. |
| `animated_gradient_bg.rs` | Slow rotating Oklab gradient backdrop wash | No. Noise/flow field = yes. |
| `stat_card.rs` | Metric tile: Oklab gradient face, accent rail, eyebrow/value/delta, soft shadow | No. |

## The one honest gap to plan around

gpui's element tree gives you, first-class and GPU-cheap: rounded rects, **perceptual
(Oklab) gradients**, box + inset **drop shadows** (closed-form erf — see
`../snippets/gpui-shadow-erf.wgsl`), opacity, SVG transforms, and repeating eased
**animations**. The custom-paint hatch (`canvas()` + `PathBuilder`) covers freeform
vector art without Vello.

What it does **not** give you: a **backdrop/content blur** (real glassmorphism over
live content) or arbitrary per-pixel fragment effects (noise, bloom, displacement,
CRT). Those require either forking `gpui_wgpu`/`gpui_macos` shaders or compositing a
**Vello** scene / custom wgpu pass into a gpui element. Budget for that hatch before
promising frosted glass or bloom in the console's visual identity.
