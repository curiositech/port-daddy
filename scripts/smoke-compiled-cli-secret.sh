#!/usr/bin/env bash
#
# smoke-compiled-cli-secret.sh — drive `pd secret set` through the
# `bun build --compile` CLI binary against a scratch self-hosted daemon.
#
# WHY THIS EXISTS: `pd secret set` reads the value from an interactive HIDDEN
# prompt (TTY) or a single stdin line (pipe). That read path runs in the CLI,
# which ships as a Bun-compiled binary. The compiled bun runtime differs from
# the dev runtime (node/tsx): `process.stdin.isTTY` can be undefined/false on a
# real terminal, and `setRawMode` can be absent — so the interactive prompt
# silently fell through to the pipe branch, hit EOF, and no-op'd (operator saw
# an instant return that stored nothing). jest never runs the compiled binary,
# so the bug was invisible to CI. This smoke exercises the REAL compiled CLI's
# stdin read path end-to-end so any future regression of that path fails CI.
#
# Hermetic: self-hosted scratch daemon (via the binary's hidden `__daemon`
# entrypoint) on a scratch port + DB + socket, with the OS keychain DISABLED
# (PORT_DADDY_DISABLE_KEYCHAIN=1). Because the keychain is disabled, a piped
# `set` fails CLOSED with a clear message rather than writing to any real
# keychain — so this NEVER touches an operator's stored secrets. The assertions
# are about the CLI's stdin handling, not about persistence (that round-trip is
# covered by tests/bun/secret-prompt.test.ts against the live keychain path).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT_DIR/dist/port-daddy"
PORT="${SMOKE_CLI_PORT:-19872}"
# Scratch lives under the repo (never /tmp — macOS purges it). CI wipes the
# checkout; the EXIT trap removes it locally.
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-cli-secret.XXXXXX")"
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

CLI_ENV=(env "PORT_DADDY_URL=$BASE" "PORT_DADDY_SOCK=$SOCK" "PORT_DADDY_NO_RETRY=1")
fail=0

# 1. Piped value: the CLI must READ the line off stdin and reach the daemon.
#    With the keychain disabled it fails closed — but a fail-closed response
#    proves the value was read and the request was made (the bun pipe path
#    works in the compiled binary). A SILENT no-op (the bug) would never get
#    here. We accept exit!=0 but REQUIRE the daemon-side "storage unavailable"
#    message, which only appears once the value reached the route.
echo "--- 1. piped value reaches the daemon (compiled-bun stdin read) ---"
set +e
out_pipe="$(printf %s 'smoke-secret-value' | "${CLI_ENV[@]}" "$BIN" secret set CF_API_TOKEN 2>&1)"
code_pipe=$?
set -e
echo "    exit=$code_pipe out=$out_pipe"
if ! printf %s "$out_pipe" | grep -q "storage is unavailable"; then
  echo "FAIL: piped 'secret set' did not reach the daemon storage path." >&2
  echo "      The compiled-bun CLI may not be reading stdin (the original bug)." >&2
  echo "      Got: $out_pipe" >&2
  fail=1
else
  echo "OK: piped value was read and reached the daemon (fail-closed as expected, keychain off)."
fi

# 2. Empty stdin: must error LOUDLY and exit non-zero — never a silent success.
echo "--- 2. empty stdin errors loudly, exits non-zero (no silent no-op) ---"
set +e
out_empty="$(printf '' | "${CLI_ENV[@]}" "$BIN" secret set CF_API_TOKEN 2>&1)"
code_empty=$?
set -e
echo "    exit=$code_empty out=$out_empty"
if [ "$code_empty" -eq 0 ]; then
  echo "FAIL: empty 'secret set' exited 0 — silent no-op regression." >&2
  fail=1
elif ! printf %s "$out_empty" | grep -q "No value entered"; then
  echo "FAIL: empty 'secret set' did not print the 'No value entered' error." >&2
  echo "      Got: $out_empty" >&2
  fail=1
else
  echo "OK: empty stdin → loud 'No value entered' error, exit $code_empty."
fi

if [ "$fail" -ne 0 ]; then
  echo "Compiled-CLI secret smoke FAILED" >&2
  exit 1
fi
echo "Compiled-CLI secret smoke PASSED"
