#!/usr/bin/env bash
# Port Daddy — Integration Signals (Ready/Needs)
#
# Demonstrates:
#   1. Two agents registering
#   2. Agent A declares "api" as ready
#   3. Agent B declares it needs "api"
#   4. Checking signal status
#
set -euo pipefail

BASE="http://localhost:9876"
echo "=== Integration Signals Demo ==="
echo ""

# Register two agents
echo "--- Register agents ---"
AGENT_A="integration-demo-a-$$"
AGENT_B="integration-demo-b-$$"

curl -s -X POST "$BASE/agents" \
  -H 'Content-Type: application/json' \
  -d "{\"id\": \"$AGENT_A\", \"name\": \"API Builder\", \"type\": \"cli\"}" > /dev/null

curl -s -X POST "$BASE/agents" \
  -H 'Content-Type: application/json' \
  -d "{\"id\": \"$AGENT_B\", \"name\": \"Frontend Dev\", \"type\": \"cli\"}" > /dev/null

# Start sessions
SESSION_A=$(curl -s -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\": \"$AGENT_A\", \"purpose\": \"Build API endpoints\"}" | jq -r '.id')

SESSION_B=$(curl -s -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\": \"$AGENT_B\", \"purpose\": \"Build frontend\"}" | jq -r '.id')

echo "Agent A session: $SESSION_A"
echo "Agent B session: $SESSION_B"

# Agent B declares it needs the API
echo ""
echo "--- Agent B: I need the API ---"
curl -s -X POST "$BASE/sessions/$SESSION_B/notes" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Waiting for API to be ready", "type": "blocker"}' | jq .

# Agent A finishes and declares ready
echo ""
echo "--- Agent A: API is ready! ---"
curl -s -X POST "$BASE/sessions/$SESSION_A/notes" \
  -H 'Content-Type: application/json' \
  -d '{"content": "API endpoints complete, all tests passing", "type": "progress"}' | jq .

# List all notes to see coordination
echo ""
echo "--- All recent notes (showing coordination) ---"
curl -s "$BASE/notes?limit=5" | jq '.[] | {session: .sessionId, type: .type, content: .content}'

# Cleanup
echo ""
echo "--- Cleanup ---"
curl -s -X PUT "$BASE/sessions/$SESSION_A" \
  -H 'Content-Type: application/json' \
  -d '{"status": "completed"}' > /dev/null
curl -s -X PUT "$BASE/sessions/$SESSION_B" \
  -H 'Content-Type: application/json' \
  -d '{"status": "completed"}' > /dev/null
curl -s -X DELETE "$BASE/agents/$AGENT_A" > /dev/null
curl -s -X DELETE "$BASE/agents/$AGENT_B" > /dev/null
echo "All agents and sessions cleaned up."

echo ""
echo "=== Done ==="
