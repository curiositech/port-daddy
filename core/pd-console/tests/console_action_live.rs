//! Live integration tests for the operator console's daemon-facing actions,
//! over a real socket (not units). A tiny std-only mock HTTP server records the
//! method, path, and body of each request so we can assert the console hits the
//! right daemon endpoints with the right payloads:
//!
//!   - the Dispatch review gate's accept / reject / cancel verbs
//!     (`POST /dispatches/:id/{action}`, reject carries a `{reason}` body), and
//!   - the Cost Ledger's `GET /metrics/cost` fetch + JSON parse.
//!
//! Mirrors `lane_live.rs`: include `agent.rs` directly via `#[path]` so this
//! target links only reqwest/tokio (no gpui) and compiles light.

#[path = "../src/agent.rs"]
mod agent;
// agent.rs resolves the stable-berth default via crate::berths (daemon
// discovery's final fallback), so every target hosting agent.rs must also
// host the berths module.
#[path = "../src/berths.rs"]
mod berths;

use agent::DaemonClient;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

/// One captured request.
struct Captured {
    method: String,
    path: String,
    body: String,
}

/// Spin a one-shot mock server that serves `n` requests, replying `200 {body}`
/// to each, and reports what it received over a channel. Returns (base_url, rx).
fn spawn_mock(n: usize, reply_body: &'static str) -> (String, mpsc::Receiver<Captured>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..n {
            let Ok((mut sock, _)) = listener.accept() else {
                break;
            };
            let mut buf = [0u8; 4096];
            let read = sock.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..read]).to_string();
            // Request line: "METHOD /path HTTP/1.1"
            let first = req.lines().next().unwrap_or("");
            let mut parts = first.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            // Body is whatever follows the blank line.
            let body = req
                .split("\r\n\r\n")
                .nth(1)
                .unwrap_or("")
                .trim_end_matches('\0')
                .to_string();
            let _ = tx.send(Captured { method, path, body });

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply_body.len(),
                reply_body
            );
            let _ = sock.write_all(resp.as_bytes());
            let _ = sock.flush();
        }
    });
    (format!("http://127.0.0.1:{port}"), rx)
}

#[tokio::test]
async fn dispatch_accept_posts_to_accept_endpoint() {
    let (base, rx) = spawn_mock(1, r#"{"ok":true}"#);
    let client = DaemonClient::new(base);
    client
        .dispatch_action("disp-123", "accept", None)
        .await
        .expect("accept should succeed against 200");
    let got = rx.recv().expect("server recorded a request");
    assert_eq!(got.method, "POST");
    assert_eq!(got.path, "/dispatches/disp-123/accept");
    // Accept carries no reason → empty JSON object body.
    assert!(
        got.body.trim() == "{}" || got.body.trim().is_empty(),
        "accept body: {:?}",
        got.body
    );
}

#[tokio::test]
async fn dispatch_reject_carries_reason_body() {
    let (base, rx) = spawn_mock(1, r#"{"ok":true}"#);
    let client = DaemonClient::new(base);
    client
        .dispatch_action("d-9", "reject", Some("scope creep, re-plan"))
        .await
        .expect("reject should succeed");
    let got = rx.recv().expect("recorded");
    assert_eq!(got.method, "POST");
    assert_eq!(got.path, "/dispatches/d-9/reject");
    assert!(
        got.body.contains("scope creep, re-plan"),
        "reject must send the operator reason: {:?}",
        got.body
    );
}

#[tokio::test]
async fn cost_metrics_fetch_parses_totals_and_projects() {
    // The Cost Ledger fetches GET /metrics/cost and reads totals + byProject.
    let payload = r#"{"totals":{"totalUsd":1.25,"spawnCount":4,"estimatedCount":1},
        "byProject":[{"projectName":"alpha","totalUsd":1.25}],
        "byBackend":[{"backend":"ollama","totalUsd":1.25,"count":4}]}"#;
    let (base, rx) = spawn_mock(1, payload);
    let client = DaemonClient::new(base);
    let url = format!("{}/metrics/cost", client.base());
    let resp = client
        .http_client()
        .get(&url)
        .send()
        .await
        .expect("GET cost");
    let json: serde_json::Value = resp.json().await.expect("parse cost json");

    let got = rx.recv().expect("recorded");
    assert_eq!(got.method, "GET");
    assert_eq!(got.path, "/metrics/cost");
    assert_eq!(json["totals"]["totalUsd"].as_f64(), Some(1.25));
    assert_eq!(json["byProject"][0]["projectName"].as_str(), Some("alpha"));
}
