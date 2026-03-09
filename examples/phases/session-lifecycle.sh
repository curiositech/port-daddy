#!/usr/bin/env bash
# Port Daddy — Session Phase Lifecycle
#
# Demonstrates:
#   1. Starting a session
#   2. Claiming files
#   3. Advancing through all 6 phases
#   4. Adding phase-appropriate notes
#   5. Ending the session
#
set -euo pipefail

BASE="http://localhost:9876"
echo "=== Session Phase Lifecycle ==="
echo ""

# Step 1: Register agent and start session
echo "--- Register agent ---"
AGENT_ID="phase-demo-$$"
curl -s -X POST "$BASE/agents" \
  -H 'Content-Type: application/json' \
  -d "{\"id\": \"$AGENT_ID\", \"name\": \"Phase Demo\", \"type\": \"cli\"}" | jq .

echo ""
echo "--- Start session ---"
SESSION=$(curl -s -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\": \"$AGENT_ID\", \"purpose\": \"Demo session phases\"}" | jq -r '.id')
echo "Session: $SESSION"

# Step 2: Setup phase (default)
echo ""
echo "--- Phase: setup ---"
curl -s -X POST "$BASE/sessions/$SESSION/notes" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Reading context, claiming files", "type": "progress"}' | jq .

# Claim files
curl -s -X POST "$BASE/sessions/$SESSION/files" \
  -H 'Content-Type: application/json' \
  -d '{"files": ["src/auth.ts", "src/middleware.ts"]}' | jq .

# Step 3: Advance through phases
for phase in planning implementing testing reviewing cleanup; do
  echo ""
  echo "--- Phase: $phase ---"
  curl -s -X PUT "$BASE/sessions/$SESSION" \
    -H 'Content-Type: application/json' \
    -d "{\"phase\": \"$phase\"}" | jq '.phase'

  # Add phase-appropriate note
  case $phase in
    planning)
      NOTE="Decided on JWT approach for auth middleware" ;;
    implementing)
      NOTE="Wrote AuthService class and JWT middleware" ;;
    testing)
      NOTE="All 12 auth tests passing" ;;
    reviewing)
      NOTE="Self-review complete, ready for merge" ;;
    cleanup)
      NOTE="Released file claims, updated docs" ;;
  esac

  curl -s -X POST "$BASE/sessions/$SESSION/notes" \
    -H 'Content-Type: application/json' \
    -d "{\"content\": \"$NOTE\", \"type\": \"progress\"}" > /dev/null
  echo "  Note: $NOTE"
done

# Step 4: End session
echo ""
echo "--- End session ---"
curl -s -X PUT "$BASE/sessions/$SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"status": "completed"}' | jq '{id: .id, status: .status, phase: .phase}'

# Step 5: Unregister agent
curl -s -X DELETE "$BASE/agents/$AGENT_ID" | jq .

echo ""
echo "=== Done — Full lifecycle complete ==="
