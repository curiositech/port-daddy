#!/usr/bin/env bash
# package-console.sh — the ONE reproducible "rebuild + update the launcher" step.
#
# Why this exists: cp'ing a fresh binary into the .app is not enough — the Dock
# and LaunchServices cache the old icon/version, so updates appear not to land.
# This script rebuilds, stamps the version + build time, embeds the AppIcon, and
# forces a LaunchServices refresh so the launcher ALWAYS reflects the new build.
#
# Run it after any console change:  bash scripts/package-console.sh
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # core/pd-console
CORE_DIR="$(cd "$CRATE_DIR/.." && pwd)"                        # core (cargo workspace)
APP="${PD_CONSOLE_APP:-$HOME/Applications/pd-console.app}"
BIN_PATH="${PD_CONSOLE_BIN:-$HOME/.port-daddy/bin/pd-console}"
ICON_PNG="$CRATE_DIR/assets/branding/pd-console-icon-1024.png"

VERSION="$(grep -m1 '^version' "$CRATE_DIR/Cargo.toml" | sed -E 's/version *= *"([^"]+)"/\1/')"
echo "▸ pd-console v$VERSION"

# 1. Build the release binary with the GPU shell.
echo "▸ cargo build --release --features gpui"
( cd "$CORE_DIR" && cargo build --release --bin pd-console --features gpui )
REL="$CORE_DIR/target/release/pd-console"
[ -f "$REL" ] || { echo "✗ build produced no binary at $REL" >&2; exit 1; }

# 2. Build AppIcon.icns from the 1024 master (idempotent; skipped if no source).
if [ -f "$ICON_PNG" ]; then
  echo "▸ building AppIcon.icns"
  # Nano-banana sometimes emits JPEG bytes in a .png file; iconutil rejects that.
  # Normalize the master to a true PNG first (idempotent).
  sips -s format png "$ICON_PNG" --out "$ICON_PNG" >/dev/null 2>&1 || true
  ICONSET="$(mktemp -d --dir "$HOME/coding/tmp" pd-console-iconset.XXXXXX 2>/dev/null || mktemp -d "$HOME/coding/tmp/pd-console-iconset.XXXXXX")/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz       "$ICON_PNG" --out "$ICONSET/icon_${sz}x${sz}.png"      >/dev/null
    sips -z $((sz*2)) $((sz*2)) "$ICON_PNG" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  mkdir -p "$APP/Contents/Resources"
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
else
  echo "⚠ no icon master at $ICON_PNG — skipping icon"
fi

# 3. Stamp Info.plist: version + icon reference.
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion            -string "$VERSION" "$PLIST"
[ -f "$APP/Contents/Resources/AppIcon.icns" ] && \
  plutil -replace CFBundleIconFile -string "AppIcon" "$PLIST"

# 4. Install the binary into BOTH the .app and the PATH shim.
echo "▸ installing binary → .app + $BIN_PATH"
mkdir -p "$(dirname "$BIN_PATH")"
cp -f "$REL" "$APP/Contents/MacOS/pd-console"
cp -f "$REL" "$BIN_PATH"

# 5. Re-sign (ad-hoc) so Gatekeeper accepts the mutated bundle.
echo "▸ codesign (ad-hoc)"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "⚠ codesign warning (non-fatal)"

# 6. Force LaunchServices + Dock to drop the cached old icon/version.
echo "▸ refreshing LaunchServices icon cache"
touch "$APP"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$APP" || true

# 7. Relaunch so the operator always sees the fresh build (no manual quit/open).
if [ "${PD_CONSOLE_NO_LAUNCH:-0}" != "1" ]; then
  echo "▸ relaunching pd-console"
  pkill -x pd-console 2>/dev/null || true
  sleep 0.5
  open "$APP"
fi

echo "✓ launcher updated + relaunched: $APP  (v$VERSION, built just now)"
echo "  status bar shows 'v$VERSION · built now'.  To launch by hand: open '$APP'"
