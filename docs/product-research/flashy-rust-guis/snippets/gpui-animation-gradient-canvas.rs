// Three first-class GPUI 0.2.x element-tree idioms — NO escape hatch needed:
//   1. Repeating, eased, transform-driven animation (.with_animation)
//   2. Perceptual (Oklab) linear gradient backgrounds
//   3. The custom-paint escape hatch: canvas() + PathBuilder + window.paint_path
//
// Source:  https://github.com/zed-industries/zed/tree/main/crates/gpui/examples
//            - animation.rs, gradient.rs, painting.rs
// License: Apache-2.0 (gpui crate). Pulled June 2026.

// ---------------------------------------------------------------------------
// 1. ANIMATION — a spinning SVG that repeats forever with a bounce/ease curve.
// Source: crates/gpui/examples/animation.rs
// ---------------------------------------------------------------------------
svg()
    .size_20()
    .path(ARROW_CIRCLE_SVG)
    .text_color(gpui::black())
    .with_animation(
        "image_circle",
        Animation::new(Duration::from_secs(2))
            .repeat()
            .with_easing(bounce(ease_in_out)),
        |svg, delta| {
            // delta is 0.0..1.0; remap it onto ANY element property.
            svg.with_transformation(Transformation::rotate(percentage(delta)))
        },
    );

// ---------------------------------------------------------------------------
// 2. GRADIENT — linear gradient with a live sRGB <-> Oklab toggle.
// Source: crates/gpui/examples/gradient.rs
// ---------------------------------------------------------------------------
div().flex_1().rounded_xl().bg(linear_gradient(
    45.,
    linear_color_stop(gpui::red(),  0.),
    linear_color_stop(gpui::blue(), 1.),
).color_space(color_space)); // ColorSpace::Oklab | ColorSpace::Srgb

// ---------------------------------------------------------------------------
// 3. CUSTOM PAINT — canvas() gives you a paint closure with a `Window` you can
//    call paint_quad / paint_path / paint_image on. GPUI tessellates and
//    fills/strokes paths itself (beziers, arc_to, dashed strokes) — so you do
//    NOT need Vello/Lyon for 2D vector art.
// Source: crates/gpui/examples/painting.rs
// ---------------------------------------------------------------------------
let mut builder = PathBuilder::fill();
builder.move_to(point(px(50.), px(50.)));
builder.line_to(point(px(130.), px(50.)));
builder.line_to(point(px(130.), px(130.)));
builder.line_to(point(px(50.), px(130.)));
builder.close();
let path = builder.build().unwrap();

canvas(
    move |_, _, _| {},                       // prepaint (layout / measure)
    move |_, _, window, _| {                 // paint
        window.paint_path(path, rgb(0xFF0000).alpha(0.5));
        // stroked + dashed:
        let mut stroke = PathBuilder::stroke(px(1.));
        stroke = stroke.dash_array(&[px(4.), px(2.)]);
        stroke.move_to(point(px(10.), px(10.)));
        stroke.line_to(point(px(200.), px(10.)));
        if let Ok(p) = stroke.build() { window.paint_path(p, gpui::black()); }
    },
).size_full();

// ---------------------------------------------------------------------------
// 4. BOX SHADOW — feeds the closed-form fs_shadow (see gpui-shadow-erf.wgsl).
// Source: crates/gpui/examples/shadow.rs
// ---------------------------------------------------------------------------
// .shadow(vec![ BoxShadow::new(px(0.), px(8.), hsla(0.0, 0.5, 0.5, 0.3)).blur_radius(px(8.)) ])
// or Tailwind-style presets: .shadow_sm() .shadow_md() .shadow_lg() .shadow_xl() .shadow_2xl()
