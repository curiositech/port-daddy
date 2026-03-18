#!/usr/bin/env zsh
# =============================================================================
# Dock Master — Fleet Commander
# =============================================================================
# Meta-agent that manages the entire fleet. Monitors agent health, salvages
# dead agents, restarts failed watchers, and publishes fleet status.
#
# Usage:
#   ./fleet/dock-master.sh   # Run as a long-lived process
#
# Channels:
#   Subscribes to: fleet:*, agents:dead
#   Publishes to: fleet:status, fleet:alert
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="dock-master"
STATUS_INTERVAL=300  # Publish fleet status every 5 minutes
HEALTH_CHECK_INTERVAL=60  # Check agent health every minute

# Track managed watchers
typeset -A WATCHER_PIDS

start_watcher() {
  local name="$1" channel="$2" script="$3"

  if [[ -n "${WATCHER_PIDS[$name]}" ]] && kill -0 "${WATCHER_PIDS[$name]}" 2>/dev/null; then
    fleet_log "$AGENT_NAME" "Watcher '$name' already running (PID ${WATCHER_PIDS[$name]})"
    return 0
  fi

  pd watch "$channel" --exec "$FLEET_DIR/$script" &
  WATCHER_PIDS[$name]=$!
  fleet_log "$AGENT_NAME" "Started watcher '$name' on channel '$channel' (PID ${WATCHER_PIDS[$name]})"
}

stop_watcher() {
  local name="$1"
  if [[ -n "${WATCHER_PIDS[$name]}" ]]; then
    kill "${WATCHER_PIDS[$name]}" 2>/dev/null
    wait "${WATCHER_PIDS[$name]}" 2>/dev/null
    unset "WATCHER_PIDS[$name]"
    fleet_log "$AGENT_NAME" "Stopped watcher '$name'"
  fi
}

check_watchers() {
  local dead=0
  for name pid in ${(kv)WATCHER_PIDS}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fleet_warn "$AGENT_NAME" "Watcher '$name' died (was PID $pid) — restarting"
      unset "WATCHER_PIDS[$name]"
      dead=$((dead + 1))
    fi
  done

  if [[ $dead -gt 0 ]]; then
    pd_pub "fleet:alert" "{\"type\":\"watcher-death\",\"count\":$dead,\"timestamp\":$(date +%s)}"
    # Restart the fleet to bring dead watchers back
    start_fleet
  fi
}

publish_status() {
  local watcher_count=${#WATCHER_PIDS[@]}
  local agent_count=$(curl -s "$PD_URL/agents" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null || echo 0)
  local salvage_count=$(curl -s "$PD_URL/salvage/pending" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)

  fleet_log "$AGENT_NAME" "Fleet: $watcher_count watchers, $agent_count agents, $salvage_count salvageable"

  pd_pub "fleet:status" "{
    \"watchers\":$watcher_count,
    \"agents\":$agent_count,
    \"salvageable\":$salvage_count,
    \"watcher_names\":[$(echo ${(k)WATCHER_PIDS} | sed 's/ /","/g' | sed 's/^/"/' | sed 's/$/"/')],
    \"timestamp\":$(date +%s)
  }"
}

check_salvage() {
  local salvage=$(curl -s "$PD_URL/salvage/pending" 2>/dev/null)
  local count=$(echo "$salvage" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)

  if [[ "$count" -gt 0 ]]; then
    fleet_warn "$AGENT_NAME" "$count dead agent(s) in salvage queue"
    pd_pub "fleet:alert" "{\"type\":\"salvage\",\"count\":$count,\"timestamp\":$(date +%s)}"
  fi
}

start_fleet() {
  fleet_log "$AGENT_NAME" "Starting fleet watchers..."

  # Core watchers — these run continuously
  start_watcher "qa-adversary"    "git:committed"     "qa-adversary.sh"
  start_watcher "test-gap-hunter" "git:committed"     "test-gap-hunter.sh"
  start_watcher "documentarian"   "git:committed"     "documentarian.sh"
  start_watcher "simplifier"      "git:committed"     "simplifier.sh"
  start_watcher "research-scout"  "research:request"  "research-scout.sh"

  # Spark runs on his own loop, not as a pd watch subscriber
  if [[ -z "${WATCHER_PIDS[spark]}" ]] || ! kill -0 "${WATCHER_PIDS[spark]}" 2>/dev/null; then
    "$FLEET_DIR/spark.sh" --loop 1800 &
    WATCHER_PIDS[spark]=$!
    fleet_log "$AGENT_NAME" "Started Spark (PID ${WATCHER_PIDS[spark]}, 30-min cycle)"
  fi

  fleet_success "$AGENT_NAME" "Fleet started: ${#WATCHER_PIDS[@]} watchers active (including Spark)"
}

stop_fleet() {
  fleet_log "$AGENT_NAME" "Stopping fleet..."
  for name in ${(k)WATCHER_PIDS}; do
    stop_watcher "$name"
  done
  fleet_log "$AGENT_NAME" "Fleet stopped"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Fleet commander — manage all background agents"
trap 'stop_fleet; fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

start_fleet

# Main loop — health checks and status
LAST_STATUS=0
while true; do
  sleep "$HEALTH_CHECK_INTERVAL"

  # Check watcher health
  check_watchers

  # Check salvage queue
  check_salvage

  # Periodic status
  local now=$(date +%s)
  if (( now - LAST_STATUS >= STATUS_INTERVAL )); then
    publish_status
    LAST_STATUS=$now
  fi
done
