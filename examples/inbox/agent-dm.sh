#!/usr/bin/env bash
# Agent Direct Messaging with Port Daddy
#
# Demonstrates the full inbox lifecycle:
#   1. Register two agents (Alice and Bob)
#   2. Alice sends Bob a message
#   3. Bob reads his inbox
#   4. Bob marks all messages as read
#   5. Bob clears his inbox
#   6. Cleanup
#
# Usage: bash examples/inbox/agent-dm.sh
# Requires: curl, python3 (for pretty-printing JSON)
set -euo pipefail

BASE="${PORT_DADDY_URL:-http://localhost:9876}"

echo "=== Port Daddy Agent Inbox Demo ==="
echo ""

echo "Registering agents..."
curl -sf -X POST "$BASE/agents" \
  -H 'Content-Type: application/json' \
  -d '{"id":"alice","type":"ci","purpose":"inbox demo — sender"}' > /dev/null
echo "  Registered: alice"

curl -sf -X POST "$BASE/agents" \
  -H 'Content-Type: application/json' \
  -d '{"id":"bob","type":"ci","purpose":"inbox demo — receiver"}' > /dev/null
echo "  Registered: bob"

echo ""
echo "Alice sends Bob a message..."
curl -sf -X POST "$BASE/agents/bob/inbox" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Schema migration ready for review","from":"alice","type":"handoff"}'
echo ""

echo ""
echo "Bob checks his inbox stats..."
curl -sf "$BASE/agents/bob/inbox/stats" | python3 -m json.tool

echo ""
echo "Bob reads his inbox:"
curl -sf "$BASE/agents/bob/inbox" | python3 -m json.tool

echo ""
echo "Bob marks all messages as read:"
curl -sf -X PUT "$BASE/agents/bob/inbox/read-all" | python3 -m json.tool

echo ""
echo "Bob clears his inbox:"
curl -sf -X DELETE "$BASE/agents/bob/inbox" | python3 -m json.tool

echo ""
echo "Cleanup..."
curl -sf -X DELETE "$BASE/agents/alice" > /dev/null
curl -sf -X DELETE "$BASE/agents/bob" > /dev/null
echo "  Unregistered alice and bob."
echo ""
echo "Done."
