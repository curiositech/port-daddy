#!/bin/bash
# Install FleetBar as a LaunchAgent (auto-start on login)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_TEMPLATE="$SCRIPT_DIR/com.portdaddy.fleetbar.plist.template"
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

# Copy the Dock/Finder/Cmd-Tab app icon into the bundle. Info.plist references
# `FleetBarIcon` via CFBundleIconFile, so the .icns must live at
# Contents/Resources/FleetBarIcon.icns. Without this, macOS shows the generic
# blank-grid placeholder in the Dock even though the menu bar status item works.
ICON_SRC="$SCRIPT_DIR/FleetBar/Resources/FleetBarIcon.icns"
if [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$APP_RESOURCES/FleetBarIcon.icns"
else
    echo "Warning: $ICON_SRC missing; Dock will show generic icon"
fi

# Bust the macOS icon cache so the Dock picks up the new icon immediately
# instead of waiting for relaunch / login.
touch "$APP_BUNDLE"
/usr/bin/killall -HUP Dock 2>/dev/null || true

# Render the LaunchAgent plist from the committed template, substituting the
# machine-local absolute paths. No home path is hardcoded anywhere — every value
# is derived from $HOME / the checkout location at install time.
sed \
    -e "s|__FLEETBAR_BINARY__|$APP_BIN|g" \
    -e "s|__FLEETBAR_WORKDIR__|$SCRIPT_DIR|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$PLIST_TEMPLATE" > "$PLIST_DST"

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
