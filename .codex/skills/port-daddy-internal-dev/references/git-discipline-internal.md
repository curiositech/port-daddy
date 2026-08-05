# Git Discipline — port-daddy-internal extensions

This page extends ADR 0001 with port-daddy-specific rules. Read
`port-daddy-agent-skill/references/git-discipline.md` first for the
universal five rules; this page adds the contributor-only constraints.

## Tag immutability

Every `vX.Y.Z` tag in this repo is referenced by:

- the `curiositech/homebrew-tap` formula (frozen artifact URLs and SHA-256)
- the signed GitHub Release binaries and `latest.json` update feed
- the Mac app DMG manifest (signed + notarized at build time)
- extension manifests for consumers
- screenshots / docs that link to GitHub at `tree/v<X.Y.Z>/...`

Force-pushing a release tag breaks all of these. **Tags are immutable.**
If a release was wrong, ship `vX.Y.Z+1` with a CHANGELOG entry recalling
the previous tag. Add a `RECALL` block at the top of CHANGELOG explaining
the symptom, the cause, and what users on the bad tag should do.

```bash
# allowed
git tag -a v0.42.1 -m "Recall v0.42.0: brew post_install regressed on macOS 14"
git push origin v0.42.1

# forbidden
git push --force origin v0.42.0
git tag -d v0.42.0 && git tag -a v0.42.0 ...      # also forbidden
```

## v-prefix convention

Release tags MUST be prefixed `v` (e.g., `v0.42.0`, not `0.42.0`). The
brew formula's url template assumes the prefix; CI parsers assume the
prefix; the website docs/version map assumes the prefix. A tag without
`v` will silently break downstream tooling.

## Brew formula update protocol

The public formula lives in `curiositech/homebrew-tap`. A real, non-prerelease
GitHub Release runs `.github/workflows/release.yml`; its `update-homebrew` job
dispatches the released version to that tap after the exact-tree review,
binaries, and FleetBar gates succeed. Feature agents do not tag releases or
hand-edit an in-repo formula.

If the automatic tap dispatch fails, hold `pd lock release-publish` and follow
the manual dispatch and verification steps in `docs/RELEASING.md` section 1.
Do not use `.github/workflows/publish.yml` for Homebrew: it is the dormant npm
workflow retained only in case that retired distribution channel is revived.

## Pre-push reconciliation (mandatory)

```bash
git fetch origin
git rebase origin/main           # use origin/master only when origin/master actually exists
pd sessions --all-worktrees
pd notes --limit 20
pd guard check --staged
```

Skip this and the chance of a non-fast-forward push from a parallel
contributor is high. Port-daddy has the highest contributor agent
density of any repo on this machine.

## Worktree mandatory (no exceptions)

The public skill says "worktree if work takes >10s". For port-daddy
contributors, worktree is **always** mandatory regardless of work size.
The repo has 70+ existing worktrees and dozens of WIP branches —
sweeping up someone's WIP is not hypothetical, it has happened, and the
recovery is destructive.

```bash
wt="../port-daddy-$(date +%s)-$WORK_SLUG"
git worktree add "$wt" origin/main
cd "$wt"
```

When done, `git worktree remove` from the main checkout, not from inside
the worktree itself.

## Don't push from a stale base

If `git fetch origin` shows commits ahead of your local origin/main,
and you have not rebased onto them, **do not push**. Reset, rebase,
re-validate. The frequency of "force-push to fix push rejection" goes to
zero if you never push from a stale base in the first place.

## See also

- `port-daddy-agent-skill/references/git-discipline.md` — universal rules.
- `~/coding/windags-skills/docs/adr/0001-background-agent-git-discipline.md` — the ADR with alternatives considered.
- `references/release-surface-drift-protocol.md` (this skill) — the full mirror-update walk that pairs with Rule 5 (push only what you tagged).
