#!/usr/bin/env bash
# install-app-watch.sh — install the com.portdaddy.appwatch LaunchAgent that
# keeps the operator's app lanes fresh (see scripts/pd-app-watch.sh):
#
#   origin/main moved      → rebuild + relaunch pd-console-latest.app + FleetBar (dev-latest).app
#   homebrew tap cut vX.Y.Z → brew upgrade + rebuild + relaunch pd-console-prod.app + FleetBar.app
#
# Idempotent; re-running updates the installed watcher copy and reloads the agent.
#
# Usage:
#   bash scripts/install-app-watch.sh              # seed state to current main/tap (no build storm)
#   bash scripts/install-app-watch.sh --build-now  # additionally force a first latest-lane build
set -euo pipefail

# Shared HOOK_OFF_GATE from lib/hook-runtime-gate.ts; never invokes PD.
pd_hook_runtime_enabled() (
  [ "$#" -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || exit 1
  pd_gate_home="$2"
  for pd_gate_root in "$1" "$pd_gate_home"; do
    if [ ! -e "$pd_gate_root" ] && [ ! -L "$pd_gate_root" ]; then
      [ -d "${pd_gate_root%/*}" ] && [ -r "${pd_gate_root%/*}" ] && [ -x "${pd_gate_root%/*}" ] || exit 1
      continue
    fi
    [ -d "$pd_gate_root" ] && [ -r "$pd_gate_root" ] && [ -x "$pd_gate_root" ] && [ ! -L "$pd_gate_root" ] || exit 1
    for pd_gate_marker in "$pd_gate_root/hooks.disabled" "$pd_gate_root/HALT"; do
      [ ! -e "$pd_gate_marker" ] && [ ! -L "$pd_gate_marker" ] || exit 1
    done
  done
  pd_gate_halt="${PD_HALT_FILE:-$pd_gate_home/HALT}"
  case "$pd_gate_halt" in /*) ;; *) exit 1 ;; esac
  pd_gate_parent="${pd_gate_halt%/*}"
  [ -d "$pd_gate_parent" ] && [ -r "$pd_gate_parent" ] && [ -x "$pd_gate_parent" ] || exit 1
  [ ! -e "$pd_gate_halt" ] && [ ! -L "$pd_gate_halt" ]
)

pd_require_on() {
  pd_hook_runtime_enabled "${HOME:+$HOME/.port-daddy}" "${PD_HOME:-${HOME:+$HOME/.port-daddy}}" || {
    echo "Port Daddy is Off or its control state is unknown; automatic work skipped." >&2
    exit 0
  }
}

pd_require_on


HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$HOME/.port-daddy/app-watch"
BIN_DIR="$HOME/.port-daddy/bin"
PLIST="$HOME/Library/LaunchAgents/com.portdaddy.appwatch.plist"
LABEL="com.portdaddy.appwatch"
GUI="gui/$(id -u)"
BUILD_NOW=0
[ "${1:-}" = "--build-now" ] && BUILD_NOW=1

mkdir -p "$BASE" "$BIN_DIR"
cp "$HERE/pd-app-watch.sh" "$BIN_DIR/pd-app-watch.sh"
cp "$HERE/install-app-watch.sh" "$BIN_DIR/install-app-watch.sh" 2>/dev/null || true
chmod +x "$BIN_DIR/pd-app-watch.sh" "$BIN_DIR/install-app-watch.sh" 2>/dev/null || true

# Seed state to the CURRENT world so installation itself doesn't trigger a build
# storm — the watcher only reacts to movement from here on. --build-now overrides
# for the latest lanes (first real build proves the pipeline end to end).
if [ ! -f "$BASE/built-main-sha" ]; then
  pd_require_on
  SHA="$(git ls-remote https://github.com/curiositech/port-daddy.git refs/heads/main 2>/dev/null | cut -f1 || true)"
  [ -n "$SHA" ] && printf '%s' "$SHA" > "$BASE/built-main-sha" && echo "▸ seeded built-main-sha = ${SHA:0:10}"
fi
if [ ! -f "$BASE/built-prod-version" ]; then
  pd_require_on
  V="$(curl -fsSL --max-time 20 https://raw.githubusercontent.com/curiositech/homebrew-tap/HEAD/Formula/port-daddy.rb 2>/dev/null | sed -nE 's/^ *version "([^"]+)".*/\1/p' | head -1 || true)"
  [ -n "$V" ] && printf '%s' "$V" > "$BASE/built-prod-version" && echo "▸ seeded built-prod-version = $V"
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$BIN_DIR/pd-app-watch.sh</string>
  </array>
  <key>StartInterval</key><integer>180</integer>
  <key>RunAtLoad</key><true/>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME/.port-daddy/app-watch.log</string>
  <key>StandardErrorPath</key><string>$HOME/.port-daddy/app-watch.log</string>
</dict>
</plist>
PLIST

pd_require_on
launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
pd_require_on
launchctl bootstrap "$GUI" "$PLIST"
echo "✓ $LABEL installed (polls every 3 min; log: ~/.port-daddy/app-watch.log)"

if [ "$BUILD_NOW" = 1 ]; then
  pd_require_on
  echo "▸ forcing first latest-lane build (this can take a while on a cold clone)…"
  bash "$BIN_DIR/pd-app-watch.sh" --force-latest
fi
