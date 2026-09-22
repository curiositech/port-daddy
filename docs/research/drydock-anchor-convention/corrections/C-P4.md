# C-P4 — Bind every executable attempt to live capacity

## Steel-man

P6 correctly argues that a scheduler can be logically fair yet physically unsafe if leases, retries, rework, or gathers consume resources after their reservation has expired, changed, or been reused.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** Every lease, renewal, elastic slot, rework attempt, and resource-consuming gather is bound to one live reservation tuple `{executionPlanDigest, planRevision, nodeId, attempt, bodyGeneration}`. The plan grant is only a ceiling. Crash, cancel, expiry, reduction, or ambiguous completion must settle, release, or hold that reservation before reuse.
- **Preserved invariants:** Eligibility precedes reservation; reservation precedes lease; durable dispatch intent precedes transmission; one-ship/one-attempt boundaries remain explicit; stale generations cannot inherit capacity.
- **Retained dissent:** A live reservation does not prove provider capacity, successful dispatch, or settlement; those remain independently witnessed states.
- **Evidence locators:** `reviews/P6-reviews-P4.md`; `synthesis/manager-extraction-r1.md`; `positions/P4-hypertree-execution-and-coordination.md`.
- **Truth labels:** Scheduling structures are `SOURCE_PRESENT`; exact reservation binding is `PROPOSED`; crash/retry fault proof is `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This makes consensus items 8 and 9 operationally precise.
