# Open questions

**Status:** DELIBERATELY UNRESOLVED

Open questions are protected from accidental answer-by-mock. A decision closes a question only when it names the authority, alternatives, consequences, migration, and proof.

## Authority and vocabulary

- **GH-Q-001:** Does the accepted Convoy contract require a successor ADR or an RFC revision?
- **GH-Q-002:** When and how does this repository ledger import into signed production Chartroom authority, and what exact readback proves cutover?
- **GH-Q-003:** Is `Incarnation` an alias/projection of the existing `Body`, a lifecycle occurrence of a body, or a genuinely new entity? No parallel identity registry may be introduced by vocabulary alone.
- **GH-Q-004:** Who may commit each class of Chartroom mutation? How do multiple operator signatures or conflicts compose?
- **GH-Q-005:** Which state names are canonical runtime enums, and which are UI projection labels?

## Intent and BDI

- **GH-Q-006:** May any low-risk interpretation be auto-accepted, and under which signed policy?
- **GH-Q-007:** What reconsideration policy may automatically resume, suspend, drop, or replan an intention?
- **GH-Q-008:** What happens when an operator contradicts themselves after an irreversible action is permitted or admitted?
- **GH-Q-009:** Which beliefs are claims about the world, which are observations, and which remain private model hypotheses?

## Actions and Cedar

- **GH-Q-010:** What are the exact schemas and lifecycle contracts for `ActionIntent`, `DecisionEvidence`, `ActionPermit`, obligation, `ActionReceipt`, replay, revocation, and failure?
- **GH-Q-011:** Can permits be delegated or attenuated? Can a successor body exercise an existing permit?
- **GH-Q-012:** What does revocation mean before permit issuance, after issuance, after actuator admission, and after an irreversible provider accepts the request?
- **GH-Q-013:** Which complete-mediation inventory is sufficient for the first sanctioned-development claim?
- **GH-Q-014:** Which policy language is selected? Cedar, Soufflé, generated native Rust, and other candidates remain unselected.
- **GH-Q-015:** If Cedar is selected, which clauses are editable by owners and which require code/review? What is the approval UX?
- **GH-Q-016:** Which properties, if any, warrant Lean proofs? The proof compile cost is not a per-action hot path.
- **GH-Q-017:** What first-version permit expiry and epoch invalidation rules replace full revocation?

## Claims, signals, and actors

- **GH-Q-018:** Are claims bound to `AgentNode`, `Body`, or both? Are leases mandatory?
- **GH-Q-019:** Who may renew, release, preempt, or salvage a ghost ship's claim?
- **GH-Q-020:** May one durable person have concurrent bodies? How is split-brain prevented or represented?
- **GH-Q-021:** Who chooses pheromone half-lives, and how are gaming, wildcard, depth-zero, and null-actor conflict bugs handled?
- **GH-Q-022:** Which memory classes survive office reassignment or cross-provider embodiment?

## Protocols, evidence, and UX

- **GH-Q-023:** What epistemic guarantee does each Parley terminal state establish?
- **GH-Q-024:** May one actor fill multiple protocol roles? How are duplicate, late, and out-of-order acts handled?
- **GH-Q-025:** Which evidence satisfies each intention's completion policy, and who may change that policy?
- **GH-Q-026:** Who owns the narrated ledger projection: daemon, pd-console/web, Relay, or a composition?
- **GH-Q-027:** Is the first owner surface web-first or phone-first?
- **GH-Q-028:** Which adapter guarantees can ordinary collaborators honestly receive?
- **GH-Q-029:** How are redacted/confidential evidence commitments traversed without disclosing payloads?

## Runtime, federation, and economy

- **GH-Q-030:** Is cooperative isolation sufficient before owner-funded money, or is true containment mandatory before any paid effect?
- **GH-Q-031:** How do conflicting Harbor grants compose, and what happens to in-flight effects during revocation or network partition?
- **GH-Q-032:** Where does the authoritative revenue ledger live?
- **GH-Q-033:** Who owns roster-triggered supervisor sequencing?
- **GH-Q-034:** What are steward repository names, organizations, and visibility?
- **GH-Q-035:** Which actions require hard cost reservation; what happens when usage exceeds it or arrives late/unattributed?
- **GH-Q-036:** What independent oracle settles outcome, slash, refund, chargeback, tax, currency, and already-incurred COGS?
- **GH-Q-037:** What evidence settles confidential remote work without revealing protected buyer state or skill implementation?
- **GH-Q-038:** Is Apple Virtualization the first containment tier, an optional embodiment, or outside the first proof?

## The ledger's own claims about the repository

- **GH-Q-039:** What checks the ledger's claims about live repository state? `07-research-provenance.md` records which pull requests are open, draft or merged, and the README's central caveat -- that PR #9989 is still a draft and excludes production deployment -- is one of those claims. Nothing verifies any of them against the repository, so the day one merges, the ledger says something false with no mechanism to notice. The candidates are a check that queries each cited pull request and fails on a mismatch, a generated section that cannot be hand-written, or a rule that the ledger cites commits rather than pull-request states. Recorded 2026-09-08 from a review of the import; deliberately not answered by picking one.

