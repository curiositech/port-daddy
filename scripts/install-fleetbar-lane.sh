#!/usr/bin/env bash
# Build + install a single FleetBar *lane* as its own .app, so a production and a
# dev-latest (and any named dev) FleetBar run side by side, each visibly distinct.
#
# The lane only differs by bundle metadata — bundle id + display name — which is
# all AppChannel.classify() needs to colour the menu bar and (for dev-latest)
# default the daemon to the :9886 lane:
#
#   prod        ai.portdaddy.FleetBar            "FleetBar"               (neutral, published stable endpoint)
#   dev-latest  dev.portdaddy.fleetbar.devlatest "FleetBar (dev-latest)"  (blue,  :9886)
#   dev <name>  dev.portdaddy.fleetbar.dev.<n>   "FleetBar (dev-<n>)"     (purple, switchable)
#
# Usage:
#   scripts/install-fleetbar-lane.sh prod
#   scripts/install-fleetbar-lane.sh dev-latest
#   scripts/install-fleetbar-lane.sh dev my-feature
#   scripts/install-fleetbar-lane.sh dev-latest --out-root /tmp/scratch --no-launchd
#
# Flags:
#   --no-launchd       Just install the .app; don't register/launch a LaunchAgent.
#   --out-root DIR      Install under DIR instead of "~/Applications/Port Daddy".
#   --skip-build        Reuse the existing release binary (orchestrator builds once).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEETBAR_DIR="$ROOT_DIR/apps/FleetBar"

LANE="${1:-}"
shift || true
[[ -z "$LANE" ]] && { echo "usage: $(basename "$0") <prod|dev-latest|dev NAME> [flags]" >&2; exit 2; }

DEV_NAME=""
if [[ "$LANE" == "dev" ]]; then
  DEV_NAME="${1:-}"
  [[ -z "$DEV_NAME" ]] && { echo "dev lane needs a name: $(basename "$0") dev <name>" >&2; exit 2; }
  shift
fi

OUT_ROOT="$HOME/Applications/Port Daddy"
USE_LAUNCHD=1
SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-launchd) USE_LAUNCHD=0; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --out-root)   OUT_ROOT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Lane → bundle metadata. The display name's parenthetical is what AppChannel
# reads, so dev lanes MUST carry "(dev-latest)" / "(dev-<name>)".
case "$LANE" in
  prod)
    BUNDLE_ID="ai.portdaddy.FleetBar"; DISPLAY="FleetBar"; APP_FILE="FleetBar.app"
    LAUNCHD_LABEL="com.portdaddy.fleetbar" ;;
  dev-latest)
    BUNDLE_ID="dev.portdaddy.fleetbar.devlatest"; DISPLAY="FleetBar (dev-latest)"
    APP_FILE="FleetBar (dev-latest).app"; LAUNCHD_LABEL="com.portdaddy.fleetbar.devlatest" ;;
  dev)
    SAFE="$(printf '%s' "$DEV_NAME" | tr -c 'A-Za-z0-9._-' '-')"
    BUNDLE_ID="dev.portdaddy.fleetbar.dev.$SAFE"; DISPLAY="FleetBar (dev-$SAFE)"
    APP_FILE="FleetBar (dev-$SAFE).app"; LAUNCHD_LABEL="com.portdaddy.fleetbar.dev.$SAFE" ;;
  *) echo "unknown lane: $LANE (want prod | dev-latest | dev NAME)" >&2; exit 2 ;;
esac

APP_BUNDLE="$OUT_ROOT/$APP_FILE"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
INFO_SRC="$FLEETBAR_DIR/FleetBar-Info.plist"
ICON_SRC="$FLEETBAR_DIR/FleetBar/Resources/FleetBarIcon.icns"
RELEASE_BIN="$FLEETBAR_DIR/.build/arm64-apple-macosx/release/FleetBar"

[[ -f "$INFO_SRC" ]] || { echo "missing $INFO_SRC" >&2; exit 1; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "[$LANE] Building FleetBar (release)…"
  ( cd "$FLEETBAR_DIR" && swift build -c release 2>&1 | tail -2 )
fi
[[ -f "$RELEASE_BIN" ]] || { echo "release binary not found at $RELEASE_BIN (build first)" >&2; exit 1; }

echo "[$LANE] Assembling $APP_FILE → $OUT_ROOT"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$RELEASE_BIN" "$APP_MACOS/FleetBar"
chmod +x "$APP_MACOS/FleetBar"
cp "$INFO_SRC" "$APP_CONTENTS/Info.plist"
[[ -f "$ICON_SRC" ]] && cp "$ICON_SRC" "$APP_RESOURCES/FleetBarIcon.icns"

# Stamp lane identity + version. CFBundleVersion must be numeric-only (Apple).
PD_VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null \
  || grep -m1 '"version"' "$ROOT_DIR/package.json" | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
PD_BUILD_VERSION="${PD_VERSION%%-*}"; PD_BUILD_VERSION="${PD_BUILD_VERSION%%+*}"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP_CONTENTS/Info.plist"
# CFBundleDisplayName/Name may not exist in the template; Add-then-Set is safe.
$PB -c "Add :CFBundleDisplayName string $DISPLAY" "$APP_CONTENTS/Info.plist" 2>/dev/null \
  || $PB -c "Set :CFBundleDisplayName $DISPLAY" "$APP_CONTENTS/Info.plist"
$PB -c "Set :CFBundleName $DISPLAY" "$APP_CONTENTS/Info.plist" 2>/dev/null || true
if [[ -n "$PD_VERSION" ]]; then
  $PB -c "Set :CFBundleShortVersionString $PD_VERSION" "$APP_CONTENTS/Info.plist"
  $PB -c "Set :CFBundleVersion $PD_BUILD_VERSION" "$APP_CONTENTS/Info.plist"
fi

# Ad-hoc sign so Gatekeeper lets a locally-built app run; a real Developer ID
# signature is only needed for the shipped artifact (package-fleetbar.sh).
codesign --force --sign - --timestamp=none "$APP_BUNDLE" >/dev/null 2>&1 || \
  echo "[$LANE] WARN: ad-hoc codesign failed (app may be quarantined)" >&2

touch "$APP_BUNDLE"
/usr/bin/killall -HUP Dock 2>/dev/null || true

if [[ "$USE_LAUNCHD" -eq 1 ]]; then
  PLIST_DST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
  cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key><array><string>$APP_MACOS/FleetBar</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.port-daddy/fleetbar-$LANE.log</string>
  <key>StandardErrorPath</key><string>$HOME/.port-daddy/fleetbar-$LANE.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  launchctl load "$PLIST_DST"
  echo "[$LANE] LaunchAgent $LAUNCHD_LABEL loaded (auto-starts on login)."
fi

echo "[$LANE] Installed: $APP_BUNDLE"
echo "[$LANE]   bundle id: $BUNDLE_ID   display: $DISPLAY   version: ${PD_VERSION:-unknown}"
