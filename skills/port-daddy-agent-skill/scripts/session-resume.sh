#!/usr/bin/env bash
# session-resume.sh — the canonical bootstrap ritual as a one-liner.
# Runs preflight, picks up any open session, ingests sitrep, and starts a session if needed.
#
# Usage:
#   session-resume.sh --identity myapp:api:feature-x --purpose "Implement /v2/auth/refresh"
#   session-resume.sh --identity myapp:api --purpose "..." --no-claim-files
#
# Prints a JSON summary on stdout for the agent to consume.

set -euo pipefail

identity=""
purpose=""
files=()
claim_files=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) identity="$2"; shift 2 ;;
    --purpose)  purpose="$2"; shift 2 ;;
    --file)     files+=("$2"); shift 2 ;;
    --no-claim-files) claim_files=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$identity" ]] && { echo "--identity required" >&2; exit 1; }
[[ -z "$purpose"  ]] && { echo "--purpose required"  >&2; exit 1; }

# 1. Daemon ready?
"$(dirname "$0")/preflight.sh" || exit $?

# 2. Existing session?
existing=$(pd whoami --json 2>/dev/null || echo '{}')
session_id=$(echo "$existing" | jq -r '.session_id // empty')

# 3. Sitrep
sitrep=$(curl -s "http://localhost:9876/sitrep?since_minutes=60&project=$(echo "$identity" | cut -d: -f1)" 2>/dev/null || echo '{}')

# 4. Start a session if none
if [[ -z "$session_id" ]]; then
  start=$(pd begin --identity "$identity" --purpose "$purpose" --json 2>/dev/null)
  session_id=$(echo "$start" | jq -r '.session_id')
fi

# 5. Optionally claim files
claims="[]"
if (( claim_files )) && (( ${#files[@]} )); then
  claims=$(pd session files claim "${files[@]}" --json 2>/dev/null || echo '[]')
fi

# 6. Emit summary
jq -n \
  --arg session_id "$session_id" \
  --arg identity "$identity" \
  --arg purpose "$purpose" \
  --argjson sitrep "$sitrep" \
  --argjson claims "$claims" \
  '{session_id:$session_id, identity:$identity, purpose:$purpose, sitrep:$sitrep, claims:$claims}'
