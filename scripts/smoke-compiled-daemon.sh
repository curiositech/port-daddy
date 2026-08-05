#!/usr/bin/env bash
#
# smoke-compiled-daemon.sh — boot the `bun build --compile` daemon on an
# isolated port + scratch DB and assert hot read routes return HTTP 200.
#
# WHY THIS EXISTS: the daemon ships as a Bun-compiled binary that runs on
# `bun:sqlite`, while the jest suite runs on `better-sqlite3`. bun:sqlite
# rejects binding mistakes (bare-key `@named` object binds, NULL LIMIT)
# that better-sqlite3 tolerates — so route-level SQLITE_MISMATCH /
# NOT NULL bugs were invisible to CI and shipped to the compiled daemon
# (GET /roadmap/items 500 SQLITE_MISMATCH). This script exercises the
# REAL compiled binary against REAL routes so any future bun:sqlite route
# regression fails CI.
#
# Hermetic: scratch port, scratch DB/prefix under a temp dir we create and
# remove. Does NOT touch any operator daemon or real registry DB.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${SMOKE_DAEMON_BIN:-$ROOT_DIR/dist/daemon/port-daddy-daemon}"

choose_free_port() {
  node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); process.stdout.write(String(address.port)); server.close(); });'
}

PORT="${SMOKE_PORT:-$(choose_free_port)}"
OCCUPY_PREFERRED="${SMOKE_OCCUPY_PREFERRED:-1}"
# Keep Unix-domain sockets below macOS's short sun_path limit. Linked worktree
# paths can already consume that budget before the per-run suffix is added.
# The machine-wide rule also reserves ~/coding/tmp for recoverable scratch.
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-${HOME:?}/coding/tmp/port-daddy-smoke}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-smoke.XXXXXX")"
LOG="$SCRATCH/daemon.log"
PORT_FILE="$SCRATCH/daemon.port"
DAEMON_PID=""
PREFERRED_BLOCKER_PID=""
SECOND_BLOCKER_PID=""

stop_child() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  wait "$pid" 2>/dev/null || true
}

start_preferred_blocker() {
  local port="$1"
  local ready_file="$2"
  local pid_variable="$3"
  local spawned_pid=""
  rm -f "$ready_file"
  BLOCK_PORT="$port" BLOCK_READY_FILE="$ready_file" node -e '
    const fs = require("node:fs");
    const http = require("node:http");
    const server = http.createServer((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("occupied by smoke witness");
    });
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    server.listen(Number(process.env.BLOCK_PORT), "127.0.0.1", () => {
      fs.writeFileSync(process.env.BLOCK_READY_FILE, "ready\n");
    });
  ' >"$ready_file.log" 2>&1 &
  spawned_pid=$!
  # Publish the PID to cleanup immediately. A signal during the readiness wait
  # must not leave the witness process orphaned.
  printf -v "$pid_variable" '%s' "$spawned_pid"
  for _ in $(seq 1 50); do
    [ -s "$ready_file" ] && return 0
    kill -0 "$spawned_pid" 2>/dev/null || break
    sleep 0.1
  done
  echo "FAIL: could not occupy preferred seed for fallback proof" >&2
  cat "$ready_file.log" >&2 2>/dev/null || true
  return 1
}

cleanup() {
  stop_child "$DAEMON_PID"
  stop_child "$PREFERRED_BLOCKER_PID"
  stop_child "$SECOND_BLOCKER_PID"
  rm -rf "$SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

case "$OCCUPY_PREFERRED" in
  0) ;;
  1)
    start_preferred_blocker "$PORT" "$SCRATCH/preferred-seed.ready" PREFERRED_BLOCKER_PID
    ;;
  *) echo "FAIL: SMOKE_OCCUPY_PREFERRED must be 0 or 1" >&2; exit 1 ;;
esac

if [ ! -x "$BIN" ]; then
  echo "FAIL: compiled daemon not found at $BIN (run: bun run build:daemon:dist)" >&2
  exit 1
fi

echo "Booting compiled daemon: $BIN (preferred port $PORT, scratch $SCRATCH)"
env \
  -u PD_DAEMON_TIER \
  -u PD_DAEMON_LABEL \
  -u PD_DAEMON_COLOR \
  -u PD_DAEMON_SOURCE_DIR \
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_PORT_FILE="$PORT_FILE" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
"$BIN" > "$LOG" 2>&1 &
DAEMON_PID=$!

# Wait for the daemon to publish the endpoint it actually bound, then use that
# endpoint for health and every route assertion (up to ~20s).
BASE=""
ready=0
for _ in $(seq 1 40); do
  if [ -s "$PORT_FILE" ]; then
    SELECTED_PORT="$(tr -d '\r\n' < "$PORT_FILE")"
    case "$SELECTED_PORT" in
      ''|*[!0-9]*) ;;
      *)
        BASE="http://127.0.0.1:$SELECTED_PORT"
        if curl -fsS -o /dev/null "$BASE/health" 2>/dev/null; then ready=1; break; fi
        ;;
    esac
  fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "FAIL: daemon process exited during boot" >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: daemon did not become healthy in time" >&2
  cat "$LOG" >&2 || true
  exit 1
fi
if [ "$OCCUPY_PREFERRED" = 1 ] && [ "$SELECTED_PORT" = "$PORT" ]; then
  echo "FAIL: daemon published the occupied preferred seed instead of its fallback" >&2
  exit 1
fi
echo "Daemon healthy."

# Assert a route returns HTTP 200 (the bun:sqlite regression surface).
assert_200() {
  local path="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  if [ "$code" != "200" ]; then
    echo "FAIL: GET $path returned HTTP $code (expected 200)" >&2
    echo "--- response body ---" >&2
    curl -s "$BASE$path" >&2 || true
    echo >&2
    echo "--- daemon log tail ---" >&2
    tail -30 "$LOG" >&2 || true
    return 1
  fi
  echo "OK: GET $path -> 200"
}

# Assert a POST route returns an EXPECTED HTTP status (used for routes whose
# happy path needs state we don't seed — a precise status still proves the
# plugin is registered and reaches its store under the compiled binary).
assert_post_status() {
  local path="$1"
  local expected="$2"
  local body="${3:-}"
  local code
  if [ -n "$body" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$body" "$BASE$path")"
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$path")"
  fi
  if [ "$code" != "$expected" ]; then
    echo "FAIL: POST $path returned HTTP $code (expected $expected)" >&2
    echo "--- daemon log tail ---" >&2
    tail -30 "$LOG" >&2 || true
    return 1
  fi
  echo "OK: POST $path -> $expected"
}

# /roadmap/items is the route that 500'd with SQLITE_MISMATCH. /secrets is
# another read-only hot route exercised for breadth. Both must be 200.
fail=0
assert_200 "/roadmap/items?status=all" || fail=1
assert_200 "/roadmap/items?status=now" || fail=1
assert_200 "/roadmap/items?limit=5" || fail=1
assert_200 "/secrets" || fail=1
# FleetBar-polled daemon surfaces must not 404 in the packaged binary. These
# caught live drift where route registration/order bugs were hidden by source
# tests and only showed up in operator logs.
assert_200 "/fleet/forecast" || fail=1
assert_200 "/fleet-proposals" || fail=1
assert_200 "/popper/status" || fail=1
assert_200 "/harbormaster/status" || fail=1
# /relay/config is the relay surface (ADR-0049). It shipped DEAD on three
# layers (plugin never registered; the `config` table it reads was never
# created; the exchange key lookup hit a non-existent table). Asserting 200
# here under the COMPILED bun:sqlite binary guards all three against
# regression in the exact runtime the daemon ships — a 404 means the plugin
# is unregistered again; a 500 means the `config` self-init regressed.
assert_200 "/relay/config" || fail=1
# Agent Cockpit (Watch + Grab the Wheel, Phase 0). POST /agents/:id/interrupt
# is the soft-steer signal; for an UNKNOWN agent it must return 404 — which
# proves the plugin is registered AND its agents.get() store lookup runs under
# the compiled bun:sqlite binary (a 404 here, not a 500 SQLITE_MISMATCH or a
# 404-because-route-missing). The GET /agents/:id/stream SSE feed is held-open,
# so it is regression-covered by tests/bun/agent-cockpit-stream.test.ts instead.
assert_post_status "/agents/__smoke_unknown__/interrupt" "404" '{"reason":"smoke"}' || fail=1

# Daemon Berths (ADR-0084): the compiled binary must self-report its berth
# identity on /health and /whoami. Booted with NO PD_DAEMON_* env above, so it
# must default to the STABLE, CANONICAL berth — verifying the brew daemon
# transparently reports as `stable` with no launch change. We grep the JSON
# (jq is not guaranteed on the runner) for the canonical default markers.
assert_200 "/whoami" || fail=1
echo "Checking default berth identity (must be stable + canonical)…"
HEALTH_JSON="$(curl -s "$BASE/health")"
if ! printf '%s' "$HEALTH_JSON" | grep -q '"tier":"stable"'; then
  echo "FAIL: /health daemon.tier is not \"stable\" by default" >&2
  printf '%s\n' "$HEALTH_JSON" >&2
  fail=1
else
  echo "OK: /health reports default berth tier=stable"
fi
if ! printf '%s' "$HEALTH_JSON" | grep -q '"canonical":true'; then
  echo "FAIL: /health daemon.canonical is not true by default" >&2
  fail=1
else
  echo "OK: /health reports default berth canonical=true"
fi

if [ "$fail" -ne 0 ]; then
  echo "Compiled-daemon smoke FAILED" >&2
  exit 1
fi

# Second boot: with PD_DAEMON_TIER=dev-latest the SAME binary must report the
# non-canonical dev-latest berth (proving env-driven berth identity works end to
# end in the real bun runtime, not just in jest).
echo "Re-booting with PD_DAEMON_TIER=dev-latest to verify env-driven berth identity…"
stop_child "$DAEMON_PID"
DAEMON_PID=""
stop_child "$PREFERRED_BLOCKER_PID"
PREFERRED_BLOCKER_PID=""
PORT2="${SMOKE_PORT2:-$(choose_free_port)}"
PORT_FILE2="$SCRATCH/daemon2.port"
if [ "$OCCUPY_PREFERRED" = 1 ]; then
  start_preferred_blocker "$PORT2" "$SCRATCH/second-preferred-seed.ready" SECOND_BLOCKER_PID
fi
PORT_DADDY_PORT="$PORT2" \
PORT_DADDY_PORT_FILE="$PORT_FILE2" \
PORT_DADDY_DB="$SCRATCH/registry2.db" \
PORT_DADDY_PREFIX="$SCRATCH/p2" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
PD_DAEMON_TIER=dev-latest \
PD_DAEMON_LABEL=ci-dev-latest \
"$BIN" > "$SCRATCH/daemon2.log" 2>&1 &
DAEMON_PID=$!
BASE2=""
ready2=0
for _ in $(seq 1 40); do
  if [ -s "$PORT_FILE2" ]; then
    SELECTED_PORT2="$(tr -d '\r\n' < "$PORT_FILE2")"
    case "$SELECTED_PORT2" in
      ''|*[!0-9]*) ;;
      *)
        BASE2="http://127.0.0.1:$SELECTED_PORT2"
        if curl -fsS -o /dev/null "$BASE2/health" 2>/dev/null; then ready2=1; break; fi
        ;;
    esac
  fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
if [ "$ready2" -ne 1 ]; then
  echo "FAIL: dev-latest berth did not become healthy" >&2
  cat "$SCRATCH/daemon2.log" >&2 || true
  exit 1
fi
if [ "$OCCUPY_PREFERRED" = 1 ] && [ "$SELECTED_PORT2" = "$PORT2" ]; then
  echo "FAIL: second daemon published the occupied preferred seed instead of its fallback" >&2
  exit 1
fi
WHOAMI_JSON="$(curl -s "$BASE2/whoami")"
if ! printf '%s' "$WHOAMI_JSON" | grep -q '"tier":"dev-latest"'; then
  echo "FAIL: PD_DAEMON_TIER=dev-latest not honored on /whoami" >&2
  printf '%s\n' "$WHOAMI_JSON" >&2
  exit 1
fi
if ! printf '%s' "$WHOAMI_JSON" | grep -q '"canonical":false'; then
  echo "FAIL: dev-latest berth should report canonical=false" >&2
  printf '%s\n' "$WHOAMI_JSON" >&2
  exit 1
fi
echo "OK: env-driven berth identity verified (dev-latest, canonical=false)"

echo "Compiled-daemon smoke PASSED"
