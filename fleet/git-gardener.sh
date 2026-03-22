#!/usr/bin/env zsh
# =============================================================================
# Git Gardener — Never lose work again
# =============================================================================
# Periodically checks for uncommitted changes in the project. When found,
# uses Claude to generate a meaningful commit message and auto-commits.
#
# Prevents the "rogue agent gutted my dashboard and I lost the good version"
# scenario by ensuring work is committed frequently.
#
# Usage:
#   ./fleet/git-gardener.sh              # Run once (for cron)
#   ./fleet/git-gardener.sh --loop 600   # Run every 10 minutes
#   pd watch git:check --exec './fleet/git-gardener.sh'  # Event-driven
#
# Channels:
#   Publishes to: git:committed (after successful commit)
#   Subscribes to: git:check (when used with pd watch)
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="git-gardener"
LOOP_INTERVAL="${1:+${2:-600}}"  # --loop N seconds
MIN_CHANGES=1          # Minimum changed files to trigger
MAX_STAGED_LINES=2000  # Don't auto-commit massive changes without review

gardener_run() {
  cd "$PROJECT_DIR" || exit 1

  # Check for uncommitted changes in source files (not build artifacts)
  local changed_files=$(git diff --name-only HEAD -- lib/ routes/ server.ts mcp/ bin/ tests/ fleet/ scripts/ public/ CLAUDE.md README.md 2>/dev/null)
  local changed_count=$(echo "$changed_files" | grep -c '[^[:space:]]' 2>/dev/null || echo 0)

  if [[ "$changed_count" -lt "$MIN_CHANGES" ]]; then
    fleet_log "$AGENT_NAME" "No source changes detected"
    return 0
  fi

  # Check total diff size — don't auto-commit huge changes
  local diff_lines=$(git diff HEAD -- lib/ routes/ server.ts mcp/ bin/ tests/ | wc -l | tr -d ' ')
  if [[ "$diff_lines" -gt "$MAX_STAGED_LINES" ]]; then
    fleet_warn "$AGENT_NAME" "Large diff ($diff_lines lines) — skipping auto-commit, needs human review"
    local json=$(python3 -c "import json,sys; print(json.dumps({'lines':int(sys.argv[1]),'files':int(sys.argv[2]),'timestamp':int(__import__('time').time())}))" "$diff_lines" "$changed_count" 2>/dev/null)
    pd_pub "git:large-diff" "$json"
    return 0
  fi

  fleet_log "$AGENT_NAME" "Found $changed_count changed files ($diff_lines lines)"

  # Generate commit message using Claude
  local diff_summary=$(git diff --stat HEAD -- lib/ routes/ server.ts mcp/ bin/ tests/ 2>/dev/null | tail -5)
  local diff_content=$(git diff HEAD -- lib/ routes/ server.ts mcp/ bin/ tests/ 2>/dev/null | head -500)

  local commit_msg=$(claude -p "You are a git commit message writer. Given this diff, write a single conventional commit message (type: subject, max 72 chars). Types: feat, fix, test, refactor, docs, chore. Be specific about what changed. Output ONLY the commit message, nothing else.

Diff stats:
$diff_summary

Diff (first 500 lines):
$diff_content" --max-tokens 100 2>/dev/null | head -1)

  if [[ -z "$commit_msg" ]]; then
    commit_msg="chore: auto-commit $(date +%Y-%m-%d_%H:%M) ($changed_count files)"
  fi

  # Stage source files only (never stage .env, credentials, binaries)
  git add lib/ routes/ server.ts mcp/ bin/ tests/ fleet/ scripts/ public/ CLAUDE.md README.md 2>/dev/null

  # Commit
  git commit -m "$commit_msg" 2>/dev/null
  if [[ $? -eq 0 ]]; then
    local sha=$(git rev-parse --short HEAD)
    fleet_success "$AGENT_NAME" "Committed: $sha — $commit_msg"
    pd_note "Git Gardener auto-committed $sha: $commit_msg" "progress"
    local json=$(python3 -c "import json,sys; print(json.dumps({'sha':sys.argv[1],'message':sys.argv[2],'files':int(sys.argv[3]),'agent':sys.argv[4],'timestamp':int(__import__('time').time())}))" "$sha" "$commit_msg" "$changed_count" "$AGENT_NAME" 2>/dev/null)
    pd_pub "git:committed" "$json"
  else
    fleet_warn "$AGENT_NAME" "Commit failed (pre-commit hook blocked?)"
    local json=$(python3 -c "import json,sys; print(json.dumps({'reason':'hook','files':int(sys.argv[1]),'timestamp':int(__import__('time').time())}))" "$changed_count" 2>/dev/null)
    pd_pub "git:commit-blocked" "$json"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if [[ "$1" == "--loop" ]]; then
  fleet_register "$AGENT_NAME" "Auto-commit uncommitted changes periodically"
  trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

  while true; do
    gardener_run
    sleep "${2:-600}"
  done
else
  gardener_run
fi
