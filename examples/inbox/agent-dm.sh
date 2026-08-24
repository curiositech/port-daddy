#!/usr/bin/env bash
# Agent direct messaging with Port Daddy.
#
# Demonstrates the current CLI inbox lifecycle:
#   1. start two coordinated actors in isolated credential slots
#   2. Alice sends Bob a daemon-attributed message
#   3. Bob reads and acknowledges his inbox with Bob's credential
#   4. both agents sign off
#
# Run:
#   bash examples/inbox/agent-dm.sh

set -euo pipefail

ALICE="examples-inbox-alice-$$"
BOB="examples-inbox-bob-$$"
ALICE_SLOT="examples-inbox-alice-$$"
BOB_SLOT="examples-inbox-bob-$$"
ALICE_SESSION=""
BOB_SESSION=""
ALICE_ACTOR=""
BOB_ACTOR=""

json_field() {
  node -e "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => console.log(JSON.parse(data)[process.argv[1]]));" "$1"
}

cleanup() {
  if [[ -n "$ALICE_SESSION" ]]; then
    PORT_DADDY_CONTEXT_SLOT="$ALICE_SLOT" pd done "inbox example cleanup" -q >/dev/null 2>&1 || true
  fi
  if [[ -n "$BOB_SESSION" ]]; then
    PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd done "inbox example cleanup" -q >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Agent inbox example"
echo "-------------------"

ALICE_JSON="$(PORT_DADDY_CONTEXT_SLOT="$ALICE_SLOT" pd begin "Inbox demo sender" --agent "$ALICE" --identity examples:inbox:alice --lifecycle durable -j)"
BOB_JSON="$(PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd begin "Inbox demo receiver" --agent "$BOB" --identity examples:inbox:bob --lifecycle durable -j)"
ALICE_SESSION="$(printf '%s' "$ALICE_JSON" | json_field sessionId)"
BOB_SESSION="$(printf '%s' "$BOB_JSON" | json_field sessionId)"
ALICE_ACTOR="$(printf '%s' "$ALICE_JSON" | json_field agentId)"
BOB_ACTOR="$(printf '%s' "$BOB_JSON" | json_field agentId)"

echo "Alice sends Bob a handoff:"
PORT_DADDY_CONTEXT_SLOT="$ALICE_SLOT" pd inbox send "$BOB_ACTOR" "Schema migration ready for review" --agent "$ALICE_ACTOR"

echo ""
echo "Bob inbox stats:"
PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd inbox stats --agent "$BOB_ACTOR"

echo ""
echo "Bob reads inbox:"
PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd inbox list --agent "$BOB_ACTOR"

echo ""
echo "Bob marks all messages read:"
PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd inbox read-all --agent "$BOB_ACTOR"

PORT_DADDY_CONTEXT_SLOT="$ALICE_SLOT" pd done "Sent inbox handoff" -q
PORT_DADDY_CONTEXT_SLOT="$BOB_SLOT" pd done "Read inbox handoff" -q
ALICE_SESSION=""
BOB_SESSION=""

echo "Done."
