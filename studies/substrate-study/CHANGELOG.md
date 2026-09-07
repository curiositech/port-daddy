# Changelog

Deviations from PROTOCOL.md and fetch fallbacks, per its own instruction
("changes to hypotheses, metrics, or stopping rules after data are logged
here with the date and the reason; the original text stays"). Nothing below
changes a hypothesis, a metric's meaning, or a substrate; each entry is
either a genuine inconsistency in the pre-registered text or an engineering
detail needed to make the text's own intent testable.

## 2026-09-07 — PROTOCOL.md was not in this worktree's git history

The harness worktree (`wave-14/substrate-harness`, branched from this
worktree-isolated checkout) had no `studies/substrate-study/` at all when
work began; `PROTOCOL.md` existed only as an untracked file in the shared
checkout at `/home/user/port-daddy/studies/substrate-study/PROTOCOL.md`. It
was read there and copied byte-for-byte into this worktree before any other
file was written. No wording was changed.

## 2026-09-07 — S2.4 says "6 levels"; S2.2's table names 7 substrate/p combinations

PROTOCOL.md S2.4: "Factors: substrate (6 levels)". PROTOCOL.md S2.2's table
defines U, B(p) for p ∈ {0, 0.05, 0.2}, C, D, and CR — that is 7 distinct
substrate/p combinations (U; B0; B005; B02; C; D; CR), not 6. This is an
arithmetic inconsistency in the pre-registered text itself, not something
this harness can resolve without either inventing a substrate S2.2 never
named or dropping one S2.2 does name. The minimal deviation is to keep every
combination S2.2's table defines: `harness/sim.py`'s `SUBSTRATES` and
`run.sh`'s grid both run all 7. No substrate was added or removed relative
to S2.2's own table.

## 2026-09-07 — B(p)'s conflict-incidents definition, so H3 is a real test

S2.2: "Conflict incidents: refusals (C, CR), merge conflicts (D), torn
writes (U, B)." Read literally as an exclusive per-substrate-family
definition, B(p)'s conflict-incidents metric would be torn-write count only,
while C's is refusal count only — even at p=0, where B(0)'s write path is
defined to be identical to C's (no bypass ever fires). That reading makes
H3 ("B(0) and C are indistinguishable on every metric") fail by metric
construction regardless of what the simulation actually does, which
contradicts S2.5's own framing of H3 as something to be tested, not decided
by definition. `harness/metrics.py` instead defines B(p)'s conflict
incidents as refusal_count + torn_count: at p=0 this reduces exactly to
C's refusal_count (verified: a B0 run and a C run with the same corpus,
agents, temperament, and seed produce byte-identical metric rows), and at
p>0 it counts both the refusals its non-bypassed path can produce and the
torn writes its bypass path can produce, matching the table's literal
wording for U (which never attempts a claim, so refusal_count is always 0
for it and the definition reduces to torn_count alone, as the table says).

## 2026-09-07 — Corpus fetch: no fallback needed

All three corpora cloned on the first attempt (`git clone --bare
<repo_url>`) through the preconfigured proxy; the shallow
`--filter=blob:none --depth 700` fallback and the self-history fallback
(this repository's own commits) specified in the ground rules were not
needed. Repositories and pinned ranges are recorded in `corpora.json`:

| Corpus key | Repo | Role | Range |
|---|---|---|---|
| `ts-service` | nestjs/nest | mid-size TypeScript service | 600 commits, first-parent, ending at `39fbddae5` |
| `py-library` | psf/requests | Python library, wide contributor base | 600 commits, first-parent, ending at `dae7ef63b` |
| `docs-heavy` | rust-lang/book | documentation-heavy | 600 commits, first-parent, ending at `1500248d8` |

`start_sha`/`end_sha` in `corpora.json` are the oldest and newest commits of
each window on the **first-parent** chain of the default branch, not a
plain `git log` walk: PROTOCOL.md says "the most recent 600 commits on the
default branch", and first-parent chains avoid an ambiguity plain
chronological rev-list walks have on merge-heavy histories (a merge commit
pulls side-branch ancestors into the walk that are not part of "the last
600 commits on the mainline" in any useful sense, and a naive `A..B` range
built from such a walk can contain far more or fewer than 600 commits once
merges are involved — this was caught empirically while pinning `ts-service`
and is why first-parent chains were used for all three).

## 2026-09-07 — torn-tree self-check uses `git apply --3way`, not a bare `--check`

PROTOCOL.md S2.2's mechanical definition: "after each landing the tree must
apply the next task's base diff cleanly, or the tree is scored torn for
that step." The first implementation used a bare `git apply --check`
(strict context-line matching only) and it produced nonzero torn-tree
counts under **D**, which S2.2 requires to be zero by construction. The
cause: D and C's landings both use 3-way merges (`git apply --3way`, real
`git rebase`) to resolve harmless task reordering, which a plain 2-way
`--check` cannot see — the tree was never actually corrupted, the check
was just stricter than the substrate's own conflict-resolution power. Fixed
by making the self-check try the same `--3way` apply the substrates use for
real landings (always as a dry run: any trial change is rolled back with
`git reset --hard` + `git clean -fd` before returning, so the check never
mutates committed history). After the fix, `make check` shows zero torn-tree
incidents under C, CR, and D on every substrate, temperament, and seed
tried, and nonzero counts under U and B(p>0) at higher N/overlap, matching
H1's expectation in both directions.

## 2026-09-07 — commit signing disabled inside simulation working trees only

This machine's global git config sets `commit.gpgsign=true`. Left as-is,
every one of the harness's internal per-task commits (in the throwaway
clones under `.cache/`, deleted at the end of every run) would fork a GPG
signing subprocess, which measured at roughly 14x the cost of an unsigned
commit in this environment. `harness/substrates.py` sets
`commit.gpgsign=false`, `tag.gpgsign=false`, `core.fsync=none`, and
`gc.auto=0` as **local** config in each simulation working tree only, right
after it is cloned. These commits are never pushed anywhere, are not
authored content, and are deleted with the rest of the run's working tree
on cleanup; this does not change how this harness's own deliverable commits
to `wave-14/substrate-harness` are made — those go through the normal,
signed commit path untouched.

## 2026-09-07 — pilot cut from 3 seeds to 2

The task's own pilot spec (not PROTOCOL.md, which does not name a pilot)
calls for 3 seeds. After the pilot had been running for roughly 10 minutes
and completed only ~20 of 126 cells — because py-library (psf/requests) has
a real hot file (`README.md` alone is touched by 57 of the pinned 200
commits) and cooperative agents retry a refused claim indefinitely, low-N
cooperative cells on this corpus generate very large numbers of retry
events (one observed cell: `B0, N=2, cooperative, seed=2` reached
~1.15M simulated seconds and 21k conflict incidents before its 200 tasks
resolved) — the remaining 106 cells projected to well over an hour of
wall-clock time. Per instruction, the pilot was cut to seeds 1-2 (84 cells)
rather than let it run further past that budget. `run.sh --pilot`'s
`PILOT_SEEDS` was changed from `(1 2 3)` to `(1 2)`; the six seed-3 result
files already produced for substrate U were deleted so the delivered
`results/py-library/` reflects exactly 2 seeds throughout, matching
PILOT.md. This is a pilot-scope reduction only — it does not touch
PROTOCOL.md's pre-registered 20-seed design for the real S2.4 run, which
`run.sh` (no arguments) still runs unchanged.

## Deferred, not a deviation

`REPORT.md` (PROTOCOL.md S2.6/S4) is not produced by this delivery. It is
specified to answer H1-H4 from the full S2.4 design (6-7 substrates × N ∈
{2,4,8,16} × 3 corpora × 2 temperaments × 20 seeds), which `run.sh` (no
arguments) can run but which this delivery does not execute — only
`make check`'s smoke and `run.sh --pilot` were run. `PILOT.md` reports the
pilot's numbers, hedged as pilot-only, and explicitly draws no conclusion
about the book, per the task's own instruction.
