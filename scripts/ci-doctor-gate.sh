#!/usr/bin/env bash
#
# ci-doctor-gate.sh — boot the compiled daemon on a scratch port/prefix and run
# `pd doctor` against it in machine mode, gating the build on CRITICAL health.
#
# WHY THIS EXISTS: `pd doctor` is the comprehensive health surface, but until
# now it had no machine-readable mode and no CI gate. A daemon that boots but
# 404's its own route contract, or ships with a corrupt registry, would pass
# every other check (the route smoke asserts individual 200s; it does not fold
# them into a single health verdict). This step:
#   1. boots the COMPILED daemon (the bun:sqlite binary users actually run),
#   2. asserts /health carries the shared `severity` field (route enrichment),
#   3. runs the COMPILED `pd doctor --json` and `--ci`, asserting it exits 0
#      (no CRITICAL) — WARN-level findings (e.g. systemd not installed for a
#      manually-booted daemon) are loud but do NOT gate.
#
# Hermetic: scratch port + scratch prefix/DB under the repo; EXIT trap tears
# down. Never touches an operator daemon or the real registry.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_BIN="$ROOT_DIR/dist/daemon/port-daddy-daemon"
CLI_BIN="$ROOT_DIR/dist/port-daddy"
PORT="${DOCTOR_GATE_PORT:-19890}"
SCRATCH_BASE="${DOCTOR_GATE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-doctor-gate.XXXXXX")"
LOG="$SCRATCH/daemon.log"
DAEMON_PID=""

cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  rm -rf "$SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -x "$DAEMON_BIN" ]; then
  echo "FAIL: compiled daemon not found at $DAEMON_BIN (run: npm run build:daemon:dist)" >&2
  exit 1
fi
if [ ! -x "$CLI_BIN" ]; then
  echo "FAIL: compiled CLI not found at $CLI_BIN (run: npm run build:bin)" >&2
  exit 1
fi

echo "Booting compiled daemon for doctor gate: $DAEMON_BIN (port $PORT, scratch $SCRATCH)"
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_NO_FLEET=1 \
PORT_DADDY_NO_FLEETBAR=1 \
PORT_DADDY_SILENT=1 \
"$DAEMON_BIN" > "$LOG" 2>&1 &
DAEMON_PID=$!

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

# 1. /health must carry the shared severity field (route enrichment shipped).
HEALTH_JSON="$(curl -s "$BASE/health")"
if ! printf '%s' "$HEALTH_JSON" | grep -q '"severity":"ok"'; then
  echo "FAIL: /health did not report severity=ok on a freshly-booted daemon" >&2
  printf '%s\n' "$HEALTH_JSON" >&2
  exit 1
fi
echo "OK: /health reports the shared severity=ok"

# 2. `pd doctor --json` must be valid JSON carrying severity + summary, and must
#    exit 0 (no CRITICAL). A manually-booted daemon has no systemd unit, which is
#    a WARN — that must NOT fail the gate.
export PORT_DADDY_URL="$BASE"
export PORT_DADDY_PREFIX="$SCRATCH"
echo "Running: pd doctor --json"
if ! DOCTOR_JSON="$("$CLI_BIN" doctor --json)"; then
  echo "FAIL: pd doctor --json exited non-zero (a CRITICAL health failure)" >&2
  printf '%s\n' "$DOCTOR_JSON" >&2
  exit 1
fi
# Validate it parses and has the expected shape (node is available on the runner).
printf '%s' "$DOCTOR_JSON" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const r = JSON.parse(s);
    if (!r.severity || !r.summary || !Array.isArray(r.checks)) {
      console.error("FAIL: doctor JSON missing severity/summary/checks"); process.exit(1);
    }
    if (r.summary.critical > 0) {
      console.error("FAIL: doctor reports " + r.summary.critical + " CRITICAL check(s)"); process.exit(1);
    }
    console.log("OK: pd doctor --json severity=" + r.severity +
      " (" + r.summary.ok + " ok, " + r.summary.warn + " warn, " + r.summary.critical + " critical)");
  });
'

# 3. `pd doctor --ci` (human output, gated exit) must also exit 0.
echo "Running: pd doctor --ci"
if ! "$CLI_BIN" doctor --ci; then
  echo "FAIL: pd doctor --ci exited non-zero (a CRITICAL health failure)" >&2
  exit 1
fi

echo "Doctor gate PASSED"
