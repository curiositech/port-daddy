# Stranded work: PRs that say "Merged" and are not in the product

**Measured 2026-09-10.** Reproduce with `node scripts/find-stranded-prs.mjs`.

A PR whose base is a feature branch rather than `main` is not shipped when it
merges — it moves one branch sideways. GitHub says "Merged" either way, and that
badge is the whole problem: it retires the work from everyone's attention while
leaving it outside the product. The rule that stops new instances is in
AGENTS.md, "Base `main`. Do not stack PRs onto feature branches." This file is
the backlog of instances that already happened.

## The measurement

1,255 PRs have merged in this repository's life. **99 merged into a base other
than `main`; 72 of those are from the last five weeks.** Each of the 72 was
tested against `main` two ways — by patch-id (`git cherry`, which survives
squash and rebase) and by whether the files it added exist on `main` at all.

| Verdict | Count | Meaning |
|---|---|---|
| LANDED | 26 | every commit has an equivalent in `main` |
| LANDED-REWRITTEN | 22 | content is in `main` in edited form (rebase conflict resolution changes the patch) |
| **STRANDED** | **6** | no commit and none of its added files are in `main` |
| STRANDED-UNCERTAIN | 2 | modification-only PRs; patch absent, nothing added to test against |
| NO-COMMON-HISTORY | 16 | head shares no history with `main` (fork, or cut before a rewrite) |

Do not read the ancestry test as the answer. `main` takes most work by squash or
rebase, so a branch tip is almost never an ancestor of `main` even when its
content shipped: run over live branches it calls 895 of 917 "unmerged," which is
an artifact of the merge strategy, not a finding.

## Cluster A — lands automatically when #10097 merges

`#10122`, `#10120`. Both merged into `claude/white-paper-pr-review-uncpxg`,
which is 233 commits ahead of `main` with a clean merge and green CI. **No
rescue needed; they ship when that PR does.** They are counted as stranded above
because today, factually, they are.

They are also the argument for the rule: two merged PRs whose fate depends
entirely on a third PR that nobody had scheduled to merge.

## Cluster B — orphaned, needs a decision each

None of these apply cleanly to today's `main` — all four need three-way merges,
since `main` has moved weeks to a month since they merged. Each is small.

| PR | What it is | Size | Where the commits still live |
|---|---|---|---|
| `#9730` | `fix(relay): a malformed parley path answered 500, not the shared 404` | 8 files, +277/−25 | `purser/pr-9730-tests` |
| `#7091` | `feat(pd-console): Fleetbot Quality pane — browse "wrong verdict" flags` | 12 files, +597/−9 | orphaned (only `refs/pull/7091/head`) |
| `#7184` | `fix(tests): stop three more purser assertions pinning mutable state` | 6 files, +563/−28 | orphaned |
| `#6206` | `refactor(daemon): retire bosun command surface` | 9 files, +27/−14 | `fix/pd-verb-help` |

**Recommended dispositions.**

- **`#9730` — rescue.** A real relay bug: a malformed parley path returns 500
  instead of the shared 404. It is still a live defect unless something else
  fixed it since; check `apps/relay/src/parleys-page.ts` before porting.
- **`#7091` — decide, do not port blind.** A whole console pane (+597) built for
  browsing Fleetbot "wrong verdict" flags. Whether it is still wanted depends on
  whether that flag flow still exists; a month-old UI feature can be dead by
  premise rather than by conflict.
- **`#7184` — likely moot.** It hardens assertions in `tests/purser/*`, and the
  purser was disabled on 2026-09-10. Rescue only if the purser is re-enabled.
- **`#6206` — rescue, cheap.** +27/−14 retiring the bosun command surface from
  the CLI, README and completions. If the bosun surface is still referenced in
  those files on `main`, the cleanup never happened and is a five-minute port.

**`#9750` and `#6420`** are modification-only, so the added-file test says
nothing. Both are single commits with orphaned heads; read the diffs before
deciding.

## Nothing here is lost

Every head above is still fetchable — GitHub keeps `refs/pull/<n>/head`
indefinitely, and `scripts/find-stranded-prs.mjs` fetches them. "Orphaned" means
no live branch points at the commits, not that they are gone.

## The wider hazard

917 branches are alive in the remote. **138 of them are `purser/`** — the bot
whose design was to author adversarial tests on a stacked branch and retarget
the reviewed PR onto it. That retarget silently failed at least once (`#10121`
authored three tests for `#10120`; the retarget never happened, `#10120` merged
around them, `#10121` closed unmerged), and the purser's sandbox has been unable
to execute its own tests for weeks — an adjudicated fleet-wide fault (`#9789`).
The purser was disabled in `pd-fleet.yml` on 2026-09-10. The 138 branches are
not triaged here; most hold only generated tests, but that is an assumption
worth checking before anyone deletes them in bulk.
