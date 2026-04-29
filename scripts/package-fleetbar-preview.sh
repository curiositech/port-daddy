#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLEETBAR_DIR="$REPO_ROOT/apps/FleetBar"
DOWNLOADS_DIR="$REPO_ROOT/website-v2/public/downloads"
ARTIFACT_NAME="PortDaddy-FleetBar-macOS-arm64-dev.zip"
ZIP_PATH="$DOWNLOADS_DIR/$ARTIFACT_NAME"
CHECKSUM_PATH="$ZIP_PATH.sha256"
MANIFEST_PATH="$DOWNLOADS_DIR/fleetbar-preview-manifest.json"
APP_INFO_PLIST_SRC="$FLEETBAR_DIR/FleetBar-Info.plist"
ARCH="$(uname -m)"

if [[ "$ARCH" != "arm64" ]]; then
  echo "FleetBar preview artifact is named for arm64; run this package script on Apple Silicon." >&2
  exit 1
fi

if [[ ! -f "$APP_INFO_PLIST_SRC" ]]; then
  echo "Missing FleetBar app metadata: $APP_INFO_PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$DOWNLOADS_DIR"

echo "Building FleetBar release binary..."
(
  cd "$FLEETBAR_DIR"
  swift build -c release
)

RELEASE_BIN="$FLEETBAR_DIR/.build/arm64-apple-macosx/release/FleetBar"
if [[ ! -f "$RELEASE_BIN" ]]; then
  RELEASE_BIN="$FLEETBAR_DIR/.build/release/FleetBar"
fi

if [[ ! -f "$RELEASE_BIN" ]]; then
  echo "Release binary not found after swift build." >&2
  exit 1
fi

if ! file "$RELEASE_BIN" | grep -q 'arm64'; then
  echo "Release binary is not arm64: $(file "$RELEASE_BIN")" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PAYLOAD_DIR="$WORK_DIR/payload"
APP_BUNDLE="$PAYLOAD_DIR/FleetBar.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BIN="$APP_MACOS/FleetBar"

mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$RELEASE_BIN" "$APP_BIN"
cp "$APP_INFO_PLIST_SRC" "$APP_CONTENTS/Info.plist"
chmod +x "$APP_BIN"

cat > "$PAYLOAD_DIR/README.txt" <<'README'
Port Daddy FleetBar developer preview

This archive contains FleetBar.app, the macOS menu-bar companion for Port Daddy.
It is built from apps/FleetBar in the Port Daddy repository by:

  npm run package:fleetbar-preview

This developer preview is ad-hoc signed, not Developer ID signed or notarized.
macOS may require Open Anyway in System Settings. The full daemon, CLI, MCP
wiring, and project setup still come from the normal Port Daddy install path.
README

if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$APP_BUNDLE" >/dev/null
  codesign --verify --deep --strict "$APP_BUNDLE"
else
  echo "codesign not found; cannot produce the advertised ad-hoc signed preview." >&2
  exit 1
fi

rm -f "$ZIP_PATH" "$CHECKSUM_PATH"
(
  cd "$PAYLOAD_DIR"
  ditto -c -k --norsrc . "$ZIP_PATH"
)

SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$SHA256" "$ARTIFACT_NAME" > "$CHECKSUM_PATH"

SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
REPO_DIRTY="false"
if ! git -C "$REPO_ROOT" diff --quiet || [[ -n "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)" ]]; then
  REPO_DIRTY="true"
fi

FLEETBAR_SOURCE_DIRTY="false"
if ! git -C "$REPO_ROOT" diff --quiet -- apps/FleetBar; then
  FLEETBAR_SOURCE_DIRTY="true"
fi

BUNDLE_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_CONTENTS/Info.plist")"
BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_CONTENTS/Info.plist")"
BUNDLE_SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_CONTENTS/Info.plist")"
ARTIFACT_SIZE_BYTES="$(wc -c < "$ZIP_PATH" | tr -d ' ')"

FLEETBAR_PREVIEW_NAME="Port Daddy FleetBar" \
FLEETBAR_PREVIEW_CHANNEL="developer-preview" \
FLEETBAR_PREVIEW_PLATFORM="macOS" \
FLEETBAR_PREVIEW_ARCH="$ARCH" \
FLEETBAR_PREVIEW_ARTIFACT="$ARTIFACT_NAME" \
FLEETBAR_PREVIEW_SHA256="$SHA256" \
FLEETBAR_PREVIEW_SIZE_BYTES="$ARTIFACT_SIZE_BYTES" \
FLEETBAR_PREVIEW_BUNDLE_IDENTIFIER="$BUNDLE_IDENTIFIER" \
FLEETBAR_PREVIEW_BUNDLE_VERSION="$BUNDLE_VERSION" \
FLEETBAR_PREVIEW_BUNDLE_SHORT_VERSION="$BUNDLE_SHORT_VERSION" \
FLEETBAR_PREVIEW_SOURCE_COMMIT="$SOURCE_COMMIT" \
FLEETBAR_PREVIEW_REPO_DIRTY="$REPO_DIRTY" \
FLEETBAR_PREVIEW_FLEETBAR_SOURCE_DIRTY="$FLEETBAR_SOURCE_DIRTY" \
FLEETBAR_PREVIEW_MANIFEST_PATH="$MANIFEST_PATH" \
node <<'NODE'
const fs = require('node:fs')

const manifest = {
  name: process.env.FLEETBAR_PREVIEW_NAME,
  channel: process.env.FLEETBAR_PREVIEW_CHANNEL,
  platform: process.env.FLEETBAR_PREVIEW_PLATFORM,
  arch: process.env.FLEETBAR_PREVIEW_ARCH,
  artifact: process.env.FLEETBAR_PREVIEW_ARTIFACT,
  sha256: process.env.FLEETBAR_PREVIEW_SHA256,
  sizeBytes: Number(process.env.FLEETBAR_PREVIEW_SIZE_BYTES),
  signature: 'adhoc',
  developerIdSigned: false,
  notarized: false,
  releaseGate: 'Developer ID Application certificate and notarization credentials',
  minimumMacOS: '14.0',
  bundle: {
    identifier: process.env.FLEETBAR_PREVIEW_BUNDLE_IDENTIFIER,
    version: process.env.FLEETBAR_PREVIEW_BUNDLE_VERSION,
    shortVersion: process.env.FLEETBAR_PREVIEW_BUNDLE_SHORT_VERSION,
  },
  source: {
    repository: 'curiositech/port-daddy',
    commit: process.env.FLEETBAR_PREVIEW_SOURCE_COMMIT,
    repoDirty: process.env.FLEETBAR_PREVIEW_REPO_DIRTY === 'true',
    fleetbarSourceDirty: process.env.FLEETBAR_PREVIEW_FLEETBAR_SOURCE_DIRTY === 'true',
    appPath: 'apps/FleetBar',
    packagingScript: 'scripts/package-fleetbar-preview.sh',
    buildCommand: 'npm run package:fleetbar-preview',
  },
  generatedBy: 'scripts/package-fleetbar-preview.sh',
  generatedAt: new Date().toISOString(),
}

fs.writeFileSync(process.env.FLEETBAR_PREVIEW_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
NODE

echo "Packaged FleetBar preview:"
echo "  Zip:      $ZIP_PATH"
echo "  SHA-256:  $SHA256"
echo "  Checksum: $CHECKSUM_PATH"
echo "  Manifest: $MANIFEST_PATH"
