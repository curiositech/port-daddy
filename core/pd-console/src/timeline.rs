//! Timeline companion-window launcher — ADR-0112 (né 0086) path 3, "ship now".
//!
//! The operator console is a **gpui shell**; the bespoke-vector Voyage Timeline
//! (smooth cubic-bezier causal threads + a scrubbed playhead at 60fps) lives in
//! `core/pd-timeline-proto`, a standalone **Vello/wgpu + Parley** window that is
//! deliberately *excluded* from the `core/` cargo workspace so its heavy macOS
//! GPU deps never touch the Linux `rust-console` CI gate. ADR-0112 sequences the
//! bridge: **path 3 now** — the console *execs the proven binary as a companion
//! window* against live daemon data, "zero stack-mixing risk"; **path 2 later** —
//! embed a Vello surface inside the gpui pane tree (forward work, NOT this file).
//!
//! This module is the whole of path 3: a **pure, exhaustively-tested** binary
//! path resolver ([`resolve_timeline_binary`]) plus a thin, barely-tested I/O
//! shell ([`launch_timeline_companion`]) that gathers runtime facts, calls the
//! resolver, and spawns the child **detached / non-blocking** so the gpui event
//! loop never waits on it. Nothing here depends on gpui, so its `#[cfg(test)]`
//! suite runs on the cheap non-gpui gate via `bin/repl.rs`.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// The companion binary's name (its `[[bin]]` name in
/// `core/pd-timeline-proto/Cargo.toml`, and the file it builds to).
pub const TIMELINE_BIN: &str = "pd-timeline-proto";

/// Outcome of resolving where the `pd-timeline-proto` companion binary lives.
///
/// `Missing` carries the *ordered* list of paths that were probed so the caller
/// can render an honest, actionable flash ("here is where I looked; build it").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineBinary {
    /// A concrete, existing executable ready to spawn.
    Found(PathBuf),
    /// No candidate existed; `searched` is every path probed, in priority order.
    Missing { searched: Vec<PathBuf> },
}

/// Resolve the `pd-timeline-proto` companion binary, PURELY.
///
/// No filesystem access, no process spawning: existence is decided by the
/// injected `exists` probe, so every branch is unit-testable off a fake FS.
/// Candidates are tried in priority order:
///
/// 1. **`env_override`** — an explicit path (from `PD_TIMELINE_PROTO_BIN`), so a
///    packaged app or an operator can pin an installed copy. Mirrors the
///    `PD_CONJURE_PROTO_DIR` override convention already used for the Vello
///    work-graph renderer in `main.rs`.
/// 2. **Installed** — `<exe_dir>/pd-timeline-proto`, i.e. the companion sitting
///    next to the `pd-console` executable in a packaged `dist/core` layout.
/// 3. **Dev-mode** — the proto crate's own `target/{release,debug}/` output
///    (release preferred), the exact path `cd core/pd-timeline-proto &&
///    cargo build --release` produces. The proto keeps its OWN target dir
///    because it is out-of-workspace.
///
/// Returns [`TimelineBinary::Missing`] (never panics, never a silent default)
/// when nothing exists, carrying the probed paths for a helpful message.
pub fn resolve_timeline_binary(
    env_override: Option<&str>,
    exe_dir: Option<&Path>,
    proto_dir: &Path,
    exists: &dyn Fn(&Path) -> bool,
) -> TimelineBinary {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(raw) = env_override {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }
    if let Some(dir) = exe_dir {
        candidates.push(dir.join(TIMELINE_BIN));
    }
    for profile in ["release", "debug"] {
        candidates.push(proto_dir.join("target").join(profile).join(TIMELINE_BIN));
    }

    for candidate in &candidates {
        if exists(candidate) {
            return TimelineBinary::Found(candidate.clone());
        }
    }
    TimelineBinary::Missing {
        searched: candidates,
    }
}

/// Human-facing, actionable flash for a missing companion binary: names the
/// build command and lists every probed path. PURE (formatting only) so its
/// wording is pinned by a test.
pub fn missing_binary_message(searched: &[PathBuf]) -> String {
    let looked = searched
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(" · ");
    format!(
        "TIMELINE_BINARY_NOT_FOUND · {TIMELINE_BIN} is out-of-workspace — build it: \
         cd core/pd-timeline-proto && cargo build --release · looked in: {looked}"
    )
}

/// Resolve the `pd-timeline-proto` *crate dir* the same way `main.rs` resolves
/// the conjure proto: honor a `PD_TIMELINE_PROTO_DIR` override, else the sibling
/// of this crate at build time (`core/pd-console/../pd-timeline-proto`).
fn timeline_proto_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PD_TIMELINE_PROTO_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join(TIMELINE_BIN))
        .unwrap_or_else(|| PathBuf::from(TIMELINE_BIN))
}

/// Launch the Voyage Timeline as a **detached companion window** against the
/// given daemon berth (ADR-0112 path 3). Thin I/O shell around the pure
/// [`resolve_timeline_binary`]:
///
/// * gathers runtime facts (`current_exe`'s dir, the proto crate dir, the
///   `PD_TIMELINE_PROTO_BIN` override) and resolves a concrete binary;
/// * on `Missing`, returns [`Err`] with [`missing_binary_message`] — the caller
///   surfaces it as a `control_flash` (never a silent no-op, never a panic);
/// * on `Found`, spawns the child with [`std::process::Command::spawn`] and
///   hands its process handle to a tiny named reaper thread. The GPUI event loop
///   remains non-blocking, while exited companion windows cannot accumulate as
///   zombie processes across repeated launches.
///
/// The child inherits our env and is additionally handed `PORT_DADDY_URL =
/// daemon_url` so the companion reads the *same* berth the console is currently
/// bound to (the proto reads `PORT_DADDY_URL`, falling back to localhost).
///
/// Returns the spawned binary's path on success.
pub fn launch_timeline_companion(daemon_url: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().ok();
    let exe_dir = exe.as_deref().and_then(Path::parent);
    let proto_dir = timeline_proto_dir();
    let env_override = std::env::var("PD_TIMELINE_PROTO_BIN").ok();

    match resolve_timeline_binary(env_override.as_deref(), exe_dir, &proto_dir, &|p| {
        p.exists()
    }) {
        TimelineBinary::Found(bin) => {
            spawn_timeline_process(&bin, daemon_url)?;
            Ok(bin)
        }
        TimelineBinary::Missing { searched } => Err(missing_binary_message(&searched)),
    }
}

/// Spawn the already-resolved companion and reap it away from GPUI's event
/// loop. Kept separate from resolution so the actual process-error boundary is
/// directly testable.
fn spawn_timeline_process(bin: &Path, daemon_url: &str) -> Result<(), String> {
    let child = std::process::Command::new(bin)
        .env("PORT_DADDY_URL", daemon_url)
        .spawn()
        .map_err(|e| {
            format!(
                "TIMELINE_SPAWN_FAILED · could not exec {} · {e}",
                bin.display()
            )
        })?;

    let child = Arc::new(Mutex::new(child));
    let reaper_child = Arc::clone(&child);
    let display = bin.display().to_string();
    if let Err(error) = std::thread::Builder::new()
        .name("pd-timeline-reaper".to_string())
        .spawn(move || match reaper_child.lock() {
            Ok(mut child) => {
                if let Err(wait_error) = child.wait() {
                    eprintln!(
                        "[pd-console] timeline companion {display} wait failed: {wait_error}"
                    );
                }
            }
            Err(_) => {
                eprintln!("[pd-console] timeline companion {display} reaper lock was poisoned")
            }
        })
    {
        // Thread creation failed after the child started. Do not leak that
        // process: terminate and synchronously reap it before returning.
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err(format!(
            "TIMELINE_REAPER_FAILED · could not monitor {} · {error}",
            bin.display()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none_exist(_: &Path) -> bool {
        false
    }

    /// A probe that reports exactly the listed paths as existing. Copies the
    /// inputs into an owned set so callers can pass temporary slice literals.
    fn only(existing: &[&str]) -> impl Fn(&Path) -> bool {
        let owned: Vec<PathBuf> = existing.iter().map(PathBuf::from).collect();
        move |p: &Path| owned.iter().any(|e| e.as_path() == p)
    }

    #[test]
    fn dev_mode_release_is_preferred() {
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let release = "/repo/core/pd-timeline-proto/target/release/pd-timeline-proto";
        let got = resolve_timeline_binary(None, None, proto, &only(&[release]));
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(release)));
    }

    #[test]
    fn dev_mode_falls_back_to_debug_when_release_absent() {
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let debug = "/repo/core/pd-timeline-proto/target/debug/pd-timeline-proto";
        let got = resolve_timeline_binary(None, None, proto, &only(&[debug]));
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(debug)));
    }

    #[test]
    fn installed_next_to_console_binary_beats_dev_target() {
        // Packaged layout: the companion sits next to pd-console in dist/core.
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let exe_dir = Path::new("/Applications/pd/dist/core");
        let installed = "/Applications/pd/dist/core/pd-timeline-proto";
        let dev_release = "/repo/core/pd-timeline-proto/target/release/pd-timeline-proto";
        // Both exist; the installed copy (higher priority) must win.
        let got =
            resolve_timeline_binary(None, Some(exe_dir), proto, &only(&[installed, dev_release]));
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(installed)));
    }

    #[test]
    fn env_override_wins_over_everything_when_it_exists() {
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let exe_dir = Path::new("/Applications/pd/dist/core");
        let pinned = "/custom/pinned/pd-timeline-proto";
        let installed = "/Applications/pd/dist/core/pd-timeline-proto";
        let got = resolve_timeline_binary(
            Some(pinned),
            Some(exe_dir),
            proto,
            &only(&[pinned, installed]),
        );
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(pinned)));
    }

    #[test]
    fn env_override_that_does_not_exist_is_skipped_not_fatal() {
        // A stale override must not shadow a real installed/dev binary.
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let exe_dir = Path::new("/Applications/pd/dist/core");
        let installed = "/Applications/pd/dist/core/pd-timeline-proto";
        let got = resolve_timeline_binary(
            Some("/gone/pd-timeline-proto"),
            Some(exe_dir),
            proto,
            &only(&[installed]),
        );
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(installed)));
    }

    #[test]
    fn blank_env_override_is_ignored() {
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let release = "/repo/core/pd-timeline-proto/target/release/pd-timeline-proto";
        let got = resolve_timeline_binary(Some("   "), None, proto, &only(&[release]));
        assert_eq!(got, TimelineBinary::Found(PathBuf::from(release)));
    }

    #[test]
    fn missing_reports_every_probed_path_in_priority_order() {
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let exe_dir = Path::new("/dist/core");
        let got = resolve_timeline_binary(
            Some("/pin/pd-timeline-proto"),
            Some(exe_dir),
            proto,
            &none_exist,
        );
        assert_eq!(
            got,
            TimelineBinary::Missing {
                searched: vec![
                    PathBuf::from("/pin/pd-timeline-proto"),
                    PathBuf::from("/dist/core/pd-timeline-proto"),
                    PathBuf::from("/repo/core/pd-timeline-proto/target/release/pd-timeline-proto"),
                    PathBuf::from("/repo/core/pd-timeline-proto/target/debug/pd-timeline-proto"),
                ],
            }
        );
    }

    #[test]
    fn missing_without_exe_dir_still_probes_dev_targets() {
        // Running via `cargo run` before the proto is built: no override, and a
        // current_exe that has no sibling companion. Must not panic; must list
        // the dev-target paths the operator needs to build.
        let proto = Path::new("/repo/core/pd-timeline-proto");
        let got = resolve_timeline_binary(None, None, proto, &none_exist);
        assert_eq!(
            got,
            TimelineBinary::Missing {
                searched: vec![
                    PathBuf::from("/repo/core/pd-timeline-proto/target/release/pd-timeline-proto"),
                    PathBuf::from("/repo/core/pd-timeline-proto/target/debug/pd-timeline-proto"),
                ],
            }
        );
    }

    #[test]
    fn missing_message_names_build_command_and_probed_paths() {
        let searched = vec![
            PathBuf::from("/dist/core/pd-timeline-proto"),
            PathBuf::from("/repo/core/pd-timeline-proto/target/release/pd-timeline-proto"),
        ];
        let msg = missing_binary_message(&searched);
        assert!(msg.contains("cargo build --release"));
        assert!(msg.contains("core/pd-timeline-proto"));
        assert!(msg.contains("/dist/core/pd-timeline-proto"));
        assert!(msg.contains("/repo/core/pd-timeline-proto/target/release/pd-timeline-proto"));
    }

    #[test]
    fn resolved_binary_spawn_failure_is_actionable() {
        let absent = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("definitely-not-a-timeline-binary");
        let error = spawn_timeline_process(&absent, "http://127.0.0.1:9876")
            .expect_err("an absent resolved executable must fail at the spawn boundary");

        assert!(error.contains("TIMELINE_SPAWN_FAILED"));
        assert!(error.contains("definitely-not-a-timeline-binary"));
    }
}
