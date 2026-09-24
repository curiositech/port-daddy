# Coordination foundations: Luna research lane 1

**Research accessed:** 2026-09-24. **Scope:** primary papers, official standards and author/publisher documentation for the 12 assigned canonical skills. Research-only; no repository edits. **Worktree verification:** `/Users/erichowens/coding/tmp/agent-skills-expansion-20260924`, branch `codex/agent-skills-expansion-20260924`, Git dir `/Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924`; clean at inspection. Local Port Daddy runtime remained untouched.

Each record identifies a concrete passage to revisit, a source-backed correction or extension, two different diagram concepts, and source limits. Search snippets were used to discover sources; the cited primary papers/docs below were opened and read where accessible. These findings support Terra drafting; they do not prove runtime behavior or Book novelty.

## 1. `agentic-patterns`

**Existing passage to improve.** “Rule of Three Passes,” 3–7 subtasks, reserve 30% context, re-decompose at 50% if confidence <0.5, and stop below 0.3 are written as generally applicable numerical rules without validation. The patterns already distinguish sequencing, error handling, context use and stop decisions, but the thresholds risk being mistaken for research results.

**Source-backed extension.** Label numbers as starting heuristics and require task-specific calibration. Distinguish plan-process measures (calls, tokens, elapsed time, retries) from outcome measures (correctness, verified completion, harm, recovery). Add a stop/reconcile state for a remote or local write whose result is unknown; do not retry an uncertain non-idempotent action until authoritative state is checked.

**Sources.** Yao et al., [“ReAct: Synergizing Reasoning and Acting in Language Models”](https://arxiv.org/abs/2210.03629), opened: interleaving reasoning and actions is an evaluated approach on selected question-answering and interactive tasks, not a universal agent loop. Schick et al., [“Toolformer”](https://arxiv.org/abs/2302.04761), opened: self-supervised tool-use learning, with evaluations on the reported tool tasks, not evidence for the skill’s context percentages. [“Towards a Science of Scaling Agent Systems”](https://arxiv.org/abs/2512.08296v3), opened abstract: a controlled 260-configuration preprint reports task/topology-dependent gains, coordination overhead, error amplification and some degradation on sequential tasks. Treat its claims as preliminary, bounded experimental evidence.

**Diagram concepts.** (1) Agent loop with `effect unknown -> query authoritative state -> resume/retry/escalate`; (2) evaluation matrix comparing baseline and agent policies at fixed task set and resource budget. Convert relevant ASCII cycles, rather than adding another generic flowchart.

**Book candidate.** A worked “unknown external effect” case could make the skill’s useful effect-reconciliation rule tangible. Candidate only; scan the manuscript before claiming novelty.

## 2. `multi-agent-coordination`

**Existing passage to improve.** The “industry-standard” worktree claim and statement that merge conflicts scale quadratically, with eight agents producing dozens, have no cited evidence. The file correctly warns that worktrees/claims do not enforce external action boundaries, but current lifecycle prose still risks treating timeout/salvage as proof of an abandoned agent.

**Source-backed extension.** Replace unsupported scaling rhetoric with a testable hypothesis. Prespecify equal task set, model, grants, acceptance tests, and total token/time/retry budget; compare single-agent, isolated-worktree and coordinated conditions. Report valid completion, regressions, integration time, duplicate work, external resource contention and coordination overhead. Reconcile integration against the current base immediately before merge. Distinguish checkout isolation from shared service/credential/effect isolation.

**Sources.** [“Towards a Science of Scaling Agent Systems”](https://arxiv.org/abs/2512.08296v3), opened abstract (v3): preliminary results across 260 configurations show multi-agent effectiveness depends on task and topology, including fixed-budget overhead and sequential-task degradation. Pan et al., [“AgentCoord: Visually Exploring Coordination Strategy for LLM-based Multi-Agent Collaboration”](https://arxiv.org/abs/2404.11943), opened body: a 12-user study found its visual tool helped participants design coordination strategies; this supports legibility/design support, not improved task-success claims. Git worktree and hosted merge-queue semantics should be cited from their current official Git/GitHub docs when the corresponding implementation claims are retained; these sources were not needed to justify the research extension.

**Diagram concepts.** (1) Isolation/claims/enforcement/evidence/integration layers with explicit boundaries; (2) controlled evaluation design showing common inputs/budget, treatment topologies and outcome measures. Convert the existing ASCII layer stack and lifecycle sketch; avoid claiming a general conflict-count curve.

**Book candidate.** An equal-budget test protocol for deciding when multi-agent coordination helps may be a reusable contribution. Novelty is unverified pending manuscript review.

## 3. `coordination-topology-architect`

**Existing passage to improve.** The skill has a useful primary topology selection tree and four-plane check (planning dependencies, communication, authority, execution substrate). Its taxonomy should be framed as design hypotheses, not empirically validated universal categories or worker-count prescriptions.

**Source-backed extension.** Make the single-agent baseline explicit before selecting complexity. For each candidate topology, state what controls eligibility/routing, shared state, authority, message evidence and stop condition; then compare at equal budget. The scaling study supports task dependence but does not validate this exact named taxonomy. The loaded-reference table is a promise to read references, not evidence that those references prove effectiveness.

**Sources.** [“Towards a Science of Scaling Agent Systems”](https://arxiv.org/abs/2512.08296v3), opened abstract (v3; 260 configurations): supports task-/topology-dependent testing and cost accounting as a hypothesis-generating preprint. Pan et al., [“AgentCoord”](https://arxiv.org/abs/2404.11943), opened body: task/object dependency graphs and interactive user refinement make a relevant design precedent; its 12-person usability study is not topology-performance evidence. Agha, Mason, Smith & Talcott, [“Towards a Theory of Actor Computation”](https://osl.cs.illinois.edu/publications/conf/concur/AghaMST92.html), opened author-hosted abstract: formalizes open distributed actor systems, relevant to keeping runtime communication distinct from a planning graph.

**Diagram concepts.** (1) Four-plane graph showing that planning, communication, authority and execution edges may differ; (2) a native comparison of workflow state machine, blackboard shared-state graph and swarm discovery/convergence. The current Mermaid selector remains useful as a third overview.

**Book candidate.** A four-plane topology audit and equal-budget baseline may be a reusable design method. Do not claim new contribution before manuscript scan.

## 4. `agentspeak-bdi`

**Existing passage to improve.** “A system with only one active intention is not really exploiting the architecture” is categorical. Concurrent/suspended intentions are implementation choices, not a criterion for whether something is BDI. “Formalize upward” needs to retain the source’s important caveat: theory is necessary but not adequate by itself.

**Source-backed extension.** Add one execution trace: event arrives; belief update invalidates a guard; candidate plans are enumerated; `SO` chooses or reports none; `SI` schedules/suspends intentions under an explicit deadline/commitment rule; failure is posted and propagated. Name which choices are AgentSpeak/Jason semantics versus local policy. Tie a claimed strategy to an observable trace and domain acceptance test.

**Sources.** Rao & Georgeff, [“BDI Agents: From Theory to Practice” (AAAI/ICMAS 1995)](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf), opened full paper: explicitly discusses real-time responsiveness, practical simplifying assumptions, configurable commitment strategies, and limits on reasoning time; says BDI attitudes are necessary though not adequate for the domains considered. [Jason project documentation](https://github.com/jason-lang/jason), opened: Jason is an interpreter for an extended AgentSpeak and implements operational semantics; this is one concrete runtime, not the only BDI semantics.

**Diagram concepts.** (1) Interpreter transition cycle with event/plan/intention selection and failure; (2) intention commitment state machine with guard-valid, suspended, reconsidered, succeeded and failed outcomes. Current flowchart covers selection; add semantics and commitment behavior.

**Book candidate.** No candidate beyond a concrete BDI trace; assess against existing BDI chapter content first.

## 5. `agha-actor-model`

**Existing passage to improve.** “Message delivery is guaranteed but ordering is not assumed,” “supervisor detects failure via missing replies,” and blind resend after timeout overstate what the abstract model gives. A timeout alone cannot distinguish a crash from delay. “Mutual exclusion is free” and the assertion that hard real-time requires synchronous messaging are unsupported and should be removed or precisely scoped.

**Source-backed extension.** State delivery/progress only under named runtime, transport, fairness and failure assumptions. Mark timeout as `unknown`, then define idempotency, correlation IDs, deduplication, retry authority and recovery state. Separate actor-model semantics (send/create/behavior replacement; encapsulated state) from Erlang/OTP supervision policy and from the end-to-end application protocol. Retain shared-memory/lock designs as legitimate alternatives where that substrate is required.

**Sources.** Agha, [*Actors: A Model of Concurrent Computation in Distributed Systems* (MIT Press, 1986)](https://mitpress.mit.edu/9780262511414/actors/), opened publisher record: gives the primary actor model framing. Agha, Mason, Smith & Talcott, [“Towards a Theory of Actor Computation”](https://osl.cs.illinois.edu/publications/conf/concur/AghaMST92.html), opened author-hosted abstract: formal operational semantics and open-system interfaces. [“Behavioural Types for Actor Systems”](https://arxiv.org/abs/1206.1687), opened: eventual message handling/deadlock freedom is a theorem for well-typed, balanced systems under that paper’s formal model, not an unconditional actor guarantee. [Erlang/OTP Supervisor Behaviour](https://www.erlang.org/docs/17/design_principles/sup_princ.html), opened: gives concrete restart strategies and restart-intensity caps; implementation policy is distinct from model axioms.

**Diagram concepts.** (1) Request timeout -> `unknown` -> reconcile/cancel/retry/replace branches; (2) supervisor restart strategy and restart-intensity limit linked to application recovery and durable state. Avoid implying timeouts prove failure.

**Book candidate.** An “unknown is a state” protocol case may complement existing fault-tolerance treatment; novelty unverified.

## 6. `fipa-00025-interaction-protocol-library`

**Existing passage to improve.** The file contains a second YAML-like skill wrapper embedded beneath its actual frontmatter. “FIPA explicitly acknowledges” a long list of exception cases needs an exact standards clause: the FIPA originals `fipa00025`, `fipa00029`, and `fipa00061` could not be fetched from fipa.org during this research. The skill also asserts that pre-specified protocols scale better and are “far more” inspectable/composable/debuggable without a bounded evaluation. Do not state these as universal properties.

**Source-backed extension.** Repair the entrypoint so it has one coherent schema and explicit source/version provenance. Separate communicative-act semantics, protocol-state machine, message envelope/conversation identifiers, transport reliability, domain content/ontology and conformance tests. A protocol names a nominal interaction structure; specify which retry, timeout, cancellation, duplicate and out-of-order behavior is defined by the exact protocol/version, transport, or local profile. FIPA ACL itself does not establish conformance testing as solved.

**Sources.** [FIPA Communicative Act Library Specification XC00037H (archived PDF)](https://jmvidal.cse.sc.edu/library/XC00037H.pdf), opened full text: defines normative act semantics; explicitly says unambiguous conformance testing is not solved in the specification. [FIPA Interaction Protocol Library XC00025D (archived copy)](https://citeseerx.ist.psu.edu/document?doi=e772d3fb25d0edc5d39caed97dc1c21841935d97&repid=rep1&type=pdf), search-result metadata confirms experimental status/date; PDF open failed, so details were not relied upon. [JADE v4.6 management ontology docs](https://jade.tilab.com/doc/api/jade/domain/FIPAAgentManagement/package-summary.html), opened: an implementation’s mapping to a particular FIPA version is a useful implementation/provenance comparison, not a normative source.

**Diagram concepts.** (1) Exact versioned protocol state machine (FIPA CNP); (2) overlay that maps nominal states to timeout/cancel/duplicate/late-message handling and names which layer owns each rule. The current many ASCII diagrams can be replaced selectively; do not simply reproduce one flowchart twice.

**Book candidate.** A protocol-conformance versus transport/effect boundary may be valuable, but check existing interoperability chapters.

## 7. `fipa-00023-agent-management`

**Existing passage to improve.** The thresholds “single org <50 agents,” federation query depth ≤3, mandatory AMS read before every call, AMS state transition to `Unknown` on timeout, AMS validation of address reachability, and advice to retain DF services through restart appear local policy, not established FIPA requirements. The FIPA source URL could not be fetched by the web reader; these claims must be mapped to exact SC00023K clauses before being labeled normative.

**Source-backed extension.** Split “FIPA-defined” from “deployment profile.” Preserve the meaningful AMS/DF/AID distinction, then specify local discovery topology, stale-state lifetime, timeout uncertainty, authority to mark lifecycle state, idempotent registration and migration resolution. Any registry size/search-depth policy needs benchmark and privacy/authority constraints; no universal count was evidenced.

**Sources.** [FIPA Agent Management SC00023K](https://www.fipa.org/specs/fipa00023/SC00023K.html), canonical target, inaccessible during this run (direct web open returned Internal Error). [JADE v4.6 FIPA management package docs](https://jade.tilab.com/doc/api/jade/domain/FIPAAgentManagement/package-summary.html), opened: maps AMS/DF ontology objects and operations to an implementation. [FIPA Abstract Architecture spec index reference](http://www.fipa.org/specs/fipa00001/SC00001L.html), found via standards bibliography; original endpoint availability not verified, so use as a pointer only.

**Diagram concepts.** (1) Normative platform roles (agent/AMS/DF/ACC) and AID/address relationship; (2) local fault/recovery overlay showing stale-state, `unknown`, re-registration and rediscovery without mislabeling those as standard lifecycle transitions.

**Book candidate.** No new candidate established; the standards/runtime authority split may already exist in governance chapters.

## 8. `smith-1980-contract-net-protocol` (identity defect)

**Existing passage to improve.** Skill path/frontmatter/description claim Reid G. Smith Contract Net, but H1/body teach Charrier, Ouchet & Schwarzentruber “Big Brother Logic” and epistemic reasoning. `_book_identity.json`, `_raw_response.md`, references and diagrams in this directory duplicate the Big Brother Logic content in `skills/charrier-et-al-big-brother-logic/`. This is a source/catalog identity collision, not a content tweak. The actual CNP has partial sibling coverage in `skills/bellifemine-2007-jade-fipa` and `skills/wooldridge-multiagent-intro/references/negotiation-and-resource-allocation-mechanisms.md`.

**Corrective recommendation.** First reconcile catalog/index/`_book_identity.json`/diagram aliases and duplicate Big Brother skill content. Preserve the distinct epistemic material under a verified Charrier et al. identity/reference with its own source provenance; do not overwrite or discard it. Then reconstruct the Smith 1980 skill from Smith’s paper, distinguishing the original protocol from FIPA’s later CNP. Cover task announcement slots (eligibility, task abstraction, bid specification, deadline), contractor task ranking/bids, manager bid evaluation/award, task-specific rules, subcontracting, rejection/expiry/no-bid outcomes and limits. Do not describe contract bidding as truthfulness/incentive compatibility; Smith’s task-sharing negotiation is not a truth-telling mechanism.

**Sources.** Reid G. Smith, [“The Contract Net Protocol: High-Level Communication and Control in a Distributed Problem Solver” (IEEE Transactions on Computers, 1980)](https://www.reidgsmith.com/The_Contract_Net_Protocol_Dec-1980.pdf), opened and read full author-hosted paper. It explicitly assumes asynchronous, loosely coupled nodes plus a lower-level reliable transport; describes local manager/contractor roles and mutual selection; makes task/bid evaluation task-specific; and discusses global clock synchronization/deadline assumptions and the tradeoff around binding bids/multiple awards. [FIPA Contract Net SC00029H](http://www.fipa.org/specs/fipa00029/SC00029H.html), canonical target, inaccessible in this run; do not conflate it with Smith’s 1980 message/protocol. Smith’s bibliography page [reidgsmith.com](https://www.reidgsmith.com/) verifies the author’s 1980 publication entry and linked PDF.

**Diagram concepts.** (1) Original task announcement -> eligibility filter -> bid -> task-specific manager award/reject -> result/failure; (2) manager/contractor role changes and subcontract tree, annotated with deadlines, binding bids, and no-bid handling.

**Book candidate.** No claim of novelty. Correcting the skill identity and checking if the manuscript already presents CNP is prerequisite.

## 9. `game-theoretic-agent-incentives`

**Existing passage to improve.** Its printed payoff matrix does not match the intended Prisoner’s Dilemma in the current Book. Skill matrix: `T/T=(3,3), T/F=(1,4), F/T=(4,1), F/F=(0,0)`. This is anti-coordination: versus T, F pays 4>3; versus F, T pays 1>0. Neither action dominates, and the pure equilibria are `(T,F)` and `(F,T)`, not `(T,T)` or `(F,F)`. Current Book matrix (verified by root; Book manuscript itself is outside this lane) is `T/T=(3,3), T/F=(0,4), F/T=(4,0), F/F=(1,1)`, which is a Prisoner’s Dilemma. The skill’s 8.1 punishment loss and `delta >= .53` threshold do not match that Book game.

**Source-backed extension.** Align example to the Book matrix, if that is the intended source of truth. For its stated three-round mutual-defection punishment, unilateral defection gains `4−3=1`; each punishment period loses `3−1=2`; total discounted loss is `2(δ+δ²+δ³)`. Deterrence for that one deviation requires `2(δ+δ²+δ³)>1`, with root ≈0.342508; grim-trigger threshold is 1/3. State all assumptions: public and correct action observation, continuation payoffs, one-shot unilateral deviation, strategy use, no identity exit/collusion, and credible enforcement of the continuation rule. Do not infer real-agent incentive compatibility from an illustrative repeated game. Also distinguish CE’s explicit signal distribution and obedience constraints from an ordinary daemon scheduler; distinguish equilibrium existence/reachability from efficiency and fault robustness.

**Sources.** Aumann, [“Subjectivity and Correlation in Randomized Strategies” (1974), author-hosted PDF](https://ma.huji.ac.il/raumann/pdf/31.pdf) (Journal of Mathematical Economics 1(1):67–96; DOI 10.1016/0304-4068(74)90037-8; publisher metadata also available at https://www.sciencedirect.com/science/article/abs/pii/0304406874900378), opened full text: models subjective randomization and correlation through a state-space/information structure; use exact obedience constraints, not “daemon signal implies CE.” Fudenberg & Maskin, [“The Folk Theorem in Repeated Games with Discounting or with Incomplete Information” (1986)](https://maskin.scholars.harvard.edu/publications/folk-theorem-repeated-games-discounting-or-incomplete-information), opened author publication record; it is an infinite-repetition/sufficient-patience theorem with specified assumptions, not blanket proof for finite tasks. [INFORMS, “Conflicting Congestion Effects in Resource Allocation Games”](https://pubsonline.informs.org/doi/10.1287/opre.1120.1051), opened: model-specific resource games may lack pure NE; best-response convergence is not automatic and no universal worst-case PoA bound exists. (Primary manuscript correction path: internal Book matrix, not a novelty candidate.)

**Diagram concepts.** (1) Game specification -> best-response table -> equilibrium set -> deviation check; (2) public-signal device -> recommendation distribution -> per-player/per-recommendation obedience inequalities. Replace duplicated text trees with correct game-specific tables/equations.

**Book candidate.** None from this repair: aligning skill math with the already corrected Book is reconciliation, not novelty.

## 10. `mechanism-design-for-agent-labor`

**Existing passage to improve.** Numerous unreferenced policy constants (bond multipliers 1/3/10/25, durations, reputation bands, 100 tasks/day, participation/failure percentages, 10% audits, 2-of-3 oracles) are asserted as robust thresholds. The revelation principle is overgeneralized as making any strategic mechanism truthful; the Vickrey truth-telling claim is generalized from narrow single-item private-cost assumptions to heterogeneous task labor. Bond inequalities omit distributions, outside options, risk aversion, liquidity, false positives and ability to pay. “2-of-3” says nothing unless source errors/independence/capture and appeal policy are modeled.

**Source-backed extension.** Require a complete mechanism tuple before any IC conclusion: type/value/cost domain, reports, allocation, transfers/bond lock/release, utility, timing, commitment, information, and solution concept. Derive individual rationality, budget feasibility, incentive constraints and social objective separately. Mark all numbers as illustrative parameters until calibrated through a declared threat model and sensitivity analysis. Bonds cannot substitute for access controls against exfiltration (the existing caveat is sound); differentiate risk transfer, deterrence and payment escrow.

**Sources.** Myerson, [“Optimal Auction Design” (1981), INFORMS](https://pubsonline.informs.org/doi/fpi/10.1287/moor.6.1.58), opened publisher abstract and [full paper mirror](https://www.cs.princeton.edu/courses/archive/spring10/cos444/papers/myerson81.pdf): addresses a seller, one object, multiple buyers and private willingness to pay; not generic labor-bond pricing. Vickrey, [“Counterspeculation, Auctions, and Competitive Sealed Tenders” (1961)](https://www.cs.princeton.edu/courses/archive/spr09/cos444/papers/vickrey61.pdf), opened paper: foundational auction analysis; derive the exact reverse-auction assumptions before applying truthfulness to bids for work. [Nobel 2007 mechanism-design scientific background](https://www.nobelprize.org/prizes/economic-sciences/2007/advanced-information/), opened: revelation principle narrows analysis to direct incentive-compatible mechanisms under its model, simplifying a proof; it is not a guarantee that truth is an equilibrium in an arbitrary proposed process. These primary sources bound, rather than validate, the skill’s market rules.

**Diagram concepts.** (1) Mechanism definition and derivation pipeline: types -> reports -> allocation/transfers -> utility -> IC/IR/budget/objective; (2) settlement threat model with independent evidence, oracle incentives, disagreement/appeal and finality states (not a bare 2-of-3 vote).

**Book candidate.** A worked mechanism audit distinguishing deterrence, screening, insurance and access control could be valuable; verify against existing Bonded Commons text before proposing.

## 11. `ostrom-commons-governance`

**Existing passage to improve.** “Ostrom proved…” and “8 principles map directly” overstate transfer from empirical natural-resource institutions to software/agent commons. Binary labels such as “satisfied if >=3 sanction levels,” charging by resource duration, auctions, immutable public logs, or an arbiter are the skill author’s design proposals, not tests Ostrom established. “Principle 2” is not simply charge a bond: original principles concern congruence between appropriation/provision rules and local conditions. The skill’s “NOT for environmental policy” boundary hides the source domain needed to judge the analogy.

**Source-backed extension.** Make this an explicit analogy/audit tool: first classify the resource and affected community; identify who appropriates, who provides/maintains, resource boundaries, external authorities and scale; then ask what evidence bears on each principle. Use statuses `evidence`, `partial`, `unknown`, `not applicable` and explain why; avoid automatic pass/fail thresholds. Measure outcomes and failure/fragility, and treat institutional fit/adaptation as central. The empirical transfer from fisheries/water/grazing to files/ports/API quotas is a hypothesis needing local validation.

**Sources.** Ostrom, [*Governing the Commons* (1990), Cambridge Core official listing/extracts](https://www.cambridge.org/core/books/governing-the-commons/7AB7AE11BADA84409C34815CC288CD79/listing), opened: original CPR settings and chapters; Chapter 3 says long-enduring systems’ rules changed over time and could not be made permanently “right”; Chapter 5 contrasts success and failure and notes nearby rules may not transfer across scale; Chapter 6 says cases were small-scale (largest ~15,000 appropriators), some but not all self-organized, often with mixed public/private instruments. Ostrom, [“Understanding the Diversity of Structured Human Interactions,” *Understanding Institutional Diversity* (2005), chapter PDF](https://assets.press.princeton.edu/chapters/s8085.pdf), opened: distinguishes resource/good classes using excludability and subtractability; **this is not** a chapter of *Governing the Commons*. Ostrom, [“A General Framework for Analyzing Sustainability of Social-Ecological Systems” (Science, 2009)](https://pubmed.ncbi.nlm.nih.gov/19628857/), opened PubMed author/paper metadata and abstract: framework identifies interacting variables affecting likelihood of self-organization, rather than a universal checklist guarantee.

**Diagram concepts.** (1) Resource classification using excludability × subtractability, with continuous dimensions acknowledged; (2) context-to-evidence audit mapping a candidate principle to local conditions, evidence, uncertainty and outcome/failure observation. Avoid eight repetitive pass/fail trees.

**Book candidate.** A precise resource-analogy boundary and “unknown/not applicable” governance audit could strengthen existing commons material; check current Book chapters first.

## 12. `resource-bounded-planning`

**Existing passage to improve.** Existing text wisely says no universal override percentage, but quality gates still demand a target range. “Hours -> action detail / days-weeks -> task detail / long horizon -> goal detail” and expected gain > reconsideration cost lack grounding as general thresholds. The skill correctly treats computational opportunity cost as central; measure the quality/time tradeoff instead of inferring a fixed rule from horizon labels.

**Source-backed extension.** Specify whether the model is descriptive, prescriptive or normative; name quality score, deliberation/action budgets, environment change rate, cost of stale assumptions and escalation behavior. Calibrate commitment depth and override triggers on held-out scenarios at equal resource budgets, reporting quality, latency, replans, rework and bad irreversible actions. Do not conflate “satisficing” with arbitrary lower quality or a universally rational stop threshold.

**Sources.** Bratman, Israel & Pollack, [“Plans and Resource-Bounded Practical Reasoning” (1988)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8640.1988.tb00284.x), publisher record and abstract opened: title, authors, journal, volume 4, pages 349–355, September 1988, and DOI verified; abstract states that plans constrain further practical reasoning. Full text is unavailable, so do not attribute details beyond that abstract. Simon, [“A Behavioral Model of Rational Choice” (1955)](https://doi.org/10.2307/1884852), primary work cited by author/SEP; full article not accessed. [Stanford Encyclopedia of Philosophy, “Bounded Rationality”](https://plato.stanford.edu/entries/bounded-rationality/), opened and revised 2024: distinguishes varied descriptive/normative/prescriptive accounts and says the object and standards of evaluation must be specified; secondary synthesis, used only for that framing.

**Diagram concepts.** (1) Plan-detail/refinement ladder keyed to volatility, dependency readiness and cost of stale commitment; (2) quality-vs-deliberation-cost calibration curve with act, continue, override and escalate/abstain regions. Current Mermaid flowchart can remain as the control overview.

**Book candidate.** A calibration protocol for commitment depth and revision cost may complement general bounded-rationality treatment; compare against existing Bratman material before suggesting novelty.

## Cross-record provenance and diagram notes

- `smith-1980-contract-net-protocol` identity mismatch was confirmed on `origin/main`; preserve the epistemic material and repair identity/catalog provenance before Terra integrates content. The actual Smith paper was read from the author site, as cited above.
- For all standards, distinguish the standard’s literal state/message semantics from local reliability, authorization and deployment policy. FIPA official pages were inaccessible to the web reader; archived copies and implementation docs are marked as such above.
- Mermaid requests should produce semantically different forms (e.g. state machine, component/authority topology, quantitative evaluation design, matrix), not two duplicate flowcharts. The most obvious ASCII conversion candidates are enumerated per skill; diagrams belong in the skill after semantic correction.
- **Novelty is not claimed.** Candidate ideas above are leads for manuscript reconciliation, not findings that a concept is absent from the Book.
