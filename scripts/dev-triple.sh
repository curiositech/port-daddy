#!/usr/bin/env bash
# dev-triple.sh — the operator's default "come look at a feature" bundle.
#
# Builds a FRESH triple — daemon + FleetBar + pd-console — ALL from the CURRENT
# git branch, ALL pointed at ONE fresh isolated daemon, then opens the two GUI
# surfaces. This is the standing default: "by default create daemon/fleetbar/
# pd-console triple bundled builds every time you want me to see a feature."
#
# It does NOT reinvent the three builders — it wires the canonical ones:
#   daemon    → node --import tsx server.ts   (NOT the Bun binary: it segfaults
#               on 3.24.0; the tsx path uses zero Bun APIs. `pd dev up` builds
#               the Bun binary, so we deliberately bypass it here.)
#   pd-console→ core/pd-console/scripts/package-console.sh --devbuild <feat>
#   FleetBar  → apps/FleetBar/scripts/package-fleetbar-lane.sh --devbuild <feat>
#
# How each surface learns which daemon to talk to:
#   pd-console: reads ~/.port-daddy/console-daemon.url (DaemonClient::discover
#               precedence #2). We back that file up, write the fresh URL, open
#               the app, and restore on `down`.
#   FleetBar:   DaemonLocation.resolveBaseURL() honours PORT_DADDY_URL FIRST and
#               does NOT read console-daemon.url — and `open` drops env — so we
#               direct-exec its binary with PORT_DADDY_URL set (the same pin the
#               OperatorTUILauncher uses when it spawns the console).
#
# The fresh daemon is fully isolated (own port ≥9900, own DB/sock/pid under
# ~/coding/tmp/dev-triple-<feat>/) so it never touches :9876 (stable) or :9886
# (dev-latest) and never clobbers ~/.port-daddy/daemon.port.
#
# Usage:
#   scripts/dev-triple.sh [<feat-label>]        # build + wire + open the triple
#   scripts/dev-triple.sh <feat-label>          # (defaults to sanitized branch)
#   scripts/dev-triple.sh down <feat-label>     # restore + quit apps + kill daemon
#   scripts/dev-triple.sh --no-build <feat>     # reuse existing release binaries (fast re-open)
#
# Env:
#   DEV_TRIPLE_NO_OPEN=1   build + wire but do not open the GUIs (CI / headless)
set -euo pipefail

# ── locate the repo (script lives at <root>/scripts/dev-triple.sh) ─────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

STABLE_PORT=9876
DEVLATEST_PORT=9886

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
c_info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }
c_err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
hr()     { printf '  %s\n' "────────────────────────────────────────────────────────────"; }

# Sanitize a feat label EXACTLY the way package-console.sh / package-fleetbar-lane.sh
# do, so we can predict the dev-bundle name and glob for it after the build.
sanitize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed 's/^-*//; s/-*$//'
}

current_branch() {
  git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached"
}

# ── subcommand: down / restore ─────────────────────────────────────────────────
teardown() {
  local raw="${1:-}"
  [ -n "$raw" ] || { c_err "down needs a <feat-label>: scripts/dev-triple.sh down <feat>"; exit 2; }
  local safe; safe="$(sanitize "$raw")"
  local runroot="$HOME/coding/tmp/dev-triple-$safe"
  [ -d "$runroot" ] || { c_warn "no run dir at $runroot — nothing to tear down (already down?)"; exit 0; }
  # Parse ONLY the keys we need from triple.env — never `source` it. It sits at a
  # predictable ~/coding/tmp path, so executing it as shell would be arbitrary code
  # execution if tampered. `up` writes DAEMON_PID bare and the *_APP paths quoted.
  local DAEMON_PID="" CONSOLE_APP="" FLEETBAR_APP=""
  if [ -f "$runroot/triple.env" ]; then
    DAEMON_PID="$(sed -n 's/^DAEMON_PID=//p'    "$runroot/triple.env" | head -1 | tr -cd '0-9')"
    CONSOLE_APP="$(sed -n 's/^CONSOLE_APP=//p'   "$runroot/triple.env" | head -1 | sed 's/^"//; s/"$//')"
    FLEETBAR_APP="$(sed -n 's/^FLEETBAR_APP=//p' "$runroot/triple.env" | head -1 | sed 's/^"//; s/"$//')"
  fi

  c_info "tearing down triple '$safe'"
  # 1. Restore the console daemon-URL switch to its pre-run state. Idempotent:
  #    COPY the backup back (keep it) so a second `down`, or `down` used as a
  #    safety check, still restores the operator's original pin instead of losing it.
  if [ -f "$runroot/console-daemon.url.bak" ]; then
    cp -f "$runroot/console-daemon.url.bak" "$HOME/.port-daddy/console-daemon.url"
    c_ok "restored ~/.port-daddy/console-daemon.url (original contents; backup kept — down is idempotent)"
  else
    rm -f "$HOME/.port-daddy/console-daemon.url"
    c_ok "removed ~/.port-daddy/console-daemon.url (there was no original)"
  fi
  # 2. Quit the two GUI surfaces (only THIS triple's bundles).
  [ -n "${CONSOLE_APP:-}" ] && pkill -f "$CONSOLE_APP/Contents/MacOS/pd-console" 2>/dev/null && c_ok "quit pd-console" || true
  [ -n "${FLEETBAR_APP:-}" ] && pkill -f "$FLEETBAR_APP/Contents/MacOS/FleetBar" 2>/dev/null && c_ok "quit FleetBar" || true
  # 3. Kill the fresh daemon — SIGTERM, wait for graceful shutdown, then SIGKILL.
  local dpid="${DAEMON_PID:-}"
  [ -z "$dpid" ] && [ -f "$runroot/rt/daemon.pid" ] && dpid="$(cat "$runroot/rt/daemon.pid" 2>/dev/null || true)"
  if [ -n "$dpid" ] && kill -0 "$dpid" 2>/dev/null; then
    kill "$dpid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6; do kill -0 "$dpid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$dpid" 2>/dev/null; then
      kill -9 "$dpid" 2>/dev/null || true
      c_ok "killed fresh daemon (pid $dpid, SIGKILL after SIGTERM timeout)"
    else
      c_ok "killed fresh daemon (pid $dpid)"
    fi
  else
    c_info "fresh daemon already gone"
  fi
  c_ok "triple '$safe' down. Run dir preserved at $runroot (rm -rf to reclaim)."
  exit 0
}

# ── argument parse ─────────────────────────────────────────────────────────────
NO_BUILD=0
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    down|restore) shift; teardown "${1:-}";;
    --no-build)   NO_BUILD=1;;
    -h|--help)    sed -n '2,45p' "$0"; exit 0;;
    -*)           c_err "unknown flag: $1 (try --help)"; exit 2;;
    *)            POSITIONAL+=("$1");;
  esac
  shift
done

RAW_LABEL="${POSITIONAL[0]:-$(current_branch)}"
LABEL="$(sanitize "$RAW_LABEL")"
[ -n "$LABEL" ] || { c_err "feat label reduced to empty after sanitising: '$RAW_LABEL'"; exit 2; }

BRANCH="$(current_branch)"
GITREV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
RUNROOT="$HOME/coding/tmp/dev-triple-$LABEL"
PREFIX="$RUNROOT/rt"                       # daemon runtime: db, sock, pid, port-file, logs

# HARD: never scratch to /tmp; never let the runtime land in the real ~/.port-daddy.
case "$RUNROOT" in
  /tmp/*|/private/tmp/*) c_err "refusing to use a /tmp path ($RUNROOT)"; exit 1;;
esac
case "$PREFIX" in
  "$HOME/.port-daddy"|"$HOME/.port-daddy/"*) c_err "refusing runtime under ~/.port-daddy"; exit 1;;
esac

mkdir -p "$PREFIX"
DAEMON_LOG="$RUNROOT/daemon.log"
CONSOLE_BUILD_LOG="$RUNROOT/console-build.log"
FLEETBAR_BUILD_LOG="$RUNROOT/fleetbar-build.log"
FLEETBAR_RUN_LOG="$RUNROOT/fleetbar-run.log"

printf '\n'
c_info "dev-triple '$LABEL'  •  branch $BRANCH @ $GITREV  •  run dir $RUNROOT"

# ── 1. Pick a FRESH port ≥9900 (so daemon EADDRINUSE fallback never walks onto
#       9876/9886, which live below), avoiding the two reserved lanes. ──────────
# FORCE_COLOR=0 + process.stdout.write(String()) are LOAD-BEARING: this env sets
# FORCE_COLOR, which makes Node colorize `console.log(<number>)` even over a pipe —
# the ANSI escapes then poison `parseInt` downstream (server.ts falls to its dev
# default). Emit a bare numeric string and validate it.
PORT="$(FORCE_COLOR=0 NO_COLOR=1 node -e '
  const net = require("net");
  const avoid = new Set([9876, 9886]);
  (function tryP(p){
    if (p > 9990) { console.error("no free port in 9900-9990"); process.exit(1); }
    if (avoid.has(p)) return tryP(p+1);
    const s = net.createServer();
    s.once("error", () => tryP(p+1));
    s.once("listening", () => { const port = s.address().port; s.close(() => process.stdout.write(String(port))); });
    s.listen(p, "127.0.0.1");
  })(9900);
')" || { c_err "could not find a free port"; exit 1; }
case "$PORT" in
  ''|*[!0-9]*) c_err "port picker returned a non-numeric value: $(printf '%q' "$PORT")"; exit 1;;
esac
if [ "$PORT" = "$STABLE_PORT" ] || [ "$PORT" = "$DEVLATEST_PORT" ]; then
  c_err "refusing to bind reserved lane :$PORT (stable/dev-latest)"; exit 1
fi
c_ok "fresh port: $PORT  (stable :$STABLE_PORT and dev-latest :$DEVLATEST_PORT untouched)"

# ── 2. Kick off the two SLOW app builds in parallel (background), so wall-clock
#       is max(console, fleetbar) not the sum. Daemon boot overlaps underneath. ─
export PD_CONSOLE_NO_LAUNCH=1 PD_FLEETBAR_NO_LAUNCH=1
[ "$NO_BUILD" = 1 ] && export PD_CONSOLE_NO_BUILD=1 PD_FLEETBAR_NO_BUILD=1

c_info "building pd-console (cargo --release --features gpui) → $CONSOLE_BUILD_LOG"
( bash "$ROOT/core/pd-console/scripts/package-console.sh" --devbuild "$LABEL" ) >"$CONSOLE_BUILD_LOG" 2>&1 &
CONSOLE_BUILD_PID=$!

c_info "building FleetBar (swift build -c release) → $FLEETBAR_BUILD_LOG"
( bash "$ROOT/apps/FleetBar/scripts/package-fleetbar-lane.sh" --devbuild "$LABEL" ) >"$FLEETBAR_BUILD_LOG" 2>&1 &
FLEETBAR_BUILD_PID=$!

# ── 3. Bring up the fresh isolated daemon (tsx path — dodges the Bun segfault). ─
c_info "starting fresh daemon via 'node --import tsx server.ts' → $DAEMON_LOG"
(
  cd "$ROOT"
  export PORT_DADDY_PREFIX="$PREFIX"
  export PORT_DADDY_PORT="$PORT"
  export NODE_ENV=development
  # Berth registration (shared/daemon-berths.ts BERTH_ENV): without these the
  # daemon boots as the default/stable berth and never self-registers into
  # ~/.port-daddy/dev-daemons.json — FleetBar's Daemons list can't show it.
  export PD_DAEMON_TIER=dev
  export PD_DAEMON_LABEL="$LABEL"
  export PD_DAEMON_SOURCE_DIR="$ROOT"
  exec node --import tsx server.ts
) >"$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!

# Wait for the daemon to write its port file AND answer /health. Read the ACTUAL
# bound port from the port file (it self-heals off EADDRINUSE, so trust the file).
DAEMON_PORT=""
for _ in $(seq 1 60); do
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    c_err "daemon exited during boot — tail of $DAEMON_LOG:"; tail -n 20 "$DAEMON_LOG" >&2
    kill "$CONSOLE_BUILD_PID" "$FLEETBAR_BUILD_PID" 2>/dev/null || true
    exit 1
  fi
  if [ -f "$PREFIX/daemon.port" ]; then
    DAEMON_PORT="$(cat "$PREFIX/daemon.port" 2>/dev/null || true)"
    if [ -n "$DAEMON_PORT" ] && curl -fsS "http://127.0.0.1:$DAEMON_PORT/health" >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 0.5
done
[ -n "$DAEMON_PORT" ] || { c_err "daemon never became healthy; tail $DAEMON_LOG:"; tail -n 20 "$DAEMON_LOG" >&2; kill "$DAEMON_PID" "$CONSOLE_BUILD_PID" "$FLEETBAR_BUILD_PID" 2>/dev/null || true; exit 1; }
if [ "$DAEMON_PORT" = "$STABLE_PORT" ] || [ "$DAEMON_PORT" = "$DEVLATEST_PORT" ]; then
  c_err "daemon bound RESERVED lane :$DAEMON_PORT — aborting to protect stable/dev-latest"; kill "$DAEMON_PID" 2>/dev/null || true; exit 1
fi
DAEMON_URL="http://127.0.0.1:$DAEMON_PORT"
HEALTH_JSON="$(curl -fsS "$DAEMON_URL/health" 2>/dev/null || echo '{}')"
DAEMON_VER="$(printf '%s' "$HEALTH_JSON" | FORCE_COLOR=0 NO_COLOR=1 node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||"?"))}catch{process.stdout.write("?")}})' 2>/dev/null || echo '?')"
c_ok "daemon healthy: $DAEMON_URL  (v$DAEMON_VER, pid $DAEMON_PID)  DB=$PREFIX/port-daddy.db"

# ── 4. Wait for BOTH app builds; daemon+console are HARD, FleetBar degrades. ────
CONSOLE_BUILD_OK=0; FLEETBAR_BUILD_OK=0
if wait "$CONSOLE_BUILD_PID"; then CONSOLE_BUILD_OK=1; fi
if wait "$FLEETBAR_BUILD_PID"; then FLEETBAR_BUILD_OK=1; fi

if [ "$CONSOLE_BUILD_OK" != 1 ]; then
  c_err "pd-console build FAILED (hard requirement). Tail of $CONSOLE_BUILD_LOG:"
  tail -n 25 "$CONSOLE_BUILD_LOG" >&2
  kill "$DAEMON_PID" 2>/dev/null || true
  exit 1
fi
c_ok "pd-console built"

# ── 5. Resolve the built bundle paths (retire-on-rebuild leaves one per name). ─
CONSOLE_APP="$(ls -dt "$HOME/Applications/pd-console-dev-apps/pd-console-dev-"*"-$LABEL.app" 2>/dev/null | head -n1 || true)"
[ -n "$CONSOLE_APP" ] && [ -d "$CONSOLE_APP" ] || { c_err "console bundle not found for '$LABEL' despite a successful build"; kill "$DAEMON_PID" 2>/dev/null || true; exit 1; }
CONSOLE_STAMP="$(basename "$CONSOLE_APP" | sed -E 's/^pd-console-dev-([0-9]{8}-[0-9]{4})-.*$/\1/')"

FLEETBAR_APP=""; FLEETBAR_STAMP=""
if [ "$FLEETBAR_BUILD_OK" = 1 ]; then
  FLEETBAR_APP="$(ls -dt "$HOME/Applications/Port Daddy/FleetBar-dev-"*"-$LABEL.app" 2>/dev/null | head -n1 || true)"
  if [ -n "$FLEETBAR_APP" ] && [ -d "$FLEETBAR_APP" ]; then
    FLEETBAR_STAMP="$(basename "$FLEETBAR_APP" | sed -E 's/^FleetBar-dev-([0-9]{8}-[0-9]{4})-.*$/\1/')"
    c_ok "FleetBar built"
  else
    FLEETBAR_BUILD_OK=0
    c_warn "FleetBar build reported success but no bundle found — degrading (daemon+console still up)"
  fi
else
  # Degrade-with-warning: surface WHY (signing vs compile) so the operator knows.
  c_warn "FleetBar build FAILED — degrading (daemon+console are the hard requirements)."
  if grep -qiE "codesign|notariz|signing identity|Developer ID|errSec" "$FLEETBAR_BUILD_LOG" 2>/dev/null; then
    c_warn "  looks like a SIGNING blocker (headless codesign). Tail of $FLEETBAR_BUILD_LOG:"
  else
    c_warn "  does NOT look signing-related (likely swift compile). Tail of $FLEETBAR_BUILD_LOG:"
  fi
  tail -n 12 "$FLEETBAR_BUILD_LOG" >&2 || true
fi

# ── 6. Wire the surfaces to the fresh daemon. ──────────────────────────────────
mkdir -p "$HOME/.port-daddy"
CONSOLE_URL_FILE="$HOME/.port-daddy/console-daemon.url"
if [ -f "$CONSOLE_URL_FILE" ]; then
  cp "$CONSOLE_URL_FILE" "$RUNROOT/console-daemon.url.bak"
  c_info "backed up existing console-daemon.url → $RUNROOT/console-daemon.url.bak"
else
  rm -f "$RUNROOT/console-daemon.url.bak"   # marker: there was no original
fi
printf '%s\n' "$DAEMON_URL" > "$CONSOLE_URL_FILE"
c_ok "wired pd-console: wrote $DAEMON_URL → $CONSOLE_URL_FILE"

# Undo the console-daemon.url wiring — used by the hard-fail abort paths below so a
# failed run never leaves the operator's console pointed at a killed fresh daemon.
restore_console_url() {
  if [ -f "$RUNROOT/console-daemon.url.bak" ]; then
    cp -f "$RUNROOT/console-daemon.url.bak" "$CONSOLE_URL_FILE"
  else
    rm -f "$CONSOLE_URL_FILE"
  fi
}

# ── 7. Verify each surface is actually pointed at the fresh port. A mismatch or an
#       unhealthy daemon here is a HARD failure: printing "TRIPLE UP" while a surface
#       is wired elsewhere (or the daemon is down) is a false success. Abort + undo.
WROTE="$(tr -d '[:space:]' < "$CONSOLE_URL_FILE")"
if [ "$WROTE" = "$DAEMON_URL" ]; then
  c_ok "verify pd-console config: console-daemon.url == $DAEMON_URL"
else
  c_err "verify pd-console config MISMATCH: file has '$WROTE', expected '$DAEMON_URL' (raced or rewritten). Aborting."
  restore_console_url; kill "$DAEMON_PID" 2>/dev/null || true; exit 1
fi
if curl -fsS "$DAEMON_URL/health" >/dev/null 2>&1; then
  c_ok "verify daemon /health: OK on :$DAEMON_PORT"
else
  c_err "verify daemon /health FAILED on :$DAEMON_PORT — daemon unhealthy. Aborting."
  restore_console_url; kill "$DAEMON_PID" 2>/dev/null || true; exit 1
fi

# ── 8. Open the surfaces (unless suppressed). ──────────────────────────────────
FLEETBAR_RUN_PID=""
if [ "${DEV_TRIPLE_NO_OPEN:-0}" = 1 ]; then
  c_info "DEV_TRIPLE_NO_OPEN=1 — built + wired, not opening GUIs"
else
  # pd-console reads console-daemon.url at startup → plain open is enough + correct.
  open "$CONSOLE_APP" && c_ok "opened pd-console → $(basename "$CONSOLE_APP")"
  if [ "$FLEETBAR_BUILD_OK" = 1 ] && [ -n "$FLEETBAR_APP" ]; then
    # FleetBar ignores console-daemon.url and `open` drops env, so direct-exec the
    # binary with PORT_DADDY_URL — the pin DaemonLocation.resolveBaseURL() honours.
    PORT_DADDY_URL="$DAEMON_URL" nohup "$FLEETBAR_APP/Contents/MacOS/FleetBar" >"$FLEETBAR_RUN_LOG" 2>&1 &
    FLEETBAR_RUN_PID=$!
    sleep 1
    if kill -0 "$FLEETBAR_RUN_PID" 2>/dev/null; then
      c_ok "opened FleetBar pinned via PORT_DADDY_URL=$DAEMON_URL (pid $FLEETBAR_RUN_PID)"
    else
      c_warn "FleetBar exited immediately after launch — tail $FLEETBAR_RUN_LOG:"; tail -n 8 "$FLEETBAR_RUN_LOG" >&2 || true
    fi
    # Best-effort live-traffic confirmation: poll the daemon log for a surface
    # request. The deterministic guarantee is the env pin above; this just adds
    # observed evidence when the poll cadence lands inside the window.
    FB_HIT=0
    for _ in 1 2 3 4 5 6 7 8; do
      if grep -qE '"path":"/(fleet|metrics|projects|fleet-proposals|secrets)' "$DAEMON_LOG" 2>/dev/null; then FB_HIT=1; break; fi
      sleep 1
    done
    if [ "$FB_HIT" = 1 ]; then
      c_ok "verify FleetBar wiring: fresh daemon logged live surface traffic (FleetBar pinned via PORT_DADDY_URL=$DAEMON_URL)"
    else
      c_info "verify FleetBar wiring: pinned deterministically via PORT_DADDY_URL=$DAEMON_URL (no request captured in the poll window — surfaces poll on their own cadence)"
    fi
  fi
fi

# ── 9. Persist teardown metadata so `down <feat>` restores exactly. ────────────
cat > "$RUNROOT/triple.env" <<ENV
# dev-triple '$LABEL' — $(date -u +%Y-%m-%dT%H:%M:%SZ)
DAEMON_PID=$DAEMON_PID
DAEMON_PORT=$DAEMON_PORT
DAEMON_URL=$DAEMON_URL
CONSOLE_APP="$CONSOLE_APP"
FLEETBAR_APP="$FLEETBAR_APP"
BRANCH=$BRANCH
GITREV=$GITREV
ENV

# ── 10. The report. ────────────────────────────────────────────────────────────
printf '\n'
c_ok "TRIPLE UP — '$LABEL'  (branch $BRANCH @ $GITREV)"
hr
printf '  %-14s %s\n' "daemon"   "$DAEMON_URL  (port $DAEMON_PORT, pid $DAEMON_PID, v$DAEMON_VER)"
printf '  %-14s %s\n' "  runtime" "$PREFIX  (DB + sock + pid + logs, all under ~/coding/tmp)"
printf '  %-14s %s\n' "pd-console" "$(basename "$CONSOLE_APP")  [build $CONSOLE_STAMP]"
if [ "$FLEETBAR_BUILD_OK" = 1 ] && [ -n "$FLEETBAR_APP" ]; then
  printf '  %-14s %s\n' "FleetBar"  "$(basename "$FLEETBAR_APP")  [build $FLEETBAR_STAMP]"
else
  printf '  %-14s %s\n' "FleetBar"  "DEGRADED — not opened (see $FLEETBAR_BUILD_LOG)"
fi
hr
printf '  Nav:\n'
printf '    • pd-console  → menu-bar/Dock: "pd-console (dev: %s)" — it reads %s\n' "$LABEL" "$CONSOLE_URL_FILE"
if [ "$FLEETBAR_BUILD_OK" = 1 ] && [ -n "$FLEETBAR_APP" ]; then
  printf '    • FleetBar    → menu bar: the FleetBar icon (dev: %s), pinned to %s\n' "$LABEL" "$DAEMON_URL"
  printf '                    Popover → Berths shows the live daemon URL.\n'
fi
printf '    • daemon      → curl %s/health   |   curl %s/fleet\n' "$DAEMON_URL" "$DAEMON_URL"
hr
printf '  RESTORE (undo everything — restore console-daemon.url, quit apps, kill daemon):\n'
printf '    scripts/dev-triple.sh down %s\n' "$LABEL"
printf '  Or by hand:\n'
if [ -f "$RUNROOT/console-daemon.url.bak" ]; then
  printf '    mv -f %s %s\n' "$RUNROOT/console-daemon.url.bak" "$CONSOLE_URL_FILE"
else
  printf '    rm -f %s\n' "$CONSOLE_URL_FILE"
fi
printf '    pkill -f %s/Contents/MacOS/pd-console\n' "'$CONSOLE_APP'"
[ -n "$FLEETBAR_APP" ] && printf '    pkill -f %s/Contents/MacOS/FleetBar\n' "'$FLEETBAR_APP'"
printf '    kill %s   # the fresh daemon\n' "$DAEMON_PID"
printf '\n'
