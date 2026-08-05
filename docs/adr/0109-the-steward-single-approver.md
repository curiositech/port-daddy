# 0109. The Steward — one agent responsible for review, landing, and background improvement

## Status

Accepted

## Context

Port Daddy spawns dozens of agents. They open PRs in parallel. Today nobody
*owns* the path from "PR is open" to "PR is merged and the codebase is better for
it." The work is scattered across surfaces that do not see each other:

- **Per-PR review ships** (`fleet/ships/code-reviewer.md`, `red-team.md`,
  `tautology-sniffer.md`, `test-author.md`, `tenderfoot.md`) each post one
  comment and stop. None of them respond to the operator, drive a PR to green,
  or decide to merge. They are *finders*, not an *approver*.
- **The Harbormaster** (`lib/harbormaster.ts`; the fleet snippet
  `fleet/harbormaster.yml` is not yet merged into `pd-fleet.yml`) merges a single
  dispatch *after the operator accepts it* (`dispatch:accepted`). It is a
  merge-executor for one accepted unit of work — not a roadmap-aware gate over
  every open PR.
- **The Harbor-Pilot** (`apps/github-app-fleet/bin/harbor-pilot.ts`, fleet ship
  `harbor-pilot`) is *mechanical* PR custody: a deterministic, unit-tested body
  that arms merge-when-ready on non-draft PRs, demotes PRs whose diff already
  landed, and flags conflicts. It owns the calls a rule can make — not the
  judgment calls (is the review satisfied? are the bot comments answered? is this
  the right thing to build next?).
- **The Officer-of-the-Watch** (`fleet/ships/officer-of-the-watch.md`) reads the
  logs nobody else reads and escalates; it *reports, it does not repair* and never
  touches PRs.
- **The Cartographer** (`routes/cartographer.ts`, fleet ship `cartographer`)
  reads roadmap markdown and renders state. The companion design
  `docs/architecture/2026-06-03-cartographer-as-approver.md` is explicit about
  the split it does **not** yet implement: *"Cartographer surfaces; the
  release-engineer ships. Cartographer raises a question and may block a PR; the
  release-engineer never raises a question, only ships."* That release-engineer
  has never been built.

The cost of the gap is recorded in operator memory
(`project_single_approver_agent.md`, the PR #20→#57 detour): multiple agents
independently regressed the same things, each "fix" a separate PR that didn't see
the others coming, roadmap intent rotting in markdown nobody read in time. The
operator's standing instruction is blunt — *"land reviewed work proactively;
review IS the gate, not a permission-ask"* (`feedback_land_reviewed_work_proactively.md`),
and *"why aren't you landing your PRs?"* The chokepoint fix the operator has asked
for repeatedly is **one responsible agent**, not better behavior spread across N
ships.

**Macaroon term** *(first use)* — a [macaroon](https://research.google/pubs/pub41892/)
is a bearer credential whose holder can only *attenuate* it (add caveats, never
remove them); Port Daddy's enforcement layer (ADR-0053) uses them so a delegated
agent cannot exceed the authority it was handed. The Steward is the natural holder
of the *land-to-main* capability: a single, auditable seat for the one action that
is hardest to reverse.

## Decision

**Introduce the Steward: one fleet ship (`fleet/ships/steward.md`, agent `steward`
in `pd-fleet.yml`) that is the sole owner of the PR lifecycle from open to merged,
and the owner of background improvement between PRs.** It is the *body* the
cartographer-as-approver design called the release-engineer; the Cartographer
remains the *soul* that surfaces questions.

The Steward's responsibility, stated as one sentence it is measured against:

> Every open PR is either merged, has an actionable next step posted in the
> operator's voice, or is surfaced to the operator as a decision only they can
> make — and between PRs, the next roadmap improvement is in flight.

### What the Steward owns (the lifecycle)

1. **Survey.** Each tick, enumerate every open PR (`gh pr list`) plus the live
   fleet (sessions, notes, file-claims) so it reviews with conflict awareness, not
   PR-in-isolation.
2. **Adversarial review.** For each PR, orchestrate the existing review ships
   (code-reviewer always; red-team on the security surface gate; tautology-sniffer
   on prose/claims) and fold their findings into one verdict. The Steward does not
   re-implement review — it *conducts* it.
3. **Respond.** Treat every bot review (Copilot, claude-review) as first-class:
   reply to each comment with a fix or a reasoned dismissal-vs-`origin/main`
   (`feedback_copilot_comments_are_reviews.md`). Never merge with bot comments
   unaddressed.
4. **Land — under hard guardrails.** Merge a PR only when **every required check
   is genuinely green** AND adversarial review passed AND it is not a
   production-site PR. The Steward greens by fixing root causes, never by
   `--admin` over red and never `--no-verify` (`feedback_always_ci_green_adversarial_review_before_merge.md`,
   `feedback_guardrails_never_advertise_bypass.md`).
5. **Surface.** Anything it cannot land safely — a real red check it can't fix, a
   production-site PR, a roadmap conflict, an ambiguity with no answer in any ADR
   or note — becomes a Cartographer-style question to the operator, not a silent
   stall.
6. **Improve.** When the PR queue is drained, advance exactly one background
   improvement: pop the next roadmap item (`pd roadmap`), or open a draft PR for a
   concrete, cited improvement. Never a speculative rewrite; always one small,
   reversible step.

### The guardrails are the load-bearing part

An autonomous agent that can merge to `main` is the highest-stakes seat in the
fleet. The Steward is defined as much by what it must **not** do:

| Rule | Source |
| --- | --- |
| Never `--admin`/`--no-verify` over a real red required check. | `feedback_always_ci_green_adversarial_review_before_merge.md` |
| Production-site PRs (marketing/website deploys) need an explicit operator "ship it." | `feedback_repo_merge_gating.md` |
| Never merge with Copilot/claude-review comments unaddressed. | `feedback_copilot_comments_are_reviews.md` |
| Refusal messages point only to the correct action, never name the bypass flag. | `feedback_guardrails_never_advertise_bypass.md` |
| Every sub-agent it spawns is push-only and worktree-isolated. | `feedback_never_dispatch_agents_without_isolation.md`, `feedback_repo_merge_gating.md` |
| Coordinate through Port Daddy continuously (claim before edit, re-read live state each tick). | `feedback_pd_coordination_continuous.md` |

### Why one agent, not the existing N ships

A single approver fixes at the chokepoint what the per-ship model fights
everywhere. The clearest case is the cross-PR conflict: when one reader holds
every open PR, a diff that collides with in-flight work on another branch is
visible *before* it lands, instead of surfacing later as a regression nobody saw
coming (the #20→#57 detour). Bot comments get answered, PRs get landed, and the
roadmap stays connected to what ships — because each is now somebody's explicit
job rather than a gap between ships. This is the `project_single_approver_agent`
vision made operational.

The Steward is the **judgment layer**, and it sits *above* the mechanical custody
that already exists. Harbor-Pilot still arms and demotes by deterministic rule;
Officer-of-the-Watch still reads logs and escalates. The Steward is what neither
can be: the one that *reads the diff*, *conducts the adversarial review*, *answers
the bots*, *decides whether it lands*, and *chooses what gets built next*. Where a
rule suffices, the Pilot keeps it; the Steward owns only the calls a rule cannot
make.

## Phasing — honest about construction cost

The full vision ("holds the *entire* roadmap, aware of *all* in-flight work,
steers agents to reserve functions not files") is a large system. The Steward
ships in phases so each phase is real, not a stub:

- **v1 (this ADR).** The lifecycle above over GitHub primitives the fleet already
  has (`gh`, the review ships, `pd roadmap`). The Steward runs as a scheduled
  singleton, lands genuinely-green non-production PRs, responds to bots, surfaces
  the rest, and advances one background improvement per drained tick. Launched and
  exercised against the live open-PR set on day one.
- **v2.** Conflict-aware review backed by the `cartographer_questions` substrate
  (the cartographer-as-approver design) so "this PR collides with in-flight work
  on `lib/foo.ts:bar()`" is a typed, surfaced finding rather than prose.
- **v3.** Function/region-level claim steering — the Steward tells agents to
  reserve symbols, not whole files, closing the loop the single-approver memo
  named as the root of the #20→#57 regressions.

## Consequences

- **Positive.** One auditable seat for the land-to-main capability. PRs stop
  stalling. Bot comments stop rotting. The roadmap stays connected to what ships.
  The operator stops having to ask "why aren't you landing your PRs."
- **Negative / risk.** An autonomous lander is a real blast radius. Mitigated by
  the guardrail table (never over red, production needs ship-it, push-only
  sub-agents) and by the Steward being a *singleton* — exactly one, easy to pause
  (`pd fleet down steward`) and easy to audit (every action is a `gh`/`pd` call in
  its transcript).
- **Reversible.** The Steward is a fleet ship. Disabling it is one command; it
  owns no schema and no daemon state of its own.

## Related

- `docs/architecture/2026-06-03-cartographer-as-approver.md` — the soul/body split
  this ADR's body half realizes.
- ADR-0053 — out-of-band enforcement; the Steward is the intended holder of the
  attenuated land-to-main macaroon when that layer lands.
- `fleet/ships/steward.md` — the Steward's full behavior contract.
- Operator memory: `project_single_approver_agent`, `feedback_land_reviewed_work_proactively`,
  `feedback_always_ci_green_adversarial_review_before_merge`, `feedback_copilot_comments_are_reviews`,
  `feedback_repo_merge_gating`.
