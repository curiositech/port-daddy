// Vello: animated Gaussian drop-shadow + a gradient brush that rotates
// independently of its geometry. Vello is a GPU compute-centric 2D vector
// renderer on wgpu — it draws a `Scene` into a wgpu texture, which is exactly
// the "paint escape hatch" you'd composite behind a gpui element when gpui's
// own primitives aren't enough (e.g. true content blur, arbitrary SVG art).
//
// Source:  https://raw.githubusercontent.com/linebender/vello/main/examples/scenes/src/test_scenes.rs
//          (scenes: `blurred_rounded_rect`, `brush_transform`)
// License: Apache-2.0 OR MIT (Vello / Peniko / Kurbo). Pulled June 2026.

// --- Animated, analytic Gaussian drop shadow. The 5th arg is the blur
//     standard deviation; driving it from time gives a breathing shadow.
//     No texture ping-pong — Vello blurs the rounded rect analytically. ---
pub(super) fn blurred_rounded_rect(scene: &mut Scene, params: &mut SceneParams<'_>) {
    params.resolution = Some(Vec2::new(1200., 1200.));
    params.base_color = Some(palette::css::WHITE);

    let rect = Rect::from_center_size((0.0, 0.0), (300.0, 240.0));
    let radius = 50.0;
    scene.draw_blurred_rounded_rect(
        Affine::translate((300.0, 300.0)),
        rect,
        palette::css::BLUE,
        radius,
        params.time.sin() * 50.0 + 50.0,   // animated std-dev (blur amount)
    );

    // Same effect under a skew transform:
    scene.draw_blurred_rounded_rect(
        Affine::translate((900.0, 300.0)) * Affine::skew(20_f64.to_radians().tan(), 0.0),
        rect,
        palette::css::BLACK,
        radius,
        params.time.sin() * 50.0 + 50.0,
    );
}

// --- A linear gradient whose BRUSH spins inside a STATIC rectangle. The 4th
//     arg to scene.fill is an optional brush transform decoupled from geometry. ---
pub(super) fn brush_transform(scene: &mut Scene, params: &mut SceneParams<'_>) {
    let th = params.time;
    let linear = Gradient::new_linear((0.0, 0.0), (0.0, 200.0)).with_stops([
        palette::css::RED, palette::css::GREEN, palette::css::BLUE,
    ]);
    scene.fill(
        Fill::NonZero,
        Affine::translate((200.0, 600.0)),
        &linear,
        Some(around_center(Affine::rotate(th), Point::new(200.0, 100.0))),
        &Rect::from_origin_size(Point::default(), (400.0, 200.0)),
    );
}

// --- Peniko gradient vocabulary (linear / two-point-radial / sweep) × extend
//     modes (Pad / Repeat / Reflect). Peniko types feed Vello's scene.fill. ---
// let gradient: Brush = Gradient::new_sweep((cx, cy),
//         30_f32.to_radians(), 150_f32.to_radians())
//     .with_stops(colors)
//     .with_extend(Extend::Reflect)
//     .into();
