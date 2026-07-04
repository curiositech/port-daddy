# Review And Merge Mechanics

Use this when you need the mechanics of pulling review comments, turning findings into fixups, rebasing on conflict, or landing through a merge queue.

## Pull every review source, not just the ones that ping you

A PR's real review surface is wider than the "Reviewers" sidebar:

```bash
gh pr view <n> --json reviews,comments
gh api repos/<owner>/<repo>/pulls/<n>/comments      # inline diff comments (bots + humans)
gh api repos/<owner>/<repo>/issues/<n>/comments     # top-level PR comments
gh run list --branch <branch> --limit 10            # any adversarial-review / CI workflow runs
```

Treat every inline bot comment (Copilot, an in-repo Claude/adversarial-review workflow, CodeQL alerts surfaced as comments) as a first-class review finding — the check-run status for these bots is often just "commented," which is easy to skim past.

## Triage each finding into exactly one bucket

| Bucket | Action | Reply |
| --- | --- | --- |
| Real bug / real gap, confirmed | Fix it in a **named fixup commit** | "Fixed in `<sha>`: `<one-line what>`." |
| Real but out of scope for this PR | Defer explicitly, don't silently drop | "Deferred to `<issue/PR>`: `<why not now>`." |
| Wrong, stale, or already-addressed | Contest with evidence | "Contested: `<why>` — see `<line/commit>`." |

An unresolved HIGH/critical thread with no reply of any kind is the failure mode this exists to prevent — silence reads as "ignored," not "handled."

## Named fixup commits

Don't squash review fixes invisibly into the original commit (that erases the record of what review caught) and don't amend-and-force-push (see below). Push a new commit per logical fix, named after the finding:

```bash
git commit -m "fixup: address <bot/reviewer> finding on <file> — <what changed>"
```

This gives the reviewer a commit-level diff of exactly what changed in response to their comment, instead of a full-file re-diff.

## Draft-while-WIP, ready-when-green

Open as a draft the moment there's a pushable branch — it signals "not requesting review yet" while still running CI. Mark it ready only once every required-and-repo-owned check (see `gate-taxonomy.md`) is green:

```bash
gh pr create --draft --title "<title>" --body-file <draft.md>
# ...push commits, watch checks...
gh pr ready <n>
```

Reopening a PR as draft mid-review (because a rebase reintroduced red CI) is normal and expected — it's cheaper than a reviewer re-reviewing red code.

## Rebase on conflict — mergeability is a moving target

`MERGEABLE` on a PR is a snapshot, not a guarantee. Every time a *different* PR lands on the base branch, recheck:

```bash
git fetch origin
git rebase origin/<base>
gh pr view <n> --json mergeable,mergeStateStatus
```

If you're landing multiple dependent PRs in one session, land base before dependent, and **rebase the dependent again after each merge** — don't assume one rebase at the start of the session covers the whole session.

## Never force-push, never admin-bypass a real gate

- **No force-push** once a human or bot has started reviewing the branch — it invalidates their in-progress review context and can silently drop commits they already looked at. Push new fixup commits instead.
- **No admin override to skip a real required check.** An admin/bypass flag exists for genuine emergencies operated by a human with the authority to accept that risk — it is not a routine agent move, and it is exactly the failure mode `pr_readiness.mjs`'s `admin-bypass-used` finding exists to catch. If a required gate is red, fix the gate.
- Both are fine to use for a human maintainer's own deliberate, documented emergency call — the anti-pattern is an agent defaulting to them to avoid a fix.

## Landing through a merge queue

When the repo has a merge queue configured, the queue — not the agent — decides squash vs. merge vs. rebase and whether to delete the branch. Enqueue and let it run:

```bash
gh pr merge <n> --auto     # enqueues; do not add --squash/--merge/--rebase/--delete-branch by hand
```

Forcing a specific strategy flag overrides the queue's configured policy and can produce merge commits (or squash commits) that don't match the repo's convention. If there is no merge queue configured for the repo, confirm the repo's actual convention (squash vs. merge) before choosing — don't guess.

After the queue lands the PR, confirm the base branch actually contains the change (`git log origin/<base> --oneline -5`) before telling anyone the PR shipped — a queue can silently requeue-and-fail on a late conflict.
