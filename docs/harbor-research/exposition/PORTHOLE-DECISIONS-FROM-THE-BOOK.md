# Porthole architecture decisions, answered from the book

Written 2026-09-07 in answer to the six-decision brief another agent put to the author. The brief's own doctrine (Grand Harbor, Porthole, event ledger, search and lineage) already has names in the Textbook Edition: Grand Harbor is the single-writer kernel's one durable record; Porthole is the Legible Swarm's per-participant projection plus the work unit's receipts; the event ledger is the receipt chain; search and lineage is the spawn-to-person lineage with cited routes back to artifacts. Each decision below picks an option, gives the chapter that decides it, says what the chapter adds that the brief's option leaves out, and says where the book is silent. The last section lists the silences, because they are work the book owes the project.

The evidence rule the brief ends with is the book's own: choosing a stronger policy does not make its proof exist. The book's vocabulary for that is the five assurance modes (Observed, Coordinated, Brokered, Confined, Attested) and the four statement kinds (theorem, design invariant, model-checked property, empirical hypothesis). A product badge should name a mode; a roadmap item should name a kind.

## 1. Confidential execution boundary

- Decision: **Phased evidence-bound claims.**
- Confidence: 90%
- From the book: this is the Sealed Harbor chapter's exact situation, two owners who distrust each other computing one answer in a room with two fences and two gates, where the only thing that leaves is what the slot lets out. The chapter's design gives both parties their secrecy only when both fences stand and the room is measured and attested. On a customer-controlled ordinary host only one fence exists (the customer's), so "provider IP protected" is not weak there, it is **unavailable**, and the front matter now says the Confined mode is not yet available to any caller. Customer-local default-deny execution is honest today at the Coordinated or Brokered mode; the two-sided claim is the Attested mode and is gated on the sealed room being built. The book also settles the substrate: the enforcement point below the agent (a per-agent machine with brokered system calls and metered egress) is prescribed, and tool-level interceptors observe but do not regiment. The "separately approved attested profile" in the brief is the sealed room; do not design a second one.
- What the book does not settle: which measured-boot and key-release stack to use. That is an engineering choice the substrate study's S1 half (cost and controllability table) is meant to inform.

## 2. Output leakage policy

- Decision: **Typed outputs and bounded queries.**
- Confidence: 85%
- From the book: the Sealed Harbor's release ledger is this policy made precise. Output leaves through one metered slot; the budget is counted in bits; the ledger is conserved across releases and across composition (the chapter works the point at which composing many small releases costs more than one budgeted release); canaries with a sequential test give a stated detection power against a tenant that tries to smuggle data through an allowed result. Three additions to the brief's option follow. First, the budget belongs to the room, not to the capability: a publisher-declared limit is a claim about the publisher's own interest and the chapter's noninterference result is stated modulo a declassification policy the room enforces, which is why "capability-defined policy" is the wrong option. Second, human review is itself a release and must be recorded on the ledger with its own receipt, or the ledger no longer conserves. Third, a denied output is evidence and gets a receipt; the Legible Swarm chapter's information floor says the operator cannot see what is not recorded.
- What the book does not settle: repeated-query extraction of a provider's model behaviour. The ledger meters bits out of the room for the customer's data; it does not yet treat the customer's queries as a channel that leaks the provider's implementation. That is the same ledger run in the other direction and is not written down anywhere. See the silences.

## 3. Provider observation rights

- Decision: **Customer-only, with per-run provider grant.**
- Confidence: 85%
- From the book: visibility is disclosure. The Legible Swarm chapter prices supervision in bits and treats every projection as a surface with coverage, omission, and latency that must be measured; a provider's support view is such a surface and costs the customer information. The Anchor Protocol chapter supplies the grant mechanism: an attenuated capability whose caveats name the perspective, the purpose, the expiry, and the redaction, that only narrows at every hop, and that dies by revocation epoch. The Federated Harbor chapter's three-tier visibility says what may gossip freely (aggregate health and settlement receipts), what needs an authority point (a named perspective), and how a grant crosses a boundary (signed, attenuated, revocable). The "independent attested reviewer" option is not an alternative to this default; it is the Bonded Commons' witness role and belongs to decision 4 as the dispute path.
- What the book does not settle: consent expiry when the customer is itself an agent acting for a person. The spawn-to-person chapter binds work to a durable principal, but who may grant a provider a view on behalf of that principal is not addressed.

## 4. Commercial settlement protocol

- Decision: **Escrowed budget with metered receipt release.**
- Confidence: 80%
- From the book: this is the Bonded Commons chapter and the Harbor Economy chapter together. Price, budget, capability digest, and policy committed before execution is the economy's three-sided market on one conserving ledger; the hold and metered release is the bonded escrow whose conservation law is mechanically checked; the dispute authority is the chapter's 2-of-3 settlement among customer, provider, and witness, which is where the independent reviewer of decision 3 enters. Two additions. The publisher posts a bond, and the chapter's claim-signalling result gives the threshold above which truthful claims about a capability are incentive-compatible; below it the marketplace is paying for stories. And "billable success" is decided by the kernel chapter's commitment-closure oracle: a run is done when a typed oracle (a released claim, a merged commit, a passing test identifier, a policy sub-check) says so, never free text. A successful tool run without an accepted outcome is a commitment still open, and the escrow does not release on an open commitment.
- What the book does not settle: dispute windows, partial-work pricing, and refund arithmetic. Conservation says the sums balance; it does not say how long a customer has to object or what a half-finished work unit is worth. The economy chapter's succession price is the nearest instrument and was derived for a different question.

## 5. Publisher admission and revocation

- Decision: **Curated registry with transparent revocation**, with the mechanisms below fixed now so that federated registries are a change of policy later, not a redesign.
- Confidence: 75%
- From the book: a signature proves which key spoke, and the Anchor chapter's model-checked revocation says the rest. Revocation must be by signed epoch; the chapter's negative control is the backup-and-restore attack, in which a cached last-known-good state is replayed after a revocation, and it is refuted by design only when the cache carries the epoch. So the brief's "cached last-known state for bounded offline use" is acceptable exactly when the cache refuses to serve across an epoch boundary. Admission is where the spawn-to-person chapter speaks: identity is a ledger position, reputation is what the witnessed record is worth, a fresh key cannot inherit a reputation it did not earn (the no-mint result), and a probationary period has a cliff below which the record is worth nothing. Admission should therefore be a bond plus a probation, not a review alone. The Federated Harbor chapter describes the end state, organisations exchanging signed trust and revocation statements without any sovereignty crossing the wire; a curated registry while the ecosystem is small is that design with one participant.
- What the book does not settle: who holds emergency suspension authority and under what review. The Bonded Commons has audits and appeals for transactions; it does not have a constitution for the registry itself.

## 6. Chartroom authority cutover

- Decision: **Signed single-writer cutover** as the mechanism, with **projection-only Chartroom** stated as the honest present.
- Confidence: 85%
- From the book: the kernel chapter's thesis is one writer per record, and the Federated Harbor chapter's is that sovereignty never crosses the wire. Together they rule out the dual-write option outright; two authorities writing one record is the condition the whole book exists to prevent, and no reconciliation receipt repairs it after the fact. They also say what a remote Grand Harbor is until a cutover happens: a projection over local authorities, which is precisely how the front matter grades today's relay federation (it carries authenticated events outbound and does not replicate databases, impose global order, or authorise local effects). The cutover itself is an epoch transition: freeze, export, verify the ledger root, import, check projections and permissions, activate a signed writer epoch, and roll back only by another explicit epoch. The Anchor chapter's epochs are the right primitive for the writer epoch too.
- What the book does not settle: authority transfer between harbors as a first-class procedure. Writer epochs appear in the book only as a revocation mechanism. There is no chapter section on freezing, exporting, and re-homing a harbor's authority. This is the largest silence.

## Cross-cutting instruction

Prefer the narrowest claim the evidence supports, and label every claim with its assurance mode. The book's grades are the ceiling: nothing in Porthole may display a mode the appendix's implementation boundary does not grant. Preserve the brief's witnessed, reported, derived, inferred, and unavailable labels and map them onto the five modes once (proposal: witnessed is Confined or Attested evidence; reported is Coordinated or Brokered; derived and inferred are projections and must say from what; unavailable is unavailable). Report every authority or implementation gap as unavailable, never as inferred-complete.

## The silences, which are the book's next work

1. **Authority transfer.** A section in the kernel or federated chapter on writer epochs as a re-homing procedure: freeze, export, verified import, epoch activation, rollback by epoch. Decision 6 is unanswerable from the book without it.
2. **The ledger in the other direction.** The release ledger meters the customer's data leaving the room; the provider's implementation leaking through the customer's queries is the same ledger with the roles swapped and is unwritten. Decision 2 needs it before a provider-IP claim can be graded at all.
3. **Dispute windows, partial work, and refunds.** Bonded Commons gives conservation and 2-of-3 settlement; the economy gives prices. Neither gives the time and arithmetic of a dispute. Decision 4 needs a short section.
4. **A constitution for the registry.** Who may suspend a publisher, under what review, with what appeal. Decision 5's emergency path.
5. **One label scheme.** The brief's five evidence labels and the book's five assurance modes and four statement kinds should be one table in the implementation-boundary appendix, so that a product badge, a roadmap item, and a chapter claim all speak the same words.
