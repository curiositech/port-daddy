//! Console scripting control plane.
//!
//! A unix-socket, newline-JSON command surface so agents and shell scripts can
//! drive a running pd-console instead of screenshot-and-pray: discover semantic
//! surfaces and controls, act on shared UI models, tune the Sextant query, rebind the
//! daemon, and read the HITL alert log.
//!
//! Enable with `--control-sock <path>` or `PD_CONSOLE_CONTROL_SOCK=<path>`.
//! Protocol: one JSON object per line in, one JSON object per line out.
//!
//!   {"cmd":"ping","protocolVersion":1}
//!   {"cmd":"describe","protocolVersion":1}
//!   {"cmd":"context","protocolVersion":1}
//!   {"cmd":"sextant","protocolVersion":1,"windowHours":720,"minTokens":64}
//!   {"cmd":"work","protocolVersion":1,"goal":"Take the next roadmap slice"}
//!   {"cmd":"stop","protocolVersion":1}
//!   {"cmd":"chat","protocolVersion":1,"text":"Are you attached live?"}
//!   {"cmd":"rebind","protocolVersion":1,"url":"http://127.0.0.1:9899"}
//!   {"cmd":"alerts","protocolVersion":1}
//!
//! Transport lives on a plain std thread (UnixListener). Each request is
//! forwarded to the GPUI foreground through an mpsc envelope carrying its own
//! reply channel; the 500ms foreground drain task answers with full access to
//! `ConsoleView`. A request that gets no reply within 5s returns a timeout
//! error to the caller instead of hanging the socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use serde_json::{json, Value};

use crate::pane::Alert;

unsafe extern "C" {
    fn geteuid() -> u32;
}

fn current_euid() -> u32 {
    // POSIX geteuid has no failure mode and does not inspect ambient environment.
    unsafe { geteuid() }
}

pub const PROTOCOL_NAME: &str = "pd-console-control";
pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_REQUEST_LINE_BYTES: usize = 64 * 1024;
pub const MAX_STRING_BYTES: usize = 16 * 1024;
pub const MAX_DELTA: i32 = 4_096;
pub const MAX_CONNECTIONS: usize = 8;
pub const MAX_REQUESTS_PER_CONNECTION: usize = 128;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssertOp {
    Eq,
    Ne,
    Contains,
    Exists,
    Gte,
    Lte,
}

/// A parsed scripting request. Kept data-only so parsing is unit-testable
/// without a socket or a window.
#[derive(Debug, Clone, PartialEq)]
pub enum ScriptRequest {
    Describe,
    Context,
    Type {
        target: String,
        text: String,
        append: bool,
    },
    Click {
        target: String,
    },
    Drag {
        target: String,
        delta: i32,
    },
    Scroll {
        target: String,
        delta: i32,
    },
    Assert {
        path: String,
        op: AssertOp,
        expected: Option<Value>,
    },
    Ping,
    Galaxy {
        window_hours: Option<u32>,
        min_tokens: Option<u32>,
        cluster: Option<bool>,
    },
    Chat {
        text: String,
    },
    Work {
        goal: String,
    },
    StopMission,
    Rebind {
        url: String,
    },
    Alerts,
}

impl ScriptRequest {
    pub fn command_name(&self) -> &'static str {
        match self {
            Self::Describe => "describe",
            Self::Context => "context",
            Self::Type { .. } => "type",
            Self::Click { .. } => "click",
            Self::Drag { .. } => "drag",
            Self::Scroll { .. } => "scroll",
            Self::Assert { .. } => "assert",
            Self::Ping => "ping",
            Self::Galaxy { .. } => "sextant",
            Self::Chat { .. } => "chat",
            Self::Work { .. } => "work",
            Self::StopMission => "stop",
            Self::Rebind { .. } => "rebind",
            Self::Alerts => "alerts",
        }
    }
}

/// One in-flight request: the parsed command plus the transport's reply slot.
pub struct ScriptEnvelope {
    pub request: ScriptRequest,
    pub reply: mpsc::Sender<Value>,
}

/// Parse one wire line into a request. Errors are returned as strings so the
/// transport can ship them back verbatim — the caller sees WHY it was refused.
pub fn parse_request(line: &str) -> Result<ScriptRequest, String> {
    let v: Value = serde_json::from_str(line.trim()).map_err(|e| format!("bad json: {e}"))?;
    let cmd = v
        .get("cmd")
        .and_then(Value::as_str)
        .ok_or_else(|| "missing \"cmd\"".to_string())?;
    if v.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION as u64) {
        return Err(format!("protocolVersion must be {PROTOCOL_VERSION}"));
    }
    validate_fields(&v, cmd)?;
    match cmd {
        "describe" => Ok(ScriptRequest::Describe),
        "context" => Ok(ScriptRequest::Context),
        "type" => {
            let target = bounded_string(&v, "target", false)?;
            let text = bounded_string(&v, "text", true)?;
            let append = match v.get("mode").and_then(Value::as_str).unwrap_or("replace") {
                "replace" => false,
                "append" => true,
                _ => return Err("mode must be \"replace\" or \"append\"".to_string()),
            };
            Ok(ScriptRequest::Type {
                target,
                text,
                append,
            })
        }
        "click" => Ok(ScriptRequest::Click {
            target: bounded_string(&v, "target", false)?,
        }),
        "drag" => Ok(ScriptRequest::Drag {
            target: bounded_string(&v, "target", false)?,
            delta: bounded_delta(&v)?,
        }),
        "scroll" => Ok(ScriptRequest::Scroll {
            target: bounded_string(&v, "target", false)?,
            delta: bounded_delta(&v)?,
        }),
        "assert" => {
            let path = bounded_string(&v, "path", false)?;
            let op = match v.get("op").and_then(Value::as_str).unwrap_or("eq") {
                "eq" => AssertOp::Eq,
                "ne" => AssertOp::Ne,
                "contains" => AssertOp::Contains,
                "exists" => AssertOp::Exists,
                "gte" => AssertOp::Gte,
                "lte" => AssertOp::Lte,
                _ => return Err("assert op must be eq/ne/contains/exists/gte/lte".to_string()),
            };
            let expected = v.get("value").cloned();
            if op != AssertOp::Exists && expected.is_none() {
                return Err("assert needs \"value\" unless op=exists".to_string());
            }
            if expected.as_ref().is_some_and(value_is_too_large) {
                return Err(format!("assert value exceeds {MAX_STRING_BYTES} bytes"));
            }
            Ok(ScriptRequest::Assert { path, op, expected })
        }
        "ping" => Ok(ScriptRequest::Ping),
        "galaxy" => Err("Galaxy was renamed to Sextant; use cmd=sextant.".to_string()),
        "chat" => {
            let text = bounded_string(&v, "text", false).map_err(|error| {
                error.replace("text must not be empty", "chat needs non-empty \"text\"")
            })?;
            Ok(ScriptRequest::Chat { text })
        }
        "work" => {
            let goal = bounded_string(&v, "goal", false).map_err(|error| {
                error.replace("goal must not be empty", "work needs non-empty \"goal\"")
            })?;
            Ok(ScriptRequest::Work { goal })
        }
        "stop" => Ok(ScriptRequest::StopMission),
        "sextant" => {
            let window_hours = optional_positive_u32(&v, "windowHours")?;
            let min_tokens = optional_positive_u32(&v, "minTokens")?;
            let cluster = match v.get("cluster") {
                Some(value) => Some(
                    value
                        .as_bool()
                        .ok_or_else(|| "cluster must be a boolean".to_string())?,
                ),
                None => None,
            };
            if window_hours.is_none() && min_tokens.is_none() && cluster.is_none() {
                return Err("sextant needs windowHours, minTokens, and/or cluster".to_string());
            }
            Ok(ScriptRequest::Galaxy {
                window_hours,
                min_tokens,
                cluster,
            })
        }
        "rebind" => {
            let url = bounded_string(&v, "url", false)
                .map_err(|error| error.replace("url must not be empty", "rebind needs \"url\""))?;
            Ok(ScriptRequest::Rebind { url })
        }
        "alerts" => Ok(ScriptRequest::Alerts),
        other => Err(format!("unknown cmd \"{other}\" (start with describe)")),
    }
}

fn validate_fields(value: &Value, cmd: &str) -> Result<(), String> {
    let common = ["cmd", "protocolVersion"];
    let command = match cmd {
        "describe" | "context" | "ping" | "stop" | "alerts" => &[][..],
        "type" => &["target", "text", "mode"][..],
        "click" => &["target"][..],
        "drag" | "scroll" => &["target", "delta"][..],
        "assert" => &["path", "op", "value"][..],
        "galaxy" | "sextant" => &["windowHours", "minTokens", "cluster"][..],
        "chat" => &["text"][..],
        "work" => &["goal"][..],
        "rebind" => &["url"][..],
        _ => return Ok(()),
    };
    let Some(object) = value.as_object() else {
        return Err("request must be a JSON object".into());
    };
    if let Some(unknown) = object
        .keys()
        .find(|field| !common.contains(&field.as_str()) && !command.contains(&field.as_str()))
    {
        return Err(format!("unknown field \"{unknown}\" for cmd={cmd}"));
    }
    Ok(())
}

fn bounded_delta(v: &Value) -> Result<i32, String> {
    let delta = v
        .get("delta")
        .and_then(Value::as_i64)
        .ok_or_else(|| "delta must be an integer".to_string())?;
    if delta.unsigned_abs() > MAX_DELTA as u64 {
        return Err(format!(
            "delta must be between -{MAX_DELTA} and {MAX_DELTA}"
        ));
    }
    Ok(delta as i32)
}

fn bounded_string(v: &Value, field: &str, allow_empty: bool) -> Result<String, String> {
    let value = v
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing \"{field}\""))?;
    if !allow_empty && value.trim().is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.len() > MAX_STRING_BYTES {
        return Err(format!("{field} exceeds {MAX_STRING_BYTES} bytes"));
    }
    Ok(if allow_empty {
        value.to_string()
    } else {
        value.trim().to_string()
    })
}

fn value_is_too_large(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|value| value.len() > MAX_STRING_BYTES)
}

pub fn wire_response(command: &str, response: Value) -> Value {
    let ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let mut out = json!({
        "protocol": {"name": PROTOCOL_NAME, "version": PROTOCOL_VERSION},
        "command": command,
        "ok": ok,
    });
    if ok {
        let mut result = response;
        result.as_object_mut().map(|object| object.remove("ok"));
        out["result"] = result;
    } else {
        let error = response
            .get("error")
            .cloned()
            .unwrap_or_else(|| Value::String("request failed".into()));
        out["error"] = if error.is_object() {
            error
        } else {
            json!({"code": "request_failed", "message": error})
        };
    }
    out
}

fn error_response(command: &str, code: &str, message: impl Into<String>) -> Value {
    json!({
        "protocol": {"name": PROTOCOL_NAME, "version": PROTOCOL_VERSION},
        "command": command,
        "ok": false,
        "error": {"code": code, "message": message.into()},
    })
}

pub fn prepare_socket_path(sock_path: &Path) -> Result<(), String> {
    if !sock_path.is_absolute() {
        return Err("control socket path must be absolute".into());
    }
    let parent = sock_path
        .parent()
        .ok_or("control socket needs an explicit parent")?;
    let parent_meta = std::fs::symlink_metadata(parent)
        .map_err(|error| format!("control socket parent is unavailable: {error}"))?;
    if parent_meta.file_type().is_symlink() || !parent_meta.is_dir() {
        return Err("control socket parent must be a real directory, not a symlink".into());
    }
    if parent_meta.uid() != current_euid() {
        return Err("control socket parent must be owned by the current user".into());
    }
    if parent_meta.permissions().mode() & 0o022 != 0 {
        return Err("control socket parent must not be group/world writable".into());
    }
    match std::fs::symlink_metadata(sock_path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err("refusing symlink at control socket path".into())
        }
        Ok(meta) if !meta.file_type().is_socket() => {
            Err("refusing non-socket stale target at control socket path".into())
        }
        Ok(meta) if meta.uid() != current_euid() => {
            Err("refusing control socket owned by another user".into())
        }
        Ok(_) => match UnixStream::connect(sock_path) {
            Ok(_) => Err("refusing to replace a live control socket".into()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                ) =>
            {
                std::fs::remove_file(sock_path)
                    .map_err(|error| format!("could not remove stale control socket: {error}"))
            }
            Err(error) => Err(format!("could not prove control socket stale: {error}")),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not inspect control socket path: {error}")),
    }
}

fn optional_positive_u32(v: &Value, field: &str) -> Result<Option<u32>, String> {
    let Some(raw) = v.get(field) else {
        return Ok(None);
    };
    let Some(n) = raw.as_u64() else {
        return Err(format!("{field} must be a positive integer"));
    };
    if n == 0 {
        return Err(format!("{field} must be greater than 0"));
    }
    if n > u32::MAX as u64 {
        return Err(format!("{field} must fit in u32"));
    }
    Ok(Some(n as u32))
}

pub fn alert_to_json(alert: &Alert) -> Value {
    json!({
        "level": alert.level.label(),
        "title": alert.title,
        "detail": alert.detail,
        "ts": alert.ts,
    })
}

/// Start the socket server thread. Returns immediately; the thread owns the
/// listener for the life of the process. A stale socket file from a previous
/// run is removed first (unix sockets don't self-clean).
pub fn start_server(sock_path: String, tx: mpsc::Sender<ScriptEnvelope>) {
    std::thread::spawn(move || {
        if let Err(error) = prepare_socket_path(Path::new(&sock_path)) {
            eprintln!("pd-console: control socket refused at {sock_path}: {error}");
            return;
        }
        let listener = match UnixListener::bind(&sock_path) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("pd-console: control socket bind failed at {sock_path}: {e}");
                return;
            }
        };
        if let Err(e) = std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600))
        {
            eprintln!("pd-console: control socket chmod failed at {sock_path}: {e}");
            return;
        }
        eprintln!("pd-console: control socket listening at {sock_path}");
        let active_connections = Arc::new(AtomicUsize::new(0));
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
            let prior = active_connections.fetch_add(1, Ordering::AcqRel);
            if prior >= MAX_CONNECTIONS {
                active_connections.fetch_sub(1, Ordering::AcqRel);
                let mut out = error_response(
                    "connect",
                    "connection_limit",
                    "too many control connections",
                )
                .to_string();
                out.push('\n');
                let _ = stream.write_all(out.as_bytes());
                continue;
            }
            let tx = tx.clone();
            let active_connections = active_connections.clone();
            std::thread::spawn(move || {
                struct ConnectionGuard(Arc<AtomicUsize>);
                impl Drop for ConnectionGuard {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, Ordering::AcqRel);
                    }
                }
                let _guard = ConnectionGuard(active_connections);
                let mut writer = match stream.try_clone() {
                    Ok(w) => w,
                    Err(_) => return,
                };
                let mut reader = BufReader::new(stream);
                for _ in 0..MAX_REQUESTS_PER_CONNECTION {
                    let line = match read_bounded_line(&mut reader) {
                        Ok(Some(line)) => line,
                        Ok(None) => break,
                        Err(error) => {
                            let mut out =
                                error_response("parse", "request_too_large", error).to_string();
                            out.push('\n');
                            let _ = writer.write_all(out.as_bytes());
                            break;
                        }
                    };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let response = match parse_request(&line) {
                        Err(err) => error_response("parse", "invalid_request", err),
                        Ok(request) => {
                            let command = request.command_name();
                            let (reply_tx, reply_rx) = mpsc::channel();
                            if tx
                                .send(ScriptEnvelope {
                                    request,
                                    reply: reply_tx,
                                })
                                .is_err()
                            {
                                error_response(command, "unavailable", "console shutting down")
                            } else {
                                match reply_rx.recv_timeout(Duration::from_secs(5)) {
                                    Ok(v) => wire_response(command, v),
                                    Err(_) => error_response(
                                        command,
                                        "foreground_timeout",
                                        "timed out waiting for the console (5s)",
                                    ),
                                }
                            }
                        }
                    };
                    let mut out = response.to_string();
                    if out.len() > MAX_RESPONSE_BYTES {
                        out = error_response(
                            "response",
                            "response_too_large",
                            format!("response exceeds {MAX_RESPONSE_BYTES} bytes"),
                        )
                        .to_string();
                    }
                    out.push('\n');
                    if writer.write_all(out.as_bytes()).is_err() {
                        break;
                    }
                }
            });
        }
    });
}

fn read_bounded_line<R: BufRead>(reader: &mut R) -> Result<Option<String>, String> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|error| error.to_string())?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            break;
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if bytes.len() + take > MAX_REQUEST_LINE_BYTES {
            return Err(format!(
                "request line exceeds {MAX_REQUEST_LINE_BYTES} bytes"
            ));
        }
        bytes.extend_from_slice(&available[..take]);
        reader.consume(take);
        if bytes.last() == Some(&b'\n') {
            break;
        }
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "request line must be valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_request(line: &str) -> Result<ScriptRequest, String> {
        let Ok(mut value): Result<Value, _> = serde_json::from_str(line) else {
            return super::parse_request(line);
        };
        value["protocolVersion"] = json!(PROTOCOL_VERSION);
        super::parse_request(&value.to_string())
    }

    #[test]
    fn parses_every_command() {
        assert_eq!(
            parse_request(r#"{"cmd":"describe"}"#),
            Ok(ScriptRequest::Describe)
        );
        assert_eq!(
            parse_request(r#"{"cmd":"context"}"#),
            Ok(ScriptRequest::Context)
        );
        assert_eq!(
            parse_request(r#"{"cmd":"type","target":"mission.composer","text":"draft"}"#),
            Ok(ScriptRequest::Type {
                target: "mission.composer".into(),
                text: "draft".into(),
                append: false,
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"click","target":"mission.send"}"#),
            Ok(ScriptRequest::Click {
                target: "mission.send".into(),
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"assert","path":"launcher.open","op":"eq","value":true}"#),
            Ok(ScriptRequest::Assert {
                path: "launcher.open".into(),
                op: AssertOp::Eq,
                expected: Some(json!(true)),
            })
        );
        assert_eq!(parse_request(r#"{"cmd":"ping"}"#), Ok(ScriptRequest::Ping));
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","windowHours":720}"#),
            Ok(ScriptRequest::Galaxy {
                window_hours: Some(720),
                min_tokens: None,
                cluster: None
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","minTokens":64}"#),
            Ok(ScriptRequest::Galaxy {
                window_hours: None,
                min_tokens: Some(64),
                cluster: None
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","cluster":false}"#),
            Ok(ScriptRequest::Galaxy {
                window_hours: None,
                min_tokens: None,
                cluster: Some(false)
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"chat","text":"  Are you attached live?  "}"#),
            Ok(ScriptRequest::Chat {
                text: "Are you attached live?".into()
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"work","goal":"  Take the next roadmap slice  "}"#),
            Ok(ScriptRequest::Work {
                goal: "Take the next roadmap slice".into()
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"stop"}"#),
            Ok(ScriptRequest::StopMission)
        );
        assert_eq!(
            parse_request(r#"{"cmd":"rebind","url":"http://127.0.0.1:9899"}"#),
            Ok(ScriptRequest::Rebind {
                url: "http://127.0.0.1:9899".into()
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"alerts"}"#),
            Ok(ScriptRequest::Alerts)
        );
    }

    #[test]
    fn rejects_malformed_input_with_a_reason() {
        assert!(parse_request("not json")
            .unwrap_err()
            .starts_with("bad json"));
        assert_eq!(parse_request(r#"{"x":1}"#).unwrap_err(), "missing \"cmd\"");
        assert_eq!(
            parse_request(r#"{"cmd":"sextant"}"#).unwrap_err(),
            "sextant needs windowHours, minTokens, and/or cluster"
        );
        assert_eq!(
            parse_request(r#"{"cmd":"chat","text":"   "}"#).unwrap_err(),
            "chat needs non-empty \"text\""
        );
        assert_eq!(
            parse_request(r#"{"cmd":"work","goal":"   "}"#).unwrap_err(),
            "work needs non-empty \"goal\""
        );
        assert!(parse_request(r#"{"cmd":"warp"}"#)
            .unwrap_err()
            .starts_with("unknown cmd"));
        assert_eq!(
            parse_request(r#"{"cmd":"describe","surprise":true}"#).unwrap_err(),
            "unknown field \"surprise\" for cmd=describe"
        );
        assert_eq!(
            super::parse_request(r#"{"cmd":"describe","protocolVersion":2}"#).unwrap_err(),
            "protocolVersion must be 1"
        );
        assert_eq!(
            super::parse_request(r#"{"cmd":"describe"}"#).unwrap_err(),
            "protocolVersion must be 1"
        );
        let oversized = "x".repeat(MAX_STRING_BYTES + 1);
        assert!(parse_request(
            &json!({"cmd": "type", "target": "mission.composer", "text": oversized}).to_string()
        )
        .unwrap_err()
        .contains("exceeds"));
    }

    #[test]
    fn bounded_reader_refuses_oversized_lines_without_allocating_the_rest() {
        let input = vec![b'x'; MAX_REQUEST_LINE_BYTES + 1];
        let mut reader = BufReader::new(input.as_slice());
        assert!(read_bounded_line(&mut reader)
            .unwrap_err()
            .contains("exceeds"));
    }

    #[test]
    fn socket_preparation_refuses_regular_files_and_symlinks() {
        use std::os::unix::fs::symlink;
        let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("coding/tmp")
            .join(format!("pd-console-socket-safety-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let regular = dir.join("regular");
        std::fs::write(&regular, b"preserve me").unwrap();
        assert!(prepare_socket_path(&regular)
            .unwrap_err()
            .contains("non-socket"));
        assert_eq!(std::fs::read(&regular).unwrap(), b"preserve me");
        let link = dir.join("link");
        symlink(&regular, &link).unwrap();
        assert!(prepare_socket_path(&link).unwrap_err().contains("symlink"));
        assert!(regular.exists());
        std::fs::remove_file(link).unwrap();
        std::fs::remove_file(regular).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn socket_preparation_refuses_a_live_listener() {
        let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("coding/tmp")
            .join(format!("pd-console-live-socket-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("live.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        assert!(prepare_socket_path(&socket).unwrap_err().contains("live"));
        assert!(socket.exists());
        drop(listener);
        std::fs::remove_file(socket).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn socket_preparation_removes_only_a_current_user_stale_socket() {
        let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("coding/tmp")
            .join(format!("pd-console-stale-socket-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("stale.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        drop(listener);

        prepare_socket_path(&socket).expect("owned, refused stale socket is safe to remove");
        assert!(!socket.exists());
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn rejects_retired_galaxy_command_with_migration_guidance() {
        assert_eq!(
            parse_request(r#"{"cmd":"galaxy","windowHours":720}"#).unwrap_err(),
            "Galaxy was renamed to Sextant; use cmd=sextant."
        );
    }

    #[test]
    fn rejects_invalid_galaxy_numbers() {
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","windowHours":0}"#).unwrap_err(),
            "windowHours must be greater than 0"
        );
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","minTokens":4294967296}"#).unwrap_err(),
            "minTokens must fit in u32"
        );
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","windowHours":"24"}"#).unwrap_err(),
            "windowHours must be a positive integer"
        );
        assert_eq!(
            parse_request(r#"{"cmd":"sextant","windowHours":24,"cluster":"yes"}"#).unwrap_err(),
            "cluster must be a boolean"
        );
    }

    #[test]
    fn socket_preparation_refuses_an_unsafe_or_symlinked_parent() {
        use std::os::unix::fs::symlink;
        let root = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("coding/tmp")
            .join(format!("pd-console-parent-safety-{}", std::process::id()));
        let unsafe_parent = root.join("unsafe");
        std::fs::create_dir_all(&unsafe_parent).unwrap();
        std::fs::set_permissions(&unsafe_parent, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(prepare_socket_path(&unsafe_parent.join("control.sock"))
            .unwrap_err()
            .contains("group/world writable"));

        let safe_parent = root.join("safe");
        let link_parent = root.join("linked");
        std::fs::create_dir_all(&safe_parent).unwrap();
        symlink(&safe_parent, &link_parent).unwrap();
        assert!(prepare_socket_path(&link_parent.join("control.sock"))
            .unwrap_err()
            .contains("real directory"));
        std::fs::remove_file(link_parent).unwrap();
        std::fs::set_permissions(&unsafe_parent, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn server_round_trips_over_a_real_socket() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;

        // Keep even transient sockets under the operator-approved scratch root.
        let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("coding/tmp")
            .join(format!("pd-console-script-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("ctl.sock").to_string_lossy().to_string();

        let (tx, rx) = mpsc::channel::<ScriptEnvelope>();
        start_server(sock.clone(), tx);

        // A fake "foreground": answer every request with a canned pong.
        std::thread::spawn(move || {
            for env in rx.iter() {
                let _ = env
                    .reply
                    .send(json!({"ok": true, "echo": format!("{:?}", env.request)}));
            }
        });

        // The bind happens on the server thread; poll for the socket file.
        // Generous window: under a parallel `cargo test` run the thread can be
        // scheduled late.
        let mut stream = None;
        let mut last_err = String::new();
        for _ in 0..250 {
            match UnixStream::connect(&sock) {
                Ok(s) => {
                    stream = Some(s);
                    break;
                }
                Err(e) => last_err = e.to_string(),
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let stream =
            stream.unwrap_or_else(|| panic!("control socket never came up at {sock}: {last_err}"));
        let mode = std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let mut writer = stream.try_clone().unwrap();
        let mut reader = BufReader::new(stream);

        writer
            .write_all(b"{\"cmd\":\"ping\",\"protocolVersion\":1}\n")
            .unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["ok"], true);

        writer
            .write_all(b"{\"cmd\":\"nope\",\"protocolVersion\":1}\n")
            .unwrap();
        let mut line2 = String::new();
        reader.read_line(&mut line2).unwrap();
        let v2: Value = serde_json::from_str(&line2).unwrap();
        assert_eq!(v2["ok"], false);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
