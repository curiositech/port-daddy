#![recursion_limit = "512"]
//! pd-console — GPU-native standalone operator console (ADR-0046).
//!
//! Architecture: a std thread with a mini tokio runtime polls all 15 panes every
//! 2s and sends `Vec<(usize, Vec<Block>)>` via mpsc. A GPUI foreground task wakes
//! every 500ms, drains the channel, and notifies the view. No tokio/smol collision.
//!
//! Run:  cargo run --bin pd-console
//! REPL: cargo run --bin pd-console-repl

mod activity_pane;
mod adrs_pane;
mod agent;
mod app;
mod claims_pane;
mod cockpit_pane;
mod dispatch_pane;
mod fleet_pane;
mod health_pane;
mod inbox_pane;
mod lane_pane;
mod ledger_pane;
mod lineage_pane;
mod substrate_pane;
mod conductor_pane;
mod maritime;
mod mux;
mod palette;
mod notes_pane;
mod pane;
mod peek_pane;
mod prs_pane;
mod roadmap_pane;
mod sessions_pane;
mod sortie_pane;
mod suggest_pane;
mod term;
mod theme;
mod tokens;
mod util;

use activity_pane::ActivityPane;
use adrs_pane::AdrsPane;
use agent::DaemonClient;
use app::ConsoleView;
use claims_pane::ClaimsPane;
use cockpit_pane::CockpitPane;
use dispatch_pane::DispatchQueuePane;
use fleet_pane::FleetPane;
use health_pane::HealthPane;
use inbox_pane::InboxPane;
use lane_pane::LanePane;
use ledger_pane::LedgerPane;
use lineage_pane::LineagePane;
use substrate_pane::SubstratePane;
use conductor_pane::ConductorPane;
use notes_pane::NotesPane;
use pane::{CoastGuardPane, Pane, SurfaceAction};
use peek_pane::PeekPane;
use prs_pane::PrsPane;
use roadmap_pane::RoadmapPane;
use sessions_pane::SessionsPane;
use sortie_pane::SortiePane;
use suggest_pane::SuggestPane;

use gpui::*;
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
    // Seed light/dark from PD_CONSOLE_THEME before the window opens (default dark).
    app::init_theme_from_env();

    // Canonical daemon discovery: PORT_DADDY_URL env var → daemon.port file → default.
    // All fallback logic lives in DaemonClient::discover(); no literals here.
    let daemon_url = DaemonClient::discover()
        .expect("daemon discovery failed")
        .base()
        .to_string();

    // `--pane <id>` opens directly on a pane (e.g. `pd-console --pane sorties`).
    // Lets the screenshot tooling capture each pane without injecting keystrokes
    // (which needs Accessibility permission). Unknown / absent → Fleet (slot 0).
    let initial_pane = {
        let args: Vec<String> = std::env::args().collect();
        args.iter().position(|a| a == "--pane").and_then(|i| args.get(i + 1).cloned())
    };

    Application::new()
        .with_assets(FsAssets::locate())
        .run(move |cx: &mut App| {
        let daemon_url = daemon_url.clone();

        // Operator control plane: the Lane's Interrupt button (foreground) sends
        // ControlMsg to the background thread that owns the surfaces + daemon.
        let (control_tx, control_rx) = mpsc::channel::<app::ControlMsg>();

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
                |window, cx| {
                    let control_tx = control_tx.clone();
                    let view = cx.new(|cx| {
                        ConsoleView::with_control(
                            daemon_url.clone(),
                            initial_pane.clone(),
                            Some(control_tx),
                            cx,
                        )
                    });
                    // Focus the view so keyboard nav (1-9, s/m/p/h/c/d) works
                    // immediately, without a click to grab focus first.
                    let fh = view.read(cx).focus_handle(cx);
                    window.focus(&fh);
                    view
                },
            )
            .expect("failed to open pd-console window");

        // ── Multi-pane refresh pipeline ───────────────────────────────────────
        // Producer: std thread with mini tokio runtime — refreshes all panes every 2s.
        // Sends Vec<(nav_index, Vec<Block>)> so the view can update each slot.
        //
        // NAV order mirrors app::NAV:
        //  0=Fleet  1=Cockpit  2=Sorties  3=Claims  4=Peek  5=Roadmap  6=ADRs
        //  7=Activity  8=Sessions  9=Inbox  10=Suggest  11=Memory  12=PRs
        //  13=Health  14=CoastGuard  15=Dispatch  16=Lane  17=Ledger  18=Lineage  19=Substrate
        let (tx, rx) =
            mpsc::channel::<(Vec<(usize, Vec<pane::Block>)>, Option<dispatch_pane::DispatchHead>)>();
        let url = daemon_url.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio rt");
            rt.block_on(async move {
                let client = DaemonClient::new(url);

                // All 16 panes — one per NAV slot.
                // Slot 2 "Sorties" is the SortiePane multiplexer (all sorties bucketed
                // running/blocked/done over GET /sorties — #344). The dispatch review
                // queue (GET /dispatches?state=review_pending) is its own slot 15 so both
                // operator surfaces survive; folding them lost the at-a-glance view.
                let mut fleet      = FleetPane::new();         // 0
                let mut cockpit    = CockpitPane::new();       // 1
                let mut sorties    = SortiePane::new();        // 2
                let mut claims     = ClaimsPane::new();        // 3
                let mut peek       = PeekPane::new();          // 4
                let mut roadmap    = RoadmapPane::new();       // 5
                let mut adrs       = AdrsPane::new();          // 6
                let mut activity   = ActivityPane::new();      // 7
                let mut sessions   = SessionsPane::new();      // 8
                let mut inbox      = InboxPane::new();         // 9
                let mut suggest    = SuggestPane::new();       // 10
                let mut memory     = NotesPane::new();         // 11
                let mut prs        = PrsPane::new();           // 12
                let mut health     = HealthPane::new();        // 13
                let mut coast      = CoastGuardPane::default();// 14
                let mut dispatch   = DispatchQueuePane::new(); // 15
                let mut lane       = LanePane::new();          // 16 — the LIVE one
                let mut ledger     = LedgerPane::new();        // 17 — the money
                let mut lineage    = LineagePane::new();       // 18 — RCP-14 argument graph
                let mut substrate  = SubstratePane::new();     // 19 — RCP-7a/12 pheromone substrate
                let mut conductor  = ConductorPane::new();     // 20 — Fleet Conductor (ADR-0060)

                // The Lane's live SSE stream. We (re)open it whenever the watched
                // agent changes; envelopes are drained every loop into the lane,
                // so the view updates at the 2s cadence with the freshest frames.
                // (A finer cadence is a follow-up; this proves the live pipeline.)
                let mut lane_stream: Option<(String, tokio::sync::mpsc::Receiver<agent::StreamEnvelope>)> = None;

                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;

                    // Operator control: drain any Interrupt requests from the UI and
                    // perform them against the agent the lane is watching.
                    while let Ok(msg) = control_rx.try_recv() {
                        match msg {
                            app::ControlMsg::InterruptLane => {
                                let _ = lane
                                    .mutate(&client, SurfaceAction::Interrupt { reason: Some("operator stop".into()) })
                                    .await;
                            }
                            // Kick off a new top-level agent on the live daemon.
                            app::ControlMsg::Spawn { backend, prompt } => {
                                if let Some(b) = agent::Backend::parse(&backend) {
                                    let _ = client.spawn(b, &prompt, "operator").await;
                                }
                            }
                            // Send a turn to the cartographer over its tube channel.
                            app::ControlMsg::Cartographer { text } => {
                                let _ = client.tube_send("cartographer", &text, "operator").await;
                            }
                            // Operator review-gate verdicts on a dispatch.
                            app::ControlMsg::DispatchAccept { id } => {
                                let _ = client.dispatch_action(&id, "accept", None).await;
                            }
                            app::ControlMsg::DispatchReject { id, reason } => {
                                let _ = client.dispatch_action(&id, "reject", Some(&reason)).await;
                            }
                            app::ControlMsg::DispatchCancel { id } => {
                                let _ = client.dispatch_action(&id, "cancel", Some("operator cancelled")).await;
                            }
                            // Conductor operator control (ADR-0060): grab the wheel on the fleet.
                            app::ControlMsg::FleetHalt { root_id } => {
                                let _ = client.fleet_action("halt", root_id.as_deref()).await;
                            }
                            app::ControlMsg::FleetPause { root_id } => {
                                let _ = client.fleet_action("pause", root_id.as_deref()).await;
                            }
                            app::ControlMsg::FleetResume { root_id } => {
                                let _ = client.fleet_action("resume", root_id.as_deref()).await;
                            }
                        }
                    }

                    // Refresh all in parallel-ish — sequential is fine at 2s cadence
                    let _ = fleet.refresh(&client).await;
                    let _ = cockpit.refresh(&client).await;
                    let _ = sorties.refresh(&client).await;
                    let _ = claims.refresh(&client).await;
                    let _ = peek.refresh(&client).await;
                    let _ = roadmap.refresh(&client).await;
                    let _ = adrs.refresh(&client).await;
                    let _ = activity.refresh(&client).await;
                    let _ = sessions.refresh(&client).await;
                    let _ = inbox.refresh(&client).await;
                    let _ = suggest.refresh(&client).await;
                    let _ = memory.refresh(&client).await;
                    let _ = prs.refresh(&client).await;
                    let _ = health.refresh(&client).await;
                    let _ = coast.refresh(&client).await;
                    let _ = dispatch.refresh(&client).await;
                    let _ = lane.refresh(&client).await;
                    let _ = ledger.refresh(&client).await;
                    let _ = lineage.refresh(&client).await;
                    let _ = substrate.refresh(&client).await;
                    let _ = conductor.refresh(&client).await;

                    // (Re)subscribe the lane's live stream if its target changed.
                    let want = lane.subscription();
                    if let Some(pane::Subscription::Agent { agent_id }) = want {
                        let reopen = match &lane_stream {
                            Some((cur, _)) => cur != &agent_id,
                            None => true,
                        };
                        if reopen {
                            let rx = client.subscribe_agent(&agent_id);
                            lane_stream = Some((agent_id, rx));
                        }
                    } else {
                        lane_stream = None;
                    }

                    // Drain whatever the live stream delivered since last loop.
                    if let Some((_, rx)) = lane_stream.as_mut() {
                        while let Ok(env) = rx.try_recv() {
                            lane.on_stream(&env);
                        }
                    }

                    let all = vec![
                        (0,  fleet.view()),
                        (1,  cockpit.view()),
                        (2,  sorties.view()),
                        (3,  claims.view()),
                        (4,  peek.view()),
                        (5,  roadmap.view()),
                        (6,  adrs.view()),
                        (7,  activity.view()),
                        (8,  sessions.view()),
                        (9,  inbox.view()),
                        (10, suggest.view()),
                        (11, memory.view()),
                        (12, prs.view()),
                        (13, health.view()),
                        (14, coast.view()),
                        (15, dispatch.view()),
                        (16, lane.view()),
                        (17, ledger.view()),
                        (18, lineage.view()),
                        (19, substrate.view()),
                        (20, conductor.view()),
                    ];

                    if tx.send((all, dispatch.head())).is_err() {
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
                    while let Ok((panes, dispatch_head)) = rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.update_panes(panes.clone(), dispatch_head.clone());
                                cx.notify();
                            });
                        });
                    }
                }
            })
            .detach();
    });
}
