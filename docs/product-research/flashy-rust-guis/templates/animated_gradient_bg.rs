//! Template: animated gradient background for pd-console (gpui 0.2.x, compile-intent).
//!
//! A slow, living backdrop wash. gpui's `linear_gradient(...).color_space(Oklab)` is
//! first-class in the element tree, and `.with_animation` lets us drive the gradient
//! ANGLE over a long cycle so the whole field rotates without any geometry — the
//! cheap, theme-driven "living backdrop" primitive (cf. snippets/
//! animated-gradient-cosine-palette.glsl, which is the richer fragment-shader version
//! if you take the hatch).
//!
//! Why Oklab matters here: interpolating between saturated logo colors (coral ->
//! lavender -> sky) in sRGB grays out mid-mix; Oklab keeps the wash vivid and even
//! (see snippets/oklab-color.glsl). Use pd-console's logo palette as the stops.
//!
//! NO escape hatch needed. For a true noise/flow field, swap this for a custom
//! element running the cosine-palette shader.
//!
//! Source idioms: crates/gpui/examples/{gradient,animation}.rs (Apache-2.0).

use gpui::{
    div, px, linear_color_stop, linear_gradient, rgb, Animation, AnimationExt,
    ColorSpace, IntoElement, ParentElement, Render, Styled, ease_in_out,
    Context, Window,
};
use std::time::Duration;

pub struct AnimatedGradientBg {
    children: Vec<gpui::AnyElement>,
}

impl AnimatedGradientBg {
    pub fn new() -> Self { Self { children: Vec::new() } }
    pub fn child(mut self, child: impl IntoElement) -> Self {
        self.children.push(child.into_any_element());
        self
    }
}

impl Render for AnimatedGradientBg {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        // pd-console logo primaries: coral, lavender, sky (warm cream identity).
        let coral = rgb(0xF07060);
        let lavender = rgb(0xC5A5D8);
        let sky = rgb(0x4A9DD8);

        div()
            .size_full()
            .relative()
            .child(
                // The animated wash sits behind content; angle sweeps 0..360 slowly.
                div()
                    .absolute()
                    .inset_0()
                    .with_animation(
                        "gradient_sweep",
                        Animation::new(Duration::from_secs(24))
                            .repeat()
                            .with_easing(ease_in_out),
                        move |this, delta| {
                            let angle = 360.0 * delta;
                            this.bg(linear_gradient(
                                angle,
                                linear_color_stop(coral, 0.0),
                                linear_color_stop(lavender, 0.55),
                            ).color_space(ColorSpace::Oklab))
                            // a second stop layer could be composited for depth
                            .border_color(sky) // placeholder use to keep `sky` live
                        },
                    ),
            )
            .children(self.children)
    }
}
