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
  SHA="$(git ls-remote https://github.com/curiositech/port-daddy.git refs/heads/main 2>/dev/null | cut -f1 || true)"
  [ -n "$SHA" ] && printf '%s' "$SHA" > "$BASE/built-main-sha" && echo "▸ seeded built-main-sha = ${SHA:0:10}"
fi
if [ ! -f "$BASE/built-prod-version" ]; then
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

launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
echo "✓ $LABEL installed (polls every 3 min; log: ~/.port-daddy/app-watch.log)"

if [ "$BUILD_NOW" = 1 ]; then
  echo "▸ forcing first latest-lane build (this can take a while on a cold clone)…"
  bash "$BIN_DIR/pd-app-watch.sh" --force-latest
fi
