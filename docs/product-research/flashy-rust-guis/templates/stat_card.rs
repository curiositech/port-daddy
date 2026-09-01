//! Template: flashy stat card for pd-console (gpui 0.2.x, compile-intent).
//!
//! The workhorse: a port/service/agent metric tile with an Oklab gradient face, a
//! soft elevation shadow, a colored accent rail, an eyebrow label, the big value,
//! and a delta line. All first-class element-tree primitives — NO escape hatch.
//! Compose it with GlowPulse (status dot) and inside AnimatedGradientBg for the
//! full console look.
//!
//! Accessibility: value text is large; eyebrow uses uppercase tracked-out >=600
//! weight (the only place sub-14px is allowed, per the project's font rules).
//!
//! Source idioms: crates/gpui/examples/{gradient,shadow}.rs (Apache-2.0).

use gpui::{
    div, hsla, px, linear_color_stop, linear_gradient, BoxShadow, ColorSpace,
    FontWeight, Hsla, IntoElement, ParentElement, RenderOnce, SharedString,
    Styled, App, Window,
};

#[derive(IntoElement)]
pub struct StatCard {
    eyebrow: SharedString,
    value: SharedString,
    delta: SharedString,
    /// Accent / status color (pd-console logo primary).
    accent: Hsla,
    /// true = delta is good (use accent), false = degraded (caller passes a warm hue).
    healthy: bool,
}

impl StatCard {
    pub fn new(
        eyebrow: impl Into<SharedString>,
        value: impl Into<SharedString>,
        delta: impl Into<SharedString>,
        accent: Hsla,
        healthy: bool,
    ) -> Self {
        Self { eyebrow: eyebrow.into(), value: value.into(), delta: delta.into(), accent, healthy }
    }
}

impl RenderOnce for StatCard {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let a = self.accent;
        // Face gradient: faint accent tint top-left -> near-transparent, in Oklab.
        let face_top = hsla(a.h, a.s, a.l, 0.16);
        let face_bottom = hsla(a.h, a.s, a.l, 0.02);
        let delta_color = if self.healthy { a } else { hsla(0.03, 0.7, 0.6, 1.0) };

        div()
            .flex()
            .flex_row()
            .w(px(240.))
            .rounded(px(14.))
            .overflow_hidden()
            .bg(linear_gradient(
                135.,
                linear_color_stop(face_top, 0.),
                linear_color_stop(face_bottom, 1.),
            ).color_space(ColorSpace::Oklab))
            .border_1()
            .border_color(hsla(0.0, 0.0, 1.0, 0.08))
            .shadow(vec![
                BoxShadow::new(px(0.), px(8.), hsla(0.0, 0.0, 0.0, 0.30))
                    .blur_radius(px(20.))
                    .spread_radius(px(-4.)),
            ])
            // Left accent rail
            .child(div().w(px(4.)).h_full().bg(a))
            // Body
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .p(px(16.))
                    .child(
                        // eyebrow: uppercase, tracked, >=600 weight (font-rule compliant)
                        div()
                            .text_color(hsla(0.0, 0.0, 0.7, 1.0))
                            .text_size(px(12.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .tracking_wide()
                            .child(self.eyebrow.to_uppercase()),
                    )
                    .child(
                        div()
                            .text_size(px(32.))
                            .font_weight(FontWeight::BOLD)
                            .text_color(hsla(0.0, 0.0, 0.96, 1.0))
                            .child(self.value),
                    )
                    .child(
                        div()
                            .text_size(px(14.))
                            .text_color(delta_color)
                            .child(self.delta),
                    ),
            )
    }
}
