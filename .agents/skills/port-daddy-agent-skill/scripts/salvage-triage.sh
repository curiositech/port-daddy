#!/usr/bin/env bash
# salvage-triage.sh — list dead agents in the current project and show their last notes.
# Walks you through deciding whether to claim each one.
#
# Usage:
#   salvage-triage.sh [--project myapp] [--auto-claim]
#
# Without flags, scope is basename(pwd). --auto-claim claims the oldest entry.

set -euo pipefail

project="$(basename "$(pwd)")"
auto=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --auto-claim) auto=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

queue=$(pd salvage --project "$project" --json 2>/dev/null || echo '[]')
count=$(echo "$queue" | jq 'length')

if [[ "$count" -eq 0 ]]; then
  echo "No salvage entries in $project. Clean queue."
  exit 0
fi

echo "Salvage queue for $project ($count pending):"
echo "$queue" | jq -r '
  .[] | "
  agent: \(.agent_id)
    identity: \(.identity_project // "?"):\(.identity_stack // "?"):\(.identity_context // "?")
    purpose:  \(.purpose // "<none>")
    dead:     \(.dead_for_minutes // "?") min
    session:  \(.session_id // "<none>")"
'

# Show the last handoff/blocker note per dead agent
for agent in $(echo "$queue" | jq -r '.[].agent_id'); do
  sess=$(echo "$queue" | jq -r --arg a "$agent" '.[] | select(.agent_id==$a) | .session_id // empty')
  [[ -z "$sess" ]] && continue
  echo
  echo "  --- last notes from $agent (session $sess) ---"
  pd notes --session "$sess" --type handoff 2>/dev/null | tail -20
  pd notes --session "$sess" --type blocker 2>/dev/null | tail -10
done

if (( auto )); then
  oldest=$(echo "$queue" | jq -r 'sort_by(.enqueued_at) | .[0].agent_id')
  echo
  echo "[auto-claim] $oldest"
  pd salvage claim "$oldest"
fi
