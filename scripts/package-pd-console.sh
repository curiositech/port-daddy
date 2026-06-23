#!/usr/bin/env bash
# Build (or wrap a prebuilt) pd-console GPU-native binary into a signed,
# notarized pd-console.app — ADR-0057 phase dist-console-app-bundle. Mirrors
# scripts/package-fleetbar.sh; reuses the same Developer ID signing env the
# daemon release uses (PR #447 / scripts/sign-and-notarize.mjs):
#
#   PORT_DADDY_SIGN_IDENTITY   "Developer ID Application: Curiositech LLC (P5H9P59X2M)"
#   PORT_DADDY_NOTARY_PROFILE  notarytool keychain-profile (omit → sign only)
#   PORT_DADDY_NOTARY_KEYCHAIN keychain holding the profile (CI temp keychain)
#   PORT_DADDY_SKIP_NOTARIZE   "1" → sign only
#   PD_CONSOLE_PREBUILT_BIN    path to a prebuilt pd-console binary (skip cargo build)
#
# Usage: scripts/package-pd-console.sh <out-dir>
set -euo pipefail

OUT_DIR="${1:?usage: package-pd-console.sh <out-dir>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE_DIR="$REPO_ROOT/core/pd-console"
BUNDLE_DIR="$CONSOLE_DIR/bundle"
# Deliberately an EMPTY entitlements dict (not the Bun daemon's port-daddy.plist):
# a Rust + Metal GUI binary needs none of Bun's JIT / unsigned-executable-memory /
# disable-library-validation entitlements, and shipping those would be a needless
# dylib-injection / W^X regression (PR #493 review finding 2). The file has no XML
# comment because codesign's AMFI parser rejects them.
ENTITLEMENTS="$REPO_ROOT/scripts/entitlements/pd-console.plist"
ICON_SRC="$REPO_ROOT/apps/github-app-fleet/icons/A-lighthouse/icon-1024.png"
ARCH="$(uname -m)"
APP_NAME="pd-console.app"
mkdir -p "$OUT_DIR"

# 1. The binary: a prebuilt path (local proof) or a fresh release build.
if [[ -n "${PD_CONSOLE_PREBUILT_BIN:-}" ]]; then
  BIN="$PD_CONSOLE_PREBUILT_BIN"
  echo "Using prebuilt pd-console: $BIN"
else
  echo "Building pd-console --release --features gpui …"
  ( cd "$CONSOLE_DIR" && cargo build --release --features gpui --bin pd-console )
  BIN="$CONSOLE_DIR/target/release/pd-console"
fi
[[ -f "$BIN" ]] || { echo "pd-console binary not found: $BIN" >&2; exit 1; }

# 2. Icon: regenerate the .icns from the lighthouse brand mark (reproducible).
ICONSET="$(mktemp -d)/pd-console.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s*2))" "$((s*2))" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUNDLE_DIR/PortDaddyConsole.icns"

# 3. Assemble pd-console.app/Contents/{MacOS,Info.plist,Resources}.
APP="$OUT_DIR/$APP_NAME"; rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/pd-console"; chmod +x "$APP/Contents/MacOS/pd-console"
cp "$BUNDLE_DIR/pd-console-Info.plist" "$APP/Contents/Info.plist"
cp "$BUNDLE_DIR/PortDaddyConsole.icns" "$APP/Contents/Resources/PortDaddyConsole.icns"

# 4. Stamp the version from package.json (CFBundleVersion numeric-only).
PD_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
# CFBundleVersion must be 1–3 dotted integers — strip any -prerelease / +build
# suffix the same proven way package-fleetbar.sh does (a suffix breaks notarization).
PD_VERSION_NUMERIC="${PD_VERSION%%-*}"; PD_VERSION_NUMERIC="${PD_VERSION_NUMERIC%%+*}"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $PD_VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $PD_VERSION_NUMERIC" "$APP/Contents/Info.plist"

# 5. Sign the .app with hardened runtime (required for notarization).
IDENTITY="${PORT_DADDY_SIGN_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  echo "::warning::PORT_DADDY_SIGN_IDENTITY unset — pd-console.app is UNSIGNED."
else
  KEYCHAIN_ARGS=(); [[ -n "${PORT_DADDY_NOTARY_KEYCHAIN:-}" ]] && KEYCHAIN_ARGS=(--keychain "$PORT_DADDY_NOTARY_KEYCHAIN")
  # No --deep (intentional): this bundle holds a single Mach-O and no nested
  # frameworks/helpers, so codesign on the bundle root seals the inner executable;
  # --deep would mis-apply these entitlements to nested code. --verify --strict
  # below fails if the inner binary were left unsigned.
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "${KEYCHAIN_ARGS[@]}" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
  echo "Signed $APP_NAME with $IDENTITY"

  # 6. Notarize + staple, unless skipped.
  if [[ "${PORT_DADDY_SKIP_NOTARIZE:-}" != "1" && -n "${PORT_DADDY_NOTARY_PROFILE:-}" ]]; then
    ZIP="$(mktemp -d)/pd-console.zip"
    ditto -c -k --keepParent "$APP" "$ZIP"
    NOTARY_KC=(); [[ -n "${PORT_DADDY_NOTARY_KEYCHAIN:-}" ]] && NOTARY_KC=(--keychain "$PORT_DADDY_NOTARY_KEYCHAIN")
    xcrun notarytool submit "$ZIP" --keychain-profile "$PORT_DADDY_NOTARY_PROFILE" "${NOTARY_KC[@]}" --wait --timeout 20m
    xcrun stapler staple "$APP"
    echo "Notarized + stapled $APP_NAME"
  else
    echo "::warning::notary profile absent or skipped — $APP_NAME is signed but NOT notarized."
  fi
fi

# 7. Zip the .app for release upload (ditto preserves signature + staple).
ZIP_OUT="$OUT_DIR/PortDaddy-Console-macOS-${ARCH}.zip"
ditto -c -k --keepParent "$APP" "$ZIP_OUT"
shasum -a 256 "$ZIP_OUT" | tee "$ZIP_OUT.sha256"
echo "✅ $ZIP_OUT"
