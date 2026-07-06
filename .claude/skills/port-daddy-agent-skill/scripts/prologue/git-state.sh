#!/usr/bin/env bash
# Prologue: structured git state for the current worktree.
#
# Output is JSON. Catches the things that bite agents:
#   - active rebase / merge / cherry-pick in progress
#   - branch name vs expected (caller passes --expect for cross-check)
#   - ahead/behind vs origin/<branch>
#   - dirty file counts (staged/unstaged/untracked)
#   - whose worktree this is (from `git worktree list`)
#
# Usage:
#   skills/port-daddy-agent-skill/scripts/prologue/git-state.sh
#   skills/port-daddy-agent-skill/scripts/prologue/git-state.sh --expect codex/my-task
#   skills/port-daddy-agent-skill/scripts/prologue/git-state.sh --pretty

set -euo pipefail

EXPECT=""
PRETTY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect) EXPECT="$2"; shift 2 ;;
    --pretty) PRETTY="1"; shift ;;
    *) shift ;;
  esac
done

cwd=$(pwd)
branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "")
git_dir=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null || echo "")

# Active multi-step operations
rebase_interactive="false"
rebase_apply="false"
merge_in_progress="false"
cherry_pick="false"
if [ -d "$git_dir/rebase-merge" ]; then rebase_interactive="true"; fi
if [ -d "$git_dir/rebase-apply" ]; then rebase_apply="true"; fi
if [ -f "$git_dir/MERGE_HEAD" ]; then merge_in_progress="true"; fi
if [ -f "$git_dir/CHERRY_PICK_HEAD" ]; then cherry_pick="true"; fi

# Branch sanity
branch_mismatch="false"
if [ -n "$EXPECT" ] && [ "$branch" != "$EXPECT" ]; then branch_mismatch="true"; fi

# Ahead/behind
ahead=0
behind=0
if [ -n "$branch" ]; then
  if git -C "$cwd" rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    counts=$(git -C "$cwd" rev-list --left-right --count "$branch...origin/$branch" 2>/dev/null || echo "0	0")
    ahead=$(printf '%s' "$counts" | awk '{print $1}')
    behind=$(printf '%s' "$counts" | awk '{print $2}')
  fi
fi

# Dirty counts
git_status=$(git -C "$cwd" status --porcelain 2>/dev/null || echo "")
staged=$(printf '%s' "$git_status" | grep -c '^[MARCD]' || true)
unstaged=$(printf '%s' "$git_status" | grep -c '^.[MD]' || true)
untracked=$(printf '%s' "$git_status" | grep -c '^??' || true)

# Worktree census
worktree_count=$(git -C "$cwd" worktree list 2>/dev/null | wc -l | tr -d ' ')
worktrees=$(git -C "$cwd" worktree list --porcelain 2>/dev/null || echo "")

# Last commit
last_commit=$(git -C "$cwd" log -1 --format='%h %s' 2>/dev/null || echo "")

python3 - "$branch" "$EXPECT" "$branch_mismatch" \
  "$rebase_interactive" "$rebase_apply" "$merge_in_progress" "$cherry_pick" \
  "$ahead" "$behind" \
  "$staged" "$unstaged" "$untracked" \
  "$worktree_count" "$worktrees" "$last_commit" "${PRETTY:-}" <<'PY'
import json, sys

(branch, expect, mismatch,
 rebase_i, rebase_a, merge, cherry,
 ahead, behind,
 staged, unstaged, untracked,
 wt_count, wt_raw, last_commit, pretty) = sys.argv[1:]

worktrees = []
current = {}
for line in (wt_raw or "").splitlines():
    if not line.strip():
        if current:
            worktrees.append(current)
            current = {}
        continue
    parts = line.split(maxsplit=1)
    if len(parts) == 2:
        key, value = parts
        current[key] = value
    elif len(parts) == 1:
        current[parts[0]] = True
if current:
    worktrees.append(current)

active_op = None
for label, flag in [
    ("interactive_rebase", rebase_i),
    ("rebase_apply", rebase_a),
    ("merge", merge),
    ("cherry_pick", cherry),
]:
    if flag == "true":
        active_op = label
        break

warnings = []
if active_op:
    warnings.append(f"active git op in progress: {active_op}; do not commit on top of it")
if mismatch == "true":
    warnings.append(f"branch is {branch!r}, expected {expect!r}")
if int(behind or 0) > 5:
    warnings.append(f"branch is {behind} commits behind origin/{branch}; rebase or restart from origin/main")

out = {
    "branch": branch or None,
    "expected_branch": expect or None,
    "branch_mismatch": mismatch == "true",
    "active_op": active_op,
    "ahead": int(ahead or 0),
    "behind": int(behind or 0),
    "dirty": {
        "staged": int(staged or 0),
        "unstaged": int(unstaged or 0),
        "untracked": int(untracked or 0),
    },
    "last_commit": last_commit or None,
    "worktree_count": int(wt_count or 0),
    "worktrees": worktrees,
    "warnings": warnings,
}

if pretty:
    print(json.dumps(out, indent=2, default=str))
else:
    print(json.dumps(out, default=str))
PY
