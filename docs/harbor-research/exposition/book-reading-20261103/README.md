# Whole-book reading record

The book is organized around one question: how can autonomous work remain accountable when processes fail, authority is delegated, and operators cannot inspect everything? A reader should encounter each abstraction as an answer to a concrete problem, then use it in a calculation, argument, or later mechanism.

Four readers completed contiguous readings of all nine authored chapters, their exercises and deferred solutions, plus the volume front matter and concordance. The reports below record source hashes and reading intervals. They are evidence of the actual source pass; lint counts are only supporting checks. The 148 concept records describe substantive clusters, not every technical word or bibliographic name.

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

Initial source checkpoint rebased onto merged PR#10336: `5170150e492a08aec44640edaf87dc7606248082`. Final render receipts identify their exact source snapshot. Generator regressions: 56 passed. Source book regressions: 160 collected, 117 passed and 43 correctly skipped without their rendered fixtures. Mathematical-boundary regressions: 26 passed. Citation/index consistency and all 14 propagation checks pass. Rendered checks, actual facing-spread inspection and publication receipts are recorded separately when completed.

The frozen published PDF is not replaced by a local candidate. Historical figure-blocker snapshots are neither current render verdicts nor permission to waive visual review. The family-design program and a complete external-citation/runtime audit remain separately scoped work. The authoritative status entry is `BOOK-TEXTBOOK-CRAFT-20261103` in the [Omni ledger](../../omni-ledger.json).
