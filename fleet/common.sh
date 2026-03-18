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
  if ! command -v claude &> /dev/null; then
    fleet_error "${1:-agent}" "claude CLI not in PATH — cannot run AI tasks"
    pd_note "Fleet agent ${1:-agent} failed: claude CLI not in PATH" "error"
    pd_pub "fleet:error" "{\"agent\":\"${1:-agent}\",\"error\":\"claude not in PATH\",\"timestamp\":$(date +%s)}"
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
  curl -s -X POST "$PD_URL/msg/$channel" \
    -H 'Content-Type: application/json' \
    -d "$payload" > /dev/null 2>&1
}

pd_note() {
  local content="$1" type="${2:-progress}"
  # Escape content for JSON safety
  local escaped=$(echo "$content" | head -1 | sed 's/\\/\\\\/g; s/"/\\"/g' | head -c 500)
  curl -s -X POST "$PD_URL/notes" \
    -H 'Content-Type: application/json' \
    -d "{\"content\":\"$escaped\",\"type\":\"$type\"}" > /dev/null 2>&1
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
  pd_pub "fleet:error" "{\"agent\":\"$name\",\"error\":\"$(echo "$msg" | sed 's/"/\\"/g' | head -c 200)\",\"timestamp\":$(date +%s)}"
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
# Claude Code helpers
# ---------------------------------------------------------------------------
claude_run() {
  local prompt="$1"
  local work_dir="${2:-$PROJECT_DIR}"

  fleet_check_claude "claude_run" || return 1

  claude -p "$prompt" --cwd "$work_dir" --allowedTools 'Read,Glob,Grep,Bash(git*),Bash(npm*),Write,Edit' 2>/dev/null
}

claude_run_worktree() {
  local prompt="$1" branch_name="$2"
  local wt_dir="/tmp/fleet-$branch_name-$(date +%s)"

  fleet_check_claude "claude_run_worktree" || return 1

  git -C "$PROJECT_DIR" worktree add "$wt_dir" -b "fleet/$branch_name" HEAD 2>/dev/null
  if [[ $? -ne 0 ]]; then
    git -C "$PROJECT_DIR" worktree add "$wt_dir" HEAD --detach 2>/dev/null
  fi

  claude -p "$prompt" --cwd "$wt_dir" --allowedTools 'Read,Glob,Grep,Bash(*),Write,Edit' 2>/dev/null

  local exit_code=$?

  if git -C "$wt_dir" diff --quiet HEAD 2>/dev/null; then
    git -C "$PROJECT_DIR" worktree remove "$wt_dir" --force 2>/dev/null
  else
    echo "$wt_dir"
  fi

  return $exit_code
}
