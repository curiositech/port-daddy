# 0131. Verdict Integrity — Every Completed Gate Must Prove What It Actually Decided

## Status

Proposed

## Context

On 2026-08-26 the operator halted Port Daddy repo-wide after a spend spike, with
an explicit order to work solo, without coordination, until the underlying
cause is understood. This ADR is that understanding, written up before any
further fleet work resumes.

In one session immediately prior to the halt, six distinct bugs were found and
fixed across the fleet-executor/relay pipeline, each independently discovered
while chasing what looked like an unrelated PR problem:

1. **CUDA-OOM** — the purser sandbox's `npm ci` unconditionally fetched CUDA
   provider binaries on linux-x64 with no GPU present, OOM-killing the install
   before any test ran (fixed, PR #7020).
2. **Sandbox retry non-idempotency** — a retried sandbox run reused a warm
   container whose `.git` already had `origin` set, so `git remote add`
   crashed the retry too (fixed, same PR).
3. **Merge-queue bootstrap deadlock** — the relay never enqueued a fleet run
   for `merge_group` events, so the required `Port Daddy Fleet` check could
   never be produced on the queue branch; `main` was frozen five days (fixed,
   PR #7036 / #5990).
4. **Phantom merges** — a PR retargeted onto a purser test-staging branch
   merges into that branch, and GitHub reports it `MERGED` identically to work
   that reached `main`. Six PRs were found stranded this way in one triage
   session, and it recurred against this session's own work (fixed, PR
   #7186).
5. **DLQ mislabeling** — a job that died before any ship ran completed its
   check as plain `failure`, rendering identically to a real BLOCK verdict.
   Ten-plus correct PRs were re-diagnosed from scratch on this basis in one
   day (fixed, same PR).
6. **Golden-snapshot false blocks** — several purser-authored tests asserted
   exact literal prose/counts from `docs/roadmap/roadmap.snapshot.json`, a
   document many concurrent agents edit continuously. Content drifted twice in
   a ten-minute window during diagnosis (fixed, PR #7121, #7184).

Six bugs, six PRs, six one-off fixes. That is the problem this ADR addresses:
not any single bug, but the fact that they are the same bug, discovered six
times by six different investigations before anyone noticed the shape.

### The actual cost mechanism

None of the six directly caused the spend spike by itself. What they share is
this: each produces a **signal that looks final and is wrong** — a red check
that isn't about your code, a green merge that didn't happen, a test failure
that's the document's fault, not the diff's. Nothing downstream re-verifies a
completed signal; a human skimming a checks list and an agent deciding whether
to keep investigating both trust it at face value.

Under concurrency this is not a fixed cost. It is `O(agents who encounter it)`,
because each one re-diagnoses from scratch unless the false signal explains
itself. With many agents working one repo simultaneously — which is exactly
the operating mode Port Daddy is built for — the same false signal gets
re-discovered, re-investigated, and re-explained by every agent unlucky enough
to hit it first, in parallel, none aware the others already did the same work.
That multiplication, not any individual bug, is the structural reason a
handful of infrastructure defects can produce an outsized bill.

## Decision Drivers

- A completed gate is trusted at face value by everything downstream — no
  consumer re-verifies it, so a false completion propagates for free.
- The cost of a false signal scales with the number of agents who hit it, not
  with the size of the underlying bug — this is a swarm-specific amplifier
  that would not exist at single-agent scale.
- Retrofitting each incident as found (what happened in the session above: six
  separate PRs) bounds nothing; there is no reason to believe six is the last
  count of this shape.
- Fail-closed is the correct default for merge safety — an unverified change
  should not merge. Fail-closed **without** fail-legible turns every ambiguous
  case into an expensive mystery instead of a five-second read.
- The taxonomy this ADR proposes already exists in the code as *intent*:
  `blockWithoutSandbox: false` and the `neutral` conclusion both encode "don't
  treat an unrun test as a verdict." What's missing is enforcement — new call
  sites drift out of the intent because nothing checks them against it.

## Considered Options

- **A. Keep fixing instances as found.** What happened in the session that
  motivated this ADR. Cheap per-incident, proven to not generalize — the sixth
  instance was found by accident while fixing the fifth.
- **B. Remove the sources of false signal** (loosen the tests, drop the fleet
  check, disable the purser). Trades false positives for zero verification —
  worse, not better; it deletes the safety net along with the noise.
- **C. A structural verdict-integrity contract.** Define once what a
  completed signal is allowed to claim, classify every existing completion
  site against it, and add a cheap static check so a new site can't silently
  drift out of the taxonomy the way the DLQ did. Higher upfront cost, bounds
  recurrence.

## Decision

Adopt **C**. Every place in the fleet — relay, executor, purser, and any ship
added later — that completes a check run, posts a merge-relevant comment, or
retargets a PR must be classified as exactly one of three kinds, and the
signal itself must say which kind it is, not just imply it in a summary a
reader has to click through to see:

1. **VERDICT** — a ship actually ran and reached a conclusion about the
   change. May legitimately block a merge.
2. **INFRA** — nothing about the change was evaluated; the pipeline itself
   failed, timed out, or could not run. Must still fail closed (never
   silently green), but must be visibly, unmistakably distinct from VERDICT —
   different title text at minimum, since the check-run title is the only
   part GitHub renders in a PR's checks list without a click-through.
3. **DEFERRED** — evaluation was intentionally skipped (paused, self-review
   guard, PR-lifecycle gate) and is expected to be retried, not treated as
   final. Must never be mistaken for either of the above by a redelivery
   guard — this is the failure mode `execute.ts`'s `DECIDED` set already
   guards against for `neutral`.

## Rationale

**Why three kinds, not two or five.** Two (pass/fail) is the current state,
and it is demonstrably not enough resolution — every reader's actual next
question is "do I look at my code, is this the system's fault, or is this not
final yet," which needs exactly three buckets. Five-plus would recreate
bespoke per-subsystem vocabulary — the pattern that already happened
organically (model routing, phantom-merge, DLQ, and golden-snapshot were each
solved with their own private vocabulary before this ADR named the common
shape). Three is the minimum split that answers the one question every reader
has, and no smaller split does.

**Why enforce structurally instead of trusting the existing convention.**
Nobody involved in today's six incidents disagreed with the taxonomy —
`blockWithoutSandbox: false`'s own docstring already states the VERDICT vs.
not-VERDICT distinction, months before the DLQ was written. The DLQ's bug
wasn't a disagreement; it was a *new call site with no way to discover the
existing convention* short of reading purser.ts's comments first, which
nothing required it to do. A comment in one file does not scale past the
person who wrote it and the exact moment they wrote it. A cheap static check —
in the spirit of `scripts/adr-number-collision-guard.mjs`'s existing
fail-closed CI pattern for this exact kind of drift — closes that discovery
gap for every call site that comes after this one.

## Implementation Matrix

<!-- ADR-0043: one row per phase. Roadmap slug is the join key into
     roadmap_items; wiring it up (`pd adr sync`/`pd adr matrix`) is
     deliberately NOT done as part of writing this ADR, since Port Daddy
     coordination is halted at time of writing. Do that wiring once the halt
     is lifted, not before. -->

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0131-phase-0-classify-existing-sites | now | — | Enumerate every `completeCheckRun` / `postShipComment` / `retargetPrBase` call site in `apps/fleet-executor` and `apps/relay`; tag each VERDICT / INFRA / DEFERRED at the call site. Audit only, no behavior change — and likely to surface more undiscovered instances of this pattern, the same way auditing one golden-snapshot test found three more. |
| 1 | adr-0131-phase-1-title-convention | now | Phase 0 | Formalize the ad hoc `CHECK_OUTPUT_TITLE_INFRA` (shipped in PR #7186 for the DLQ specifically) into a shared, exported title/prefix convention so INFRA is visually distinct from VERDICT at *every* call site, not only the one that happened to get fixed first. |
| 2 | adr-0131-phase-2-ci-lint | backlog | Phase 1 | A static check, mirroring `adr-number-collision-guard.mjs`'s fail-closed shape, that flags any `completeCheckRun`/`postShipComment` call passing a `failure`-shaped conclusion without an explicit VERDICT/INFRA/DEFERRED classification attached. |
| 3 | adr-0131-phase-3-golden-snapshot-linter | backlog | — | A narrow companion check for the sibling incident family: a test asserting exact literal content of a path under `docs/roadmap/` (or any path routinely written by concurrent agents). Not a general test-quality tool — just the specific "this will false-block the next unrelated PR" shape already caught by hand three times (PR #7121, #7184, #9880). |
| 4 | adr-0131-phase-4-phantom-merge-generalize | backlog | Phase 1 | Generalize the phantom-merge notice (PR #7186) beyond the `purser/*` staging-branch case to any future retarget-based stacking mechanism the fleet grows. |

## Consequences

### Positive

- A false signal explains itself where it appears, instead of requiring
  re-diagnosis by whoever finds it next — the per-incident cost drops from
  `O(agents who encounter it)` toward `O(1)`, which is the actual spend lever
  this ADR is pulling.
- New call sites get a checklist and (from Phase 2 on) a CI gate instead of
  needing to have independently read `purser.ts`'s comments to discover a
  convention that was never enforced anywhere else.
- Phase 0's audit is valuable on its own even if later phases stall — this
  session's experience is that looking for one instance of this pattern
  reliably finds more.

### Negative

- Phase 0 touches every ship/check-completion call site in two apps — a real,
  one-time reading cost, not free.
- Phase 2 adds one more required check. A poorly-tuned version of it becomes
  its own source of false positives, exactly the failure mode this ADR exists
  to prevent — it needs the same care that went into
  `adr-number-collision-guard.mjs`'s design, not a quick regex.

### Neutral

- This ADR does not reduce how often infrastructure fails (CUDA-OOM, deadlocks,
  dead-lettered jobs) — it only makes failure legible when it happens.
  Root-causing each new failure mode remains separate work; this is about
  making sure the *next* one costs one diagnosis instead of ten.
