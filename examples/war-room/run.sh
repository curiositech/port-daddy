#!/usr/bin/env bash
# =============================================================================
# War Room Demo
#
# Demonstrates multi-agent coordination using Port Daddy:
# - 3 agents register and claim ports
# - Each starts a session and publishes status messages
# - Agents read each other's messages via pub/sub
# - Clean shutdown: end sessions, release ports, unregister
#
# Usage:
#   chmod +x examples/war-room/run.sh
#   ./examples/war-room/run.sh
#
# Prerequisites:
#   - Port Daddy daemon running (port-daddy start)
#   - curl installed
# =============================================================================

set -euo pipefail

BASE="http://localhost:9876"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

json_post() {
  curl -s -X POST "$BASE$1" -H "Content-Type: application/json" -d "$2"
}

json_get() {
  curl -s "$BASE$1"
}

json_delete() {
  curl -s -X DELETE "$BASE$1" -H "Content-Type: application/json" ${2:+-d "$2"}
}

section() {
  echo ""
  echo "======================================================================"
  echo "  $1"
  echo "======================================================================"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight: check daemon is running
# ─────────────────────────────────────────────────────────────────────────────

echo "Checking Port Daddy daemon..."
if ! curl -s "$BASE/health" > /dev/null 2>&1; then
  echo "Port Daddy daemon is not running. Starting it..."
  if command -v port-daddy &> /dev/null; then
    port-daddy start &
    sleep 2
    if ! curl -s "$BASE/health" > /dev/null 2>&1; then
      echo "ERROR: Failed to start Port Daddy daemon."
      exit 1
    fi
  else
    echo "ERROR: port-daddy command not found. Install with: npm install -g port-daddy"
    exit 1
  fi
fi
echo "Daemon is healthy."

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Register 3 agents
# ─────────────────────────────────────────────────────────────────────────────

section "Step 1: Register Agents"

AGENTS=("agent-alpha" "agent-beta" "agent-gamma")
PURPOSES=("Frontend build" "API development" "Database migrations")

for i in 0 1 2; do
  echo "Registering ${AGENTS[$i]} -- ${PURPOSES[$i]}..."
  json_post "/agents" "{
    \"id\": \"${AGENTS[$i]}\",
    \"name\": \"${AGENTS[$i]}\",
    \"type\": \"demo\",
    \"identity\": \"warroom:demo:${AGENTS[$i]}\",
    \"purpose\": \"${PURPOSES[$i]}\"
  }" | python3 -m json.tool 2>/dev/null || true
  echo ""
done

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Each agent claims a port
# ─────────────────────────────────────────────────────────────────────────────

section "Step 2: Claim Ports"

PORTS=()
for i in 0 1 2; do
  echo "Agent ${AGENTS[$i]} claiming port..."
  RESULT=$(json_post "/claim" "{\"id\": \"warroom:${AGENTS[$i]}:demo\"}")
  PORT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('port','?'))" 2>/dev/null || echo "?")
  PORTS+=("$PORT")
  echo "  -> Got port $PORT"
done

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Start sessions
# ─────────────────────────────────────────────────────────────────────────────

section "Step 3: Start Sessions"

SESSION_IDS=()
for i in 0 1 2; do
  echo "Starting session for ${AGENTS[$i]}..."
  RESULT=$(json_post "/sessions" "{
    \"purpose\": \"${PURPOSES[$i]}\",
    \"agentId\": \"${AGENTS[$i]}\"
  }")
  SID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null || echo "?")
  SESSION_IDS+=("$SID")
  echo "  -> Session: $SID"
done

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Pub/sub communication
# ─────────────────────────────────────────────────────────────────────────────

section "Step 4: Publish Messages (Pub/Sub)"

CHANNEL="warroom:demo:coordination"

echo "Agent Alpha announces status..."
json_post "/msg/$CHANNEL" "{
  \"payload\": {\"type\": \"status\", \"agent\": \"agent-alpha\", \"message\": \"Frontend build started on port ${PORTS[0]}\"},
  \"sender\": \"agent-alpha\"
}" > /dev/null

echo "Agent Beta announces status..."
json_post "/msg/$CHANNEL" "{
  \"payload\": {\"type\": \"status\", \"agent\": \"agent-beta\", \"message\": \"API server running on port ${PORTS[1]}\"},
  \"sender\": \"agent-beta\"
}" > /dev/null

echo "Agent Gamma announces status..."
json_post "/msg/$CHANNEL" "{
  \"payload\": {\"type\": \"status\", \"agent\": \"agent-gamma\", \"message\": \"Migrations complete, DB ready on port ${PORTS[2]}\"},
  \"sender\": \"agent-gamma\"
}" > /dev/null

echo ""
echo "All agents have published. Reading channel messages..."
echo ""

MESSAGES=$(json_get "/msg/$CHANNEL?limit=10")
echo "$MESSAGES" | python3 -m json.tool 2>/dev/null || echo "$MESSAGES"

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Add session notes
# ─────────────────────────────────────────────────────────────────────────────

section "Step 5: Add Session Notes"

for i in 0 1 2; do
  echo "Adding note to session ${SESSION_IDS[$i]}..."
  json_post "/sessions/${SESSION_IDS[$i]}/notes" "{
    \"content\": \"Task progress: ${PURPOSES[$i]} - 100% complete\",
    \"type\": \"progress\"
  }" > /dev/null
done

echo "Notes added to all sessions."

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Read each other's messages (inbox)
# ─────────────────────────────────────────────────────────────────────────────

section "Step 6: Direct Messages (Inbox)"

echo "Agent Alpha sends a DM to Agent Beta..."
json_post "/agents/agent-beta/inbox" "{
  \"content\": \"Hey Beta, API endpoint /users is needed for the frontend\",
  \"from\": \"agent-alpha\"
}" > /dev/null

echo "Agent Beta checks inbox..."
INBOX=$(json_get "/agents/agent-beta/inbox")
echo "$INBOX" | python3 -m json.tool 2>/dev/null || echo "$INBOX"

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Cleanup
# ─────────────────────────────────────────────────────────────────────────────

section "Step 7: Cleanup"

for i in 0 1 2; do
  echo "Ending session ${SESSION_IDS[$i]}..."
  json_post "/sessions/${SESSION_IDS[$i]}" "" > /dev/null 2>&1 || true
  curl -s -X PUT "$BASE/sessions/${SESSION_IDS[$i]}" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"completed\", \"note\": \"Demo complete\"}" > /dev/null

  echo "Releasing port for warroom:${AGENTS[$i]}:demo..."
  json_delete "/release" "{\"id\": \"warroom:${AGENTS[$i]}:demo\"}" > /dev/null

  echo "Unregistering ${AGENTS[$i]}..."
  curl -s -X DELETE "$BASE/agents/${AGENTS[$i]}" > /dev/null
done

echo ""
echo "Clearing channel messages..."
json_delete "/msg/$CHANNEL" > /dev/null

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

section "Summary"

echo "War Room Demo Complete!"
echo ""
echo "What happened:"
echo "  1. Registered 3 agents (alpha, beta, gamma) with semantic identities"
echo "  2. Each agent claimed a unique port (${PORTS[0]}, ${PORTS[1]}, ${PORTS[2]})"
echo "  3. Started work sessions with purpose descriptions"
echo "  4. Published coordination messages via pub/sub channel"
echo "  5. Added progress notes to sessions"
echo "  6. Demonstrated direct messaging (inbox)"
echo "  7. Clean shutdown: ended sessions, released ports, unregistered agents"
echo ""
echo "Port Daddy features demonstrated:"
echo "  - Atomic port assignment (no collisions)"
echo "  - Semantic identities (warroom:agent:demo)"
echo "  - Session management with notes"
echo "  - Pub/sub messaging between agents"
echo "  - Direct agent-to-agent inbox messaging"
echo "  - Clean resource lifecycle management"
