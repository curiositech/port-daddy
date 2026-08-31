#!/usr/bin/env bash
# session-resume.sh — the canonical bootstrap ritual as a one-liner.
# Runs preflight, picks up any open session, ingests sitrep, and starts a session if needed.
#
# Usage:
#   session-resume.sh --identity myapp:api:feature-x --purpose "Implement /v2/auth/refresh" --roadmap auth-refresh
#   session-resume.sh --identity myapp:api --purpose "..." --sidequest "investigate a one-off failure" --no-claim-files
#
# Prints a JSON summary on stdout for the agent to consume.

set -euo pipefail

identity=""
purpose=""
files=()
claim_files=1
rent_kind=""
rent_value=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) identity="$2"; shift 2 ;;
    --purpose)  purpose="$2"; shift 2 ;;
    --file)     files+=("$2"); shift 2 ;;
    --roadmap|--roadmap-new|--sidequest)
      [[ -n "$rent_kind" ]] && { echo "exactly one of --roadmap, --roadmap-new, or --sidequest is required" >&2; exit 1; }
      rent_kind="$1"
      rent_value="$2"
      shift 2
      ;;
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
session_id=$(echo "$existing" | jq -r --arg identity "$identity" \
  'select(.active == true and .identity == $identity) | .sessionId // empty')

# 3. Sitrep
project="${identity%%:*}"
sitrep=$(pd sitrep --since 60 --project "$project" --json 2>/dev/null || echo '{}')

# 4. Start a session if none
if [[ -z "$session_id" ]]; then
  [[ -z "$rent_kind" || -z "$rent_value" ]] && {
    echo "starting a session requires exactly one of --roadmap, --roadmap-new, or --sidequest" >&2
    exit 1
  }
  start=$(pd begin --identity "$identity" --purpose "$purpose" --lifecycle durable "$rent_kind" "$rent_value" --json 2>/dev/null)
  session_id=$(echo "$start" | jq -r '.sessionId // empty')
  [[ -z "$session_id" ]] && {
    echo "pd begin succeeded without returning a sessionId" >&2
    exit 1
  }
fi

# 5. Optionally claim files
claims="[]"
if (( claim_files )) && (( ${#files[@]} )); then
  claims=$(pd session files add "${files[@]}" --json 2>/dev/null)
fi

# 6. Emit summary
jq -n \
  --arg sessionId "$session_id" \
  --arg identity "$identity" \
  --arg purpose "$purpose" \
  --argjson sitrep "$sitrep" \
  --argjson claims "$claims" \
  '{sessionId:$sessionId, identity:$identity, purpose:$purpose, sitrep:$sitrep, claims:$claims}'
