# S2 pilot

`./run.sh --pilot`: corpus `py-library` (psf/requests, the pinned window in
`corpora.json`, high file-overlap regime — `README.md` alone is touched by
57 of the 200 tasks run here), all 7 substrate/p combinations (see
CHANGELOG.md for why 7, not S2.4's "6"), N in {2, 4, 8}, both temperaments,
**seeds 1-2** (cut from the originally planned 3; see CHANGELOG.md's
"pilot cut from 3 seeds to 2" entry), 200 tasks per run. **84 cells** by
that design, not the 126 an unmodified 3-seed reading of the pilot spec
would give.

**This is a pilot, not the study.** Two seeds per cell is far below the
pre-registered 20; no significance claims are made anywhere in this
document, only what the pilot suggests. The full S2.4 design (3 corpora, N
up to 16, 20 seeds) has not been run — that is `./run.sh` with no
arguments, and it is what `REPORT.md` will eventually be built from. This
pilot also only ever exercises `py-library`, the *high*-overlap corpus —
none of PROTOCOL.md's low-overlap (`docs-heavy`) comparisons in H2 are
addressed by anything below.

## Data completeness

Of the 84 designed cells, **80 are present**; the four missing are
`D-N8-cooperative-{s1,s2}` and `D-N8-impatient-{s1,s2}`. They are missing
because of the defect described in CHANGELOG.md's "D still lands exactly
4/200" entry: once `D`'s queue head stops advancing (which it does almost
immediately on this corpus — see below), every further landing attempt on
`D` recomputes a `git format-patch`/`git am` over a range that keeps
growing, and at `N=8` a single cell did not finish in 4 minutes of
genuinely CPU-bound git subprocess work. `D` at `N` in {2, 4} did complete
(8 cells) and is reported below; `D`-`N8` is left blank rather than padded
with a guess. Every other substrate/N/temperament/seed combination in the
84-cell design is present, and every present row's `tasks_landed +
tasks_abandoned` equals its `tasks_requested` (200) — `harness/pilot_summary.py`'s
completeness check confirms this over the full `results/py-library/`
directory each time it runs; its output is reproduced at the top of its
own stdout as "Missing" / "Truncated or inconsistent" lists.

Regenerate the tables below (and this completeness check) at any time with:

```sh
python3 -m harness.pilot_summary
```

It reads only `results/py-library/*.csv`; nothing here is hand-typed except
the prose.

## Medians per (substrate, N, temperament), across the seeds present

Two seeds per cell throughout (the `D`-`N8` gap aside), so a "median" below
is the mean of two values — reported as `n_seeds` in each row so this is
never disguised as more than it is. `throughput/hr`, `wasted_lines`,
`conflicts`, `ttl_median_s`, and `evidence` are PROTOCOL.md S2.3's five
metrics (`ttl_median_s`, time-to-land, is itself already a per-cell median
across landed tasks before this table takes its own median across seeds);
`torn` is the mechanical H1 self-check, not one of the five.

<!-- PILOT_TABLES_START -->

### U

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 200 | 0 | 8.58 | 15953 | 181 | 0.0 | 0.000 | 181 |
| 2 | impatient | 2 | 200 | 0 | 8.58 | 15953 | 181 | 0.0 | 0.000 | 181 |
| 4 | cooperative | 2 | 200 | 0 | 8.79 | 16009 | 184 | 0.0 | 0.000 | 184 |
| 4 | impatient | 2 | 200 | 0 | 8.79 | 16009 | 184 | 0.0 | 0.000 | 184 |
| 8 | cooperative | 2 | 200 | 0 | 8.90 | 16024 | 185 | 0.0 | 0.000 | 185 |
| 8 | impatient | 2 | 200 | 0 | 8.90 | 16024 | 185 | 0.0 | 0.000 | 185 |

### B0

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 60 | 140 | 0.05 | 47984 | 28421 | 0.0 | 1.000 | 0 |
| 2 | impatient | 2 | 44 | 156 | 50.89 | 48194 | 156 | 0.0 | 1.000 | 0 |
| 4 | cooperative | 2 | 60 | 140 | 0.05 | 47982 | 28162 | 0.0 | 1.000 | 0 |
| 4 | impatient | 2 | 44 | 156 | 118.28 | 48186 | 156 | 0.0 | 1.000 | 0 |
| 8 | cooperative | 2 | 62 | 138 | 1.38 | 47963 | 28024 | 0.0 | 1.000 | 0 |
| 8 | impatient | 2 | 34 | 166 | 325.98 | 48262 | 166 | 0.0 | 1.000 | 0 |

### B005

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 200 | 0 | 0.63 | 25192 | 1210 | 0.0 | 0.665 | 64 |
| 2 | impatient | 2 | 90 | 110 | 35.42 | 47880 | 114 | 0.0 | 0.863 | 4 |
| 4 | cooperative | 2 | 200 | 0 | 0.81 | 26000 | 1637 | 0.0 | 0.568 | 83 |
| 4 | impatient | 2 | 55 | 145 | 43.99 | 42602 | 151 | 0.0 | 0.780 | 6 |
| 8 | cooperative | 2 | 200 | 0 | 8.49 | 15026 | 1678 | 0.0 | 0.557 | 84 |
| 8 | impatient | 2 | 58 | 142 | 84.00 | 42745 | 149 | 0.0 | 0.778 | 7 |

### B02

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 200 | 0 | 1.66 | 15074 | 418 | 0.0 | 0.492 | 94 |
| 2 | impatient | 2 | 116 | 84 | 45.13 | 47784 | 112 | 0.0 | 0.630 | 28 |
| 4 | cooperative | 2 | 200 | 0 | 5.82 | 15314 | 472 | 0.0 | 0.470 | 98 |
| 4 | impatient | 2 | 97 | 103 | 125.80 | 47728 | 137 | 0.0 | 0.545 | 34 |
| 8 | cooperative | 2 | 200 | 0 | 6.19 | 15574 | 640 | 0.0 | 0.338 | 124 |
| 8 | impatient | 2 | 85 | 115 | 128.36 | 47829 | 144 | 0.0 | 0.488 | 30 |

### C

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 60 | 140 | 0.05 | 47984 | 28421 | 0.0 | 1.000 | 0 |
| 2 | impatient | 2 | 44 | 156 | 50.89 | 48194 | 156 | 0.0 | 1.000 | 0 |
| 4 | cooperative | 2 | 60 | 140 | 0.05 | 47982 | 28162 | 0.0 | 1.000 | 0 |
| 4 | impatient | 2 | 44 | 156 | 118.28 | 48186 | 156 | 0.0 | 1.000 | 0 |
| 8 | cooperative | 2 | 62 | 138 | 1.38 | 47963 | 28024 | 0.0 | 1.000 | 0 |
| 8 | impatient | 2 | 34 | 166 | 325.98 | 48262 | 166 | 0.0 | 1.000 | 0 |

### D

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 4 | 196 | 0.17 | 48325 | 784 | 0.0 | 1.000 | 0 |
| 2 | impatient | 2 | 4 | 196 | 0.17 | 48325 | 196 | 0.0 | 1.000 | 0 |
| 4 | cooperative | 2 | 4 | 196 | 0.17 | 48368 | 784 | 0.0 | 1.000 | 0 |
| 4 | impatient | 2 | 4 | 196 | 0.18 | 48368 | 196 | 0.0 | 1.000 | 0 |

N=8 is missing for `D` — see "Data completeness" above and CHANGELOG.md.

### CR

| N | temperament | n_seeds | landed | abandoned | throughput/hr | wasted_lines | conflicts | ttl_median_s | evidence | torn |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | cooperative | 2 | 62 | 138 | 0.04 | 47959 | 27890 | 0.0 | 1.000 | 0 |
| 2 | impatient | 2 | 59 | 141 | 6.02 | 48054 | 141 | 0.0 | 1.000 | 0 |
| 4 | cooperative | 2 | 62 | 138 | 0.06 | 47959 | 28030 | 0.0 | 1.000 | 0 |
| 4 | impatient | 2 | 49 | 151 | 5.00 | 48150 | 151 | 0.0 | 1.000 | 0 |
| 8 | cooperative | 2 | 62 | 138 | 0.03 | 47959 | 28114 | 0.0 | 1.000 | 0 |
| 8 | impatient | 2 | 44 | 156 | 4.54 | 48184 | 156 | 0.0 | 1.000 | 0 |

<!-- PILOT_TABLES_END -->

A few things worth reading directly off these tables before the H1-H4
notes below: `B0` and `C` are row-for-row identical (see H3). Cooperative
temperament on this high-overlap corpus produces enormous `sim_seconds`
and `conflicts` under every claim-based substrate (`B0`, `C`, `CR`, and
`B005`/`B02` at low `p`) relative to impatient, because a cooperative agent
retries a refused claim until `COOPERATIVE_RETRY_CAP=200` attempts rather
than abandoning — `throughput_per_hour` for these rows is correspondingly
tiny (the simulated clock runs for a very long time to land, or fail to
land, a fixed 200 tasks). `U`'s numbers do not depend on temperament at all
(matches `harness/agents.py`: `U` never claims or retries, so temperament
never enters its code path).

## Pilot-only notes on H1-H4

**H1 (confinement).** Torn-tree incidents rise with `p` and (mostly) with
`N` under `B(p)`: `B0` (p=0) is 0 at every N and temperament, matching the
prediction that a bypass rate of zero should behave like the enforced
rail; `B005` and `B02` are both nonzero and generally higher at N=8 than
N=2 within a temperament (the one exception is `B02` impatient, where N=8
is slightly *below* N=4 — with two seeds this is noise, not a reversal
worth reading into). `U`'s torn count also rises gently with N. Torn is 0
under `C` and `CR` at every N and temperament, and 0 under `D` too **by
the self-check's own literal definition** — but CHANGELOG.md's "D still
lands exactly 4/200" entry documents a second, harder-to-detect failure
mode specific to `D` on this corpus (an out-of-order landing silently
dropped as a no-op rather than flagged), so `D`'s clean self-check result
should not be read as "no coordination problem at all," only as "no
*unresolved-marker* problem." With that one caveat, the pilot supports H1:
the harness's own correctness check (zero tearing under C, CR, D) holds,
and bypass-driven tearing scales with exposure (p) and contention (N) in
the expected direction.

**H2 (the real question).** This pilot cannot speak to H2 as PROTOCOL.md
states it, for two independent reasons. First, H2's low-overlap comparison
is specified against the documentation corpus at N <= 4; this pilot only
ran `py-library` (the high-overlap corpus), so there is no low-overlap
data here at all — the full S2.4 run, not this pilot, is what would supply
it. Second, even H2's high-overlap half (C vs. D at N >= 8) cannot be
judged from this pilot's `D` numbers: every completed `D` cell lands
exactly 4 of 200 tasks regardless of N or temperament, which CHANGELOG.md
traces to a harness scheduling defect in `D`'s landing order, not to
anything about the merge-queue model PROTOCOL.md means to test. Naively
read, `C` at N=8 (landing 62/200 cooperative, 34/200 impatient) beats `D`
(landing 4/200 either temperament) by a wide margin at high overlap, which
looks like the opposite of H2's framing — but that comparison is not
trustworthy until the defect is fixed, so no conclusion, in either
direction, is drawn here.

**H3 (does enforcement matter for coordination, or only confinement?).**
Confirmed cleanly, as far as two seeds can confirm anything: `B0`'s and
`C`'s summary rows are byte-identical in every (N, temperament) cell run —
same `tasks_landed`, `tasks_abandoned`, `sim_seconds` to the millisecond,
`conflict_incidents`, and every other column. CHANGELOG.md's metric
entry explains why this is guaranteed *by construction* for the
`conflict_incidents` column specifically at p=0, but the other columns
(landed count, simulated seconds, wasted lines) are not defined that way —
they come from actually running two different code paths (`B0`'s
non-bypass branch and `C`'s single path) through the same git operations,
and they came out identical anyway. That is a real, if pilot-scale,
confirmation that `B(0)`'s and `C`'s coordination behavior is the same
program, not just the same numbers on paper.

**H4 (granularity).** Untestable in the form PROTOCOL.md states it this
pilot: H4 asks whether `CR` recovers half of `C`'s throughput deficit
against `D` "where a deficit exists," and per H2 above there is no
trustworthy `C`-vs-`D` deficit to recover from in this pilot's data — `C`
already lands far more tasks than `D` does, the opposite of a deficit,
because of `D`'s scheduling defect rather than a genuine substrate
comparison. What the pilot does show is that `CR`'s own numbers track
`C`'s closely: at N=8 cooperative both land exactly 62/200; at N=8
impatient `CR` lands 44/200 against `C`'s 34/200, `CR` slightly ahead. This
suggests line-range claims do not obviously cost, and may modestly help,
relative to whole-file claims on this corpus — plausible on a corpus like
`py-library` where many touched files are small enough that a "line range"
claim and a "whole file" claim cover nearly the same territory anyway.
That observation is suggestive, not a test of H4, and should not be
reported as one.
