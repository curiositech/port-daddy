#!/usr/bin/env bash
#
# enforce-agent-isolation.sh — PreToolUse guard for Agent / Task dispatches.
#
# WHY: On 2026-06-03, parallel agents dispatched without worktree isolation all
# wrote to the same main checkout and steamrolled each other — 403 files were
# deleted in the port-daddy working tree. This hook makes that impossible: any
# Agent/Task dispatch that can write files MUST run in its own worktree.
#
# DECISION:
#   - ALLOW if tool_input.isolation == "worktree"   (already isolated)
#   - ALLOW if subagent_type is a known read-only agent (Explore/Plan/etc.)
#   - DENY  otherwise (PreToolUse permissionDecision = "deny")
#
# Explicit operator Off: no input reads or hook effects.
# While enabled, preserve the legacy isolation checks and missing-jq warning.

set -euo pipefail

# Explicit operator Off only. Unknown/missing readiness is not an exemption.
# Check before stdin, jq, or any external command; never start Port Daddy.
pd_isolation_canonical="${HOME:+$HOME/.port-daddy}"
pd_isolation_selected="${PD_HOME:-$pd_isolation_canonical}"
for pd_isolation_root in "$pd_isolation_canonical" "$pd_isolation_selected"; do
  [ -n "$pd_isolation_root" ] || continue
  for pd_isolation_marker in "$pd_isolation_root/hooks.disabled" "$pd_isolation_root/HALT"; do
    if [ -e "$pd_isolation_marker" ] || [ -L "$pd_isolation_marker" ]; then
      exit 0
    fi
  done
done
case "${PD_HALT_FILE:-}" in
  /*) if [ -e "$PD_HALT_FILE" ] || [ -L "$PD_HALT_FILE" ]; then exit 0; fi ;;
esac

input="$(cat)"

# Quiet operator escape hatch. Intentionally NOT named in the deny message:
# guardrails must point only to the correct action, never advertise their bypass.
if [ "${PD_AGENT_ISOLATION_OFF:-}" = "1" ]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"agent-isolation guard SKIPPED: jq not found on PATH"}'
  exit 0
fi

isolation="$(printf '%s' "$input" | jq -r '.tool_input.isolation // ""')"
subagent="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // ""')"

# Already running in its own worktree → safe, allow.
if [ "$isolation" = "worktree" ]; then
  exit 0
fi

# Strip any plugin namespace prefix, e.g. "windags-skills:sensemaker" -> "sensemaker".
base="${subagent##*:}"

# Read-only agent types cannot mutate the tree, so they need no isolation.
case "$base" in
  Explore|Plan|sensemaker|decomposer|premortem|skill-selector|synthesizer|code-explorer|code-reviewer)
    exit 0
    ;;
esac

# File-writing dispatch with no isolation → block, and point only to the fix.
cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Isolation guard: this Agent/Task dispatch can write files but is not isolated. Parallel un-isolated agents share one checkout and overwrite each other's work — this is what deleted 403 files on 2026-06-03. Re-dispatch with isolation: \"worktree\". For pure research that writes nothing, use a read-only agent type (Explore or Plan) instead."
  }
}
JSON
exit 0
