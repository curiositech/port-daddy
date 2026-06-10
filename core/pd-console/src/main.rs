#![recursion_limit = "512"]
//! pd-console — GPU-native standalone operator console (ADR-0046).
//!
//! Architecture: a std thread with a mini tokio runtime polls `/agents` every 2s
//! and sends `Vec<Block>` via mpsc. A GPUI foreground task wakes every 500ms,
//! drains the channel, and notifies the view. No tokio/smol collision.
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

use agent::DaemonClient;
use app::ConsoleView;
use fleet_pane::FleetPane;
use gpui::*;
use pane::Pane;
use std::borrow::Cow;
use std::sync::mpsc;
use std::time::Duration;

/// Filesystem asset source — resolves paths relative to the `assets/` dir
/// that lives next to the crate root (located via CARGO_MANIFEST_DIR at
/// compile time; falls back to the executable's parent at runtime).
struct FsAssets {
    base: std::path::PathBuf,
}

impl FsAssets {
    fn locate() -> Self {
        // Dev: use the compile-time manifest dir so `cargo run` just works.
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
        Self { base }
    }
}

impl AssetSource for FsAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let full = self.base.join(path);
        match std::fs::read(&full) {
            Ok(bytes) => Ok(Some(Cow::Owned(bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let dir = self.base.join(path);
        let entries = std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| {
                    e.ok().and_then(|e| e.file_name().into_string().ok()).map(SharedString::from)
                })
                .collect()
            })
            .unwrap_or_default();
        Ok(entries)
    }
}

fn main() {
    let daemon_url = std::env::var("PORT_DADDY_URL").unwrap_or_else(|_| {
        let port = dirs::home_dir()
            .map(|h| h.join(".port-daddy/daemon.port"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| s.trim().parse::<u16>().ok())
            .unwrap_or(9876);
        format!("http://127.0.0.1:{port}")
    });

    Application::new()
        .with_assets(FsAssets::locate())
        .run(move |cx: &mut App| {
        let daemon_url = daemon_url.clone();

        let bounds = Bounds::centered(None, size(px(1200.0), px(800.0)), cx);

        let window = cx
            .open_window(
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
                |_window, cx| cx.new(|_cx| ConsoleView::new(daemon_url.clone())),
            )
            .expect("failed to open pd-console window");

        // ── Fleet refresh pipeline ────────────────────────────────────────────
        // Producer: std thread with mini tokio runtime — polls /agents every 2s.
        let (tx, rx) = mpsc::channel::<Vec<pane::Block>>();
        let url = daemon_url.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio rt");
            rt.block_on(async move {
                let client = DaemonClient::new(url);
                let mut fleet = FleetPane::new();
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    let _ = fleet.refresh(&client).await;
                    if tx.send(fleet.view()).is_err() {
                        break; // window closed
                    }
                }
            });
        });

        // Consumer: GPUI foreground task — drains channel every 500ms on main thread.
        let bg = cx.background_executor().clone();
        let async_cx = cx.to_async();
        cx.foreground_executor()
            .spawn(async move {
                loop {
                    bg.timer(Duration::from_millis(500)).await;
                    while let Ok(blocks) = rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.update_fleet(blocks.clone());
                                cx.notify();
                            });
                        });
                    }
                }
            })
            .detach();
    });
}
