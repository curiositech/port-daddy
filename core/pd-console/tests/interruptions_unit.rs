//! HITL interruptions contract tests — the DAG-node gate for `hitl-pd-console`
//! (docs/hitl-interruptions.md §4, surface 2).
//!
//! Runs in a gpui-free integration target (same pattern as `dispatch_unit.rs`):
//! the poll state machine and view model are pure by construction, so the
//! whole contract — jitter bounds, the 4xx park, the 3-failure circuit
//! breaker, honest empty/unknown states — proves out here on the cheap gate,
//! plus a REAL mock HTTP server driving the pane's transport path and PNG
//! renders of the three contract states via the offscreen Block raster.

#[path = "../src/agent.rs"]
mod agent;
// agent.rs resolves the stable-berth default via crate::berths (daemon
// discovery's final fallback), so every target hosting agent.rs must also
// host the berths module.
#[allow(dead_code)]
#[path = "../src/berths.rs"]
mod berths;
#[allow(dead_code)]
#[path = "../src/headless_capture.rs"]
mod headless_capture;
#[path = "../src/interruptions.rs"]
mod interruptions;
#[allow(dead_code)]
#[path = "../src/interruptions_pane.rs"]
mod interruptions_pane;
#[path = "../src/pane.rs"]
mod pane;
#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/util.rs"]
mod util;

use interruptions::{
    deep_link_for, full_jitter_ms, parse_open_interruptions, view_blocks, HitlHealth, HitlSnapshot,
    Interruption, PollFailure, PollMachine, PollPhase, Urgency, BREAKER_BASE_MS, BREAKER_CAP_MS,
    BREAKER_THRESHOLD, POLL_MAX_MS,
};
use pane::{Block, Tone};

/// Flatten the text of every block shape the pane emits, for containment
/// assertions that don't care which block carried the words.
fn blocks_text(blocks: &[Block]) -> String {
    let mut out = String::new();
    for b in blocks {
        match b {
            Block::Header(s) => out.push_str(s),
            Block::KeyVal(k, v) => {
                out.push_str(k);
                out.push(' ');
                out.push_str(v);
            }
            Block::Chip { label, .. } => out.push_str(label),
            Block::Flag { label, .. } => out.push_str(label),
            Block::WrappedText { text, .. } => out.push_str(text),
            _ => {}
        }
        out.push('\n');
    }
    out
}

fn ask(id: &str, title: &str, urgency: Urgency, created_at_ms: i64) -> Interruption {
    Interruption {
        id: id.into(),
        title: title.into(),
        urgency,
        source_agent: format!("agent-{id}"),
        created_at_ms: Some(created_at_ms),
    }
}

// ── Jitter bounds ────────────────────────────────────────────────────────────

#[test]
fn jitter_never_exceeds_the_30s_contract_cap() {
    // Full jitter: every sample in [0,1] must land the delay in [0, 30s].
    for i in 0..=1000 {
        let sample = i as f64 / 1000.0;
        let d = full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, sample);
        assert!((0..=POLL_MAX_MS).contains(&d), "sample {sample} gave {d}ms");
    }
}

#[test]
fn jitter_spans_the_full_range_not_a_fixed_offset() {
    assert_eq!(full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, 0.0), 0);
    assert_eq!(
        full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, 1.0),
        POLL_MAX_MS
    );
    assert_eq!(
        full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, 0.5),
        POLL_MAX_MS / 2
    );
}

#[test]
fn jitter_clamps_hostile_samples() {
    assert_eq!(full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, -3.0), 0);
    assert_eq!(
        full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, 7.0),
        POLL_MAX_MS
    );
    assert_eq!(
        full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, f64::NAN),
        POLL_MAX_MS
    );
}

#[test]
fn jitter_backoff_doubles_then_caps() {
    // sample=1.0 exposes the ceiling: 30s, 60s, 120s, 240s, then capped 300s.
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 0, 1.0),
        30_000
    );
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 1, 1.0),
        60_000
    );
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 2, 1.0),
        120_000
    );
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 3, 1.0),
        240_000
    );
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 4, 1.0),
        300_000
    );
    assert_eq!(
        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, 60, 1.0),
        300_000
    );
}

#[test]
fn success_schedules_the_next_poll_inside_the_cap() {
    let mut m = PollMachine::new();
    assert!(m.due(0), "a fresh machine polls immediately");
    m.on_success(1_000, 1.0);
    assert!(
        !m.due(1_000),
        "not due immediately after a max-jitter success"
    );
    assert!(!m.due(1_000 + POLL_MAX_MS - 1));
    assert!(
        m.due(1_000 + POLL_MAX_MS),
        "due at the 30s cap at the latest"
    );
    m.on_success(60_000, 0.0);
    assert!(m.due(60_000), "a zero sample means poll again immediately");
}

// ── 4xx park ─────────────────────────────────────────────────────────────────

#[test]
fn status_classification_parks_4xx_but_not_429() {
    assert_eq!(
        PollFailure::from_status(401),
        PollFailure::Rejected { status: 401 }
    );
    assert_eq!(
        PollFailure::from_status(403),
        PollFailure::Rejected { status: 403 }
    );
    assert_eq!(
        PollFailure::from_status(404),
        PollFailure::Rejected { status: 404 }
    );
    assert!(matches!(
        PollFailure::from_status(429),
        PollFailure::Transient { .. }
    ));
    assert!(matches!(
        PollFailure::from_status(500),
        PollFailure::Transient { .. }
    ));
    assert!(matches!(
        PollFailure::from_status(503),
        PollFailure::Transient { .. }
    ));
}

#[test]
fn a_4xx_parks_polling_until_the_token_changes() {
    let mut m = PollMachine::new();
    m.note_token("pdu_old");
    m.on_failure(1_000, &PollFailure::Rejected { status: 401 }, 0.5);
    assert_eq!(*m.phase(), PollPhase::Parked { status: 401 });
    // Parked is parked — no amount of waiting un-parks it.
    for t in [1_001i64, 60_000, 3_600_000, 86_400_000] {
        assert!(!m.due(t), "parked machine polled at t={t}");
    }
    // Re-observing the SAME token stays parked.
    m.note_token("pdu_old");
    assert!(!m.due(86_400_000), "same token must not un-park");
    // A rotated token un-parks and polls immediately.
    m.note_token("pdu_new");
    assert_eq!(*m.phase(), PollPhase::Ready);
    assert!(m.due(86_400_000), "new token polls immediately");
}

// ── Circuit breaker ──────────────────────────────────────────────────────────

#[test]
fn breaker_opens_after_three_consecutive_transient_failures() {
    let fail = PollFailure::Transient {
        reason: "HTTP 503".into(),
    };
    let mut m = PollMachine::new();
    m.on_failure(0, &fail, 0.5);
    assert_eq!(*m.phase(), PollPhase::Ready, "1 failure keeps polling");
    m.on_failure(20_000, &fail, 0.5);
    assert_eq!(*m.phase(), PollPhase::Ready, "2 failures keep polling");
    m.on_failure(40_000, &fail, 1.0);
    match m.phase() {
        PollPhase::Open { until_ms } => {
            assert_eq!(
                *until_ms,
                40_000 + BREAKER_BASE_MS,
                "first open = base cooldown"
            );
        }
        other => panic!("3rd failure must open the breaker, got {other:?}"),
    }
    assert!(!m.due(40_001), "no polls while the breaker is open");
    assert!(m.due(40_000 + BREAKER_BASE_MS), "half-open probe at expiry");
}

#[test]
fn half_open_probe_failure_reopens_with_a_longer_cooldown() {
    let fail = PollFailure::Transient {
        reason: "connect refused".into(),
    };
    let mut m = PollMachine::new();
    for t in [0i64, 1, 2] {
        m.on_failure(t, &fail, 1.0);
    }
    assert!(matches!(m.phase(), PollPhase::Open { .. }));
    // The single half-open probe fails → re-open, with the DOUBLED ceiling.
    m.on_failure(100_000, &fail, 1.0);
    match m.phase() {
        PollPhase::Open { until_ms } => {
            assert_eq!(
                *until_ms,
                100_000 + 2 * BREAKER_BASE_MS,
                "second open doubles"
            );
        }
        other => panic!("probe failure must re-open, got {other:?}"),
    }
}

#[test]
fn a_success_closes_the_breaker_and_resets_the_count() {
    let fail = PollFailure::Transient {
        reason: "HTTP 502".into(),
    };
    let mut m = PollMachine::new();
    for t in [0i64, 1, 2] {
        m.on_failure(t, &fail, 1.0);
    }
    m.on_success(200_000, 0.0);
    assert_eq!(*m.phase(), PollPhase::Ready);
    assert_eq!(m.consecutive_failures(), 0);
    // It takes a full THREE new failures to open again (count truly reset)…
    m.on_failure(200_001, &fail, 0.5);
    m.on_failure(200_002, &fail, 0.5);
    assert_eq!(*m.phase(), PollPhase::Ready);
    m.on_failure(200_003, &fail, 1.0);
    // …and the cooldown is back at the BASE ceiling (opens counter reset too).
    match m.phase() {
        PollPhase::Open { until_ms } => assert_eq!(*until_ms, 200_003 + BREAKER_BASE_MS),
        other => panic!("expected reopened breaker, got {other:?}"),
    }
}

#[test]
fn breaker_cooldown_never_exceeds_the_5_minute_cap() {
    let fail = PollFailure::Transient {
        reason: "down".into(),
    };
    let mut m = PollMachine::new();
    let mut now = 0i64;
    // Open the breaker 8 times in a row (probe fails every time).
    let mut last_cooldown = 0i64;
    for _ in 0..8 {
        loop {
            m.on_failure(now, &fail, 1.0);
            if let PollPhase::Open { until_ms } = m.phase() {
                last_cooldown = *until_ms - now;
                now = *until_ms;
                break;
            }
        }
        assert!(
            last_cooldown <= BREAKER_CAP_MS,
            "cooldown {last_cooldown}ms exceeded the cap"
        );
    }
    assert_eq!(
        last_cooldown, BREAKER_CAP_MS,
        "repeated opens saturate at the cap"
    );
}

// ── Decode + view model ──────────────────────────────────────────────────────

#[test]
fn tolerant_decode_of_the_relay_poll_body() {
    let body: serde_json::Value = serde_json::from_str(
        r#"{
          "code": "OK", "error": null, "openCount": 2,
          "interruptions": [
            {"id": "a1", "title": "Grant repo scope", "urgency": "normal",
             "sourceAgent": "shipwright", "state": "open", "createdAt": 1754700000},
            {"id": "a2", "title": "Prod deploy?", "urgency": "critical",
             "sourceAgent": "bosun", "state": "open", "createdAt": 1754700100,
             "someFutureColumn": {"nested": true}},
            {"id": "a3", "title": "already answered", "urgency": "critical",
             "state": "answered", "createdAt": 1754700200},
            {"title": "row without an id is skipped, not fatal"}
          ]
        }"#,
    )
    .unwrap();
    let open = parse_open_interruptions(&body);
    assert_eq!(open.len(), 2, "answered + id-less rows are filtered");
    // Most urgent first.
    assert_eq!(open[0].id, "a2");
    assert_eq!(open[0].urgency, Urgency::Critical);
    assert_eq!(open[0].source_agent, "bosun");
    // Unix SECONDS normalized to millis.
    assert_eq!(open[0].created_at_ms, Some(1_754_700_100_000));
    assert_eq!(open[1].id, "a1");
}

#[test]
fn urgency_parse_is_tolerant_and_tones_are_loud_where_mandated() {
    assert_eq!(Urgency::parse("CRITICAL"), Urgency::Critical);
    assert_eq!(Urgency::parse("weird"), Urgency::Normal);
    // Contract §4.2: critical/high are visually LOUD (alarm red).
    assert_eq!(Urgency::Critical.tone(), Tone::Alarm);
    assert_eq!(Urgency::High.tone(), Tone::Alarm);
    assert_ne!(Urgency::Normal.tone(), Tone::Alarm);
    assert_ne!(Urgency::Low.tone(), Tone::Alarm);
}

#[test]
fn age_labels_are_display_ready() {
    let a = ask("x", "t", Urgency::Normal, 1_000_000);
    assert_eq!(a.age_label(1_000_000 + 5_000), "5s");
    assert_eq!(a.age_label(1_000_000 + 300_000), "5m");
    assert_eq!(a.age_label(1_000_000 + 7_200_000), "2h");
    assert_eq!(a.age_label(1_000_000 + 172_800_000), "2d");
    assert_eq!(a.age_label(999_999_999_999).len() > 0, true);
    let unknown = Interruption {
        created_at_ms: None,
        ..a.clone()
    };
    assert_eq!(unknown.age_label(2_000_000), "?");
}

#[test]
fn deep_link_builds_from_the_relay_base() {
    assert_eq!(
        deep_link_for("https://relay.example.dev/").as_deref(),
        Some("https://relay.example.dev/account/interruptions")
    );
    assert_eq!(deep_link_for("   "), None);
}

// ── The three contract render states ─────────────────────────────────────────

fn empty_snapshot() -> HitlSnapshot {
    HitlSnapshot {
        health: HitlHealth::Live,
        open: vec![],
    }
}

fn open_normal_snapshot(now: i64) -> HitlSnapshot {
    HitlSnapshot {
        health: HitlHealth::Live,
        open: vec![
            ask(
                "n1",
                "Need a repo scope grant",
                Urgency::Normal,
                now - 120_000,
            ),
            ask(
                "n2",
                "Review flaky test quarantine",
                Urgency::Low,
                now - 3_600_000,
            ),
        ],
    }
}

fn open_critical_snapshot(now: i64) -> HitlSnapshot {
    HitlSnapshot {
        health: HitlHealth::Live,
        open: vec![
            ask(
                "c1",
                "Prod deploy needs a human decision",
                Urgency::Critical,
                now - 300_000,
            ),
            ask(
                "n1",
                "Need a repo scope grant",
                Urgency::Normal,
                now - 120_000,
            ),
        ],
    }
}

const LINK: &str = "https://relay.example.dev/account/interruptions";

#[test]
fn empty_state_is_honest_never_hidden() {
    let blocks = view_blocks(&empty_snapshot(), Some(LINK), 1_754_700_000_000);
    let text = blocks_text(&blocks);
    assert!(
        text.contains("no open interruptions"),
        "honest empty text: {text}"
    );
    assert!(
        !text.contains("unknown"),
        "a live empty poll is not unknown"
    );
    assert!(
        blocks.iter().any(|b| matches!(
            b,
            Block::Chip { label, tone: Tone::Resting } if label == "clear"
        )),
        "resting clear chip"
    );
}

#[test]
fn open_normal_state_lists_title_urgency_source_age() {
    let now = 1_754_700_000_000i64;
    let blocks = view_blocks(&open_normal_snapshot(now), Some(LINK), now);
    let text = blocks_text(&blocks);
    for needle in [
        "Need a repo scope grant",
        "normal",
        "agent-n1",
        "2m",
        "Review flaky test quarantine",
        "low",
        "1h",
    ] {
        assert!(text.contains(needle), "missing {needle:?} in: {text}");
    }
    assert!(text.contains(LINK), "deep link to the web answer surface");
    assert!(
        !blocks.iter().any(|b| matches!(
            b,
            Block::WrappedText {
                tone: Tone::Alarm,
                ..
            }
        )),
        "no dispatch-block banner without a critical ask"
    );
}

#[test]
fn open_critical_state_is_loud_and_blocks_dispatch() {
    let now = 1_754_700_000_000i64;
    let snap = open_critical_snapshot(now);
    let blocks = view_blocks(&snap, Some(LINK), now);
    let text = blocks_text(&blocks);
    assert!(
        blocks.iter().any(|b| matches!(
            b,
            Block::Flag {
                tone: Tone::Alarm,
                ..
            }
        )),
        "critical row flies an ALARM flag"
    );
    assert!(text.contains("DISPATCH BLOCKED"), "explicit refusal text");
    assert!(
        text.contains("Prod deploy needs a human decision"),
        "the refusal names the blocking ask"
    );
    // The gate the shell consumes carries the same truth.
    let gate = snap.gate(Some(LINK.into()));
    assert_eq!(gate.open_count, 2);
    assert_eq!(
        gate.critical_title.as_deref(),
        Some("Prod deploy needs a human decision")
    );
    assert!(gate.known);
}

#[test]
fn failed_poll_renders_unknown_never_all_clear() {
    let snap = HitlSnapshot {
        health: HitlHealth::Unknown {
            reason: "relay unreachable: connect refused".into(),
        },
        open: vec![],
    };
    let text = blocks_text(&view_blocks(&snap, Some(LINK), 0));
    assert!(text.contains("unknown"), "must say unknown: {text}");
    assert!(text.contains("connect refused"), "carries the REAL reason");
    assert!(
        !text.contains("no open interruptions"),
        "never fakes all-clear"
    );
    assert!(!text.contains("clear\n"), "no clear chip on a failed poll");
}

#[test]
fn unconfigured_is_unknown_not_all_clear() {
    let text = blocks_text(&view_blocks(&HitlSnapshot::default(), None, 0));
    assert!(text.contains("unknown"));
    assert!(
        text.contains("PD_CONSOLE_RELAY_URL"),
        "actionable config hint"
    );
    assert!(!text.contains("no open interruptions"));
}

#[test]
fn stale_critical_still_blocks_after_a_failed_poll() {
    let now = 1_754_700_000_000i64;
    let mut snap = open_critical_snapshot(now);
    snap.health = HitlHealth::Unknown {
        reason: "HTTP 503".into(),
    };
    let text = blocks_text(&view_blocks(&snap, Some(LINK), now));
    assert!(text.contains("last known open asks (stale)"));
    assert!(
        text.contains("DISPATCH BLOCKED"),
        "fail closed, not permissive"
    );
    let gate = snap.gate(Some(LINK.into()));
    assert!(gate.critical_title.is_some(), "stale critical still gates");
    assert!(!gate.known, "and the gate is honest about staleness");
}

// ── Mock relay server — the pane's real transport path ───────────────────────

/// Serve `responses` (status line + JSON body) one per connection on an
/// ephemeral port; each accepted request's raw head is sent back on the
/// channel so tests can assert on path + Authorization.
fn mock_relay(
    responses: Vec<(&'static str, String)>,
) -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for (status, body) in responses {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    });
    (format!("http://{addr}"), rx)
}

fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio rt")
        .block_on(fut)
}

#[test]
fn poll_against_a_mock_relay_parses_and_authenticates() {
    let body = r#"{"code":"OK","error":null,"openCount":1,
        "interruptions":[{"id":"m1","title":"Mock ask","urgency":"critical",
        "sourceAgent":"mock-agent","state":"open","createdAt":1754700000}]}"#;
    let (url, rx) = mock_relay(vec![("200 OK", body.to_string())]);
    let daemon = agent::DaemonClient::new("http://127.0.0.1:1".into());
    let mut pane = interruptions_pane::InterruptionsPane::with_relay(&url, "pdu_test_token");
    block_on(pane.poll_now(&daemon));

    let request = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("request");
    assert!(
        request.starts_with("GET /v1/interruptions?state=open"),
        "wrong poll path: {request}"
    );
    assert!(
        request.contains("authorization: Bearer pdu_test_token")
            || request.contains("Authorization: Bearer pdu_test_token"),
        "bearer token missing: {request}"
    );

    assert_eq!(pane.snapshot().health, HitlHealth::Live);
    assert_eq!(pane.snapshot().open.len(), 1);
    assert_eq!(pane.snapshot().open[0].title, "Mock ask");
    let gate = pane.gate();
    assert_eq!(gate.critical_title.as_deref(), Some("Mock ask"));
    assert!(gate.known);
    assert_eq!(
        gate.deep_link.as_deref(),
        Some(format!("{url}/account/interruptions")).as_deref()
    );
}

#[test]
fn a_401_from_the_relay_parks_the_pane() {
    let (url, _rx) = mock_relay(vec![(
        "401 Unauthorized",
        r#"{"code":"UNAUTHENTICATED","error":"bad token"}"#.to_string(),
    )]);
    let daemon = agent::DaemonClient::new("http://127.0.0.1:1".into());
    let mut pane = interruptions_pane::InterruptionsPane::with_relay(&url, "pdu_expired");
    block_on(pane.poll_now(&daemon));

    assert_eq!(*pane.machine().phase(), PollPhase::Parked { status: 401 });
    match &pane.snapshot().health {
        HitlHealth::Unknown { reason } => {
            assert!(reason.contains("401"), "reason names the status: {reason}")
        }
        other => panic!("a rejected poll is UNKNOWN, got {other:?}"),
    }
}

#[test]
fn an_unreachable_relay_is_transient_and_unknown() {
    // Nothing listens on this port (bind then drop to reserve-and-release).
    let dead = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", l.local_addr().unwrap())
    };
    let daemon = agent::DaemonClient::new("http://127.0.0.1:1".into());
    let mut pane = interruptions_pane::InterruptionsPane::with_relay(&dead, "pdu_x");
    block_on(pane.poll_now(&daemon));
    assert!(
        matches!(pane.machine().phase(), PollPhase::Ready),
        "one miss keeps polling"
    );
    assert_eq!(pane.machine().consecutive_failures(), 1);
    assert!(matches!(pane.snapshot().health, HitlHealth::Unknown { .. }));

    // Two more misses open the breaker — the transport path drives the same
    // machine the pure tests proved.
    block_on(pane.poll_now(&daemon));
    block_on(pane.poll_now(&daemon));
    assert!(
        matches!(pane.machine().phase(), PollPhase::Open { .. }),
        "3 consecutive transport failures open the breaker"
    );
}

// ── PNG proofs of the three states (offscreen Block raster) ─────────────────
//
// gpui 0.2.2 exposes no offscreen Metal readback (see headless_capture.rs for
// the full provenance), so these render the SAME Blocks the GPUI face paints
// through the crate's offscreen raster. Written to ../target (git-ignored);
// the committed copies live in docs/artifacts/hitl-interruptions/.

fn write_state_png(name: &str, snap: &HitlSnapshot, now: i64) -> Vec<u8> {
    let blocks = view_blocks(snap, Some(LINK), now);
    let canvas = headless_capture::render_blocks(&blocks, &theme::DARK, 900);
    let png = canvas.to_png();
    assert!(
        png.len() > 2_000,
        "{name}: suspiciously small PNG ({} bytes)",
        png.len()
    );
    assert_eq!(
        &png[0..8],
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
    );
    let out =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../target/hitl-{name}.png"));
    std::fs::write(&out, &png).expect("write png");
    png
}

#[test]
fn renders_the_three_contract_states_to_real_pngs() {
    let now = 1_754_700_000_000i64;
    let empty = write_state_png("state-empty", &empty_snapshot(), now);
    let normal = write_state_png("state-open-normal", &open_normal_snapshot(now), now);
    let critical = write_state_png("state-open-critical", &open_critical_snapshot(now), now);
    // Three DIFFERENT states must not rasterize identically.
    assert_ne!(empty, normal);
    assert_ne!(normal, critical);
    assert_ne!(empty, critical);
}

#[test]
fn critical_state_paints_real_alarm_pixels() {
    // The ALARM tone must actually reach the raster — scan for the theme's
    // alarm color among painted pixels (flag square + blocked banner).
    let now = 1_754_700_000_000i64;
    let blocks = view_blocks(&open_critical_snapshot(now), Some(LINK), now);
    let canvas = headless_capture::render_blocks(&blocks, &theme::DARK, 900);
    let alarm = theme::DARK.alarm.to_srgb8();
    let alarm_rgb = (
        ((alarm >> 16) & 0xff) as u8,
        ((alarm >> 8) & 0xff) as u8,
        (alarm & 0xff) as u8,
    );
    let mut hits = 0usize;
    for y in (0..canvas.h).step_by(2) {
        for x in (0..canvas.w).step_by(2) {
            if canvas.pixel(x, y) == alarm_rgb {
                hits += 1;
            }
        }
    }
    assert!(hits > 20, "expected loud alarm pixels, found {hits}");
}
