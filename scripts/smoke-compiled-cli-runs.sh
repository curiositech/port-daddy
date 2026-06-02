#!/usr/bin/env bash
#
# smoke-compiled-cli-runs.sh — the gate that proves the COMPILED CLI actually
# RUNS. This is the test that was missing: prior compiled smokes set
# PORT_DADDY_URL explicitly (bypassing daemon discovery), and the single-binary
# smoke only exercised the `__daemon` entrypoint — so a compiled binary whose
# CLI path was dead (or that failed to bootstrap at all) sailed through CI green.
#
# Here we boot the daemon from the compiled binary, then drive the binary as a
# BARE CLI (`pd status`, `pd tube`) the way an operator does — via discovery,
# NOT a URL override — and FAIL the build if the CLI can't run. `status` is run
# 3x to catch intermittent bootstrap failures, not just a single lucky start.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT_DIR/dist/port-daddy"
PORT="${SMOKE_CLI_RUNS_PORT:-19874}"
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-cli-runs.XXXXXX")"
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

echo "Booting self-hosted scratch daemon from the compiled binary..."
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_SOCK="$SOCK" \
PORT_DADDY_NO_FLEET=1 PORT_DADDY_NO_FLEETBAR=1 PORT_DADDY_SILENT=1 PORT_DADDY_DISABLE_KEYCHAIN=1 \
"$BIN" __daemon > "$LOG" 2>&1 &
DAEMON_PID=$!

ready=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null; then ready=1; break; fi
  kill -0 "$DAEMON_PID" 2>/dev/null || { echo "FAIL: daemon exited during boot" >&2; cat "$LOG" >&2 || true; exit 1; }
  sleep 0.3
done
[ "$ready" = 1 ] || { echo "FAIL: daemon not healthy in time" >&2; cat "$LOG" >&2 || true; exit 1; }
echo "Daemon healthy."

# BARE CLI env: discovery only (PORT + PREFIX + SOCK), NOT PORT_DADDY_URL. This
# is the path an operator's `pd` uses. If the compiled CLI can't bootstrap or
# can't discover/talk to the daemon, these fail.
CLI_ENV=(env "PORT_DADDY_PORT=$PORT" "PORT_DADDY_PREFIX=$SCRATCH" "PORT_DADDY_SOCK=$SOCK")
fail=0

# 1. `pd status` must RUN — exit 0 AND print the running banner. 3x to catch a
#    binary that only bootstraps intermittently.
for i in 1 2 3; do
  echo "--- pd status (run $i/3) ---"
  set +e
  out="$("${CLI_ENV[@]}" "$BIN" status 2>&1)"; code=$?
  set -e
  if [ "$code" -ne 0 ]; then
    echo "FAIL: 'pd status' run $i exited $code — the compiled CLI did not run." >&2
    echo "      out: ${out:-<empty>}" >&2
    fail=1; break
  fi
  if ! printf %s "$out" | grep -q "Port Daddy is running"; then
    echo "FAIL: 'pd status' run $i produced no status banner (compiled CLI broken/silent)." >&2
    echo "      out: ${out:-<empty>}" >&2
    fail=1; break
  fi
  echo "OK: pd status run $i ran and reported a running daemon."
done

# 2. `pd tube --send` (bare) must post.
if [ "$fail" -eq 0 ]; then
  echo "--- pd tube --send (bare) ---"
  set +e
  tout="$(printf %s 'cli-runs smoke body' | "${CLI_ENV[@]}" "$BIN" tube smoke:ci --send 2>&1)"; tcode=$?
  set -e
  if [ "$tcode" -ne 0 ] || ! printf %s "$tout" | grep -q "posted id="; then
    echo "FAIL: bare 'pd tube --send' did not post (exit=$tcode out=${tout:-<empty>})." >&2
    fail=1
  else
    echo "OK: bare pd tube --send posted."
  fi
fi

# 3. Multi-subscriber fan-out: two listeners (distinct --as) must BOTH receive
#    one send. Keeps the 3.16.2 fan-out working AND exercises tube live.
if [ "$fail" -eq 0 ]; then
  echo "--- pd tube fan-out (2 listeners, 1 send) ---"
  "${CLI_ENV[@]}" "$BIN" tube fan:ci --tail --json --as la >"$SCRATCH/la.out" 2>&1 &
  L1=$!
  "${CLI_ENV[@]}" "$BIN" tube fan:ci --tail --json --as lb >"$SCRATCH/lb.out" 2>&1 &
  L2=$!
  sleep 3
  printf %s 'fan-out smoke' | "${CLI_ENV[@]}" "$BIN" tube fan:ci --send --as snd >/dev/null 2>&1 || true
  sleep 4
  kill "$L1" "$L2" 2>/dev/null || true
  if grep -q "fan-out smoke" "$SCRATCH/la.out" && grep -q "fan-out smoke" "$SCRATCH/lb.out"; then
    echo "OK: both listeners received the message (fan-out intact)."
  else
    echo "FAIL: fan-out regression — not both listeners received the message." >&2
    echo "  la: $(cat "$SCRATCH/la.out" 2>/dev/null | tail -1)" >&2
    echo "  lb: $(cat "$SCRATCH/lb.out" 2>/dev/null | tail -1)" >&2
    fail=1
  fi
fi

[ "$fail" -eq 0 ] || { echo "Compiled-CLI runs smoke FAILED" >&2; exit 1; }
echo "Compiled-CLI runs smoke PASSED"
