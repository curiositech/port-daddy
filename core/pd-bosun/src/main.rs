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
        .unwrap_or_else(|_| PathBuf::from(home).join(".port-daddy").join("heartbeat"));
    let interval_ms = parse_env_u64("PORT_DADDY_BOSUN_INTERVAL_MS", DEFAULT_INTERVAL_MS);
    let stale_after_ms = parse_env_u64("PORT_DADDY_BOSUN_STALE_MS", DEFAULT_STALE_AFTER_MS);
    let daemon_label = env::var("PORT_DADDY_BOSUN_DAEMON_LABEL")
        .unwrap_or_else(|_| DEFAULT_DAEMON_LABEL.to_string());
    let dry_run = env_truthy("PORT_DADDY_BOSUN_DRY_RUN");

    Config {
        heartbeat_path,
        interval_ms,
        stale_after_ms,
        daemon_label,
        dry_run,
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

/// Print a single JSON status object and exit.
fn print_status(config: &Config) -> Result<()> {
    let status = inspect(config, now_ms());
    println!("{}", status_to_json(&status));
    Ok(())
}

/// Run the long-lived watchdog loop.
fn watch(config: Config) -> Result<()> {
    eprintln!(
        "[pd-bosun] watching {} every {}ms; stale after {}ms",
        config.heartbeat_path.display(),
        config.interval_ms,
        config.stale_after_ms
    );
    loop {
        let status = inspect(&config, now_ms());
        if let Err(err) = enforce(&config, &status) {
            eprintln!("[pd-bosun] enforcement failed: {}", err);
        }
        thread::sleep(Duration::from_millis(config.interval_ms));
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
        Config {
            heartbeat_path: path,
            interval_ms: 5_000,
            stale_after_ms: 30_000,
            daemon_label: DEFAULT_DAEMON_LABEL.to_string(),
            dry_run: true,
        }
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
}
