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
# pd-console is a MEMBER of the `core` cargo workspace (core/Cargo.toml), so its
# build artifact lands in the WORKSPACE target (core/target), NOT core/pd-console/
# target. Looking in the wrong place is why this job silently failed every release
# (the cask's sha stayed PLACEHOLDER_CONSOLE_ARM64 — the .app never shipped).
CORE_DIR="$REPO_ROOT/core"
BUNDLE_DIR="$CONSOLE_DIR/bundle"
# Deliberately an EMPTY entitlements dict (not the Bun daemon's port-daddy.plist):
# a Rust + Metal GUI binary needs none of Bun's JIT / unsigned-executable-memory /
# disable-library-validation entitlements, and shipping those would be a needless
# dylib-injection / W^X regression (PR #493 review finding 2). The file has no XML
# comment because codesign's AMFI parser rejects them.
ENTITLEMENTS="$REPO_ROOT/scripts/entitlements/pd-console.plist"
# Shared ship's-wheel brand mark (same master the local lanes use, so prod / latest
# / dev are one mark in three colours — see core/pd-console/scripts/package-console.sh).
ICON_SRC="$REPO_ROOT/core/pd-console/assets/branding/pd-console-icon-1024.png"
ARCH="$(uname -m)"
# The build artifact stays pd-console.app (scripts/check-version-drift.mjs --deep reads
# it by that path). The Homebrew cask installs it AS pd-console-prod.app on the user's
# machine — see Casks/pd-console.rb (`app … target: "pd-console-prod.app"`).
APP_NAME="pd-console.app"
mkdir -p "$OUT_DIR"

# 1. The binary: a prebuilt path (local proof) or a fresh release build.
if [[ -n "${PD_CONSOLE_PREBUILT_BIN:-}" ]]; then
  BIN="$PD_CONSOLE_PREBUILT_BIN"
  echo "Using prebuilt pd-console: $BIN"
else
  echo "Building pd-console --release --features gpui …"
  ( cd "$CONSOLE_DIR" && cargo build --release --features gpui --bin pd-console )
  # Workspace target first (the real location), member-local target as a fallback
  # in case the workspace layout changes.
  if [[ -f "$CORE_DIR/target/release/pd-console" ]]; then
    BIN="$CORE_DIR/target/release/pd-console"
  else
    BIN="$CONSOLE_DIR/target/release/pd-console"
  fi
fi
[[ -f "$BIN" ]] || { echo "pd-console binary not found at $CORE_DIR/target/release or $CONSOLE_DIR/target/release" >&2; exit 1; }

# 2. Icon: the PROD lane brand mark — the shared master with a BLUE frame + a
#    vX.Y.Z version badge, so pd-console-prod reads distinct from latest (green) and
#    dev (amber) in the Dock. Mirrors the badging in package-console.sh's lanes.
PD_VERSION_FOR_BADGE="$(node -p "require('$REPO_ROOT/package.json').version")"
WORK="$(mktemp -d)"
PROD_TINT="#2563eb"
FONT=""
for f in "/System/Library/Fonts/Supplemental/Arial Bold.ttf" "/System/Library/Fonts/Helvetica.ttc"; do
  [ -f "$f" ] && { FONT="$f"; break; }
done
MAGICK="$(command -v magick || command -v convert || true)"
ICON_FOR_SET="$ICON_SRC"
# Zoom 250% into the centre first so the "pd" wordmark dominates and the busy
# radar rings drop out — the master is illegible at Dock size otherwise. Matches
# core/pd-console/scripts/package-console.sh's lane badging.
if [[ -n "$MAGICK" ]] && "$MAGICK" "$ICON_SRC" -resize 250% -gravity center -extent 1024x1024 \
     -resize 976x976^ -gravity center -extent 976x976 \
     -bordercolor "$PROD_TINT" -border 24 \
     -fill "$PROD_TINT" -draw "rectangle 0,860 1024,1010" \
     ${FONT:+-font "$FONT"} -fill white -pointsize 110 -gravity South -annotate +0+18 "v$PD_VERSION_FOR_BADGE" \
     "$WORK/prod-icon.png" 2>/dev/null; then
  ICON_FOR_SET="$WORK/prod-icon.png"
else
  echo "::warning::imagemagick unavailable — pd-console-prod ships the unbadged master."
fi
ICONSET="$WORK/pd-console.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$ICON_FOR_SET" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s*2))" "$((s*2))" "$ICON_FOR_SET" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
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
