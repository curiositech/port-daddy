#!/bin/bash
# Build Fleet Live menu bar app
# Usage: ./build.sh [debug|release]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${1:-debug}"

if [[ "$CONFIG" == "release" ]]; then
    XCODE_CONFIG="Release"
else
    XCODE_CONFIG="Debug"
fi

echo "Building Fleet Live ($XCODE_CONFIG)..."

xcodebuild \
    -project "$SCRIPT_DIR/FleetLive.xcodeproj" \
    -scheme FleetLive \
    -configuration "$XCODE_CONFIG" \
    -derivedDataPath "$SCRIPT_DIR/.build" \
    build 2>&1 | tail -20

APP_PATH="$SCRIPT_DIR/.build/Build/Products/$XCODE_CONFIG/FleetLive.app"

if [[ -d "$APP_PATH" ]]; then
    echo ""
    echo "Build succeeded: $APP_PATH"
    echo ""
    echo "To run:  open '$APP_PATH'"
    echo "To install to /Applications:  cp -R '$APP_PATH' /Applications/"
else
    echo "Build failed -- see output above."
    exit 1
fi
