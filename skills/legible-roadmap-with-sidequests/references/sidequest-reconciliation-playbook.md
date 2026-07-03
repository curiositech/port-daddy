# Sidequest Reconciliation Playbook

Use this when you need to protect ADHD-driven momentum on real,
energy-triggered work while stopping that work from becoming invisible or
letting the product's through-line rot.

## Sidequests are legitimate, not a compliance failure

An ADHD operator's real, valuable bursts — console hardening, a migration
that was bugging them, a tooling fix — routinely land outside the current
roadmap phase. The port-daddy `MEMORY.md` energy-signal note from June 18–23
names this directly: a burst of console UI hardening (ADR-0060), a release
workflow, and a Jira migration proposal, all outside the active V4 phases,
all real and shippable. The wrong response is to force each of those through
full phase planning before the operator is allowed to start — that kills the
exact momentum that made the work happen at all, and the predictable result
is the operator routes around the system entirely (working in an
unaccounted branch, not writing it down, losing the receipt). The right
response: let the sidequest run now, attach the lightest possible
link/opt-out at start or end, and reconcile later.

## The three-gate ladder for a sidequest

1. **Start gate (near-zero cost).** Before or immediately after starting,
   assign an `id` and either a `roadmapLink` (if it obviously maps to an
   existing item) or an `optOutReason` (one sentence: "energy burst, not a
   phase deliverable, tracked under ADR-0060"). This is the entire cost paid
   at momentum time. If this step feels heavy, the tooling around it is
   wrong, not the operator.
2. **Spawn-capture gate (at completion).** Before closing it out, ask: did
   this generate new durable work? If yes, create roadmap items (or
   opt-outs) for each one — don't let "I'll get to that" survive past the
   session. This is the single highest-leverage moment: spawned work that
   isn't captured within the same sitting has a half-life measured in days.
3. **Reconciliation gate (periodic, scheduled).** On a cadence
   (`reconciliationCadenceDays`, default policy max 14 days), review every
   sidequest done since the last reconciliation:
   - Confirm each still has a link or opt-out (gate 1 didn't get skipped).
   - Confirm spawned work was captured (gate 2 didn't get skipped).
   - Ask whether the sidequest pattern reveals a real parallel track that
     deserves its own named lane in the roadmap (the port-daddy cartographer
     called this the "Operator Tooling Arc" — console, planner,
     distribution, accounts — after three sidequest bursts in one week
     pointed the same direction). A recurring sidequest theme is a
     roadmap-phase candidate, not a permanent side channel.

## Decision table: fast-link vs. park vs. escalate

| Situation | Action |
| --- | --- |
| Sidequest obviously advances an existing roadmap item | Fast-link now: `roadmapLink: <slug>`, done in one line. |
| Sidequest is real but doesn't map to any item | Opt-out now with a one-sentence reason. Do not block on finding/creating the "right" item mid-flow. |
| Sidequest reveals 1-2 follow-on tasks | Capture them as roadmap items at completion (gate 2). |
| Sidequest reveals a recurring theme (3rd occurrence, same shape) | Escalate at the next reconciliation: propose a named phase/track, not another one-off opt-out. |
| Reconciliation finds >20% of recent work units untracked | Treat as a legibility incident — stop new sidequest starts until the backlog of untracked units is cleared, then resume. |

## Protecting the through-line without becoming a cage

Two failure directions, and this skill has to guard against both at once:

- **Rigid cage**: every sidequest routed through full roadmap grooming
  before it's allowed to start. Diagnostic: sidequests stop appearing in the
  audited work-unit log entirely, while ad-hoc commits keep landing outside
  it — the operator has gone underground.
- **Ignored wishlist**: the roadmap exists but nobody checks work against
  it; status is reported from memory/optimism; sidequests never get folded
  back. Diagnostic: `legibilityScore` trending down over successive
  reconciliations, or `status-without-evidence` findings recurring on the
  same items reconciliation after reconciliation.

The reconciliation cadence is the single mechanism that prevents both: it's
cheap enough per-sidequest (one line, once) that it doesn't slow momentum,
and frequent enough (≤14 days by default) that drift gets caught before it
compounds into either failure mode.

## Running a reconciliation pass

1. Pull every work unit closed or touched since the last reconciliation.
2. Run `node scripts/roadmap_legibility.mjs --input <state>.json` against
   that window.
3. For every `critical`/`high` finding, fix the work unit's record (add the
   missing link/opt-out, capture the missing spawn, attach the missing
   evidence) rather than editing the audit's judgment.
4. For a recurring `spawn-not-captured` or the same `id` failing repeatedly
   across reconciliations, treat it as a process signal: something about how
   that class of sidequest gets started is skipping gate 1 or 2.
5. Re-run the audit until `pass: true`, then set the next reconciliation
   date. A reconciliation that ends without a pass is a debt carried
   forward, not a stopping point — say so explicitly in the reconciliation
   note.
