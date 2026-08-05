---
title: "Example 10: walked into another agent's interactive rebase"
purpose: "When a worktree's branch state was modified by another agent without your knowledge."
last_verified: 2026-04-30
incident_date: 2026-04-29
---

# Walked Into Another Agent's Rebase

## What the agent saw

Started a session in `/Users/erichowens/coding/port-daddy/` (the main checkout). Made an edit, staged it, committed. Got back a confusing message:

```
[detached HEAD 15a1a74] My commit message
```

Then `git status` revealed:

```
interactive rebase in progress; onto dc6cbb8
You are currently editing a commit while rebasing branch
'codex/agents-flow-guard-readable-ids' on 'dc6cbb8'.
```

The agent had committed ON TOP of another agent's mid-rebase state, in detached HEAD, with no awareness that branch ownership had shifted.

## What was actually happening

While my session was working in a different worktree, another agent had:

1. Switched the main checkout's branch from `codex/pd-tube-tutorial` (where I started) to `codex/agents-flow-guard-readable-ids`.
2. Started an interactive rebase that paused at an `--edit` commit.
3. Their session was still active and visible in `pd sessions --all-worktrees`.

I didn't notice because I never re-read the live fleet between my plan and my action.

## Symptoms that should have tipped me off

| Symptom | What it meant |
|---|---|
| Many `M website-v2/...` files I didn't touch | Branch's tracked state had drifted from my last `git status` |
| `git status` mentioning "rebase in progress" | Active rebase NOT mine |
| Many untracked `tmp-*.png` files | Another agent's iteration artifacts |
| Branch name not matching the one I started with | Someone switched the worktree |

I saw all four. I didn't read them.

## Recovery procedure

Once you discover you've committed into someone else's rebase:

```bash
# 1. SAVE your work as a patch — don't trust it'll survive what comes next.
mkdir -p "$HOME/coding/tmp/port-daddy-recovery"
git format-patch -1 HEAD --stdout > "$HOME/coding/tmp/port-daddy-recovery/my-work.patch"

# 2. Verify the patch captured what you intended.
head -5 "$HOME/coding/tmp/port-daddy-recovery/my-work.patch"
# Subject line should match YOUR commit message. If not, see "patch caught wrong commit" below.

# 3. Abort the rebase. This restores the branch to pre-rebase state.
git rebase --abort

# 4. Confirm you're no longer in detached HEAD.
git status
# Expected: "On branch <other-agent's-branch>"

# 5. Do NOT push or commit on this branch. It is not yours.

# 6. Move to a clean worktree from origin/main.
git fetch origin main
git worktree add -b feature/<my-task-name> \
  "$HOME/coding/tmp/my-work-tree" origin/main
cd "$HOME/coding/tmp/my-work-tree"

# 7. Apply your patch in the new worktree.
git am "$HOME/coding/tmp/port-daddy-recovery/my-work.patch"
# OR if the patch had wrong content:
#   apply your changes manually, the patch is just a backup

# 8. Re-run tests + coordination.
pd begin "<your task>" --identity ... --lifecycle durable --roadmap <roadmap-item-slug>
pd note "Scope: ..."
# claim files, work, commit, push
```

## When the patch caught the wrong commit

`git format-patch -1 HEAD` captures whatever HEAD is at that moment. If you ran it AFTER an unrelated commit landed via the rebase's `pick` step, you'll get someone else's commit.

Recovery:
- `git log --all --oneline` to find your actual commit hash by message.
- `git format-patch -1 <your-hash> --stdout > "$HOME/coding/tmp/port-daddy-recovery/my-work.patch"`.
- If the commit is gone from any branch / unreachable: `git reflog` to find the SHA, then format-patch from it before reflog expires.

## Prevention (the actual lesson)

Before ANY edit in the main checkout (vs a dedicated worktree):

```bash
# 1. Live fleet check — who's here?
pd sessions --all-worktrees

# 2. Branch sanity — did it move?
git branch --show-current
git status                  # any "rebase in progress" / "merge in progress"?
git log --oneline -3        # do these commits look familiar?

# 3. Worktree check — is THIS the worktree I should be in?
git worktree list

# 4. If anything looks unfamiliar → don't edit. Ask in coordination:inconsistency.
```

When in doubt, **always work in a fresh worktree from `origin/main`**. The cost (~30s + 4GB disk) is much less than the cost of clobbering another agent's transaction.

## Lessons

- **Branch state in shared worktrees is shared mutable state.** Treat it accordingly: read before write.
- **`git status` is your first friend, not your last.** Read it BEFORE editing, not after a confusing error.
- **`format-patch -1 HEAD` is a snapshot of "now."** If state shifted between when you committed and when you saved the patch, the patch may not be your work.
- **Worktrees are cheap. Use them.** Walking into shared state and "being careful" is worse than spinning up a new tree.

## Related

- `decisions/something-broke.md` — "Walked into another agent's interactive rebase" branch.
- `decisions/before-publish.md` — pre-commit fleet check.
- `subagent-fork/handoff-checklist.md` — for the inverse case (handing off TO another agent).
