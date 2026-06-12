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
LOG="$SCRATCH/daemon.log"
DAEMON_PID=""

cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  rm -rf "$SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -x "$BIN" ]; then
  echo "FAIL: compiled daemon not found at $BIN (run: npm run build:daemon:dist)" >&2
  exit 1
fi

echo "Booting compiled daemon: $BIN (port $PORT, scratch $SCRATCH)"
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
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

# /roadmap/items is the route that 500'd with SQLITE_MISMATCH. /secrets is
# another read-only hot route exercised for breadth. Both must be 200.
fail=0
assert_200 "/roadmap/items?status=all" || fail=1
assert_200 "/roadmap/items?status=now" || fail=1
assert_200 "/roadmap/items?limit=5" || fail=1
assert_200 "/secrets" || fail=1
# /relay/config is the relay surface (ADR-0049). It shipped DEAD on three
# layers (plugin never registered; the `config` table it reads was never
# created; the exchange key lookup hit a non-existent table). Asserting 200
# here under the COMPILED bun:sqlite binary guards all three against
# regression in the exact runtime the daemon ships — a 404 means the plugin
# is unregistered again; a 500 means the `config` self-init regressed.
assert_200 "/relay/config" || fail=1

if [ "$fail" -ne 0 ]; then
  echo "Compiled-daemon smoke FAILED" >&2
  exit 1
fi
echo "Compiled-daemon smoke PASSED"
