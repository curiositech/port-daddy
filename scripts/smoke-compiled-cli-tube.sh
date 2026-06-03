#!/usr/bin/env bash
#
# smoke-compiled-cli-tube.sh — drive `pd tube --send` through the
# `bun build --compile` CLI binary against a scratch self-hosted daemon.
#
# WHY THIS EXISTS: `pd tube CH --send` (no body arg) reads the message body from
# stdin. That read runs in the CLI, which ships as a Bun-compiled binary whose
# runtime differs from dev (node/tsx): `process.stdin.isTTY` can be
# undefined/false on a REAL terminal. The old code gated solely on that flag, so
# an INTERACTIVE `pd tube CH --send` (no pipe) did not throw the helpful error —
# it fell through to `for await (chunk of stdin)` and HUNG FOREVER. jest never
# runs the compiled binary, so the bug was invisible to CI. This smoke exercises
# the REAL compiled CLI's stdin path end-to-end:
#   1. a piped body posts to the channel (the normal --send case still works);
#   2. an interactive (PTY) --send errors FAST, never hangs (the regression).
#
# Hermetic: self-hosted scratch daemon on a scratch port + DB + socket. Touches
# no real ports/registry. The PTY check uses python3 (present on both mac and
# ubuntu runners) so it works cross-platform without `script(1)` syntax skew.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT_DIR/dist/port-daddy"
PORT="${SMOKE_CLI_TUBE_PORT:-19873}"
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-cli-tube.XXXXXX")"
LOG="$SCRATCH/daemon.log"
SOCK="$SCRATCH/pd.sock"
DAEMON_PID=""

cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  rm -rf "$SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -x "$BIN" ]; then
  echo "FAIL: compiled CLI binary not found at $BIN (run: npm run build:bin)" >&2
  exit 1
fi

echo "Booting self-hosted scratch daemon: $BIN __daemon (port $PORT, scratch $SCRATCH)"
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_SOCK="$SOCK" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
PORT_DADDY_DISABLE_KEYCHAIN=1 \
"$BIN" __daemon > "$LOG" 2>&1 &
DAEMON_PID=$!

BASE="http://127.0.0.1:$PORT"
ready=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$BASE/health" 2>/dev/null; then ready=1; break; fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "FAIL: scratch daemon exited during boot" >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.3
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: scratch daemon did not become healthy in time" >&2
  cat "$LOG" >&2 || true
  exit 1
fi
echo "Scratch daemon healthy."

export PORT_DADDY_URL="$BASE"
export PORT_DADDY_SOCK="$SOCK"
export PORT_DADDY_NO_RETRY=1
fail=0

# 1. Piped body: the compiled-bun CLI must READ stdin and post to the channel.
echo "--- 1. piped body posts to the channel (compiled-bun stdin read) ---"
set +e
out_pipe="$(printf %s 'smoke tube body' | "$BIN" tube smoke:ch --send 2>&1)"
code_pipe=$?
set -e
echo "    exit=$code_pipe out=$out_pipe"
if ! printf %s "$out_pipe" | grep -q "posted id="; then
  echo "FAIL: piped 'tube --send' did not post (compiled-bun may not be reading stdin)." >&2
  fail=1
else
  echo "OK: piped body was read and posted to the channel."
fi

# 2. Interactive (PTY) --send must ERROR FAST, never hang. python3's pty gives
#    fd 0 a real terminal, so the kernel `isStdinInteractive` returns true and
#    the command must throw the 'needs a body on stdin' error immediately.
#    `timeout 10` catches a hang as exit 124 — that would be the regression.
echo "--- 2. interactive (PTY) --send errors fast, never hangs (the regression) ---"
set +e
out_tty="$(timeout 10 python3 - "$BIN" <<'PY' 2>&1
import os, sys, pty
binpath = sys.argv[1]
status = pty.spawn([binpath, "tube", "smoke:ch", "--send"])
# Map wait status → process exit code where available.
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else (status >> 8))
PY
)"
code_tty=$?
set -e
echo "    exit=$code_tty"
echo "    out=$(printf %s "$out_tty" | tr -d '\r' | tail -1)"
if [ "$code_tty" -eq 124 ]; then
  echo "FAIL: interactive 'tube --send' HUNG (timed out) — the exact regression." >&2
  fail=1
elif ! printf %s "$out_tty" | grep -q "needs a body on stdin"; then
  echo "FAIL: interactive 'tube --send' did not print the 'needs a body on stdin' error." >&2
  echo "      Got: $out_tty" >&2
  fail=1
else
  echo "OK: interactive --send errored fast with the helpful message (no hang)."
fi

if [ "$fail" -ne 0 ]; then
  echo "Compiled-CLI tube smoke FAILED" >&2
  exit 1
fi
echo "Compiled-CLI tube smoke PASSED"
