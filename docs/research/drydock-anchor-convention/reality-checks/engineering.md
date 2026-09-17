# Engineering beat: can this be built rigorously?

**Decision:** BUILD the static contract spine and deterministic fake-execution slices. **HOLD** every live containment, provider, cancellation, accessibility, and release claim while the local runtime halt remains in force.

This review is bound to repository object `6c2c30d74b889b4d8037ce5d43b265bfbf21a686` and the historical v1 receipt `sha256:5c3abfa1ee4d073555b5570e06a8de7fb650c93501e08241c089d6dddc493911` (43 files). That v1 receipt does **not** reproduce under the current seal script and is retained only as historical evidence; [`sealed-packet-v2.json`](../sealed-packet-v2.json) is the current reproducible packet receipt. The worktree was intentionally dirty with post-v1 skill replacements, so source claims were read from the Git object and those replacements were excluded from this historical beat.

## Reciprocal-review correction

The technical order is not the product-learning order. Before S1, no more than
two authority-bearing implementation lanes may run, but read-only interviews,
static teach-back, procurement review, and pricing discovery may proceed.
`OperatorSemanticContract` also moves into S0 so schemas cannot harden before
public wording, control authority, stale/unknown behavior, focus, and accessible
announcement semantics exist. The first economic mode is a **no-settlement
profile**; model and API usage remain visible scarcity.

## Strongest version of the proposal

A finite, sealed execution constitution can make consequential agent work inspectable by separating proposal, assent, adjudication, capacity, lease, effect, evidence, continuation, and settlement. Its most important property is negative: an unproved runtime property stays blocked instead of being promoted by confident prose, a green aggregate, or a manager waiver.

## Build truth

### Source-present foundations

- Phase 0 action adjudication is a fail-closed evidence verifier, not a reference monitor (`docs/adr/0140-provable-action-adjudication-contract.md`, `lib/agent-harbor/governance/action-adjudication.ts`).
- The Rust broker has exact-scope capabilities and durable one-use reservation/replay machinery (`core/pd-broker/src/capability.rs`, `core/pd-broker/src/broker.rs`).
- Capacity evidence already models native units, ambiguity holds, stop tails, and reservation evidence (`skills/context-economics-for-agent-swarms/`).
- Hypertree execution contracts explicitly claim only fixture-static evidence (`skills/drydock-program-architecture/`).
- Local bond conservation, escrow, refund, and slash arithmetic exist (`lib/bonds.ts`); independent custody, entitlement, and external settlement do not.

### Proposed, not implemented

- an external Drydock controller that owns consequential channels;
- a single-writer admission transaction consuming exact eligibility and capacity commits;
- immutable operator review evidence whose assent is not executable authority;
- a lifecycle-owned split between `PrepareContinuation` and `AdmitSuccessor`;
- a controller-armed recorder and control-disjoint evaluator;
- an asynchronous settlement handoff to an independently keyed authority;
- the Trial Basin deterministic evaluation system.

### Unknown or blocked

Complete mediation, VM or OS containment, provider reconciliation, spend refusal, descendant teardown, operator comprehension, live accessibility, runtime replay, throughput, and canaries are `BLOCKED_BY_HALT`. Final database/key/process ownership, permanent-ambiguity liveness, and lawful settlement remain `UNKNOWN`.

## Three architecture deadlocks that must close first

### 1. Reservation-to-lease atomicity

The capacity broker must issue a one-use `ReservationCommit`; a different authority must consume it before a lease exists. Separate writers do not create an atomic transition by wishing.

**First implementation decision:** use a small single-writer `AdmissionStore` that atomically consumes signed `EligibilityCommit` and `ReservationCommit` records and appends `ReservationConsumed`, `ExecutionLease`, and `DispatchIntent`. It gets no scheduling or forecasting discretion.

**Falsifier:** crash, duplicate, stale-reply, and reorder tests must prove at most one live lease, no dispatch without consumed reservation, no reuse, and convergent recovery.

### 2. Permanent ambiguity

Fail-closed `AMBIGUOUS` is safe but can wait forever when a provider never reconciles.

**First implementation decision:** let the attempt terminate as `QUARANTINED_UNRESOLVED` while its effect remains `AMBIGUOUS`. No exposed capacity or effect authority returns. A separately reserved, no-effect `ObserverLease` may inspect evidence; it is not the admitted successor.

**Falsifier:** a permanently unavailable provider reaches a bounded workflow outcome without retrying, restoring authority, or relabeling ambiguity.

### 3. Settlement handoff

Containment must close without waiting for payment or adjudication, while settlement must not lose or duplicate the completed effect's evidence.

**First implementation decision:** write effect closure and an idempotent settlement-outbox record in the effect boundary's local transaction. Settlement consumes it asynchronously. Emergency Stop and teardown never wait for settlement.

**Falsifier:** every crash boundary preserves one recoverable handoff; effect authority closes exactly once even when the settlement store is unavailable.

## Thin vertical sequence

1. **S0 Contract spine** — shared attempt identity, authority DAG, closed schemas, digest joins, typed result vector, and manifest-driven negative controls.
2. **S1 Deterministic admission kernel** — one no-effect node, fake capacity, reservation, lease, dispatch intent, fake completion, pure replay, and crash injection.
3. **S2 Action-authorization join** — connect existing verifier and one-use capability primitives to a fake actuator; denied authority must have no reachable effect transition.
4. **S3 Trial Basin** — sealed schedule/fault envelope, pre-action recorder, raw trace, oracle mutation, counterexample minimization, semantic replay, typed result vector.
5. **S4 Continuation** — typed Context IR, obligation coverage, one-use capsule nonce, independent fence/effect/capacity receipts, separate successor admission reducer.
6. **S5 Settlement handoff** — no-settlement profile, effect-closure outbox, typed witness requirements, durable `UNSETTLED`, idempotent terminal transition.
7. **S6 Static operator contract** — capture, immutable review, assent, adjudication, redemption, Stop states, and component-level accessibility tests.
8. **S7 One real contained canary** — blocked until the operator explicitly lifts the halt and S0–S6 hold.

At most two implementation lanes should run concurrently. Shared authority-bearing work does not parallelize before S1's model and crash suite pass.

## Required proof system

- **Mutation:** alter every bound digest; flip deny to permit; remove an obligation; reuse every nonce; self-witness success; mutate the oracle and manifest.
- **Fault:** crash immediately before and after every durable transition; duplicate, reorder, delay, and drop each message; permanently lose provider acknowledgement.
- **Model:** no lease without consumed reservation; at most one live lease; no effect after fence; no capacity reuse under ambiguity; at most one successor; Stop never depends on settlement.
- **Replay:** commit raw trace before minimization; preserve schedule and faults; prove raw and minimized traces trigger the same predicate.
- **Property:** resource conservation, acyclic authority, monotonic attenuation, no deny-to-effect path, and one terminal settlement or durable `UNSETTLED`.

## Claims that are impossible as stated

- Universal exactly-once behavior for arbitrary external effects after lost acknowledgement.
- Perfect replay of unmodeled network, provider, clock, scheduler, or human behavior.
- Non-equivocation from a Merkle root without append semantics, consistency evidence, and independent witnesses.

The bounded replacements are provider-specific idempotency plus explicit ambiguity; replay of a sealed model/schedule/fault envelope; and integrity plus independently witnessed append/consistency evidence.

## Release posture

The implementation program is technically plausible. The product is not release-ready. No static schema, mocked UI, successful reducer, or manager decision may be described as live containment, hard spend custody, provider cancellation, comprehensible consent, or safe resurrection.
