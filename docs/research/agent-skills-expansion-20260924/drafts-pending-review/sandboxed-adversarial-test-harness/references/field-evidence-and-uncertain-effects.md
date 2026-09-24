# Field evidence and uncertain effects

Use a row per attack route and record: route attempted; boundary expected to stop it; policy decision; controller/broker observation; independent host/provider witness; external effect truth; replay/reset recipe; and claim allowed by that evidence class. Preserve failure, ambiguity, and missing receipts as first-class outcomes.

A simulated refusal proves only the simulator's configured branch. A guest assertion does not prove host state. A broker receipt proves only what that broker can observe. Provider reconciliation is needed for provider-side effect claims. A missing or lost acknowledgment after dispatch means `UNKNOWN/HOLD`, not “not applied”; retry requires a fresh authoritative absence plus target-enforced idempotency/fencing that rules out a late first commit.

Use a deterministic reset for guest state, ledger, credentials, provider fixture, virtual clock, and schedule when comparing runs. Record any retained state. Keep schema validation, unit tests, host isolation, broker mediation, provider exposure, and deployment evidence as separate promotion tiers. During an operator halt, dynamic tiers remain `NOT_PROVISIONED` or `BLOCKED`.

NIST's [sandbox glossary](https://csrc.nist.gov/glossary/term/sandbox) provides a general term definition, not proof that any particular VM/process boundary is isolated. NISTIR 8397 ([DOI](https://doi.org/10.6028/NIST.IR.8397)) is a candidate source for secure-development verification context; the detailed body was not independently inspected in the research pass, so this reference does not attribute specific controls to it.
