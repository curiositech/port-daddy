//! pd-broker binary — the isolated credential-broker process.
//!
//! Listens on a Unix domain socket, frames newline-delimited JSON, and routes
//! each request through `Broker::handle`. The raw secret is loaded once at
//! startup (env var or `0600` file) into the in-process vault and NEVER crosses
//! the socket. Mint and redemption both require cryptographic authority; socket
//! locality is never an authorization input.
//!
//! Operational discipline (ipc-communication-patterns idioms):
//!   * stale socket file removed on startup (a crashed predecessor leaves one);
//!   * socket mode set to `0600` so only the owning UID can connect;
//!   * SIGPIPE ignored so a client hanging up mid-write does not kill us;
//!   * SIGTERM/SIGINT flip an atomic shutdown flag; the accept loop unlinks the
//!     socket and exits cleanly.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use pd_broker::broker::{Broker, BrokerConfig};
use pd_broker::capability::MAX_CAPABILITY_TTL_MS;
use pd_broker::transport::{bind_listener, serve_connection, READ_TIMEOUT};
use pd_core::now_ms;

/// 20-minute default capability lifetime. Minting additionally clamps the
/// expiry to the authenticating credential's own deadline.
const DEFAULT_CAPABILITY_TTL_MS: i64 = 20 * 60 * 1000;

/// Hard ceiling on concurrently-served connections. Each connection gets its own
/// handler thread (so a stalled client cannot pin the acceptor); this bounds the
/// thread count so a flood of connections cannot exhaust memory/FDs. At the cap
/// the broker closes new connections cleanly rather than spawning unbounded
/// threads. 64 is far above any legitimate concurrent-agent count for a
/// single-host broker.
const MAX_CONCURRENT_CONNS: usize = 64;

static SHUTDOWN: AtomicBool = AtomicBool::new(false);

extern "C" fn on_term(_sig: libc::c_int) {
    SHUTDOWN.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    unsafe {
        // Ignore SIGPIPE: a client that disconnects mid-response must not kill
        // the broker; per-connection writes already handle the resulting error.
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        // SIGTERM / SIGINT request a graceful shutdown.
        libc::signal(libc::SIGTERM, on_term as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_term as *const () as libc::sighandler_t);
    }
}

/// Load the protected secret. Precedence: `PD_BROKER_SECRET_FILE` (a 0600 file)
/// over `PD_BROKER_SECRET` (env). Refuses a file with looser-than-0600 perms.
fn load_secret() -> Result<Vec<u8>, String> {
    if let Ok(path) = std::env::var("PD_BROKER_SECRET_FILE") {
        let meta =
            std::fs::metadata(&path).map_err(|e| format!("cannot stat secret file {path}: {e}"))?;
        let mode = meta.permissions().mode() & 0o777;
        if mode & 0o077 != 0 {
            return Err(format!(
                "secret file {path} has mode {mode:o}; must be 0600 (group/other must have no access)"
            ));
        }
        let bytes =
            std::fs::read(&path).map_err(|e| format!("cannot read secret file {path}: {e}"))?;
        let trimmed = trim_trailing_newline(bytes);
        if trimmed.is_empty() {
            return Err(format!("secret file {path} is empty"));
        }
        return Ok(trimmed);
    }
    match std::env::var("PD_BROKER_SECRET") {
        Ok(s) if !s.is_empty() => Ok(s.into_bytes()),
        _ => Err("set PD_BROKER_SECRET or PD_BROKER_SECRET_FILE".into()),
    }
}

fn trim_trailing_newline(mut bytes: Vec<u8>) -> Vec<u8> {
    while matches!(bytes.last(), Some(b'\n') | Some(b'\r')) {
        bytes.pop();
    }
    bytes
}

/// Load a key from an env var, falling back to a deterministic dev key only when
/// `PD_BROKER_DEV=1` AND this is a debug build. In production (release build) the
/// keys must be supplied: the hardcoded dev defaults are gated behind
/// `cfg!(debug_assertions)` so a release binary started with `PD_BROKER_DEV=1`
/// still refuses and requires real keys — the dev keys can never sign capabilities or
/// verify macaroons in a shipped binary.
fn load_key(var: &str, dev_default: &[u8]) -> Result<Vec<u8>, String> {
    match std::env::var(var) {
        Ok(s) if !s.is_empty() => Ok(s.into_bytes()),
        _ => {
            if std::env::var("PD_BROKER_DEV").as_deref() == Ok("1") {
                if cfg!(debug_assertions) {
                    eprintln!(
                        "pd-broker: {var} unset, using dev default (PD_BROKER_DEV=1, debug build)"
                    );
                    Ok(dev_default.to_vec())
                } else {
                    eprintln!(
                        "pd-broker: PD_BROKER_DEV=1 ignored in a release build; \
                         {var} must be a real key in production"
                    );
                    Err(format!(
                        "set {var}: dev-key fallback is disabled in release builds"
                    ))
                }
            } else {
                Err(format!(
                    "set {var} (or PD_BROKER_DEV=1 for a dev key in debug builds)"
                ))
            }
        }
    }
}

fn socket_path() -> PathBuf {
    if let Ok(p) = std::env::var("PD_BROKER_SOCKET") {
        return PathBuf::from(p);
    }
    let base = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".port-daddy").join("broker.sock")
}

/// Public server identity settings are required in release builds. Debug-only
/// development defaults are explicit and cannot create production authority.
fn load_identity(var: &str, dev_default: &str) -> Result<String, String> {
    match std::env::var(var) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ if std::env::var("PD_BROKER_DEV").as_deref() == Ok("1") && cfg!(debug_assertions) => {
            Ok(dev_default.to_owned())
        }
        _ => Err(format!("set {var}")),
    }
}

/// Parse the server-owned audience allowlist. The broker constructor enforces
/// canonical values, uniqueness, count bounds, and inclusion of its own issuer.
fn load_allowed_audiences(issuer: &str) -> Result<Vec<String>, String> {
    match std::env::var("PD_BROKER_ALLOWED_AUDIENCES") {
        Ok(value) => Ok(value.split(',').map(str::to_owned).collect()),
        Err(_)
            if std::env::var("PD_BROKER_DEV").as_deref() == Ok("1") && cfg!(debug_assertions) =>
        {
            Ok(vec![issuer.to_owned(), "port-daddy:git-egress".into()])
        }
        Err(_) => Err("set PD_BROKER_ALLOWED_AUDIENCES".into()),
    }
}

/// Durable replay ledger path. It defaults beside the socket, not to process
/// memory, so a broker restart preserves one-use truth.
fn redemption_db_path(socket: &Path) -> PathBuf {
    std::env::var("PD_BROKER_STATE_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| socket.with_extension("redemptions.sqlite3"))
}

fn run() -> Result<(), String> {
    install_signal_handlers();

    let secret = load_secret()?;
    let capability_signing_key = load_key(
        "PD_BROKER_CAPABILITY_KEY",
        b"dev-action-capability-key-32-bytes!",
    )?;
    let issuer = load_identity("PD_BROKER_ISSUER", "port-daddy:broker")?;
    let allowed_audiences = load_allowed_audiences(&issuer)?;
    let capability_ttl_ms = match std::env::var("PD_BROKER_CAPABILITY_TTL_MS") {
        Ok(value) => value
            .parse::<i64>()
            .ok()
            .filter(|ttl| (1..=MAX_CAPABILITY_TTL_MS).contains(ttl))
            .ok_or_else(|| {
                format!("PD_BROKER_CAPABILITY_TTL_MS must be between 1 and {MAX_CAPABILITY_TTL_MS}")
            })?,
        Err(_) => DEFAULT_CAPABILITY_TTL_MS,
    };
    let path = socket_path();
    let state_db = redemption_db_path(&path);

    let broker = Broker::new(BrokerConfig {
        secret,
        capability_signing_key,
        capability_ttl_ms,
        issuer,
        allowed_audiences,
        redemption_db_path: state_db,
    })
    .map_err(|e| format!("broker init failed: {e}"))?;

    let listener = bind_listener(&path).map_err(|e| format!("bind {path:?} failed: {e}"))?;
    // Non-blocking accept so the loop can poll the shutdown flag.
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking failed: {e}"))?;

    eprintln!(
        "pd-broker: listening on {} (secret {} bytes held internally, capability TTL {}ms)",
        path.display(),
        broker.secret_len(),
        capability_ttl_ms
    );

    // Shared so each connection's handler thread can lock the broker. The broker
    // mutates one SQLite connection, so handlers serialize on this mutex. Cross-
    // process redemption races are still resolved by SQLite's unique reservation.
    let broker = Arc::new(Mutex::new(broker));
    // Live connection count, decremented by an RAII guard on each handler thread.
    let conn_count = Arc::new(AtomicUsize::new(0));

    while !SHUTDOWN.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _addr)) => {
                // Back to blocking mode for the per-connection read, but bounded
                // by a read timeout so a stalled/half-open client cannot hold its
                // handler thread forever.
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(READ_TIMEOUT));

                // Bound concurrency: refuse cleanly at the cap rather than
                // spawning unbounded threads. Reserve a slot first; if we are
                // over the cap, undo the reservation and drop the connection.
                let prior = conn_count.fetch_add(1, Ordering::SeqCst);
                if prior >= MAX_CONCURRENT_CONNS {
                    conn_count.fetch_sub(1, Ordering::SeqCst);
                    // Dropping `stream` closes the connection cleanly (FIN/EOF).
                    drop(stream);
                    continue;
                }

                let broker = Arc::clone(&broker);
                let handler_count = Arc::clone(&conn_count);
                // Move serving off the acceptor thread: a stalled client now only
                // blocks its own thread, never the accept loop.
                let spawned = std::thread::Builder::new()
                    .name("pd-broker-conn".into())
                    .spawn(move || {
                        // RAII guard decrements the live count even if the
                        // handler panics, so a panicking handler can never leak a
                        // slot and wedge the cap.
                        let _guard = ConnGuard(&handler_count);
                        serve_connection(stream, &broker, now_ms);
                    });
                if spawned.is_err() {
                    // Thread spawn failed (e.g. resource limit). The closure that
                    // captured `stream` was already dropped inside `spawn` on the
                    // Err path, so the connection is closed cleanly; we just
                    // release the reserved slot here.
                    conn_count.fetch_sub(1, Ordering::SeqCst);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                eprintln!("pd-broker: accept error: {e}");
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }

    let _ = std::fs::remove_file(&path);
    eprintln!("pd-broker: shut down, socket unlinked");
    Ok(())
}

/// Decrements the live-connection counter on drop, so the slot is released even
/// if the handler thread panics mid-connection.
struct ConnGuard<'a>(&'a AtomicUsize);

impl Drop for ConnGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("pd-broker: fatal: {e}");
        std::process::exit(1);
    }
}
