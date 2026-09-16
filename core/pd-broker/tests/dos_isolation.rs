//! IPC denial-of-service hardening tests, driving the ACTUAL built `pd-broker`
//! binary over a real Unix domain socket (red-team must-fix coverage).
//!
//! These prove the two high-severity findings are closed end-to-end, not just at
//! the framing-unit level:
//!   * a client that streams a >256KiB line with NO newline is answered with at
//!     most one `bad-request`, then disconnected without unbounded buffering;
//!   * a client holding a half-open / oversized-write connection cannot starve a
//!     SECOND concurrent client — Ping still gets Pong within a short deadline.
//!     This proves one stalled peer cannot pin the acceptor. The fixed
//!     connection cap, one-request lifetime, and read timeout bound each peer;
//!     they do not claim confinement against a coordinated same-UID flood.
//!
//! The binary is located via Cargo's `CARGO_BIN_EXE_pd-broker` env var (set for
//! integration tests of a crate that ships a binary). We give it a unique socket
//! path under a tempdir, a dummy secret, and `PD_BROKER_DEV=1` so the debug-build
//! dev keys are accepted.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// The cap enforced by `pd_broker::transport::MAX_REQUEST_BYTES` (256 KiB). Kept
/// in sync by reference, not re-derived, so a change to the cap is caught here.
const MAX_REQUEST_BYTES: usize = pd_broker::transport::MAX_REQUEST_BYTES as usize;

/// Spawn the real broker binary listening on `socket_path`. Returns the child so
/// the caller can kill it; a `BrokerProc` Drop also reaps it.
struct BrokerProc {
    child: Child,
}

impl Drop for BrokerProc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_broker(socket_path: &Path) -> BrokerProc {
    std::fs::set_permissions(
        socket_path.parent().unwrap(),
        std::fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    let bin = env!("CARGO_BIN_EXE_pd-broker");
    let child = Command::new(bin)
        .env("PD_BROKER_SOCKET", socket_path)
        .env("PD_BROKER_SECRET", "ghp_dummy_secret_for_dos_test_only")
        .env("PD_BROKER_DEV", "1") // debug build → dev macaroon/capability keys accepted
        .env("PD_BROKER_STATE_DB", socket_path.with_extension("sqlite3"))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn pd-broker binary");
    BrokerProc { child }
}

/// Block until the broker is accepting connections (it answers Ping with Pong),
/// or panic after `deadline`.
fn wait_until_ready(socket_path: &Path, deadline: Duration) {
    let start = Instant::now();
    loop {
        if start.elapsed() > deadline {
            panic!("broker never became ready within {deadline:?}");
        }
        if let Ok(mut conn) = UnixStream::connect(socket_path) {
            conn.set_read_timeout(Some(Duration::from_millis(500))).ok();
            if conn.write_all(b"{\"type\":\"ping\"}\n").is_ok() {
                let mut reader = BufReader::new(conn);
                let mut line = String::new();
                if reader.read_line(&mut line).is_ok() && line.contains("pong") {
                    return;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Send one Ping and return whether a Pong came back within `deadline`.
fn ping_within(socket_path: &Path, deadline: Duration) -> bool {
    let start = Instant::now();
    let mut conn = match UnixStream::connect(socket_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    conn.set_read_timeout(Some(deadline)).ok();
    if conn.write_all(b"{\"type\":\"ping\"}\n").is_err() {
        return false;
    }
    let mut reader = BufReader::new(conn);
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(_) => line.contains("pong") && start.elapsed() <= deadline,
        Err(_) => false,
    }
}

#[test]
fn oversized_unterminated_line_gets_bad_request_not_unbounded_buffer() {
    let dir = tempfile::tempdir().expect("tempdir");
    let socket = dir.path().join("broker.sock");
    let _broker = spawn_broker(&socket);
    wait_until_ready(&socket, Duration::from_secs(5));

    // Stream just over the cap with NO newline. The broker must answer with a
    // bad-request (the cap was hit without a terminator) rather than buffering.
    let mut conn = UnixStream::connect(&socket).expect("connect");
    conn.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let chunk = vec![b'a'; 64 * 1024];
    let total = MAX_REQUEST_BYTES + 64 * 1024;
    let mut written = 0;
    while written < total {
        // Best-effort: once the broker hits the cap it replies and closes, so
        // later writes may fail with EPIPE — expected fail-closed behavior.
        if conn.write_all(&chunk).is_err() {
            break;
        }
        written += chunk.len();
    }
    let _ = conn.flush();

    let mut reader = BufReader::new(conn);
    let mut line = String::new();
    reader.read_line(&mut line).expect("read bad-request reply");
    assert!(
        line.contains("bad-request"),
        "oversized unterminated line should yield bad-request, got: {line}"
    );
    // The raw dummy secret must never appear in the reply.
    assert!(!line.contains("ghp_"), "credential prefix leaked: {line}");
}

#[test]
fn stalled_client_cannot_dos_a_second_concurrent_client() {
    let dir = tempfile::tempdir().expect("tempdir");
    let socket = dir.path().join("broker.sock");
    let _broker = spawn_broker(&socket);
    wait_until_ready(&socket, Duration::from_secs(5));

    // Client 1: open a connection and write a large chunk with NO newline, then
    // retain the client handle. The broker must close its side after one bounded
    // refusal; if serving ran on the single accept thread, the write/read path
    // could still wedge the acceptor and the second client below would hang.
    let mut stalled = UnixStream::connect(&socket).expect("connect stalled client");
    // 512 KiB, no newline — exceeds the cap, never terminates a request.
    let big = vec![b'x'; 512 * 1024];
    let _ = stalled.write_all(&big); // may partially write before the cap reply
    let _ = stalled.flush();
    // Deliberately do NOT read the refusal. Keeping the local handle alive must
    // not keep the broker-side handler or connection slot alive.

    // Client 2: a fresh connection must still get Pong promptly. A 3s deadline is
    // generous; if the acceptor were pinned this would time out.
    let ok = ping_within(&socket, Duration::from_secs(3));
    assert!(
        ok,
        "second client did not get Pong within 3s — a stalled client starved the broker"
    );

    // Keep `stalled` alive until here so it really is concurrent.
    drop(stalled);
}

/// Suppress unused-import lint if a refactor drops a use; keeps the file honest.
#[allow(dead_code)]
fn _force_use(_r: &mut dyn Read) {}
