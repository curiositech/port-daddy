# 0133. Issue lifecycle — intake redirect, mass closure, and the closer loop

## Status

Proposed (2026-08-22)

- **Roadmap:** `fleet-idea-intake-redirect`

## Context

GitHub Issues on this repo are a write-only exhaust pipe. On 2026-08-22 the
census read **7,889 open issues, growing ~460/day**: 99.4% are `fleet-idea`
rows filed by the ideation ships (spark/spider/lookout/snipe) through
`apps/fleet-executor/src/ideas-store.ts`; ~30 are `fleet:broken-ship`; only
the ~10 pre-July human-filed issues are a real tail. Twelve code paths file
issues (`lib/fleet/github-output.ts` is the shared primitive); the only
designed consumer chain (test-author ← `coverage-gap`) has an empty queue;
`closeIssue` is implemented with **zero call sites**, so nothing ever closes.
The label taxonomy is provenance-only — nothing lets a consumer select work.
The ideation ships have begun proposing features that already shipped
(semantic dedup cannot detect "restates existing code").

The only designed issues→roadmap bridge, the `idea-mining-pipeline` slug, is
backlogged and was scoped at 400 issues — 19× stale.

Interpretive principle (binder ch23, adopted): **an issue never becomes work
directly.** Issues are triage input; the roadmap is the intake; WorkIntent is
the funnel. Helmsman (ADR-0131) never reads issues.

## Decision

### 1. Redirect the ideation ships (stop the bleeding)

Spark, spider, lookout, and snipe keep ideating but write **terminally to the
D1 ideas store** (which already dedups) and stop filing GitHub issues.
GitHub issues become reserved for actionable machine findings
(`fleet:broken-ship`, `coverage-gap`, watch escalations) and humans.
(Operator decision 2026-08-22: redirect-and-keep-ideating, not pause.)

### 2. Archive, then mass-close (operator-fired, never autonomous)

One batch script, run by the operator:

1. **Archive-export** every `fleet-idea` issue (id, title, body, labels,
   dates) to a committed archive file — the mining input. The export is a
   hard precondition; no close without it.
2. **Bulk-close** `fleet-idea` issues older than 14 days with a comment
   linking the archive and the mining slug. This is `closeIssue`'s first call
   site. Close, not delete — provenance links must survive.
   (Operator decision 2026-08-22: bulk-close after archive.)

Expected end state: the open count drops from ~7.9k to ~50 real issues.

### 3. Mine once, at batch scale

Revive the existing `idea-mining-pipeline` slug (updated in place), rescoped
400 → ~7.9k, over the archive, offline: normalize → embedding dedup
(cos ≥ 0.85 duplicate; 0.65–0.85 appends an `EXTENDS:<slug>` note to the
existing item) → viability filter → **hard cap ≤50** new `backlog` roadmap
rows, each carrying `source_refs: issue:#N`. Continuous mining resumes only
after intake is capped, else the funnel re-inflates. Mining runs within 30
days of the mass-close or the close is revisited.

### 4. A taxonomy that makes surviving issues selectable

`kind:defect|task|idea` · `area:<surface>` · `pd:selectable`. Selectable
means "eligible for triage into the roadmap" — never "eligible for direct
execution." Helmsman's read set remains `roadmap_items` only.

### 5. The closer loop — three call sites, in landing order

1. The mass-close batch (§2).
2. Mining: every consumed issue closes with `mined:<slug>` or `dup-of:#N`.
3. Dispatch settle: merged PRs close their `Closes #N` references.

Every close carries evidence; no silent closes.

## Consequences

### Positive

- The tracker becomes legible: ~50 real issues instead of 7,900 unread ones,
  and a burn-down rate that is no longer zero by construction.
- Ideation value is preserved at zero tracker cost; the archive preserves
  three months of exhaust for exactly one mining pass.
- The `coverage-gap` chain and broken-ship findings regain visibility.

### Negative

- The bulk-close produces a large, visible notification event once
  (operator accepted this over label-and-lock).
- Ideas filed as issues by habit will bounce; the redirect needs a short
  deprecation note in the ship prompts.

## Rejected alternatives

- **Label-and-lock instead of closing.** Leaves the tracker visually buried
  at ~7.9k open; mining works either way; the operator chose closure.
- **Pause the ideation ships.** Loses the ambient exploration stream to save
  pennies; the D1 store already absorbs it deduped.
- **Continuous mining from day one.** Refills the funnel faster than triage
  can drain it; one capped batch first.
- **Issues as a direct Helmsman work source.** Violates the rail rule and
  reintroduces an ungoverned intake beside WorkIntent.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| P0 | fleet-idea-intake-redirect | now | — | Ideation ships write terminally to the D1 ideas store; issue filing reserved for actionable findings + humans |
| P1 | issue-mass-close-fleet-idea | backlog | fleet-idea-intake-redirect | Archive-export then operator-fired bulk-close of fleet-idea issues >14d; first closeIssue call site |
| P2 | idea-mining-pipeline | backlog | issue-mass-close-fleet-idea, roadmap-schema-wiring | Batch mining of the archive: dedup/EXTENDS/viability, ≤50 backlog rows with issue source_refs, per-issue evidence closes |

## References

- `docs/proposals/pd-helmsman.md` · ADR-0131 · binder ch21/ch23
- `apps/fleet-executor/src/ideas-store.ts`, `lib/fleet/github-output.ts`,
  `lib/roadmap-items.ts`
