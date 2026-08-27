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
BIN="$ROOT_DIR/dist/daemon/port-daddy-daemon"
PORT="${SMOKE_PORT:-19876}"
# Scratch lives under the repo (never /tmp — macOS purges it). CI runners
# wipe the checkout anyway, and the EXIT trap removes it locally.
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-smoke.XXXXXX")"
# AF_UNIX paths are capped at roughly 104 bytes on macOS. Keep sockets in the
# machine's durable coding scratch root instead of deriving them from an
# arbitrarily deep linked worktree. This also obeys the no-/tmp operator rule.
SOCKET_BASE="${SMOKE_SOCKET_BASE:-${HOME:?}/coding/tmp/pd-smoke-sockets}"
mkdir -p "$SOCKET_BASE"
SOCKET_SCRATCH="$(mktemp -d "$SOCKET_BASE/run.XXXXXX")"
LOG="$SCRATCH/daemon.log"
SOCK="$SOCKET_SCRATCH/pd.sock"
IPC="$SOCKET_SCRATCH/pd.ipc"
DAEMON_PID=""

cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  rm -rf "$SCRATCH" 2>/dev/null || true
  rm -rf "$SOCKET_SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

if [ "${#SOCK}" -ge 96 ] || [ "${#IPC}" -ge 96 ]; then
  echo "FAIL: compiled-smoke Unix socket paths must stay below 96 bytes" >&2
  exit 1
fi

if [ ! -x "$BIN" ]; then
  echo "FAIL: compiled daemon not found at $BIN (run: npm run build:daemon:dist)" >&2
  exit 1
fi

echo "Booting compiled daemon: $BIN (port $PORT, scratch $SCRATCH)"
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_SOCK="$SOCK" \
PORT_DADDY_IPC="$IPC" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
"$BIN" > "$LOG" 2>&1 &
DAEMON_PID=$!

# Wait for /health (up to ~20s).
BASE="http://127.0.0.1:$PORT"
ready=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "$BASE/health" 2>/dev/null; then ready=1; break; fi
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

# Prove the same compiled daemon is reachable through its Unix HTTP socket;
# TCP-only success would miss the exact transport used by interactive hooks.
assert_socket_200() {
  local socket_path="$1"
  local path="$2"
  local log_path="${3:-$LOG}"
  local code
  code="$(curl -s --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' "http://localhost$path")"
  if [ "$code" != "200" ]; then
    echo "FAIL: Unix socket GET $path returned HTTP $code (expected 200)" >&2
    tail -30 "$log_path" >&2 || true
    return 1
  fi
  echo "OK: Unix socket GET $path -> 200"
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
if [ ! -S "$SOCK" ] || [ ! -S "$IPC" ]; then
  echo "FAIL: compiled daemon did not bind both short Unix sockets" >&2
  fail=1
fi
assert_socket_200 "$SOCK" "/health" || fail=1
assert_socket_200 "$SOCK" "/roadmap/items?limit=1" || fail=1
assert_200 "/roadmap/items?status=all" || fail=1
assert_200 "/roadmap/items?status=now" || fail=1
assert_200 "/roadmap/items?limit=5" || fail=1
assert_200 "/secrets" || fail=1
# Context continuity is FleetBar's operator proof over Agent Harbor's
# append-only envelope/packet evidence. An empty fresh registry is a valid
# response, but the compiled Bun runtime must register and execute the route.
assert_200 "/agent-harbor/context-continuity?limit=1" || fail=1
# O3 Tool2Vec reconciliation must be registered in the packaged Bun daemon,
# and a cold fresh registry is a valid read-only status response. This catches
# route-registration and bun:sqlite schema drift without invoking a generator.
assert_200 "/skill-graft/status" || fail=1
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
kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
PORT2="$((PORT + 10))"
SOCK2="$SOCKET_SCRATCH/p2.sock"
IPC2="$SOCKET_SCRATCH/p2.ipc"
PORT_DADDY_PORT="$PORT2" \
PORT_DADDY_DB="$SCRATCH/registry2.db" \
PORT_DADDY_PREFIX="$SCRATCH/p2" \
PORT_DADDY_SOCK="$SOCK2" \
PORT_DADDY_IPC="$IPC2" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
PD_DAEMON_TIER=dev-latest \
PD_DAEMON_LABEL=ci-dev-latest \
"$BIN" > "$SCRATCH/daemon2.log" 2>&1 &
DAEMON_PID=$!
BASE2="http://127.0.0.1:$PORT2"
ready2=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "$BASE2/health" 2>/dev/null; then ready2=1; break; fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
if [ "$ready2" -ne 1 ]; then
  echo "FAIL: dev-latest berth did not become healthy" >&2
  cat "$SCRATCH/daemon2.log" >&2 || true
  exit 1
fi
if [ ! -S "$SOCK2" ] || [ ! -S "$IPC2" ]; then
  echo "FAIL: dev-latest boot did not bind both short Unix sockets" >&2
  exit 1
fi
assert_socket_200 "$SOCK2" "/health" "$SCRATCH/daemon2.log" || exit 1
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
