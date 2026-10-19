# C-P1 — Separate containment from settlement

## Steel-man

P9 is right that a broker which can both mediate an effect and grade its outcome can silently become judge, executioner, and payer even when its byte-level mediation is flawless.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** Atomic effect closure emits an independently accessible `SETTLEMENT_HANDOFF`. The broker may mediate, deny, terminate, and report an effect, but it may not grade success, suppress the handoff, slash value, or settle compensation.
- **Preserved invariants:** The broker still owns the narrow effect boundary; unknown or ambiguous effects fail closed; no guest or claimant can mint authority; settlement consumes typed evidence rather than broker opinion.
- **Retained dissent:** Independent accessibility is necessary but not sufficient. The eventual settlement plane still needs durable delivery, anti-equivocation, witness separation, and adversarial proof.
- **Evidence locators:** `reviews/P9-reviews-P1.md`; `synthesis/manager-extraction-r1.md`; `positions/P1-containment-and-tcb.md`.
- **Truth labels:** Static acceptance is `SOURCE_PRESENT`; `SETTLEMENT_HANDOFF` is `PROPOSED`; dynamic delivery and suppression tests are `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This makes the existing containment/settlement separation explicit.
