//! Shared GPUI primitives for the story-linework visual grammar.
//!
//! These elements carry meaning across panes: corner ticks bound an inspectable
//! live surface, paired blocks identify context, and an edge stripe carries
//! state. They stay small and composable so feature panes do not invent local
//! variants of the same language.

use gpui::prelude::*;
use gpui::*;

pub(crate) fn corner_ticks(prefix: impl Into<String>, color: u32) -> Vec<AnyElement> {
    let prefix = prefix.into();
    let corner = |suffix: &'static str, top: bool, left: bool| {
        div()
            .id(SharedString::from(format!("{prefix}-{suffix}")))
            .absolute()
            .when(top, |d| d.top_0())
            .when(!top, |d| d.bottom_0())
            .when(left, |d| d.left_0())
            .when(!left, |d| d.right_0())
            .w(px(20.0))
            .h(px(20.0))
            .child(
                div()
                    .absolute()
                    .when(top, |d| d.top_0())
                    .when(!top, |d| d.bottom_0())
                    .when(left, |d| d.left_0())
                    .when(!left, |d| d.right_0())
                    .w(px(20.0))
                    .h(px(2.0))
                    .bg(rgb(color)),
            )
            .child(
                div()
                    .absolute()
                    .when(top, |d| d.top_0())
                    .when(!top, |d| d.bottom_0())
                    .when(left, |d| d.left_0())
                    .when(!left, |d| d.right_0())
                    .w(px(2.0))
                    .h(px(20.0))
                    .bg(rgb(color)),
            )
            .into_any_element()
    };
    vec![
        corner("tick-nw", true, true),
        corner("tick-ne", true, false),
        corner("tick-sw", false, true),
        corner("tick-se", false, false),
    ]
}

pub(crate) fn micro_flag(
    id: impl Into<SharedString>,
    primary: u32,
    secondary: u32,
    block_width: f32,
    block_height: f32,
) -> AnyElement {
    div()
        .id(id.into())
        .flex()
        .flex_shrink_0()
        .child(
            div()
                .w(px(block_width))
                .h(px(block_height))
                .bg(rgb(primary)),
        )
        .child(
            div()
                .w(px(block_width))
                .h(px(block_height))
                .bg(rgb(secondary)),
        )
        .into_any_element()
}

pub(crate) fn state_stripe(
    id: impl Into<SharedString>,
    color: u32,
    width: f32,
    height: f32,
) -> AnyElement {
    div()
        .id(id.into())
        .w(px(width))
        .h(px(height))
        .flex_shrink_0()
        .bg(rgb(color))
        .into_any_element()
}
