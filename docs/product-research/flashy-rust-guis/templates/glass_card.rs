//! Template: glassmorphic card for pd-console (gpui 0.2.x, compile-intent).
//!
//! HONEST CAVEAT — READ FIRST: gpui has NO backdrop/content-blur primitive. Its
//! only "blur" is the closed-form drop shadow (erf of a known box). So a *true*
//! frosted-glass-over-live-content panel is a gpui GAP. This template fakes the
//! look the way the element tree allows: a translucent fill + a top-down highlight
//! gradient + a hairline light border + a soft elevation shadow. That reads as
//! "glass" against a busy background without an actual content blur.
//!
//! To get REAL backdrop blur you must take the escape hatch:
//!   (a) render the region behind the panel to a texture, run a dual-Kawase /
//!       Gaussian blur (see snippets/dual-kawase-backdrop-blur.glsl or the
//!       MIT/Apache snippets/ruffle-blur-and-colormatrix.wgsl), and composite it
//!       under this card via a custom gpui element + wgpu pass; or
//!   (b) draw the whole card through a Vello scene into a wgpu texture and
//!       composite that (see snippets/vello-blurred-rect-and-gradient.rs).
//!
//! Source idioms: crates/gpui/examples/{gradient,shadow}.rs (Apache-2.0).

use gpui::{
    div, hsla, linear_color_stop, linear_gradient, px, BoxShadow, ColorSpace,
    InteractiveElement, IntoElement, ParentElement, RenderOnce, Styled, Window,
    App, Hsla,
};

/// A frosted-looking surface. `tint` is the glass color; keep its alpha low (0.06–0.16).
#[derive(IntoElement)]
pub struct GlassCard {
    tint: Hsla,
    children: Vec<gpui::AnyElement>,
}

impl GlassCard {
    pub fn new(tint: Hsla) -> Self {
        Self { tint, children: Vec::new() }
    }
    pub fn child(mut self, child: impl IntoElement) -> Self {
        self.children.push(child.into_any_element());
        self
    }
}

impl RenderOnce for GlassCard {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        // Translucent base so whatever is behind reads through (the "glass" cheat).
        let base = hsla(self.tint.h, self.tint.s, self.tint.l, 0.10);
        // Light catch across the top edge -> sells the pane-of-glass illusion.
        let sheen_top = hsla(0.0, 0.0, 1.0, 0.18);
        let sheen_bottom = hsla(0.0, 0.0, 1.0, 0.02);

        div()
            .relative()
            .rounded(px(16.))
            .p(px(20.))
            .bg(base)
            // hairline light border = the glass rim
            .border_1()
            .border_color(hsla(0.0, 0.0, 1.0, 0.22))
            // soft elevation shadow (closed-form erf shader under the hood)
            .shadow(vec![
                BoxShadow::new(px(0.), px(12.), hsla(0.0, 0.0, 0.0, 0.35))
                    .blur_radius(px(28.))
                    .spread_radius(px(-6.)),
            ])
            // top-down sheen via a perceptual (Oklab) gradient overlay
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(16.))
                    .bg(linear_gradient(
                        180.,
                        linear_color_stop(sheen_top, 0.),
                        linear_color_stop(sheen_bottom, 0.55),
                    ).color_space(ColorSpace::Oklab)),
            )
            .children(self.children)
    }
}
