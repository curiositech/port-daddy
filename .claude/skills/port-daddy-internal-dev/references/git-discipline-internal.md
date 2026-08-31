# Git Discipline — port-daddy-internal extensions

This page extends ADR 0001 with port-daddy-specific rules. Read
`port-daddy-agent-skill/references/git-discipline.md` first for the
universal five rules; this page adds the contributor-only constraints.

## Tag immutability

Every `vX.Y.Z` tag in this repo is referenced by:

- the Homebrew formula `~/coding/homebrew-port-daddy/Formula/port-daddy.rb` (frozen `sha256`)
- the Mac app DMG manifest (signed + notarized at build time)
- the npm package or extension manifests for consumers
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

The **primary** Homebrew formula lives in this repo at
`Formula/port-daddy.rb` (it also serves as a repo marker that tooling
detects). A separate downstream tap repo (`homebrew-port-daddy`) mirrors
it for users who add the tap. Both must be updated, and the sequence
across two repos matters:

1. **port-daddy repo**: tag the release commit, push the tag, **wait for the GitHub tarball to be available** (~30 seconds).
2. **port-daddy repo**: compute the tarball sha256:
   ```bash
   curl -sSL https://github.com/curiositech/port-daddy/archive/refs/tags/v<X.Y.Z>.tar.gz | shasum -a 256
   ```
3. **port-daddy repo (in-repo primary)**: update `Formula/port-daddy.rb` — `url` (new tag), `sha256` (new hash), version string in tests, `post_install` only if `install.sh` changed. Commit + push as part of the release slice.
4. **homebrew-port-daddy repo (downstream sync)**: copy the same updates into `Formula/port-daddy.rb` there (commonly via `cp` from the in-repo primary). Commit + push.
5. **back in port-daddy**: send `pd actor lookout` a message confirming both formulas match.

If you reverse step 1 and step 3/4 (push formula before tarball is available),
brew users get a 404. If you update only the tap and not the in-repo
primary, repo-marker tooling and `brew install --build-from-source ./Formula/port-daddy.rb`
diverge from what tap users see. If you skip step 5, the next contributor
can't tell whether the brew bump actually landed.

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
stamp="$(date +%s)"
wt="$HOME/coding/tmp/port-daddy-$stamp-$WORK_SLUG"
branch="codex/$WORK_SLUG-$stamp"
git worktree add -b "$branch" "$wt" origin/main
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
