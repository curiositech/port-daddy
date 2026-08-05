# Git Discipline — port-daddy-internal extensions

This page extends ADR 0001 with port-daddy-specific rules. Read
`port-daddy-agent-skill/references/git-discipline.md` first for the
universal five rules; this page adds the contributor-only constraints.

## Tag immutability

Every `vX.Y.Z` tag in this repo is referenced by:

- the Homebrew tap formula `curiositech/homebrew-tap:Formula/port-daddy.rb` (frozen artifact checksums)
- the Mac app DMG manifest (signed + notarized at build time)
- the signed-binary, Homebrew, MCP, or extension manifests for consumers
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

The only Homebrew formula authority is
`curiositech/homebrew-tap:Formula/port-daddy.rb`. The source repository has no
formula mirror and source-root discovery never depends on a formula file.

1. Merge the reviewed release source and create the immutable `vX.Y.Z` tag.
2. Publish the GitHub release so `.github/workflows/release.yml` builds, signs,
   seals, and uploads the platform archives.
3. The successful release workflow sends `update-formula` to
   `curiositech/homebrew-tap`; prereleases never update the tap.
4. In the tap, verify that `update-formula.yml` resolved the published archive,
   recorded its real checksum, updated the service/install contract, and passed
   `brew audit` plus install tests.
5. Upgrade the installed formula, let Homebrew restart its one stable service,
   and prove CLI, TCP, FleetBar, Squid, and one harness receipt against the
   endpoint the installed daemon published.
6. Leave the source release SHA, tag, workflow run, tap commit, installed
   version, selected endpoint evidence, and proof artifacts in Port Daddy notes.

Never commit a placeholder checksum, update a formula before its archive exists,
or copy a formula between repositories. A dispatch failure is a release failure,
not a reason to recreate an in-repo mirror.

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
