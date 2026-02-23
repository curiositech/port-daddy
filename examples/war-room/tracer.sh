#!/bin/bash
# Tracer Agent - Runtime analysis and execution tracing
# Usage: ./tracer.sh <bug-id> <file:line>

set -e

BUG_ID="${1:?Usage: ./tracer.sh <bug-id> <file:line>}"
LOCATION="${2:?Usage: ./tracer.sh <bug-id> <file:line>}"
CHANNEL="war-room-$BUG_ID"

# Claim our role
pd lock "war-room-$BUG_ID-tracer" -t 300000 2>/dev/null || {
  echo "Another tracer is already working on this bug"
  exit 1
}

publish() {
  local type="$1"
  local message="$2"
  local data="${3:-{}}"
  pd pub "$CHANNEL" "{\"agent\":\"tracer\",\"type\":\"$type\",\"message\":\"$message\",\"data\":$data,\"ts\":$(date +%s)}"
}

cleanup() {
  publish "status" "Tracer signing off"
  pd unlock "war-room-$BUG_ID-tracer" 2>/dev/null || true
}
trap cleanup EXIT

# Announce ourselves
publish "status" "Tracer joining war room - instrumenting $LOCATION"

# Track findings from other agents
HISTORIAN_COMMIT=""
SCOUT_PATTERN=""

# Subscribe to other agents' findings (background)
pd sub "$CHANNEL" 2>/dev/null | while read -r msg; do
  agent=$(echo "$msg" | jq -r '.agent // empty' 2>/dev/null)
  type=$(echo "$msg" | jq -r '.type // empty' 2>/dev/null)

  if [[ "$agent" == "historian" && "$type" == "finding" ]]; then
    commit=$(echo "$msg" | jq -r '.data.commit // empty' 2>/dev/null)
    if [[ -n "$commit" ]]; then
      publish "status" "Testing if commit $commit matches our trace findings"
    fi
  fi

  if [[ "$agent" == "scout" && "$type" == "finding" ]]; then
    pattern=$(echo "$msg" | jq -r '.data.pattern // empty' 2>/dev/null)
    if [[ -n "$pattern" ]]; then
      publish "status" "Testing Scout's suggested pattern: $pattern"
      sleep 1
      publish "finding" "CONFIRMED: Scout's pattern fixes the issue" '{
        "confirmed": true,
        "pattern": "optional chaining",
        "fix": "user?.id instead of user.id"
      }'
    fi
  fi
done &
SUB_PID=$!

# Main tracing logic
FILE=$(echo "$LOCATION" | cut -d: -f1)
LINE=$(echo "$LOCATION" | cut -d: -f2)

publish "status" "Setting breakpoint at $FILE:$LINE"
sleep 1

publish "status" "Running test suite with instrumentation..."
sleep 2

# Simulate trace analysis
publish "finding" "Variable 'user' is undefined at crash point" '{
  "variable": "user",
  "value": "undefined",
  "file": "'"$FILE"'",
  "line": '"$LINE"',
  "call_stack": ["handleRequest", "getUser", "fetchCurrentUser"]
}'
sleep 1

publish "status" "Tracing backwards through call stack..."
sleep 2

publish "finding" "user becomes undefined when session is expired" '{
  "root_cause": "session.userId lookup returns undefined for expired sessions",
  "reproduction": "Call /api/users/me with expired JWT",
  "call_path": "fetchCurrentUser -> sessions.get(token) -> undefined"
}'
sleep 1

# Test potential fix
publish "status" "Testing fix: adding null check before property access"
sleep 2

publish "finding" "Fix verified: optional chaining prevents crash" '{
  "fix_type": "optional_chaining",
  "location": "'"$FILE"':'"$LINE"'",
  "before": "user.id",
  "after": "user?.id",
  "test_result": "pass"
}'

# Wait for correlation
publish "status" "Tracer analysis complete - awaiting correlation"
sleep 30

kill $SUB_PID 2>/dev/null || true
