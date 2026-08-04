# The Steward — bounded auto-landing for fleet-authored PRs

> "Can we have an agent who accepts and merges and responds to feedback?"
> — the operator, 2026-08

Yes. This document is the safety argument for why that is not reckless, and an
honest list of what it deliberately does not do.

Code: `apps/fleet-executor/src/steward.ts`.
Tests: `apps/fleet-executor/tests/steward.test.ts`.

---

## 1. The deadlock it was built alongside

The purser opens a test PR on `purser/pr-<n>-tests` and then **retargets the
reviewed PR onto that branch**. The reviewed PR therefore merges *through* the
test PR.

But the repo's PR gates are written for human-authored PRs. A machine-generated
body has no `## Summary`, no `## Test Plan`, and no `Roadmap-Item:` trailer, so
every purser test PR came out `mergeable_state: blocked` with
`needs-roadmap-link` and `needs-comment-replies`. Because the reviewed PR was
stacked on top of it, **a blocked test PR meant the reviewed PR could never
merge either.** The purser manufactured a deadlock for every PR it reviewed
(observed on #4792 → #4763).

The escape hatches already existed and were simply unused. `src/fleet-pr-body.ts`
now emits all three, with specific reasons rather than a blanket "bot":

| Gate | Marker | Reason emitted |
| --- | --- | --- |
| `scripts/check-pr-requirements.mjs` | `<!-- pr-requirements-exempt: … -->` | body is machine-generated to a fixed contract; the human template's Test Plan / Visual Proof sections describe work this branch does not do |
| `scripts/check-pr-comments-answered.mjs` | `<!-- pr-comments-exempt: … -->` | no human authored this, so the "author answers reviewers" duty has no addressee; the reviewed PR is where discussion belongs |
| `lib/roadmap-link-core.ts` | `Roadmap-Item: none — …` | this branch advances no roadmap item of its own; the item belongs to the reviewed PR, and claiming it here would double-count the work |

No gate was weakened. `tests/fleet-pr-body.test.ts` runs the **real**
`check-pr-requirements.mjs` as a child process against the body the purser
**actually generates**, and feeds that same body to the real `hasExempt` and
`classify` implementations — so the syntax cannot silently drift out of what the
guards parse.

---

## 2. The fleet does not review its own branches

`src/fleet-identity.ts` answers one question: did this fleet author this PR?

**Identity first, branch name second, never branch name alone.**
`pull_request.head.ref` is attacker-controlled — anyone with push access can open
a PR from a branch named `purser/pr-1-tests`. So:

- the author must be a **Bot** (a human never matches, whatever they name their branch);
- and must equal this App's own login, resolved via `GET /app` under our own App
  JWT and cached in KV — a value no PR can influence.

When the App login cannot be resolved, the classifier returns the weaker
`bot-and-branch` signal **and labels it weak**. The two callers then diverge
deliberately: the review skip accepts it (cost of being wrong: one unreviewed
machine branch), the steward **refuses** it (cost of being wrong: merging
someone else's PR).

On a fleet-authored PR the executor completes the required `Port Daddy Fleet`
check as `neutral` with `"fleet-authored branch — not self-reviewed"` and runs
**zero** ships. It must complete the check rather than return silently: an absent
or hanging required check blocks the branch forever (the 2026-07-16 pause
incident).

---

## 3. The safety argument

The steward merges only if **every one** of these holds:

1. **Opt-in** — the tenant's `pd-fleet.yml` on the **trusted default branch**
   sets `steward: true`. Off by default; same idiom as `xo:` and `squidEvents:`.
2. **Not paused** — `fleet:paused` in `CONTROL_KV`. An *unreadable* switch counts
   as paused. This inverts the reviewer's fail-safe default on purpose: a review
   that cannot read the switch should still gate; a merger that cannot read it
   must not merge.
3. **Fleet-authored on the strong signal** — `app-identity` only.
4. **Open, not draft.**
5. **No guardrail self-modification** — refused loudly for any diff touching
   `.github/workflows/**`, `scripts/check-pr-*.mjs`, `cli/permission-tiers.ts`,
   or the steward's / identity module's own source. There is no override flag.
   *An agent that can edit the rules binding it is not bound by them.*
6. **Every reported check conclusively green** — not red, not pending. Branch
   protection is not readable to us, so rather than guess at which checks are
   *required* we demand that **all** reported contexts be terminal and
   non-failing. Zero checks reported is a **refusal**: silence is not evidence of
   health. An unrecognized future conclusion counts as failing.
7. **Mergeable** — `UNKNOWN` is a refusal; the steward does not merge on a maybe.
8. **No outstanding CHANGES_REQUESTED review.**
9. **No unresolved review thread.**
10. **Under the rate limit** — ≤2 merges per sweep (hard, in-memory, unraceable)
    and ≤4 per hour (KV budget; an unreadable budget reads as *spent*).

Every refusal carries a machine code and a sentence of prose in the D1
transcript. If a precondition cannot be *determined*, the steward does not merge
and says which fact it could not establish. There is no "assume green" path.

### The gate is deterministic code

**No model output may decide a merge.** This is enforced structurally, not by
convention: `evaluateMerge` and everything it calls (`guardrailFilesIn`,
`partitionChecks`) are **synchronous pure functions**. A synchronous function
cannot await a network call, therefore it cannot consult a model — the guarantee
is visible from the signature alone. The tests assert none of them is an
`AsyncFunction`, then exercise **every precondition violation independently**
against an `env.AI` binding that throws if touched.

Workers AI is used in exactly one place: drafting the *prose* of a dispute reply.
A model judgment of "this objection isn't substantive" can only **add** a reply
obligation — it can never subtract a block. What blocks is the count of
unresolved, non-outdated threads, computed from GitHub's own resolution state.

### Assertions live at the write site

`mergeFleetPr`, `updateFleetPrBranch`, and `refreshFleetPrBody` all re-assert
fleet authorship and the guardrail hard stop **immediately before the network
call**, via a shared `assertFleetWriteAllowed`, and throw otherwise. A
precondition enforced only at the caller is one refactor from being enforced
nowhere. The merge is additionally pinned to the evaluated `sha`, so a
concurrent push turns it into a 409 rather than merging a diff we never examined.

---

## 4. Disputes

The purser's own body says: *"Dispute a test here, with reasons, if it misreads
the contract."* Honoring that is a duty.

When a human raises a substantive dispute and the fleet has not answered, the
steward replies on the thread — conceding the test is wrong, or explaining the
obligation it enforces. It then **still refuses to merge**. Replying does not
clear a dispute; a machine that answered its own objection and merged would be
overruling the human with extra steps. Only a human resolving the thread clears
it. Once the fleet has spoken last, it does not reply again, so a 15-minute cron
cannot spam a thread.

---

## 5. Freshness (added 2026-08)

> "do you automatically update PRs?"

Now, for the fleet's own PRs only, under the same envelope:

- **Branch** — when a fleet PR is behind its base and merges cleanly, the steward
  performs GitHub's update-branch, pinned to the evaluated head sha. **A conflict
  is a refusal, not a task**: it is reported and left for a human. The steward
  never guesses at a conflict resolution.
- **Body** — after it pushes, it appends an honest line to an append-only
  `<!-- steward-changelog -->` log rather than rewriting prose. Additive beats
  revisionist. Every entry starts with `- ` so none can masquerade as a
  `Roadmap-Item:` trailer and steal "last trailer wins" from the real opt-out —
  a property the tests verify by re-running the real guards on a logged body.
- It **never** edits a human's PR body. That is their words.

Updating ends the pass: the commit every precondition was evaluated against no
longer exists, so the next sweep re-derives everything. Separate budget: ≤3 per
sweep, ≤8 per hour.

---

## 6. Where it runs, and on what

**Cloudflare primitives only. No Anthropic API, no `@anthropic-ai` SDK, no
`claude-*` model id, no Claude Code, no GitHub Actions agent, no external
runner.** It works at 3am with nobody awake and no session anywhere.

| Concern | Primitive |
| --- | --- |
| Runtime | the `fleet-executor` Cloudflare Worker |
| Scheduling | **Cron Trigger**, `*/15 * * * *` (`scheduled()` in `src/index.ts`) |
| Candidate registry | **KV** (`steward:cand:<owner>/<repo>#<n>`, 7-day TTL) |
| Rate-limit budgets | **KV** hourly buckets |
| Audit trail | **D1** (`fleet_run_steps` via `StewardSweepTranscript`) |
| Identity / tokens | **KV** installation-token + App-login cache |
| Reply prose | **Workers AI** `env.AI`, `@cf/` ids only |

`STEWARD_MODEL` is config-swappable exactly like `XO_MODEL`: `resolveStewardModel`
honors only a `@cf/` id, so a foreign id cannot route inference off Workers AI.

**Why the executor and not the relay:** the executor is the only component that
already holds all four things a merger needs — the App identity and token cache,
the `CONTROL_KV` kill switch, the trusted-branch `pd-fleet.yml` read, and the D1
transcript. Putting merge authority in the relay would duplicate all four into a
second Worker: two places to get the safety argument right instead of one.

**Why a cron and not the webhook path:** merging requires *waiting*. At
`pull_request:opened` every check is pending, so a webhook-only steward could
never satisfy its own "no pending checks" precondition — it would be structurally
incapable of ever merging.

---

## 7. What is NOT automated

Stated plainly, because the gap between what this does and what a reader might
assume it does is where trust gets lost.

- **Conceding a dispute in code.** When the steward decides a test is wrong, it
  says so in the thread — it does not push a commit removing or fixing the test.
  The Git Data machinery to do so exists in `src/stacked-pr.ts`; wiring it up is
  a deliberate follow-up, because "a machine rewrote its own test after a human
  objected" deserves its own design review.
- **Conflict resolution.** Refused and reported, never attempted.
- **Merging human PRs.** Never, by construction.
- **Merging anything touching the gates.** Never, with no override.
- **Enumerating *required* checks.** We cannot read branch protection, so we
  require all reported checks green — stricter, but it means a repo with a
  perpetually-pending optional check will never auto-merge. That is the correct
  failure direction, not a bug.
- **Resolving review threads.** Only humans resolve threads.
- **Dispute classification by model.** Currently a keyword-and-length heuristic.
  It will miss a politely phrased objection that uses none of its markers — a
  miss that costs a *reply*, never an unnoticed block, since any unresolved
  thread blocks regardless.
- **Cross-sweep coordination.** The hourly KV budget is eventually consistent and
  can undercount under concurrent sweeps. It is a budget, not a lock; the hard
  bound is the per-sweep cap.
