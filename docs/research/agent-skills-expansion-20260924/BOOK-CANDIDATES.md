# Book placement ledger — initial researched candidates

Planning only, 2026-09-24. No manuscript changes. Source authority and exact eight-chapter hashes: [manuscript-snapshot.json](manuscript-snapshot.json). The active primary working files were read only; they differ from this campaign branch. This ledger does not establish global novelty or validate a proposed product.

## Candidate 1: Distinguish the four graphs of agent work

Origin: Terra/Luna preparation for `coordination-topology-architect`, `multi-agent-coordination` and `agentic-patterns`. Separate task dependencies, message routing, authority delegation, and effect mediation. A tree-shaped plan can run through a shared event bus under a single writer; identical planning graphs can have different enforcement boundaries.

Placement candidate: Chapter 4, `whitepaper/legible-swarm.tex`, after the four design questions (`sec:four-questions`, line 836) or as the bridge to authority (`sec:authority-rules`, line 904). Chapter 1 already distinguishes two delegation chains (line 973), advisory claims from sandboxing (line 2040), and provides a model-checked work unit (line 1767). Therefore this is a proposed comparative teaching device across existing mechanisms, not an entirely absent mechanism.

Reader question: Which edge says a task depends on another, which carries a message, and which permits a real effect? Worked example: two agents edit disjoint files but share one deployment credential. Draw separate dependency, communication, grant, and effect graphs; show that disjoint files do not establish disjoint effects. Check exercise: identify which graph changes when the transport changes. Trace exercise: revoke one grant while a queued message remains. Open exercise: compare topology choices at matched total budget on dependent and independent tasks.

Claim kind: design taxonomy and experiment hypothesis. No architecture is declared superior. Candidate evidence: Luna's primary-source review of task-dependent agent-system scaling; exact sources will be carried in the research report. The existing substrate study is scripted patch replay and does not establish LLM collaboration efficacy.

Draft figure contract: `draft/agent-four-graphs`. Four aligned small multiples over the same named actors/artifact; edge types explicitly labeled, no implication that all four relations are identical. Prefer a relation matrix or small multiples over one multicolored graph. Rejected form: a generic orchestration tree that silently conflates authority and information flow. Figure adaptation awaits finalized Mermaid input and source hash.

## Candidate 2: Unknown external effect as a recovery state

Origin: actor timeout/retry correction and `agentic-patterns` effect reconciliation. Placement candidate: Chapter 1 recovery story (line 715) or work-unit model (line 1767), cross-reference Chapter 5 continuation.

Existing coverage: Chapter 1 already has idempotency, effect and settlement journals (lines 1793–1836), external-effect caveat (line 2453), and pending operations in continuation capsules (line 2519); Chapter 5 also mentions an idempotency journal (line 2602). Classify as a worked counterexample/visual clarification of existing coverage, not a newly discovered concept.

Reader question: What is safe to do after a request times out but the remote service may have committed it? Worked trace: send operation key K; remote applies K; response is lost; successor queries K; existing receipt suppresses duplicate execution. Alternative: no authoritative query and no idempotency guarantee leaves the outcome unresolved. A timeout alone never proves failure. Transport delivery/fairness assumptions must be named separately from actor-model abstractions.

Claim kind: conditional protocol invariant; no exactly-once guarantee for arbitrary services. Diagram grammar: sequence diagram with the lost response and reconciliation, or a state machine with an explicit unknown state. Draft figure contract: `draft/unknown-effect-reconciliation`. Rejected form: timeout arrow directly to failure/retry. No manuscript insertion is authorized.

## Disposition: Claim-game arithmetic repair

This is a skill defect, not a novel Book candidate. The skill has an anti-coordination payoff matrix under a Prisoner's Dilemma label. Active Chapter 7 already has the correct PD table at lines 843–860: TT=(3,3), TF=(0,4), FT=(4,0), FF=(1,1). For that model, the three-round punishment decrement is 2 and the cooperation condition uses 2(delta+delta^2+delta^3), with root approximately .342508. Terra must verify strategy credibility and assumptions before adopting the worked example. No Book prose repair follows from this finding.

## Pending

The exhaustive catalog is complete. Further reviewed proposals and recurring-lead dispositions are in [BOOK-PLACEMENT-REVIEW.md](BOOK-PLACEMENT-REVIEW.md); remaining Terra candidates are still in progress. Each future item needs its originating skill/research source, manuscript search and passage readback, status (absent/extension/already covered/unsupported), exact placement rationale, evidence kind, worked example, evaluation needed, and figure contract. No claim that this initial ledger exhausts the campaign.
