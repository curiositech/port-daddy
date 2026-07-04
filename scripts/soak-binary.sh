#!/usr/bin/env bash
#
# soak-binary.sh — boot the PACKAGED daemon binary and hold it under load
# checks long enough to catch boot-adjacent crashes before a release ships.
#
# Why this exists: v3.24.0 shipped a standalone binary that segfaulted
# (Bun 1.2.21 null-deref, main thread) ~68 seconds after every boot on the
# operator machine. Nothing in CI ever RAN the packaged binary — unit tests
# run from source under a different runtime shape than the compiled bundle —
# so the crash sailed through to brew, killed the production daemon, and
# left a half-alive zombie (see lib/daemon-takeover.ts and issue #676).
#
# HONEST SCOPE: this gate is a baseline, not a universal reproducer. In
# validation (2026-07-04), the broken 3.24.0 binary PASSED both an idle and
# a workload sandbox soak — its crash needs production-shaped state (large
# DB, configured fleet, real client mix; ~0.9GB RSS at crash). What this
# gate DOES catch, which was previously unguarded: binaries that crash on
# boot, crash on first-firing timers with fresh state, wedge under
# connection load, or refuse to die on SIGTERM. State-dependent crashes are
# issue #676's territory (candidate follow-up: soak against a seeded
# production-scale DB snapshot). The 180s window lets every ~60s timer
# (pheromone evaporator, bosun heartbeat) fire at least twice.
#
# Usage:
#   scripts/soak-binary.sh <path-to-daemon-binary> [more binary args...]
#
# Env knobs:
#   SOAK_SECONDS      total soak time after first healthy reply (default 180)
#   SOAK_BOOT_GRACE   max seconds to wait for the first healthy reply (default 90)
#   SOAK_PORT         TCP port for the sandboxed daemon (default 19876)
#   SOAK_PREFIX       sandbox dir (default: fresh dir under the runner temp;
#                     never /tmp on operator machines — pass one explicitly)
#
# Exit: 0 = survived the full window, answered /health throughout, no crash
# markers, and shut down cleanly on SIGTERM. Anything else = 1, with the log
# tail dumped for forensics.

set -euo pipefail

BIN="${1:?usage: soak-binary.sh <daemon-binary>}"
shift || true

SOAK_SECONDS="${SOAK_SECONDS:-180}"
SOAK_BOOT_GRACE="${SOAK_BOOT_GRACE:-90}"
SOAK_PORT="${SOAK_PORT:-19876}"
SOAK_PREFIX="${SOAK_PREFIX:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pd-soak-$$}"

mkdir -p "$SOAK_PREFIX"
LOG="$SOAK_PREFIX/soak.log"

# Crash signatures. "panic(" catches bun panics on any thread; the other two
# are the exact strings from the 3.24.0 incident.
CRASH_RE='panic\(|Segmentation fault|oh no: Bun has crashed'

health_ok() {
  # -m covers a wedged-but-listening daemon; a healthy one answers in <5s
  # even during post-boot catch-up.
  curl -sf -m 10 "http://127.0.0.1:${SOAK_PORT}/health" 2>/dev/null | grep -q '"status":"ok"'
}

fail() {
  echo "SOAK FAIL: $1"
  echo "--- last 40 log lines ---"
  tail -40 "$LOG" 2>/dev/null || true
  kill "$DAEMON_PID" 2>/dev/null || true
  exit 1
}

echo "Soaking $BIN for ${SOAK_SECONDS}s on port ${SOAK_PORT} (sandbox: $SOAK_PREFIX)"

PORT_DADDY_PREFIX="$SOAK_PREFIX" \
PORT_DADDY_PORT="$SOAK_PORT" \
"$BIN" start --foreground "$@" >"$LOG" 2>&1 &
DAEMON_PID=$!

# ── Boot grace: wait for the first healthy reply ────────────────────────────
booted=""
for _ in $(seq 1 "$SOAK_BOOT_GRACE"); do
  kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon exited during boot"
  if grep -Eq "$CRASH_RE" "$LOG"; then fail "crash marker during boot"; fi
  if health_ok; then booted=1; break; fi
  sleep 1
done
[ -n "$booted" ] || fail "no healthy /health reply within ${SOAK_BOOT_GRACE}s"
echo "Boot OK — daemon healthy. Holding for ${SOAK_SECONDS}s…"

# ── Workload (SOAK_WORKLOAD=0 to disable) ───────────────────────────────────
# A pristine idle daemon is not what production runs: the 3.24.0 segfault
# reproduced on the operator machine (fleet running, console + FleetBar
# clients connected, ~0.9GB RSS) but NOT in a bare sandbox soak. We cannot
# fully simulate production state in CI, but we can at least keep the server
# layer busy: held SSE subscriptions, connection churn, and a read-endpoint
# hammer. This makes the gate a load soak, not an idle nap. (Honest limit:
# state-dependent crashes like #676 may still need production-shaped data.)
WORKLOAD_PIDS=()
if [ "${SOAK_WORKLOAD:-1}" = "1" ]; then
  for _ in 1 2 3 4; do
    curl -sN --max-time $((SOAK_SECONDS + 60)) \
      "http://127.0.0.1:${SOAK_PORT}/dashboard/events" >/dev/null 2>&1 &
    WORKLOAD_PIDS+=($!)
  done
  (
    while :; do
      curl -sf -m 5 "http://127.0.0.1:${SOAK_PORT}/fleet"  >/dev/null 2>&1 || true
      curl -sf -m 5 "http://127.0.0.1:${SOAK_PORT}/ping"   >/dev/null 2>&1 || true
      curl -sf -m 5 "http://127.0.0.1:${SOAK_PORT}/health" >/dev/null 2>&1 || true
      # connection churn: short-lived SSE subscribe/abandon
      curl -sN --max-time 2 "http://127.0.0.1:${SOAK_PORT}/dashboard/events" >/dev/null 2>&1 || true
      sleep 1
    done
  ) &
  WORKLOAD_PIDS+=($!)
  echo "Workload armed: 4 held SSE streams + read-hammer + connection churn."
fi
stop_workload() { for p in "${WORKLOAD_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap stop_workload EXIT

# ── Soak window ─────────────────────────────────────────────────────────────
misses=0
end=$(( $(date +%s) + SOAK_SECONDS ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep 5
  kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon died mid-soak (the 3.24.0 signature)"
  if grep -Eq "$CRASH_RE" "$LOG"; then fail "crash marker mid-soak"; fi
  if health_ok; then
    misses=0
  else
    misses=$((misses + 1))
    echo "health miss ($misses/3)"
    # 3 consecutive misses ≈ 15s+30s of curl budget of silence: wedged.
    [ "$misses" -lt 3 ] || fail "health stopped answering (wedged daemon)"
  fi
done

# ── Clean shutdown ──────────────────────────────────────────────────────────
kill -TERM "$DAEMON_PID" 2>/dev/null || fail "daemon vanished at shutdown check"
for _ in $(seq 1 15); do
  kill -0 "$DAEMON_PID" 2>/dev/null || { echo "SOAK PASS: survived ${SOAK_SECONDS}s, healthy throughout, clean SIGTERM exit."; exit 0; }
  sleep 1
done
fail "daemon ignored SIGTERM for 15s"
