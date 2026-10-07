# P7 reviews P3 — context integrity versus operational resurrection

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis — P3:** the person may survive; authority does not. Its Rebody Saga operationalizes that distinction by fencing the predecessor, reconciling effects, compiling fresh capabilities, and admitting one successor through compare-and-swap.
2. **Best evidence/falsifier — P3:** exact intent identity, durable `unknown`, and no automatic replay directly address lost acknowledgements. The stale-fence, concurrent-rebody, and store-loss cases can disprove the design.
3. **Protected invariant/operator outcome — P3:** a stale body cannot keep acting while a successor replays an unobserved effect. Uncertainty becomes visible quarantine rather than duplicate publication, spend, mutation, or credential propagation.

## Strongest unresolved tension

P3 permits “intent and verified facts” to affect successor system framing or tool
policy. That collapses factual verification into directive authority. A true and
authentic artifact can still contain an unauthorized imperative; stale operator
intent can be genuinely attributable without remaining current.

Trust needs two orthogonal axes:

- epistemic status: observed, cited, derived, disputed, or unknown;
- directive authority: issuer, audience, scope, expiry, revocation state, and
  permitted effects.

A capsule digest proves integrity, not current instruction authority.

## Falsifier for this critique

Accept a correctly hashed, factually verified capsule item containing an
imperative. The critique is falsified if every destination adapter can prove the
item remains inert data and can affect framing or tools only through a separate,
current, audience-bound, revocation-checked guidance authorization.

## Narrow amendment requested from P3

> Only a current, audience-bound, revocation-checked `GuidanceEnvelope` may
> affect system framing or tool policy. Verified facts and historical operator
> intent remain cited data. Policy may consult them only through typed predicates
> whose authority comes from that envelope.

Each capsule item should carry `authorityDisposition`, `issuer`, `audience`,
`expiresAt`, and `revocationWitness`.

## Revision required from P7

P7 concedes that “all effects terminal before succession” is inadequate when an
external system accepted an operation but its acknowledgement was lost. It
should adopt P3's `EffectSlot`, effect high-water mark, and durable `unknown`
state. Unresolved effect evidence is non-droppable until independently resolved
or explicitly accepted by the operator. The honest promise is stable intent
identity, fenced redemption, and durable uncertainty—not general exactly-once
execution.

## Retained dissent

Durable identity is not simply “the party that still owes the work.” Obligations
are relations to a principal and may be transferred without transferring
personhood. “Exactly one effect-capable body” is a safe default, not necessarily
a permanent law: a later design might prove independently fenced, disjoint
effect partitions. The enduring invariant is no overlapping authority over the
same effect or obligation partition.

## Evidence locators

- P3 identity/authority split, effect slots, and capsule boundary:
  `positions/P3-identity-resurrection-and-effects.md`
- P7 trust classes, non-droppable obligations, and Context IR:
  `positions/P7-context-integrity-memory-and-cognition.md`
- Signed guidance boundary: `docs/adr/0096-signed-guidance-envelope-and-suggestibility-authority.md`
- Durable person/body distinction: `docs/adr/0121-durable-agent-roster.md`

## Confidence

High confidence that P3's fence/reconcile/remint sequence belongs in P7 and
that P3 currently under-separates factual verification from directive authority.
Runtime confidence remains zero under the halt.

**SEALED — P7→P3 — 2026-09-16.**
