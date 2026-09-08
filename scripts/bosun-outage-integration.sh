#!/usr/bin/env bash
#
# Bosun outage integration test (2026-07-14 halt-mandate white-team).
#
# Drives the REAL compiled pd-bosun binary through a daemon-death cycle and
# asserts the Phase-C guarantees the mandate requires:
#   (a) on a dead daemon PID, Bosun fires a restart (calls `launchctl kickstart`)
#   (b) a LOUD, durable operator signal fires when restarts are exhausted (the
#       alert file is written + the stderr log screams)
#   (c) `pd-bosun status` reports the daemon DEAD / would_restart during the
#       outage (the liveness truth that dominates `pd doctor`'s RED verdict —
#       the doctor-side verdict itself is pinned deterministically in
#       tests/unit/diagnostics-doctor.test.js so this script needs no daemon).
#
# It never touches the operator's real launchd/daemon: a STUB `launchctl` on a
# private PATH captures the kickstart call, and a throwaway HOME under
# ~/coding/tmp (NEVER /tmp — macOS purges it) holds the heartbeat/pid/alert.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# `core/` is a Cargo workspace → member builds land in core/target/release.
BOSUN_BIN="${REPO_ROOT}/core/target/release/pd-bosun"

if [[ ! -x "$BOSUN_BIN" ]]; then
  echo "[test] building pd-bosun (release)…"
  cargo build --manifest-path "${REPO_ROOT}/core/pd-bosun/Cargo.toml" --release -j 1
fi

WORK="$(mktemp -d "${HOME}/coding/tmp/bosun-outage.XXXXXX")"
trap 'rm -rf "$WORK"; [[ -n "${DAEMON_PID:-}" ]] && kill "$DAEMON_PID" 2>/dev/null || true; [[ -n "${BOSUN_PID:-}" ]] && kill "$BOSUN_PID" 2>/dev/null || true' EXIT

HEARTBEAT="${WORK}/heartbeat"
PIDFILE="${WORK}/daemon.pid"
PORTFILE="${WORK}/daemon.port"
ALERT="${WORK}/bosun.alert"
KICK_MARKER="${WORK}/kickstart-called"
STUBDIR="${WORK}/stub-bin"
BOSUN_LOG="${WORK}/bosun.log"
mkdir -p "$STUBDIR"

# Stub launchctl: records that a restart was requested, then does NOTHING (the
# daemon stays dead) so Bosun exhausts its attempts and MUST alert loudly.
cat > "${STUBDIR}/launchctl" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "kickstart" ]]; then
  echo "kickstart $*" >> "${PORT_DADDY_TEST_KICK_MARKER}"
fi
exit 0
STUB
chmod +x "${STUBDIR}/launchctl"

# Fake daemon: a plain long sleep. Its PID is what Bosun probes for liveness.
sleep 3600 &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PIDFILE"
echo "19876" > "$PORTFILE"

write_heartbeat() {
  local pid="$1" now_ms
  now_ms=$(( $(date +%s) * 1000 ))
  cat > "$HEARTBEAT" <<JSON
{"schema":"port-daddy.bosun.heartbeat.v1","pid":${pid},"writtenAt":${now_ms},"uptimeMs":5000,"version":"test","codeHash":"deadbeef","startedAt":1000,"installDir":"${WORK}","pidFile":"${PIDFILE}","portFile":"${PORTFILE}","hostname":"itest"}
JSON
}
write_heartbeat "$DAEMON_PID"

fail() { echo "[FAIL] $1"; exit 1; }

# ── Pre-check: a live daemon reads healthy (would_restart=false) ─────────────
STATUS_HEALTHY="$(PORT_DADDY_HEARTBEAT_FILE="$HEARTBEAT" "$BOSUN_BIN" status)"
echo "$STATUS_HEALTHY" | grep -q '"wouldRestart": false' \
  || fail "a live daemon should read healthy, got: $STATUS_HEALTHY"
echo "[ok] live daemon reads healthy"

# ── Induce the outage: SIGKILL the daemon (the pid file still names it) ───────
kill -9 "$DAEMON_PID"; wait "$DAEMON_PID" 2>/dev/null || true

# (c) status must now report DEAD + would_restart during the outage.
STATUS_DEAD="$(PORT_DADDY_HEARTBEAT_FILE="$HEARTBEAT" "$BOSUN_BIN" status)"
echo "$STATUS_DEAD" | grep -q '"wouldRestart": true' \
  || fail "a dead daemon must read would_restart=true, got: $STATUS_DEAD"
echo "$STATUS_DEAD" | grep -Eq '"state": "(dead|stale)"' \
  || fail "a dead daemon must read state dead/stale, got: $STATUS_DEAD"
echo "[ok] (c) status reports the outage: dead + would_restart"

# ── Run the watcher: fast ticks, max 1 attempt so the give-up alert is prompt.
#    max=1 → the FIRST (immediate) restart attempt also hits the cap and alerts.
PORT_DADDY_HEARTBEAT_FILE="$HEARTBEAT" \
PORT_DADDY_BOSUN_ALERT_FILE="$ALERT" \
PORT_DADDY_BOSUN_INTERVAL_MS=200 \
PORT_DADDY_BOSUN_STALE_MS=400 \
PORT_DADDY_BOSUN_MAX_RESTART_ATTEMPTS=1 \
PORT_DADDY_BOSUN_DAEMON_LABEL=com.portdaddy.daemon.test \
PORT_DADDY_TEST_KICK_MARKER="$KICK_MARKER" \
PATH="${STUBDIR}:${PATH}" \
  "$BOSUN_BIN" watch > "$BOSUN_LOG" 2>&1 &
BOSUN_PID=$!

# Give it a few ticks to detect, restart, and alert.
deadline=$(( $(date +%s) + 8 ))
while [[ $(date +%s) -lt $deadline ]]; do
  [[ -f "$KICK_MARKER" && -f "$ALERT" ]] && break
  sleep 0.2
done
kill "$BOSUN_PID" 2>/dev/null || true; wait "$BOSUN_PID" 2>/dev/null || true

# (a) a restart was actually fired (launchctl kickstart called).
[[ -f "$KICK_MARKER" ]] || fail "(a) Bosun never called launchctl kickstart. log:
$(cat "$BOSUN_LOG")"
grep -q 'kickstart' "$KICK_MARKER" || fail "(a) kickstart marker present but empty"
echo "[ok] (a) Bosun fired a restart (launchctl kickstart called)"

# (b) a LOUD, durable give-up signal fired: the alert file + a screaming log.
[[ -f "$ALERT" ]] || fail "(b) no alert file written after restarts exhausted. log:
$(cat "$BOSUN_LOG")"
grep -q 'port-daddy.bosun.alert.v1' "$ALERT" || fail "(b) alert file lacks the v1 schema"
grep -q 'ALERT' "$BOSUN_LOG" || fail "(b) bosun log did not scream ALERT. log:
$(cat "$BOSUN_LOG")"
echo "[ok] (b) loud give-up signal fired (alert file + ALERT log line)"

echo ""
echo "PASS: bosun-outage-integration — kill → restart-attempt → loud alert, all observed."
