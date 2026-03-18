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
  curl -s -X POST "$PD_URL/notes" \
    -H 'Content-Type: application/json' \
    -d "{\"content\":\"$content\",\"type\":\"$type\"}" > /dev/null 2>&1
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
# Agent lifecycle
# ---------------------------------------------------------------------------
AGENT_ID=""

fleet_register() {
  local name="$1" purpose="$2"
  AGENT_ID="fleet-${name}-$$"
  pd_begin "$AGENT_ID" "$purpose" "portdaddy:fleet:$name" > /dev/null
  echo "${CYAN}[$name]${NC} registered as $AGENT_ID"
}

fleet_shutdown() {
  local name="$1"
  if [[ -n "$AGENT_ID" ]]; then
    pd_done "$AGENT_ID" "Fleet agent $name shutting down" > /dev/null 2>&1
    echo "${DIM}[$name] unregistered${NC}"
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
  echo "${DIM}$(date +%H:%M:%S)${NC} ${RED}[$name]${NC} $msg"
}

# ---------------------------------------------------------------------------
# Claude Code helpers
# ---------------------------------------------------------------------------
claude_run() {
  # Run a Claude Code command in the background, returning immediately
  local prompt="$1"
  local work_dir="${2:-$PROJECT_DIR}"
  claude -p "$prompt" --cwd "$work_dir" --allowedTools 'Read,Glob,Grep,Bash(git*),Bash(npm*),Write,Edit' 2>/dev/null
}

claude_run_worktree() {
  # Run Claude Code in a temporary worktree for isolation
  local prompt="$1" branch_name="$2"
  local wt_dir="/tmp/fleet-$branch_name-$(date +%s)"

  git -C "$PROJECT_DIR" worktree add "$wt_dir" -b "fleet/$branch_name" HEAD 2>/dev/null
  if [[ $? -ne 0 ]]; then
    # Branch might already exist
    git -C "$PROJECT_DIR" worktree add "$wt_dir" HEAD --detach 2>/dev/null
  fi

  claude -p "$prompt" --cwd "$wt_dir" --allowedTools 'Read,Glob,Grep,Bash(*),Write,Edit' 2>/dev/null

  local exit_code=$?

  # Check if there are changes to keep
  if git -C "$wt_dir" diff --quiet HEAD 2>/dev/null; then
    # No changes — clean up
    git -C "$PROJECT_DIR" worktree remove "$wt_dir" --force 2>/dev/null
  else
    echo "$wt_dir"  # Return path so caller can inspect/merge
  fi

  return $exit_code
}
