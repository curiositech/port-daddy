---
title: "Example 11: pd briefing first, even for 'just running tests'"
purpose: "The meta-lesson: diagnostic-feeling work needs the same coordination as edit work, because state drifts under you."
last_verified: 2026-04-30
incident_date: 2026-04-29
---

# Briefing First, Even For Diagnostics

## What the agent did wrong

Three times in one session:

1. **Saw 53 failing test suites.** Spent 20 min debugging. Real cause: local node_modules ABI drift; stable had already rebuilt against ABI 141. `pd notes` had a smoking-gun reference to the rebuild.

2. **Saw `CLAUDE.md` tracked in violation of public-repo-boundary.** Spent 10 min crafting an untrack commit. Real status: another agent had already untracked it on `origin/main` (commits `82f5c92`, `eb2a8e0`).

3. **Saw `port-daddy-cli` skill duplicate.** Built an 811-line eradication commit folding content into `port-daddy-agent-skill`. Real status: PR #13 had ALREADY merged the eradication 15 min earlier on a different branch (`codex/agents-flow-guard-readable-ids`), as a 300-line restructure.

All three were duplicate work. Total: ~60 min burned. The user was rightfully furious.

## What "diagnostic" actually means

Reading tests, log files, or git status feels passive. It's not. While you read:

- Other agents push to `origin/main`.
- `node_modules` binaries get rebuilt by stable promotion.
- Branch state in shared worktrees gets switched.
- Sessions claim files you might want.
- Notes accumulate that explain everything you're about to debug.

If you don't snapshot live coordination state at the START of your "diagnostic" session, your conclusions are based on stale ground truth.

## The 5-second prologue

Before ANY work — diagnostic or otherwise:

```bash
pd whoami                         # what session am I in?
pd briefing                       # what does the daemon think is happening?
pd sessions --all-worktrees       # who else is active?
pd notes --limit 20               # what just happened?
git fetch origin && git log --oneline HEAD..origin/main | head -10
                                  # how stale am I?
```

Five commands. Five seconds. If any of them surface a relevant fact, you've avoided 30+ min of wrong work.

## What I should have run, and what it would have shown

| Command I skipped | What it would have surfaced |
|---|---|
| `pd notes --limit 30 \| grep -i abi` | Stable's "rebuilt better-sqlite3 for Node ABI 141" handoff note from minutes earlier |
| `git log HEAD..origin/main -- CLAUDE.md` | Commits `82f5c92` + `eb2a8e0` already untracked it |
| `git ls-tree origin/main skills/` | port-daddy-cli already gone on origin/main |
| `pd sessions --all-worktrees` (in main checkout) | Another agent's active rebase on `codex/agents-flow-guard-readable-ids` |
| `git branch --show-current` | I was on the wrong branch, walking into a foreign worktree |

## Lesson, codified

```
Before ANY work — including "just diagnostics" — run the 5-command prologue.

Local checkouts, node_modules binaries, and branch HEAD all drift while
you sit on them. origin/main may already contain the fix you are about
to write.

Treat any local green/red signal as a HYPOTHESIS to verify against live
fleet + origin/main, not as ground truth.

The cost of running 5 pd commands is ~5 seconds. The cost of duplicating
another agent's commit is debugging a phantom problem and clobbering
their in-flight work.
```

This rule is now baked into:
- `SKILL.md` Default Agent Happy Path
- `decisions/something-broke.md` first branch
- `scripts/prologue/pd-context.sh` (one-shot snapshot)

## When NOT to skip this

Don't skip even when:
- The task feels too small. Small tasks are where invisible drift bites worst.
- You "just ran briefing 10 minutes ago." 10 min is enough for stable to ship.
- You're going to read-only investigate. State changes regardless of your read pattern.

## When it IS skippable

See `decisions/skip-coordination-when.md`. The list is short.

## Related

- `decisions/skip-coordination-when.md` — the genuine exceptions.
- `scripts/prologue/pd-context.sh` — the prologue compressed into one command.
- `examples/09-better-sqlite3-abi-rebuild.md` — current worktree-local cascade diagnosis.
- `examples/10-walked-into-anothers-rebase.md` — concrete shared-state case from this session.
