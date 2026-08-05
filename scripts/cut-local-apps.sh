#!/usr/bin/env bash
# Cut the local operator surfaces in one shot: pd-console (prod + latest) AND the
# FleetBars (prod + dev-latest), plus the standing daemon fleet they talk to.
#
# This is the "whenever we cut prod and latest and update the pd-console apps,
# rebuild fleetbar too" entry point. Order matters: ensure the seeded daemons
# first (so the just-built apps have data to show), then the consoles, then the
# visibly-distinct FleetBars.
#
#   1. pd dev ensure          — the published stable berth + a named dev-latest berth
#   2. pd-console --prod       → ~/Applications/pd-console-prod.app
#      pd-console --latest     → ~/Applications/pd-console-latest.app
#   3. FleetBar prod           → ~/Applications/Port Daddy/FleetBar.app          (neutral, published stable endpoint)
#      FleetBar dev-latest     → ~/Applications/Port Daddy/FleetBar (dev-latest).app (blue, :9886)
#
# Flags:
#   --no-launchd     Install the FleetBars but don't (re)load their LaunchAgents.
#   --skip-daemons   Don't touch the daemon fleet (just rebuild the apps).
#   --skip-console   Don't rebuild pd-console (FleetBars only).
#   --skip-fleetbar  Don't rebuild the FleetBars (consoles only).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE_PKG="$ROOT_DIR/core/pd-console/scripts/package-console.sh"
FLEETBAR_LANE="$ROOT_DIR/scripts/install-fleetbar-lane.sh"

NO_LAUNCHD=""; SKIP_DAEMONS=0; SKIP_CONSOLE=0; SKIP_FLEETBAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-launchd)    NO_LAUNCHD="--no-launchd"; shift ;;
    --skip-daemons)  SKIP_DAEMONS=1; shift ;;
    --skip-console)  SKIP_CONSOLE=1; shift ;;
    --skip-fleetbar) SKIP_FLEETBAR=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Track outcomes so the summary is honest about what actually built.
declare -a OK=() FAILED=()
step() { # step "label" cmd...
  local label="$1"; shift
  printf '\n\033[1m==> %s\033[0m\n' "$label"
  if "$@"; then OK+=("$label"); else FAILED+=("$label"); echo "   ✗ $label FAILED (continuing)"; fi
}

# 1. Standing daemon fleet (seeded). Best-effort: needs `pd` on PATH.
if [[ "$SKIP_DAEMONS" -eq 0 ]]; then
  if command -v pd >/dev/null 2>&1; then
    step "Ensure daemon fleet (prod + seeded dev-latest)" pd dev ensure
  else
    echo "==> pd not on PATH — skipping daemon fleet ensure"
    FAILED+=("Ensure daemon fleet (pd not found)")
  fi
fi

# 2. pd-console lanes.
if [[ "$SKIP_CONSOLE" -eq 0 ]]; then
  if [[ -f "$CONSOLE_PKG" ]]; then
    step "pd-console-prod.app"   bash "$CONSOLE_PKG" --prod
    step "pd-console-latest.app" bash "$CONSOLE_PKG" --latest
  else
    echo "==> $CONSOLE_PKG missing — skipping pd-console"
    FAILED+=("pd-console (packager missing)")
  fi
fi

# 3. FleetBars — build once (prod), reuse the binary for dev-latest.
if [[ "$SKIP_FLEETBAR" -eq 0 ]]; then
  step "FleetBar prod"        bash "$FLEETBAR_LANE" prod $NO_LAUNCHD
  step "FleetBar dev-latest"  bash "$FLEETBAR_LANE" dev-latest --skip-build $NO_LAUNCHD
fi

printf '\n\033[1m==> Cut summary\033[0m\n'
for s in "${OK[@]:-}";     do [[ -n "$s" ]] && echo "   ✓ $s"; done
for s in "${FAILED[@]:-}"; do [[ -n "$s" ]] && echo "   ✗ $s"; done
if [[ "${#FAILED[@]}" -gt 0 ]]; then
  echo "   Some steps failed — see output above." >&2
  exit 1
fi
echo "   All local apps rebuilt. Open the prod or dev-latest FleetBar from ~/Applications/Port Daddy/."
