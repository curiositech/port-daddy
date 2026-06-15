#!/usr/bin/env bash
# Build a zipped FleetBar.app local artifact.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEETBAR_DIR="$ROOT_DIR/apps/FleetBar"
OUT_DIR="${1:-"$ROOT_DIR/website-v2/public/downloads"}"
ARCH="${PORT_DADDY_FLEETBAR_ARCH:-$(uname -m)}"
ZIP_NAME="${PORT_DADDY_FLEETBAR_ZIP:-PortDaddy-FleetBar-macOS-${ARCH}.zip}"
APP_NAME="FleetBar.app"
APP_ICON_SRC="$FLEETBAR_DIR/FleetBar/Resources/FleetBarIcon.icns"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$FLEETBAR_DIR"
swift build -c release

RELEASE_BIN="$(find "$FLEETBAR_DIR/.build" -path "*/release/FleetBar" -type f | head -n 1)"
if [[ -z "$RELEASE_BIN" || ! -f "$RELEASE_BIN" ]]; then
  echo "FleetBar release binary not found under $FLEETBAR_DIR/.build" >&2
  exit 1
fi

if [[ ! -f "$FLEETBAR_DIR/FleetBar-Info.plist" ]]; then
  echo "FleetBar app metadata missing: $FLEETBAR_DIR/FleetBar-Info.plist" >&2
  exit 1
fi

if [[ ! -f "$APP_ICON_SRC" ]]; then
  echo "FleetBar app icon missing: $APP_ICON_SRC" >&2
  echo "Regenerate it with: bash scripts/generate-fleetbar-icon.sh" >&2
  exit 1
fi

APP_BUNDLE="$TMP_DIR/$APP_NAME"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"

mkdir -p "$APP_MACOS" "$APP_RESOURCES" "$OUT_DIR"
cp "$RELEASE_BIN" "$APP_MACOS/FleetBar"
cp "$FLEETBAR_DIR/FleetBar-Info.plist" "$APP_CONTENTS/Info.plist"
cp "$APP_ICON_SRC" "$APP_RESOURCES/FleetBarIcon.icns"
chmod +x "$APP_MACOS/FleetBar"

# Stamp the real version into the bundle so the running app can detect when it
# has drifted behind the daemon (BuildInfo.swift reads CFBundleShortVersionString).
# Source of truth is the repo's package.json; never the static placeholder plist.
PD_VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || true)"
if [[ -z "$PD_VERSION" ]]; then
  PD_VERSION="$(grep -m1 '"version"' "$ROOT_DIR/package.json" | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
fi
if [[ -n "$PD_VERSION" && -x /usr/libexec/PlistBuddy ]]; then
  # CFBundleShortVersionString is the display/marketing string and tolerates a
  # SemVer suffix (3.19.0-rc.1). CFBundleVersion must be numeric-only per
  # Apple's bundle spec — a prerelease/build suffix there breaks notarization
  # and Gatekeeper tooling — so strip everything from the first - or +.
  PD_BUILD_VERSION="${PD_VERSION%%-*}"
  PD_BUILD_VERSION="${PD_BUILD_VERSION%%+*}"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $PD_VERSION" "$APP_CONTENTS/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $PD_BUILD_VERSION" "$APP_CONTENTS/Info.plist"
  echo "Stamped FleetBar bundle version $PD_VERSION (CFBundleVersion $PD_BUILD_VERSION)"
else
  echo "WARN: could not stamp FleetBar version (PlistBuddy or package.json version missing); app reports 'unknown'" >&2
fi

ZIP_PATH="$OUT_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH" "$ZIP_PATH.sha256"

if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --norsrc --keepParent "$APP_BUNDLE" "$ZIP_PATH"
else
  (cd "$TMP_DIR" && zip -qry "$ZIP_PATH" "$APP_NAME")
fi

SHA="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$SHA" "$ZIP_NAME" > "$ZIP_PATH.sha256"

cat > "$OUT_DIR/fleetbar-preview-manifest.json" <<JSON
{
  "name": "Port Daddy FleetBar",
  "channel": "local-build",
  "platform": "macOS",
  "arch": "$ARCH",
  "artifact": "$ZIP_NAME",
  "sha256": "$SHA",
  "unsigned": true,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "Packaged $ZIP_PATH"
echo "SHA-256 $SHA"
