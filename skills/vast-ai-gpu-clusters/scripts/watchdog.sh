#!/bin/bash
# Autonomous Idle Watchdog & Spend-Cap Enforcer
# Checks GPU utilization every 60s; if idle < 5% for 10 consecutive checks, destroys instance.

MAX_IDLE_CHECKS=10
IDLE_COUNT=0
CONTAINER_ID="${VAST_CONTAINERLABEL:-}"

echo "[Watchdog] Starting GPU idle watchdog on container: $CONTAINER_ID"

while true; do
  if ! command -v nvidia-smi &> /dev/null; then
    echo "[Watchdog] nvidia-smi not found. Exiting."
    exit 1
  fi

  UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits | head -n 1)

  if [ -z "$UTIL" ]; then
    UTIL=0
  fi

  if [ "$UTIL" -lt 5 ]; then
    IDLE_COUNT=$((IDLE_COUNT + 1))
    echo "[Watchdog] GPU idle ($UTIL%). Count: $IDLE_COUNT / $MAX_IDLE_CHECKS"
  else
    IDLE_COUNT=0
  fi

  if [ "$IDLE_COUNT" -ge "$MAX_IDLE_CHECKS" ]; then
    echo "[Watchdog] Maximum idle threshold reached (10 min). Enforcing spend cap teardown."
    if [ -n "$CONTAINER_ID" ] && command -v vastai &> /dev/null; then
      vastai destroy instance "$CONTAINER_ID"
    fi
    exit 0
  fi

  sleep 60
done
