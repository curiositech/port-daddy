# Skill audit — `conserved-capacity-admission-and-settlement`

**Disposition:** new focused skill, accepted at version 1.0.0 for static
architecture and fixture work. It grants no admission, spending, or settlement
authority.

## Gap that required a new skill

Existing cost, capacity, retry, and labor-economy skills each owned part of the
problem. None gave one closed record that kept native provider allowance, cash,
compute, context, concurrency, operator attention, reservation, lease, effect
ambiguity, Stop reserve, and settlement handoff separate across one attempt.
Composition prose therefore risked calling subscription use free, returning
capacity after an unknown effect, or letting the effect broker grade work.

## Steelman of the simpler approach

A single dollar budget and exponential backoff are easy to explain and often
adequate for ordinary API clients. An internal ledger can reduce accidental
overspend without a new protocol. This simpler design remains preferable when
the provider exposes exact metering and the work has no external effects,
resurrection, or shared subscription window.

Drydock exceeds those assumptions: allowance can be shared and opaque, effects
can lose acknowledgements, retries create fresh scarcity, and Stop itself needs
reserved tail capacity.

## Red-team findings built into the replacement

- Zero marginal cash cost cannot zero a subscription, context, compute, or
  attention dimension.
- Eligibility cannot reserve; reservation cannot dispatch; a lease cannot be
  inferred from either.
- Every retry, renewal, rework attempt, elastic slot, or provider-consuming
  gather consumes a new reservation.
- `AMBIGUOUS` effects keep associated capacity held until independent
  reconciliation or explicit quarantine.
- Stop reserve is held before launch and cannot be spent on ordinary work.
- Containment terminates independently from settlement availability.
- The effect boundary may append an idempotent settlement handoff but may not
  grade, slash, price, or pay.
- A `no-settlement` profile suppresses economic effects, not usage accounting.

## Executed adversarial suite

The bundle's 16-case mutation suite rejects absent native dimensions,
fabricated currency conversion, reused reservations, lease-without-reservation,
retry-without-reservation, ambiguity release, spend beyond reserve, Stop reserve
consumption, settlement authority inside the effect broker, and scalar
aggregation that loses a blocking dimension. The valid fixture exits green only
with balanced reservation, lease, effects, Stop tail, and terminal accounting.

## Residual limits

This is `T0_STATIC`. It does not prove provider parsers, billing custody,
transaction isolation under live concurrency, cancellation behavior, or lawful
payment. Provider allowance that cannot be measured remains unknown and scarce;
the skill cannot manufacture a hard external spend ceiling.
