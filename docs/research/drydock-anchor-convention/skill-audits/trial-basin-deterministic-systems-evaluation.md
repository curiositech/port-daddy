# Skill audit — `trial-basin-deterministic-systems-evaluation`

**Disposition:** new focused skill, accepted at version 1.0.0 for deterministic
fake-system and replay evaluation. It cannot certify runtime containment,
provider behavior, or production readiness.

## Gap that required a new skill

Existing sandbox and RL skills covered hostile execution and learning loops, but
Drydock lacked a small doctrine for what deterministic simulation can honestly
prove. Without it, a controller could choose the schedule, write the trace,
define the oracle, minimize its own counterexample, and emit one reassuring
green result.

## Steelman of the simpler approach

Ordinary unit tests with fake clocks and stubbed services are fast, familiar,
and valuable. They should remain the default for local logic. Trial Basin is
needed only when claims depend on event ordering, crash boundaries, retries,
lost acknowledgements, authority joins, or replayable multi-component state.

## Red-team findings built into the replacement

- Model, schedule, fault plan, subject digest, and evaluation proposition are
  sealed before execution.
- Controller, subject, recorder, oracle, adjudicator, and promotion authority
  are named separately; decisive self-witness is rejected.
- Raw evidence is committed before minimization or interpretation.
- Negative controls and oracle mutations must fail in the expected direction.
- Counterexample minimization must preserve the violated predicate.
- Semantic replay identifies what was modeled and what was abstracted away.
- Results remain a typed vector; one passing axis cannot green an unknown or
  blocked axis.
- Every claim names the exact tier and witness class it supports.

## Executed adversarial suite

The 17-case suite rejects unsealed schedules, hidden nondeterminism, shared
subject/oracle identity, recorder controlled by the subject, missing raw trace,
minimized predicate drift, absent negative controls, oracle mutations that still
pass, replay without model identity, scalar green rollups, and promotion beyond
the modeled tier.

## Residual limits

This is `T1_MODEL` at most. It cannot establish hypervisor containment,
credential custody, provider cancellation, external billing, human
accessibility, market demand, or an unmodeled network/clock. Those axes remain
`UNKNOWN` or `BLOCKED_BY_HALT`.
