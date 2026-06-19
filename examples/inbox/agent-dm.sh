#!/usr/bin/env bash
# Agent direct messaging with Port Daddy.
#
# Demonstrates the current CLI inbox lifecycle:
#   1. start two coordinated agents
#   2. Alice sends Bob a message
#   3. Bob reads, marks read, and clears his inbox
#   4. both agents sign off
#
# Run:
#   bash examples/inbox/agent-dm.sh

set -euo pipefail

ALICE="examples-inbox-alice-$$"
BOB="examples-inbox-bob-$$"
ALICE_SESSION=""
BOB_SESSION=""

session_id_from_json() {
  node -e "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => console.log(JSON.parse(data).sessionId));"
}

cleanup() {
  if [[ -n "$ALICE_SESSION" ]]; then
    pd done "inbox example cleanup" --agent "$ALICE" --session "$ALICE_SESSION" -q >/dev/null 2>&1 || true
  fi
  if [[ -n "$BOB_SESSION" ]]; then
    pd done "inbox example cleanup" --agent "$BOB" --session "$BOB_SESSION" -q >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Agent inbox example"
echo "-------------------"

ALICE_SESSION="$(pd begin "Inbox demo sender" --agent "$ALICE" --identity examples:inbox:alice --lifecycle durable -j | session_id_from_json)"
BOB_SESSION="$(pd begin "Inbox demo receiver" --agent "$BOB" --identity examples:inbox:bob --lifecycle durable -j | session_id_from_json)"

echo "Alice sends Bob a handoff:"
pd inbox send "$BOB" "Schema migration ready for review" --agent "$ALICE"

echo ""
echo "Bob inbox stats:"
pd inbox stats --agent "$BOB"

echo ""
echo "Bob reads inbox:"
pd inbox list --agent "$BOB"

echo ""
echo "Bob marks all messages read and clears the queue:"
pd inbox read-all --agent "$BOB"
pd inbox clear --agent "$BOB"

pd done "Sent inbox handoff" --agent "$ALICE" --session "$ALICE_SESSION" -q
pd done "Read inbox handoff" --agent "$BOB" --session "$BOB_SESSION" -q
ALICE_SESSION=""
BOB_SESSION=""

echo "Done."
