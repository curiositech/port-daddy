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
DIAGNOSTIC_REPORT_DIR="$SCRATCH/DiagnosticReports"
DAEMON_PID=""
mkdir -p "$DIAGNOSTIC_REPORT_DIR"

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
if ! HEALTH_JSON="$(curl -fsS "$BASE/health")"; then
  echo "FAIL: /health route did not respond on a freshly-booted daemon" >&2
  cat "$LOG" >&2 || true
  exit 1
fi
if ! printf '%s' "$HEALTH_JSON" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    let r;
    try {
      r = JSON.parse(s);
    } catch (err) {
      console.error("FAIL: /health did not return valid JSON: " + err.message);
      process.exit(1);
    }
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      console.error("FAIL: /health returned a non-object JSON payload");
      process.exit(1);
    }
    if (r.severity !== "ok") {
      console.error("FAIL: /health severity expected ok, got " + String(r.severity));
      process.exit(1);
    }
  });
'; then
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
export PORT_DADDY_DAEMON_LOG_PATHS="$LOG"
export PORT_DADDY_DIAGNOSTIC_REPORT_DIR="$DIAGNOSTIC_REPORT_DIR"
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
    // ── HONESTY INVARIANTS (a health check that lies is worse than none) ───────
    // The doctor must actually have run its checks, not short-circuit to a tiny
    // green report (the empty-registry-reads-green failure class).
    if (r.checks.length < 20) {
      console.error("FAIL: doctor only ran " + r.checks.length + " checks — suspiciously short (short-circuit?)");
      process.exit(1);
    }
    // NO check may report ok:true while its own detail admits a probe FAILED.
    // Match only failure phrasings ("could not", "unable to") — NOT legitimate
    // platform skips ("Skipped on linux", "macOS-only"), which are honest N/A, not lies.
    const CANT = /\b(could ?not|couldn.t|unable to)\b/i;
    const liars = r.checks.filter(c => c.ok === true && CANT.test(c.detail || ""));
    if (liars.length) {
      console.error("FAIL: " + liars.length + " check(s) report OK while admitting they could not check:");
      for (const c of liars) console.error("  - " + c.name + ": " + c.detail);
      process.exit(1);
    }
    // The Bosun watchdog is REQUIRED and was built above — it must be present and
    // must NOT emit the old "binary not built" false-negative on a healthy daemon.
    const bosun = r.checks.find(c => c.name === "Bosun watchdog");
    if (!bosun) { console.error("FAIL: no Bosun watchdog check present"); process.exit(1); }
    if (bosun.severity !== "ok") {
      console.error("FAIL: Bosun watchdog is REQUIRED but not ok: " + bosun.severity + " — " + bosun.detail);
      process.exit(1);
    }
    if (/not built/i.test(bosun.detail || "")) {
      console.error("FAIL: Bosun watchdog reported the false-negative \"not built\" while the watchdog was built");
      process.exit(1);
    }
    console.log("OK: pd doctor --json severity=" + r.severity +
      " (" + r.summary.ok + " ok, " + r.summary.warn + " warn, " + r.summary.critical + " critical); " +
      "honesty invariants held across " + r.checks.length + " checks");
  });
'

# 3. `pd doctor --ci` (human output, gated exit) must also exit 0.
echo "Running: pd doctor --ci"
if ! "$CLI_BIN" doctor --ci; then
  echo "FAIL: pd doctor --ci exited non-zero (a CRITICAL health failure)" >&2
  exit 1
fi

# 4. HONESTY (3.26.2): `pd doctor` against a DOWN daemon must EXIT NON-ZERO. Previously a
#    dead daemon was only a WARN, so `pd doctor --ci/--json` exited 0 over a corpse — a green
#    build atop a dead daemon. Point doctor at a port with no daemon and require a failure.
DEAD_URL="http://127.0.0.1:59991"
echo "Running: pd doctor --ci against a DEAD daemon at $DEAD_URL (must fail)"
if PORT_DADDY_URL="$DEAD_URL" "$CLI_BIN" doctor --ci >/dev/null 2>&1; then
  echo "FAIL: pd doctor --ci exited 0 while the daemon was unreachable — the exit-code lie is back" >&2
  exit 1
fi
echo "OK: pd doctor gates exit non-zero when the daemon is down"

echo "Doctor gate PASSED"
