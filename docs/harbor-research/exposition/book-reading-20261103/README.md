# Whole-book reading record

The book is organized around one question: how can autonomous work remain accountable when processes fail, authority is delegated, and operators cannot inspect everything? A reader should encounter each abstraction as an answer to a concrete problem, then use it in a calculation, argument, or later mechanism.

Four readers completed contiguous readings of all nine authored chapters, their exercises and deferred solutions, plus the volume front matter and concordance. The reports below record source hashes and reading intervals. They are evidence of the actual source pass; lint counts are only supporting checks. The 152 concept records describe substantive clusters, not every technical word or bibliographic name.

| Reading | The thread a reader follows | Where it is used again |
|---|---|---|
| Foundations | A lost update, failed plan, hidden state, ambiguous timeout, and resumed stale worker | The preservation and recovery argument; five Check/Trace/Open exercises |
| 1. Single-Writer Kernel | A proposal becomes a durable record and an admitted effect | Transactions, fencing, recovery and the control/observation boundary |
| 2. Anchor Protocol | Authentication identifies a signer; authorization limits an action | Parent-to-child delegation, verifier checks, expiry and revocation |
| 3. Sealed Harbor | Information needs both an allowed path and a controlled observation | Noninterference, privacy accounting, canary power and sequential evidence |
| 4. Legible Swarm | Limited attention must support a particular decision | Inspection loss, extractive summaries, evidence access and cache budgets |
| 5. Spawn to Person | A restart must not silently erase attributable obligations | Newcomer incentives, quality records, audits, succession and tombstones |
| 6. Harbor Economy | A purchase needs specified performance and accepted evidence | Contract types, settlement accounting, queueing and assurance services |
| 7. Bonded Commons | Authority, evidence and incentives solve distinct problems | Bond arithmetic, sampling assumptions, lifecycle safety and liveness |
| 8. Federated Harbor | Independent operators need compatible evidence and bounded grants | Measured channel claims, consistency tests, transfer and revocation limits |

The exposition uses worked numbers before general claims where they reveal the mechanism. Qualitative scenarios are ordinary prose rather than boxes promising numerical work. Definitions return in the argument or exercises; unused formal machinery is not retained merely to display a vocabulary. Solutions preserve the hypotheses of the result they apply, and Open exercises state obligations rather than invented answers.

## Reading and verification records

- [Foundations, front matter and concordance](foundations.md), with [concept records](foundations-concepts.json).
- [Chapters 1–3](machine.md), with [concept records](machine-concepts.json).
- [Chapters 4–5](operator-identity.md), with [concept records](operator-identity-concepts.json).
- [Chapters 6–8](markets-federation.md), with [concept records](markets-federation-concepts.json).
- [Reading plan and original source identifiers](reading-plan.json).

Independent checks include exact finite arithmetic for the audit, extractive-summary, caching, sampling and queueing examples; bounded state-model executions where stated; targeted primary-source inspection; and a second-reader challenge of the foundations argument and all five solutions. Research Papers 1, 2, 3 and 5 received the corresponding scoped corrections and compile cleanly. This is not a claim to have independently proved every external theorem or observed every deployed mechanism.

## Acceptance boundary

The locally accepted Book is 844 pages, built from source checkpoint `39c7e2cf708d937317811d69049cce227e1a3393` with the private Suisse profile. All 282 captured build inputs remained unchanged. The PDF hash is `b589f090130f5b6f775d88a2f2314456ea762a95f3f1d12bcc6dd982ead581b9`. The [acceptance receipt](render-proof/acceptance.json) binds the source, fonts, rendered checks, navigation checks and selected visual reviews.

Generator regressions: 73 passed. Book source regressions: 119 passed and 45 named fixture-only checks skipped; the separate rendered run passed 115 checks with 7 fixture-only skips. Mathematical-boundary regressions: 26 passed. Citation/index consistency and all 14 propagation checks pass. There are zero overfull boxes, unresolved references or detected page-turn split words. Every one of the 212 exercise destinations and 212 solution destinations matches its heading. These are separate suites, not additive claims of unique tests.

Actual facing-spread inspection covers 148 selected spreads across 109 semantic targets, including every chapter opener and the changed teaching sequences. Exact image-byte matches permit reuse of recorded actual inspections; changed images were opened again. The [visual coverage record](render-proof/visual-coverage.json) enumerates that sample. Complete source reading is not an assertion that every rendered page received an aesthetic certification.

The frozen published PDF is not replaced by this local candidate. Source review, hosted checks, source merge and the separately reviewed publication refresh have distinct receipts. Historical figure-blocker snapshots do not waive visual review. The family-design program and a complete external-citation/runtime audit remain separate work. The authoritative status entry is `BOOK-TEXTBOOK-CRAFT-20261103` in the [Omni ledger](../../omni-ledger.json).

Source and review-evidence delivery: [PR #10345](https://github.com/curiositech/port-daddy/pull/10345). Hosted checks, review threads and merge status are recorded on that PR.
