#!/usr/bin/env bash
# Port Daddy session lifecycle.
#
# Demonstrates the current CLI flow:
#   1. start a session for an agent
#   2. claim files
#   3. move through phases
#   4. add notes
#   5. complete the session
#
# Run:
#   bash examples/phases/session-lifecycle.sh

set -euo pipefail

AGENT_ID="${AGENT_ID:-examples-phase-$$}"
SESSION_ID=""

cleanup() {
  if [[ -n "$SESSION_ID" ]]; then
    pd session done "example cleanup" --agent "$AGENT_ID" -q >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Session lifecycle"
echo "-----------------"
echo "Agent: $AGENT_ID"
echo ""

SESSION_ID="$(pd session start "Example session phase lifecycle" --agent "$AGENT_ID" -q)"

echo "Session: $SESSION_ID"

if pd session files add examples/phases/session-lifecycle.sh --agent "$AGENT_ID" -q >/dev/null 2>&1; then
  pd note "Read context and claimed the lifecycle example file" --session "$SESSION_ID" --type progress
else
  pd note "Read context; file claim skipped because another session already owns the example file" --session "$SESSION_ID" --type progress
fi

for phase in planning in_progress testing reviewing; do
  echo "Phase: $phase"
  pd session phase "$SESSION_ID" "$phase" -q

  case "$phase" in
    planning)
      NOTE="Plan: use CLI session primitives, not raw daemon HTTP." ;;
    in_progress)
      NOTE="Implementation: claim file, write notes, and advance phase." ;;
    testing)
      NOTE="Testing: this script can run without jq or raw localhost URLs." ;;
    reviewing)
      NOTE="Review: ready to complete and release claims." ;;
  esac

  pd note "$NOTE" --session "$SESSION_ID" --type progress
done

pd session done "Session lifecycle example completed" --agent "$AGENT_ID"
SESSION_ID=""

echo ""
echo "Done."
