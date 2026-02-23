#!/bin/bash
# Historian Agent - Git archaeology for bug hunting
# Usage: ./historian.sh <bug-id> <error-message>

set -e

BUG_ID="${1:?Usage: ./historian.sh <bug-id> <error-message>}"
ERROR_MSG="${2:?Usage: ./historian.sh <bug-id> <error-message>}"
CHANNEL="war-room-$BUG_ID"

# Claim our role
pd lock "war-room-$BUG_ID-historian" -t 300000 2>/dev/null || {
  echo "Another historian is already working on this bug"
  exit 1
}

publish() {
  local type="$1"
  local message="$2"
  local data="${3:-{}}"
  pd pub "$CHANNEL" "{\"agent\":\"historian\",\"type\":\"$type\",\"message\":\"$message\",\"data\":$data,\"ts\":$(date +%s)}"
}

cleanup() {
  publish "status" "Historian signing off"
  pd unlock "war-room-$BUG_ID-historian" 2>/dev/null || true
}
trap cleanup EXIT

# Announce ourselves
publish "status" "Historian joining war room - starting git archaeology"

# Subscribe to other agents' findings (background)
pd sub "$CHANNEL" 2>/dev/null | while read -r msg; do
  agent=$(echo "$msg" | jq -r '.agent // empty' 2>/dev/null)
  type=$(echo "$msg" | jq -r '.type // empty' 2>/dev/null)

  # React to other agents' findings
  if [[ "$agent" != "historian" && "$type" == "finding" ]]; then
    file=$(echo "$msg" | jq -r '.data.file // empty' 2>/dev/null)
    if [[ -n "$file" ]]; then
      publish "status" "Checking git history for $file based on Tracer's finding"
    fi
  fi
done &
SUB_PID=$!

# Main investigation loop
publish "status" "Searching git log for error pattern: $ERROR_MSG"
sleep 1

# Simulate git log search (replace with real git commands for actual use)
# In real usage: git log --all --oneline --grep="$ERROR_MSG" | head -5
publish "finding" "Found 3 commits mentioning similar errors" '{"commits":["a4f2c1","b7e3d2","c9f1a0"]}'
sleep 2

# Simulate git bisect (replace with real bisect for actual use)
publish "status" "Starting binary search through last 50 commits"
sleep 2

publish "finding" "Bug introduced in commit a4f2c1 (3 days ago)" '{
  "commit": "a4f2c1",
  "author": "dev@example.com",
  "date": "3 days ago",
  "message": "Refactor user fetching",
  "files_changed": ["src/api/users.ts", "src/lib/auth.ts"]
}'
sleep 1

# Examine the breaking commit
publish "status" "Examining diff of breaking commit a4f2c1"
sleep 1

publish "finding" "Commit a4f2c1 removed null check on line 38" '{
  "commit": "a4f2c1",
  "change_type": "deletion",
  "description": "Removed: if (!user) return null",
  "line": 38,
  "file": "src/api/users.ts"
}'

# Wait for other agents or timeout
publish "status" "Historian analysis complete - monitoring for correlation opportunities"
sleep 30

kill $SUB_PID 2>/dev/null || true
