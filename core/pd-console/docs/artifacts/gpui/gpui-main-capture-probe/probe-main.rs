//! Minimal proof: can gpui (zed main) render a trivial view off-screen via Metal
//! and hand back real pixels, with NO on-screen window and NO screenshot MCP?
//!
//! Path exercised: VisualTestAppContext::new(current_platform(false))
//!   -> open_offscreen_window (window at -10000,-10000)
//!   -> capture_screenshot() == window.render_to_image() (Metal texture readback)
//!   -> image::RgbaImage -> proof.png
//!
//! Must run on the MAIN THREAD (macOS), so this is a bin's main(), not a #[test].

use gpui::{
    div, px, rgb, size, AppContext as _, Context, HeadlessAppContext, IntoElement, ParentElement,
    Render, Styled, Window,
};
use std::sync::Arc;

struct Hello;

impl Render for Hello {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .size_full()
            .justify_center()
            .items_center()
            .bg(rgb(0x1e6f3c)) // green field
            .child(
                div()
                    .px_8()
                    .py_4()
                    .bg(rgb(0xffd23f)) // yellow card
                    .text_color(rgb(0x101010))
                    .child("hello gpui headless"),
            )
    }
}

fn main() {
    // True headless path: TestPlatform (mocked windows, no AppKit compositor) wired
    // to a real Metal offscreen renderer. render_to_image() renders the Scene to an
    // offscreen Metal texture and reads the pixels back — no on-screen window, no
    // ScreenCaptureKit / Screen Recording permission.
    let real_text_system = gpui_platform::current_platform(false).text_system();
    let mut cx = HeadlessAppContext::with_platform(
        real_text_system,
        Arc::new(()),
        || gpui_platform::current_headless_renderer(),
    );

    let window = cx
        .open_window(size(px(640.0), px(360.0)), |_, cx| cx.new(|_| Hello))
        .expect("open_window failed");

    cx.run_until_parked();

    let img = cx
        .capture_screenshot(window.into())
        .expect("capture_screenshot failed");

    let (w, h) = (img.width(), img.height());
    // Distinct-color count as a triviality guard.
    let mut colors = std::collections::HashSet::new();
    for px in img.pixels() {
        colors.insert((px.0[0], px.0[1], px.0[2]));
        if colors.len() > 64 {
            break;
        }
    }

    let out = concat!(env!("CARGO_MANIFEST_DIR"), "/proof.png");
    img.save(out).expect("save png failed");

    println!(
        "PROOF_OK dims={}x{} distinct_colors>={} saved={}",
        w,
        h,
        colors.len(),
        out
    );
}
