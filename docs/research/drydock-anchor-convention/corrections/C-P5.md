# C-P5 — Bind operator assent to what was actually shown

## Steel-man

P10's strongest critique is that P5's byte-exact authority can still misrepresent human intent unless immutable, accessible presentation evidence is digest-bound to the exact proposal and approval while remaining incapable of authorizing or executing anything.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** For every operator-dependent `ApprovalAssertion`, `OperatorReviewEnvelopeV1` binds the exact `ActionProposal` digest, and the assertion binds both proposal and review-envelope digests. The immutable envelope records the consequential semantics presented: effect, principal, body generation, actuator, target, blast radius, cost or capacity, use count, expiry, omissions, and unknowns. It is presentation evidence only. A missing or mismatched binding fails closed.
- **Preserved invariants:** Approval remains evidence rather than executable authority; adjudication may still deny; one-use redemption, monotonic attenuation, ambiguous-effect quarantine, independent witnessing, and the prohibition on self-completing trust loops remain unchanged.
- **Retained dissent:** A valid envelope proves what was presented, not what the operator understood, and proves neither complete mediation nor containment. Comprehension, accessibility, substitution detection, and cross-redemption resistance still require dynamic evidence.
- **Evidence locators:** `reviews/P10-reviews-P5.md`; `synthesis/manager-extraction-r1.md`; `positions/P5-capability-and-consequential-effects.md`; `lib/agent-harbor/governance/action-adjudication.ts`; `schemas/agent-harbor/v0/governance/human-gate-payload.schema.json`.
- **Truth labels:** `ActionProposal`, approval-as-evidence doctrine, and a partial human-gate schema are `SOURCE_PRESENT`; `OperatorReviewEnvelopeV1` is `PROPOSED`; operator comprehension is `UNKNOWN`; end-to-end tests are `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This brings P5 into agreement with kernel items 10 and 11.
