#!/usr/bin/env bash
# Build pd-console release binary and install to ~/Applications/pd-console.app
# Usage: ./scripts/install-app.sh [--open]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$HOME/Applications/pd-console.app"
BIN_DEST="$APP_DIR/Contents/MacOS/pd-console"

echo "→ Building pd-console (release, GPU-native window)…"
cd "$CRATE_DIR"
# The window bin is gated behind the `gpui` feature (see Cargo.toml) — without it
# the bin is skipped and target/release/pd-console won't exist.
cargo build --release --features gpui --bin pd-console

echo "→ Installing to $APP_DIR…"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "target/release/pd-console" "$BIN_DEST"

# Write Info.plist (idempotent)
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>pd-console</string>
    <key>CFBundleIdentifier</key>
    <string>dev.portdaddy.pd-console</string>
    <key>CFBundleName</key>
    <string>pd-console</string>
    <key>CFBundleDisplayName</key>
    <string>pd-console</string>
    <key>CFBundleVersion</key>
    <string>0.2.0</string>
    <key>CFBundleShortVersionString</key>
    <string>0.2.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
PLIST

echo "✓ Installed  $BIN_DEST"
echo ""
echo "Launch options:"
echo "  open ~/Applications/pd-console.app"
echo "  Spotlight → pd-console"
echo "  Dock → drag ~/Applications/pd-console.app to dock"

if [[ "${1:-}" == "--open" ]]; then
    echo "→ Opening…"
    open "$APP_DIR"
fi
