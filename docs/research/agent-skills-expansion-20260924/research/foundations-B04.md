# B04 — Agent architecture and MAS foundations research

Accessed 2026-09-24. Source scope: 11 new IDs in B04. `semantic-conflict-prediction` is intentionally not duplicated; see `research/evaluation-evidence.md` §6 for its tree-sitter claims, limitation/example and diagram guidance. This is a research/plan artifact, not mathematical verification of skill-bundled code. Repository stayed read-only.

Research standard: sheaf/topological terms below need an explicit finite complex, coefficient spaces, restriction maps, boundary orientation, observed cochain and exact objective before a “diagnostic” claim is credible. A topology invariant alone does not diagnose an observed system. Preprints are attributed as preprints. An illustrative numerical result is not treated as independently reproduced.

## 1. sheaf-cohomology-multiagent-debug

**Read:** complete `skills/sheaf-cohomology-multiagent-debug/SKILL.md`; targeted refs `h1-as-settlement-obstruction.md`, `hansen-ghrist-2021.md`, `cellular-sheaves-for-engineers.md`, `dirichlet-energy-implementation.md`. The active skill asserts its CR theorem/formulas, diagnostic meanings, executable reference implementation, tree/topology blindness, and decision procedure in §§43–143, 220–270.

**Sources and evidence:** Hansen & Ghrist, [“Opinion Dynamics on Discourse Sheaves”](https://arxiv.org/abs/2005.12798) (2020 preprint; author PDF opened/read at [Penn](https://www2.math.upenn.edu/~ghrist/preprints/opinion.pdf); later SIAM Journal on Applied Mathematics 81(5), 2033–2060, 2021) models opinions/communication and sheaf-Laplacian diffusion; it does not establish this skill’s swarm monitor or settlement theorem. Hanks et al., [“Distributed Multi-agent Coordination over Cellular Sheaves”](https://arxiv.org/abs/2504.02049) (arXiv full abstract/source opened; nonlinear homological programs, ADMM, consensus/formation/flocking simulations; scope is its specified optimization model). Abramsky & Brandenburger, [“The Sheaf-Theoretic Structure Of Non-Locality and Contextuality”](https://arxiv.org/abs/1102.0264) (primary paper; sheaf obstruction applies to compatible local empirical models/contextuality, not arbitrary agent disagreement without a modeled measurement cover).

**Correction/decision rule:** Distinguish sheaf `H¹` (property of a chosen sheaf/space) from obstruction of the actual observed disagreement cochain to lying in `im(δ)`. Compute residual/harmonic component against the image of the exact coboundary matrix, disclose visibility assumptions, and attribute claims separately. A cycle can impose a consistency constraint; a bridge cannot. Rank deficiency/gauge freedom requires pseudoinverse/grounding, and every numerical “CR” depends on chosen norm, restriction maps, noise model and observability. The skill’s strong “theorem” and tree-blindness statements should be scoped to stated linear/cochain assumptions.

**Hand-check:** for a single scalar on a triangle, edge disagreement vector `g=(1,1,1)` under oriented incidence cannot be a gradient if signed sum around the cycle is nonzero; on a path, any edge vector is a gradient, so residual is zero. This illustrates only the complex’s algebra, not proof of real swarm deception.

**Diagrams:** (1) data pipeline: agent reports → visibility mask → chosen complex/stalks/restrictions → solve `min_x ||g_known-δx||` → residual plus epistemic scope; (2) triangle vs path chain-complex comparison, with oriented edges and the cycle-sum constraint. They teach different ideas.

**ASCII inventory:** §220 supervisor routing and §78? diagrams/decision descriptions; Python code in §143 and live TS in §272 are implementation blocks, not ASCII diagrams. Preserve code, convert routing decision to Mermaid, add cycle/path matrix diagram; don’t visualize abstractions without edge orientation.

**Book candidate:** a minimal cycle/path counterexample that shows why topology gives a possible constraint but only observed, relayed measurements give evidence. Check current Book before suggesting novelty.

## 2. shoham-leyton-brown-2009-mas-foundations

**Read:** complete active skill and all six references (`bounded-rationality-cooperation`, `computational-equilibrium-complexity`, `distributed-constraint-solving`, `mechanism-design-constrained-reality`, `mechanism-design-impossibilities`, `representation-and-tractability`). It presents three domain examples §§128–177 and generic quality gates.

**Sources:** Shoham & Leyton-Brown, [*Multiagent Systems: Algorithmic, Game-Theoretic, and Logical Foundations*](https://www.masfoundations.org/) (author site identifies 2009 Cambridge book and coverage; full book PDF is an uncorrected manuscript, not use as page-exact final copy); Wooldridge, [*An Introduction to MultiAgent Systems*, 2e contents](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/Contents.html) (author site; broad topics and scope). Nisan & Ronen, [“Algorithmic Mechanism Design”](https://www.cs.cornell.edu/home/kleinber/arms/focs01.pdf) (primary conference paper; strategic reports change algorithm design, not all procurement is truthful by default). For market-specific use, Xia & Muthukrishnan, [“Revenue-Maximizing Stable Pricing in Online Labor Markets”](https://doi.org/10.1609/hcomp.v5i1.13299) (AAAI HCOMP primary paper; assumptions and guarantees are mechanism-specific).

**Correction/extension:** Treat book-derived “foundations” as source-map, not as a source of universal operational prescriptions. Every game example must state players, type/information model, strategy space, utility/payoff signs, action timing, equilibrium concept and solution method; separate existence from efficient computation and behavioral prediction. The active skill’s “bounded rationality” example should not use one finite-automaton result to infer general emergence of cooperation; indicate repeated-game horizon, observation and memory assumptions. Verify example arithmetic, not just narrative.

**Hand-check:** a 2×2 allocation game with two workers and one job: report bids, actual private costs, winner/payments, utility under truthful and one misreport. Check feasibility/incentive assumptions separately; an efficient allocation can fail truthfulness or budget feasibility.

**Diagrams:** (1) game-model worksheet from environment/type information → strategies → utility table → solution concept → computational question; (2) mechanism execution sequence with report, allocation, payment and realized utility, marking which properties need proof.

**ASCII inventory:** decision material §§34–95 and failure modes/quality gates are prose/tables; examples include payoff matrices. Convert actual trees/matrices to Mermaid/table where legibility improves; do not add another concept map. Preserve formula/reference prose and validate each example’s payoff table.

**Book candidate:** a “four claims, four proofs” comparison separating equilibrium existence, computability, incentive compatibility and welfare. Established material; novelty unclaimed.

## 3. solely-responsible-agent

**Read:** entire SKILL.md and `sole-responsibility-patterns.md`, `port-daddy-state-surfaces.md`, `role-expansion-playbook.md`.

**Sources:** Wooldridge, [*An Introduction to MultiAgent Systems* (author site)](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/) (autonomy means control over own behavior in pursuit of goals; not a theorem that responsibility should be singular); Hutchins, [*Cognition in the Wild*](https://mitpress.mit.edu/9780262581462/cognition-in-the-wild/) (publisher source for distributed cognition across people/artifacts; responsibility and cognition can span a system); NIST, [SP 800-53 Rev. 5, AC-5 Separation of Duties / roles](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) (official control catalog; split duties when risk calls for it, so one-owner-per-concern must not collapse requester, approver, executor and verifier).

**Correction:** “Solely responsible” is a design heuristic for legible operational ownership, not evidence that one agent should own every authority surface. Define one accountable coordinator per bounded concern while deliberately separating high-risk approval, effect custody, evidence verification and fallback. A single durable “owner” can be SPOF, conflict of interest or overloaded actor. Quality gates should require an alternate/failover, authority ceiling, observable outputs, and conflict/dependency map.

**Example:** one release coordinator owns checklist and escalation; independent signer approves, deployment controller effects, monitoring service witnesses. Coordinator is responsible for choreography but cannot self-approve and attest its own successful deployment.

**Diagrams:** (1) RACI/authority matrix with one accountable coordinator but separated controls; (2) duty handoff lifecycle and backup/escalation path after owner unavailable.

**ASCII inventory:** design steps and owner tables in §§59–114, worked system example §158. Keep responsibility matrix tabular; make lifecycle/state model diagram. Don’t turn a “one owner” principle into a tree that hides shared dependencies.

**Book candidate:** contrasting “single accountable coordinator” and “single privileged actor” on the same operational responsibility; see accountability/assurance manuscript sections first.

## 4. state-of-cognitive-systems-engineering

**Read:** full active skill and decision references for RPD, task fallacy, automation surprise/coordination failure, knowledge elicitation and situated cognition.

**Sources:** Klein, [“A Recognition-Primed Decision (RPD) Model of Rapid Decision Making”](https://doi.org/10.1016/0001-4575(93)90059-4) (original journal article; experience-based situation recognition and mental simulation in studied naturalistic settings); Endsley, [“Toward a Theory of Situation Awareness in Dynamic Systems”](https://doi.org/10.1518/001872095779049543) (primary human-factors theory; perception/comprehension/projection are defined constructs, not a plug-in scalar for LLMs); Woods, [“Four concepts for resilience and the implications for the future of resilience engineering”](https://doi.org/10.1016/j.ress.2015.03.018) (primary article on resilient performance; no guarantee prompt additions encode expertise).

**Correction:** Avoid universalizing findings from expert/human decision settings into all agent-pipeline failures. A model-generated “situation type” is a hypothesis, not demonstrated recognition primed decision making. Make operators name cues, expected trajectory, anomaly and available recovery actions, then compare against logged situations. “Tacit knowledge cannot be captured” should be limited: elicitation is difficult and incomplete, not impossible. Measure surprises and recovery in target workflow.

**Example:** In a staged deployment, expert recognizes canary saturation from queue depth and error-rate combination; hand-coded fixed sequence misses a novel dependency. Log cues and alternate diagnosis to test whether agent route adapts correctly.

**Diagrams:** (1) RPD cue→story→mental simulation→act/monitor loop, with mismatch-triggered reassessment; (2) human/agent/system representation alignment across task handoff (what each observes, assumes, and can change).

**ASCII inventory:** §§60–111 mental models and §113–147 decision framework/table; references long. Convert RPD loop and handoff representation, retain reference decision tables. No numeric performance implication absent study.

**Book candidate:** one unexpected condition demonstrates why the operator’s cues and action envelope matter more than a fixed SOP; check CSE material already present.

## 5. wang-2023-voyager

**Read:** full skill and linked references/code descriptions in the entrypoint.

**Sources:** Wang et al., [“Voyager: An Open-Ended Embodied Agent with Large Language Models”](https://arxiv.org/abs/2305.16291) (primary paper abstract/full source opened; Minecraft, GPT-4 black-box, automatic curriculum + executable skill library + iterative code feedback; its reported 3.3×/2.3×/15.3× comparisons are specific to paper’s tasks/baselines); official [Voyager project and code/prompts](https://voyager.minedojo.org/) (primary implementation resource; supports reproducibility inspection, not general transfer).

**Correction:** The learned “skill” is executable Minecraft code with environment feedback, not merely a textual procedure; do not generalize its persistent skill library or “lifelong” result to other environments without task-transfer evidence. Report model/API version, world, prompt/code release, seed, budget, comparator and metric. Environment success/self-verification is not independent correctness if the same agent checks itself.

**Example:** Test learned `craft wooden pickaxe` in new world: if inventory precondition absent, skill fails; retrieval should state preconditions and observable completion (item appears in inventory), then replan/repair.

**Diagrams:** (1) curriculum → code generation → sandbox execution → environment error/success → skill-library retrieval loop; (2) skill artifact with preconditions/effect oracle/dependencies and transfer test to a fresh world.

**ASCII inventory:** skill prose/example flow is textual, references/code are implementation. Make loop and skill precondition/effect diagram; do not redraw paper’s figure unless simplifying and citing.

**Book candidate:** executable memory as callable capability with precondition/outcome tests, with a transfer failure. Established case study, not claimed novelty.

## 6. yao-2022-react

**Read:** full SKILL.md and its action/observation refs.

**Sources:** Yao et al., [“ReAct: Synergizing Reasoning and Acting in Language Models”](https://arxiv.org/abs/2210.03629) (primary paper; interleaves thought/action/observation; reported results are HotpotQA/FEVER, ALFWorld/WebShop with specified models/prompts, not a guarantee against hallucination); Google Research [author summary](https://research.google/blog/react-synergizing-reasoning-and-acting-in-language-models/) (authors explain action→observation grounding and reasoning→plan adaptation).

**Correction:** ReAct trajectories are a prompting/control pattern, not proof internal “reasoning” is faithful or a security boundary. Preserve externally observable action and tool result; never equate generated rationale with hidden cognition or authoritative evidence. Before using for consequential action, validate tool output and authorize at the tool/effect boundary.

**Example:** Search returns three snippets; agent’s next claim must be attributed to retrieved evidence, and an unsupported answer should trigger another search or abstain, not cite its own prior thought.

**Diagrams:** (1) Thought→Action→Observation→updated Thought sequence, distinguishing text from environment evidence; (2) provenance swimlane from task request to tool call/result and final assertion with source links.

**ASCII inventory:** likely trajectory code blocks, inspect when Terra edit; preserve textual trace format, convert only decision/loop diagrams. No ASCII was found from heading inventory; report that no standalone diagram was evident in active file beyond code.

**Book candidate:** same tool task with CoT-only vs action-grounded verification, emphasizing paper benchmark limitations and no unrun numerical claim.

## 7. yao-2023-tree-of-thoughts

**Read:** full skill and targeted search/evaluator/pruning references.

**Sources:** Yao et al., [“Tree of Thoughts: Deliberate Problem Solving with Large Language Models”](https://arxiv.org/abs/2305.10601) (primary paper; thought-unit branching, self-evaluation, search/backtracking; benchmarks Game of 24, creative writing, mini crosswords; results should remain bound to those tasks/prompts); official [authors’ code](https://github.com/princeton-nlp/tree-of-thought-llm) (prompts/implementation).

**Correction:** Search can increase calls, latency and evaluator-error compounding. A tree is not automatically a better search algorithm: branching, depth, thought granularity, value heuristic and termination control determine costs/results. LLM self-evaluation is a heuristic; avoid presenting pruning as admissible or optimal absent proof.

**Example:** Game of 24 with numbers `4, 4, 6, 8`: enumerate a few valid next arithmetic combinations; a heuristic pruning a low-scoring branch can discard a solution unless the heuristic has a completeness property. Keep an exact arithmetic verifier at leaves.

**Diagrams:** (1) search tree with expand/evaluate/prune/backtrack and token/query budget; (2) separation of generative proposal, heuristic ranking, exact task verifier and final answer.

**ASCII inventory:** search decision tree/code blocks from active skill; convert one tree with explicit heuristic/exact-oracle labels, retain equations. If reference diagram duplicates article, adapt rather than copy.

**Book candidate:** evaluator-guided search vs exact leaf checker, demonstrating why “best scored leaf” ≠ verified solution.

## 8. ai-wiley-wooldridge-an-introduction-to-multi-agent-systems

**Read:** full entrypoint and six listed refs on coordination, environment, hybrid architectures, negotiation, epistemic logic and commitments.

**Sources:** Wooldridge, [author book page and contents](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/) (2nd ed. 2009; chapter structure includes agents, interactions, resource allocation, bargaining, communication and coordination); Wiley [publisher listing](https://www.wiley-vch.de/en/areas-interest/computing-computer-sciences/an-introduction-to-multiagent-systems-978-0-470-51946-2) (edition/contents); Rao & Georgeff, [“BDI Agents: From Theory to Practice”](https://www.aaai.org/Papers/ICMAS/1995/ICMAS95-042.pdf) (primary conference paper; particular BDI architecture and formal model).

**Correction:** This skill is a modern applied guide attached to a textbook title; clearly separate Wooldridge’s source claims from added practices, and avoid “the book proves” claims without precise edition/chapter/page. Human/multi-agent concepts need operational definitions and when-not-to-use case. Check overlap with similarly named sourced/reference-only skill before duplication.

**Example:** two agents have incompatible plans for a shared resource; state whether architecture uses commitment protocol, auction, joint plan or shared constraint, then identify needed knowledge and message/failure assumptions.

**Diagrams:** (1) environment properties → agent architecture/interaction choice; (2) joint-action coordination timeline with partial local views and synchronization point.

**ASCII inventory:** decision trees and architecture tables in full skill; convert top-level choice tree and partial-view timing; retain reference tables. Distinguish source map from the active “how to use” content.

**Book candidate:** compact architecture choice by environment determinism, observability, reactivity and strategic agents; standard textbook synthesis, novelty unclaimed.

## 9. algebraic-topology-for-agents

**Read:** full 312-line skill and `simplicial-sheaf-primer.md`, `hodge-decomposition-derivation.md`. The entrypoint includes “tree blindness,” effective-resistance sensitivity, Hodge decomposition, legibility ratio, examples, quality gates.

**Sources:** Curry, [*Sheaves, Cosheaves and Applications*](https://arxiv.org/abs/1303.3255) (PhD thesis, primary mathematical exposition; definitions of cellular sheaves/cohomology); Hansen & Ghrist [discourse sheaves](https://arxiv.org/abs/2005.12798) (authors’ paper, primary applied sheaf-Laplacian/opinion model); Hanks et al. [distributed multi-agent sheaf coordination](https://arxiv.org/abs/2504.02049) (specific distributed convex/nonlinear optimization formulation). These do not establish an application-level “legibility ratio” or universal tree limitation.

**Correction:** Audit `Π_tree ≡ 0`, CR-1 closed form, Hodge projections and ratio against the exact defined matrices, spaces, signs, weighting and norm. A tree has `β₁=0` for ordinary simplicial first homology but can still have informative vertex/edge constraints; “mathematically blind” must mean only a specific cycle-obstruction detector has no cycle signal. Effective resistance formula needs Laplacian connectivity/grounding and weight model; Moore–Penrose solution alone does not establish monitoring semantics. Distinguish Betti number, sheaf cohomology, observed residual and statistical detection.

**Hand-check:** for triangle incidence `B`, calculate `g` edge residual and project onto `ker(Bᵀ)`; for path, `ker(Bᵀ)=0`. A nonzero cycle residual signals incompatibility with vertex potentials under this exact scalar model only.

**Diagrams:** (1) chain/cochain complex with matrix shapes, kernel/image and residual; (2) topological triangle/path observability example with exact observed edges and hidden edge.

**ASCII inventory:** §§65–114 action/topology decision trees, equations and §188 onward worked examples. Convert decision trees and topological complexes, but retain matrix/equation blocks. Mermaid can’t replace math notation; use labeled matrix/stalk diagram.

**Book candidate:** disambiguation diagram “topology possibility vs observed-data obstruction vs agent-world claim”; validate against Book’s existing R6 sheaf treatment.

## 10. charrier-et-al-big-brother-logic

**Read:** complete entrypoint and its references for Kripke models, distributed/common knowledge, public announcements, observer knowledge, model-checking/satisfiability and centralization tradeoffs.

**Sources:** Fagin, Halpern, Moses & Vardi, [*Reasoning About Knowledge*](https://mitpress.mit.edu/9780262562003/reasoning-about-knowledge/) (foundational formal treatment; epistemic operators are defined over possible-world/accessibility models); Halpern & Moses, [“Knowledge and Common Knowledge in a Distributed Environment”](https://doi.org/10.1145/42282.42283) (primary paper; common knowledge and coordination under message-delivery constraints); Plaza, [“Logics of Public Communications”](https://www.ijcai.org/Proceedings/89-1/Papers/040.pdf) (primary paper; public announcement updates model by eliminating worlds incompatible with announcement).

**Correction:** “Big Brother Logic” is not standard name of epistemic logic; say this is an application wrapper around standard epistemic logic unless source defines novel formalism (do not imply novelty). Truthful public broadcast does not always create common knowledge under unreliable/asynchronous delivery; public announcement model presumes everyone receives/observes event. Common knowledge is generally an infinite hierarchy; use bounded-depth/common-knowledge-under-protocol assumptions where appropriate. Runtime “epistemic verification” requires exact state/visibility model and sound observation mapping.

**Example:** Two agents each hear a one-to-one message “the door is open”; each knows the other knows only if receipt/ack is visible and ack delivery assumptions hold. A broadcast without delivery acknowledgments does not establish common knowledge.

**Diagrams:** (1) small Kripke worlds for two agents with accessibility edges before/after announcement; (2) nested knowledge/ack chain over asynchronous message trace, showing where common knowledge claim fails.

**ASCII inventory:** §20 partial-information decision tree, §51 recovery tree, Kripke models/examples in references. Convert these to Mermaid with worlds/edges not just flowchart, keep temporal/modal formula.

**Book candidate:** `K_i p`, `E_G p`, `C_G p` distinction on a lost final acknowledgment, with delivery assumptions. Classical concept; use as clarifier only.

## 11. decker-lesser-1995-gpgp-taems

**Read:** complete skill and seven references on commitment semantics, local constraint posting, mechanism families, overhead, subjective views, TAEMS relationships and termination.

**Sources:** Decker & Lesser, [“Designing a Family of Coordination Algorithms”](https://mas.cs.umass.edu/paper/30) (UMass author group publication entry with citation/PDF; GPGP algorithm family, deadlines, heterogeneous agents, varying information abstraction; empirical claims are simulation-task specific); Decker & Lesser, [original paper PDF](https://mas.cs.umass.edu/Documents/lesser/decker-94-14.pdf) (author-hosted primary conference paper; read abstract/body enough to validate algorithm family and simulation framing); Lesser, [“A Retrospective View of FA/C Distributed Problem Solving”](https://mas.cs.umass.edu/paper/153) (research-group primary retrospective context).

**Correction:** Do not portray GPGP as current universal optimal coordination or convert simulated coordination mechanisms into guarantees for modern LLM agents. It is a configurable family keyed to task relationships, agent views and coordination costs; each selected mechanism has communication/control assumptions. Separate task-structure vocabulary (TAEMS) from a coordinator that controls all agents. The active skill’s “commitments as social contracts” must name when commitment is advisory vs protocol-guaranteed.

**Example:** Two tasks where A enables B and another task independent. Under deadline, a constraint notice can justify delaying B; show message/latency cost and compare local scheduling absent that mechanism. For unknown task relation, mechanism selection remains undecidable until stated.

**Diagrams:** (1) TAEMS task graph with enables/hinders/facilitates and expected outcomes/duration/cost; (2) GPGP lifecycle: local schedule → detect relevant relation → exchange constraint/commitment → replan, including timeout/partial views.

**ASCII inventory:** primary mechanism, commitment and info-sharing trees in §§46–104; examples §134 onward; convert trees to Mermaid, task graph as graph; keep trade-off matrices as tables.

**Book candidate:** mechanism-family choice tied to explicit task relationship + communication cost, showing why local scheduling and negotiated constraint are both reasonable under different regimes. Prior art source should be cited; no novelty claim.

## B04 source/provenance note

The mathematical B04 skills share primary sources with Harbor Results, but the latter’s numerical findings must be treated separately. Harbor Results has its own report in B05 below. No external source here verifies internal result numbers; no tests were run. Unreviewed formulas and implementation examples must not be described as independently validated.
