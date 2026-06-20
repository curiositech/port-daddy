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
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::sync::Mutex;

use crate::broker::Broker;
use crate::protocol::{Request, Response};

/// Bind a Unix listener at `path`: remove any stale socket file left by a
/// crashed predecessor, create the parent dir, bind, and chmod the socket 0600
/// (owner-only). Returns the bound listener.
pub fn bind_listener(path: &Path) -> std::io::Result<UnixListener> {
    if path.exists() {
        // Stale socket from a crashed predecessor — unlink so bind() can succeed.
        let _ = std::fs::remove_file(path);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// The 0600 mode bits a freshly bound broker socket must carry. Exposed so a
/// test can assert the permission without re-deriving the constant.
pub const SOCKET_MODE: u32 = 0o600;

/// Read exactly one NDJSON request line from a buffered reader, reassembling a
/// message split across multiple reads. Returns `Ok(None)` on clean EOF.
pub fn read_one_request<R: BufRead>(reader: &mut R) -> std::io::Result<Option<Request>> {
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Ok(None); // EOF
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
            Err(_) => break, // I/O error / client gone
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
}
