#![recursion_limit = "1024"]
//! pd-console — GPU-native standalone operator console (ADR-0046).
//!
//! Architecture: a std thread with a mini tokio runtime polls all 15 panes every
//! 2s and sends `Vec<(usize, Vec<Block>)>` via mpsc. A GPUI foreground task wakes
//! every 500ms, drains the channel, and notifies the view. No tokio/smol collision.
//!
//! Run:  cargo run --bin pd-console
//! REPL: cargo run --bin pd-console-repl

mod active_agents_pane;
mod activity_pane;
mod adrs_pane;
mod agent;
mod app;
mod audio;
mod berths;
mod buffer;
mod chat;
mod claims_pane;
mod cli_args;
mod cloud_fleet_pane;
mod cockpit_pane;
mod conductor_pane;
mod daemon_pane;
mod dispatch_pane;
mod editor_claims;
mod editor_commit_gate;
mod editor_input;
mod editor_pane;
mod editor_sync;
mod editor_wedge;
mod fleet_pane;
mod galaxy_canvas;
mod galaxy_pane;
mod grid;
mod harbor_pane;
mod headless_capture;
mod health_pane;
mod inbox_pane;
mod interruptions;
mod interruptions_pane;
mod lane_pane;
mod ledger_pane;
mod lineage_pane;
mod maritime;
mod mission_view;
mod mux;
mod notes_pane;
mod palette;
mod pane;
mod parley_pane;
mod peek_pane;
mod planner_pane;
mod prs_pane;
mod roadmap_pane;
mod script;
mod sessions_pane;
mod shell_drawer;
mod sortie_pane;
mod story_linework;
mod substrate_pane;
mod suggest_pane;
mod syntax;
mod term;
mod theme;
mod tokens;
mod util;
mod work_plan;

use active_agents_pane::ActiveAgentsPane;
use activity_pane::ActivityPane;
use adrs_pane::AdrsPane;
use agent::DaemonClient;
use app::ConsoleView;
use claims_pane::ClaimsPane;
use cloud_fleet_pane::CloudFleetPane;
use cockpit_pane::CockpitPane;
use conductor_pane::ConductorPane;
use daemon_pane::DaemonPane;
use dispatch_pane::DispatchQueuePane;
use fleet_pane::FleetPane;
use galaxy_pane::GalaxyPane;
use harbor_pane::HarborPane;
use health_pane::HealthPane;
use inbox_pane::InboxPane;
use interruptions_pane::InterruptionsPane;
use lane_pane::LanePane;
use ledger_pane::LedgerPane;
use lineage_pane::LineagePane;
use notes_pane::NotesPane;
use pane::{CoastGuardPane, OperatorTurn, Pane, SurfaceAction};
use parley_pane::ParleyPane;
use peek_pane::PeekPane;
use planner_pane::PlannerPane;
use prs_pane::PrsPane;
#[allow(unused_imports)]
use roadmap_pane::RoadmapPane;
use sessions_pane::SessionsPane;
use sortie_pane::SortiePane;
use substrate_pane::SubstratePane;
use suggest_pane::SuggestPane;

use cli_args::{parse_console_args, resolve_display_selector};
use gpui::*;
use std::borrow::Cow;
use std::sync::mpsc;
use std::time::Duration;

/// Present one changed operator frame. GPUI 0.2.2 marks an inactive macOS
/// window dirty but can leave its display link parked after the first frame.
/// A sub-point native size toggle wakes that callback; alternating the offset
/// keeps the window within a single logical pixel instead of allowing drift.
fn present_changed_frame(
    window: &mut Window,
    cx: &mut Context<ConsoleView>,
    size_nudged: &mut bool,
) {
    cx.notify();
    window.refresh();
    let mut present_size = window.viewport_size();
    present_size.width += if *size_nudged { px(-0.5) } else { px(0.5) };
    *size_nudged = !*size_nudged;
    window.resize(present_size);
}

/// Resolve the `pd-conjure-proto` crate dir (the Vello renderer). Honors a
/// `PD_CONJURE_PROTO_DIR` override (a packaged app can point at an installed
/// copy); otherwise it is the sibling of this crate at build time
/// (`core/pd-console/../pd-conjure-proto`).
fn work_graph_proto_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("PD_CONJURE_PROTO_DIR") {
        return std::path::PathBuf::from(dir);
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("pd-conjure-proto"))
        .unwrap_or_else(|| std::path::PathBuf::from("pd-conjure-proto"))
}

/// Finder-launched apps do not inherit a login-shell PATH. Add the standard
/// development tool locations for the optional local Vello proof renderer.
fn augmented_tool_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs = Vec::<String>::new();
    if !home.is_empty() {
        dirs.push(format!("{home}/.cargo/bin"));
        dirs.push(format!("{home}/.local/bin"));
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(dir.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        for segment in existing
            .split(':')
            .filter(|segment| !segment.trim().is_empty())
        {
            if !dirs.iter().any(|dir| dir == segment) {
                dirs.push(segment.to_string());
            }
        }
    }
    dirs.join(":")
}

/// The Work → Vello render handoff (runs on a blocking worker, never the gpui
/// thread): write the serialized DAG where the proto reads it, then build+run
/// `scripts/capture.sh`. capture.sh builds RELEASE and runs the binary UNSANDBOXED
/// — both are required on macOS 15 (debug fontique panics; the Metal readback is
/// SIGKILLed in a sandbox). Returns the PNG path on success; an error carrying the
/// captured stderr otherwise (surfaced as a HITL alert, never swallowed).
fn render_work_graph_png(dag_json: &str) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let proto = work_graph_proto_dir();
    let script = proto.join("scripts").join("capture.sh");
    if !script.exists() {
        bail!(
            "capture.sh not found at {} — set PD_CONJURE_PROTO_DIR to the pd-conjure-proto crate",
            script.display()
        );
    }
    // Write the live DAG to the proto's input file (the same shape its fixture.json
    // carries) so capture.sh's default INPUT renders exactly the daemon projection.
    let input = proto.join("fixture.json");
    std::fs::write(&input, dag_json)
        .with_context(|| format!("writing the DAG JSON to {}", input.display()))?;
    let output = proto.join("conjure-dag-vello.png");

    // Run capture.sh (release build + offscreen render). It cd's into the proto
    // dir itself; we also set cwd for robustness. Pass explicit input/output so a
    // future caller can fan out to distinct files without racing the default.
    //
    // PATH FIX: a macOS .app launched from Finder does NOT inherit a login shell's
    // PATH, so `cargo` inside capture.sh is "command not found". We hand the child
    // an augmented PATH (~/.cargo/bin + …) so the release build resolves.
    let status = std::process::Command::new("bash")
        .arg(&script)
        .arg(&input)
        .arg(&output)
        .current_dir(&proto)
        .env("PATH", augmented_tool_path())
        .output()
        .with_context(|| format!("running {}", script.display()))?;
    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        let stdout = String::from_utf8_lossy(&status.stdout);
        bail!(
            "capture.sh exited {}: {}{}",
            status.status,
            stderr.trim(),
            if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                ""
            }
        );
    }
    if !output.exists() {
        bail!(
            "capture.sh reported success but no PNG at {}",
            output.display()
        );
    }
    Ok(output)
}

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
                    e.ok()
                        .and_then(|e| e.file_name().into_string().ok())
                        .map(SharedString::from)
                })
                .collect()
            })
            .unwrap_or_default();
        Ok(entries)
    }
}

/// Contiguous `pd-console v<ver>` literal in rodata: the release version-drift
/// guard strings-extracts this exact marker when the binary is not runnable on
/// the checking host (cross-arch), and `--version` prints it when it is.
#[used]
static BUILD_STAMP: &str = concat!("pd-console v", env!("CARGO_PKG_VERSION"));

fn main() {
    // `--version` must answer before daemon discovery or any GPU/window init:
    // the release version-drift guard (scripts/check-version-drift.mjs --deep)
    // execs this binary headlessly on a CI runner with no daemon, and the
    // printed `pd-console v<ver>` literal doubles as the strings-extraction
    // marker the guard falls back to on non-runnable arches.
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("{BUILD_STAMP}");
        return;
    }

    // `--headless-capture <path>` renders the render-agnostic Block model to an
    // offscreen PNG with no window, no display, and no Screen-Recording (TCC)
    // permission — agent-safe visual proof. It intentionally runs BEFORE window +
    // daemon init and returns without ever calling `Application::new()`. This is
    // the Block model, NOT the GPUI/Metal framebuffer: gpui 0.2.2 exposes no
    // offscreen Metal readback (see docs/artifacts/gpui/HEADLESS-CAPTURE.md).
    {
        let args: Vec<String> = std::env::args().collect();
        if let Some(i) = args.iter().position(|a| a == "--headless-capture") {
            // Fall back to the default when the next token is another flag (or
            // absent) rather than silently writing to a path like `--list-displays`.
            let out = args
                .get(i + 1)
                .map(String::as_str)
                .filter(|a| !a.starts_with('-'))
                .unwrap_or("headless-capture.png");
            let state = args
                .iter()
                .position(|a| a == "--mission-state")
                .and_then(|index| args.get(index + 1))
                .map(String::as_str)
                .unwrap_or("in_progress");
            match headless_capture::capture_state_to_path(out, state) {
                Ok(bytes) => {
                    println!("pd-console headless-capture -> {out} ({bytes} bytes, no window/display/TCC)");
                    return;
                }
                Err(e) => {
                    eprintln!("pd-console headless-capture failed: {e}");
                    std::process::exit(1);
                }
            }
        }
    }

    // Seed operator presentation preferences before the window opens.
    app::init_theme_from_env();
    app::init_motion_from_env();

    // Canonical daemon discovery: PORT_DADDY_URL env var → daemon.port file →
    // the stable berth default. All fallback logic lives in
    // DaemonClient::discover(); no literals here. Discovery is infallible now —
    // with nothing registered the console opens against the stable berth and the
    // panes render reachability honestly instead of panicking pre-window.
    let daemon_url = DaemonClient::discover()
        .expect("daemon discovery is infallible")
        .base()
        .to_string();

    let cli_args = parse_console_args(std::env::args());
    let initial_pane = cli_args.initial_pane.clone();
    let control_sock = cli_args.control_sock.clone();

    // `--display <selector>` opens the window on a specific display instead of the
    // primary one. `selector` is a 0-based index into the display list (see
    // `--list-displays`) or a display UUID. The visual-proof harness uses this to
    // render onto an off-screen virtual display so capture never intrudes on the
    // operator's physical monitor. `--list-displays` prints the displays and exits.
    let display_selector = cli_args.display_selector.clone();
    let list_displays = cli_args.list_displays;

    Application::new()
        .with_assets(FsAssets::locate())
        .run(move |cx: &mut App| {
        let daemon_url = daemon_url.clone();

        // Enumerate displays once: drives `--list-displays` and `--display` resolution.
        let displays = cx.displays();
        if list_displays {
            println!("pd-console: {} display(s)", displays.len());
            for (i, d) in displays.iter().enumerate() {
                let id: u32 = d.id().into();
                let uuid = d.uuid().map(|u| u.to_string()).unwrap_or_else(|_| "<none>".into());
                let b = d.bounds();
                println!(
                    "  [{i}] id={id} uuid={uuid} origin=({:.0},{:.0}) size={:.0}x{:.0}",
                    b.origin.x.to_f64(),
                    b.origin.y.to_f64(),
                    b.size.width.to_f64(),
                    b.size.height.to_f64()
                );
            }
            cx.quit();
            return;
        }

        // Resolve the `--display` selector → DisplayId: numeric index first, then a
        // UUID match. An unmatched selector warns and uses the primary display (None)
        // rather than failing the capture run.
        let display_refs: Vec<(DisplayId, Option<String>)> = displays
            .iter()
            .map(|d| (d.id(), d.uuid().ok().map(|u| u.to_string())))
            .collect();
        let display_selection =
            resolve_display_selector(display_selector.as_deref(), &display_refs);
        if let Some(warning) = &display_selection.warning {
            eprintln!("{warning}");
        }
        let chosen_display = display_selection.display_id;

        // Operator control plane: the Lane's Interrupt button (foreground) sends
        // ControlMsg to the background thread that owns the surfaces + daemon.
        let (control_tx, control_rx) = mpsc::channel::<app::ControlMsg>();

        // The CLI drawer owns one real login-shell PTY for the lifetime of the
        // window. Launch failure stays visible in the drawer; it never aborts the
        // operator console or degrades into a fake command dispatcher.
        let shell_cwd = shell_drawer::default_cwd();
        let (shell, mut shell_rx) = match shell_drawer::ShellTerminal::spawn(shell_cwd.clone()) {
            Ok(session) => session,
            Err(error) => {
                let failure = shell_drawer::ShellFailure::new(
                    "PTY_LAUNCH_FAILED",
                    "The CLI shell could not be launched.",
                    format!("{error:#}"),
                    "Choose a valid login shell, then relaunch pd-console.",
                );
                eprintln!("{}", failure.operator_message());
                let (_event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
                (
                    shell_drawer::ShellTerminal::disconnected_with_recovery(shell_cwd, failure),
                    event_rx,
                )
            }
        };

        let bounds = Bounds::centered(chosen_display, size(px(1200.0), px(800.0)), cx);

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
                    display_id: chosen_display,
                    ..Default::default()
                },
                |window, cx| {
                    let control_tx = control_tx.clone();
                    let view = cx.new(|cx| {
                        ConsoleView::with_control(
                            daemon_url.clone(),
                            initial_pane.clone(),
                            Some(control_tx),
                            shell,
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

        // PTY output is latency-sensitive operator feedback, so it has its own
        // event-driven foreground consumer rather than waiting for the 500ms
        // daemon-pane refresh cadence below.
        let shell_window = window;
        let shell_async_cx = cx.to_async();
        cx.foreground_executor()
            .spawn(async move {
                while let Some(event) = shell_rx.recv().await {
                    let _ = shell_async_cx.update(|app| {
                        let _ = shell_window.update(app, |view: &mut ConsoleView, _, cx| {
                            view.apply_shell_event(event);
                            cx.notify();
                        });
                    });
                }
            })
            .detach();

        // ── Multi-pane refresh pipeline ───────────────────────────────────────
        // Producer: std thread with mini tokio runtime — refreshes all panes every 2s.
        // Sends Vec<(nav_index, Vec<Block>)> so the view can update each slot.
        //
        // NAV order mirrors grid::NAV:
        //  0=Fleet  1=Cockpit  2=Sorties  3=Claims  4=Peek  5=Roadmap  6=ADRs
        //  7=Activity  8=Sessions  9=Inbox  10=Suggest  11=Memory  12=PRs
        //  13=Health  14=CoastGuard  15=Dispatch  16=Lane  17=Ledger  18=Lineage
        //  19=Substrate  20=Parley  21=Conductor  22=Daemons  23=Cloud Fleet
        //  24=Active Agents  25=Harbor  26=Sextant  27=Interruptions (HITL)
        //
        // The tuple also carries Sextant's typed snapshot (points + clusters)
        // alongside the render-agnostic blocks, so the bespoke canvas draws the
        // REAL map data instead of re-parsing display text (DispatchHead precedent).
        let (tx, rx) = mpsc::channel::<(
            Vec<(usize, Vec<pane::Block>)>,
            Option<dispatch_pane::DispatchHead>,
            galaxy_pane::GalaxySnapshot,
            bool,
            interruptions::HitlGate,
        )>();
        // Alert bus: the bg thread captures the daemon's REAL rejection from any
        // operator action and pushes it here instead of swallowing it (`let _ =`).
        // The fg drains it alongside pane updates — the keystone that turns
        // "nothing happens" into "spawn rejected: <why>".
        let (alert_tx, alert_rx) = mpsc::channel::<pane::Alert>();
        // Work bus: command receipts and restart-safe daemon snapshots flow back
        // to the foreground-owned Work surface. Rendered PNGs are artifacts of
        // that truth, never an independent planning source.
        let (work_tx, work_rx) = mpsc::channel::<app::WorkUpdate>();
        // Chat bus currently carries the honest absence of a governed responder.
        // A chat turn captures WorkIntent rather than silently spawning a vendor.
        let (chat_tx, chat_rx) = mpsc::channel::<chat::ChatUpdate>();
        // The Harbor Editor's LIVE blocks (P3 wire stage 2): the producer folds the
        // edit-sync + coordination lanes into its persistent EditorPane, then pushes
        // `(bound_path, view())` here on each fold edge for the foreground to surface on
        // the Editor surface — the wedge finally shows in the RUNNING window.
        let (editor_tx, editor_rx) = mpsc::channel::<app::EditorUpdate>();
        // Sextant bus: the bg thread owns the GET /galaxy/session/:id round-trip
        // for a clicked point and streams the parsed detail (or the daemon's real
        // failure) back to the view's drawer. Mirrors the WorkPlan bus: a small
        // dedicated channel, drained in the same 500ms foreground task.
        let (galaxy_tx, galaxy_rx) = mpsc::channel::<app::GalaxyUpdate>();
        // Scripting bus: the control-socket thread parses newline-JSON commands
        // and parks each one here with a reply slot; the 500ms foreground task
        // answers with full ConsoleView access (`--control-sock` / env).
        let (script_tx, script_rx) = mpsc::channel::<script::ScriptEnvelope>();
        if let Some(sock) = control_sock.clone() {
            script::start_server(sock, script_tx);
        }
        let url = daemon_url.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio rt");
            rt.block_on(async move {
                // Mutable so the operator can switch which daemon the whole console
                // talks to at runtime (ControlMsg::RebindDaemon, ADR-0084). Swapping
                // it re-points every pane's next refresh; no restart.
                let mut client = DaemonClient::new(url);

                // One pane per NAV slot.
                // Slot 2 "Sorties" is the SortiePane multiplexer (all sorties bucketed
                // running/blocked/done over GET /sorties — #344). The dispatch review
                // queue (GET /dispatches?state=review_pending) is its own slot 15 so both
                // operator surfaces survive; folding them lost the at-a-glance view.
                let mut fleet      = FleetPane::new();         // 0
                let mut cockpit    = CockpitPane::new();       // 1
                let mut sorties    = SortiePane::new();        // 2
                let mut claims     = ClaimsPane::new();        // 3
                let mut peek       = PeekPane::new();          // 4
                let mut roadmap    = PlannerPane::new();       // 5 (Planner — replaces Roadmap; ADR-0086)
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
                let mut parley     = ParleyPane::new();        // 20 — RCP-2a convene decision
                let mut conductor  = ConductorPane::new();     // 21 — Fleet Conductor (ADR-0060)
                let mut daemons    = DaemonPane::new();         // 22 — daemon picker (ADR-0084)
                let mut cloud_fleet = CloudFleetPane::new();    // 23 — remote relay observability (Phase C)
                let mut live_agents = ActiveAgentsPane::new();  // 24 — harness roster
                let mut harbor     = HarborPane::new();         // 25 — Agent Node roster+detail (ch18 C3)
                let mut galaxy      = GalaxyPane::new();        // 26 — Sextant embedding map
                let mut hitl        = InterruptionsPane::new(); // 27 — HITL operator interruptions

                // Pin the producer slots to the canonical grid map. If a pane is
                // added, reordered, or swapped without updating `app::SLOT_PANE_IDS`
                // (and `NAV`), this fires in debug/test builds — the same map the
                // `grid_is_one_to_one_with_pane_slots` test asserts against, so the
                // launcher grid can never silently drift from the real panes.
                debug_assert_eq!(
                    [
                        fleet.id(), cockpit.id(), sorties.id(), claims.id(), peek.id(),
                        roadmap.id(), adrs.id(), activity.id(), sessions.id(), inbox.id(),
                        suggest.id(), memory.id(), prs.id(), health.id(), coast.id(),
                        dispatch.id(), lane.id(), ledger.id(), lineage.id(), substrate.id(),
                        parley.id(), conductor.id(), daemons.id(), cloud_fleet.id(), live_agents.id(),
                        harbor.id(),
                        galaxy.id(),
                        hitl.id(),
                    ],
                    grid::SLOT_PANE_IDS,
                    "producer slot order drifted from grid::SLOT_PANE_IDS",
                );

                // The Lane's live SSE stream. We (re)open it whenever the watched
                // agent changes; envelopes are drained every loop into the lane,
                // so the view updates at the 2s cadence with the freshest frames.
                // (A finer cadence is a follow-up; this proves the live pipeline.)
                let mut lane_stream: Option<(String, tokio::sync::mpsc::Receiver<agent::StreamEnvelope>)> = None;

                // The Harbor pane's live SSE stream — same pattern as the lane:
                // (re)opened whenever the selected live node changes; drained
                // each loop into the pane's live tail.
                let mut harbor_stream: Option<(String, tokio::sync::mpsc::Receiver<agent::StreamEnvelope>)> = None;

                // The Harbor Editor's live lane (P3 wire stage 1). `editor` is the
                // persistent pane bound to the operator's currently-open file (set by
                // `ControlMsg::OpenEditor`); `editor_stream` holds its TWO isolated tube
                // receivers — (edit_channel, edit-sync rx, coordination rx) — (re)opened
                // whenever the bound file changes. Two independent `subscribe_channel`
                // mpsc's IS the edit-lane ⇄ coordination-lane isolation (ref-03 §3).
                // `None` until the operator opens an Editor surface.
                let mut editor: Option<editor_pane::EditorPane> = None;
                let mut editor_stream: Option<(
                    String,
                    tokio::sync::mpsc::Receiver<agent::TubeMsg>,
                    tokio::sync::mpsc::Receiver<agent::TubeMsg>,
                )> = None;

                // Rehydrate Work truth only when its durable identity/state changes.
                let mut latest_work_projection: Option<(String, String, String)> = None;
                let mut latest_work_query_error: Option<String> = None;
                // Once the operator starts a mission, keep following that exact
                // WorkIntent even if another client creates newer work.
                let mut tracked_work_intent_id: Option<String> = None;

                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;

                    // Operator control: drain any Interrupt requests from the UI and
                    // perform them against the agent the lane is watching.
                    while let Ok(msg) = control_rx.try_recv() {
                        // Every arm captures the daemon's outcome and, on failure,
                        // pushes a full-detail Alert up the bus. No `let _ =` swallow.
                        match msg {
                            app::ControlMsg::InterruptLane => {
                                if let Err(e) = lane
                                    .mutate(&client, SurfaceAction::Interrupt { reason: Some("operator stop".into()) })
                                    .await
                                {
                                    let _ = alert_tx.send(pane::Alert::error("interrupt failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::SubmitWorkIntent { goal } => {
                                match client.capture_work_intent(&goal).await {
                                    Ok(receipt) => {
                                        let intent_id = receipt.snapshot.intent_id().to_string();
                                        let state = receipt.snapshot.plan_state().to_string();
                                        let correlation = receipt.correlation_id.clone();
                                        let duplicate = receipt.duplicate;
                                        let snapshot = receipt.snapshot.clone();
                                        tracked_work_intent_id = Some(intent_id.clone());
                                        latest_work_projection = Some((
                                            intent_id.clone(),
                                            state.clone(),
                                            snapshot.execution_fingerprint(),
                                        ));
                                        let _ = work_tx.send(app::WorkUpdate::Receipt(receipt));
                                        match client.start_work_intent(&snapshot).await {
                                            Ok(execution) => {
                                                let runtime_state = execution.state.clone();
                                                let execution_id = execution.dispatch_id.clone();
                                                let launched = execution.launched_this_tick;
                                                lane.follow_agent(execution.agent_id.as_deref());
                                                let _ = work_tx.send(app::WorkUpdate::Execution(execution));
                                                let _ = alert_tx.send(pane::Alert::info(
                                                    format!("WorkIntent started: {intent_id}"),
                                                    format!(
                                                        "runtime {runtime_state} · receipt {execution_id} · trace {correlation} · {launched} worker claim processed{}",
                                                        if duplicate { " · capture replay" } else { "" }
                                                    ),
                                                ));
                                            }
                                            Err(error) => {
                                                let _ = alert_tx.send(pane::Alert::error(
                                                    format!("WorkIntent captured; runtime start failed: {intent_id}"),
                                                    format!(
                                                        "{error} · retry uses the same idempotency key; inspect the Work receipt before assuming no body started"
                                                    ),
                                                ));
                                            }
                                        }
                                    }
                                    Err(error) => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "WorkIntent capture failed",
                                            format!(
                                                "{error} · no provider, node, or run was started"
                                            ),
                                        ));
                                    }
                                }
                            }
                            // Send a turn to the cartographer over its tube channel.
                            app::ControlMsg::Cartographer { text } => {
                                if let Err(e) = client.tube_send("cartographer", &text, "operator").await {
                                    let _ = alert_tx.send(pane::Alert::error("cartographer send failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::MessageLane { text } => {
                                if let Err(e) = lane
                                    .mutate(
                                        &client,
                                        SurfaceAction::OperatorTurn {
                                            turn: OperatorTurn::parse(text),
                                        },
                                    )
                                    .await
                                {
                                    let _ = alert_tx.send(pane::Alert::error(
                                        "agent message failed",
                                        e.to_string(),
                                    ));
                                }
                            }
                            app::ControlMsg::ChatSend { text } => {
                                if lane.has_agent() {
                                    if let Err(error) = lane
                                        .mutate(
                                            &client,
                                            SurfaceAction::OperatorTurn {
                                                turn: OperatorTurn::parse(text),
                                            },
                                        )
                                        .await
                                    {
                                        let _ = chat_tx.send(chat::ChatUpdate::Error(format!(
                                            "operator turn was not delivered: {error}"
                                        )));
                                    }
                                    continue;
                                }

                                let goal = format!(
                                    "Answer this operator message directly and briefly, then record any useful next action: {text}"
                                );
                                match client.capture_work_intent(&goal).await {
                                    Ok(receipt) => {
                                        let intent_id = receipt.snapshot.intent_id().to_string();
                                        let state = receipt.snapshot.plan_state().to_string();
                                        let snapshot = receipt.snapshot.clone();
                                        latest_work_projection = Some((
                                            intent_id.clone(),
                                            state,
                                            snapshot.execution_fingerprint(),
                                        ));
                                        let _ = work_tx.send(app::WorkUpdate::Receipt(receipt));
                                        match client.start_work_intent(&snapshot).await {
                                            Ok(execution) => {
                                                let runtime_state = execution.state.clone();
                                                let execution_id = execution.dispatch_id.clone();
                                                let _ = work_tx.send(app::WorkUpdate::Execution(execution));
                                                let _ = chat_tx.send(chat::ChatUpdate::Reply(
                                                    chat::ChatMsg::agent(
                                                        "port-daddy",
                                                        format!(
                                                            "governed responder {runtime_state}; receipt {execution_id}. Live assistant turns will stream here."
                                                        ),
                                                    ),
                                                ));
                                            }
                                            Err(error) => {
                                                let _ = chat_tx.send(chat::ChatUpdate::Error(format!(
                                                    "conversation WorkIntent {intent_id} is durable, but runtime start is unknown: {error}"
                                                )));
                                            }
                                        }
                                    }
                                    Err(error) => {
                                        let _ = chat_tx.send(chat::ChatUpdate::Error(format!(
                                            "conversation intent was not captured: {error}; no responder was requested"
                                        )));
                                    }
                                }
                            }
                            // Operator review-gate verdicts on a dispatch.
                            app::ControlMsg::DispatchAccept { id } => {
                                if let Err(e) = client.dispatch_action(&id, "accept", None).await {
                                    let _ = alert_tx.send(pane::Alert::error("gate approval failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::DispatchReject { id, reason } => {
                                if let Err(e) = client.dispatch_action(&id, "reject", Some(&reason)).await {
                                    let _ = alert_tx.send(pane::Alert::error("gate rejection failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::DispatchCancel { id } => {
                                if let Err(e) = client.dispatch_action(&id, "cancel", Some("operator cancelled")).await {
                                    let _ = alert_tx.send(pane::Alert::error("gate cancellation failed", e.to_string()));
                                }
                            }
                            // Conductor operator control (ADR-0060): grab the wheel on the fleet.
                            app::ControlMsg::FleetHalt { root_id } => {
                                if let Err(e) = client.fleet_action("halt", root_id.as_deref()).await {
                                    let _ = alert_tx.send(pane::Alert::error("fleet halt failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::FleetPause { root_id } => {
                                if let Err(e) = client.fleet_action("pause", root_id.as_deref()).await {
                                    let _ = alert_tx.send(pane::Alert::error("fleet pause failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::FleetResume { root_id } => {
                                if let Err(e) = client.fleet_action("resume", root_id.as_deref()).await {
                                    let _ = alert_tx.send(pane::Alert::error("fleet resume failed", e.to_string()));
                                }
                            }
                            // WorkPlan → Vello: write the live DAG JSON where the proto
                            // reads it, build+run capture.sh (RELEASE + UNSANDBOXED —
                            // debug fontique panics on macOS 15 and the Metal readback
                            // is SIGKILLed under a sandbox), then `open` the PNG. The
                            // whole shell-out runs on a blocking worker so the 2s
                            // refresh cadence above never stalls on a release build.
                            app::ControlMsg::RenderWorkGraph { dag_json, title } => {
                                let alert_tx = alert_tx.clone();
                                let work_tx = work_tx.clone();
                                tokio::task::spawn_blocking(move || {
                                    match render_work_graph_png(&dag_json) {
                                        Ok(png) => {
                                            // Slot the fresh PNG into the INLINE graphic too,
                                            // not just the external `open` — the operator sees
                                            // it update in-pane.
                                            let _ = work_tx.send(app::WorkUpdate::Png(png.clone()));
                                            // Surface the PNG to the operator (best-effort `open`).
                                            let _ = std::process::Command::new("open").arg(&png).status();
                                            let _ = alert_tx.send(pane::Alert::info(
                                                format!("rendered “{title}”"),
                                                format!("Vello PNG written + opened: {}", png.display()),
                                            ));
                                        }
                                        Err(e) => {
                                            let _ = alert_tx.send(pane::Alert::error(
                                                "work graph render failed",
                                                e.to_string(),
                                            ));
                                        }
                                    }
                                });
                            }
                            // Switch the whole console to another daemon berth: swap
                            // the client so every pane's next refresh hits the new
                            // daemon. The DaemonPane re-marks the active one because
                            // it reads `client.base()` on refresh.
                            app::ControlMsg::RebindDaemon { url } => {
                                client = DaemonClient::new(url);
                                lane_stream = None; // drop the old daemon's SSE stream
                                editor_stream = None; // and the editor's edit/coord streams
                                latest_work_projection = None;
                                latest_work_query_error = None;
                                tracked_work_intent_id = None;
                            }
                            // Steer the Sextant pane's query; the next 2s refresh
                            // fetches with the new window/floor.
                            app::ControlMsg::GalaxyParams { window_hours, min_tokens } => {
                                galaxy.set_params(window_hours, min_tokens);
                            }
                            app::ControlMsg::GalaxyCluster { enabled } => {
                                galaxy.set_cluster(enabled);
                            }
                            // Add an operator note (POST /notes).
                            app::ControlMsg::AddNote { content } => {
                                match client.add_note(&content).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            "note added",
                                            "the Notes/Memory pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ =
                                            alert_tx.send(pane::Alert::error("note failed", e.to_string()));
                                    }
                                }
                            }
                            // Begin a coordination session (POST /sugar/begin).
                            app::ControlMsg::BeginSession { identity } => {
                                match client.begin_session(&identity, None).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("session begun: {identity}"),
                                            "Sessions pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx
                                            .send(pane::Alert::error("begin failed", e.to_string()));
                                    }
                                }
                            }
                            // End the active session (POST /sugar/done).
                            app::ControlMsg::EndSession { summary } => {
                                match client.end_session(summary.as_deref()).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            "session ended",
                                            "Sessions pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ =
                                            alert_tx.send(pane::Alert::error("done failed", e.to_string()));
                                    }
                                }
                            }
                            // Claim a port for an identity (POST /claim).
                            app::ControlMsg::ClaimPort { identity } => {
                                match client.claim_port(&identity).await {
                                    Ok(port) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("claimed {identity}"),
                                            format!("port {port} assigned"),
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx
                                            .send(pane::Alert::error("claim failed", e.to_string()));
                                    }
                                }
                            }
                            // Release a claimed port by identity (DELETE /release).
                            app::ControlMsg::ReleasePort { identity } => {
                                match client.release_port(&identity).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("released {identity}"),
                                            "Claims pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx
                                            .send(pane::Alert::error("release failed", e.to_string()));
                                    }
                                }
                            }
                            // Kill (unregister) an agent (DELETE /agents/:id).
                            app::ControlMsg::KillAgent { agent_id } => {
                                match client.kill_agent(&agent_id).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("killed {agent_id}"),
                                            "Fleet/Cockpit panes will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ =
                                            alert_tx.send(pane::Alert::error("kill failed", e.to_string()));
                                    }
                                }
                            }
                            // Interrupt a specific agent (POST /agents/:id/interrupt).
                            app::ControlMsg::InterruptAgent { agent_id } => {
                                match client.interrupt(&agent_id, Some("operator stop")).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("stop requested for {agent_id}"),
                                            "runtime acknowledgement pending",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "interrupt failed",
                                            e.to_string(),
                                        ));
                                    }
                                }
                            }
                            // Convene a parley from a Sextant selection (POST
                            // /parley/call). Parties are agent ids the view
                            // already deduped/gated at >=2; a daemon rejection
                            // (400 body) surfaces VERBATIM on the alert bus.
                            app::ControlMsg::GalaxyParley { surface, reason, session_ids } => {
                                match client.call_parley(&surface, &reason, &session_ids).await {
                                    Ok(v) => {
                                        let parley = v.get("parley").cloned().unwrap_or_default();
                                        let parley_id = parley
                                            .get("parleyId")
                                            .and_then(|x| x.as_str())
                                            .unwrap_or("?")
                                            .to_string();
                                        let channel = parley
                                            .get("channel")
                                            .and_then(|x| x.as_str())
                                            .unwrap_or("?")
                                            .to_string();
                                        let _ = alert_tx.send(pane::Alert::info(
                                            "parley convened",
                                            format!(
                                                "parley {parley_id} on channel {channel} · {} source sessions · surface {surface}",
                                                session_ids.len()
                                            ),
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "parley call failed",
                                            e.to_string(),
                                        ));
                                    }
                                }
                            }
                            // Fetch one Sextant session's full detail through the
                            // internal daemon API (GET /galaxy/session/:id) and push
                            // the parsed result — or the real failure — down the
                            // dedicated Sextant bus.
                            app::ControlMsg::GalaxyDetail { transcript_id } => {
                                let url =
                                    format!("{}/galaxy/session/{transcript_id}", client.base());
                                match client.http_client().get(&url).send().await {
                                    Err(e) => {
                                        let _ = galaxy_tx.send(app::GalaxyUpdate::DetailError(
                                            format!("daemon unreachable: {e}"),
                                        ));
                                    }
                                    Ok(resp) => {
                                        let status = resp.status();
                                        if !status.is_success() {
                                            let body = resp.text().await.unwrap_or_default();
                                            let _ = galaxy_tx.send(app::GalaxyUpdate::DetailError(
                                                format!(
                                                    "GET /galaxy/session/{transcript_id} -> {status}: {}",
                                                    body.trim()
                                                ),
                                            ));
                                        } else {
                                            match resp.json::<serde_json::Value>().await {
                                                Err(e) => {
                                                    let _ = galaxy_tx.send(
                                                        app::GalaxyUpdate::DetailError(format!(
                                                            "bad response: {e}"
                                                        )),
                                                    );
                                                }
                                                Ok(v) => {
                                                    let _ = galaxy_tx.send(app::GalaxyUpdate::Detail(
                                                        galaxy_pane::detail_from_value(&v),
                                                    ));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Harbor roster click: select a node (ch18 C3).
                            // Selection is a UI act; it never fails loudly.
                            app::ControlMsg::HarborSelect { index } => {
                                if let Err(e) = harbor
                                    .mutate(&client, SurfaceAction::SelectRow { index })
                                    .await
                                {
                                    let _ = alert_tx.send(pane::Alert::error(
                                        "harbor select failed",
                                        e.to_string(),
                                    ));
                                }
                            }
                            // Harbor control verb: the pane gate-checks, then
                            // POSTs the F0 ControlCommand; the daemon is the
                            // sole authorizer. Refusals surface in FULL as
                            // HITL alerts (why-disabled / daemon denial).
                            app::ControlMsg::HarborControl { verb, argument } => {
                                match harbor
                                    .mutate(
                                        &client,
                                        SurfaceAction::Control {
                                            verb: verb.clone(),
                                            argument,
                                        },
                                    )
                                    .await
                                {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            format!("{verb} queued"),
                                            "watch the node's control history for the acknowledgement",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            format!("{verb} refused"),
                                            e.to_string(),
                                        ));
                                    }
                                }
                            }
                            // Bind the live Harbor Editor lane to a file (wire stage 1):
                            // build a persistent EditorPane on this path + operator
                            // identity, load its Loro buffer, and force a (re)subscribe so
                            // the drain block below follows its edit-sync + coordination
                            // channels. A fresh pane drops any prior file's buffer/streams.
                            app::ControlMsg::OpenEditor { path, region } => {
                                let identity = editor_pane::resolve_operator_identity();
                                let mut pane = editor_pane::EditorPane::new_with_identity(
                                    path, region, identity,
                                );
                                pane.load();
                                editor = Some(pane);
                                editor_stream = None; // resubscribe to the new file's channels
                            }
                            app::ControlMsg::EditorLocalChange {
                                path,
                                frame,
                                presence,
                            } => {
                                let Some(ed) = editor.as_mut().filter(|ed| ed.path_str() == path) else {
                                    let _ = alert_tx.send(pane::Alert::error(
                                        "editor change not mirrored",
                                        format!("live lane is not bound to {path}"),
                                    ));
                                    continue;
                                };
                                let mut changed = false;
                                if let Some(frame) = frame {
                                    changed |= ed.ingest_local_frame(&frame);
                                    if let Err(error) = client
                                        .tube_send(ed.channel(), &frame, "editor")
                                        .await
                                    {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "editor delta broadcast failed",
                                            error.to_string(),
                                        ));
                                    }
                                }
                                ed.set_local_presence(presence);
                                let now_ms = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|duration| duration.as_millis() as i64)
                                    .unwrap_or_default();
                                if let Some(frame) = ed.take_presence_broadcast(now_ms) {
                                    if let Err(error) = client.send_presence(ed.channel(), &frame).await {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "editor presence broadcast failed",
                                            error.to_string(),
                                        ));
                                    }
                                }
                                if changed {
                                    let _ = editor_tx.send(app::EditorUpdate {
                                        path: ed.path_str().to_string(),
                                        blocks: ed.view(),
                                        remote_frames: Vec::new(),
                                    });
                                }
                            }
                        }
                    }

                    let query_limit = if tracked_work_intent_id.is_some() { 100 } else { 1 };
                    match client.list_work_intents(query_limit).await {
                        Ok(snapshots) => {
                            latest_work_query_error = None;
                            let snapshot = match tracked_work_intent_id.as_deref() {
                                Some(intent_id) => snapshots
                                    .into_iter()
                                    .find(|snapshot| snapshot.intent_id() == intent_id),
                                None => snapshots.into_iter().next(),
                            };
                            if let Some(snapshot) = snapshot {
                                let fingerprint = (
                                    snapshot.intent_id().to_string(),
                                    snapshot.plan_state().to_string(),
                                    snapshot.execution_fingerprint(),
                                );
                                lane.follow_agent(snapshot.execution_agent_id());
                                if latest_work_projection.as_ref() != Some(&fingerprint) {
                                    latest_work_projection = Some(fingerprint);
                                    let _ = work_tx.send(app::WorkUpdate::Snapshot(snapshot));
                                }
                            }
                        }
                        Err(error) => {
                            // Force the first successful read after an outage through
                            // the WorkUpdate bus even when the durable snapshot itself
                            // is unchanged. The view uses that recovery delivery to
                            // clear only the stale projection-failure alert.
                            latest_work_projection = None;
                            let detail = error.to_string();
                            if latest_work_query_error.as_deref() != Some(detail.as_str()) {
                                latest_work_query_error = Some(detail.clone());
                                let _ = alert_tx.send(pane::Alert::error(
                                    "Work projection unavailable",
                                    format!(
                                        "{detail} · existing pane data may be stale; no fallback plan was generated"
                                    ),
                                ));
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
                    let _ = parley.refresh(&client).await;
                    let _ = conductor.refresh(&client).await;
                    let _ = daemons.refresh(&client).await;
                    let _ = cloud_fleet.refresh(&client).await;
                    let _ = live_agents.refresh(&client).await;
                    let _ = harbor.refresh(&client).await;
                    let _ = galaxy.refresh(&client).await;
                    let _ = hitl.refresh(&client).await;

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
                            let speaker = env.agent_id.clone();
                            lane.on_stream(&env);
                            for reply in lane.take_chat_replies() {
                                let _ = chat_tx.send(chat::ChatUpdate::Reply(
                                    chat::ChatMsg::agent(speaker.clone(), reply),
                                ));
                            }
                        }
                    }

                    // (Re)subscribe + drain the Harbor's live follow of its
                    // selected node (only while daemon-proved live).
                    match harbor.subscription() {
                        Some(pane::Subscription::Agent { agent_id }) => {
                            let reopen = match &harbor_stream {
                                Some((cur, _)) => cur != &agent_id,
                                None => true,
                            };
                            if reopen {
                                let rx = client.subscribe_agent(&agent_id);
                                harbor_stream = Some((agent_id, rx));
                            }
                        }
                        // The Harbor pane only ever follows an agent stream. The
                        // Editor's per-file op-stream subscription (P2 slice 1) is
                        // driven by the editor surface itself, not here — so an
                        // Editor intent on this pane means "nothing to follow".
                        Some(pane::Subscription::Editor { .. }) | None => harbor_stream = None,
                    }
                    if let Some((_, rx)) = harbor_stream.as_mut() {
                        while let Ok(env) = rx.try_recv() {
                            harbor.on_stream(&env);
                        }
                    }

                    // (Re)subscribe + drain the Harbor Editor's live lane (P3 wire stage
                    // 1) — the same declare-intent/follow contract the Lane and Harbor use
                    // for an agent stream, but an editor follows TWO isolated channels:
                    // the edit-sync lane (durable Loro ops + lossy presence, folded via
                    // `on_edit_frame`) and the coordination lane (region claims, folded via
                    // `on_coord_frame`). We open one `subscribe_channel` per channel — two
                    // independent mpsc receivers, which IS the isolation — whenever the
                    // bound file changes, then drain both into the pane. `expire_presence`
                    // each tick ages out a peer that went quiet. view() rendering is
                    // unchanged here; surfacing these Blocks is wire stage 2.
                    if let Some(ed) = editor.as_mut() {
                        // Edge-triggered: `editor_dirty` becomes true only when the bound
                        // file (re)binds or a real frame folds a change, so wire stage 2
                        // pushes view() to the foreground on a paint EDGE — an idle editor
                        // with live cursors sends nothing (the P2 discipline, carried here).
                        let mut editor_dirty = false;
                        let mut remote_frames = Vec::new();
                        match ed.subscription() {
                            Some(pane::Subscription::Editor { channel, coord_channel }) => {
                                let reopen = match &editor_stream {
                                    Some((cur, _, _)) => cur != &channel,
                                    None => true,
                                };
                                if reopen {
                                    let edit_rx = client.subscribe_channel(&channel);
                                    let coord_rx = client.subscribe_channel(&coord_channel);
                                    editor_stream = Some((channel, edit_rx, coord_rx));
                                    editor_dirty = true; // a freshly (re)bound file paints once
                                }
                            }
                            // A not-yet-loaded / errored editor pane has no buffer to fold
                            // remote frames into, so it follows nothing (poll-only).
                            _ => editor_stream = None,
                        }
                        if let Some((_, edit_rx, coord_rx)) = editor_stream.as_mut() {
                            // The bool-returning inherent folds report the change edge the
                            // trait hooks discard; OR it into `editor_dirty` so a folded op /
                            // presence cursor / region claim triggers exactly one repaint.
                            while let Ok(msg) = edit_rx.try_recv() {
                                // The edit-sync lane multiplexes durable Loro op
                                // frames and lossy presence frames under distinct
                                // frame kinds (`ingest_frame` / `ingest_presence`
                                // are mutually exclusive); `||` short-circuits so a
                                // frame folds through exactly one path.
                                if ed.ingest_frame(&msg.text) {
                                    editor_dirty = true;
                                    remote_frames.push(msg.text);
                                } else {
                                    editor_dirty |= ed.ingest_presence(&msg.text);
                                }
                            }
                            while let Ok(msg) = coord_rx.try_recv() {
                                editor_dirty |= ed.ingest_claim(&msg.text);
                            }
                        }
                        editor_dirty |= ed.expire_presence();
                        // Surface the folded pane on the edge — presence cursors, claim
                        // bands, and the wedge conflict/gate Blocks now flow to the window.
                        if editor_dirty {
                            let _ = editor_tx.send(app::EditorUpdate {
                                path: ed.path_str().to_string(),
                                blocks: ed.view(),
                                remote_frames,
                            });
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
                        (20, parley.view()),
                        (21, conductor.view()),
                        (22, daemons.view()),
                        (23, cloud_fleet.view()),
                        (24, live_agents.view()),
                        (25, harbor.view()),
                        (26, galaxy.view()),
                        (27, hitl.view()),
                    ];

                    if tx
                        .send((
                            all,
                            dispatch.head(),
                            galaxy.snapshot(),
                            health.is_connected(),
                            hitl.gate(),
                        ))
                        .is_err()
                    {
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
                let mut size_nudged = false;
                loop {
                    bg.timer(Duration::from_millis(500)).await;
                    while let Ok((panes, dispatch_head, galaxy_snapshot, daemon_connected, hitl_gate)) =
                        rx.try_recv()
                    {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                // Notify ONLY when a pane actually changed — an
                                // idle 2s refresh cycle schedules zero repaints.
                                if view.update_panes(
                                    panes.clone(),
                                    dispatch_head.clone(),
                                    galaxy_snapshot.clone(),
                                    daemon_connected,
                                    hitl_gate.clone(),
                                ) {
                                    present_changed_frame(window, cx, &mut size_nudged);
                                }
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                    // Drain the alert bus: every captured action failure/outcome
                    // lands in the view (flash + accumulated HITL log).
                    while let Ok(alert) = alert_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                view.push_alert(alert.clone());
                                present_changed_frame(window, cx, &mut size_nudged);
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                    // Drain durable Work truth and render artifacts derived from it.
                    while let Ok(update) = work_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                view.apply_work_update(update.clone());
                                present_changed_frame(window, cx, &mut size_nudged);
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                    // Drain the chat bus: real replies down the tube (with the receive
                    // earcon) or a transport error, folded into the chat transcript.
                    while let Ok(update) = chat_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                view.apply_chat_update(update.clone());
                                present_changed_frame(window, cx, &mut size_nudged);
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                    // Drain the Harbor Editor bus (P3 wire stage 2): the producer's live
                    // pane blocks — presence cursors, region claims, wedge conflict/gate
                    // bands — folded into the Editor surface so the running window paints
                    // the collaboration state, not a cold file re-read.
                    while let Ok(editor_update) = editor_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.apply_editor_update(editor_update.clone());
                                cx.notify();
                            });
                        });
                    }
                    // Drain the Sextant bus: a clicked session's parsed detail
                    // (or the daemon's real failure) into the drawer state.
                    while let Ok(update) = galaxy_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                view.apply_galaxy_update(update.clone());
                                present_changed_frame(window, cx, &mut size_nudged);
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                    // Drain the scripting bus: answer each control-socket
                    // command from the view, on the foreground, and post the
                    // JSON reply back to the waiting socket thread.
                    while let Ok(envelope) = script_rx.try_recv() {
                        let script::ScriptEnvelope { request, reply } = envelope;
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, window, cx| {
                                let response = view.handle_script(request.clone());
                                let _ = reply.send(response);
                                present_changed_frame(window, cx, &mut size_nudged);
                            });
                        });
                        let _ = async_cx.refresh();
                    }
                }
            })
            .detach();
    });
}
