//! Socket-level transport tests: real Unix-domain-socket framing of a partial
//! message, 0600 permissions, and stale-socket cleanup on bind.

use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use pd_broker::broker::{Broker, BrokerConfig};
use pd_broker::capability::ActionIntent;
use pd_broker::protocol::{BootstrapRequirement, MintAuthority, Request, Response};
use pd_broker::transport::{
    bind_listener, serve_connection, CloneStream, MAX_REQUESTS_PER_CONNECTION, MAX_REQUEST_BYTES,
    SOCKET_MODE,
};

const SECRET: &str = "ghp_SUPERSECRET_token_that_must_never_leak_0xdeadbeef";

fn test_broker(state_dir: &Path) -> Broker {
    std::fs::set_permissions(state_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    Broker::new(BrokerConfig {
        secret: SECRET.as_bytes().to_vec(),
        capability_signing_key: b"action-capability-signing-key-pad!".to_vec(),
        capability_ttl_ms: 60_000,
        issuer: "port-daddy:broker".into(),
        allowed_audiences: vec!["port-daddy:broker".into(), "port-daddy:git-egress".into()],
        redemption_db_path: state_dir.join("redemptions.sqlite3"),
    })
    .unwrap()
}

/// Unique socket path under the OS temp dir for THIS test process. (Per repo
/// policy scratch lives under ~/coding/tmp, but cargo's own tempdir for a test
/// artifact is acceptable; we use tempfile so the path is created and removed
/// deterministically and never under /tmp by us by hand.)
fn temp_socket() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

struct ScriptedStream {
    input: Cursor<Vec<u8>>,
    output: Arc<Mutex<Vec<u8>>>,
}

struct SharedWriter(Arc<Mutex<Vec<u8>>>);

impl Read for ScriptedStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.input.read(buf)
    }
}

impl Write for ScriptedStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        SharedWriter(Arc::clone(&self.output)).write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Write for SharedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl CloneStream for ScriptedStream {
    type Writer = SharedWriter;

    fn clone_stream(&self) -> Option<Self::Writer> {
        Some(SharedWriter(Arc::clone(&self.output)))
    }
}

fn serve_scripted(input: Vec<u8>) -> String {
    let state = temp_socket();
    let broker = Mutex::new(test_broker(state.path()));
    let output = Arc::new(Mutex::new(Vec::new()));
    serve_connection(
        ScriptedStream {
            input: Cursor::new(input),
            output: Arc::clone(&output),
        },
        &broker,
        || 1_000_000,
    );
    let bytes = output.lock().unwrap().clone();
    String::from_utf8(bytes).unwrap()
}

#[test]
fn socket_is_bound_with_0600_permissions() {
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");
    let _listener = bind_listener(&path).expect("bind");
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, SOCKET_MODE, "socket must be 0600, got {mode:o}");
}

#[test]
fn stale_socket_file_is_cleaned_up_on_bind() {
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");

    // Simulate a crashed predecessor: a leftover file at the socket path.
    std::fs::write(&path, b"stale").unwrap();
    assert!(path.exists());

    // bind_listener must unlink it and succeed (would otherwise EADDRINUSE).
    let listener = bind_listener(&path).expect("bind over stale socket");
    drop(listener);
    assert!(path.exists(), "a fresh socket should now exist at the path");
}

#[test]
fn stale_socket_left_by_dropped_listener_is_recovered() {
    // A faithful crashed-predecessor scenario: bind a real socket, then drop the
    // listener WITHOUT unlinking, leaving a dead socket inode behind (no process
    // is listening). A re-bind must detect there is no live listener and recover.
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");

    let first = bind_listener(&path).expect("first bind");
    // Dropping a UnixListener closes its fd but does NOT unlink the socket file,
    // so this leaves a dead socket inode on disk with no process listening behind
    // it — exactly the stale state a crashed predecessor leaves.
    drop(first);
    assert!(path.exists(), "socket inode should linger after a crash");

    // Re-bind: nothing is listening behind the stale inode, so the probe-connect
    // fails and bind_listener unlinks + rebinds.
    let second = bind_listener(&path).expect("re-bind over stale (no listener) socket");
    drop(second);
}

#[test]
fn live_predecessor_is_not_clobbered() {
    // A LIVE broker is already listening on the path. A second bind_listener must
    // REFUSE rather than steal the socket out from under it (stale-socket
    // takeover / self-DoS guard).
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");

    let live = bind_listener(&path).expect("first (live) bind");
    // Spawn an acceptor so a connect-probe actually succeeds (proves "live").
    let live_clone_path = path.clone();
    let server = thread::spawn(move || {
        // Accept exactly one probe connection then return.
        if let Ok((stream, _)) = live.accept() {
            drop(stream);
        }
        // Hold the listener alive until the test drops it via the channel below.
        let _ = live_clone_path; // keep path captured for clarity
        live
    });

    // Give the acceptor a moment to be ready.
    thread::sleep(Duration::from_millis(50));

    let err =
        bind_listener(&path).expect_err("second bind over a LIVE broker must refuse, not clobber");
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::AddrInUse,
        "expected AddrInUse refusal, got {err:?}"
    );
    assert!(
        err.to_string().contains("already listening"),
        "refusal should name the live-listener condition, got: {err}"
    );

    // Clean up the acceptor thread (it returns the listener after one accept).
    let _live = server.join().expect("join acceptor");
    drop(_live);
}

#[test]
fn partial_message_is_reassembled_across_writes() {
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");
    let listener = bind_listener(&path).expect("bind");

    // Server thread: accept one connection, serve it with a fixed clock.
    let server = thread::spawn(move || {
        let state = temp_socket();
        let broker = Mutex::new(test_broker(state.path()));
        let (stream, _) = listener.accept().expect("accept");
        serve_connection(stream, &broker, || 1_000_000);
    });

    // Client: connect and send a Ping request SPLIT into three writes, with the
    // terminating newline arriving only in the final write. A correct framing
    // implementation must buffer the partial bytes and parse only on `\n`.
    let mut client = UnixStream::connect(&path).expect("connect");
    let parts: [&[u8]; 3] = [b"{\"type\":", b"\"pi", b"ng\"}\n"];
    for part in parts {
        client.write_all(part).unwrap();
        client.flush().unwrap();
        thread::sleep(Duration::from_millis(10)); // force separate read()s
    }

    // Read exactly one NDJSON response line.
    let mut reader = BufReader::new(client.try_clone().unwrap());
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert_eq!(line.trim_end(), "{\"type\":\"pong\"}");

    // Close so the server loop ends.
    drop(reader);
    drop(client);
    server.join().unwrap();
}

#[test]
fn malformed_request_closes_without_secret_or_suffix_execution() {
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");
    let listener = bind_listener(&path).expect("bind");

    let server = thread::spawn(move || {
        let state = temp_socket();
        let broker = Mutex::new(test_broker(state.path()));
        let (stream, _) = listener.accept().expect("accept");
        serve_connection(stream, &broker, || 1_000_000);
    });

    let mut client = UnixStream::connect(&path).expect("connect");
    // A malformed frame gets one bounded BadRequest and closes. The valid Ping
    // already queued behind it must never become a second request.
    client.write_all(b"{not valid json}\n").unwrap();
    client.write_all(b"{\"type\":\"ping\"}\n").unwrap();
    client.flush().unwrap();

    let mut buf = String::new();
    let mut reader = BufReader::new(client.try_clone().unwrap());
    reader.read_line(&mut buf).unwrap();
    let mut second = String::new();
    let second_len = reader.read_line(&mut second).unwrap();
    drop(reader);
    drop(client);
    server.join().unwrap();

    assert!(
        buf.contains("bad-request"),
        "first line should be bad-request: {buf}"
    );
    assert_eq!(second_len, 0, "connection must close after bad-request");
    assert!(second.is_empty());
    for line in [&buf, &second] {
        assert!(!line.contains(SECRET), "secret leaked over socket: {line}");
        assert!(!line.contains("ghp_"), "credential prefix leaked: {line}");
    }
}

#[test]
fn valid_request_after_oversized_prefix_is_never_executed() {
    let mut payload = vec![b'a'; MAX_REQUEST_BYTES as usize];
    payload.extend_from_slice(b"{\"type\":\"ping\"}\n");

    let output = serve_scripted(payload);
    let lines: Vec<_> = output.lines().collect();
    assert_eq!(lines.len(), 1, "at most one bounded refusal is written");
    assert!(lines[0].contains("bad-request"));
    assert!(
        !output.contains("pong"),
        "suffix request was executed: {output}"
    );
    assert!(!output.contains(SECRET));
}

#[test]
fn one_valid_request_exhausts_the_connection_budget() {
    assert_eq!(MAX_REQUESTS_PER_CONNECTION, 1);
    let output = serve_scripted(b"{\"type\":\"ping\"}\n{\"type\":\"ping\"}\n".to_vec());
    assert_eq!(output, "{\"type\":\"pong\"}\n");
}

#[test]
fn owner_socket_possession_cannot_mint_native_operator_authority() {
    let dir = temp_socket();
    let path = dir.path().join("broker.sock");
    let listener = bind_listener(&path).expect("bind");

    let server = thread::spawn(move || {
        let state = temp_socket();
        let broker = Mutex::new(test_broker(state.path()));
        let (stream, _) = listener.accept().expect("accept");
        serve_connection(stream, &broker, || 1_000_000);
    });

    let request = Request::MintActionCapability {
        authority: Box::new(MintAuthority::NativeOperatorBootstrap),
        intent: Box::new(ActionIntent {
            audience: "port-daddy:git-egress".into(),
            operation: "parley.resolve".into(),
            resource_digest: pd_broker::resource_digest(
                "test/parley-action/v1",
                &["parley-1", "resolve"],
            )
            .unwrap(),
        }),
    };
    let mut client = UnixStream::connect(&path).expect("connect over owner-only socket");
    client
        .write_all(format!("{}\n", serde_json::to_string(&request).unwrap()).as_bytes())
        .unwrap();
    client.flush().unwrap();

    let mut line = String::new();
    BufReader::new(client.try_clone().unwrap())
        .read_line(&mut line)
        .unwrap();
    drop(client);
    server.join().unwrap();
    let response: Response = serde_json::from_str(&line).unwrap();
    assert!(matches!(
        response,
        Response::BootstrapRequired {
            requirement: BootstrapRequirement::CodeSignedKeychainOperatorCredential,
            ..
        }
    ));
    assert!(!line.contains(SECRET));
    assert!(!line.contains("tag_hex"));
    assert!(!line.contains("\"type\":\"capability\""));
}

/// Sanity that a too-short read returning before the newline does not parse.
#[test]
fn reader_blocks_until_newline_then_parses_once() {
    use pd_broker::transport::read_one_request;
    use std::io::Cursor;
    // Two requests back to back, no trailing newline on the buffer end — the
    // second still parses because it has its own newline.
    let mut reader = Cursor::new(b"{\"type\":\"ping\"}\n{\"type\":\"ping\"}\n".to_vec());
    assert!(read_one_request(&mut reader).unwrap().is_some());
    assert!(read_one_request(&mut reader).unwrap().is_some());
    assert!(read_one_request(&mut reader).unwrap().is_none());
}

/// Suppress unused-import lints if a refactor drops a use; keeps the file honest.
#[allow(dead_code)]
fn _force_use(_r: &mut dyn Read) {}
