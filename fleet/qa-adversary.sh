#!/usr/bin/env zsh
# =============================================================================
# QA Adversary — Break it before users do
# =============================================================================
# Triggered after each commit. Spawns a Claude agent in a worktree that
# adversarially tries to break the new code. Files bugs as session notes
# and optionally creates patches.
#
# Usage:
#   ./fleet/qa-adversary.sh                           # Test latest commit
#   pd watch git:committed --exec './fleet/qa-adversary.sh'  # Auto-trigger
#
# Channels:
#   Subscribes to: git:committed
#   Publishes to: qa:findings, qa:clean
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="qa-adversary"

adversary_run() {
  cd "$PROJECT_DIR" || exit 1

  # Get the latest commit info
  local sha=$(git rev-parse --short HEAD)
  local msg=$(git log -1 --pretty=%s)
  local changed=$(git diff-tree --no-commit-id --name-only -r HEAD | head -20)

  if [[ -z "$changed" ]]; then
    fleet_log "$AGENT_NAME" "No files in latest commit — skipping"
    return 0
  fi

  fleet_log "$AGENT_NAME" "Adversarial review of $sha: $msg"
  pd_note "QA Adversary reviewing $sha: $msg ($changed)" "progress"

  fleet_check_claude "$AGENT_NAME" || return 0

  # Build the prompt with the actual diff
  local diff=$(git show HEAD --stat -- lib/ routes/ server.ts mcp/ 2>/dev/null | head -200)

  local prompt="You are a QA adversary for Port Daddy, a port management daemon. Your job is to BREAK things.

Latest commit: $sha — $msg

Files changed:
$changed

Diff summary:
$diff

Your mission:
1. Read each changed file completely
2. For each change, think: what inputs would break this? What edge cases were missed?
3. Look for: null dereference, SQL injection, race conditions, resource leaks, off-by-one errors, missing validation
4. For each bug found, write a test that exposes it
5. Run the test to confirm it fails

Output format — for each finding:
BUG: [one-line description]
FILE: [path:line]
SEVERITY: [crash|logic|data|style]
TEST: [the test code that exposes it]

If you find NO bugs, say: CLEAN — no issues found in $sha

Be thorough but honest. Don't invent problems that don't exist."

  local result=$(claude_run_worktree "$prompt" "qa-$sha")

  if [[ -n "$result" && -d "$result" ]]; then
    # Worktree has changes (new test files with bug reproductions)
    fleet_success "$AGENT_NAME" "Bugs found — worktree at $result"
    pd_note "QA Adversary found issues in $sha. Worktree: $result" "warning"
    pd_pub "qa:findings" "{\"sha\":\"$sha\",\"worktree\":\"$result\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
  else
    fleet_success "$AGENT_NAME" "Clean — no issues in $sha"
    pd_pub "qa:clean" "{\"sha\":\"$sha\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Adversarial code review of latest commit"
trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

adversary_run
fleet_shutdown "$AGENT_NAME"
