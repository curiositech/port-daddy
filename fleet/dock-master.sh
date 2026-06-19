#!/usr/bin/env zsh
# =============================================================================
# Dock Master — Fleet Commander
# =============================================================================
# Manages all fleet watchers. Monitors health, restarts dead watchers,
# publishes fleet status.
#
# Usage:
#   ./fleet/dock-master.sh   # Run as a long-lived process
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="dock-master"
STATUS_INTERVAL=300
HEALTH_CHECK_INTERVAL=60

typeset -A WATCHER_PIDS

start_watcher() {
  local name="$1" channel="$2" script="$3"

  if [[ -n "${WATCHER_PIDS[$name]}" ]] && kill -0 "${WATCHER_PIDS[$name]}" 2>/dev/null; then
    fleet_log "$AGENT_NAME" "watcher '$name' already running (PID ${WATCHER_PIDS[$name]})"
    return 0
  fi

  pd watch "$channel" --exec "$FLEET_DIR/$script" &
  WATCHER_PIDS[$name]=$!
  fleet_log "$AGENT_NAME" "started watcher '$name' on '$channel' (PID ${WATCHER_PIDS[$name]})"
}

stop_watcher() {
  local name="$1"
  if [[ -n "${WATCHER_PIDS[$name]}" ]]; then
    kill "${WATCHER_PIDS[$name]}" 2>/dev/null
    wait "${WATCHER_PIDS[$name]}" 2>/dev/null
    unset "WATCHER_PIDS[$name]"
    fleet_log "$AGENT_NAME" "stopped watcher '$name'"
  fi
}

check_watchers() {
  local dead=0
  for name pid in ${(kv)WATCHER_PIDS}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fleet_warn "$AGENT_NAME" "watcher '$name' died (was PID $pid)"
      unset "WATCHER_PIDS[$name]"
      dead=$((dead + 1))
    fi
  done

  if [[ $dead -gt 0 ]]; then
    pd_note "Dock Master: $dead watcher(s) died, restarting" "warning"
    pd_pub "fleet:alert" "{\"type\":\"watcher-death\",\"count\":$dead,\"timestamp\":$(date +%s)}"
    start_fleet
  fi
}

publish_status() {
  local watcher_count=${#WATCHER_PIDS[@]}
  local agent_count=$(curl -s "$PD_URL/agents" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null || echo 0)

  fleet_log "$AGENT_NAME" "fleet: $watcher_count watchers, $agent_count agents"
  pd_note "Fleet status: $watcher_count watchers, $agent_count agents" "progress"

  pd_pub "fleet:status" "{\"watchers\":$watcher_count,\"agents\":$agent_count,\"timestamp\":$(date +%s)}"
}

start_fleet() {
  fleet_log "$AGENT_NAME" "starting fleet watchers..."

  # Event-driven watchers
  start_watcher "qa-adversary"    "git:committed"     "qa-adversary.sh"
  start_watcher "test-gap-hunter" "git:committed"     "test-gap-hunter.sh"
  start_watcher "documentarian"   "git:committed"     "documentarian.sh"
  start_watcher "simplifier"      "git:committed"     "simplifier.sh"
  start_watcher "research-scout"  "research:request"  "research-scout.sh"

  # Spark runs on his own loop (not a pd watch subscriber)
  if [[ -z "${WATCHER_PIDS[spark]}" ]] || ! kill -0 "${WATCHER_PIDS[spark]}" 2>/dev/null; then
    "$FLEET_DIR/spark.sh" --loop 1800 &
    WATCHER_PIDS[spark]=$!
    fleet_log "$AGENT_NAME" "started Spark (PID ${WATCHER_PIDS[spark]}, 30-min cycle)"
  fi

  fleet_success "$AGENT_NAME" "fleet started: ${#WATCHER_PIDS[@]} watchers"
}

stop_fleet() {
  fleet_log "$AGENT_NAME" "stopping fleet..."
  for name in ${(k)WATCHER_PIDS}; do
    stop_watcher "$name"
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Preflight
fleet_preflight || exit 1
fleet_register "$AGENT_NAME" "Fleet commander" || exit 1
trap 'stop_fleet; fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

start_fleet
publish_status

LAST_STATUS=$(date +%s)
while true; do
  sleep "$HEALTH_CHECK_INTERVAL"
  check_watchers

  local now=$(date +%s)
  if (( now - LAST_STATUS >= STATUS_INTERVAL )); then
    publish_status
    LAST_STATUS=$now
  fi
done
