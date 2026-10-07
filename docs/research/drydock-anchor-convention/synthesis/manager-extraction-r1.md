# Manager extraction — synthesis round 1

**Status:** `T0_STATIC / SYNTHESIS_ONLY`
**Repository anchor:** `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`
**Exact manager input digest:** `sha256:c6f93a365ed7b69d638b544ce6660aee7b1bd195877d212754e03c0b652e6c26`
**Input count:** 31 files
**Digest algorithm:** sorted `path + NUL + content + NUL`

The repository anchor identifies source inspected by the papers. The input digest
identifies the then-current convention records synthesized here. Later audits
and corrections are not retroactively part of this extraction. No claim below
upgrades `PROPOSED`, `UNKNOWN`, or `BLOCKED_BY_HALT`.

## Consensus kernel

Consensus means reciprocal acceptance or independent convergence, not a truth
score.

1. **Static proof is bounded.** Schemas, fixtures, validators, signatures,
   diagrams, and reviews establish only their static properties. They do not
   prove containment, execution, provider behavior, accessibility, or operator
   control. Dynamic claims remain `BLOCKED_BY_HALT`.
2. **Containment and settlement are separate authorities.** An effect broker may
   deny or terminate effects but cannot grade work, suppress evidence, slash
   collateral, or settle payment.
3. **Settlement evidence is typed.** Every criterion names admissible evidence
   and minimum witness class. Signatures, Merkle inclusion, panels, or guest
   claims cannot alone prove completion, breach, custody, or entitlement.
4. **Provenance and evaluation are orthogonal.** Independently committed raw
   evidence needs an evaluation envelope naming proposition, subject, oracle,
   schedule, faults, negative controls, and coverage.
5. **No decisive self-witness.** Simulator, scheduler, controller, worker, or UI
   cannot seal its own decisive evidence and issue its own terminal verdict.
6. **Context preparation is not successor admission.** A context steward may
   prepare typed context, omission, translation, and obligation evidence. The
   lifecycle writer alone admits after independent fence, effect, and capacity
   receipts.
7. **Truth is not directive authority.** A verified fact, authentic transcript,
   or historical operator intent remains data unless a current, audience-bound,
   revocation-checked envelope authorizes instructional use.
8. **Scheduling and capacity join serially.** Structural eligibility → committed
   native-unit reservation → consumed execution lease → durable dispatch intent.
   Controller and broker cannot invent each other's state.
9. **Capacity follows every attempt.** Lease, renewal, elastic slot, rework,
   model-consuming gather, and provider call each have a live reservation and
   terminal settlement, release, or explicit ambiguity hold. A plan grant is
   only a ceiling.
10. **Human assent is not a permit.** Intent capture, review, approval assertion,
    adjudication, permit issuance, redemption, execution, and witnessing are
    distinct events.
11. **Machine-exact authority needs human-semantic binding.** An immutable,
    accessible operator review envelope states consequential semantics,
    unknowns, capacity, use count, and expiry. It records what was presented and
    cannot itself execute anything.
12. **Ambiguity is durable.** Unknown external effects block repeat authority and
    capacity reuse until independently reconciled. Compensation is a new effect.

## Open conflicts and impossible combinations

| Conflict | Rejected combination or live alternatives | Disposition |
|---|---|---|
| Settlement profile | Mandatory bounty/bond/salvage/dispute escrow for every activity versus a zero-money profile for inert, emergency, public-interest, or T0–T2 work | Open; preserve zero-money dissent |
| Terminal evidence | One synthesized verdict versus a typed result vector that retains heterogeneous disagreement | Open; do not hide subordinate results |
| Successor under ambiguity | Block every successor versus permit a fenced cognition-only successor with no effect authority | Open proof obligation |
| Body exclusivity | Overlapping authority is rejected. One body is current safe default; multiple bodies require independently fenced disjoint partitions | Default one; future alternative unproved |
| Capacity/controller join | Reservation-commit/lease-consumption protocol versus tiny shared transactional nucleus | Open implementation choice |
| Operator attention | Invented fungible minute forecasts versus qualitative pending-count and interruption-rate limits | Start qualitative |
| Operator bypass | “No operator override” cannot eliminate Stop, freeze, quarantine, and fail-safe refund while still forbidding unilateral payout/slash | Preserve emergency containment |
| Guest evidence | Sole guest witness rejected; corroborative guest evidence remains possible | Open policy |
| Partial gather | A semantic gather may close while absent-child capacity remains held | Keep state split |
| Human approval | Direct digest-to-execution grant versus approval assertion followed by independent adjudication and redemption | Direct grant rejected |
| Deterministic evidence | One kernel schedules, seals, minimizes, verifies, and adjudicates versus separated scheduler/witness/recorder/oracle/adjudicator | Self-certification rejected |

## Correction tickets

Each author gets one disposition: `ACCEPT`, `REJECT` with contrary evidence, or
`CLARIFY` without broadening scope.

| Ticket | Position | Narrow request |
|---|---|---|
| C-P1 | P1 | Add atomic `SETTLEMENT_HANDOFF`; broker cannot grade, slash, suppress, or settle. |
| C-P2 | P2 | Require `evaluationEnvelopeRef` for simulation, test, model, replay, shadow, and canary claims. |
| C-P3 | P3 | Only current guidance authority affects framing/tools; verified facts remain cited data. |
| C-P4 | P4 | Bind every lease, renewal, elastic slot, rework, and consuming gather to node-attempt reservation and terminal disposition. |
| C-P5 | P5 | Bind `OperatorReviewEnvelopeV1` to proposal and approval as non-authoritative presentation evidence. |
| C-P6 | P6 | Issue single-use `ReservationCommit`; broker never schedules; controller consumes before lease. |
| C-P7 | P7 | Split `PrepareContinuation` from lifecycle-owned `AdmitSuccessor`. |
| C-P8 | P8 | External recorder commits pre-minimization trace; independent adjudicator issues verdict. |
| C-P9 | P9 | Name witness classes per criterion, use `UNSETTLED` on disagreement, and keep settlement keys outside guest. |
| C-P10 | P10 | Approval attests once but is non-executable; controller alone accepts/redeems permit after adjudication. |

## Cross-component linearization points

All remain `PROPOSED` and dynamically `BLOCKED_BY_HALT`.

| Seam | Required ordering |
|---|---|
| Intent → consent | Commit immutable proposal and review-envelope digests before approval assertion; mutation invalidates assent. |
| Plan → eligibility | One plan digest/revision determines frontier; workers cannot enlarge it. |
| Eligibility → capacity | Broker atomically commits one reservation bound to revision, node, attempt, generation, route, resource vector, expiry, and idempotency. |
| Capacity → lease | Lifecycle controller consumes that reservation exactly once before lease creation. |
| Predecessor → successor | Fence → effect high-water reconciliation → context preparation → successor lease. |
| Context → admission | Steward emits capsule + nonce; lifecycle writer alone consumes after fence/effect/capacity receipts. |
| Approval → permit | Assertion → adjudicator decision → controller atomic redemption → channel release. |
| Dispatch → ambiguity | Durable intent precedes transmit; lost response becomes `AMBIGUOUS`, never automatic retry/release. |
| Evaluation → evidence | External witness/recorder commits raw manifest and trace before minimization or oracle change. |
| Evidence → verdict | Independent adjudicator derives bounded result from admissible witnesses and exact evaluation envelope. |
| Child → gather | Membership/policy sealed before execution; semantic partial closure cannot release absent-child resources. |
| Termination → settlement | Effect authority closes and settlement handoff becomes independently accessible before payout/slash/refund/reputation. |
| Cancellation → release | Request, acknowledgement, fence, process/VM termination, provider reconciliation, and capacity release remain distinct. |

## Skill decision map

### Supplant in place

- `provable-action-adjudicator`: absorb consequential-effect authority; never
  claim complete mediation from policy verification.
- `swarm-invocation-designer`: absorb hypertree admission/gather; controller-
  owned invocation, capacity, fences, reducer, cancellation, and replay.
- `agent-context-partitioner`: proposal-only partitioning over already admitted
  bodies; no context-compiler or birth authority.
- `productive-discourse-facilitator`: bounded peer discourse with closed
  terminals, evidence/crux maps, and durable dissent.

### Patch existing owners

- `sandboxed-adversarial-test-harness`: mediation graph and bypass corpus.
- `agent-resurrection-and-body-continuity`: effect high-water mark, stale fence,
  lost acknowledgement, cognition-only-successor cases.
- `agent-work-receipt-designer` and `focus-receipt-proof-gate`: field-level
  witness admissibility, raw evidence custody, evaluation-envelope references,
  and `UNSETTLED`/`INCOMPLETE`.
- `drydock-program-architecture`: human-factors activation and review-envelope
  routing.
- `pilot-hypertree-execution`: consume, not duplicate, the invocation contract.

### Create only three distinct missing skills

1. `conserved-capacity-admission-and-settlement`: native-unit conservation and
   stop reserves; cannot schedule nodes.
2. `trust-typed-context-compiler`: Context IR, obligation coverage, authority
   channels, translation, forgetting, and omissions; cannot fence/admit bodies.
3. `trial-basin-deterministic-systems-evaluation`: schedules, faults, replay,
   oracle mutation, counterexamples, and fixture promotion; cannot certify
   containment or authorize canaries.

Defer standalone fork-accountability until multi-publisher/cross-harbor scope is
admitted. Preserve legal, tax, custody, labor-status, and moral-status questions
for accountable external authorities rather than manufacturing a generic skill.

## Reality-check input contract

Fresh Engineering, Product, and Design beats receive corrected or explicitly
rejected positions, all reviews, this extraction, source/research records, and
skill audits. The packet is rehashed after corrections.

Engineering must answer buildable dependency spine, durable write/key ownership,
transactional nuclei versus commit protocols, crash/duplicate/reorder/lost-ack
fixtures, static work under halt, skill sequencing, and architecture-blocking
alternatives. It cannot upgrade source to installed or static to dynamic.

Product must answer first safe operator job, deliberate exclusions, user promise
across all stages, zero-money profile, accountable legal/labor gates, and demand/
retention/trust evidence. It cannot assert market, pay legality, beneficial
ownership, moral status, or live custody without evidence.

Design must distinguish capture, recommendation, review, assent, adjudication,
permit, execution, acknowledgement, enforcement, and settlement; define review-
envelope fields; prove selection noninterference; expose unknown/ambiguous/stale/
fenced/blocked/partial states; visualize the entire Stop sequence; and specify
keyboard, screen-reader, scaling, motion, target, and teach-back tests. Mockups do
not prove operability or enforcement.

## Stop conditions

Stop if the anchor/input digest changes without resealing; a correction creates
a role, second correction, runtime action, or new authority; a conclusion rests
only on a quarantined skill; any role upgrades truth state; the manager reviews
its own new position; a witness is replaced by vote count; reality checks start
before correction dispositions and reseal; or a ship condition becomes fatigue.

## Retained dissent

- Zero-money work may be necessary before funded settlement.
- Operator Stop/freeze/quarantine/refund survives “no operator bypass.”
- Panel diversity is not witness independence; guest evidence may corroborate.
- Semantic observation projection and protected fixture retention remain open.
- A result vector may be more honest than one green verdict.
- Anchor custody and Trial Basin challenge adequacy do not subsume each other.
- A cognition-only successor may reconcile an ambiguous effect.
- Failed pre-activation births need not consume the sole successor generation.
- Obligations may transfer without transferring personhood.
- Disjoint effect partitions remain a future proof obligation.
- Operator attention starts qualitative.
- Ambiguous holds need explicit wait/reconcile/release/quarantine and no expiry.
- Semantic partial gather and resource settlement remain separate.
- `K` is vector feasibility, not scalar capacity.
- T0 HOLD remains; no UI, signature, receipt, or Phase-0 verifier promotes it.
