#!/usr/bin/env zsh
# =============================================================================
# pd fleet — Fleet management CLI
# =============================================================================
# Single command to manage all Port Daddy background agents.
#
# Usage:
#   pd fleet up          Start the Dock Master (launches all watchers)
#   pd fleet down        Stop the Dock Master and all watchers
#   pd fleet status      Show fleet status
#   pd fleet gardener    Run Git Gardener once
#   pd fleet qa          Run QA Adversary once
#   pd fleet hunt        Run Test Gap Hunter once
#   pd fleet research "topic"   Run Research Scout on a topic
#   pd fleet docs        Run Documentarian once
#   pd fleet simplify    Run Simplifier once
#   pd fleet log         Show recent fleet activity
# =============================================================================

FLEET_DIR="$(cd "$(dirname "$0")" && pwd)"
PD_URL="${PORT_DADDY_URL:-http://localhost:9876}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

DOCK_MASTER_PID_FILE="/tmp/pd-dock-master.pid"

case "${1:-help}" in
  up)
    if [[ -f "$DOCK_MASTER_PID_FILE" ]] && kill -0 "$(cat "$DOCK_MASTER_PID_FILE")" 2>/dev/null; then
      echo "${YELLOW}Fleet already running (Dock Master PID $(cat "$DOCK_MASTER_PID_FILE"))${NC}"
      exit 0
    fi
    echo "${CYAN}Starting Port Daddy Fleet...${NC}"
    nohup "$FLEET_DIR/dock-master.sh" > /tmp/pd-fleet.log 2>&1 &
    echo $! > "$DOCK_MASTER_PID_FILE"
    echo "${GREEN}Fleet started (Dock Master PID $!)${NC}"
    echo "  Logs: tail -f /tmp/pd-fleet.log"
    echo "  Stop: pd fleet down"
    ;;

  down)
    if [[ -f "$DOCK_MASTER_PID_FILE" ]]; then
      local pid=$(cat "$DOCK_MASTER_PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        wait "$pid" 2>/dev/null
        echo "${GREEN}Fleet stopped (was PID $pid)${NC}"
      else
        echo "${DIM}Dock Master was not running${NC}"
      fi
      rm -f "$DOCK_MASTER_PID_FILE"
    else
      echo "${DIM}No fleet running${NC}"
    fi
    ;;

  status)
    echo "${CYAN}=== Port Daddy Fleet ===${NC}"
    echo ""

    # Dock Master
    if [[ -f "$DOCK_MASTER_PID_FILE" ]] && kill -0 "$(cat "$DOCK_MASTER_PID_FILE")" 2>/dev/null; then
      echo "${GREEN}Dock Master${NC}: running (PID $(cat "$DOCK_MASTER_PID_FILE"))"
    else
      echo "${RED}Dock Master${NC}: not running"
    fi

    # Fleet agents from PD agent registry
    echo ""
    echo "${CYAN}Registered fleet agents:${NC}"
    curl -s "$PD_URL/agents" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    agents = [a for a in data.get('agents', []) if a.get('id', '').startswith('fleet-')]
    if not agents:
        print('  (none)')
    for a in agents:
        status = '\\033[0;32m' if a.get('status') == 'ready' else '\\033[1;33m'
        print(f'  {status}{a[\"id\"]}\\033[0m — {a.get(\"purpose\", \"?\")}')
except:
    print('  (daemon not reachable)')
" 2>/dev/null

    # Recent fleet messages
    echo ""
    echo "${CYAN}Recent fleet events:${NC}"
    for ch in fleet:status fleet:alert git:committed qa:findings docs:updated tests:gap-filled spark:idea spark:prototype; do
      local msg=$(curl -s "$PD_URL/msg/$ch?limit=1" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    msgs = data.get('messages', [])
    if msgs:
        ts = msgs[0].get('timestamp', 0)
        from datetime import datetime
        t = datetime.fromtimestamp(ts/1000).strftime('%H:%M') if ts > 1000000000 else '?'
        print(f'{t} — {msgs[0].get(\"payload\", \"?\")[:80]}')
except:
    pass
" 2>/dev/null)
      if [[ -n "$msg" ]]; then
        echo "  ${DIM}$ch${NC}: $msg"
      fi
    done
    ;;

  gardener)
    "$FLEET_DIR/git-gardener.sh"
    ;;

  qa)
    "$FLEET_DIR/qa-adversary.sh"
    ;;

  hunt)
    "$FLEET_DIR/test-gap-hunter.sh"
    ;;

  research)
    if [[ -z "$2" ]]; then
      echo "Usage: pd fleet research \"topic to research\""
      exit 1
    fi
    "$FLEET_DIR/research-scout.sh" "$2" "$3"
    ;;

  docs)
    "$FLEET_DIR/documentarian.sh"
    ;;

  simplify)
    "$FLEET_DIR/simplifier.sh"
    ;;

  spark)
    shift
    "$FLEET_DIR/spark.sh" "$@"
    ;;

  ideas)
    "$FLEET_DIR/spark.sh" ideas
    ;;

  log)
    tail -50 /tmp/pd-fleet.log 2>/dev/null || echo "No fleet log found. Start fleet first: pd fleet up"
    ;;

  help|--help|-h)
    echo "${CYAN}Port Daddy Fleet — Background Agent Management${NC}"
    echo ""
    echo "Usage: pd fleet <command>"
    echo ""
    echo "Fleet lifecycle:"
    echo "  ${GREEN}up${NC}              Start Dock Master + all watchers"
    echo "  ${GREEN}down${NC}            Stop everything"
    echo "  ${GREEN}status${NC}          Show fleet health and recent events"
    echo "  ${GREEN}log${NC}             Show fleet log"
    echo ""
    echo "Run agents individually:"
    echo "  ${GREEN}gardener${NC}        Auto-commit uncommitted changes"
    echo "  ${GREEN}qa${NC}              Adversarial review of latest commit"
    echo "  ${GREEN}hunt${NC}            Find and fill test coverage gaps"
    echo "  ${GREEN}docs${NC}            Sync documentation to match code"
    echo "  ${GREEN}simplify${NC}        Propose simplifications for latest commit"
    echo "  ${GREEN}research \"topic\"${NC} Deep research on a topic"
    echo ""
    echo "The idea engine:"
    echo "  ${GREEN}spark${NC}           Run one ideation cycle (observe → research → synthesize → pitch)"
    echo "  ${GREEN}spark --loop${NC}    Run Spark continuously (every 30 min)"
    echo "  ${GREEN}spark ideas${NC}     List all of Spark's ideas"
    echo "  ${GREEN}spark pitch${NC}     Pitch the latest unreviewed idea"
    echo "  ${GREEN}spark prototype${NC} Build a prototype of the best idea"
    echo "  ${GREEN}ideas${NC}           Shortcut for spark ideas"
    ;;

  *)
    echo "${RED}Unknown command: $1${NC}"
    echo "Run 'pd fleet help' for usage"
    exit 1
    ;;
esac
