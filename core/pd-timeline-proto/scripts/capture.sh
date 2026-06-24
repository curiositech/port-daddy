#!/usr/bin/env bash
# capture.sh — build, run, and capture visual artifacts of pd-timeline-proto.
#
# Captures a still PNG of the window and a short screen recording of the
# playhead auto-sweeping. Uses `screencapture -l<CGWindowID>` so it grabs ONLY
# our window regardless of z-order (no need to bring it forward / hide others).
#
# Screen Recording permission: macOS may deny capture in a headless/automation
# context ("could not create image from display"). If the PNG/MOV come out
# black or empty, run this from a Terminal that has Screen Recording permission
# (System Settings > Privacy & Security > Screen Recording).
#
# This is a live-window capture (Method 0). Because this is a Vello/wgpu surface,
# it is the natural candidate for a fully headless, CI-able, deterministic path:
# render to an offscreen wgpu texture and pipe frames to ffmpeg — no window, no
# TCC permission. See ../../pd-console/docs/recording-visual-artifacts.md (Method A).
#
# Requires: pyobjc Quartz bindings for window-id lookup (preinstalled on most
# macOS Pythons; `pip install pyobjc-framework-Quartz` otherwise).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
OUT="docs"
mkdir -p "$OUT"

echo "[capture] building release…"
cargo build --release >/dev/null

echo "[capture] launching window (autoplay for the recording)…"
PD_TIMELINE_AUTOPLAY=1 ./target/release/pd-timeline-proto >"$HERE/.capture-run.log" 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT
sleep 3

WID="$(python3 - "$APP_PID" <<'PY'
import sys, Quartz
pid = int(sys.argv[1])
for w in Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID):
    name = w.get('kCGWindowName') or ''
    if w.get('kCGWindowOwnerPID') == pid and name.startswith('pd-timeline'):
        print(w.get('kCGWindowNumber'))
        break
PY
)"

if [[ -z "${WID:-}" ]]; then
  echo "[capture] ERROR: could not find window id — is the window open?"
  exit 1
fi
echo "[capture] window id = $WID"

# Bring forward (best effort) so a still shot looks natural.
osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "pd-timeline-proto") to true' 2>/dev/null || true
sleep 0.5

echo "[capture] still PNG -> $OUT/timeline-window.png"
screencapture -x -o -l"$WID" "$OUT/timeline-window.png"

echo "[capture] 6s screen recording -> $OUT/timeline-scrub.mov"
screencapture -x -V 6 -l"$WID" "$OUT/timeline-scrub.mov"

echo "[capture] done. Artifacts:"
ls -la "$OUT"/timeline-*.png "$OUT"/timeline-*.mov 2>/dev/null || true
echo "[capture] FPS samples from this run:"
grep '\[frame\]' "$HERE/.capture-run.log" | tail -8 || true
