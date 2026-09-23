# C-P6 — Linearize reservation consumption without giving the broker scheduling power

## Steel-man

P4 correctly identifies that P6 lacked a crash-safe linearization artifact connecting broker-owned reservation to controller-owned lease issuance, while correctly refusing to let the broker acquire scheduling power.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** The broker issues one single-use `ReservationCommit`, bound to plan digest and revision, node, attempt, body generation, route, native resource-vector ceiling, expiry, and idempotency key. The broker never determines eligibility or grants a lease. The controller must durably consume that exact commit once before creating the execution lease; durable dispatch intent follows before external transmission. Reservation alone does not authorize execution.
- **Preserved invariants:** Native resources remain non-fungible; reservation precedes lease and dispatch; unknown capacity fails closed; checkpoint and stop tails remain unavailable to ordinary work; one commit cannot authorize two leases; controller and broker cannot invent each other's state; ambiguous dispatch retains its hold.
- **Retained dissent:** Consuming a commit and creating a lease is not settlement. Cancellation, lost acknowledgement, or uncertain provider dispatch must still end in explicit settlement, release, or `HELD_AMBIGUOUS`; neither lease nor commit expiry may silently restore exposed capacity.
- **Evidence locators:** `reviews/P4-reviews-P6.md`; `synthesis/manager-extraction-r1.md`; `positions/P6-capacity-economics-and-conservation.md`.
- **Truth labels:** Critique and synthesis records are `SOURCE_PRESENT`; `ReservationCommit` semantics are `PROPOSED`; transactional mechanism and crash-proof sufficiency are `UNKNOWN`; dynamic fault proof is `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This brings P6 into explicit conformity with consensus items 8 and 9.
