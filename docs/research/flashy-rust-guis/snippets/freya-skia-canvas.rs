// Freya: a native Rust GUI rendered entirely with Skia (skia-safe; GL/Vulkan on
// Win/Linux, Metal on macOS). Its `canvas` element hands you the LIVE GPU-backed
// skia_safe::Canvas — anything Skia can do (paths, image filters, and SkSL shaders
// via skia_safe::RuntimeEffect) is reachable next to a retained component tree.
//
// gpui applicability: Freya's escape-hatch IDEA transfers (raw canvas alongside the
// tree), but Freya/Skia uses SkSL (RuntimeEffect) while gpui uses wgpu/WGSL — an
// SkSL effect must be ported to WGSL. Borrow the pattern, not the shader language.
//
// Source:  https://github.com/marc2332/freya/blob/main/examples/feature_canvas.rs
// License: MIT (per repo). Pulled June 2026.

use freya::prelude::*;
use skia_safe::{Paint, PaintStyle};

fn app() -> impl IntoElement {
    canvas(RenderCallback::new(|context| {
        let center_x = context.size.width / 2.0;
        let center_y = context.size.height / 2.0;
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_style(PaintStyle::Fill);
        paint.set_color(Color::BLUE);
        // context.canvas is the live GPU-backed Skia Canvas:
        context.canvas.draw_circle((center_x, center_y), 50.0, &paint);
    }))
    .width(Size::percent(100.))
    .height(Size::percent(100.))
}

// Freya's declarative side also takes CSS-like gradient/shadow STRINGS, e.g. (v0.3 rsx!):
//   border: "15 inner linear-gradient(0deg, rgb(98,67,223) 0%, rgb(255,130,238) 66%, white 100%)"
// and a unified use_animation(...).ease(Ease::InOut).function(Function::Expo) model.
