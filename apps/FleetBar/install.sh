#!/bin/bash
# Install FleetBar as a LaunchAgent (auto-start on login)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.portdaddy.fleetbar.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.portdaddy.fleetbar.plist"
LOG_DIR="$HOME/.port-daddy"

echo "Building FleetBar..."
cd "$SCRIPT_DIR"
swift build -c release 2>&1 | tail -3

# Update plist to point to release binary
RELEASE_BIN="$SCRIPT_DIR/.build/arm64-apple-macosx/release/FleetBar"
if [ ! -f "$RELEASE_BIN" ]; then
    echo "Error: Release binary not found at $RELEASE_BIN"
    exit 1
fi

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Create plist with release path
sed "s|/debug/FleetBar|/release/FleetBar|" "$PLIST_SRC" > "$PLIST_DST"

# Unload if already running
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Load
launchctl load "$PLIST_DST"

echo ""
echo "FleetBar installed!"
echo "  Binary:  $RELEASE_BIN"
echo "  Plist:   $PLIST_DST"
echo "  Logs:    $LOG_DIR/fleetbar-*.log"
echo ""
echo "FleetBar will auto-start on login."
echo "To uninstall: launchctl unload $PLIST_DST && rm $PLIST_DST"
