#!/usr/bin/env zsh
# =============================================================================
# Fleet Common — shared utilities for all Port Daddy background agents
# =============================================================================
# Source this file in every agent script:
#   source "$(dirname "$0")/common.sh"
# =============================================================================

export PD_URL="${PORT_DADDY_URL:-http://localhost:9876}"
export FLEET_DIR="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_DIR="$(cd "$FLEET_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Load API keys from .env (standard dotenv, not in git)
# Checks project root first, then home directory
# ---------------------------------------------------------------------------
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
elif [[ -f "$HOME/.port-daddy-env" ]]; then
  set -a; source "$HOME/.port-daddy-env"; set +a
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Preflight — verify the environment before doing anything
# ---------------------------------------------------------------------------
fleet_preflight() {
  # Check daemon is running
  if ! curl -s "$PD_URL/health" > /dev/null 2>&1; then
    echo "${RED}FLEET ERROR: Port Daddy daemon not reachable at $PD_URL${NC}" >&2
    echo "  Run: pd start" >&2
    return 1
  fi
  return 0
}

fleet_check_claude() {
  # pd spawn --backend claude-code needs: daemon running + ANTHROPIC_API_KEY
  if [[ -z "$ANTHROPIC_API_KEY" ]]; then
    fleet_error "${1:-agent}" "ANTHROPIC_API_KEY not set — cannot run Claude agents"
    pd_note "Fleet agent ${1:-agent} failed: ANTHROPIC_API_KEY not set" "error"
    pd_pub "fleet:error" "{\"agent\":\"${1:-agent}\",\"error\":\"ANTHROPIC_API_KEY not set\",\"timestamp\":$(date +%s)}"
    return 1
  fi
  if ! curl -s "$PD_URL/health" > /dev/null 2>&1; then
    fleet_error "${1:-agent}" "Port Daddy daemon not reachable — cannot spawn agents"
    pd_note "Fleet agent ${1:-agent} failed: daemon not reachable" "error"
    pd_pub "fleet:error" "{\"agent\":\"${1:-agent}\",\"error\":\"daemon not reachable\",\"timestamp\":$(date +%s)}"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Singleton enforcement — prevent duplicate agents
# ---------------------------------------------------------------------------
fleet_check_singleton() {
  local name="$1"
  # Check if another instance of this fleet agent is already registered
  local existing=$(curl -s "$PD_URL/agents" 2>/dev/null | python3 -c "
import sys, json
try:
    agents = json.load(sys.stdin).get('agents', [])
    fleet = [a for a in agents if a.get('id','').startswith('fleet-$name-')]
    if fleet:
        print(fleet[0]['id'])
except: pass
" 2>/dev/null)

  if [[ -n "$existing" ]]; then
    echo "${YELLOW}[$name] Already running as $existing — skipping${NC}" >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# PD API helpers (lightweight, no dependencies)
# ---------------------------------------------------------------------------
pd_pub() {
  local channel="$1" payload="$2"
  # payload is already JSON, just validate it
  if echo "$payload" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    curl -s -X POST "$PD_URL/msg/$channel" \
      -H 'Content-Type: application/json' \
      -d "$payload" > /dev/null 2>&1
  fi
}

pd_note() {
  local content="$1" type="${2:-progress}"
  # Use python3 for safe JSON encoding
  local json=$(python3 -c "import json,sys; print(json.dumps({'content':sys.argv[1][:500],'type':sys.argv[2]}))" "$content" "$type" 2>/dev/null)
  if [[ -n "$json" ]]; then
    curl -s -X POST "$PD_URL/notes" \
      -H 'Content-Type: application/json' \
      -d "$json" > /dev/null 2>&1
  fi
}

pd_begin() {
  local agent_id="$1" purpose="$2" identity="$3"
  curl -s -X POST "$PD_URL/sugar/begin" \
    -H 'Content-Type: application/json' \
    -d "{\"agentId\":\"$agent_id\",\"purpose\":\"$purpose\",\"identity\":\"$identity\"}"
}

pd_done() {
  local agent_id="$1" note="$2"
  curl -s -X POST "$PD_URL/sugar/done" \
    -H 'Content-Type: application/json' \
    -d "{\"agentId\":\"$agent_id\",\"note\":\"$note\"}"
}

# ---------------------------------------------------------------------------
# Agent lifecycle — register ONCE, note MANY, done ONCE
# ---------------------------------------------------------------------------
AGENT_ID=""
FLEET_REGISTERED=false

fleet_register() {
  local name="$1" purpose="$2"

  # Preflight
  fleet_preflight || return 1

  # Singleton check
  fleet_check_singleton "$name" || return 1

  AGENT_ID="fleet-${name}-$$"
  pd_begin "$AGENT_ID" "$purpose" "portdaddy:fleet:$name" > /dev/null
  FLEET_REGISTERED=true
  fleet_log "$name" "registered as $AGENT_ID"
}

fleet_shutdown() {
  local name="$1"
  if [[ "$FLEET_REGISTERED" == "true" && -n "$AGENT_ID" ]]; then
    pd_done "$AGENT_ID" "Fleet agent $name shutting down" > /dev/null 2>&1
    FLEET_REGISTERED=false
    fleet_log "$name" "unregistered"
  fi
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
fleet_log() {
  local name="$1" msg="$2"
  echo "${DIM}$(date +%H:%M:%S)${NC} ${CYAN}[$name]${NC} $msg"
}

fleet_success() {
  local name="$1" msg="$2"
  echo "${DIM}$(date +%H:%M:%S)${NC} ${GREEN}[$name]${NC} $msg"
}

fleet_warn() {
  local name="$1" msg="$2"
  echo "${DIM}$(date +%H:%M:%S)${NC} ${YELLOW}[$name]${NC} $msg"
}

fleet_error() {
  local name="$1" msg="$2"
  echo "${DIM}$(date +%H:%M:%S)${NC} ${RED}[$name]${NC} $msg" >&2
  local json=$(python3 -c "import json,sys; print(json.dumps({'agent':sys.argv[1],'error':sys.argv[2][:200],'timestamp':int(__import__('time').time())}))" "$name" "$msg" 2>/dev/null)
  if [[ -n "$json" ]]; then
    curl -s -X POST "$PD_URL/msg/fleet:error" \
      -H 'Content-Type: application/json' \
      -d "$json" > /dev/null 2>&1
  fi
}

# ---------------------------------------------------------------------------
# Safe glob — returns empty string instead of error when no matches
# ---------------------------------------------------------------------------
fleet_glob() {
  # Usage: fleet_glob "/path/to/*.md"
  # Returns matching files or empty string (never errors)
  local pattern="$1"
  local matches=( ${~pattern}(N) )  # (N) = nullglob in zsh
  if (( ${#matches[@]} > 0 )); then
    echo "${matches[@]}"
  fi
}

# ---------------------------------------------------------------------------
# Claude Code helpers — use pd spawn to dogfood PD's own agent coordination
#
# pd spawn --backend claude-code handles:
#   - Agent registration + heartbeats
#   - Session lifecycle (begin/done)
#   - Salvage queue on crash
#   - Activity logging
# ---------------------------------------------------------------------------
claude_run() {
  local prompt="$1"
  local work_dir="${2:-$PROJECT_DIR}"
  local identity="${3:-portdaddy:fleet:task}"

  fleet_check_claude "$AGENT_NAME" || return 1

  # Use pd spawn instead of raw claude -p
  pd spawn --backend claude-code \
    --identity "$identity" \
    --workdir "$work_dir" \
    --allowedTools 'Read,Glob,Grep,Bash(git*),Bash(npm*),Write,Edit' \
    -q \
    -- "$prompt" 2>/dev/null
}

claude_run_worktree() {
  local prompt="$1" branch_name="$2"
  local identity="${3:-portdaddy:fleet:$branch_name}"
  local wt_dir="/tmp/fleet-$branch_name-$(date +%s)"

  fleet_check_claude "$AGENT_NAME" || return 1

  git -C "$PROJECT_DIR" worktree add "$wt_dir" -b "fleet/$branch_name" HEAD 2>/dev/null
  if [[ $? -ne 0 ]]; then
    git -C "$PROJECT_DIR" worktree add "$wt_dir" HEAD --detach 2>/dev/null
  fi

  # Use pd spawn with the worktree as cwd
  pd spawn --backend claude-code \
    --identity "$identity" \
    --workdir "$wt_dir" \
    --allowedTools 'Read,Glob,Grep,Bash(git*),Bash(npm*),Bash(node*),Bash(cat*),Bash(ls*),Bash(wc*),Write,Edit' \
    -q \
    -- "$prompt" 2>/dev/null

  local exit_code=$?

  if git -C "$wt_dir" diff --quiet HEAD 2>/dev/null; then
    git -C "$PROJECT_DIR" worktree remove "$wt_dir" --force 2>/dev/null
  else
    echo "$wt_dir"
  fi

  return $exit_code
}
