#!/bin/bash
# War Room Demo - Watch three agents debug a bug in real-time
#
# This script spawns all three agents and shows you the war room channel.
# Watch as they discover, correlate, and converge on the solution.

set -e

BUG_ID="${1:-demo-$(date +%s)}"
CHANNEL="war-room-$BUG_ID"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           WAR ROOM: Multi-Agent Debugging Swarm               ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Bug ID: $BUG_ID"
echo "║  Channel: $CHANNEL"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Agents:                                                      ║"
echo "║    🔍 Historian - Git archaeology                             ║"
echo "║    🔬 Tracer    - Runtime analysis                            ║"
echo "║    🗺️  Scout     - Pattern matching                           ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Port Daddy is available
if ! command -v pd &> /dev/null; then
  echo "Error: 'pd' command not found. Install Port Daddy first."
  echo "  npm install -g port-daddy"
  exit 1
fi

# Start a session for this war room
pd session start "War Room: Bug $BUG_ID" 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Make agent scripts executable
chmod +x "$SCRIPT_DIR/historian.sh" "$SCRIPT_DIR/tracer.sh" "$SCRIPT_DIR/scout.sh"

echo "Starting agents in background..."
echo ""

# Start agents in background
"$SCRIPT_DIR/historian.sh" "$BUG_ID" "TypeError: Cannot read property 'id' of undefined" &
HIST_PID=$!

"$SCRIPT_DIR/tracer.sh" "$BUG_ID" "src/api/users.ts:42" &
TRACE_PID=$!

"$SCRIPT_DIR/scout.sh" "$BUG_ID" "property 'id' of undefined" &
SCOUT_PID=$!

cleanup() {
  echo ""
  echo "Shutting down war room..."
  kill $HIST_PID $TRACE_PID $SCOUT_PID 2>/dev/null || true
  pd session done "War room $BUG_ID concluded" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "═══════════════════════════════════════════════════════════════"
echo "                    LIVE WAR ROOM FEED"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Watch the channel with pretty formatting
pd sub "$CHANNEL" 2>/dev/null | while read -r msg; do
  agent=$(echo "$msg" | jq -r '.agent // "system"' 2>/dev/null)
  type=$(echo "$msg" | jq -r '.type // "info"' 2>/dev/null)
  message=$(echo "$msg" | jq -r '.message // empty' 2>/dev/null)

  # Color coding by agent
  case "$agent" in
    historian) COLOR="\033[0;34m" ;; # Blue
    tracer)    COLOR="\033[0;33m" ;; # Yellow
    scout)     COLOR="\033[0;32m" ;; # Green
    *)         COLOR="\033[0;37m" ;; # White
  esac
  RESET="\033[0m"

  # Icon by type
  case "$type" in
    finding)     ICON="💡" ;;
    correlation) ICON="🎯" ;;
    status)      ICON="📍" ;;
    *)           ICON="•"  ;;
  esac

  # Format output
  timestamp=$(date +%H:%M:%S)
  printf "${COLOR}[%s] %s %-10s${RESET} %s\n" "$timestamp" "$ICON" "[$agent]" "$message"

  # Highlight solutions
  if [[ "$type" == "correlation" ]]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                    🎉 SOLUTION FOUND 🎉"
    echo "═══════════════════════════════════════════════════════════════"
    echo "$msg" | jq -r '.data // empty' 2>/dev/null | jq . 2>/dev/null || true
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
  fi
done

wait
