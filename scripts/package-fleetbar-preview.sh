#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLEETBAR_DIR="$REPO_ROOT/apps/FleetBar"
DOWNLOADS_DIR="$REPO_ROOT/website-v2/public/downloads"
ARTIFACT_NAME="PortDaddy-FleetBar-macOS-arm64.zip"
ZIP_PATH="$DOWNLOADS_DIR/$ARTIFACT_NAME"
CHECKSUM_PATH="$ZIP_PATH.sha256"
MANIFEST_PATH="$DOWNLOADS_DIR/fleetbar-preview-manifest.json"
APP_INFO_PLIST_SRC="$FLEETBAR_DIR/FleetBar-Info.plist"
APP_ICON_SRC="$FLEETBAR_DIR/FleetBar/Resources/FleetBarIcon.icns"
PORT_DADDY_ENTITLEMENTS="$REPO_ROOT/scripts/entitlements/port-daddy.plist"
ARCH="$(uname -m)"
SIGNING_MODE="${FLEETBAR_SIGNING_MODE:-auto}"
SIGNING_IDENTITY="${FLEETBAR_SIGNING_IDENTITY:-}"
NOTARIZE="${FLEETBAR_NOTARIZE:-auto}"
NOTARY_PROFILE="${FLEETBAR_NOTARY_PROFILE:-}"

if [[ "$ARCH" != "arm64" ]]; then
  echo "FleetBar preview artifact is named for arm64; run this package script on Apple Silicon." >&2
  exit 1
fi

if [[ ! -f "$APP_INFO_PLIST_SRC" ]]; then
  echo "Missing FleetBar app metadata: $APP_INFO_PLIST_SRC" >&2
  exit 1
fi

if [[ ! -f "$APP_ICON_SRC" ]]; then
  echo "Missing FleetBar app icon: $APP_ICON_SRC" >&2
  echo "Regenerate it with: bash scripts/generate-fleetbar-icon.sh" >&2
  exit 1
fi

if [[ ! -f "$PORT_DADDY_ENTITLEMENTS" ]]; then
  echo "Missing Port Daddy hardened-runtime entitlements: $PORT_DADDY_ENTITLEMENTS" >&2
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

if [[ "$SIGNING_MODE" != "auto" && "$SIGNING_MODE" != "developer-id" && "$SIGNING_MODE" != "adhoc" ]]; then
  echo "FLEETBAR_SIGNING_MODE must be auto, developer-id, or adhoc." >&2
  exit 1
fi

fleetbar_bun_target() {
  case "$ARCH" in
    arm64|aarch64)
      echo "bun-darwin-arm64"
      ;;
    x86_64|amd64)
      echo "bun-darwin-x64"
      ;;
    *)
      echo "Unsupported FleetBar architecture for bundled Port Daddy payload: $ARCH" >&2
      exit 1
      ;;
  esac
}

bundle_port_daddy_payload() {
  local payload_dir="$1"
  local target
  target="$(fleetbar_bun_target)"

  mkdir -p "$payload_dir"
  echo "Building bundled Port Daddy payload ($target) with embedded Rust core..."
  node "$REPO_ROOT/scripts/build-single-binary.mjs" --target="$target" --outfile="$payload_dir/pd"

  if [[ ! -x "$payload_dir/pd" || ! -x "$payload_dir/port-daddy" || ! -f "$payload_dir/port-daddy-manifest.json" ]]; then
    echo "Bundled Port Daddy payload is incomplete in $payload_dir" >&2
    exit 1
  fi

  node -e '
    const fs = require("node:fs");
    const manifestPath = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.embeddedNativeCore?.status !== "embedded") {
      throw new Error(`expected embedded native Rust core, got ${manifest.embeddedNativeCore?.status || "missing"}`);
    }
    if (manifest.smoke?.daemon?.arbiter?.enforcerLoaded !== true) {
      throw new Error("expected packaged Port Daddy smoke to load the native Arbiter enforcer");
    }
  ' "$payload_dir/port-daddy-manifest.json"
}

refresh_port_daddy_payload_manifest() {
  local payload_dir="$1"
  local signature_label="$2"

  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");

    const payloadDir = process.argv[1];
    const signatureLabel = process.argv[2];
    const manifestPath = path.join(payloadDir, "port-daddy-manifest.json");
    const binaryPath = path.join(payloadDir, "port-daddy");
    const launcherPath = path.join(payloadDir, "pd");
    const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.sizeBytes = fs.statSync(binaryPath).size;
    manifest.sha256 = sha256(binaryPath);
    manifest.launcherSha256 = sha256(launcherPath);
    manifest.signature = {
      label: signatureLabel,
      refreshedAt: new Date().toISOString(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ' "$payload_dir" "$signature_label"
}

detect_developer_id_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
    | head -n 1
}

if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="$(detect_developer_id_identity)"
fi

RESOLVED_SIGNING_MODE="$SIGNING_MODE"
if [[ "$RESOLVED_SIGNING_MODE" == "auto" ]]; then
  if [[ -n "$SIGNING_IDENTITY" ]]; then
    RESOLVED_SIGNING_MODE="developer-id"
  else
    RESOLVED_SIGNING_MODE="adhoc"
  fi
fi

if [[ "$RESOLVED_SIGNING_MODE" == "developer-id" && -z "$SIGNING_IDENTITY" ]]; then
  echo "Developer ID signing requested, but no Developer ID Application identity was found." >&2
  echo "Install the certificate or set FLEETBAR_SIGNING_IDENTITY." >&2
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
PORT_DADDY_PAYLOAD_DIR="$APP_RESOURCES/PortDaddy"

mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$RELEASE_BIN" "$APP_BIN"
cp "$APP_INFO_PLIST_SRC" "$APP_CONTENTS/Info.plist"
cp "$APP_ICON_SRC" "$APP_RESOURCES/FleetBarIcon.icns"
chmod +x "$APP_BIN"

# Dev/preview identity (ADR-0084). A preview build must NOT inherit the shipped
# app's bundle id (ai.portdaddy.FleetBar): it would be indistinguishable in
# LaunchServices and the FleetBar single-instance guard, keyed on bundle id,
# would treat a preview launched beside the installed app as the same app and
# reap it. Stamp a distinct `dev.portdaddy.fleetbar.<label>` id plus a visible
# CFBundleDisplayName so a dev FleetBar runs alongside production and is labelled
# everywhere — menu bar ("DEV"), Cmd-Tab, and Activity Monitor. The label
# defaults to the current branch slug; override with FLEETBAR_PREVIEW_LABEL.
PREVIEW_LABEL="${FLEETBAR_PREVIEW_LABEL:-}"
if [[ -z "$PREVIEW_LABEL" ]]; then
  PREVIEW_LABEL="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null \
    | tr '[:upper:]' '[:lower:]' | sed 's#[^a-z0-9]#-#g; s#-\{2,\}#-#g; s#^-##; s#-$##')"
fi
PREVIEW_LABEL="${PREVIEW_LABEL:-preview}"
PREVIEW_BUNDLE_ID="dev.portdaddy.fleetbar.${PREVIEW_LABEL}"
PREVIEW_DISPLAY_NAME="FleetBar dev (${PREVIEW_LABEL})"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${PREVIEW_BUNDLE_ID}" "$APP_CONTENTS/Info.plist"
if /usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" "$APP_CONTENTS/Info.plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${PREVIEW_DISPLAY_NAME}" "$APP_CONTENTS/Info.plist"
else
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ${PREVIEW_DISPLAY_NAME}" "$APP_CONTENTS/Info.plist"
fi
echo "Stamped preview identity: ${PREVIEW_BUNDLE_ID} (${PREVIEW_DISPLAY_NAME})"

bundle_port_daddy_payload "$PORT_DADDY_PAYLOAD_DIR"

SIGNATURE_LABEL="ad-hoc"
DEVELOPER_ID_SIGNED="false"
SIGNING_IDENTITY_FOR_MANIFEST=""
TEAM_IDENTIFIER=""
NOTARIZED="false"
NOTARY_REQUEST_ID=""
NOTARIZATION_STATUS="not-submitted"

cat > "$PAYLOAD_DIR/README.txt" <<README
Port Daddy FleetBar signed Mac build

This archive contains FleetBar.app, the macOS menu-bar companion for Port Daddy.
It is built from apps/FleetBar in the Port Daddy repository by:

  npm run package:fleetbar-preview

The full daemon, CLI, MCP wiring, and project setup still come from the normal
Port Daddy install path. This .app also carries a matching bundled Port Daddy
payload at Contents/Resources/PortDaddy, including the single-binary manifest
that proves the native Rust core was embedded and smoke-loaded.
README

if ! command -v codesign >/dev/null 2>&1; then
  echo "codesign not found; cannot produce a signed preview." >&2
  exit 1
fi

if [[ "$RESOLVED_SIGNING_MODE" == "developer-id" ]]; then
  echo "Signing bundled Port Daddy payload with Developer ID: $SIGNING_IDENTITY"
  codesign --force --options runtime --timestamp --entitlements "$PORT_DADDY_ENTITLEMENTS" --sign "$SIGNING_IDENTITY" "$PORT_DADDY_PAYLOAD_DIR/port-daddy" >/dev/null
  codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$PORT_DADDY_PAYLOAD_DIR/pd" >/dev/null
  refresh_port_daddy_payload_manifest "$PORT_DADDY_PAYLOAD_DIR" "developer-id"
  echo "Signing FleetBar.app with Developer ID: $SIGNING_IDENTITY"
  codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP_BUNDLE" >/dev/null
  SIGNATURE_LABEL="developer-id"
  DEVELOPER_ID_SIGNED="true"
  SIGNING_IDENTITY_FOR_MANIFEST="$SIGNING_IDENTITY"
else
  echo "Signing bundled Port Daddy payload with ad-hoc identity."
  codesign --force --entitlements "$PORT_DADDY_ENTITLEMENTS" --sign - "$PORT_DADDY_PAYLOAD_DIR/port-daddy" >/dev/null
  codesign --force --sign - "$PORT_DADDY_PAYLOAD_DIR/pd" >/dev/null
  refresh_port_daddy_payload_manifest "$PORT_DADDY_PAYLOAD_DIR" "ad-hoc"
  echo "Signing FleetBar.app with ad-hoc identity."
  codesign --force --sign - "$APP_BUNDLE" >/dev/null
fi

codesign --verify --deep --strict "$APP_BUNDLE"
TEAM_IDENTIFIER="$(codesign -dv --verbose=4 "$APP_BUNDLE" 2>&1 | awk -F= '/TeamIdentifier=/ {print $2; exit}')"

cat >> "$PAYLOAD_DIR/README.txt" <<README

Signing: $SIGNATURE_LABEL
Developer ID identity: ${SIGNING_IDENTITY_FOR_MANIFEST:-none}
Team ID: ${TEAM_IDENTIFIER:-not set}
Notarization: $NOTARIZATION_STATUS
README

if [[ "$NOTARIZE" == "1" || "$NOTARIZE" == "true" || ( "$NOTARIZE" == "auto" && -n "$NOTARY_PROFILE" ) ]]; then
  if [[ "$RESOLVED_SIGNING_MODE" != "developer-id" ]]; then
    echo "Notarization requires Developer ID signing." >&2
    exit 1
  fi
  if [[ -z "$NOTARY_PROFILE" ]]; then
    echo "Set FLEETBAR_NOTARY_PROFILE to a notarytool keychain profile before notarizing." >&2
    echo "Create one with: xcrun notarytool store-credentials <profile-name>" >&2
    exit 1
  fi

  NOTARY_ZIP="$WORK_DIR/fleetbar-notary-submit.zip"
  NOTARY_OUTPUT="$WORK_DIR/notarytool-submit.json"
  (
    cd "$PAYLOAD_DIR"
    ditto -c -k --norsrc . "$NOTARY_ZIP"
  )

  echo "Submitting FleetBar.app to Apple notarization with keychain profile: $NOTARY_PROFILE"
  xcrun notarytool submit "$NOTARY_ZIP" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait \
    --output-format json > "$NOTARY_OUTPUT"

  NOTARIZATION_STATUS="$(node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(data.status || '')" "$NOTARY_OUTPUT")"
  NOTARY_REQUEST_ID="$(node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(data.id || '')" "$NOTARY_OUTPUT")"

  if [[ "$NOTARIZATION_STATUS" != "Accepted" ]]; then
    echo "Notarization failed with status: $NOTARIZATION_STATUS" >&2
    if [[ -n "$NOTARY_REQUEST_ID" ]]; then
      echo "Inspect log with: xcrun notarytool log $NOTARY_REQUEST_ID --keychain-profile $NOTARY_PROFILE" >&2
    fi
    exit 1
  fi

  echo "Stapling notarization ticket to FleetBar.app..."
  xcrun stapler staple "$APP_BUNDLE" >/dev/null
  xcrun stapler validate "$APP_BUNDLE" >/dev/null
  NOTARIZED="true"

  cat >> "$PAYLOAD_DIR/README.txt" <<README
Notary request ID: $NOTARY_REQUEST_ID
Notarization result: $NOTARIZATION_STATUS
README
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
BUNDLED_PORT_DADDY_JSON="$(node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify({
    resourcePath: "FleetBar.app/Contents/Resources/PortDaddy",
    entrypoint: "pd",
    binary: "port-daddy",
    manifest: "port-daddy-manifest.json",
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    signature: manifest.signature ?? null,
    embeddedNativeCore: manifest.embeddedNativeCore,
    smoke: {
      status: manifest.smoke?.status ?? "unknown",
      arbiter: manifest.smoke?.daemon?.arbiter ?? null,
      cli: manifest.smoke?.daemon?.cli ?? null,
    },
  }));
' "$PORT_DADDY_PAYLOAD_DIR/port-daddy-manifest.json")"

FLEETBAR_PREVIEW_NAME="Port Daddy FleetBar" \
FLEETBAR_PREVIEW_CHANNEL="signed-mac-build" \
FLEETBAR_PREVIEW_PLATFORM="macOS" \
FLEETBAR_PREVIEW_ARCH="$ARCH" \
FLEETBAR_PREVIEW_ARTIFACT="$ARTIFACT_NAME" \
FLEETBAR_PREVIEW_SHA256="$SHA256" \
FLEETBAR_PREVIEW_SIZE_BYTES="$ARTIFACT_SIZE_BYTES" \
FLEETBAR_PREVIEW_SIGNATURE="$SIGNATURE_LABEL" \
FLEETBAR_PREVIEW_DEVELOPER_ID_SIGNED="$DEVELOPER_ID_SIGNED" \
FLEETBAR_PREVIEW_SIGNING_IDENTITY="$SIGNING_IDENTITY_FOR_MANIFEST" \
FLEETBAR_PREVIEW_TEAM_IDENTIFIER="$TEAM_IDENTIFIER" \
FLEETBAR_PREVIEW_NOTARIZED="$NOTARIZED" \
FLEETBAR_PREVIEW_NOTARY_REQUEST_ID="$NOTARY_REQUEST_ID" \
FLEETBAR_PREVIEW_NOTARIZATION_STATUS="$NOTARIZATION_STATUS" \
FLEETBAR_PREVIEW_BUNDLE_IDENTIFIER="$BUNDLE_IDENTIFIER" \
FLEETBAR_PREVIEW_BUNDLE_VERSION="$BUNDLE_VERSION" \
FLEETBAR_PREVIEW_BUNDLE_SHORT_VERSION="$BUNDLE_SHORT_VERSION" \
FLEETBAR_PREVIEW_BUNDLED_PORT_DADDY_JSON="$BUNDLED_PORT_DADDY_JSON" \
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
  signature: process.env.FLEETBAR_PREVIEW_SIGNATURE,
  developerIdSigned: process.env.FLEETBAR_PREVIEW_DEVELOPER_ID_SIGNED === 'true',
  signingIdentity: process.env.FLEETBAR_PREVIEW_SIGNING_IDENTITY || null,
  teamIdentifier: process.env.FLEETBAR_PREVIEW_TEAM_IDENTIFIER || null,
  notarized: process.env.FLEETBAR_PREVIEW_NOTARIZED === 'true',
  notarizationStatus: process.env.FLEETBAR_PREVIEW_NOTARIZATION_STATUS,
  notaryRequestId: process.env.FLEETBAR_PREVIEW_NOTARY_REQUEST_ID || null,
  releaseGate: process.env.FLEETBAR_PREVIEW_NOTARIZED === 'true'
    ? null
    : 'Apple notarization ticket not yet stapled; Developer ID signing is present when developerIdSigned is true',
  minimumMacOS: '14.0',
  bundle: {
    identifier: process.env.FLEETBAR_PREVIEW_BUNDLE_IDENTIFIER,
    version: process.env.FLEETBAR_PREVIEW_BUNDLE_VERSION,
    shortVersion: process.env.FLEETBAR_PREVIEW_BUNDLE_SHORT_VERSION,
  },
  bundledPortDaddy: JSON.parse(process.env.FLEETBAR_PREVIEW_BUNDLED_PORT_DADDY_JSON),
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
