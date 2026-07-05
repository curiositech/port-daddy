//! Template: pulsing glow status indicator for pd-console (gpui 0.2.x, compile-intent).
//!
//! A status LED / alert dot whose halo breathes. This is 100% inside the gpui
//! element tree — NO escape hatch — using `.with_animation` to drive a layered
//! drop-shadow's blur + alpha from the eased 0..1 delta. Idea borrowed from Slint's
//! "shadow alpha = f(live metric)" (snippets/slint-gradient-shadow.slint): here the
//! metric is time, but swap `delta` for a normalized load value to make it react to
//! real telemetry.
//!
//! For an even hotter "genuine emission" look (alerts truly bleeding light), render
//! this to an HDR target and run the bloom pipeline (snippets/bloom-pipeline.glsl) —
//! that part needs the custom-shader hatch; the pulse below does not.
//!
//! Source idioms: crates/gpui/examples/animation.rs (Apache-2.0).

use gpui::{
    div, hsla, px, Animation, AnimationExt, BoxShadow, Hsla, IntoElement,
    ParentElement, Render, Styled, ease_in_out, Context, Window,
};
use std::time::Duration;

pub struct GlowPulse {
    /// Core color of the indicator (e.g. coral for alert, lime for healthy).
    pub color: Hsla,
    pub diameter: f32,
}

impl GlowPulse {
    pub fn new(color: Hsla) -> Self {
        Self { color, diameter: 14.0 }
    }
}

impl Render for GlowPulse {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let color = self.color;
        let d = self.diameter;

        div()
            .size(px(d))
            .rounded_full()
            .bg(color)
            .with_animation(
                "glow_pulse",
                Animation::new(Duration::from_millis(1400))
                    .repeat()
                    .with_easing(ease_in_out),
                move |this, delta| {
                    // delta: 0..1..0 over the cycle (ease_in_out + repeat).
                    // Map it onto an expanding, fading halo.
                    let blur = 6.0 + 22.0 * delta;
                    let spread = 1.0 + 5.0 * delta;
                    let alpha = 0.55 * (1.0 - delta) + 0.15;
                    this.shadow(vec![
                        BoxShadow::new(px(0.), px(0.), hsla(color.h, color.s, color.l, alpha))
                            .blur_radius(px(blur))
                            .spread_radius(px(spread)),
                    ])
                },
            )
    }
}
