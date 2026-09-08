#!/usr/bin/env bash
# Build a zipped FleetBar.app local artifact.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEETBAR_TEST_MODE="${PORT_DADDY_FLEETBAR_TEST_MODE:-0}"
FLEETBAR_TEST_FIXTURE_ROOT="${PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT:-}"

canonical_fixture_child() {
  local label="$1"
  local expected_type="$2"
  local candidate="$3"
  local canonical

  if [[ ! -e "$candidate" ]]; then
    echo "FleetBar test fixture $label is missing: $candidate" >&2
    exit 1
  fi
  canonical="$(realpath "$candidate")" || {
    echo "FleetBar test fixture $label could not be canonicalized: $candidate" >&2
    exit 1
  }
  case "$canonical" in
    "$FLEETBAR_TEST_FIXTURE_ROOT"/*) ;;
    *)
      echo "FleetBar test fixture $label escapes the approved fixture root: $candidate -> $canonical" >&2
      exit 1
      ;;
  esac
  case "$expected_type" in
    directory)
      [[ -d "$canonical" ]] || {
        echo "FleetBar test fixture $label must be a directory: $canonical" >&2
        exit 1
      }
      ;;
    file)
      [[ -f "$canonical" ]] || {
        echo "FleetBar test fixture $label must be a regular file: $canonical" >&2
        exit 1
      }
      ;;
    *)
      echo "Internal error: unsupported fixture type $expected_type" >&2
      exit 1
      ;;
  esac
  printf '%s\n' "$canonical"
}

if [[ "$FLEETBAR_TEST_MODE" == "1" ]]; then
  if [[ -z "$FLEETBAR_TEST_FIXTURE_ROOT" || ! -d "$FLEETBAR_TEST_FIXTURE_ROOT" ]]; then
    echo "FleetBar test mode requires an existing PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT" >&2
    exit 1
  fi
  FLEETBAR_TEST_FIXTURE_ROOT="$(cd "$FLEETBAR_TEST_FIXTURE_ROOT" && pwd -P)"
  case "$FLEETBAR_TEST_FIXTURE_ROOT" in
    "$HOME/coding/tmp/"*) ;;
    *)
      echo "FleetBar test fixture root must be contained under $HOME/coding/tmp" >&2
      exit 1
      ;;
  esac
  FLEETBAR_DIR="$(canonical_fixture_child "apps/FleetBar" directory "$FLEETBAR_TEST_FIXTURE_ROOT/apps/FleetBar")"
  FLEETBAR_TEST_PAYLOAD_SOURCE="$(canonical_fixture_child "payload-source" directory "$FLEETBAR_TEST_FIXTURE_ROOT/payload-source")"
  RELEASE_BIN="$(canonical_fixture_child "release-bin/FleetBar" file "$FLEETBAR_TEST_FIXTURE_ROOT/release-bin/FleetBar")"
  TMP_DIR="$FLEETBAR_TEST_FIXTURE_ROOT/tmp"
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
else
  if [[ -n "$FLEETBAR_TEST_FIXTURE_ROOT" ]]; then
    echo "PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT requires PORT_DADDY_FLEETBAR_TEST_MODE=1" >&2
    exit 1
  fi
  FLEETBAR_DIR="$ROOT_DIR/apps/FleetBar"
  FLEETBAR_TEST_PAYLOAD_SOURCE=""
  TMP_DIR="$(mktemp -d)"
fi
OUT_DIR_INPUT="${1:-"$ROOT_DIR/website-v2/public/downloads"}"
if [[ "$OUT_DIR_INPUT" = /* ]]; then
  OUT_DIR="$OUT_DIR_INPUT"
else
  OUT_DIR="$ROOT_DIR/$OUT_DIR_INPUT"
fi
ARCH="${PORT_DADDY_FLEETBAR_ARCH:-$(uname -m)}"
ZIP_NAME="${PORT_DADDY_FLEETBAR_ZIP:-PortDaddy-FleetBar-macOS-${ARCH}.zip}"
APP_NAME="FleetBar.app"
APP_ICON_SRC="$FLEETBAR_DIR/FleetBar/Resources/FleetBarIcon.icns"

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

validate_port_daddy_manifest() {
  local manifest_path="$1"
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
  ' "$manifest_path"
}

bundle_port_daddy_payload() {
  local payload_dir="$1"
  local target
  target="$(fleetbar_bun_target)"

  mkdir -p "$payload_dir"
  if [[ "$FLEETBAR_TEST_MODE" == "1" ]]; then
    cp -R "$FLEETBAR_TEST_PAYLOAD_SOURCE/." "$payload_dir/"
  else
    echo "Building bundled Port Daddy payload ($target) with embedded Rust core..."
    node "$ROOT_DIR/scripts/build-single-binary.mjs" --target="$target" --outfile="$payload_dir/pd"
  fi

  if [[ ! -x "$payload_dir/pd" || ! -x "$payload_dir/port-daddy" || ! -f "$payload_dir/port-daddy-manifest.json" ]]; then
    echo "Bundled Port Daddy payload is incomplete in $payload_dir" >&2
    exit 1
  fi

  chmod +x "$payload_dir/pd" "$payload_dir/port-daddy"
  validate_port_daddy_manifest "$payload_dir/port-daddy-manifest.json"
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

find_nested_macho_files() {
  local root="$1"
  find "$root" -type f -print | while IFS= read -r candidate; do
    local description
    description="$(file -b "$candidate")"
    if [[ "$description" == *"Mach-O"* ]]; then
      local relative="${candidate#$root/}"
      local slashes="${relative//[^\/]/}"
      local depth="${#slashes}"
      printf '%05d\t%s\n' "$((9999 - depth))" "$candidate"
    fi
  done | sort -t '	' -k1,1n -k2,2 | cut -f2-
}

macho_entitlements_for() {
  local macho="$1"
  case "$macho" in
    "$PORT_DADDY_PAYLOAD_DIR/port-daddy")
      printf '%s\n' "$PAYLOAD_ENTITLEMENTS"
      ;;
    "$APP_MACOS/FleetBar")
      printf '%s\n' "$FLEETBAR_ENTITLEMENTS"
      ;;
    *)
      printf '\n'
      ;;
  esac
}

codesign_macho() {
  local macho="$1"
  local entitlements
  entitlements="$(macho_entitlements_for "$macho")"
  if [[ -n "$entitlements" ]]; then
    if [[ -n "$KEYCHAIN_PATH" ]]; then
      codesign --force --options runtime --timestamp \
        --entitlements "$entitlements" \
        --sign "$IDENTITY" --keychain "$KEYCHAIN_PATH" "$macho"
    else
      codesign --force --options runtime --timestamp \
        --entitlements "$entitlements" \
        --sign "$IDENTITY" "$macho"
    fi
  else
    if [[ -n "$KEYCHAIN_PATH" ]]; then
      codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" --keychain "$KEYCHAIN_PATH" "$macho"
    else
      codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" "$macho"
    fi
  fi
}

sign_nested_macho_files() {
  local app_bundle="$1"
  local macho_list="$TMP_DIR/nested-machos.txt"
  find_nested_macho_files "$app_bundle" > "$macho_list"
  if [[ ! -s "$macho_list" ]]; then
    echo "FleetBar signing refused: no Mach-O files were discovered in $app_bundle" >&2
    return 1
  fi
  while IFS= read -r nested; do
    [[ -n "$nested" ]] || continue
    codesign_macho "$nested"
  done < "$macho_list"
}

print_notary_log() {
  local request_id="$1"
  shift
  [[ -n "$request_id" ]] || return 0
  echo "Fetching Apple notarization log for request $request_id..." >&2
  xcrun notarytool log "$request_id" "$@" || true
}

submit_notary_archive() {
  local notary_zip="$1"
  if [[ -n "${PORT_DADDY_NOTARY_KEYCHAIN:-}" ]]; then
    xcrun notarytool submit "$notary_zip" \
      --keychain-profile "$PORT_DADDY_NOTARY_PROFILE" \
      --keychain "$PORT_DADDY_NOTARY_KEYCHAIN" \
      --wait \
      --timeout 20m \
      --output-format json
  else
    xcrun notarytool submit "$notary_zip" \
      --keychain-profile "$PORT_DADDY_NOTARY_PROFILE" \
      --wait \
      --timeout 20m \
      --output-format json
  fi
}

print_profile_notary_log() {
  local request_id="$1"
  if [[ -n "${PORT_DADDY_NOTARY_KEYCHAIN:-}" ]]; then
    print_notary_log "$request_id" \
      --keychain-profile "$PORT_DADDY_NOTARY_PROFILE" \
      --keychain "$PORT_DADDY_NOTARY_KEYCHAIN"
  else
    print_notary_log "$request_id" --keychain-profile "$PORT_DADDY_NOTARY_PROFILE"
  fi
}

json_field() {
  local json_file="$1"
  local field="$2"
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const field = process.argv[2];
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      process.stdout.write(String(data?.[field] ?? ""));
    } catch {}
  ' "$json_file" "$field"
}

submit_notarization() {
  local app_bundle="$1"
  local notary_dir="$TMP_DIR/notary"
  local notary_zip="$notary_dir/fleetbar-notary.zip"
  local notary_output="$notary_dir/notarytool-submit.json"
  local NOTARY_STATUS
  local NOTARY_REQUEST_ID
  mkdir -p "$notary_dir"

  ditto -c -k --keepParent "$app_bundle" "$notary_zip"
  if ! submit_notary_archive "$notary_zip" > "$notary_output"; then
    NOTARY_REQUEST_ID="$(json_field "$notary_output" id)"
    print_profile_notary_log "$NOTARY_REQUEST_ID"
    return 1
  fi

  NOTARY_STATUS="$(json_field "$notary_output" status)"
  NOTARY_REQUEST_ID="$(json_field "$notary_output" id)"
  if [[ "$NOTARY_STATUS" != "Accepted" ]]; then
    echo "Notarization failed with status: ${NOTARY_STATUS:-unknown}" >&2
    print_profile_notary_log "$NOTARY_REQUEST_ID"
    return 1
  fi
}

if [[ "$FLEETBAR_TEST_MODE" != "1" ]]; then
  cd "$FLEETBAR_DIR"
  swift build -c release
  RELEASE_BIN="$(find "$FLEETBAR_DIR/.build" -path "*/release/FleetBar" -type f | head -n 1)"
fi
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
PORT_DADDY_PAYLOAD_DIR="$APP_RESOURCES/PortDaddy"

mkdir -p "$APP_MACOS" "$APP_RESOURCES" "$OUT_DIR"
cp "$RELEASE_BIN" "$APP_MACOS/FleetBar"
cp "$FLEETBAR_DIR/FleetBar-Info.plist" "$APP_CONTENTS/Info.plist"
cp "$APP_ICON_SRC" "$APP_RESOURCES/FleetBarIcon.icns"
chmod +x "$APP_MACOS/FleetBar"
bundle_port_daddy_payload "$PORT_DADDY_PAYLOAD_DIR"

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

# Developer ID sign + notarize when an identity is provided. The release CI sets
# PORT_DADDY_SIGN_IDENTITY (+ a temp keychain + notary profile) the same way it
# does for the daemon and pd-console (same APPLE_* secrets, PR #447). Without it
# the build stays ad-hoc — fine for local dev, but Gatekeeper QUARANTINES an
# unsigned downloaded .app on a real user's machine, so the release path must sign
# (enforced by the adhoc-rejection guard in .github/workflows/release.yml).
#
# This bundle is NOT a single Mach-O like pd-console: it embeds the Port Daddy
# payload and its native runtime libraries under Contents/Resources/PortDaddy.
# Sign every Mach-O inside-out before sealing the app root. Bun JIT entitlements
# belong only on the Bun-compiled port-daddy executable; ordinary dylibs and the
# small pd launcher receive hardened runtime without Bun entitlements.
FLEETBAR_ENTITLEMENTS="$ROOT_DIR/scripts/entitlements/fleetbar.plist"
PAYLOAD_ENTITLEMENTS="$ROOT_DIR/scripts/entitlements/port-daddy.plist"
IDENTITY="${PORT_DADDY_SIGN_IDENTITY:-}"
SIGNED="false"
NOTARIZED="false"
if [[ -z "$IDENTITY" ]]; then
  echo "::warning::PORT_DADDY_SIGN_IDENTITY unset — FleetBar.app is UNSIGNED (ad-hoc). Gatekeeper will quarantine it on download. Set the Developer ID secrets to sign."
else
  KEYCHAIN_PATH="${PORT_DADDY_NOTARY_KEYCHAIN:-}"
  sign_nested_macho_files "$APP_BUNDLE"
  if [[ -n "$KEYCHAIN_PATH" ]]; then
    codesign --force --options runtime --timestamp \
      --entitlements "$FLEETBAR_ENTITLEMENTS" \
      --sign "$IDENTITY" --keychain "$KEYCHAIN_PATH" "$APP_BUNDLE"
  else
    codesign --force --options runtime --timestamp \
      --entitlements "$FLEETBAR_ENTITLEMENTS" \
      --sign "$IDENTITY" "$APP_BUNDLE"
  fi
  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
  SIGNED="true"
  echo "Signed $APP_NAME (host + embedded Port Daddy payload) with $IDENTITY"

  if [[ "${PORT_DADDY_SKIP_NOTARIZE:-}" != "1" && -n "${PORT_DADDY_NOTARY_PROFILE:-}" ]]; then
    submit_notarization "$APP_BUNDLE"
    xcrun stapler staple "$APP_BUNDLE"
    NOTARIZED="true"
    echo "Notarized + stapled $APP_NAME"
  else
    echo "::warning::notary profile absent or skipped — $APP_NAME is signed but NOT notarized."
  fi
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

# `unsigned` records Developer ID signing; `notarized` records that Apple's
# notary service accepted the .app AND the ticket was stapled. Gatekeeper on a
# DOWNLOADED app requires BOTH — v3.27.0 shipped signed-but-unnotarized (the
# notary key failed validation, a fail-soft warning) and latest.json still
# advertised it signed:true, so users got a quarantined app the feed called
# good. build-latest-json.mjs now derives the feed flag from both fields.
UNSIGNED_FLAG="true"; [[ "$SIGNED" == "true" ]] && UNSIGNED_FLAG="false"
cat > "$OUT_DIR/fleetbar-preview-manifest.json" <<JSON
{
  "name": "Port Daddy FleetBar",
  "channel": "local-build",
  "platform": "macOS",
  "arch": "$ARCH",
  "artifact": "$ZIP_NAME",
  "sha256": "$SHA",
  "unsigned": $UNSIGNED_FLAG,
  "notarized": $NOTARIZED,
  "bundledPortDaddy": $BUNDLED_PORT_DADDY_JSON,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "Packaged $ZIP_PATH"
echo "SHA-256 $SHA"
