#!/usr/bin/env zsh
# =============================================================================
# Continuous Simplifier — Complexity patrol
# =============================================================================
# After each commit, analyzes changed files for unnecessary complexity and
# proposes simpler versions in a worktree branch.
#
# Usage:
#   ./fleet/simplifier.sh                              # Run once
#   pd watch git:committed --exec './fleet/simplifier.sh'  # Auto-trigger
#
# Channels:
#   Subscribes to: git:committed
#   Publishes to: simplify:proposal, simplify:clean
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="simplifier"

simplifier_run() {
  cd "$PROJECT_DIR" || exit 1

  local sha=$(git rev-parse --short HEAD)
  local changed=$(git diff-tree --no-commit-id --name-only -r HEAD -- lib/ routes/ server.ts mcp/ 2>/dev/null)

  if [[ -z "$changed" ]]; then
    fleet_log "$AGENT_NAME" "No source files changed in $sha"
    return 0
  fi

  fleet_log "$AGENT_NAME" "Analyzing complexity in $sha"

  local prompt="You are a code simplifier for Port Daddy. Review these recently changed files and look for opportunities to simplify WITHOUT changing behavior.

Changed files:
$changed

For each file:
1. Read it completely
2. Look for: unnecessary abstractions, dead code paths, overly complex conditionals, duplicated logic, functions that do too much
3. If you find something that can be simplified, do it

Rules:
- NEVER change behavior. Tests must still pass after your changes.
- NEVER add new features, comments, or documentation
- NEVER refactor code that wasn't in the changed files
- Prefer removing code over adding code
- Three similar lines is better than a premature abstraction
- If there's nothing to simplify, say so — don't force changes

After making changes, run the relevant tests:
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/ --no-coverage

Only keep changes where tests pass."

  local result=$(claude_run_worktree "$prompt" "simplify-$sha")

  if [[ -n "$result" && -d "$result" ]]; then
    fleet_success "$AGENT_NAME" "Simplification proposed — worktree at $result"
    pd_note "Simplifier found opportunities in $sha. Worktree: $result" "progress"
    pd_pub "simplify:proposal" "{\"sha\":\"$sha\",\"worktree\":\"$result\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
  else
    fleet_log "$AGENT_NAME" "No simplification opportunities in $sha"
    pd_pub "simplify:clean" "{\"sha\":\"$sha\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Complexity patrol on latest commit"
trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

simplifier_run
fleet_shutdown "$AGENT_NAME"
