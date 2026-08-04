#!/bin/bash
# Capture native GPUI window screenshots for the pd-console PR test plan.
#
# Per the standing rule, every GPUI/console diff ships window screenshots. The
# capture needs macOS Screen Recording permission for the terminal/process that
# runs this script (System Settings → Privacy & Security → Screen Recording).
# A background/headless context (e.g. a CI runner or detached agent) is denied by
# TCC and screencapture prints "could not create image from display" — run this
# from a normal Terminal session that has the permission. (No Accessibility
# permission needed: we open each pane via `--pane`, not injected keystrokes.)
#
# For a truly background/CI path (no window, no TCC), see
# core/pd-console/docs/recording-visual-artifacts.md — Method A (offscreen wgpu
# render + ffmpeg, for the Vello surfaces) and Method B (headless virtual display).
#
# Usage:  core/pd-console/scripts/capture-gpui.sh [output-dir]
# Output: window-<pane>.png for a representative set of panes, cropped to the app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # core/pd-console
OUT="${1:-$ROOT/docs/artifacts/gpui}"
BIN="$ROOT/../target/release/pd-console"
mkdir -p "$OUT"

if [[ ! -x "$BIN" ]]; then
  echo "Building release window…"
  ( cd "$ROOT" && cargo build --release --features gpui --bin pd-console )
fi

cleanup() { pkill -f "target/release/pd-console" 2>/dev/null || true; }
trap cleanup EXIT

# The pd-console window's CGWindowID via Quartz. `screencapture -l<id>` then
# grabs that window's own backing store regardless of z-order — so a terminal
# sitting in front of it can't occlude the shot (region-based -R can't do that).
# Owner-name filtering needs no Screen Recording permission; capturing the image
# does (run from a permitted Terminal).
windowid() {
  python3 - <<'PY' 2>/dev/null
import Quartz
ws = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID)
# Pick the largest pd-console window (skip any tiny helper surfaces).
best = None
for w in ws:
    if str(w.get('kCGWindowOwnerName','')) == 'pd-console':
        b = w['kCGWindowBounds']
        area = int(b['Width']) * int(b['Height'])
        if best is None or area > best[1]:
            best = (int(w['kCGWindowNumber']), area)
if best:
    print(best[0])
PY
}

shoot() { # $1 = pane id, $2 = filename label
  cleanup; sleep 1
  "$BIN" --pane "$1" >/dev/null 2>&1 &
  sleep 5  # window open + first 2s refresh + 500ms drain
  local id; id="$(windowid)" || true
  if [[ "${id:-}" =~ ^[0-9]+$ ]]; then
    screencapture -x -o -l"$id" "$OUT/window-$2.png"
    echo "captured $2  (window id $id)"
  else
    screencapture -x "$OUT/window-$2.png"   # whole-screen fallback
    echo "captured $2  (FULL SCREEN — window id not found)"
  fi
}

shoot fleet         fleet
shoot sorties       sorties
shoot dispatch      dispatch
shoot sessions      sessions
shoot health        health
shoot lane          lane            # the live "watch + grab the wheel" surface
shoot active-agents active-agents   # harness roster: LIVE/READY/PARTIAL/UNPROTECTED + repair actions

echo "done → $OUT"
