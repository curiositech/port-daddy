//! Unix-domain-socket transport for the broker: framing, stale-socket cleanup,
//! and 0600 permissions. Split out from `main.rs` so the framing and lifecycle
//! are unit-testable without the full signal/daemon harness.
//!
//! Framing is newline-delimited JSON. `read_one_request` buffers bytes until it
//! sees a `\n`, so a request split across multiple `read()` calls (a "partial
//! message") is reassembled before parsing — the stream-socket framing idiom
//! from `ipc-communication-patterns`.

use std::io::{BufRead, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use crate::broker::Broker;
use crate::protocol::{Request, Response};

/// Hard cap on the bytes read for a single NDJSON request line. A request is one
/// macaroon grant + a handful of discharges + a small context object; even a
/// large legitimate grant is well under this. Capping the per-request read turns
/// two IPC denial-of-service vectors into a bounded `BadRequest`:
///   * **memory exhaustion** — a client streaming an endless line with no `\n`
///     would otherwise grow an unbounded `String` until the broker is OOM-killed;
///   * **slowloris** — a client dribbling bytes with no terminator can no longer
///     hold the read buffer open indefinitely once the cap is hit.
///
/// 256 KiB is ~8x the largest plausible grant+discharge payload, so it never
/// trips a real request but stops an abusive one cold.
pub const MAX_REQUEST_BYTES: u64 = 256 * 1024;

/// Per-connection read timeout. A client that opens a connection and then stalls
/// (half-open, or dribbling sub-buffer bytes) blocks only its own handler thread
/// for at most this long before the read returns `WouldBlock`/`TimedOut` and the
/// connection is closed. Combined with off-acceptor-thread serving in `main.rs`,
/// no single stalled client can pin the broker. 10s is generous for a localhost
/// Unix socket where a real client writes a full request in microseconds.
pub const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Bind a Unix listener at `path` WITHOUT clobbering a live predecessor.
///
/// A naive `remove_file`-then-`bind` is a self-DoS / takeover hazard: if a
/// healthy broker is already listening on `path`, unconditionally unlinking its
/// socket silently steals the address out from under it (new clients connect to
/// the impostor; the original keeps an orphaned inode). So we:
///   1. Try `bind` first. If it succeeds, the path was free — done.
///   2. On `AddrInUse`, **probe** the existing socket with a connect. If someone
///      answers, a live broker owns the path → refuse with a clear error rather
///      than clobbering it.
///   3. If the connect fails (`ECONNREFUSED`/`ENOENT` — a stale socket file left
///      by a crashed predecessor, with no listener behind it), unlink it once and
///      retry the bind.
///
/// Hardening is unchanged: parent dir is created mode 0700, the bind runs under a
/// forced 0o077 umask so the socket inode is born owner-only (closing the
/// bind→chmod TOCTOU window), and an explicit 0600 chmod stays as
/// defense-in-depth.
pub fn bind_listener(path: &Path) -> std::io::Result<UnixListener> {
    if let Some(parent) = path.parent() {
        // Create the parent dir owner-only (0700) so the socket is never
        // reachable by another user even in the bind→chmod window. create_dir_all
        // does not apply a mode to dirs it creates, so chmod the leaf afterward.
        std::fs::create_dir_all(parent)?;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }

    match bind_owner_only(path) {
        Ok(listener) => {
            finalize_socket_perms(path)?;
            Ok(listener)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            // Something already holds this path. Probe before clobbering.
            if UnixStream::connect(path).is_ok() {
                // A live broker answered — do NOT steal its socket.
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    format!("a broker is already listening on {}", path.display()),
                ));
            }
            // Nobody is listening: stale socket file from a crashed predecessor.
            // Unlink once and retry the bind.
            std::fs::remove_file(path)?;
            let listener = bind_owner_only(path)?;
            finalize_socket_perms(path)?;
            Ok(listener)
        }
        Err(e) => Err(e),
    }
}

/// Bind the socket inode owner-only by forcing a restrictive umask (0o077) for
/// the duration of the bind, then restoring the prior umask. `umask(2)` returns
/// the previous mask and cannot fail.
fn bind_owner_only(path: &Path) -> std::io::Result<UnixListener> {
    let prev_umask = unsafe { libc::umask(0o077) };
    let result = UnixListener::bind(path);
    unsafe {
        libc::umask(prev_umask);
    }
    result
}

/// Defense-in-depth: assert 0600 on the bound socket regardless of the umask.
fn finalize_socket_perms(path: &Path) -> std::io::Result<()> {
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

/// The 0600 mode bits a freshly bound broker socket must carry. Exposed so a
/// test can assert the permission without re-deriving the constant.
pub const SOCKET_MODE: u32 = 0o600;

/// Read exactly one NDJSON request line from a buffered reader, reassembling a
/// message split across multiple reads. Returns `Ok(None)` on clean EOF.
///
/// The read is hard-capped at `MAX_REQUEST_BYTES` via `Read::take`: if that many
/// bytes arrive WITHOUT a terminating newline, the line is rejected as
/// `InvalidData` (→ `BadRequest`) instead of growing the buffer without bound.
/// This caps both the memory-exhaustion and slowloris DoS vectors at the framing
/// layer.
pub fn read_one_request<R: BufRead>(reader: &mut R) -> std::io::Result<Option<Request>> {
    loop {
        let mut line = String::new();
        // Cap the read: `take` yields at most MAX_REQUEST_BYTES before reporting
        // EOF, so `read_line` cannot grow `line` past the cap. We then check
        // whether the line was actually newline-terminated to distinguish a real
        // request from a truncated/oversized one.
        let n = reader
            .by_ref()
            .take(MAX_REQUEST_BYTES)
            .read_line(&mut line)?;
        if n == 0 {
            return Ok(None); // EOF
        }
        // If we hit the cap without a terminating newline, this is an oversized /
        // unterminated request: reject it rather than buffering more. (A line at
        // exactly the cap WITH a newline is still rejected — a legitimate request
        // is far smaller, and treating a cap-length line as valid would let a
        // crafted payload sit right at the boundary.)
        if !line.ends_with('\n') {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("request exceeded {MAX_REQUEST_BYTES} bytes without a newline terminator"),
            ));
        }
        if line.trim().is_empty() {
            continue; // skip blank framing lines
        }
        return match serde_json::from_str::<Request>(line.trim_end()) {
            Ok(req) => Ok(Some(req)),
            // Surface a parse error as a typed sentinel the caller turns into a
            // BadRequest response, rather than dropping the connection.
            Err(e) => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            )),
        };
    }
}

/// Serve one connection: read NDJSON requests, route each through the broker,
/// write one NDJSON response per request. `now_ms` is a clock fn so tests can
/// inject a deterministic clock.
pub fn serve_connection<S, F>(stream: S, broker: &Mutex<Broker>, now_ms: F)
where
    S: Read + Write + CloneStream,
    F: Fn() -> i64,
{
    let write_half = match stream.clone_stream() {
        Some(s) => s,
        None => return,
    };
    let mut writer = std::io::BufWriter::new(write_half);
    let mut reader = std::io::BufReader::new(stream);

    loop {
        match read_one_request(&mut reader) {
            Ok(Some(req)) => {
                let resp = {
                    let mut guard = broker.lock().expect("broker mutex poisoned");
                    guard.handle(req, now_ms())
                };
                if writer.write_all(resp.to_ndjson_line().as_bytes()).is_err() {
                    break;
                }
                if writer.flush().is_err() {
                    break;
                }
            }
            Ok(None) => break, // clean EOF
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                let resp = Response::BadRequest {
                    reason: format!("invalid request json: {e}"),
                };
                let _ = writer.write_all(resp.to_ndjson_line().as_bytes());
                let _ = writer.flush();
                // continue: one bad line does not poison the whole connection
            }
            // A read timeout (set via `set_read_timeout` on accept) surfaces as
            // WouldBlock/TimedOut on a blocking socket. Treat it as a clean
            // connection close — a stalled/half-open client is dropped, not
            // panicked on, so it cannot hold the handler thread forever.
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break;
            }
            Err(_) => break, // other I/O error / client gone
        }
    }
}

/// A stream that can produce an independent write handle (so the reader and
/// writer halves can coexist). Implemented for `UnixStream` and, in tests, for
/// any duplex pair.
pub trait CloneStream {
    type Writer: Write;
    fn clone_stream(&self) -> Option<Self::Writer>;
}

impl CloneStream for std::os::unix::net::UnixStream {
    type Writer = std::os::unix::net::UnixStream;
    fn clone_stream(&self) -> Option<Self::Writer> {
        self.try_clone().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_one_request_reassembles_partial_then_parses() {
        // A single line delivered as one buffer (BufRead over Cursor); the
        // socket-level partial-read reassembly is covered by the integration
        // test. Here we confirm the parse contract.
        let json = "{\"type\":\"ping\"}\n";
        let mut reader = Cursor::new(json.as_bytes());
        let req = read_one_request(&mut reader).unwrap();
        assert_eq!(req, Some(Request::Ping));
        // next read hits EOF
        assert_eq!(read_one_request(&mut reader).unwrap(), None);
    }

    #[test]
    fn blank_lines_are_skipped() {
        let json = "\n\n{\"type\":\"ping\"}\n";
        let mut reader = Cursor::new(json.as_bytes());
        assert_eq!(read_one_request(&mut reader).unwrap(), Some(Request::Ping));
    }

    #[test]
    fn bad_json_is_invalid_data_error() {
        let mut reader = Cursor::new(b"{not json}\n".to_vec());
        let err = read_one_request(&mut reader).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn oversized_unterminated_line_is_rejected_not_buffered() {
        // A payload larger than the cap with NO terminating newline must be
        // rejected as InvalidData rather than buffering all of it. We hand the
        // reader more than MAX_REQUEST_BYTES of non-newline bytes; the `take`
        // cap means read_line stops at the cap and we report InvalidData because
        // no newline was seen.
        let payload = vec![b'a'; (MAX_REQUEST_BYTES as usize) + 4096];
        let mut reader = Cursor::new(payload);
        let err = read_one_request(&mut reader).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert!(
            err.to_string().contains("without a newline terminator"),
            "expected oversized-line diagnostic, got: {err}"
        );
    }

    #[test]
    fn line_at_cap_without_newline_is_rejected() {
        // Exactly MAX_REQUEST_BYTES of bytes, no newline: still rejected (the cap
        // is reached before any terminator). Proves the buffer can never exceed
        // the cap.
        let payload = vec![b'a'; MAX_REQUEST_BYTES as usize];
        let mut reader = Cursor::new(payload);
        let err = read_one_request(&mut reader).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }
}
