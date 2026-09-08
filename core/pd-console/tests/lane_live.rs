//! Live integration test for the cockpit's "watch in real time" pipeline.
//!
//! A real `DaemonClient::subscribe_agent` opens an HTTP SSE stream against a
//! tiny in-process mock that speaks the PR #404 contract (first `event:
//! connected`, then typed `{v,kind,agentId,body,ts}` envelopes). We assert the
//! parsed envelopes arrive on the channel in order, including the closed-loop
//! `agent.tube` control message — proving the byte-stream parser + envelope
//! decode + channel plumbing work end-to-end over a socket, not just in units.
//!
//! Uses only std for the server (no extra dev-deps); the crate's dev tokio
//! provides the runtime `subscribe_agent` spawns onto.

#[path = "../src/berths.rs"]
mod berths; // agent.rs's DaemonClient::discover() needs crate::berths::default_url()
#[path = "../src/agent.rs"]
mod agent;

use agent::{DaemonClient, StreamKind};
use std::io::{Read, Write};
use std::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

/// Spin a one-shot SSE server on an ephemeral port; return its base URL.
/// It serves exactly one `GET /agents/:id/stream` connection, writing the
/// handshake + a representative envelope sequence, then closes.
fn spawn_mock_stream() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            // Read (and discard) the request headers.
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf);

            let head = "HTTP/1.1 200 OK\r\n\
                        Content-Type: text/event-stream\r\n\
                        Cache-Control: no-cache\r\n\
                        Connection: close\r\n\r\n";
            let _ = sock.write_all(head.as_bytes());

            let frames = [
                "event: connected\ndata: {\"channel\":\"agent:a\"}\n\n",
                "event: message\ndata: {\"v\":1,\"kind\":\"agent.status\",\"agentId\":\"a\",\"body\":{\"status\":\"working\"},\"ts\":1}\n\n",
                "event: message\ndata: {\"v\":1,\"kind\":\"agent.transcript\",\"agentId\":\"a\",\"body\":{\"tool\":{\"name\":\"Bash\",\"status\":\"running\"}},\"ts\":2}\n\n",
                "event: message\ndata: {\"v\":1,\"kind\":\"agent.transcript\",\"agentId\":\"a\",\"body\":{\"text\":\"running cargo test\"},\"ts\":3}\n\n",
                // Split a frame across two writes to exercise chunk reassembly.
                "event: message\ndata: {\"v\":1,\"kind\":\"agent.tube\",\"agentId\":\"a\",",
                "\"body\":{\"text\":\"control.interrupt\"},\"ts\":5}\n\n",
            ];
            for f in frames {
                if sock.write_all(f.as_bytes()).is_err() {
                    break;
                }
                let _ = sock.flush();
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            // Drop the socket: the production client will reconnect, so tests
            // should assert the expected frames rather than stream termination.
        }
    });
    format!("http://127.0.0.1:{port}")
}

/// Serve a deliberately quiet SSE connection and report both acceptance and
/// client closure. This models a watched agent/channel that emits no messages:
/// dropping the UI receiver must still cancel the background task and socket.
fn spawn_quiet_stream() -> (String, oneshot::Receiver<()>, oneshot::Receiver<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind quiet stream");
    let port = listener.local_addr().unwrap().port();
    let (accepted_tx, accepted_rx) = oneshot::channel();
    let (closed_tx, closed_rx) = oneshot::channel();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf);
            let head = "HTTP/1.1 200 OK\r\n\
                        Content-Type: text/event-stream\r\n\
                        Cache-Control: no-cache\r\n\
                        Connection: keep-alive\r\n\r\n\
                        event: connected\ndata: {}\n\n";
            sock.write_all(head.as_bytes())
                .expect("write quiet SSE handshake");
            sock.flush().expect("flush quiet SSE handshake");
            let _ = accepted_tx.send(());

            sock.set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .expect("set quiet socket timeout");
            let mut probe = [0u8; 1];
            if matches!(sock.read(&mut probe), Ok(0)) {
                let _ = closed_tx.send(());
            }
        }
    });
    (format!("http://127.0.0.1:{port}"), accepted_rx, closed_rx)
}

#[tokio::test]
async fn subscribe_agent_streams_typed_envelopes_over_a_socket() {
    let base = spawn_mock_stream();
    let client = DaemonClient::new(base);

    let mut rx = client.subscribe_agent("a");

    let mut kinds = Vec::new();
    let mut saw_control = false;
    while kinds.len() < 4 {
        let env = timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("timed out waiting for stream envelope")
            .expect("stream channel closed before expected envelopes arrived");
        if env.kind == StreamKind::Tube {
            if env.body.get("text").and_then(|t| t.as_str()) == Some("control.interrupt") {
                saw_control = true;
            }
        }
        kinds.push(env.kind.as_str().to_string());
    }

    // The `connected` handshake yields no envelope; the four typed frames do.
    assert_eq!(
        kinds,
        vec![
            "agent.status",
            "agent.transcript",
            "agent.transcript",
            "agent.tube"
        ],
        "typed envelopes arrive in order off the live socket",
    );
    assert!(
        saw_control,
        "the closed-loop control.interrupt frame reached the channel"
    );
}

#[tokio::test]
async fn dropping_quiet_agent_receiver_closes_the_sse_socket() {
    let (base, accepted, closed) = spawn_quiet_stream();
    let client = DaemonClient::new(base);
    let rx = client.subscribe_agent("quiet");

    timeout(Duration::from_secs(2), accepted)
        .await
        .expect("quiet agent stream was never accepted")
        .expect("quiet agent server exited before acceptance");
    drop(rx);
    timeout(Duration::from_secs(2), closed)
        .await
        .expect("dropping quiet agent receiver leaked its SSE socket")
        .expect("quiet agent server exited without observing socket close");
}

#[tokio::test]
async fn dropping_quiet_channel_receiver_closes_the_sse_socket() {
    let (base, accepted, closed) = spawn_quiet_stream();
    let client = DaemonClient::new(base);
    let rx = client.subscribe_channel("quiet");

    timeout(Duration::from_secs(2), accepted)
        .await
        .expect("quiet channel stream was never accepted")
        .expect("quiet channel server exited before acceptance");
    drop(rx);
    timeout(Duration::from_secs(2), closed)
        .await
        .expect("dropping quiet channel receiver leaked its SSE socket")
        .expect("quiet channel server exited without observing socket close");
}
