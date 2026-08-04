#!/usr/bin/env bash
# dev-triple.sh — build and open a named daemon + pd-console + FleetBar bundle.
#
# The daemon is always created through `pd dev up` from the current worktree.
# That gives it an isolated state plane, a claimed dynamic port, a registry
# record, and a matching feature identity. Both apps receive the discovered URL
# explicitly for this launch. No global selector file is written.
#
# Usage:
#   scripts/dev-triple.sh [<feature-label>]
#   scripts/dev-triple.sh --no-build [<feature-label>]
#   scripts/dev-triple.sh down <feature-label>
#
# Env:
#   PORT_DADDY_CLI        CLI used to create and stop the named daemon
#   DEV_TRIPLE_NO_OPEN=1 build and verify without opening GUI apps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
c_info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }
c_err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

sanitize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//; s/-*$//'
}

current_branch() {
  git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'detached\n'
}

resolve_pd_cli() {
  if [[ -n "${PORT_DADDY_CLI:-}" && -x "$PORT_DADDY_CLI" ]]; then
    printf '%s\n' "$PORT_DADDY_CLI"
    return 0
  fi
  command -v pd 2>/dev/null || command -v port-daddy 2>/dev/null
}

PD_CLI="$(resolve_pd_cli || true)"
[[ -n "$PD_CLI" ]] || { c_err "Port Daddy CLI not found; install the release or set PORT_DADDY_CLI"; exit 1; }

read_record() {
  local label="$1"
  LABEL_TO_FIND="$label" FORCE_COLOR=0 NO_COLOR=1 node -e '
    const fs = require("fs");
    const path = require("path");
    const file = path.join(process.env.HOME, ".port-daddy", "dev-daemons.json");
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const row = rows.find((candidate) => candidate.label === process.env.LABEL_TO_FIND);
    if (!row) process.exit(2);
    process.stdout.write([row.port, row.pid, row.gitRev || "", row.sourceDir || ""].join("\t"));
  '
}

teardown() {
  local raw="${1:-}"
  [[ -n "$raw" ]] || { c_err "down needs a feature label"; exit 2; }
  local label runroot console_app fleetbar_app
  label="$(sanitize "$raw")"
  runroot="$HOME/coding/tmp/dev-triple-$label"
  console_app=""
  fleetbar_app=""
  if [[ -f "$runroot/triple.env" ]]; then
    console_app="$(sed -n 's/^CONSOLE_APP="\(.*\)"$/\1/p' "$runroot/triple.env" | head -1)"
    fleetbar_app="$(sed -n 's/^FLEETBAR_APP="\(.*\)"$/\1/p' "$runroot/triple.env" | head -1)"
  fi

  [[ -n "$console_app" ]] && pkill -f "$console_app/Contents/MacOS/pd-console" 2>/dev/null || true
  [[ -n "$fleetbar_app" ]] && pkill -f "$fleetbar_app/Contents/MacOS/FleetBar" 2>/dev/null || true
  "$PD_CLI" dev down "$label"
  c_ok "named triple '$label' stopped; its isolated ledger remains available"
}

NO_BUILD=0
if [[ "${1:-}" == "down" || "${1:-}" == "restore" ]]; then
  teardown "${2:-}"
  exit 0
fi
if [[ "${1:-}" == "--no-build" ]]; then
  NO_BUILD=1
  shift
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

LABEL="$(sanitize "${1:-$(current_branch)}")"
[[ -n "$LABEL" ]] || { c_err "feature label reduced to empty"; exit 2; }

BRANCH="$(current_branch)"
GITREV="$(git -C "$ROOT" rev-parse HEAD)"
RUNROOT="$HOME/coding/tmp/dev-triple-$LABEL"
case "$RUNROOT" in
  /tmp/*|/private/tmp/*) c_err "refusing volatile work directory $RUNROOT"; exit 1 ;;
esac
mkdir -p "$RUNROOT"

CONSOLE_BUILD_LOG="$RUNROOT/console-build.log"
FLEETBAR_BUILD_LOG="$RUNROOT/fleetbar-build.log"
export PD_CONSOLE_NO_LAUNCH=1 PD_FLEETBAR_NO_LAUNCH=1
if [[ "$NO_BUILD" == 1 ]]; then
  export PD_CONSOLE_NO_BUILD=1 PD_FLEETBAR_NO_BUILD=1
fi

c_info "building native surfaces for '$LABEL' while the named daemon compiles"
(bash "$ROOT/core/pd-console/scripts/package-console.sh" --devbuild "$LABEL") >"$CONSOLE_BUILD_LOG" 2>&1 &
CONSOLE_BUILD_PID=$!
(bash "$ROOT/apps/FleetBar/scripts/package-fleetbar-lane.sh" --devbuild "$LABEL") >"$FLEETBAR_BUILD_LOG" 2>&1 &
FLEETBAR_BUILD_PID=$!

if ! "$PD_CLI" dev up --from "$ROOT" --label "$LABEL"; then
  kill "$CONSOLE_BUILD_PID" "$FLEETBAR_BUILD_PID" 2>/dev/null || true
  c_err "named daemon failed; see the pd dev up output above"
  exit 1
fi

IFS=$'\t' read -r DAEMON_PORT DAEMON_PID DAEMON_GITREV DAEMON_SOURCE <<<"$(read_record "$LABEL")"
DAEMON_URL="http://127.0.0.1:$DAEMON_PORT"
[[ "$DAEMON_SOURCE" == "$ROOT" ]] || {
  c_err "berth '$LABEL' came from '$DAEMON_SOURCE', expected '$ROOT'"
  exit 1
}
[[ "$DAEMON_GITREV" == "$GITREV" || "$DAEMON_GITREV" == "${GITREV:0:${#DAEMON_GITREV}}" ]] || {
  c_err "berth '$LABEL' is stale at $DAEMON_GITREV; expected $GITREV"
  exit 1
}
WHOAMI="$(curl -fsS "$DAEMON_URL/whoami")"
WHOAMI_LABEL="$(printf '%s' "$WHOAMI" | FORCE_COLOR=0 NO_COLOR=1 node -e '
  let input=""; process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => process.stdout.write(String(JSON.parse(input).daemon?.label || "")));
')"
[[ "$WHOAMI_LABEL" == "$LABEL" ]] || { c_err "endpoint identifies as '$WHOAMI_LABEL', not '$LABEL'"; exit 1; }
c_ok "named feature daemon '$LABEL' healthy at its published endpoint (pid $DAEMON_PID)"

CONSOLE_BUILD_OK=0
FLEETBAR_BUILD_OK=0
wait "$CONSOLE_BUILD_PID" && CONSOLE_BUILD_OK=1
wait "$FLEETBAR_BUILD_PID" && FLEETBAR_BUILD_OK=1
[[ "$CONSOLE_BUILD_OK" == 1 ]] || {
  c_err "pd-console build failed"
  tail -n 25 "$CONSOLE_BUILD_LOG" >&2
  exit 1
}

CONSOLE_APP="$(ls -dt "$HOME/Applications/pd-console-dev-apps/pd-console-dev-"*"-$LABEL.app" 2>/dev/null | head -1 || true)"
[[ -d "$CONSOLE_APP" ]] || { c_err "pd-console bundle not found for '$LABEL'"; exit 1; }
FLEETBAR_APP=""
if [[ "$FLEETBAR_BUILD_OK" == 1 ]]; then
  FLEETBAR_APP="$(ls -dt "$HOME/Applications/Port Daddy/FleetBar-dev-"*"-$LABEL.app" 2>/dev/null | head -1 || true)"
fi

if [[ "${DEV_TRIPLE_NO_OPEN:-0}" != 1 ]]; then
  open -n --env "PORT_DADDY_URL=$DAEMON_URL" "$CONSOLE_APP"
  c_ok "opened pd-console against named daemon '$LABEL'"
  if [[ -n "$FLEETBAR_APP" && -d "$FLEETBAR_APP" ]]; then
    open -n --env "PORT_DADDY_URL=$DAEMON_URL" "$FLEETBAR_APP"
    c_ok "opened FleetBar against named daemon '$LABEL'"
  else
    c_warn "FleetBar build unavailable; daemon and pd-console remain usable"
    tail -n 12 "$FLEETBAR_BUILD_LOG" >&2 || true
  fi
fi

{
  printf '# dev-triple %s\n' "$LABEL"
  printf 'DAEMON_LABEL=%s\n' "$LABEL"
  printf 'DAEMON_PID=%s\n' "$DAEMON_PID"
  printf 'DAEMON_PORT=%s\n' "$DAEMON_PORT"
  printf 'DAEMON_URL=%s\n' "$DAEMON_URL"
  printf 'CONSOLE_APP="%s"\n' "$CONSOLE_APP"
  printf 'FLEETBAR_APP="%s"\n' "$FLEETBAR_APP"
  printf 'BRANCH=%s\n' "$BRANCH"
  printf 'GITREV=%s\n' "$GITREV"
} >"$RUNROOT/triple.env"

c_ok "TRIPLE UP — '$LABEL' from $BRANCH @ ${GITREV:0:12}"
printf '  daemon     %s (pid %s)\n' "$DAEMON_URL" "$DAEMON_PID"
printf '  pd-console %s\n' "$(basename "$CONSOLE_APP")"
[[ -n "$FLEETBAR_APP" ]] && printf '  FleetBar   %s\n' "$(basename "$FLEETBAR_APP")"
printf '  stop       scripts/dev-triple.sh down %s\n' "$LABEL"
