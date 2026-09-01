//! Console scripting control plane.
//!
//! A unix-socket, newline-JSON command surface so agents and shell scripts can
//! drive a running pd-console instead of screenshot-and-pray: switch panes,
//! read pane state as structured JSON, tune the Sextant query, rebind the
//! daemon, and read the HITL alert log.
//!
//! Enable with `--control-sock <path>` or `PD_CONSOLE_CONTROL_SOCK=<path>`.
//! Protocol: one JSON object per line in, one JSON object per line out.
//!
//!   {"cmd":"ping"}
//!   {"cmd":"panes"}
//!   {"cmd":"focus","pane":"sextant"}
//!   {"cmd":"state","pane":"sextant"}
//!   {"cmd":"sextant","windowHours":720,"minTokens":64}
//!   {"cmd":"work","goal":"Take the next roadmap slice"}
//!   {"cmd":"stop"}
//!   {"cmd":"chat","text":"Are you attached live?"}
//!   {"cmd":"rebind","url":"http://127.0.0.1:9899"}
//!   {"cmd":"alerts"}
//!
//! Transport lives on a plain std thread (UnixListener). Each request is
//! forwarded to the GPUI foreground through an mpsc envelope carrying its own
//! reply channel; the 500ms foreground drain task answers with full access to
//! `ConsoleView`. A request that gets no reply within 5s returns a timeout
//! error to the caller instead of hanging the socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::pane::{Alert, Block};

/// A parsed scripting request. Kept data-only so parsing is unit-testable
/// without a socket or a window.
#[derive(Debug, Clone, PartialEq)]
pub enum ScriptRequest {
    Ping,
    Panes,
    Focus {
        pane: String,
    },
    State {
        pane: Option<String>,
    },
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
    match cmd {
        "ping" => Ok(ScriptRequest::Ping),
        "panes" => Ok(ScriptRequest::Panes),
        "focus" => {
            let pane = v
                .get("pane")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "focus needs \"pane\"".to_string())?;
            Ok(ScriptRequest::Focus {
                pane: pane.trim().to_string(),
            })
        }
        "state" => Ok(ScriptRequest::State {
            pane: v
                .get("pane")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string()),
        }),
        "galaxy" => Err("Galaxy was renamed to Sextant; use cmd=sextant.".to_string()),
        "chat" => {
            let text = v
                .get("text")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "chat needs non-empty \"text\"".to_string())?;
            Ok(ScriptRequest::Chat {
                text: text.trim().to_string(),
            })
        }
        "work" => {
            let goal = v
                .get("goal")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "work needs non-empty \"goal\"".to_string())?;
            Ok(ScriptRequest::Work {
                goal: goal.trim().to_string(),
            })
        }
        "stop" => Ok(ScriptRequest::StopMission),
        "sextant" => {
            let window_hours = optional_positive_u32(&v, "windowHours")?;
            let min_tokens = optional_positive_u32(&v, "minTokens")?;
            let cluster = v.get("cluster").and_then(Value::as_bool);
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
            let url = v
                .get("url")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "rebind needs \"url\"".to_string())?;
            Ok(ScriptRequest::Rebind {
                url: url.trim().to_string(),
            })
        }
        "alerts" => Ok(ScriptRequest::Alerts),
        other => Err(format!(
            "unknown cmd \"{other}\" (try ping/panes/focus/state/work/chat/sextant/rebind/alerts)"
        )),
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

/// Serialize a pane [`Block`] to JSON. Faithful but flat: scripting callers
/// grep fields, they don't re-render chrome.
pub fn block_to_json(block: &Block) -> Value {
    match block {
        Block::Header(t) => json!({"type": "header", "text": t}),
        Block::KeyVal(k, val) => json!({"type": "keyval", "key": k, "value": val}),
        Block::Row(cells) => json!({"type": "row", "cells": cells}),
        Block::ChatTurn { speaker, text, .. } => {
            json!({"type": "chat", "speaker": speaker, "text": text})
        }
        Block::TranscriptLine { text, .. } => json!({"type": "transcript", "text": text}),
        Block::ArtifactRef { label, path, .. } => {
            json!({"type": "artifact", "label": label, "path": path})
        }
        Block::ImageArtifact {
            label,
            path,
            image_path,
            ..
        } => {
            json!({"type": "image", "label": label, "path": path, "imagePath": image_path})
        }
        Block::Chip { label, .. } => json!({"type": "chip", "label": label}),
        Block::Flag { letter, label, .. } => {
            json!({"type": "flag", "letter": letter.to_string(), "label": label})
        }
        Block::Spark(values) => json!({"type": "spark", "values": values}),
        Block::Gap => json!({"type": "gap"}),
        Block::WrappedText { text, .. } => json!({"type": "text", "text": text}),
        Block::LedgerHeader {
            surface,
            columns,
            active_sort,
            descending,
        } => json!({
            "type": "ledgerHeader",
            "surface": surface,
            "columns": columns.iter().map(|(key, label)| json!({"key": key, "label": label})).collect::<Vec<_>>(),
            "activeSort": active_sort,
            "descending": descending,
        }),
        Block::LedgerRow {
            surface,
            index,
            selected,
            cells,
            ..
        } => json!({
            "type": "ledgerRow",
            "surface": surface,
            "index": index,
            "selected": selected,
            "cells": cells.iter().map(|cell| json!({
                "label": cell.label,
                "value": cell.value,
                "width": cell.width.as_str(),
            })).collect::<Vec<_>>(),
        }),
        Block::NodeRow {
            index,
            selected,
            live,
            flag,
            name,
            badge,
            meta,
            age,
            ..
        } => json!({
            "type": "nodeRow",
            "index": index,
            "selected": selected,
            "live": live,
            "flag": flag.to_string(),
            "name": name,
            "badge": badge,
            "meta": meta,
            "age": age,
        }),
        Block::ClaimTroubleCard {
            index,
            selected,
            flag,
            state,
            surface,
            other,
            action,
            ..
        } => json!({
            "type": "claimTroubleCard",
            "index": index,
            "selected": selected,
            "flag": flag.to_string(),
            "state": state,
            "surface": surface,
            "other": other,
            "action": action,
        }),
        Block::ControlButton {
            verb,
            label,
            enabled,
            why_disabled,
            primary,
        } => json!({
            "type": "control",
            "verb": verb,
            "label": label,
            "enabled": enabled,
            "whyDisabled": why_disabled,
            "primary": primary,
        }),
        Block::CodeBuffer {
            lines,
            gutter_cols,
            bands,
            show_authors,
        } => json!({
            "type": "codeBuffer",
            "lineCount": lines.len(),
            "gutterCols": gutter_cols,
            "showAuthors": show_authors,
            "bands": bands.iter().map(|band| json!({
                "start": band.start,
                "end": band.end,
                "tone": format!("{:?}", band.tone),
            })).collect::<Vec<_>>(),
            "lines": lines.iter().map(|line| json!({
                "number": line.number,
                "authorTag": line.author_tag.as_deref(),
                "authorTone": format!("{:?}", line.author_tone),
                "text": line.text.as_ref(),
                "runs": line.runs.iter().map(|(len, kind)| json!({
                    "len": len,
                    "kind": format!("{:?}", kind),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    }
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
        let _ = std::fs::remove_file(&sock_path);
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
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let tx = tx.clone();
            std::thread::spawn(move || {
                let mut writer = match stream.try_clone() {
                    Ok(w) => w,
                    Err(_) => return,
                };
                let reader = BufReader::new(stream);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let response = match parse_request(&line) {
                        Err(err) => json!({"ok": false, "error": err}),
                        Ok(request) => {
                            let (reply_tx, reply_rx) = mpsc::channel();
                            if tx
                                .send(ScriptEnvelope {
                                    request,
                                    reply: reply_tx,
                                })
                                .is_err()
                            {
                                json!({"ok": false, "error": "console shutting down"})
                            } else {
                                match reply_rx.recv_timeout(Duration::from_secs(5)) {
                                    Ok(v) => v,
                                    Err(_) => json!({
                                        "ok": false,
                                        "error": "timed out waiting for the console (5s)"
                                    }),
                                }
                            }
                        }
                    };
                    let mut out = response.to_string();
                    out.push('\n');
                    if writer.write_all(out.as_bytes()).is_err() {
                        break;
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pane::Tone;

    #[test]
    fn parses_every_command() {
        assert_eq!(parse_request(r#"{"cmd":"ping"}"#), Ok(ScriptRequest::Ping));
        assert_eq!(
            parse_request(r#"{"cmd":"panes"}"#),
            Ok(ScriptRequest::Panes)
        );
        assert_eq!(
            parse_request(r#"{"cmd":"focus","pane":"sextant"}"#),
            Ok(ScriptRequest::Focus {
                pane: "sextant".into()
            })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"state"}"#),
            Ok(ScriptRequest::State { pane: None })
        );
        assert_eq!(
            parse_request(r#"{"cmd":"state","pane":"parley"}"#),
            Ok(ScriptRequest::State {
                pane: Some("parley".into())
            })
        );
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
            parse_request(r#"{"cmd":"focus"}"#).unwrap_err(),
            "focus needs \"pane\""
        );
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
    }

    #[test]
    fn blocks_serialize_flat_and_faithful() {
        let blocks = vec![
            Block::Header("Sextant".into()),
            Block::KeyVal("sessions".into(), "18".into()),
            Block::Chip {
                label: "agent · bash — 12 session(s)".into(),
                tone: Tone::Engaged,
            },
            Block::Gap,
            Block::NodeRow {
                index: 2,
                selected: true,
                live: false,
                flag: 'S',
                name: "agent-spark".into(),
                badge: "observable".into(),
                badge_tone: Tone::Gated,
                meta: "codex · high · waiting".into(),
                age: "4m".into(),
                tone: Tone::Gated,
            },
            Block::ControlButton {
                verb: "pause".into(),
                label: "Pause".into(),
                enabled: false,
                why_disabled: Some("missing provider token".into()),
                primary: true,
            },
        ];
        let out: Vec<Value> = blocks.iter().map(block_to_json).collect();
        assert_eq!(out[0]["type"], "header");
        assert_eq!(out[1]["value"], "18");
        assert_eq!(out[2]["label"], "agent · bash — 12 session(s)");
        assert_eq!(out[3]["type"], "gap");
        assert_eq!(out[4]["type"], "nodeRow");
        assert_eq!(out[4]["name"], "agent-spark");
        assert_eq!(out[4]["flag"], "S");
        assert_eq!(out[5]["type"], "control");
        assert_eq!(out[5]["enabled"], false);
        assert_eq!(out[5]["whyDisabled"], "missing provider token");
    }

    #[test]
    fn claim_trouble_card_serializes_summary_fields() {
        let block = Block::ClaimTroubleCard {
            index: 3,
            selected: true,
            flag: 'C',
            state: "COORDINATE".into(),
            surface: "core/pd-console/src/app.rs".into(),
            other: "agent-2 (claims)".into(),
            action: "coordinate now".into(),
            tone: Tone::Conflicted,
        };
        let json = block_to_json(&block);
        assert_eq!(json["type"], "claimTroubleCard");
        assert_eq!(json["index"], 3);
        assert_eq!(json["selected"], true);
        assert_eq!(json["flag"], "C");
        assert_eq!(json["state"], "COORDINATE");
        assert_eq!(json["surface"], "core/pd-console/src/app.rs");
        assert_eq!(json["other"], "agent-2 (claims)");
        assert_eq!(json["action"], "coordinate now");
    }

    #[test]
    fn server_round_trips_over_a_real_socket() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;

        // Socket endpoints only — no work product lives here. $TMPDIR (macOS
        // /var/folders/…, NOT /tmp) is used deliberately: unix socket paths
        // must fit SUN_LEN (104 bytes), and ~/-anchored paths break when a
        // sibling test (conjure) rebinds HOME under a deep scratch dir.
        let dir =
            std::env::temp_dir().join(format!("pd-console-script-test-{}", std::process::id()));
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

        writer.write_all(b"{\"cmd\":\"ping\"}\n").unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["ok"], true);

        writer.write_all(b"{\"cmd\":\"nope\"}\n").unwrap();
        let mut line2 = String::new();
        reader.read_line(&mut line2).unwrap();
        let v2: Value = serde_json::from_str(&line2).unwrap();
        assert_eq!(v2["ok"], false);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
