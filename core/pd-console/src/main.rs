#![recursion_limit = "512"]
//! pd-console — GPU-native standalone operator console (ADR-0046).
//!
//! Launches a native macOS window via GPUI. Not a terminal app.
//! The engine (daemon client, tube, pane contract) is in the sibling modules;
//! this is the GPUI bootstrap + window creation.
//!
//! Run:  cargo run --bin pd-console
//! REPL: cargo run --bin pd-console-repl

mod agent;
mod app;
mod dispatch_pane;
mod fleet_pane;
mod maritime;
mod pane;
mod theme;

use app::ConsoleView;
use gpui::*;

fn main() {
    let daemon_url = std::env::var("PORT_DADDY_URL").unwrap_or_else(|_| {
        let port = dirs::home_dir()
            .map(|h| h.join(".port-daddy/daemon.port"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| s.trim().parse::<u16>().ok())
            .unwrap_or(9876);
        format!("http://127.0.0.1:{port}")
    });

    Application::new().run(move |cx: &mut App| {
        let daemon_url = daemon_url.clone();

        let bounds = Bounds::centered(None, size(px(1200.0), px(800.0)), cx);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("pd-console".into()),
                    appears_transparent: true,
                    traffic_light_position: Some(point(px(12.0), px(12.0))),
                }),
                window_background: WindowBackgroundAppearance::Opaque,
                focus: true,
                ..Default::default()
            },
            |_window, cx| cx.new(|_cx| ConsoleView::new(daemon_url)),
        )
        .expect("failed to open pd-console window");
    });
}
