#!/usr/bin/env bash
# agent-handshake.sh — coordinate file ownership with another agent before editing.
# Wraps the "pd session files claim → conflict → talk" pattern from examples/02.
#
# Usage:
#   agent-handshake.sh src/auth/jwt.ts src/auth/refresh.ts

set -euo pipefail

(( $# > 0 )) || { echo "usage: $0 <file>..." >&2; exit 1; }

result=$(pd session files claim "$@" --json 2>&1 || true)
conflicts=$(echo "$result" | jq -r '.conflicts // [] | length' 2>/dev/null || echo 0)

if [[ "$conflicts" -eq 0 ]]; then
  echo "OK: claimed $* (no conflicts)"
  exit 0
fi

echo "CONFLICT: $conflicts file(s) already claimed."
echo "$result" | jq -r '.conflicts[] | "  \(.path) <- \(.agent_id) (\(.identity // "?"), purpose: \(.purpose // "?"))"'

# Auto-DM each conflicting agent so they see it on next sitrep
for agent in $(echo "$result" | jq -r '.conflicts[].agent_id' | sort -u); do
  pd inbox send "$agent" \
    "Hi — I'm trying to claim files you own: $(echo "$result" | jq -r --arg a "$agent" '.conflicts[] | select(.agent_id==$a) | .path' | tr '\n' ' '). Mind sharing scope or ETA? (sent by agent-handshake.sh)" \
    || true
done

# Drop a coordination note
pd note --type intent "Handshake requested with: $(echo "$result" | jq -r '.conflicts[].agent_id' | sort -u | tr '\n' ' '). Not proceeding until coordinated."

echo
echo "DEFERRING — waiting on owners to respond. Re-run when they release."
exit 2
