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
# left a half-alive zombie (see lib/daemon-reconciliation.ts and issue #676).
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
# (pheromone evaporator, daemon heartbeat) fire at least twice.
#
# Usage:
#   scripts/soak-binary.sh <path-to-daemon-binary> [more binary args...]
#
# Env knobs:
#   SOAK_SECONDS      total soak time after first healthy reply (default 180)
#   SOAK_BOOT_GRACE   wall-clock deadline for the first healthy reply (default 90)
#   SOAK_WORKLOAD     1 (default) = SSE holds + read hammer + churn; 0 = idle
#   SOAK_PREFIX       sandbox dir. Default: $RUNNER_TEMP in CI, else a fresh
#                     mktemp -d dir (macOS: per-user /var/folders, NOT the
#                     periodically-purged /tmp). Pass one explicitly to keep
#                     the sandbox for forensics.
#
# Exit: 0 = survived the full window, answered /health throughout, no crash
# markers, and shut down cleanly on SIGTERM. Anything else = 1, with the log
# tail dumped for forensics.

set -euo pipefail

BIN="${1:?usage: soak-binary.sh <daemon-binary>}"
shift || true

SOAK_SECONDS="${SOAK_SECONDS:-180}"
SOAK_BOOT_GRACE="${SOAK_BOOT_GRACE:-90}"
SOAK_PORT=""
if [ -z "${SOAK_PREFIX:-}" ]; then
  if [ -n "${RUNNER_TEMP:-}" ]; then
    SOAK_PREFIX="$RUNNER_TEMP/pd-soak-$$"
  else
    # mktemp respects TMPDIR (macOS: per-user /var/folders — durable, unlike /tmp)
    SOAK_PREFIX="$(mktemp -d -t pd-soak)"
  fi
fi

mkdir -p "$SOAK_PREFIX"
LOG="$SOAK_PREFIX/soak.log"
PORT_FILE="$SOAK_PREFIX/daemon.port"
rm -f "$PORT_FILE"

# Crash signatures. "panic(" catches bun panics on any thread; the other two
# are the exact strings from the 3.24.0 incident.
CRASH_RE='panic\(|Segmentation fault|oh no: Bun has crashed'

# health_ok [timeout-seconds] — boot polling wants snappy probes so the grace
# deadline holds; the soak loop wants a longer budget so a slow-but-alive
# daemon (post-boot catch-up regularly answers in 2–3s) is not misread.
health_ok() {
  [ -n "$SOAK_PORT" ] || return 1
  curl -sf -m "${1:-10}" "http://127.0.0.1:${SOAK_PORT}/health" 2>/dev/null | grep -q '"status":"ok"'
}

DAEMON_PID=""
WORKLOAD_PIDS=()
cleanup() {
  for p in "${WORKLOAD_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  # Never leave the sandbox daemon running (or the port held) on ANY exit
  # path — including set -e surprises. On the PASS path it is already dead.
  [ -n "$DAEMON_PID" ] && kill -9 "$DAEMON_PID" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "SOAK FAIL: $1"
  echo "--- last 40 log lines ---"
  tail -40 "$LOG" 2>/dev/null || true
  exit 1
}

echo "Soaking $BIN for ${SOAK_SECONDS}s on its published port (sandbox: $SOAK_PREFIX)"

PORT_DADDY_PREFIX="$SOAK_PREFIX" \
"$BIN" start --foreground "$@" >"$LOG" 2>&1 &
DAEMON_PID=$!

# ── Boot grace: wall-clock deadline, snappy probes ──────────────────────────
# Deadline-based (not iteration-counted) so slow/timing-out health probes
# cannot stretch a 90s grace into minutes of apparent hang.
booted=""
boot_deadline=$(( $(date +%s) + SOAK_BOOT_GRACE ))
while [ "$(date +%s)" -lt "$boot_deadline" ]; do
  kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon exited during boot"
  if grep -Eq "$CRASH_RE" "$LOG"; then fail "crash marker during boot"; fi
  if [ -z "$SOAK_PORT" ] && [ -s "$PORT_FILE" ]; then
    candidate="$(tr -d '[:space:]' < "$PORT_FILE")"
    case "$candidate" in
      ''|*[!0-9]*) fail "daemon published an invalid port: $candidate" ;;
    esac
    [ "$candidate" -ge 1 ] && [ "$candidate" -le 65535 ] \
      || fail "daemon published an out-of-range port: $candidate"
    SOAK_PORT="$candidate"
    echo "Published daemon port discovered: ${SOAK_PORT}"
  fi
  if health_ok 3; then booted=1; break; fi
  sleep 1
done
[ -n "$booted" ] || fail "no healthy /health reply on the published daemon port within ${SOAK_BOOT_GRACE}s"
echo "Boot OK — daemon healthy. Holding for ${SOAK_SECONDS}s…"

# ── Workload (SOAK_WORKLOAD=0 to disable) ───────────────────────────────────
# A pristine idle daemon is not what production runs: the 3.24.0 segfault
# reproduced on the operator machine (fleet running, console + FleetBar
# clients connected, ~0.9GB RSS) but NOT in a bare sandbox soak. We cannot
# fully simulate production state in CI, but we can at least keep the server
# layer busy: held SSE subscriptions, connection churn, and a read-endpoint
# hammer. This makes the gate a load soak, not an idle nap. (Honest limit:
# state-dependent crashes like #676 may still need production-shaped data.)
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

# ── Soak window ─────────────────────────────────────────────────────────────
misses=0
end=$(( $(date +%s) + SOAK_SECONDS ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep 5
  kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon died mid-soak (the 3.24.0 signature)"
  if grep -Eq "$CRASH_RE" "$LOG"; then fail "crash marker mid-soak"; fi
  if health_ok 10; then
    misses=0
  else
    misses=$((misses + 1))
    echo "health miss ($misses/3)"
    # 3 consecutive misses (≥45s of silence incl. curl budgets): wedged.
    [ "$misses" -lt 3 ] || fail "health stopped answering (wedged daemon)"
  fi
done

# ── Clean shutdown ──────────────────────────────────────────────────────────
kill -TERM "$DAEMON_PID" 2>/dev/null || fail "daemon vanished at shutdown check"
shutdown_deadline=$(( $(date +%s) + 15 ))
while [ "$(date +%s)" -lt "$shutdown_deadline" ]; do
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "SOAK PASS: survived ${SOAK_SECONDS}s, healthy throughout, clean SIGTERM exit."
    exit 0
  fi
  sleep 1
done
fail "daemon ignored SIGTERM for 15s"
