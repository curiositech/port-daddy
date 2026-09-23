# P6 — Capacity, subscription economics, spend, and conservation

**Round 1 · independent · sealed · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Thesis

Subscription-backed inference is prepaid, scarce option capacity. Zero incremental cash is not zero cost, zero scarcity, or permission to consume it. Drydock should admit work only against a vector of separately conserved resources, expressed in their native units. Anchor may authorize consumption of an already committed reservation; it must never mint capacity, estimate remaining allowance, or turn unlike resources into one fictional price.

## Evidence posture

- **SOURCE_PRESENT:** The repository has a static capacity-evidence schema and validator with native allowance buckets, p50/p90/p95 forecasts, drift margins, checkpoint tails, atomic reservations, ambiguity states, and fail-closed eligibility arithmetic ([schema](../../../../skills/context-economics-for-agent-swarms/schemas/capacity-evidence.schema.json), [validator](../../../../skills/context-economics-for-agent-swarms/scripts/validate-capacity-evidence.mjs)). Cash reservation and settlement patterns exist in the Conductor. Context pressure and cited, hash-pinned compaction exist in [`context-pressure.ts`](../../../../lib/agent-harbor/context-pressure.ts) and [`compaction.ts`](../../../../lib/agent-harbor/compaction.ts). Anchor signs expiring capability envelopes and checks signatures, subset authority, and replay nonces in [`pd-anchor`](../../../../core/kernel/pd-anchor/src/lib.rs).
- **SOURCE_PRESENT defect:** The production catalog describes subscription routes as “FREE,” “$0 marginal,” and preferred in [`backend-catalog.ts`](../../../../lib/backend-catalog.ts). Subscription launches reserve no dollar bond, and cost tracking suppresses durable accrual events. Global concurrency is an in-memory count of 20, not a durable reservation. These are incompatible with autonomous capacity governance.
- **PROPOSED:** A single external capacity broker, native-unit conservation, unified capacity/context preemption, and crash-closed reconciliation are accepted design targets, not operating facts.
- **UNKNOWN:** Current provider allowance, actual authentication mode, provider accounting lag, overshoot bounds, forecast calibration, operator-attention availability, and whether any installed observer matches these contracts.
- **BLOCKED_BY_HALT:** Real-provider canaries, runtime readback, kill/reap evidence, operator pixel evidence, and any `SHIPPED` claim.

## Non-negotiables

1. **No false fungibility.** Money uses integer minor units. Subscription windows retain provider-native percentages, requests, tokens, credits, or opaque weighted units and reset clocks. Context, compute, storage, wall time, concurrency, effects, and operator attention remain separate dimensions. Cash abundance cannot compensate for an exhausted weekly allowance or unavailable body slot.
2. **Reserve before birth or dispatch.** One durable writer atomically reserves every required bucket and alias before creating a body or sending a provider byte. Unknown or stale capacity denies real dispatch. Restart begins admission-closed until every reservation, dispatch, body, and effect is reconciled.
3. **Uncertainty consumes headroom.** Admission requires `p95 action burn + checkpoint/stop tail + calibration/drift margin`. A timeout, missing response, or lagging provider reading retains worst-case exposure. It never manufactures available balance.
4. **Anchor conveys, but does not account.** An Anchor envelope may reference one committed reservation, work node, body generation, route, maximum resource vector, expiry, and nonce. Delegation may only shorten expiry and reduce each coordinate. The capacity broker remains the live source of balances and settlement.
5. **Stopping must remain affordable.** Checkpoint capacity, cancellation time, effect revocation, and operator-intervention headroom are protected reserves. Ordinary work cannot spend them. There are no hidden retries, automatic refills, or attention-extracting escalation loops.

## Strongest implementation proposal

Build a separate Rust `CapacityBroker` backed by one SQLite writer. Its canonical resource vector covers:

- cash and provider credits;
- subscription allowance by account, authentication mode, product, native window, and reset;
- input/output/context tokens;
- CPU-ms, GPU-ms, memory-byte-ms, storage bytes, output bytes, and wall time;
- leased body, request, tool, and child-concurrency slots;
- effect counts; and
- operator-attention limits such as pending approvals and interrupt rate.

Operator attention is a consent constraint, not money. It may block admission or force hibernation; it cannot be automatically “purchased,” silently replenished, or converted into token allowance.

Each atomic action supplies a calibrated burn distribution conditioned on provider, model, effort, task class, context size, tool pack, and execution mode. The broker computes allocatable capacity after operator reserve, outstanding reservations, unresolved-attempt holds, and drift margin. It commits all `p95 + tail` reservations through one compare-and-swap transaction or commits none.

The lifecycle is:

`OBSERVED → RESERVED → DISPATCH_INTENT → IN_FLIGHT → SETTLED | RELEASED | HELD_AMBIGUOUS`.

Every attempt settles, including failures. An undispatched reservation may be released; exposure after a possible provider write stays held until first-party reconciliation. Money obeys an integer conservation equation. Subscription settlement records observed native-unit delta plus residual uncertainty. No scalar “total cost” controls admission.

Capacity preemption uses `ROOMY`, `TIGHTENING`, `CHECKPOINT_NOW`, `SWITCH_ELIGIBLE`, `WAIT_FOR_RESET`, `EXHAUSTED`, and `UNKNOWN`. At `CHECKPOINT_NOW`, Drydock admits no new effects or children, finishes only the bounded atomic action already covered by the tail, preserves complete tool request/result pairs, and seals a cited capsule. A verified capsule may hibernate with no process or support a separately authorized route switch. Provider disappearance leaves the incomplete tail and its capacity ambiguous rather than pretending the call was free.

Fail-cheap shutdown means external authority can revoke effects, terminate the broker connection, fence the body generation, kill the full process/VM witness, and preserve conservative holds even when the guest is wedged. The first real lane permits one request, one attempt, one concurrent operation, no tools, no children, no retry, and no automatic refill.

## Grafted-skill audit

- **Normative core:** `context-economics-for-agent-swarms` owns native allowance, forecasts, tails, and compaction; `sandboxed-adversarial-test-harness` owns spend custody, durable reservations, and fail-cheap promotion; `agent-resurrection-and-body-continuity` owns generation fencing and capacity-aware handoff.
- **Required mechanisms:** `sqlite-durable-agent-state` supplies one-path/one-writer crash discipline; `fleet-event-spawn-trust` and `circuit-breakers-and-retries` constrain birth and retries; `mcp-trust-broker` constrains effects; `agent-work-receipt-designer`, `agent-visual-evidence-manifest`, and `operator-surface-authority-designer` make settlement and intervention inspectable.
- **Inputs, not admission authority:** `cost-accrual-tracker` and `cost-verification-auditor` provide post-dispatch evidence; `cost-optimizer` is dollar/DAG policy; `agent-labor-pricing-function` concerns customer packaging; `rate-limiting-strategy` shapes requests; `background-job-queue-design` handles delivery and idempotency; `resource-bounded-planning` governs deliberation; `db-retention-and-compaction` governs SQLite file growth. None owns multi-resource reservation and settlement.

## Falsification tests

- 1,000 concurrent aliases oversubscribe one underlying allowance or body bucket.
- A crash between any two reservation/dispatch/settlement writes releases or double-charges capacity.
- Missing or contradictory provider data still permits a real call.
- A silent subscription-to-API authentication change avoids the cash ledger.
- Ordinary work consumes the checkpoint tail, or compaction splits a tool pair.
- A child Anchor envelope enlarges one resource coordinate, extends expiry, changes body generation, or replays a nonce.
- A timeout or provider error releases unresolved exposure without external evidence.
- Plentiful cash admits work despite exhausted subscription, context, compute, concurrency, or attention capacity.

These are **PROPOSED** deterministic and model-checking tests; real-provider and runtime variants are **BLOCKED_BY_HALT**. The existing TLA+ conservation model is useful but explicitly excludes concurrent claims and expiry, so it is not yet this proof.

## Impossible combinations

- “Subscription is free” plus finite shared allowance.
- Unknown capacity plus autonomous dispatch.
- Post-dispatch reservation plus a hard pre-spend ceiling.
- In-memory concurrency plus crash-safe global conservation.
- Automatic retry plus ambiguous settlement.
- Uncited or split-pair compaction plus truthful continuation.
- Internal accounting plus a claim of provider financial custody.
- One scalar optimizer plus non-fungible resources.

## Missing skill proposal

**`conserved-capacity-admission-and-settlement`**

Activate when one action or body consumes two or more of cash, provider credits, subscription windows, tokens/context, compute/storage/network, concurrency, effects, or operator-attention capacity; or when designing atomic reservation, provider-lag holds, settlement, preemption, or crash recovery across those resources.

Do not activate for customer pricing, billing, post-hoc cost auditing, generic API rate limiting, prompt compaction alone, SQLite file retention, identity/resurrection, or provider containment in isolation.

The gap is concrete: the current capacity schema's unit enum covers allowance-like units but omits money, bodies, compute, and attention, although it already names reservation states.

## Confidence and unknowns

Confidence is high in native-unit separation, reservation-before-dispatch, ambiguity holds, inviolable stop tails, and non-minting Anchor attenuation. Confidence is medium that p95 forecasting can become useful; provider nonlinearities may prevent precise task-count predictions. Attention quotas may need qualitative gates rather than minute estimates.

Reliable current observers for every provider, measurable overshoot bounds, forecast calibration quality, and the operator's preferred attention policy remain `UNKNOWN`.

**Sealed verdict:** Drydock should call subscription use *included but scarce*, never free. Until the unified broker, Anchor reservation binding, and adversarial proofs exist, autonomous real-provider admission remains `PROPOSED` and dynamic verification remains `BLOCKED_BY_HALT`.

**SEALED — P6 — 2026-09-16.**
