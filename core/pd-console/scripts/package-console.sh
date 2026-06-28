#!/usr/bin/env bash
# package-console.sh — build + install a pd-console .app in one of three LANES.
#
# Why this exists: for a long time there was ONE bundle at ~/Applications/pd-console.app.
# Every agent working in Rust clobbered it, and you could never tell whether the
# window in front of you was prod, main, or someone's half-built feature. That is
# how you end up hitting Ctrl-A Space on a month-old build and seeing nothing.
#
# Now there are three lanes, each a distinct bundle with a distinct icon colour +
# label so you can tell them apart at a glance in the Dock:
#
#   prod    → ~/Applications/pd-console-prod.app           what Homebrew ships (vX.Y.Z badge, BLUE)
#   latest  → ~/Applications/pd-console-latest.app         what's on main      ("latest" badge, GREEN)   [DEFAULT]
#   dev <n> → ~/Applications/pd-console-dev-apps/           a worktree build    ("dev·<n>" badge, AMBER)
#             pd-console_dev-<n>.app
#
# Each lane is a separate CFBundleIdentifier, so LaunchServices keeps separate
# icon caches and Dock entries — they never overwrite each other.
#
# Usage:
#   bash scripts/package-console.sh                      # latest (default) — run after merging to main
#   bash scripts/package-console.sh --latest
#   bash scripts/package-console.sh --prod               # version-stamped prod (Homebrew cut)
#   bash scripts/package-console.sh --devbuild parley-pane   # your own isolated build
#
# Env:
#   PD_CONSOLE_NO_LAUNCH=1   build + install but do not relaunch
#   PD_CONSOLE_NO_BUILD=1    skip cargo build (reuse target/release/pd-console — for fast re-skinning)
#   PD_CONSOLE_SIGN_IDENTITY="Developer ID Application: …"   real signing (default: ad-hoc "-")
set -euo pipefail

# ── 1. Parse the lane ─────────────────────────────────────────────────────────
LANE=latest
DEVNAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prod)     LANE=prod ;;
    --latest)   LANE=latest ;;
    --devbuild) LANE=dev; DEVNAME="${2:-}"; [ -n "$DEVNAME" ] || { echo "✗ --devbuild needs a name, e.g. --devbuild parley-pane" >&2; exit 2; }; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "✗ unknown argument: $1  (try --help)" >&2; exit 2 ;;
  esac
  shift
done

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # core/pd-console
CORE_DIR="$(cd "$CRATE_DIR/.." && pwd)"                        # core (cargo workspace)
ICON_PNG="$CRATE_DIR/assets/branding/pd-console-icon-1024.png"
VERSION="$(grep -m1 '^version' "$CRATE_DIR/Cargo.toml" | sed -E 's/version *= *"([^"]+)"/\1/')"
APPS_DIR="$HOME/Applications"
DEV_APPS_DIR="$APPS_DIR/pd-console-dev-apps"

# ── 2. Lane → app path, badge text, tint colour, bundle id, display name ───────
# Tints chosen to be unmistakable at Dock size: prod=blue, latest=green, dev=amber.
update_shim=0   # only prod/latest own the ~/.port-daddy/bin PATH shim
case "$LANE" in
  prod)
    APP="$APPS_DIR/pd-console-prod.app"
    BADGE="v$VERSION"; TINT="#2563eb"; BUNDLE_ID="dev.curiositech.pd-console"
    DISPLAY="pd-console (prod)"; update_shim=1 ;;
  latest)
    APP="$APPS_DIR/pd-console-latest.app"
    BADGE="latest"; TINT="#10b981"; BUNDLE_ID="dev.curiositech.pd-console.latest"
    DISPLAY="pd-console (latest)"; update_shim=1 ;;
  dev)
    SAFE="$(printf '%s' "$DEVNAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//; s/-*$//')"
    [ -n "$SAFE" ] || { echo "✗ --devbuild name reduced to empty after sanitising: '$DEVNAME'" >&2; exit 2; }
    mkdir -p "$DEV_APPS_DIR"
    APP="$DEV_APPS_DIR/pd-console_dev-${SAFE}.app"
    BADGE="dev·$SAFE"; TINT="#f59e0b"; BUNDLE_ID="dev.curiositech.pd-console.dev.$SAFE"
    DISPLAY="pd-console (dev: $SAFE)" ;;
esac
echo "▸ lane: $LANE  →  $APP"
echo "▸ pd-console v$VERSION   badge='$BADGE'  tint=$TINT"

# Retire the legacy single bundle: on the latest lane, inherit it once (a rename,
# never a delete) so its LaunchServices registration migrates cleanly.
LEGACY="$APPS_DIR/pd-console.app"
if [ "$LANE" = latest ] && [ -d "$LEGACY" ] && [ ! -d "$APP" ]; then
  echo "▸ migrating legacy $LEGACY → $APP (rename)"
  mv "$LEGACY" "$APP"
fi

# ── 3. Build the release binary (the GPU shell). Shared across lanes. ──────────
REL="$CORE_DIR/target/release/pd-console"
if [ "${PD_CONSOLE_NO_BUILD:-0}" = "1" ] && [ -f "$REL" ]; then
  echo "▸ PD_CONSOLE_NO_BUILD=1 — reusing $REL"
else
  echo "▸ cargo build --release --features gpui"
  ( cd "$CORE_DIR" && cargo build --release --bin pd-console --features gpui )
fi
[ -f "$REL" ] || { echo "✗ build produced no binary at $REL" >&2; exit 1; }

# ── 4. Scaffold the .app bundle if it does not exist yet ───────────────────────
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "▸ scaffolding new bundle"
  printf 'APPL????' > "$APP/Contents/PkgInfo"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>pd-console</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$DISPLAY</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
fi

# ── 5. Badge + tint the icon for this lane, then build AppIcon.icns ────────────
# Distinct colour frame + bottom label so prod / latest / dev read apart instantly.
if [ -f "$ICON_PNG" ]; then
  echo "▸ building lane-badged AppIcon.icns"
  sips -s format png "$ICON_PNG" --out "$ICON_PNG" >/dev/null 2>&1 || true   # nano-banana sometimes emits JPEG-in-.png
  WORK="$(mktemp -d "$HOME/coding/tmp/pd-console-iconset.XXXXXX")"
  BADGED="$WORK/badged.png"
  MAGICK="$(command -v magick || command -v convert || true)"
  # A bold font that actually exists on macOS (magick needs a real file for -annotate).
  FONT=""
  for f in "/System/Library/Fonts/Supplemental/Arial Bold.ttf" \
           "/System/Library/Fonts/SFNSRounded.ttf" \
           "/System/Library/Fonts/Helvetica.ttc"; do
    [ -f "$f" ] && { FONT="$f"; break; }
  done
  # Zoom 250% into the centre first: the brand master is a "pd" monogram on a busy
  # radar field whose detail turns to mush at Dock size. Enlarging + centre-cropping
  # drops the noisy outer rings and lets the bold wordmark dominate, so it stays
  # legible at 64px (operator vision-accessibility line).
  if [ -n "$MAGICK" ] && \
     "$MAGICK" "$ICON_PNG" -resize 250% -gravity center -extent 1024x1024 \
       -resize 976x976^ -gravity center -extent 976x976 \
       -bordercolor "$TINT" -border 24 \
       -fill "$TINT" -draw "rectangle 0,860 1024,1010" \
       ${FONT:+-font "$FONT"} -fill white -pointsize 120 -gravity South -annotate +0+14 "$BADGE" \
       "$BADGED" 2>"$WORK/magick.err"; then
    :
  else
    echo "⚠ icon badge step failed — using unbadged master ($(tail -1 "$WORK/magick.err" 2>/dev/null))"
    cp "$ICON_PNG" "$BADGED"
  fi
  ICONSET="$WORK/AppIcon.iconset"; mkdir -p "$ICONSET"
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz             "$BADGED" --out "$ICONSET/icon_${sz}x${sz}.png"      >/dev/null
    sips -z $((sz*2)) $((sz*2)) "$BADGED" --out "$ICONSET/icon_${sz}x${sz}@2x.png"   >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  cp "$BADGED" "$APP/Contents/Resources/AppIcon-preview.png"   # for PR/visual artifacts
  rm -rf "$WORK"
else
  echo "⚠ no icon master at $ICON_PNG — skipping icon"
fi

# ── 6. Stamp Info.plist (version + identity, idempotent on re-runs) ────────────
plutil -replace CFBundleShortVersionString -string "$VERSION"   "$PLIST"
plutil -replace CFBundleVersion            -string "$VERSION"   "$PLIST"
plutil -replace CFBundleIdentifier         -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleName               -string "$DISPLAY"   "$PLIST"
[ -f "$APP/Contents/Resources/AppIcon.icns" ] && plutil -replace CFBundleIconFile -string "AppIcon" "$PLIST"

# ── 7. Install the binary (PATH shim only for prod/latest) ─────────────────────
echo "▸ installing binary → $APP"
cp -f "$REL" "$APP/Contents/MacOS/pd-console"
if [ "$update_shim" = 1 ]; then
  BIN_PATH="${PD_CONSOLE_BIN:-$HOME/.port-daddy/bin/pd-console}"
  mkdir -p "$(dirname "$BIN_PATH")"
  cp -f "$REL" "$BIN_PATH"
  echo "▸ updated PATH shim → $BIN_PATH"
fi

# 4b. Seed the editable model-tier config (the single source of truth for the
# Spawn picker's provider→tier→model map). Never clobber an operator-edited file
# — only drop the default if it's missing, so edits survive upgrades.
MODEL_TIERS_DST="$HOME/.port-daddy/model-tiers.json"
MODEL_TIERS_SRC="$(cd "$(dirname "$0")/.." && pwd)/config/model-tiers.json"
if [[ ! -f "$MODEL_TIERS_DST" && -f "$MODEL_TIERS_SRC" ]]; then
  cp "$MODEL_TIERS_SRC" "$MODEL_TIERS_DST"
  echo "▸ seeded model-tier config → $MODEL_TIERS_DST (edit it; no rebuild needed)"
fi

# ── Sign (real Developer ID if PD_CONSOLE_SIGN_IDENTITY is set, else ad-hoc) ─
SIGN="${PD_CONSOLE_SIGN_IDENTITY:--}"
echo "▸ codesign ($([ "$SIGN" = "-" ] && echo ad-hoc || echo "$SIGN"))"
codesign --force --deep --sign "$SIGN" "$APP" >/dev/null 2>&1 || echo "⚠ codesign warning (non-fatal)"

# ── 9. Force LaunchServices + Dock to drop the cached old icon/version ─────────
echo "▸ refreshing LaunchServices icon cache"
touch "$APP"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$APP" || true

# ── 10. Relaunch this lane's app (operator always sees the fresh build) ────────
if [ "${PD_CONSOLE_NO_LAUNCH:-0}" != "1" ]; then
  echo "▸ relaunching $(basename "$APP")"
  # Only kill an instance of THIS bundle, not the other lanes' windows.
  pkill -f "$APP/Contents/MacOS/pd-console" 2>/dev/null || true
  sleep 0.6
  open "$APP"
fi

echo "✓ $LANE lane updated: $APP  (v$VERSION, '$BADGE')"
[ "$LANE" = dev ] && echo "  other lanes untouched. Build more: bash scripts/package-console.sh --devbuild <name>"
exit 0
