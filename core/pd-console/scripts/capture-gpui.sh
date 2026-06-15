#!/bin/bash
# Capture native GPUI window screenshots for the pd-console PR test plan.
#
# Per the standing rule, every GPUI/console diff ships window screenshots. The
# capture needs macOS Screen Recording permission for the terminal/process that
# runs this script (System Settings → Privacy & Security → Screen Recording).
# A background/headless context (e.g. a CI runner or detached agent) is denied by
# TCC and screencapture prints "could not create image from display" — run this
# from a normal Terminal session that has the permission.
#
# Usage:  core/pd-console/scripts/capture-gpui.sh [output-dir]
# Output: window-<pane>.png for a representative set of panes + a short gif.
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

cleanup; sleep 1
"$BIN" >/dev/null 2>&1 &
sleep 6   # window open + first 2s refresh + 500ms drain

proc() { osascript -e 'tell application "System Events" to first process whose name contains "pd-console"'; }

# Region of the window (position + size), so we crop to just the app.
read -r X Y W H < <(osascript -e \
  'tell application "System Events" to tell (first process whose name contains "pd-console") to get position & size of window 1' \
  2>/dev/null | tr ',' ' ')
echo "window region: $X $Y $W $H"

shoot() { # $1 = pane key, $2 = filename label
  osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "pd-console") to true' || true
  if [[ -n "${1:-}" ]]; then
    osascript -e "tell application \"System Events\" to keystroke \"$1\"" || true
    sleep 2  # let the 500ms drain + 2s refresh settle on the new pane
  fi
  if [[ -n "${X:-}" ]]; then
    screencapture -x -R"$X,$Y,$W,$H" "$OUT/window-$2.png"
  else
    screencapture -x "$OUT/window-$2.png"      # whole screen fallback
  fi
  echo "captured $2"
}

shoot ""  fleet      # default pane (slot 0)
shoot "3" sorties    # SortiePane multiplexer (slot 2)
shoot "d" dispatch   # DispatchQueuePane review queue (slot 15)
shoot "9" sessions   # SessionsPane (slot 8)
shoot "h" health     # HealthPane (slot 13)

echo "done → $OUT"
