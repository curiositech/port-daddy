#!/usr/bin/env bash
# Stop hook — auto-SITREP.
#
# WHY THIS EXISTS: agents kept "deciding" not to post an end-of-turn SITREP
# (pd note) even when the repo convention calls for one. A convention an
# agent can skip is not a guarantee. This hook removes the decision: it runs
# unconditionally on every Stop event and posts the note itself, so the
# record exists whether or not the agent remembered.
#
# Never blocks the turn (always continue:true) — a hard block here risks an
# infinite re-prompt loop if pd session resolution stays ambiguous (a known,
# common failure mode: "multiple active sessions exist in this worktree").
# Instead: best-effort `pd note`, PLUS an always-durable local log line that
# does not depend on pd/daemon state at all, so the trail survives even when
# pd itself can't resolve a session.
set -uo pipefail

input="$(cat)"
transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"

summary=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  summary="$(tail -n 80 "$transcript" 2>/dev/null | jq -rs '
      [ .[] | select(.type=="assistant") ] | last
      | (.message.content // [])
      | map(select(.type=="text") | .text) | join(" ")
    ' 2>/dev/null | tr -s ' \t\n' ' ' | cut -c1-240)"
fi
[ -z "$summary" ] && summary="(no assistant text found in transcript tail)"

mkdir -p .claude/.sitrep-log 2>/dev/null || true
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\tSITREP\t%s\n' "$ts" "$summary" >> .claude/.sitrep-log/local.tsv 2>/dev/null || true

pd note "SITREP (auto, end-of-turn): $summary" >/dev/null 2>&1 || true

printf '{"continue": true, "suppressOutput": true}\n'
exit 0
