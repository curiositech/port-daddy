#!/usr/bin/env bash
# package-fleetbar-lane.sh — build + install FleetBar in one of three LANES,
# mirroring core/pd-console/scripts/package-console.sh so the two operator apps
# share one mental model:
#
#   prod    → ~/Applications/Port Daddy/FleetBar.app                    what Homebrew ships
#             launchd: com.portdaddy.fleetbar (KeepAlive)
#   latest  → ~/Applications/Port Daddy/FleetBar (dev-latest).app       what's on main   [DEFAULT]
#             launchd: com.portdaddy.fleetbar.devlatest (KeepAlive)
#   dev <n> → ~/Applications/Port Daddy/FleetBar-dev-<YYYYMMDD-HHMM>-<n>.app
#             no launchd — launched once via `open`
#
# prod/latest are supervised menu-bar agents, so "relaunch" means: swap the
# bundle, re-render the LaunchAgent plist, then `launchctl kickstart -k` the
# label (launchd kills the old process and starts the new binary). Dev bundles
# carry their build time in the filename, YYYYMMDD-HHMM first so lexicographic
# sort == chronological sort; rebuilding the same <n> retires that name's older
# bundles (PD_FLEETBAR_KEEP_OLD_DEV=1 keeps them).
#
# Usage:
#   bash scripts/package-fleetbar-lane.sh                # latest (default)
#   bash scripts/package-fleetbar-lane.sh --latest
#   bash scripts/package-fleetbar-lane.sh --prod
#   bash scripts/package-fleetbar-lane.sh --devbuild berth-picker
#
# Env:
#   PD_FLEETBAR_NO_LAUNCH=1      build + install but do not (re)start
#   PD_FLEETBAR_NO_BUILD=1       skip swift build (reuse the release binary)
#   PD_FLEETBAR_KEEP_OLD_DEV=1   keep superseded timestamped dev bundles
set -euo pipefail

# ── 1. Parse the lane ─────────────────────────────────────────────────────────
LANE=latest
DEVNAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prod)     LANE=prod ;;
    --latest)   LANE=latest ;;
    --devbuild) LANE=dev; DEVNAME="${2:-}"; [ -n "$DEVNAME" ] || { echo "✗ --devbuild needs a name, e.g. --devbuild berth-picker" >&2; exit 2; }; shift ;;
    -h|--help)  sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "✗ unknown argument: $1  (try --help)" >&2; exit 2 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # apps/FleetBar/scripts
FLEETBAR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                    # apps/FleetBar
ROOT_DIR="$(cd "$FLEETBAR_DIR/../.." && pwd)"                   # repo root
INFO_PLIST_SRC="$FLEETBAR_DIR/FleetBar-Info.plist"
ICON_SRC="$FLEETBAR_DIR/FleetBar/Resources/FleetBarIcon.icns"
INSTALL_ROOT="$HOME/Applications/Port Daddy"
LOG_DIR="$HOME/.port-daddy"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || echo 0.0.0)"

# ── 2. Lane → app path, bundle id, launchd label ───────────────────────────────
LABEL=""      # empty → not launchd-supervised (dev lane)
case "$LANE" in
  prod)
    APP="$INSTALL_ROOT/FleetBar.app"
    BUNDLE_ID="ai.portdaddy.FleetBar"; DISPLAY="FleetBar"
    LABEL="com.portdaddy.fleetbar"; LOG_BASE="fleetbar-prod" ;;
  latest)
    APP="$INSTALL_ROOT/FleetBar (dev-latest).app"
    BUNDLE_ID="dev.portdaddy.fleetbar.devlatest"; DISPLAY="FleetBar (dev-latest)"
    LABEL="com.portdaddy.fleetbar.devlatest"; LOG_BASE="fleetbar-dev-latest" ;;
  dev)
    SAFE="$(printf '%s' "$DEVNAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//; s/-*$//')"
    [ -n "$SAFE" ] || { echo "✗ --devbuild name reduced to empty after sanitising: '$DEVNAME'" >&2; exit 2; }
    STAMP="$(date +%Y%m%d-%H%M)"
    APP="$INSTALL_ROOT/FleetBar-dev-${STAMP}-${SAFE}.app"
    BUNDLE_ID="dev.portdaddy.fleetbar.dev.$SAFE"; DISPLAY="FleetBar (dev: $SAFE)"
    LOG_BASE="fleetbar-dev-$SAFE" ;;
esac
echo "▸ lane: $LANE  →  $APP"

# ── 3. Build the release binary ────────────────────────────────────────────────
cd "$FLEETBAR_DIR"
if [ "${PD_FLEETBAR_NO_BUILD:-0}" != "1" ]; then
  echo "▸ swift build -c release"
  swift build -c release 2>&1 | tail -3
fi
RELEASE_BIN="$(find "$FLEETBAR_DIR/.build" -path "*/release/FleetBar" -type f | head -n 1)"
[ -n "$RELEASE_BIN" ] && [ -f "$RELEASE_BIN" ] || { echo "✗ FleetBar release binary not found under $FLEETBAR_DIR/.build" >&2; exit 1; }
[ -f "$INFO_PLIST_SRC" ] || { echo "✗ FleetBar app metadata missing: $INFO_PLIST_SRC" >&2; exit 1; }

# ── 4. Assemble the bundle in a staging dir, then swap atomically-ish ──────────
# Staged on the same filesystem so the final mv is instant; a KeepAlive'd lane is
# only ever without a bundle for the duration of one rm+mv.
mkdir -p "$INSTALL_ROOT" "$LOG_DIR"
STAGE="$(mktemp -d "$INSTALL_ROOT/.fleetbar-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
NEW_APP="$STAGE/$(basename "$APP")"
mkdir -p "$NEW_APP/Contents/MacOS" "$NEW_APP/Contents/Resources"
cp "$RELEASE_BIN" "$NEW_APP/Contents/MacOS/FleetBar"
chmod +x "$NEW_APP/Contents/MacOS/FleetBar"
cp "$INFO_PLIST_SRC" "$NEW_APP/Contents/Info.plist"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$NEW_APP/Contents/Resources/FleetBarIcon.icns"
else
  echo "⚠ $ICON_SRC missing; menu bar works but Dock/Finder shows a generic icon"
fi

# Per-lane identity + version stamp (separate CFBundleIdentifier per lane keeps
# LaunchServices registrations and icon caches from colliding).
plutil -replace CFBundleIdentifier         -string "$BUNDLE_ID" "$NEW_APP/Contents/Info.plist"
plutil -replace CFBundleName               -string "$DISPLAY"   "$NEW_APP/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION"   "$NEW_APP/Contents/Info.plist"
plutil -replace CFBundleVersion            -string "${VERSION%%-*}" "$NEW_APP/Contents/Info.plist"
codesign --force --deep --sign - "$NEW_APP" >/dev/null 2>&1 || echo "⚠ ad-hoc codesign warning (non-fatal)"

rm -rf "$APP"
mv "$NEW_APP" "$APP"
touch "$APP"
echo "▸ installed $APP (v$VERSION)"

# ── 5. Dev lane: retire this name's superseded bundles ─────────────────────────
if [ "$LANE" = dev ] && [ "${PD_FLEETBAR_KEEP_OLD_DEV:-0}" != "1" ]; then
  # ????????-???? pins the stamp to exactly YYYYMMDD-HHMM so a name that is a
  # suffix of another name can't match across builds.
  for OLD in "$INSTALL_ROOT"/FleetBar-dev-????????-????-"${SAFE}.app"; do
    [ -d "$OLD" ] || continue
    [ "$OLD" = "$APP" ] && continue
    echo "▸ retiring superseded dev build $(basename "$OLD")"
    pkill -f "$OLD/Contents/MacOS/FleetBar" 2>/dev/null || true
    rm -rf "$OLD"
  done
fi

[ "${PD_FLEETBAR_NO_LAUNCH:-0}" = "1" ] && { echo "✓ $LANE lane updated (no launch requested)"; exit 0; }

# ── 6. (Re)start ───────────────────────────────────────────────────────────────
if [ -n "$LABEL" ]; then
  # Supervised lanes: render the LaunchAgent plist (machine-local paths), make
  # sure it's bootstrapped, then kickstart -k so launchd swaps in the new binary.
  PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
  cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/FleetBar</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG_DIR/$LOG_BASE.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$LOG_BASE.log</string>
</dict>
</plist>
PLIST
  GUI="gui/$(id -u)"
  if launchctl print "$GUI/$LABEL" >/dev/null 2>&1; then
    # Re-bootstrap so launchd re-reads the plist (the app path can change), then
    # kickstart to be certain the fresh binary is the one running.
    launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
    sleep 0.5
  fi
  # Old manually-launched instances of this lane's bundle would linger beside the
  # supervised one — clear them before launchd takes over.
  pkill -f "$APP/Contents/MacOS/FleetBar" 2>/dev/null || true
  # bootout is asynchronous: an immediate bootstrap can race it (EBUSY) and,
  # under set -e, abort AFTER the teardown but BEFORE the restart — leaving the
  # lane down (fleet review finding). Retry briefly instead of trusting one shot.
  BOOTSTRAPPED=0
  for _try in 1 2 3 4 5; do
    if launchctl bootstrap "$GUI" "$PLIST_DST" 2>/dev/null; then BOOTSTRAPPED=1; break; fi
    sleep 1
  done
  [ "$BOOTSTRAPPED" = 1 ] || { echo "✗ launchctl bootstrap failed after retries — $LABEL may be down" >&2; exit 1; }
  launchctl kickstart -k "$GUI/$LABEL" 2>/dev/null || true
  echo "▸ launchd $LABEL restarted on the fresh bundle"
else
  pkill -f "$APP/Contents/MacOS/FleetBar" 2>/dev/null || true
  sleep 0.5
  open "$APP"
  echo "▸ launched $(basename "$APP")"
fi

echo "✓ $LANE lane updated: $APP (v$VERSION)"
