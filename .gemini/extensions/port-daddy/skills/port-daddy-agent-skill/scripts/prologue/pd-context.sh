#!/usr/bin/env bash
# Prologue: snapshot live Port Daddy state before any agent work.
#
# Run this BEFORE editing, before "just running tests," before any non-trivial
# repo action. Output is a single JSON blob the agent can parse to decide
# whether the local plan still makes sense.
#
# Usage:
#   skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh
#   skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh --pretty
#
# Output schema (top-level keys):
#   - whoami:           current session/agent for this shell
#   - sessions_count:   active sessions across all worktrees
#   - sessions:         array of {id, purpose, age_seconds, files_count, notes_count}
#   - recent_notes:     last 10 notes, freshest first
#   - branch:           current branch + ahead/behind origin
#   - dirty:            staged/unstaged file counts
#   - rebase_active:    bool — interactive rebase / merge in progress
#   - daemon:           status, version, uptime
#   - drift_warning:    populated if origin/main is meaningfully ahead

set -euo pipefail

PRETTY=""
if [[ "${1:-}" == "--pretty" ]]; then PRETTY="1"; fi

cwd=$(pwd)

# --- daemon ---
daemon_status=$(pd status --json 2>/dev/null || echo '{"reachable":false}')

# --- whoami (best-effort; older daemons may not support --json) ---
whoami_raw=$(pd whoami --json 2>/dev/null || pd whoami 2>/dev/null || echo "")

# --- sessions ---
sessions_raw=$(pd sessions --all-worktrees --json 2>/dev/null || echo "[]")
sessions_count=$(printf '%s' "$sessions_raw" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "0")

# --- recent notes ---
notes_raw=$(pd notes --limit 10 --json 2>/dev/null || echo "[]")

# --- git state ---
branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "")
ahead_behind=$(git -C "$cwd" rev-list --left-right --count "$branch...origin/$branch" 2>/dev/null || echo "0	0")
ahead=$(printf '%s' "$ahead_behind" | awk '{print $1}')
behind=$(printf '%s' "$ahead_behind" | awk '{print $2}')

git_status=$(git -C "$cwd" status --porcelain 2>/dev/null || echo "")
staged=$(printf '%s' "$git_status" | grep -c '^[MARCD]' || true)
unstaged=$(printf '%s' "$git_status" | grep -c '^.[MD]' || true)
untracked=$(printf '%s' "$git_status" | grep -c '^??' || true)

# Detect rebase / merge in progress
rebase_active="false"
if [ -d "$cwd/.git/rebase-merge" ] || [ -d "$cwd/.git/rebase-apply" ] || [ -f "$cwd/.git/MERGE_HEAD" ]; then
  rebase_active="true"
fi

# --- drift warning vs origin/main ---
git -C "$cwd" fetch -q origin main 2>/dev/null || true
origin_main_diff=$(git -C "$cwd" log --oneline HEAD..origin/main 2>/dev/null | wc -l | tr -d ' ')
drift_warning=""
if [ "$origin_main_diff" -gt 5 ]; then
  drift_warning="origin/main is ${origin_main_diff} commits ahead of HEAD; rebase or worktree-from-main before publishing"
elif [ "$origin_main_diff" -gt 0 ]; then
  drift_warning="origin/main is ${origin_main_diff} commits ahead of HEAD"
fi

# --- assemble JSON ---
python3 - "$daemon_status" "$whoami_raw" "$sessions_raw" "$notes_raw" \
  "$branch" "$ahead" "$behind" "$staged" "$unstaged" "$untracked" \
  "$rebase_active" "$drift_warning" "$sessions_count" "${PRETTY:-}" <<'PY'
import json, sys

(daemon, whoami, sessions, notes,
 branch, ahead, behind, staged, unstaged, untracked,
 rebase_active, drift_warning, sessions_count, pretty) = sys.argv[1:]

def safe(s, default):
    try:
        return json.loads(s) if s.strip().startswith(('{', '[')) else default
    except Exception:
        return default

out = {
    "daemon": safe(daemon, {"reachable": False}),
    "whoami": safe(whoami, whoami if whoami else None),
    "sessions_count": int(sessions_count or 0),
    "sessions": safe(sessions, []),
    "recent_notes": safe(notes, []),
    "branch": branch or None,
    "ahead": int(ahead or 0),
    "behind": int(behind or 0),
    "dirty": {
        "staged": int(staged or 0),
        "unstaged": int(unstaged or 0),
        "untracked": int(untracked or 0),
    },
    "rebase_active": rebase_active == "true",
    "drift_warning": drift_warning or None,
}

if pretty:
    print(json.dumps(out, indent=2, default=str))
else:
    print(json.dumps(out, default=str))
PY
