# Authority, admission and lifecycle review

Bind each capacity-bearing attempt or continuation to plan digest/revision, node, attempt,
generation, route, resource vector, expiry and operation key. The controller checks the
standing authority, consumes one reservation commit, persists intent and issues a fenced
lease before transmission. These are requirements on a future controller, not actions
performed by this bundle's validator.

A resource ceiling is a vector: tokens, currency, attention and concurrency have distinct
units. Each reservation needs a declared accounting rule; a sum of configured maxima
alone does not prove actual aggregate spend. Expiry stops future permission where enforced
but does not establish that running work or a provider charge has stopped.

| Observation | Required decision |
|---|---|
| Reservation rejected | Do not transmit; record rejection and owner |
| Lease issued, intent not transmitted | Reconcile controller record before release |
| Send outcome unknown | Hold reservation and query the exact target operation |
| Cancellation requested | Track acknowledgement, fence, termination and provider state |
| Terminal result witnessed | Check completion and accounting before settle/release |
| Evidence still incomplete | Keep `HELD_AMBIGUOUS`; no capacity reuse |

For retry, authoritative noncommit plus a fence against late commit, or validated
same-operation deduplication, must combine with current authority and remaining budget.
Compensation needs its own scope and accounting and never proves the original was absent.
A generation is effective only if all relevant sinks enforce it.
