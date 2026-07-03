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
mod conjure;
mod daemon_pane;
mod dispatch_pane;
mod editor_pane;
mod fleet_pane;
mod grid;
mod health_pane;
mod inbox_pane;
mod lane_pane;
mod ledger_pane;
mod lineage_pane;
mod maritime;
mod mux;
mod notes_pane;
mod palette;
mod pane;
mod parley_pane;
mod peek_pane;
mod planner_pane;
mod prs_pane;
mod roadmap_pane;
mod sessions_pane;
mod sortie_pane;
mod substrate_pane;
mod suggest_pane;
mod term;
mod theme;
mod tokens;
mod util;

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
use health_pane::HealthPane;
use inbox_pane::InboxPane;
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

/// Resolve the `pd-conjure-proto` crate dir (the Vello renderer). Honors a
/// `PD_CONJURE_PROTO_DIR` override (a packaged app can point at an installed
/// copy); otherwise it is the sibling of this crate at build time
/// (`core/pd-console/../pd-conjure-proto`).
fn conjure_proto_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("PD_CONJURE_PROTO_DIR") {
        return std::path::PathBuf::from(dir);
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("pd-conjure-proto"))
        .unwrap_or_else(|| std::path::PathBuf::from("pd-conjure-proto"))
}

/// The Conjure → Vello render handoff (runs on a blocking worker, never the gpui
/// thread): write the serialized DAG where the proto reads it, then build+run
/// `scripts/capture.sh`. capture.sh builds RELEASE and runs the binary UNSANDBOXED
/// — both are required on macOS 15 (debug fontique panics; the Metal readback is
/// SIGKILLed in a sandbox). Returns the PNG path on success; an error carrying the
/// captured stderr otherwise (surfaced as a HITL alert, never swallowed).
fn render_conjure_png(dag_json: &str) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let proto = conjure_proto_dir();
    let script = proto.join("scripts").join("capture.sh");
    if !script.exists() {
        bail!(
            "capture.sh not found at {} — set PD_CONJURE_PROTO_DIR to the pd-conjure-proto crate",
            script.display()
        );
    }
    // Write the live DAG to the proto's input file (the same shape its fixture.json
    // carries) so capture.sh's default INPUT renders exactly what was conjured.
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
        .env("PATH", conjure::augmented_path())
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

fn main() {
    // Seed light/dark from PD_CONSOLE_THEME before the window opens (default dark).
    app::init_theme_from_env();

    // Canonical daemon discovery: PORT_DADDY_URL env var → daemon.port file → default.
    // All fallback logic lives in DaemonClient::discover(); no literals here.
    let daemon_url = DaemonClient::discover()
        .expect("daemon discovery failed")
        .base()
        .to_string();

    let cli_args = parse_console_args(std::env::args());
    let initial_pane = cli_args.initial_pane.clone();

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
        // NAV order mirrors grid::NAV:
        //  0=Fleet  1=Cockpit  2=Sorties  3=Claims  4=Peek  5=Roadmap  6=ADRs
        //  7=Activity  8=Sessions  9=Inbox  10=Suggest  11=Memory  12=PRs
        //  13=Health  14=CoastGuard  15=Dispatch  16=Lane  17=Ledger  18=Lineage
        //  19=Substrate  20=Parley  21=Conductor  22=Daemons  23=Cloud Fleet
        //  24=Active Agents
        let (tx, rx) =
            mpsc::channel::<(Vec<(usize, Vec<pane::Block>)>, Option<dispatch_pane::DispatchHead>)>();
        // Alert bus: the bg thread captures the daemon's REAL rejection from any
        // operator action and pushes it here instead of swallowing it (`let _ =`).
        // The fg drains it alongside pane updates — the keystone that turns
        // "nothing happens" into "spawn rejected: <why>".
        let (alert_tx, alert_rx) = mpsc::channel::<pane::Alert>();
        // Conjure bus: the bg worker streams the live-generated DAG (claude:cli)
        // and the rendered Vello PNG path back to the view, which swaps to the
        // Conjure surface and shows the inline graphic. Separate from the pane bus
        // because these are foreground-owned surfaces, not background NAV panes.
        let (conjure_tx, conjure_rx) = mpsc::channel::<app::ConjureUpdate>();
        // Chat bus: the bg thread owns the real tube round-trip (tube_send up,
        // tube_poll down on the stable `console-chat` channel, both off the gpui
        // executor) and pushes replies/errors back here for the foreground to fold
        // into the chat transcript. Real daemon traffic, never a fake.
        let (chat_tx, chat_rx) = mpsc::channel::<chat::ChatUpdate>();
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
                    ],
                    grid::SLOT_PANE_IDS,
                    "producer slot order drifted from grid::SLOT_PANE_IDS",
                );

                // The Lane's live SSE stream. We (re)open it whenever the watched
                // agent changes; envelopes are drained every loop into the lane,
                // so the view updates at the 2s cadence with the freshest frames.
                // (A finer cadence is a follow-up; this proves the live pipeline.)
                let mut lane_stream: Option<(String, tokio::sync::mpsc::Receiver<agent::StreamEnvelope>)> = None;

                // Operator chat transport state: (channel, cursor). `None` until the
                // first turn binds a responder on the stable `console-chat` channel.
                // Each loop polls this channel for replies down the tube.
                let mut chat: Option<(String, u64)> = None;

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
                            // Kick off a new top-level agent on the live daemon.
                            app::ControlMsg::Spawn { backend, prompt, model } => {
                                match agent::Backend::parse(&backend) {
                                    None => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "spawn failed",
                                            format!("unknown backend '{backend}'"),
                                        ));
                                    }
                                    // Manual Spawn keeps its historical posture:
                                    // NO squid hooks (default opts). Only conjure
                                    // dispatch opts into PD coordination.
                                    Some(b) => match client.spawn(b, &prompt, "operator", model.as_deref(), agent::SpawnOpts::default()).await {
                                        Err(e) => {
                                            let _ = alert_tx.send(pane::Alert::error(
                                                format!("spawn rejected ({backend})"),
                                                e.to_string(),
                                            ));
                                        }
                                        // The daemon can return 2xx with an embedded refusal
                                        // (preflight block) — surface that too, never as success.
                                        Ok(outcome) => {
                                            if let Some(err) = outcome.error {
                                                let _ = alert_tx.send(pane::Alert::error(
                                                    format!("spawn blocked ({backend})"),
                                                    err,
                                                ));
                                            } else {
                                                let _ = alert_tx.send(pane::Alert::info(
                                                    format!("spawned {backend} agent {}", outcome.id),
                                                    outcome.status,
                                                ));
                                            }
                                        }
                                    },
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
                            // Operator chat — the REAL tube round-trip. The first turn
                            // binds a conversational responder by spawning a Claude Code
                            // agent ON the `console-chat` channel (guaranteed multi-turn
                            // tube replies); the operator's first message is the seed
                            // prompt. Subsequent turns `tube_send` up the channel; the
                            // poll below pulls replies down. Live launch is env-dependent
                            // (daemon up + claude CLI + a worktree via PD_CONSOLE_WORKDIR
                            // + budget). On a spawn refusal we DON'T lose the turn — we
                            // round-trip it onto the real /msg channel and start polling,
                            // and surface the refusal in the chat error state.
                            app::ControlMsg::ChatSend { text } => {
                                let channel = "console-chat".to_string();
                                match &mut chat {
                                    Some((ch, _cursor)) => {
                                        if let Err(e) = client.tube_send(ch, &text, "operator").await {
                                            let _ = chat_tx.send(chat::ChatUpdate::Error(
                                                format!("chat send failed: {e}"),
                                            ));
                                        }
                                    }
                                    None => {
                                        match client
                                            .spawn(
                                                agent::Backend::ClaudeCli,
                                                &text,
                                                &channel,
                                                None,
                                                agent::SpawnOpts::default(),
                                            )
                                            .await
                                        {
                                            Ok(outcome) => {
                                                chat = Some((channel.clone(), 0));
                                                // One-shot inline backends (ollama) reply
                                                // in the spawn response, not on the tube.
                                                if let Some(out) =
                                                    outcome.output.filter(|t| !t.trim().is_empty())
                                                {
                                                    let _ = chat_tx.send(chat::ChatUpdate::Reply(
                                                        chat::ChatMsg::agent("claude-cli", out),
                                                    ));
                                                }
                                                if let Some(err) = outcome.error {
                                                    let _ = chat_tx.send(chat::ChatUpdate::Error(
                                                        format!("chat responder blocked: {err}"),
                                                    ));
                                                }
                                            }
                                            Err(e) => {
                                                // No responder bound. Still try to round-trip
                                                // the turn onto the real channel so it isn't
                                                // lost — but surface WHICHEVER failure happened
                                                // (never swallow the send: "stop swallowing
                                                // errors").
                                                match client
                                                    .tube_send(&channel, &text, "operator")
                                                    .await
                                                {
                                                    Ok(_) => {
                                                        // Message is on the channel; poll for a
                                                        // responder that may join later.
                                                        chat = Some((channel, 0));
                                                        let _ = chat_tx.send(chat::ChatUpdate::Error(
                                                            format!("no responder bound (spawn refused): {e} — your message is on the channel; replies appear if one joins"),
                                                        ));
                                                    }
                                                    Err(send_err) => {
                                                        // Daemon fully unreachable: be honest the
                                                        // message did NOT land; leave chat unbound
                                                        // so the next turn retries the spawn.
                                                        let _ = chat_tx.send(chat::ChatUpdate::Error(
                                                            format!("message not delivered — spawn refused ({e}) and channel send failed ({send_err}); is the daemon up?"),
                                                        ));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Operator review-gate verdicts on a dispatch.
                            app::ControlMsg::DispatchAccept { id } => {
                                if let Err(e) = client.dispatch_action(&id, "accept", None).await {
                                    let _ = alert_tx.send(pane::Alert::error("dispatch accept failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::DispatchReject { id, reason } => {
                                if let Err(e) = client.dispatch_action(&id, "reject", Some(&reason)).await {
                                    let _ = alert_tx.send(pane::Alert::error("dispatch reject failed", e.to_string()));
                                }
                            }
                            app::ControlMsg::DispatchCancel { id } => {
                                if let Err(e) = client.dispatch_action(&id, "cancel", Some("operator cancelled")).await {
                                    let _ = alert_tx.send(pane::Alert::error("dispatch cancel failed", e.to_string()));
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
                            // Conjure LIVE GENERATION: ask the Max-seat `claude` CLI
                            // (print mode, NO API key) to bloom a real DAG tailored to
                            // the operator's prompt, falling back to the prompt-seeded
                            // fixture on any failure. Runs on a blocking worker (the
                            // CLI round-trip is multi-second). On success it pushes the
                            // DAG back to the view (which swaps to Conjure) AND kicks
                            // the inline Vello render so the graphic appears too.
                            app::ControlMsg::ConjureGenerate { prompt } => {
                                let alert_tx = alert_tx.clone();
                                let conjure_tx = conjure_tx.clone();
                                tokio::task::spawn_blocking(move || {
                                    let _ = alert_tx.send(pane::Alert::info(
                                        "conjure: generating with claude:cli",
                                        format!("asking the Max seat to plan: {}", prompt.trim()),
                                    ));
                                    // Never errors — returns the fixture on any CLI failure.
                                    let dag = match conjure::generate_dag_via_cli(&prompt) {
                                        Ok(d) => d,
                                        Err(e) => {
                                            // Defensive: generate_dag_via_cli is infallible
                                            // by contract, but surface anything unexpected
                                            // and still fall back to a renderable DAG.
                                            let _ = alert_tx.send(pane::Alert::error(
                                                "conjure generation error",
                                                e.to_string(),
                                            ));
                                            conjure::seeded_from_prompt(&prompt)
                                        }
                                    };
                                    let title = dag.title.clone();
                                    let waves = dag.waves.len();
                                    // Push the DAG to the view (swaps to Conjure surface).
                                    let _ = conjure_tx.send(app::ConjureUpdate::Dag(dag.clone()));
                                    let _ = alert_tx.send(pane::Alert::info(
                                        format!("conjured “{title}” via claude:cli"),
                                        format!("{waves} wave(s) — rendering the Vello graphic…"),
                                    ));
                                    // Auto-render the inline Vello PNG for the new DAG.
                                    match conjure::to_json(&dag) {
                                        Ok(json) => match render_conjure_png(&json) {
                                            Ok(png) => {
                                                let _ = conjure_tx.send(app::ConjureUpdate::Png(png));
                                            }
                                            Err(e) => {
                                                let _ = alert_tx.send(pane::Alert::error(
                                                    "conjure inline render failed",
                                                    e.to_string(),
                                                ));
                                            }
                                        },
                                        Err(e) => {
                                            let _ = alert_tx.send(pane::Alert::error(
                                                "conjure serialize failed",
                                                e.to_string(),
                                            ));
                                        }
                                    }
                                });
                            }
                            // Conjure → Vello: write the live DAG JSON where the proto
                            // reads it, build+run capture.sh (RELEASE + UNSANDBOXED —
                            // debug fontique panics on macOS 15 and the Metal readback
                            // is SIGKILLed under a sandbox), then `open` the PNG. The
                            // whole shell-out runs on a blocking worker so the 2s
                            // refresh cadence above never stalls on a release build.
                            app::ControlMsg::RenderConjureGraph { dag_json, title } => {
                                let alert_tx = alert_tx.clone();
                                let conjure_tx = conjure_tx.clone();
                                tokio::task::spawn_blocking(move || {
                                    match render_conjure_png(&dag_json) {
                                        Ok(png) => {
                                            // Slot the fresh PNG into the INLINE graphic too,
                                            // not just the external `open` — the operator sees
                                            // it update in-pane.
                                            let _ = conjure_tx.send(app::ConjureUpdate::Png(png.clone()));
                                            // Surface the PNG to the operator (best-effort `open`).
                                            let _ = std::process::Command::new("open").arg(&png).status();
                                            let _ = alert_tx.send(pane::Alert::info(
                                                format!("rendered “{title}”"),
                                                format!("Vello PNG written + opened: {}", png.display()),
                                            ));
                                        }
                                        Err(e) => {
                                            let _ = alert_tx.send(pane::Alert::error(
                                                "conjure render failed",
                                                e.to_string(),
                                            ));
                                        }
                                    }
                                });
                            }
                            // Conjure DISPATCH: spawn each committed (non-HITL-gated)
                            // node on the vendor its model_tier chose, through the
                            // SAME client.spawn the manual Spawn command uses (the
                            // daemon's existing multi-vendor spawner / lib/spawner.ts).
                            // Each outcome is surfaced as an Alert exactly like Spawn:
                            // Info with the agent id on launch, Error on a refusal
                            // (unknown/non-launchable backend, budget/worktree guard,
                            // or an embedded preflight block). Live launch is env-
                            // dependent (daemon up + vendor CLI installed); the Giant
                            // Squid Harness (ADR-0091, Proposed/not built) is the
                            // FUTURE in-loop vendor-hook coordination upgrade.
                            app::ControlMsg::ConjureDispatch { requests, gated } => {
                                let total = requests.len();
                                if gated > 0 {
                                    let _ = alert_tx.send(pane::Alert::info(
                                        format!("conjure dispatch: {total} node(s) → vendors"),
                                        format!("{gated} HITL-gated node(s) held back for explicit approval"),
                                    ));
                                }
                                for req in requests {
                                    let tier = req.model_tier;
                                    let node_id = req.node_id;
                                    let skill = req.skill_id;
                                    // The node's chosen vendor (already resolved from
                                    // model_tier via agent::backend_for_tier on the
                                    // foreground); re-parse the wire id to a Backend.
                                    match agent::Backend::parse(&req.backend) {
                                        None => {
                                            let _ = alert_tx.send(pane::Alert::error(
                                                format!("dispatch failed ({node_id})"),
                                                format!("unknown backend '{}' for tier '{tier}'", req.backend),
                                            ));
                                        }
                                        Some(b) => {
                                            // Seed the goal with the skill the node
                                            // predicted, so the spawned agent loads it.
                                            let goal = if skill.is_empty() {
                                                req.goal.clone()
                                            } else {
                                                format!("[skill: {skill}] {}", req.goal)
                                            };
                                            // EXISTING spawn path — same method, same
                                            // channel convention as ControlMsg::Spawn,
                                            // but with SpawnOpts::squid(): this makes
                                            // the conjure-dispatched vendor CLI run
                                            // UNDER PD coordination — the daemon injects
                                            // the Giant Squid Harness (ADR-0091)
                                            // pd-hook-* tentacles into the workspace's
                                            // .claude/settings.json, so lock-gating +
                                            // pheromones fire inside Claude Code's own
                                            // loop (Claude Max Prime). codex / gemini
                                            // remain validate-then-add (their squid
                                            // adapters throw → the flag is a no-op there).
                                            match client.spawn(b, &goal, "operator", None, agent::SpawnOpts::squid()).await {
                                                Err(e) => {
                                                    let _ = alert_tx.send(pane::Alert::error(
                                                        format!("dispatch rejected ({node_id} → {})", req.backend),
                                                        e.to_string(),
                                                    ));
                                                }
                                                Ok(outcome) => {
                                                    if let Some(err) = outcome.error {
                                                        let _ = alert_tx.send(pane::Alert::error(
                                                            format!("dispatch blocked ({node_id} → {})", req.backend),
                                                            err,
                                                        ));
                                                    } else {
                                                        let _ = alert_tx.send(pane::Alert::info(
                                                            format!(
                                                                "dispatched {node_id} → {} agent {}",
                                                                req.backend, outcome.id
                                                            ),
                                                            format!("tier {tier} · {}", outcome.status),
                                                        ));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Switch the whole console to another daemon berth: swap
                            // the client so every pane's next refresh hits the new
                            // daemon. The DaemonPane re-marks the active one because
                            // it reads `client.base()` on refresh.
                            app::ControlMsg::RebindDaemon { url } => {
                                client = DaemonClient::new(url);
                                lane_stream = None; // drop the old daemon's SSE stream
                                chat = None; // re-bind chat on the new daemon's channel
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
                            // Propose a dispatch into the review queue (POST /dispatches).
                            app::ControlMsg::ProposeDispatch { goal } => {
                                match client.propose_dispatch(&goal).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            "dispatch proposed",
                                            "Dispatch pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx.send(pane::Alert::error(
                                            "dispatch proposal failed",
                                            e.to_string(),
                                        ));
                                    }
                                }
                            }
                            // Launch a sortie mission (POST /sorties).
                            app::ControlMsg::LaunchSortie { goal } => {
                                match client.launch_sortie(&goal).await {
                                    Ok(()) => {
                                        let _ = alert_tx.send(pane::Alert::info(
                                            "sortie launching",
                                            "Sorties pane will refresh shortly",
                                        ));
                                    }
                                    Err(e) => {
                                        let _ = alert_tx
                                            .send(pane::Alert::error("sortie failed", e.to_string()));
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
                                            format!("interrupted {agent_id}"),
                                            "operator stop sent",
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

                    // Poll the operator-chat channel for replies down the tube. Only
                    // active once a turn has been sent (a responder bound); non-operator
                    // messages become chat replies, the operator's own echoes are dropped.
                    if let Some((ch, cursor)) = &mut chat {
                        match client.tube_poll(ch, *cursor).await {
                            Ok((new_cursor, msgs)) => {
                                *cursor = new_cursor;
                                for m in msgs.into_iter().filter(|m| m.sender != "operator") {
                                    let _ = chat_tx.send(chat::ChatUpdate::Reply(
                                        chat::ChatMsg::agent(m.sender, m.text),
                                    ));
                                }
                            }
                            Err(e) => {
                                let _ = chat_tx
                                    .send(chat::ChatUpdate::Error(format!("chat poll failed: {e}")));
                            }
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
                    // Drain the alert bus: every captured action failure/outcome
                    // lands in the view (flash + accumulated HITL log).
                    while let Ok(alert) = alert_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.push_alert(alert.clone());
                                cx.notify();
                            });
                        });
                    }
                    // Drain the Conjure bus: a live-generated DAG (swaps to the
                    // Conjure surface) or a rendered Vello PNG (the inline graphic).
                    while let Ok(update) = conjure_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.apply_conjure_update(update.clone());
                                cx.notify();
                            });
                        });
                    }
                    // Drain the chat bus: real replies down the tube (with the receive
                    // earcon) or a transport error, folded into the chat transcript.
                    while let Ok(update) = chat_rx.try_recv() {
                        let _ = async_cx.update(|app| {
                            let _ = window.update(app, |view: &mut ConsoleView, _, cx| {
                                view.apply_chat_update(update.clone());
                                cx.notify();
                            });
                        });
                    }
                }
            })
            .detach();
    });
}
