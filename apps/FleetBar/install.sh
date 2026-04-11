#!/bin/bash
# Install FleetBar as a LaunchAgent (auto-start on login)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.portdaddy.fleetbar.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.portdaddy.fleetbar.plist"
LOG_DIR="$HOME/.port-daddy"
APP_INFO_PLIST_SRC="$SCRIPT_DIR/FleetBar-Info.plist"
INSTALL_ROOT="$HOME/Applications/Port Daddy"
APP_BUNDLE="$INSTALL_ROOT/FleetBar.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BIN="$APP_MACOS/FleetBar"

echo "Building FleetBar..."
cd "$SCRIPT_DIR"
swift build -c release 2>&1 | tail -3

RELEASE_BIN="$SCRIPT_DIR/.build/arm64-apple-macosx/release/FleetBar"

if [ ! -f "$RELEASE_BIN" ]; then
    echo "Error: Release binary not found at $RELEASE_BIN"
    exit 1
fi

if [ ! -f "$APP_INFO_PLIST_SRC" ]; then
    echo "Error: FleetBar app metadata missing at $APP_INFO_PLIST_SRC"
    exit 1
fi

# Ensure log directory exists
mkdir -p "$LOG_DIR"
mkdir -p "$INSTALL_ROOT"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"

# SwiftUI's MenuBarExtra needs a real app bundle. Launching the bare SwiftPM
# executable leaves FleetBar without bundle metadata, which can keep the menu bar
# UI from materializing even though launchd shows a running process.
cp "$RELEASE_BIN" "$APP_BIN"
cp "$APP_INFO_PLIST_SRC" "$APP_CONTENTS/Info.plist"
chmod +x "$APP_BIN"

# Create plist with installed app executable path
sed "s|/Users/erichowens/coding/port-daddy/apps/FleetBar/.build/arm64-apple-macosx/debug/FleetBar|$APP_BIN|" "$PLIST_SRC" > "$PLIST_DST"

# Unload if already running
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Clear out stale manually launched or pre-bundle FleetBar copies so only the
# bundled launchd-managed app remains.
pkill -x FleetBar 2>/dev/null || true

# Load
launchctl load "$PLIST_DST"

echo ""
echo "FleetBar installed!"
echo "  App:     $APP_BUNDLE"
echo "  Binary:  $APP_BIN"
echo "  Plist:   $PLIST_DST"
echo "  Logs:    $LOG_DIR/fleetbar-*.log"
echo ""
echo "FleetBar will auto-start on login."
echo "To uninstall: launchctl unload $PLIST_DST && rm $PLIST_DST"
