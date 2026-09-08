//! pd-bosun
//!
//! A small, non-agent supervisor for the Port Daddy daemon. Bosun intentionally
//! avoids HTTP: it reads the daemon's filesystem heartbeat, checks the recorded
//! PID, and can ask launchd to restart the daemon when progress stalls.
//!
//! Example:
//!
//! ```sh
//! pd-bosun status
//! pd-bosun watch
//! PORT_DADDY_BOSUN_DRY_RUN=1 pd-bosun watch
//! ```

use std::env;
use std::error::Error;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HEARTBEAT_SCHEMA: &str = "port-daddy.bosun.heartbeat.v1";
const DEFAULT_INTERVAL_MS: u64 = 5_000;
const DEFAULT_STALE_AFTER_MS: u64 = 30_000;
const DEFAULT_DAEMON_LABEL: &str = "com.portdaddy.daemon";
// Phase C (ADR-0036 "Gap Phase C fills"): exponential backoff between restart
// attempts once a stall is detected. Index 0 is the wait BEFORE the 2nd
// attempt (the 1st attempt always fires immediately on detection); the last
// entry is the cap reused for every attempt beyond it.
const BACKOFF_SCHEDULE_MS: [u64; 4] = [30_000, 60_000, 120_000, 300_000];
// Hard cap of consecutive failed restart attempts before Bosun gives up and
// writes the loud alert file rather than hammering launchctl forever.
const DEFAULT_MAX_RESTART_ATTEMPTS: u32 = 5;
const ALERT_SCHEMA: &str = "port-daddy.bosun.alert.v1";
#[cfg(unix)]
const SIGNAL_PROBE: i32 = 0;
#[cfg(unix)]
const SIGNAL_KILL: i32 = 9;
#[cfg(unix)]
const ESRCH: i32 = 3;

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
    fn getuid() -> u32;
}

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Debug)]
struct BosunError(String);

impl fmt::Display for BosunError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Error for BosunError {}

/// Daemon heartbeat payload written by `lib/bosun-heartbeat.ts`.
///
/// Sample input:
///
/// ```json
/// {
///   "schema": "port-daddy.bosun.heartbeat.v1",
///   "pid": 12345,
///   "writtenAt": 1777050000000,
///   "uptimeMs": 5000,
///   "version": "3.9.0",
///   "codeHash": "abc123",
///   "startedAt": 1777049995000,
///   "installDir": "/Users/me/port-daddy-stable",
///   "pidFile": "/Users/me/.port-daddy/daemon.pid",
///   "portFile": "/Users/me/.port-daddy/daemon.port",
///   "hostname": "workstation"
/// }
/// ```
#[derive(Debug, Clone)]
struct Heartbeat {
    schema: String,
    pid: u32,
    written_at: u64,
    uptime_ms: u64,
    version: String,
    code_hash: String,
    started_at: u64,
    install_dir: String,
    pid_file: String,
    port_file: String,
    hostname: String,
}

/// Runtime configuration for the Bosun process.
///
/// Sample environment:
///
/// ```sh
/// PORT_DADDY_HEARTBEAT_FILE=/tmp/pd-heartbeat
/// PORT_DADDY_BOSUN_STALE_MS=30000
/// PORT_DADDY_BOSUN_DRY_RUN=1
/// ```
#[derive(Debug, Clone)]
struct Config {
    heartbeat_path: PathBuf,
    interval_ms: u64,
    stale_after_ms: u64,
    daemon_label: String,
    dry_run: bool,
    /// Phase C: where Bosun writes its loud, durable "I gave up" signal. The
    /// ONE piece of state Bosun keeps outside the heartbeat file / ephemeral
    /// process probes (ADR-0036's "no keys, no mailbox, no DB" — a plain JSON
    /// marker file is not a database).
    alert_path: PathBuf,
    /// Consecutive failed restart attempts before Bosun stops trying and
    /// writes `alert_path`. Configurable for tests; production default 5.
    max_restart_attempts: u32,
}

/// One inspection result for the heartbeat file and recorded daemon PID.
///
/// Sample output from `pd-bosun status`:
///
/// ```json
/// {
///   "state": "healthy",
///   "reason": "daemon heartbeat is fresh",
///   "heartbeatPath": "/Users/me/.port-daddy/heartbeat",
///   "staleAfterMs": 30000,
///   "ageMs": 1200,
///   "pid": 12345,
///   "daemonAlive": true,
///   "wouldRestart": false,
///   "daemonVersion": "3.9.0",
///   "installDir": "/Users/me/port-daddy-stable"
/// }
/// ```
#[derive(Debug, Clone)]
struct BosunStatus {
    state: String,
    reason: String,
    action: String,
    heartbeat_path: String,
    stale_after_ms: u64,
    age_ms: Option<u64>,
    pid: Option<u32>,
    daemon_alive: Option<bool>,
    canonical_pid: Option<u32>,
    canonical_alive: Option<bool>,
    would_restart: bool,
    daemon_version: Option<String>,
    daemon_code_hash: Option<String>,
    daemon_uptime_ms: Option<u64>,
    daemon_started_at: Option<u64>,
    daemon_install_dir: Option<String>,
    daemon_pid_file: Option<String>,
    daemon_port_file: Option<String>,
    daemon_hostname: Option<String>,
}

/// Parse environment variables into a Bosun configuration.
fn config_from_env() -> Config {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let heartbeat_path = env::var("PORT_DADDY_HEARTBEAT_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&home).join(".port-daddy").join("heartbeat"));
    let interval_ms = parse_env_u64("PORT_DADDY_BOSUN_INTERVAL_MS", DEFAULT_INTERVAL_MS);
    let stale_after_ms = parse_env_u64("PORT_DADDY_BOSUN_STALE_MS", DEFAULT_STALE_AFTER_MS);
    let daemon_label = env::var("PORT_DADDY_BOSUN_DAEMON_LABEL")
        .unwrap_or_else(|_| DEFAULT_DAEMON_LABEL.to_string());
    let dry_run = env_truthy("PORT_DADDY_BOSUN_DRY_RUN");
    let alert_path = env::var("PORT_DADDY_BOSUN_ALERT_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&home).join(".port-daddy").join("bosun.alert"));
    let max_restart_attempts =
        parse_env_u64("PORT_DADDY_BOSUN_MAX_RESTART_ATTEMPTS", DEFAULT_MAX_RESTART_ATTEMPTS as u64)
            .max(1) as u32;

    Config {
        heartbeat_path,
        interval_ms,
        stale_after_ms,
        daemon_label,
        dry_run,
        alert_path,
        max_restart_attempts,
    }
}

/// Parse a numeric environment variable with a default fallback.
fn parse_env_u64(name: &str, default_value: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(default_value)
}

/// Return true for conventional truthy environment flag values.
fn env_truthy(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

/// Read and validate a heartbeat payload from disk.
fn read_heartbeat(path: &Path) -> Result<Heartbeat> {
    let raw = fs::read_to_string(path).map_err(|err| {
        BosunError(format!(
            "heartbeat file is not readable: {} ({})",
            path.display(),
            err
        ))
    })?;
    let heartbeat = Heartbeat {
        schema: json_string(&raw, "schema")?,
        pid: json_u64(&raw, "pid")? as u32,
        written_at: json_u64(&raw, "writtenAt")?,
        uptime_ms: json_u64(&raw, "uptimeMs")?,
        version: json_string(&raw, "version")?,
        code_hash: json_string(&raw, "codeHash")?,
        started_at: json_u64(&raw, "startedAt")?,
        install_dir: json_string(&raw, "installDir")?,
        pid_file: json_string(&raw, "pidFile")?,
        port_file: json_string(&raw, "portFile")?,
        hostname: json_string(&raw, "hostname")?,
    };
    if heartbeat.schema != HEARTBEAT_SCHEMA {
        return Err(Box::new(BosunError(format!(
            "unsupported heartbeat schema: {}",
            heartbeat.schema
        ))));
    }
    Ok(heartbeat)
}

/// Extract a string field from the heartbeat JSON.
fn json_string(raw: &str, key: &str) -> Result<String> {
    let value = json_value_slice(raw, key)?;
    if !value.starts_with('"') {
        return Err(Box::new(BosunError(format!("field '{}' is not a string", key))));
    }
    let mut escaped = false;
    let mut output = String::new();
    for ch in value[1..].chars() {
        if escaped {
            output.push(match ch {
                '"' => '"',
                '\\' => '\\',
                '/' => '/',
                'b' => '\u{0008}',
                'f' => '\u{000c}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return Ok(output),
            other => output.push(other),
        }
    }
    Err(Box::new(BosunError(format!("field '{}' string is unterminated", key))))
}

/// Extract an unsigned integer field from the heartbeat JSON.
fn json_u64(raw: &str, key: &str) -> Result<u64> {
    let value = json_value_slice(raw, key)?;
    let digits: String = value
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return Err(Box::new(BosunError(format!("field '{}' is not an integer", key))));
    }
    digits.parse::<u64>().map_err(|err| {
        Box::new(BosunError(format!("field '{}' integer parse failed: {}", key, err))) as Box<dyn Error>
    })
}

/// Return the raw JSON value slice after a top-level key.
fn json_value_slice<'a>(raw: &'a str, key: &str) -> Result<&'a str> {
    let needle = format!("\"{}\"", key);
    let key_start = raw.find(&needle).ok_or_else(|| {
        Box::new(BosunError(format!("field '{}' is missing", key))) as Box<dyn Error>
    })?;
    let after_key = &raw[key_start + needle.len()..];
    let colon = after_key.find(':').ok_or_else(|| {
        Box::new(BosunError(format!("field '{}' is missing ':'", key))) as Box<dyn Error>
    })?;
    Ok(after_key[colon + 1..].trim_start())
}

/// Read the canonical daemon PID recorded by the daemon once it owns the socket.
///
/// Sample inputs and outputs:
///
/// ```text
/// "/Users/me/.port-daddy/daemon.pid" containing "12345\n" -> Some(12345)
/// missing or malformed pid file -> None
/// ```
fn read_pid_file(path: &str) -> Option<u32> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 0)
}

/// Return the current Unix epoch in milliseconds.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

/// Interpret a platform `kill -0` probe.
///
/// Sample inputs and outputs:
///
/// ```text
/// (success=true, stderr="") -> true
/// (success=false, stderr="Operation not permitted") -> true
/// (success=false, stderr="No such process") -> false
/// ```
///
/// macOS can return EPERM when a process exists but the caller cannot signal it.
/// For Bosun liveness, that is alive: only absence should be treated as dead.
#[cfg(any(test, not(unix)))]
fn kill_probe_means_alive(success: bool, stderr: &[u8]) -> bool {
    if success {
        return true;
    }

    let stderr_text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    stderr_text.contains("operation not permitted")
        || stderr_text.contains("not permitted")
        || stderr_text.contains("permission denied")
}

/// Check whether a PID currently names a live process.
#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    match send_signal(pid, SIGNAL_PROBE) {
        Ok(()) => true,
        Err(errno) => errno != ESRCH,
    }
}

/// Check whether a PID currently names a live process.
#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|output| kill_probe_means_alive(output.status.success(), &output.stderr))
        .unwrap_or(false)
}

/// Send a Unix signal without spawning `/bin/kill`.
///
/// Sample inputs and outputs:
///
/// ```text
/// send_signal(12345, 0) -> Ok(()) when the process exists
/// send_signal(12345, 9) -> Ok(()) after SIGKILL is accepted
/// ```
#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> std::result::Result<(), i32> {
    let rc = unsafe { kill(pid as i32, signal) };
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error().raw_os_error().unwrap_or(-1))
    }
}

/// Inspect the heartbeat and decide whether Bosun would restart the daemon.
fn inspect(config: &Config, now: u64) -> BosunStatus {
    let heartbeat_path = config.heartbeat_path.display().to_string();
    let heartbeat = match read_heartbeat(&config.heartbeat_path) {
        Ok(heartbeat) => heartbeat,
        Err(err) => {
            return BosunStatus {
                state: "missing".to_string(),
                reason: err.to_string(),
                action: "restart_daemon".to_string(),
                heartbeat_path,
                stale_after_ms: config.stale_after_ms,
                age_ms: None,
                pid: None,
                daemon_alive: None,
                canonical_pid: None,
                canonical_alive: None,
                would_restart: true,
                daemon_version: None,
                daemon_code_hash: None,
                daemon_uptime_ms: None,
                daemon_started_at: None,
                daemon_install_dir: None,
                daemon_pid_file: None,
                daemon_port_file: None,
                daemon_hostname: None,
            };
        }
    };

    let age_ms = now.saturating_sub(heartbeat.written_at);
    let canonical_pid = read_pid_file(&heartbeat.pid_file);
    let canonical_alive = canonical_pid.map(pid_is_alive);
    let heartbeat_alive = pid_is_alive(heartbeat.pid);

    if let Some(owner_pid) = canonical_pid {
        if owner_pid != heartbeat.pid {
            let owner_alive = canonical_alive.unwrap_or(false);
            return BosunStatus {
                state: "foreign".to_string(),
                reason: format!(
                    "heartbeat pid {} does not match canonical pid file owner {}",
                    heartbeat.pid, owner_pid
                ),
                action: if owner_alive {
                    "ignore_foreign_heartbeat".to_string()
                } else {
                    "kill_foreign_and_restart".to_string()
                },
                heartbeat_path,
                stale_after_ms: config.stale_after_ms,
                age_ms: Some(age_ms),
                pid: Some(heartbeat.pid),
                daemon_alive: Some(heartbeat_alive),
                canonical_pid,
                canonical_alive,
                would_restart: !owner_alive,
                daemon_version: Some(heartbeat.version),
                daemon_code_hash: Some(heartbeat.code_hash),
                daemon_uptime_ms: Some(heartbeat.uptime_ms),
                daemon_started_at: Some(heartbeat.started_at),
                daemon_install_dir: Some(heartbeat.install_dir),
                daemon_pid_file: Some(heartbeat.pid_file),
                daemon_port_file: Some(heartbeat.port_file),
                daemon_hostname: Some(heartbeat.hostname),
            };
        }
    }

    if !heartbeat_alive {
        return BosunStatus {
            state: "dead".to_string(),
            reason: format!("daemon pid {} is not alive", heartbeat.pid),
            action: "restart_daemon".to_string(),
            heartbeat_path,
            stale_after_ms: config.stale_after_ms,
            age_ms: Some(age_ms),
            pid: Some(heartbeat.pid),
            daemon_alive: Some(false),
            canonical_pid,
            canonical_alive,
            would_restart: true,
            daemon_version: Some(heartbeat.version),
            daemon_code_hash: Some(heartbeat.code_hash),
            daemon_uptime_ms: Some(heartbeat.uptime_ms),
            daemon_started_at: Some(heartbeat.started_at),
            daemon_install_dir: Some(heartbeat.install_dir),
            daemon_pid_file: Some(heartbeat.pid_file),
            daemon_port_file: Some(heartbeat.port_file),
            daemon_hostname: Some(heartbeat.hostname),
        };
    }

    if age_ms > config.stale_after_ms {
        return BosunStatus {
            state: "stale".to_string(),
            reason: format!("heartbeat age {}ms exceeds {}ms", age_ms, config.stale_after_ms),
            action: "restart_daemon".to_string(),
            heartbeat_path,
            stale_after_ms: config.stale_after_ms,
            age_ms: Some(age_ms),
            pid: Some(heartbeat.pid),
            daemon_alive: Some(true),
            canonical_pid,
            canonical_alive,
            would_restart: true,
            daemon_version: Some(heartbeat.version),
            daemon_code_hash: Some(heartbeat.code_hash),
            daemon_uptime_ms: Some(heartbeat.uptime_ms),
            daemon_started_at: Some(heartbeat.started_at),
            daemon_install_dir: Some(heartbeat.install_dir),
            daemon_pid_file: Some(heartbeat.pid_file),
            daemon_port_file: Some(heartbeat.port_file),
            daemon_hostname: Some(heartbeat.hostname),
        };
    }

    BosunStatus {
        state: "healthy".to_string(),
        reason: "daemon heartbeat is fresh".to_string(),
        action: "none".to_string(),
        heartbeat_path,
        stale_after_ms: config.stale_after_ms,
        age_ms: Some(age_ms),
        pid: Some(heartbeat.pid),
        daemon_alive: Some(true),
        canonical_pid,
        canonical_alive,
        would_restart: false,
        daemon_version: Some(heartbeat.version),
        daemon_code_hash: Some(heartbeat.code_hash),
        daemon_uptime_ms: Some(heartbeat.uptime_ms),
        daemon_started_at: Some(heartbeat.started_at),
        daemon_install_dir: Some(heartbeat.install_dir),
        daemon_pid_file: Some(heartbeat.pid_file),
        daemon_port_file: Some(heartbeat.port_file),
        daemon_hostname: Some(heartbeat.hostname),
    }
}

/// Kill the recorded daemon PID when it is still present.
#[cfg(unix)]
fn kill_daemon(pid: Option<u32>, dry_run: bool) -> Result<()> {
    let Some(pid) = pid else {
        return Ok(());
    };
    if dry_run {
        eprintln!("[pd-bosun] dry-run: would SIGKILL daemon pid {}", pid);
        return Ok(());
    }
    match send_signal(pid, SIGNAL_KILL) {
        Ok(()) => {
            eprintln!("[pd-bosun] SIGKILL sent to daemon pid {}", pid);
            Ok(())
        }
        Err(ESRCH) => {
            eprintln!("[pd-bosun] daemon pid {} is already gone", pid);
            Ok(())
        }
        Err(errno) => Err(Box::new(BosunError(format!(
            "failed to SIGKILL daemon pid {}: errno {}",
            pid, errno
        )))),
    }
}

/// Kill the recorded daemon PID when it is still present.
#[cfg(not(unix))]
fn kill_daemon(pid: Option<u32>, dry_run: bool) -> Result<()> {
    let Some(pid) = pid else {
        return Ok(());
    };
    if dry_run {
        eprintln!("[pd-bosun] dry-run: would SIGKILL daemon pid {}", pid);
        return Ok(());
    }
    let status = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status()
        .map_err(|err| BosunError(format!("failed to execute kill: {}", err)))?;
    if status.success() {
        eprintln!("[pd-bosun] SIGKILL sent to daemon pid {}", pid);
        Ok(())
    } else {
        Err(Box::new(BosunError(format!(
            "failed to SIGKILL daemon pid {}: kill exited with {}",
            pid, status
        ))))
    }
}

/// Ask launchd to restart the daemon service.
fn kickstart_daemon(label: &str, dry_run: bool) -> Result<()> {
    let service = format!("gui/{}/{}", current_uid(), label);
    if dry_run {
        eprintln!("[pd-bosun] dry-run: would launchctl kickstart -k {}", service);
        return Ok(());
    }
    let output = Command::new("launchctl")
        .args(["kickstart", "-k", &service])
        .output()
        .map_err(|err| BosunError(format!("failed to execute launchctl: {}", err)))?;
    if output.status.success() {
        eprintln!("[pd-bosun] launchctl kickstart -k {}", service);
        Ok(())
    } else {
        Err(Box::new(BosunError(format!(
            "launchctl kickstart failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))))
    }
}

/// Resolve the current numeric user id for launchd's `gui/<uid>/...` namespace.
fn current_uid() -> String {
    #[cfg(unix)]
    {
        return unsafe { getuid() }.to_string();
    }
    #[cfg(not(unix))]
    {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty())
        .or_else(|| env::var("UID").ok())
        .unwrap_or_else(|| "501".to_string())
    }
}

/// Enforce a stale/dead heartbeat decision.
fn enforce(config: &Config, status: &BosunStatus) -> Result<()> {
    if !status.would_restart {
        return Ok(());
    }
    eprintln!("[pd-bosun] {}: {}", status.state, status.reason);
    kill_daemon(status.pid, config.dry_run)?;
    kickstart_daemon(&config.daemon_label, config.dry_run)
}

// ─── Phase C: exponential backoff + loud give-up alert ─────────────────────
//
// Tracks Bosun's own restart-attempt history across `watch()` iterations. Pure
// data so the decision logic below is unit-testable without real time or a
// real filesystem/launchctl.
#[derive(Debug, Clone, Default)]
struct RestartState {
    /// Consecutive restart attempts made since the last healthy heartbeat.
    attempts_made: u32,
    /// When the most recent attempt fired (ms epoch), or None before the 1st.
    last_attempt_at: Option<u64>,
    /// True once `attempts_made` hit the cap and the alert file was written.
    alerted: bool,
}

/// How long to wait after the Nth attempt before the (N+1)th is allowed.
/// `attempts_made` is how many attempts have ALREADY fired. The 1st attempt
/// (attempts_made == 0) always fires immediately — matches the pre-Phase-C
/// behavior of reacting the moment staleness/death is detected.
fn backoff_wait_ms(attempts_made: u32) -> u64 {
    if attempts_made == 0 {
        return 0;
    }
    let idx = (attempts_made - 1) as usize;
    BACKOFF_SCHEDULE_MS[idx.min(BACKOFF_SCHEDULE_MS.len() - 1)]
}

/// True once enough time has passed since the last attempt (or there was no
/// prior attempt) for the next restart attempt to be allowed.
fn restart_is_due(state: &RestartState, now: u64) -> bool {
    match state.last_attempt_at {
        None => true,
        Some(prev) => now.saturating_sub(prev) >= backoff_wait_ms(state.attempts_made),
    }
}

/// True once the hard cap of consecutive attempts has been reached — Bosun
/// must stop trying and alert instead of hammering launchctl forever.
fn restart_cap_reached(attempts_made: u32, max_restart_attempts: u32) -> bool {
    attempts_made >= max_restart_attempts
}

/// Render the alert JSON payload by hand (no serde — Cargo.toml stays
/// zero-dependency per ADR-0036). Mirrors `status_to_json`'s style.
fn alert_to_json(status: &BosunStatus, attempts_made: u32, max_restart_attempts: u32, at: u64) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"schema\": \"{}\",\n",
            "  \"state\": \"{}\",\n",
            "  \"reason\": \"{}\",\n",
            "  \"attemptsMade\": {},\n",
            "  \"maxRestartAttempts\": {},\n",
            "  \"pid\": {},\n",
            "  \"daemonLabel\": null,\n",
            "  \"alertedAt\": {}\n",
            "}}"
        ),
        ALERT_SCHEMA,
        json_escape(&status.state),
        json_escape(&status.reason),
        attempts_made,
        max_restart_attempts,
        option_u32(status.pid),
        at,
    )
}

/// Write the durable "Bosun gave up" alert file. Best-effort: a write failure
/// is logged but never panics the watch loop — the loud eprintln! is itself a
/// signal (launchd captures it in pd-bosun-error.log).
///
/// UNLIKE `kill_daemon`/`kickstart_daemon`, this is NOT gated by
/// `config.dry_run`. Those two touch external systems (SIGKILL a real
/// process, ask launchd to restart a real service) and dry-run's whole
/// purpose is to make them inert for first-time operators and tests. The
/// alert file is the opposite: a small, harmless, purely-informational JSON
/// marker Bosun owns exclusively. Gating it on dry-run would mean a first-time
/// operator running `PORT_DADDY_BOSUN_DRY_RUN=1 pd-bosun watch` to observe
/// behavior would NEVER see the give-up signal even after 5 simulated
/// attempts — silently defeating the "never silent" mandate this file exists
/// to satisfy. It also gives the alert-file-exists check a real, inspectable
/// signal in both modes (see `run_watch_tick`'s "operator cleared the alert"
/// resume path), rather than one that behaves differently under dry-run.
fn write_alert_file(config: &Config, status: &BosunStatus, attempts_made: u32, at: u64) {
    let body = alert_to_json(status, attempts_made, config.max_restart_attempts, at);
    if let Some(parent) = config.alert_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&config.alert_path, body) {
        Ok(()) => eprintln!(
            "[pd-bosun] ALERT: {} consecutive restart attempts failed; wrote {} and giving up until the daemon recovers or the operator intervenes",
            attempts_made,
            config.alert_path.display()
        ),
        Err(err) => eprintln!(
            "[pd-bosun] ALERT (unwritten — {}): {} consecutive restart attempts failed for daemon pid {:?}",
            err, attempts_made, status.pid
        ),
    }
}

/// Clear a previously-written alert file once the daemon self-heals or a
/// fresh restart cycle succeeds. Best-effort. Not dry-run-gated — see
/// `write_alert_file`'s doc comment.
fn clear_alert_file(config: &Config) {
    let _ = fs::remove_file(&config.alert_path);
}

/// Best-effort operator notification. macOS: a Notification Center banner via
/// `osascript` (a system binary shell-out, same category as the existing
/// `launchctl`/`kill` calls — no new Cargo dependency). Any other platform, or
/// a failed osascript call, degrades to the already-loud eprintln! the caller
/// prints regardless; a missing notification must never fail the watch loop.
fn notify_operator(message: &str, dry_run: bool) {
    if dry_run {
        eprintln!("[pd-bosun] dry-run: would notify operator: {}", message);
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display notification {} with title \"Port Daddy\" subtitle \"Bosun\"",
            osascript_quote(message)
        );
        let _ = Command::new("osascript").args(["-e", &script]).output();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = message; // the eprintln! at the call site is the notification here
    }
}

/// Quote a string as an AppleScript string literal for `notify_operator`.
#[cfg(target_os = "macos")]
fn osascript_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Print a single JSON status object and exit.
fn print_status(config: &Config) -> Result<()> {
    let status = inspect(config, now_ms());
    println!("{}", status_to_json(&status));
    Ok(())
}

/// Run the long-lived watchdog loop.
///
/// Phase C (ADR-0036): a bare "detect stale -> kill -> kickstart every tick"
/// loop hammers launchctl every `interval_ms` (default 5s) for as long as the
/// daemon stays down, and never tells the operator it has been trying and
/// failing. This loop adds: exponential backoff between attempts, a hard cap
/// of consecutive failed attempts, and a loud, durable give-up signal (alert
/// file + best-effort OS notification) once the cap is hit — RED-TEAM per the
/// 2026-07-14 halt-mandate: Bosun must never spin silently forever, and must
/// never spam a wedged system with restart attempts closer together than the
/// backoff schedule allows.
fn watch(config: Config) -> Result<()> {
    eprintln!(
        "[pd-bosun] watching {} every {}ms; stale after {}ms; max {} restart attempts",
        config.heartbeat_path.display(),
        config.interval_ms,
        config.stale_after_ms,
        config.max_restart_attempts,
    );
    let mut state = RestartState::default();
    loop {
        let now = now_ms();
        let status = inspect(&config, now);
        run_watch_tick(&config, &mut state, &status, now);
        thread::sleep(Duration::from_millis(config.interval_ms));
    }
}

/// One iteration of the watch loop's decision + side effects. Split out from
/// `watch()` so tests can drive the state machine deterministically (no real
/// sleeping, no real launchctl) by calling this directly with a synthetic
/// clock and status.
fn run_watch_tick(config: &Config, state: &mut RestartState, status: &BosunStatus, now: u64) {
    if !status.would_restart {
        // Healthy (or foreign-and-ignored) heartbeat: the daemon has either
        // never been down this cycle, or it just recovered. Reset the backoff
        // state and clear any alert so a future stall starts a fresh 5-strike
        // count rather than inheriting a prior outage's exhausted attempts.
        if state.attempts_made > 0 || state.alerted {
            eprintln!("[pd-bosun] daemon heartbeat recovered; resetting restart backoff");
            if state.alerted {
                clear_alert_file(config);
            }
        }
        *state = RestartState::default();
        return;
    }

    if state.alerted {
        // Already gave up. Do not hammer launchctl further; the operator (or
        // the daemon self-healing without our help) is now in control. If the
        // operator deletes the alert file — acknowledging it and asking Bosun
        // to try again — resume from a clean slate on the NEXT tick.
        if !config.alert_path.exists() {
            eprintln!("[pd-bosun] alert file cleared; resuming restart attempts");
            *state = RestartState::default();
        } else {
            return;
        }
    }

    if !restart_is_due(state, now) {
        // Still inside the current backoff window; wait for a later tick.
        return;
    }

    eprintln!(
        "[pd-bosun] {}: {} (restart attempt {}/{})",
        status.state,
        status.reason,
        state.attempts_made + 1,
        config.max_restart_attempts
    );
    if let Err(err) = enforce(config, status) {
        eprintln!("[pd-bosun] enforcement failed: {}", err);
    }
    state.attempts_made += 1;
    state.last_attempt_at = Some(now);

    if restart_cap_reached(state.attempts_made, config.max_restart_attempts) {
        write_alert_file(config, status, state.attempts_made, now);
        notify_operator(
            &format!(
                "Daemon failed to recover after {} restart attempts ({}). See {}",
                state.attempts_made,
                status.reason,
                config.alert_path.display()
            ),
            config.dry_run,
        );
        state.alerted = true;
    }
}

/// Dispatch `pd-bosun status` or `pd-bosun watch`.
fn main() -> Result<()> {
    let config = config_from_env();
    match env::args().nth(1).as_deref() {
        Some("status") => print_status(&config),
        Some("watch") | None => watch(config),
        Some(flag) => Err(Box::new(BosunError(format!(
            "unknown command '{}'; expected 'status' or 'watch'",
            flag
        )))),
    }
}

/// Render a status object as JSON without adding serializer dependencies.
fn status_to_json(status: &BosunStatus) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"state\": \"{}\",\n",
            "  \"reason\": \"{}\",\n",
            "  \"action\": \"{}\",\n",
            "  \"heartbeatPath\": \"{}\",\n",
            "  \"staleAfterMs\": {},\n",
            "  \"ageMs\": {},\n",
            "  \"pid\": {},\n",
            "  \"daemonAlive\": {},\n",
            "  \"canonicalPid\": {},\n",
            "  \"canonicalAlive\": {},\n",
            "  \"wouldRestart\": {},\n",
            "  \"daemonVersion\": {},\n",
            "  \"daemonCodeHash\": {},\n",
            "  \"daemonUptimeMs\": {},\n",
            "  \"daemonStartedAt\": {},\n",
            "  \"daemonInstallDir\": {},\n",
            "  \"daemonPidFile\": {},\n",
            "  \"daemonPortFile\": {},\n",
            "  \"daemonHostname\": {}\n",
            "}}"
        ),
        json_escape(&status.state),
        json_escape(&status.reason),
        json_escape(&status.action),
        json_escape(&status.heartbeat_path),
        status.stale_after_ms,
        option_u64(status.age_ms),
        option_u32(status.pid),
        option_bool(status.daemon_alive),
        option_u32(status.canonical_pid),
        option_bool(status.canonical_alive),
        status.would_restart,
        option_string(status.daemon_version.as_deref()),
        option_string(status.daemon_code_hash.as_deref()),
        option_u64(status.daemon_uptime_ms),
        option_u64(status.daemon_started_at),
        option_string(status.daemon_install_dir.as_deref()),
        option_string(status.daemon_pid_file.as_deref()),
        option_string(status.daemon_port_file.as_deref()),
        option_string(status.daemon_hostname.as_deref())
    )
}

/// Escape enough JSON string syntax for status fields that come from paths/errors.
fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

/// Render an optional u64 for JSON output.
fn option_u64(value: Option<u64>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "null".to_string())
}

/// Render an optional u32 for JSON output.
fn option_u32(value: Option<u32>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "null".to_string())
}

/// Render an optional bool for JSON output.
fn option_bool(value: Option<bool>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "null".to_string())
}

/// Render an optional string for JSON output.
fn option_string(value: Option<&str>) -> String {
    value
        .map(|v| format!("\"{}\"", json_escape(v)))
        .unwrap_or_else(|| "null".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::write;

    /// Build a minimal heartbeat fixture for status tests.
    fn heartbeat_json(pid: u32, written_at: u64) -> String {
        heartbeat_json_with_pid_file(pid, written_at, "/runtime/daemon.pid")
    }

    /// Build a heartbeat fixture whose `pidFile` points at a chosen path.
    fn heartbeat_json_with_pid_file(pid: u32, written_at: u64, pid_file: &str) -> String {
        format!(
            "{{\"schema\":\"{}\",\"pid\":{},\"writtenAt\":{},\"uptimeMs\":5000,\"version\":\"test\",\"codeHash\":\"hash\",\"startedAt\":1000,\"installDir\":\"/repo\",\"pidFile\":\"{}\",\"portFile\":\"/runtime/daemon.port\",\"hostname\":\"host\"}}",
            HEARTBEAT_SCHEMA,
            pid,
            written_at,
            json_escape(pid_file)
        )
    }

    /// Build a test config rooted at a temporary heartbeat file.
    fn test_config(path: PathBuf) -> Config {
        let alert_path = env::temp_dir().join(format!("bosun-alert-{}-{}.json", std::process::id(), rand_suffix()));
        Config {
            heartbeat_path: path,
            interval_ms: 5_000,
            stale_after_ms: 30_000,
            daemon_label: DEFAULT_DAEMON_LABEL.to_string(),
            dry_run: true,
            alert_path,
            max_restart_attempts: DEFAULT_MAX_RESTART_ATTEMPTS,
        }
    }

    /// Cheap per-call uniqueness for parallel test file names (no rand crate;
    /// ADR-0036 keeps Cargo.toml dependency-free).
    fn rand_suffix() -> u128 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
    }

    #[test]
    fn missing_heartbeat_would_restart() {
        let path = env::temp_dir().join(format!("missing-heartbeat-{}.json", std::process::id()));
        let status = inspect(&test_config(path), 100_000);

        assert_eq!(status.state, "missing");
        assert!(status.would_restart);
        assert_eq!(status.pid, None);
    }

    #[test]
    fn stale_heartbeat_would_restart_live_pid() {
        let path = env::temp_dir().join(format!("stale-heartbeat-{}.json", std::process::id()));
        write(&path, heartbeat_json(std::process::id(), 1_000)).unwrap();

        let status = inspect(&test_config(path.clone()), 40_001);

        assert_eq!(status.state, "stale");
        assert!(status.would_restart);
        assert_eq!(status.daemon_alive, Some(true));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn fresh_heartbeat_is_healthy() {
        let path = env::temp_dir().join(format!("fresh-heartbeat-{}.json", std::process::id()));
        write(&path, heartbeat_json(std::process::id(), 20_000)).unwrap();

        let status = inspect(&test_config(path.clone()), 25_000);

        assert_eq!(status.state, "healthy");
        assert!(!status.would_restart);
        assert_eq!(status.daemon_alive, Some(true));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn foreign_heartbeat_is_ignored_when_canonical_pid_is_alive() {
        let suffix = std::process::id();
        let heartbeat_path = env::temp_dir().join(format!("foreign-heartbeat-{}.json", suffix));
        let pid_path = env::temp_dir().join(format!("foreign-heartbeat-{}.pid", suffix));
        let pid_path_text = pid_path.display().to_string();
        write(&pid_path, std::process::id().to_string()).unwrap();
        write(&heartbeat_path, heartbeat_json_with_pid_file(999_999, 20_000, &pid_path_text)).unwrap();

        let status = inspect(&test_config(heartbeat_path.clone()), 25_000);

        assert_eq!(status.state, "foreign");
        assert_eq!(status.action, "ignore_foreign_heartbeat");
        assert!(!status.would_restart);
        assert_eq!(status.canonical_pid, Some(std::process::id()));
        assert_eq!(status.canonical_alive, Some(true));
        let _ = fs::remove_file(heartbeat_path);
        let _ = fs::remove_file(pid_path);
    }

    #[test]
    fn kill_probe_treats_permission_denied_as_alive() {
        assert!(kill_probe_means_alive(true, b""));
        assert!(kill_probe_means_alive(false, b"kill: 41856: Operation not permitted"));
        assert!(kill_probe_means_alive(false, b"Permission denied"));
        assert!(!kill_probe_means_alive(false, b"kill: 41856: No such process"));
    }

    #[test]
    fn status_json_includes_supervisor_decision() {
        let status = BosunStatus {
            state: "healthy".to_string(),
            reason: "daemon heartbeat is fresh".to_string(),
            action: "none".to_string(),
            heartbeat_path: "/tmp/heartbeat".to_string(),
            stale_after_ms: 30_000,
            age_ms: Some(100),
            pid: Some(123),
            daemon_alive: Some(true),
            canonical_pid: Some(123),
            canonical_alive: Some(true),
            would_restart: false,
            daemon_version: Some("3.9.0".to_string()),
            daemon_code_hash: Some("hash".to_string()),
            daemon_uptime_ms: Some(5_000),
            daemon_started_at: Some(1_000),
            daemon_install_dir: Some("/repo".to_string()),
            daemon_pid_file: Some("/runtime/daemon.pid".to_string()),
            daemon_port_file: Some("/runtime/daemon.port".to_string()),
            daemon_hostname: Some("host".to_string()),
        };

        let json = status_to_json(&status);

        assert!(json.contains("\"state\": \"healthy\""));
        assert!(json.contains("\"action\": \"none\""));
        assert!(json.contains("\"wouldRestart\": false"));
        assert!(json.contains("\"canonicalPid\": 123"));
        assert!(json.contains("\"daemonVersion\": \"3.9.0\""));
    }

    // ─── Phase C: exponential backoff + hard-cap alert (2026-07-14 halt-mandate) ─

    /// Build a minimal "dead daemon" status for run_watch_tick tests. Only the
    /// fields the backoff/alert logic reads (`would_restart`, `state`,
    /// `reason`, `pid`) matter for these tests.
    fn dead_status() -> BosunStatus {
        BosunStatus {
            state: "dead".to_string(),
            reason: "daemon pid 999999 is not alive".to_string(),
            action: "restart_daemon".to_string(),
            heartbeat_path: "/tmp/heartbeat".to_string(),
            stale_after_ms: 30_000,
            age_ms: Some(1_000),
            pid: Some(999_999), // never a real pid; kill_daemon(dry_run) never signals it for real
            daemon_alive: Some(false),
            canonical_pid: None,
            canonical_alive: None,
            would_restart: true,
            daemon_version: None,
            daemon_code_hash: None,
            daemon_uptime_ms: None,
            daemon_started_at: None,
            daemon_install_dir: None,
            daemon_pid_file: None,
            daemon_port_file: None,
            daemon_hostname: None,
        }
    }

    fn healthy_status() -> BosunStatus {
        BosunStatus { would_restart: false, state: "healthy".to_string(), ..dead_status() }
    }

    #[test]
    fn backoff_schedule_is_immediate_then_30_60_120_300_capped() {
        assert_eq!(backoff_wait_ms(0), 0); // 1st attempt: immediate
        assert_eq!(backoff_wait_ms(1), 30_000);
        assert_eq!(backoff_wait_ms(2), 60_000);
        assert_eq!(backoff_wait_ms(3), 120_000);
        assert_eq!(backoff_wait_ms(4), 300_000);
        assert_eq!(backoff_wait_ms(10), 300_000); // beyond the schedule: capped, never grows unbounded
    }

    #[test]
    fn restart_cap_reached_at_configured_threshold() {
        assert!(!restart_cap_reached(4, 5));
        assert!(restart_cap_reached(5, 5));
        assert!(restart_cap_reached(6, 5));
    }

    #[test]
    fn first_attempt_fires_immediately_on_detection() {
        let config = test_config(env::temp_dir().join(format!("wt-first-{}.json", rand_suffix())));
        let mut state = RestartState::default();
        run_watch_tick(&config, &mut state, &dead_status(), 1_000_000);
        assert_eq!(state.attempts_made, 1);
        assert_eq!(state.last_attempt_at, Some(1_000_000));
        assert!(!state.alerted);
    }

    #[test]
    fn second_attempt_is_suppressed_before_the_30s_backoff_elapses() {
        let config = test_config(env::temp_dir().join(format!("wt-backoff-{}.json", rand_suffix())));
        let mut state = RestartState::default();
        run_watch_tick(&config, &mut state, &dead_status(), 0);
        assert_eq!(state.attempts_made, 1);

        // Only 5s later (one bosun tick) — well inside the 30s backoff window.
        run_watch_tick(&config, &mut state, &dead_status(), 5_000);
        assert_eq!(state.attempts_made, 1, "must not hammer launchctl inside the backoff window");

        // 30s later: the 2nd attempt is now due.
        run_watch_tick(&config, &mut state, &dead_status(), 30_000);
        assert_eq!(state.attempts_made, 2);
    }

    #[test]
    fn hard_cap_writes_alert_file_and_stops_trying() {
        let alert_path = env::temp_dir().join(format!("bosun-alert-cap-{}.json", rand_suffix()));
        let config = Config {
            max_restart_attempts: 3,
            alert_path: alert_path.clone(),
            ..test_config(env::temp_dir().join(format!("wt-cap-{}.json", rand_suffix())))
        };
        let mut state = RestartState::default();

        // Drive attempts far enough apart that backoff never suppresses them.
        run_watch_tick(&config, &mut state, &dead_status(), 0);
        assert_eq!(state.attempts_made, 1);
        assert!(!alert_path.exists());

        run_watch_tick(&config, &mut state, &dead_status(), 1_000_000);
        assert_eq!(state.attempts_made, 2);
        assert!(!alert_path.exists());

        run_watch_tick(&config, &mut state, &dead_status(), 2_000_000);
        assert_eq!(state.attempts_made, 3);
        assert!(state.alerted, "the 3rd attempt hits the configured cap of 3");
        assert!(alert_path.exists(), "hitting the cap must write the durable alert file");

        let body = fs::read_to_string(&alert_path).unwrap();
        assert!(body.contains(ALERT_SCHEMA));
        assert!(body.contains("\"attemptsMade\": 3"));

        // Further ticks while still dead must NOT re-attempt (no hammering
        // launchctl after giving up) and must NOT rewrite the alert file.
        let alert_mtime_before = fs::metadata(&alert_path).unwrap().modified().unwrap();
        run_watch_tick(&config, &mut state, &dead_status(), 3_000_000);
        assert_eq!(state.attempts_made, 3, "no further attempts once alerted");
        let alert_mtime_after = fs::metadata(&alert_path).unwrap().modified().unwrap();
        assert_eq!(alert_mtime_before, alert_mtime_after);

        let _ = fs::remove_file(&alert_path);
    }

    #[test]
    fn recovery_resets_backoff_and_clears_the_alert_file() {
        let alert_path = env::temp_dir().join(format!("bosun-alert-recover-{}.json", rand_suffix()));
        let config = Config {
            max_restart_attempts: 1,
            alert_path: alert_path.clone(),
            ..test_config(env::temp_dir().join(format!("wt-recover-{}.json", rand_suffix())))
        };
        let mut state = RestartState::default();

        run_watch_tick(&config, &mut state, &dead_status(), 0);
        assert!(state.alerted);
        assert!(alert_path.exists());

        // Heartbeat recovers on its own (or the restart worked) — the very next
        // healthy tick must reset attempts AND clear the alert file.
        run_watch_tick(&config, &mut state, &healthy_status(), 100);
        assert_eq!(state.attempts_made, 0);
        assert!(!state.alerted);
        assert!(!alert_path.exists(), "recovery must clear a stale alert");

        // A FRESH stall after recovery starts a clean attempt count, not one
        // inherited from the prior (already-exhausted) outage.
        run_watch_tick(&config, &mut state, &dead_status(), 200);
        assert_eq!(state.attempts_made, 1);
    }

    #[test]
    fn operator_deleting_the_alert_file_resumes_attempts() {
        let alert_path = env::temp_dir().join(format!("bosun-alert-manual-clear-{}.json", rand_suffix()));
        let config = Config {
            max_restart_attempts: 1,
            alert_path: alert_path.clone(),
            ..test_config(env::temp_dir().join(format!("wt-manual-{}.json", rand_suffix())))
        };
        let mut state = RestartState::default();

        run_watch_tick(&config, &mut state, &dead_status(), 0);
        assert!(state.alerted);
        assert!(alert_path.exists());

        // Daemon is STILL dead, but the operator manually removed the alert
        // file (acknowledging it) — Bosun must resume trying, not stay silent.
        fs::remove_file(&alert_path).unwrap();
        run_watch_tick(&config, &mut state, &dead_status(), 999_999_999);
        assert!(!state.alerted || alert_path.exists(), "either it resumed and re-alerted, or is mid-backoff");
        // Concretely: attempts_made was reset to 0 then incremented to 1 by the
        // same tick that noticed the cleared alert file.
        assert_eq!(state.attempts_made, 1);
    }
}
