# 0121. Helmsman — the autonomous roadmap execution agent

## Status

Proposed (2026-08-22)

- **Roadmap:** `helmsman-charter`
- **Companion:** `docs/proposals/pd-helmsman.md` (program narrative),
  ADR-0122 (merge authority), ADR-0123 (issue lifecycle), ADR-0124
  (control ingress + consent transport)

## Context

Port Daddy has every organ of autonomous execution and no chartered consumer
connecting them. The dispatch worker (`lib/dispatch/worker.ts`) drains its
queue server-side, but the queue is operator-filled. `pd roadmap pop`
(ADR-0033/0034) claims atomically, but nothing autonomous calls it. The
WorkIntent funnel (ADR-0095) is the sole governed launch primitive, but its
`schedule` source kind has zero producers and the WorkPlanner does not exist.
The gap is explicitly deferred in `docs/proposals/pd-nightshift.md`
("self-driven backlog scanning … a future loop"), ADR-0116/0117 (deferred
tracker intake), and ADR-0119 (triggers frozen at `declared`). Meanwhile the
roadmap table holds 103 simultaneous "now" items — status without an
executor decays into an inbox.

ADR-0046 phase 6 already accepted the destination — "the avatar autonomy
loop: a roadmap item driven end-to-end, each step `pd attest`-gated and
HiTL-surfaced." This ADR charters the agent that walks that loop, and pins
its acceptance test to phase 6's so the two programs converge.

## Decision

### The agent

**Helmsman** is a singleton durable agent (ADR-0119 profile;
`backendPreferences: ['cli:claude-code']` as its identity anchor) whose sole
remit is: select shaped roadmap items, claim them atomically, drive them
through dispatch, and surface everything the operator must decide.

- **Reads** `roadmap_items` only. Issues never enter its read set (ADR-0123);
  binder prose enters only as milestone slugs with `source_refs: binder:*`.
- **Eligibility**: `status='now'` ∧ dependencies done ∧ `execution_json`
  present (checkable `acceptanceGate`, `budgetUsd`, `class`) ∧ not on the
  never-list. Rank = seven-lens focus score × binder weight (1.5 for
  `binder:*` source refs — soft, never a hard filter) − switch tax.
- **Claims** via `POST /cartographer/roadmap-pop` with eligibility pushed
  into the pop predicate — no double-claim against humans, by construction.
- **Executes** via `pd dispatch propose` (`merge_policy: 'review'`) into the
  existing worker. Dispatch is already a fail-closed WorkIntent projection
  (`captureDispatch`), so this adds no launch verb and no independent state.
  **Migration trigger:** when the WorkPlanner lands
  (`workintent-dispatch-intake`), Helmsman switches to direct
  `WorkIntentService.create` with `source.kind: 'schedule'`, becoming that
  source kind's first producer.
- **Backend pin:** every Helmsman dispatch passes an explicit
  `backend: 'cli:claude-code'` override — the only backend whose squid
  adapter is `verified=true` and whose interrupt/steer verbs are enforceable
  (ADR-0124). Squid injection is refuse-to-spawn for Helmsman-class
  dispatches ("no harness, no autonomy"), prechecked at sortie-plan time via
  `pd squid status`. The global dispatch default is untouched.

### The trust ladder

| Rung | Behavior | First entry | Re-entry after demotion | Demotion (automatic, immediate) |
|---|---|---|---|---|
| H0 | propose-only: daily sortie plan, ≤3 eligible items + top-3 near-eligible with the missing field named, per-item approve/modify/reject via the ADR-0124 consent card | charter lands | — | — |
| H1 | auto-propose into dispatch; PRs under `merge_policy:'review'` | operator command, after 10 clean H0 approvals (≤1 modify) | 10 clean H0 receipts since demotion auto-promote | reverted PR, budget breach, red adversarial verdict → H0 |
| H2 | `merge_policy:'auto'` for bounded classes (docs-only, tests-only, roadmap-sync) through `lib/dispatch/auto-merge.ts` + never-list | operator command; requires 10 clean H1 receipts ∧ WorkPlanner landed ∧ ADR-0122 merged ∧ steer verb live | 10 clean H1 receipts since demotion auto-promote | any auto-merged revert → class removed, back to H1 |

The first promotion to each rung is an explicit operator command; thereafter
clean-receipt counts auto-promote on re-entry (operator decision,
2026-08-22). Every promotion and demotion writes an inbox note and a focus
receipt. Helmsman never invokes a merge itself at any rung — it sets
`merge_policy`; landing belongs to ADR-0122's authorized paths.

### Budgets and kill switches

H1 defaults: $2/dispatch, $10/day, 2 in flight, 2 open PRs, 1 pop/tick,
hourly tick. Cap breach → self-demotion + inbox note. Kill:
`pd fleet down helmsman`; `helmsman.enabled` daemon flag checked at tick
start; the dispatch never-list; the human-only ruleset admin bypass. H0
approvals stale >7 days → self-pause (no nagging), paged `high`.

### The escalation contract (normative)

Disposition is a pure function, adopted from ADR-0085: auto-proceed with
anything mundane at the granted rung; **escalate iff** duplicate (overlaps an
in-flight dispatch or claim) ∨ clash (file-claim or roadmap-dependency
conflict) ∨ high-impact (irreversible class, cost above cap,
never-list-adjacent) ∨ low-confidence (missing `execution_json` field,
unverifiable acceptance gate).

Delivery rides the shipped relay interruptions ladder with this urgency
mapping: **critical** = in-flight dispatch blocked awaiting a human, or a
budget-breach stop (blocks dependent new work); **high** = staleness
self-pause imminent, automatic demotion fired; **normal** = sortie plan
awaiting decision, `review_pending`; **low** = receipts digest. Helmsman
never files a critical for a proposal — mayday-red is reserved for in-flight
blockage (ADR-0046's HiTL-bar rule).

### One decider (doctrine D6)

Exactly one operator identity holds Helmsman's promotion, demotion, and
never-list authority. In a shared X2 harbor, co-members may see Helmsman's
receipts (once `relay-client-wiring` lands); command authority transfers only
by the Helm and its succession rules — never implicitly. Helmsman v1 is
single-operator, single-machine, local-daemon, stated plainly.

## Consequences

### Positive

- The roadmap gains its first chartered consumer; "shaped and now" finally
  means "will be worked."
- Shaping (`execution_json`) becomes the gate to autonomy — the incentive
  that converts the 103-item inbox into an ordered plan.
- The compat path is temporary by contract: H2's WorkPlanner gate makes
  autonomy scale-up fund the governance layer.
- ADR-0046 phase 6 and Helmsman H2 share one acceptance test; the two
  autonomy programs converge.

### Negative

- Day-one eligibility is deliberately near-empty; Helmsman's early value is
  the sortie plan's pressure to shape items, not throughput.
- Pinning to `cli:claude-code` concentrates autonomy on one vendor loop until
  `codex-squid-verification` lands.
- Riding dispatch-compat inherits its known gaps (not Conductor-routed,
  Coordination Guard disabled in dispatch worktrees) until the WorkPlanner
  migration.

## Rejected alternatives

- **Wait for the WorkPlanner.** Gates the whole program on an unowned backlog
  item; the compat path is already a governed WorkIntent projection.
- **Read GitHub issues directly.** Violates the binder ch23 rail rule; issues
  are exhaust until mined (ADR-0123).
- **Hard binder-only selection.** Starves H0/H1 of clean receipts exactly
  when the ladder needs them; the 1.5× weight can be raised by operator
  command once binder milestones are shaped.
- **Autonomous promotion from day one.** The first climb of each rung is an
  operator decision; only re-entry after demotion auto-promotes.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| P0 | helmsman-charter | now | — | This ADR + the pd-helmsman proposal land; Helmsman durable profile registered |
| P1 | helmsman-h0-sortie-plan | backlog | helmsman-charter, roadmap-now-triage, roadmap-schema-wiring, approval-stream-four-state | Daily sortie plan as a four-state consent card on the approval stream; near-eligible surfacing; focus receipt |
| P2 | helmsman-h1-dispatch | backlog | helmsman-h0-sortie-plan, control-command-ingress | Auto-propose into dispatch with claude-code pin, squid injection-or-refuse, budgets, self-demotion |
| P3 | helmsman-h2-bounded-automerge | backlog | helmsman-h1-dispatch, workintent-dispatch-intake, review-retry-contract, merge-authority-reconciliation | Bounded auto-merge classes via the shared auto-merge gate; acceptance test = ADR-0046 phase 6's gate |

## References

- `docs/proposals/pd-helmsman.md`
- ADR-0023, ADR-0033/0034, ADR-0035 (dispatch), ADR-0045, ADR-0046,
  ADR-0085, ADR-0095, ADR-0109/0122, ADR-0118, ADR-0119
- `lib/dispatch/worker.ts`, `lib/dispatch/auto-merge.ts`,
  `lib/agent-harbor/work-intent-service.ts`, `lib/roadmap-items.ts`
