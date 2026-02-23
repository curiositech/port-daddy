#!/bin/bash
# Scout Agent - Pattern matching and codebase search
# Usage: ./scout.sh <bug-id> <search-pattern>

set -e

BUG_ID="${1:?Usage: ./scout.sh <bug-id> <search-pattern>}"
PATTERN="${2:?Usage: ./scout.sh <bug-id> <search-pattern>}"
CHANNEL="war-room-$BUG_ID"

# Claim our role
pd lock "war-room-$BUG_ID-scout" -t 300000 2>/dev/null || {
  echo "Another scout is already working on this bug"
  exit 1
}

publish() {
  local type="$1"
  local message="$2"
  local data="${3:-{}}"
  pd pub "$CHANNEL" "{\"agent\":\"scout\",\"type\":\"$type\",\"message\":\"$message\",\"data\":$data,\"ts\":$(date +%s)}"
}

cleanup() {
  publish "status" "Scout signing off"
  pd unlock "war-room-$BUG_ID-scout" 2>/dev/null || true
}
trap cleanup EXIT

# Announce ourselves
publish "status" "Scout joining war room - searching for pattern: $PATTERN"

# Subscribe to other agents' findings
pd sub "$CHANNEL" 2>/dev/null | while read -r msg; do
  agent=$(echo "$msg" | jq -r '.agent // empty' 2>/dev/null)
  type=$(echo "$msg" | jq -r '.type // empty' 2>/dev/null)

  if [[ "$agent" == "historian" && "$type" == "finding" ]]; then
    files=$(echo "$msg" | jq -r '.data.files_changed[]? // empty' 2>/dev/null)
    if [[ -n "$files" ]]; then
      publish "status" "Historian found changed files - expanding search to similar files"
    fi
  fi

  if [[ "$agent" == "tracer" && "$type" == "finding" ]]; then
    confirmed=$(echo "$msg" | jq -r '.data.confirmed // empty' 2>/dev/null)
    if [[ "$confirmed" == "true" ]]; then
      publish "correlation" "SOLUTION CONFIRMED by Tracer" '{
        "status": "resolved",
        "fix": "optional chaining",
        "confidence": 0.95
      }'
    fi
  fi
done &
SUB_PID=$!

# Main search logic
publish "status" "Searching codebase for similar error patterns..."
sleep 1

# Simulate codebase search (replace with real grep/ripgrep for actual use)
# In real usage: rg -l "Cannot read property.*of undefined" --type ts
publish "finding" "Found 7 files with similar error handling" '{
  "files": ["src/api/posts.ts", "src/api/comments.ts", "src/lib/utils.ts"],
  "pattern_type": "null_check"
}'
sleep 1

publish "status" "Analyzing how similar code handles this case..."
sleep 2

# Find working patterns
publish "finding" "src/api/posts.ts:87 uses optional chaining for same pattern" '{
  "file": "src/api/posts.ts",
  "line": 87,
  "pattern": "user?.id",
  "context": "Similar user object access with null safety",
  "working": true
}'
sleep 1

publish "status" "Comparing broken code to working pattern..."
sleep 1

publish "finding" "PATTERN DIFFERENCE: users.ts uses user.id, posts.ts uses user?.id" '{
  "broken": {"file": "src/api/users.ts", "code": "user.id"},
  "working": {"file": "src/api/posts.ts", "code": "user?.id"},
  "fix_suggestion": "Add optional chaining: user?.id"
}'
sleep 1

# Cross-reference with other findings
publish "status" "Cross-referencing with team's findings..."
sleep 2

publish "correlation" "All findings converge: null check removed in a4f2c1, fix is optional chaining" '{
  "historian": "commit a4f2c1 removed null check",
  "tracer": "user is undefined with expired session",
  "scout": "working code uses optional chaining",
  "solution": "Change user.id to user?.id on line 42",
  "confidence": 0.95
}'

# Leave a note for future reference
pd note "War room $BUG_ID resolved: Null check removed in a4f2c1, fix is optional chaining on user.id"

publish "status" "Scout analysis complete - solution documented"
sleep 30

kill $SUB_PID 2>/dev/null || true
