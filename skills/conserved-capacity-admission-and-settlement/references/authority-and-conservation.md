# Authority and conservation

## Source-to-claim ledger

| Source | Narrow support used here | What it does **not** prove |
|---|---|---|
| Malcolm Featonby, [“Making retries safe with idempotent APIs”](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | A caller-supplied request identifier can bind repeated calls to one stated intent; the identifier and mutation must be recorded atomically; reusing an identifier with changed parameters should fail validation. | It does not make an arbitrary downstream provider exactly-once, prove cancellation, conserve a multi-dimensional budget, or authorize a retry after an ambiguous effect. |
| Garcia-Molina and Salem, [“Sagas”](https://www.cs.princeton.edu/techreports/1987/070.pdf) | A long-lived operation can be decomposed into transactions with explicit compensating transactions after partial execution. | Compensation is not rollback, does not erase an external effect, and does not decide payment, blame, evidence quality, or legal settlement. |
| AWS Well-Architected, [“Control and limit retry calls”](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html) | Retries should be bounded and applied only after the operation's idempotency contract is understood. | It does not specify this skill's circuit states, native resource vectors, reservation algebra, or release authority. |

These sources motivate mechanisms. The serial join, native-unit conservation
equation, ambiguity hold, and authority split below are Drydock design
invariants. Their correctness must be established by fixtures and adversarial
implementation evidence, not by citation.

## Serial join

`EligibilityCommit` says an exact attempt may be considered. `ReservationCommit` says an exact native resource vector is held. The admission writer consumes both in one transaction and appends `ReservationConsumed`, `ExecutionLease`, and durable `DispatchIntent`. None of these records can substitute for another.

## Conservation equation

For every dimension and ledger owner:

`opening + granted = available + reserved + consumed + held + released + settled`

Terms remain in the dimension's native unit. Cross-unit comparison is a policy decision outside this skill.

## Ambiguity

A lost acknowledgement means the effect may have happened. The attempt may close operationally as `QUARANTINED_UNRESOLVED`, but the effect remains `AMBIGUOUS`, the relevant capacity remains held, and retry authority remains absent. An observer requires a separate no-effect reservation.

## Settlement handoff

Every closed effect binds its closure receipt to the declared effect-boundary principal. Effect closure and an idempotent outbox record commit together only for a bounded-settlement profile. A `NO_SETTLEMENT` record forbids both settlement metadata and effect-level handoff identifiers. The settlement authority consumes a permitted outbox record and may end `SETTLED` or `UNSETTLED`. The effect boundary cannot grade evidence, slash collateral, pay, or suppress the handoff.

## Truth boundary

A valid ledger fixture proves internal arithmetic and joins for the supplied bytes. It does not prove that a provider honored cancellation, that containment was complete, or that money or labor claims are lawful.
