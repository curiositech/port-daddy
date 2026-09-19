# C-P7 — Separate continuation preparation from successor admission

## Steel-man

P3 correctly identifies that P7's Context Steward overreaches when `Redeem` converts valid context preparation into lifecycle, capability, effect-settlement, and revocation authority that only independently receipted owners may exercise.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** Replace steward-owned `Redeem` with deterministic `PrepareContinuation`, which emits content-addressed Context IR, obligation-coverage proof, capability-translation report, omission manifest, and a consumption nonce. A separately owned `AdmitSuccessor` verifies current guidance authorization plus independent predecessor-fence, effect-reconciliation or high-water, and capacity receipts; it alone consumes the nonce, creates the successor lease, and appends lineage. Capability issuance remains broker-owned. `effectState` and revocation status are receipt-backed projections, never steward conclusions. Historical facts and operator history remain data; only current, audience-bound, revocation-checked guidance may enter authority-bearing channels.
- **Preserved invariants:** Durable principal; exact predecessor boundary; non-droppable typed obligations; root regeneration; trust/authority separation; fail-closed capability translation; one activated successor; historical content cannot impersonate current guidance; context validation cannot self-authorize admission.
- **Retained dissent:** An unresolved effect may justify a quarantined cognition-only analyst, but P7 does not yet accept calling that process the admitted successor or granting it lineage continuity. Any such exception needs a distinct no-effect lease and remains an open proof obligation.
- **Evidence locators:** `positions/P7-context-integrity-memory-and-cognition.md`; `reviews/P3-reviews-P7.md`; `synthesis/manager-extraction-r1.md`.
- **Truth labels:** Typed context, validation, and continuation-CAS foundations are `SOURCE_PRESENT`; `PrepareContinuation`, `AdmitSuccessor`, nonce consumption, and independent receipt joins are `PROPOSED`; final transactional/key ownership and revocation wiring are `UNKNOWN`; dynamic enforcement is `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This brings P7 into conformity with existing kernel items 6 and 7.
