# B04 foundations deepening: primary methods and boundaries

Accessed 2026-09-24. Research is for Terra integration planning; no canonical skill was edited and no result below independently validates bundled code. Repository W was checked before research and remained clean on branch `codex/agent-skills-expansion-20260924`, root `/Users/erichowens/coding/tmp/agent-skills-expansion-20260924`, gitdir `/Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924`.

The existing `foundations-B04.md` is the baseline for complete skill/reference inventory and earlier recommendations. This addendum focuses on primary-source methods, source access, concrete tests, and exact scope corrections. Retrieval/access depth is stated per source; references cited in the baseline should remain only where their named claim is relevant. Book ideas below are candidates requiring manuscript and prior-art review, not novelty claims.

## 1. `semantic-conflict-prediction` (cross-reference; no duplicate skill review)

**Primary sources read.** Tree-sitter official [Introduction](https://tree-sitter.github.io/tree-sitter/), [Query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html), and [Basic parsing](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html), opened 2026-09-24; read API/semantic descriptions. The parser incrementally produces a concrete syntax tree; query S-expressions select CST nodes. These documents do not define cross-file symbol resolution, type checking, call graphs, or merge-conflict prediction.

**Method to preserve and correction.** Keep the skill’s useful conflict classes, symbol claims, dependency graph, and advisory/enforced decision. Recast Tree-sitter as syntax evidence only. Make an evidence ladder explicit: changed syntax node → resolved symbol/import edge (language tooling) → type/build result → test/runtime consequence. A risk score must state which layers exist and its target corpus; the current universal-sounding semantic prediction, guarantees, and latency should be marked implementation-specific or removed absent a measured corpus and benchmark. Unresolved/dynamic imports and generated code are missing evidence, not “no conflict.”

**Hand-check/test.** Two edits rename a function parameter and a caller. A CST-only query sees each local shape but cannot establish whether the caller binds to that function. Test parser-only versus compiler/LSP-resolved dependency predictions against seeded conflict/non-conflict pairs; report precision and recall by evidence layer. No threshold should be made universal.

**Diagrams.** (1) Evidence ladder from syntax to symbol/type/build/test with confidence labels. (2) Dependency impact graph showing a direct changed declaration and transitive consumers, with unresolved edges dashed.

**ASCII/source gap.** Existing extensive ASCII conflict matrix and pipeline should be inventoried in the baseline/evaluation report; replace unsupported “semantic certainty” labels rather than redraw the matrix. Official docs fully available; no Tree-sitter semantic analysis source found because that is outside its parser contract.

**Book candidate.** A side-by-side case where syntax overlap misses a cross-file API break, then a compiler-backed check catches it; compare against existing Book treatment before adding.

## 2. `sheaf-cohomology-multiagent-debug`

**Primary sources read.** Abramsky & Brandenburger, [“The Sheaf-Theoretic Structure of Non-Locality and Contextuality,” arXiv:1102.0264](https://arxiv.org/html/1102.0264), full HTML opened; focused §§3–5 (global sections, incidence matrix, linear-system method). Hanks et al., [“Distributed Multi-agent Coordination over Cellular Sheaves,” arXiv:2504.02049v2](https://arxiv.org/html/2504.02049v2), pinned v2 HTML opened; focused model/optimization sections II–VI. Hanks et al. specify an undirected communication graph, stalk vector spaces, restriction maps, global sections, and a sheaf-Laplacian/NLP; their convexity and convergence discussion is conditional on stated convex objectives/potentials. Consensus/formation/flocking simulations are not evidence of detecting deception or validating this skill’s monitor.

**Method to preserve and correction.** Define the finite base space, stalks, restrictions, observed cochain, coefficient field, missing-data model, and objective before interpreting a residual. Abramsky–Brandenburger’s global-section obstruction concerns a specified measurement cover and compatible empirical model; it does not make every organizational disagreement a contextuality obstruction. For a linear model, write the coboundary matrix and solve `min_x ||g-δx||`; report nullspace/gauge and observation coverage. Treat the residual as inconsistency relative to that representation, not cause attribution. H1 is `ker δ1 / im δ0` for the selected complex, not a free-standing incident detector.

**Hand-check.** On an oriented triangle, vertex potentials induce edge differences whose signed cycle sum is zero. On a path, any edge-difference vector is realizable by choosing a root value and accumulating differences. This only establishes algebraic consistency for this graph/stalk model.

**Diagrams.** (1) Observable reports → visibility mask → stalk/restriction model → linear solve → residual with model assumptions. (2) Triangle and path chain complexes side by side, marking cycle constraint versus unconstrained path differences.

**ASCII/source gap.** Baseline records formulas, Python/TS implementations, and existing supervisor ASCII; those are not source validation. Preserve code only after tests against a hand-computed incidence matrix, rank/gauge cases, missing observations, and a cycle/path fixture. Abramsky full text opened; Hanks v2 was targeted-read, not line-by-line; source is a preprint version, not a general applied validation.

**Book candidate.** A concrete “cycle residual versus tree residual” worked example with explicit boundary matrix and limits; check current manuscript first.

## 3. `shoham-leyton-brown-2009-mas-foundations`

**Primary sources read.** Shoham & Leyton-Brown author site, [*Multiagent Systems: Algorithmic, Game-Theoretic, and Logical Foundations*](https://www.masfoundations.org/), opened 2026-09-24; bibliographic and scope text read. It describes proofs and algorithmic considerations across distributed problem solving, games, communication/learning, social choice, mechanisms, auctions, coalitions, and epistemic logic. Nisan & Ronen, [“Algorithmic Mechanism Design,” author PDF](https://ai.stanford.edu/~amirr/AMDJ.pdf), primary manuscript opened via search result and method text cross-checked against [Waterloo author-hosted copy](https://cs.uwaterloo.ca/~klarson/teaching/F06-886/papers/nisan01.algorithmic.pdf), §5.1 mechanism-with-verification definitions read. Their problem formulation separates declared type, execution, decision, output, and payment; truthfulness depends on the specified game, not on procurement language alone. Author site is not full textbook body; do not attribute page-specific operational advice to it.

**Method to preserve and correction.** Keep the multidiscipline map and worked models. For each example state players, private information/types, strategy, utility, timing, outcome/payment rule, equilibrium or incentive property, and computation. A mechanism with verification is a particular construction, not a blanket right to trust agent declarations; a truthful allocation rule may still be computationally hard or violate another objective. Distinguish equilibrium existence, finding one, incentive compatibility, welfare, budget feasibility, and runtime.

**Hand-check.** Two workers bid private costs 2 and 5 for one job. Specify allocation and payment first; compute utilities for truthful reports and one misreport. If the payment rule is omitted, truthfulness cannot be assessed. Use a toy rule only as an example, not a literature result.

**Diagrams.** (1) Model worksheet: information → strategies → utility → solution concept → computational question. (2) Mechanism path: reports → allocation → verified execution/outcome → payment → utility, annotating proof obligation at each arrow.

**ASCII/source gap.** Baseline inventories the skill’s examples and references. Preserve payoff matrices; convert only actual sequence/decision structures. Full book text was not inspected, so cite official author catalog only for scope; no page citations.

**Book candidate.** A paired example where a feasible efficient allocation fails an incentive or computation requirement; compare with current manuscript’s mechanism-design examples before proposing.

## 4. `solely-responsible-agent`

**Primary sources read.** The skill is an operational accountability pattern; its academic name should not be implied by source overlap. For a directly relevant formal counterpoint, [“Responsibility of AI Systems,” AI & Society (2022)](https://link.springer.com/article/10.1007/s00146-022-01481-4), publisher body opened and §5’s agent-oriented responsibility discussion read. It uses an autonomous-vehicle intersection case to reason about available actions, knowledge, communication, and collective responsibility, and explicitly notes normative/motivational dimensions remain for further integration. NIST [SP 800-53 Rev. 5 AC-5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) is a control catalog reference, not empirical evidence; the baseline cites it for separation-of-duties policy context. Wooldridge’s author contents were opened, but not full book text.

**Method to preserve and correction.** Preserve one named accountable coordinator for a bounded concern, durable handoff, escalation, and visible state. Do not infer that one agent should hold approval, execution, and verification authority. Treat sole ownership as a legibility/failover heuristic and document alternates, permission ceiling, dependencies, unavailable-owner recovery, and independent effect verification. The 2022 responsibility paper is a verified related source, not the original source of the skill’s pattern.

**Hand-check.** Release coordinator owns the checklist and escalation; separate signer approves; deployment controller performs effects; independent observer checks deployment receipt. Remove the coordinator mid-flight: the ledger identifies the successor and pending authority without giving the successor retroactive approval.

**Diagrams.** (1) Responsibility/authority matrix with accountable coordinator, independent approver, executor, verifier. (2) Owner-unavailable recovery state machine with pending effects and explicit successor acceptance.

**ASCII/source gap.** Baseline identifies owner tables and workflow prose; preserve the matrix as a table and diagram only the handoff. Springer full body §5 inspected; exact local pattern remains design prescription, not a validated universal organizational rule.

**Book candidate.** Demonstrate accountability clarity and authority separation in one release incident; assess overlap with existing assurance/accountability chapters.

## 5. `state-of-cognitive-systems-engineering`

**Primary sources read.** Hoffman, Klein & Laughery, [“The State of Cognitive Systems Engineering,” IEEE Intelligent Systems 17(1), 73–75 (2002)](https://ieeexplore.ieee.org/document/988462), official record/abstract read; access to full paper not established. Hollnagel & Woods, [“Cognitive Systems Engineering: New Wine in New Bottles,” DOI 10.1016/S0020-7373(83)80034-0](https://doi.org/10.1016/S0020-7373(83)80034-0), full author-hosted scan [CSE_NWINB.pdf](https://erikhollnagel.com/onewebmedia/CSE_NWINB.pdf) opened, title/abstract and method framing read. It treats cognitive systems as adaptive man-machine systems using knowledge of themselves/environment to plan and modify action; this is a systems design perspective, not an agent-specific performance theorem.

**Method to preserve and correction.** Keep situated-task analysis, expected-versus-observed trajectory, cue logging, adaptation, and operator recovery. Replace categorical statements that tacit expertise cannot be captured or that fixed pipelines necessarily fail with testable hypotheses: elicitation can be incomplete, and fixed procedures can fail when relevant conditions vary. Use critical-decision/cognitive-task analysis as an elicitation method, then validate on held-out anomalous scenarios and actual workflow observations. The 2002 editorial supports CSE motivation, not detailed causal claims in the skill.

**Hand-check.** In a staged rollout, present one seen queue-saturation scenario and one novel dependency-induced saturation with the same aggregate rate. Ask the operator/agent to record cues, expectation, action, and mismatch-triggered reclassification; score cue coverage and safe recovery, not resemblance of prose.

**Diagrams.** (1) Cue → situation hypothesis → expected trajectory → action/monitor → mismatch/reassess loop. (2) Work system view linking operator, automation, environment, representations, and control authority.

**ASCII/source gap.** Baseline reports prose frameworks and tables; retain decision tables and add only these two distinct conceptual diagrams. IEEE page abstract only; original 1983 author scan inspected at framing/abstract level, not every page. Avoid quoting unsupported exact operational prescriptions from either.

**Book candidate.** One annotated surprise showing how expectation mismatch triggers a safe reclassification; compare with existing human-factors material.

## 6. `wang-2023-voyager`

**Primary source read.** Wang et al., [“Voyager: An Open-Ended Embodied Agent with Large Language Models,” arXiv:2305.16291v2](https://arxiv.org/html/2305.16291v2), pinned v2 HTML opened 2026-09-24; method §§2.1–2.3 and appendices B.3–B.4 targeted-read. The method combines an automatic Minecraft curriculum, GPT-4 code generation, executable skill library/retrieval, environment execution, error feedback, and self-verification. The paper reports its own Minecraft/MineDojo tasks, prompts, ablations and three-trial settings; its success claims do not validate general agent memory. The paper also notes curriculum can propose infeasible tasks and its verifier can miss success.

**Method to preserve and correction.** The useful mechanism is executable skills plus environment feedback, with preconditions/effects and iterative repair. State that domain/runtime/API matters; a callable snippet is not generally safe or portable memory. Bind each skill to environment version, observed preconditions, permitted effects, independent success signal, and transfer test. If the same model generates and judges a skill, label the oracle as self-check, not independent verification.

**Hand-check.** Retrieve `craft wooden pickaxe` in a fresh world lacking planks. The precondition check should fail before execution; after obtaining planks, execution should be bounded and completion should be confirmed by inventory observation, then record dependency and version.

**Diagrams.** (1) Curriculum → code generation → sandboxed execution → observed state/error → repair/self-check → versioned skill library. (2) Skill contract showing environment, preconditions, actions/effects, verifier, and transfer evaluation.

**ASCII/source gap.** Baseline contains the existing flow and source inventory. Preserve paper example code/prompt context but avoid reproducing long listings. Full HTML available; methods/appendices targeted, not full line-by-line replication.

**Book candidate.** Executable memory as a capability with a failing precondition and observable postcondition; check existing agent-memory coverage.

## 7. `yao-2022-react`

**Primary source read.** Yao et al., [“ReAct: Synergizing Reasoning and Acting in Language Models,” arXiv:2210.03629v3](https://arxiv.org/html/2210.03629v3), pinned v3 (2023-03-10) HTML opened; method and experiment sections targeted-read. It interleaves generated reasoning, actions, and observations; experiments cover HotpotQA/FEVER with Wikipedia interaction and ALFWorld/WebShop interactive tasks under specified prompts/models. Paper discusses limits of prompting and fine-tuning. No generic safety guarantee follows from the pattern.

**Method to preserve and correction.** Preserve the observe–act–update loop and explicit tool outputs. Mark generated reasoning as model text, not faithful internal state or proof. Tool execution, permissions, and validation remain external. Tie each final claim to an observation/source and expose missing evidence; do not let the model cite its prior rationale as evidence.

**Hand-check.** Search returns conflicting snippets. Record each tool result and source; if neither resolves a claim, the next action is another bounded query or abstention. A fabricated intermediate thought must not enter the evidence ledger.

**Diagrams.** (1) Reasoning text → authorized action → external observation → next-step reasoning, with the distinction between text and evidence. (2) Provenance swimlane from user request through tool input/output to final assertion.

**ASCII/source gap.** Baseline covers the skill trace/code. Preserve compact trace examples, not the paper’s long trajectories. Full HTML opened and method/experiment sections read; benchmark results remain prompt/model/task-specific.

**Book candidate.** A tool result that falsifies the model’s first hypothesis, with provenance carried into the correction; compare with existing tool-use examples.

## 8. `yao-2023-tree-of-thoughts`

**Primary source read.** Yao et al., [“Tree of Thoughts: Deliberate Problem Solving with Large Language Models,” arXiv:2305.10601v2](https://arxiv.org/html/2305.10601v2), pinned v2 HTML opened; §2.1 and benchmark/method passages targeted-read. The framework makes four explicit choices: thought-unit decomposition, candidate generation, state evaluation, and search procedure (e.g. BFS/DFS). Game of 24 illustrates equation-level thought states and evaluator/search; reported rates/cost are specific to prompts, model, branching and tasks. LLM evaluation is heuristic unless independently checked.

**Method to preserve and correction.** Keep explicit state, candidate, evaluator, and search policy. Add state invariants, duplicate detection, bounded budget, backtracking/termination condition, and exact verifier where available. Never call evaluator rankings “proof”; use domain verifier for arithmetic/legal actions and mark open-ended evaluator as heuristic. Report budget and seeds when comparing variants.

**Hand-check.** Game of 24 with `4, 4, 6, 8`: enumerate thought equation candidates, reject candidates that reuse/remove an input incorrectly, and verify final expression equals 24 exactly. This tests the mechanism, not the paper’s success rate.

**Diagrams.** (1) State tree with generator, heuristic score, verifier, and prune/backtrack labels. (2) Search-control loop contrasting BFS frontier, DFS stack, and hard budget/stop condition.

**ASCII/source gap.** Baseline inventories skill tree diagrams and decision logic. Keep the search structure; add an exact-verification edge and cost label. Full pinned HTML opened; method and benchmark passages targeted, not every experiment detail.

**Book candidate.** A candidate tree where the highest-scored thought is invalid but exact verification recovers; compare existing search examples before proposing.

## 9. `ai-wiley-wooldridge-an-introduction-to-multi-agent-systems`

**Primary sources read.** Wooldridge author [2nd edition contents](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/Contents.html), opened; headings/organization read (agent foundations, MAS, logic, practical systems, interaction, trust/security, applications). Wiley [book record](https://www.wiley.com/en-us/An+Introduction+to+MultiAgent+Systems%2C+2nd+Edition-p-9780470519462) was not accessible in this web pass; no full book chapters read. Baseline’s author-site coverage should be used as a map, not evidence that the book endorses added operational recommendations.

**Method to preserve and correction.** Retain a concise route from agent definition/autonomy to environment, interaction, communication, coordination, and system design; explicitly distinguish textbook foundations from modern LLM-specific operational extensions. Use the contents to route readers to topics, not to assert detailed theorem wording. Any textbook-derived claim should include edition/chapter and be checked against body text before integration.

**Hand-check.** For two autonomous agents sharing a resource, identify environment observability, action interface, communication protocol, and conflict-resolution mechanism before choosing centralized or distributed design. This is an application worksheet, not a cited Wooldridge algorithm.

**Diagrams.** (1) Agent–environment loop with perceptions/actions and interaction channel. (2) Topic map from autonomy/environment through communication/coordination to MAS properties, clearly labeled as chapter navigation.

**ASCII/source gap.** Baseline references author content pages. No full chapter text obtained; book record/body access is an explicit gap. Do not claim page-level confirmation.

**Book candidate.** A compact “what makes a system multi-agent?” contrast between independent agents and concurrent services; prior-art review needed.

## 10. `algebraic-topology-for-agents`

**Primary sources read.** Same targeted Hanks et al. v2 source and Abramsky–Brandenburger paper as §2, for precise cellular sheaf/global-section versus empirical contextuality contexts. Hanks supplies a concrete algorithmic route: define local state stalks and restriction maps, form the global-section/optimization problem, then solve the stated convex program by ADMM under its assumptions. It does not support the skill’s universal swarm “legibility ratio,” all named closed forms, or broad hierarchy claims.

**Method to preserve and correction.** Keep chain complexes, oriented boundary/coboundary operators, nullspace treatment and small hand examples. Every derived invariant must name the complex and coefficient space; prove dimensions/ranks for the instance. Remove “tree blindness” as a claim about coordination quality: for a connected graph with constant scalar sheaf, H1 is zero on a tree, but this says only that this cohomological obstruction is absent in that model. Do not infer a tree orchestrator is blind to all failures. Effective resistance sensitivities require the specified graph Laplacian/grounding and objective; any CR-1 closed form needs a derivation and unit test. Treat legibility ratio as locally defined metric unless validated.

**Hand-check.** Incidence matrix of path 0–1–2 has rank 2, kernel of vertex-to-edge coboundary is constants, and every edge vector is attainable; triangle incidence has rank 2 and an edge-cycle residual dimension 1. State orientation and verify by multiplication.

**Diagrams.** (1) `C0 --δ0--> C1 --δ1--> C2` with dimensions/ranks for path and triangle. (2) Hodge decomposition into gradient, co-gradient, and harmonic components, with conditions and “not causal labels” note.

**ASCII/source gap.** Existing skill has ASCII action/topology trees, formulas, multiple examples and code. Preserve only diagrams whose formulas are verified against explicit matrices; mark unproven named invariants as hypotheses/remove. Both primary sources opened, targeted passages only; no code execution or theorem validation performed.

**Book candidate.** The same signal decomposed differently on path vs triangle, emphasizing model dependence; inspect current topology chapter.

## 11. `charrier-et-al-big-brother-logic`

**Primary source read.** Charrier et al., [“Big Brother Logic: Logical Modeling and Reasoning about Surveillance Systems,” AAMAS 2014 proceedings PDF](https://aamas.cs.liv.ac.uk/AAMAS/aamas2014/proceedings/aamas/p325.pdf), all 8 pages opened/read. The formal model identifies agents with stationary planar cameras, assumes known exact camera positions (even when unseen), and varies orientation/vision; it defines individual/distributed/common knowledge and turning actions, then uses a finite vision-based abstraction and PDL translation for model-checking/satisfiability results. The paper explicitly leaves mobile-camera model checking/satisfiability for future work; its PSPACE statements belong to specified logic fragments.

**Method to preserve and correction.** Keep explicit epistemic accessibility relations and “what can agent i distinguish?” reasoning. Don’t reuse its complexity bounds or semantics as a generic multi-agent perception guarantee. A property is only as sound as world set, camera/agent observability, known positions, and action model. For software agents, define observation function, hidden state, communication history and possible worlds before using K_i φ; distinguish knowledge from belief under incomplete or noisy observations.

**Hand-check.** Two camera agents know each other’s fixed positions. If A sees B’s orientation but cannot see object X, enumerate worlds consistent with A’s visible configuration; K_A(X visible to B) holds only if true in every such world. Change B’s position to mobile and the paper’s stationary complexity claim no longer applies.

**Diagrams.** (1) Geometric camera view and indistinguishable-world equivalence classes. (2) Kripke worlds/accessibility edges with K_A φ true only when φ holds throughout A’s class.

**ASCII/source gap.** No need to reproduce all geometric formal diagrams; the source figures and assumptions are part of the method. Preserve formula definitions and add an agent-software mapping table with explicit changed assumptions. Full eight-page source accessed.

**Book candidate.** Show why “I did not observe it” differs from “I know it did not happen,” with the possible-world set shown; check existing epistemic logic content.

## 12. `decker-lesser-1995-gpgp-taems`

**Primary source read.** Decker & Lesser, [“Designing a Family of Coordination Algorithms,” ICMAS-95, pp.73–80](https://mas.cs.umass.edu/paper/30), author publication record and abstract opened; linked [author PDF](https://mas.cs.umass.edu/Documents/lesser/decker-94-14.pdf) surfaced as a primary-source link but browser PDF open returned an internal error. Accessible author abstract says GPGP is an extensible family whose mechanisms respond to task-environment features, coexist with local planners, and exchange information at multiple abstraction levels; experiments compare selected family members and centralized upper-bound algorithm in simulated abstract task environments. Thus full method details were not body-verified in this pass. Title, conference, pages/year verified from author record.

**Method to preserve and correction.** Preserve GPGP/TAEMS as feature-driven coordination: model task structure, deadlines, agent heterogeneity, interrelationships and communication cost; select mechanisms for the represented environment and compare to a baseline. The numeric power factors and hard 20/10/30/15-percent thresholds in the skill are not supported by the accessible paper record; remove or label as locally chosen parameters, then calibrate and report. Do not claim the paper proves these thresholds or universal efficiency. Separate cooperative mechanism design assumptions from strategic/self-interested agents.

**Hand-check.** Two agents have tasks A and B; A’s value depends on B completing first, deadline 10, and message cost 1. Compare local schedules with a coordination message and explicit task dependency. Record achieved utility, deadline misses and communication cost; this is a designed test fixture, not a reported source result.

**Diagrams.** (1) TAEMS task tree with quality accumulation, deadline and interrelationship edge, annotated with which mechanism responds. (2) Experimental comparison: local baseline vs chosen mechanism vs centralized upper bound across declared environment conditions and communication cost.

**ASCII/source gap.** Existing skill diagrams and numeric decision tables require a pass against full original paper before preserving algorithm details. Author abstract is primary but insufficient for detailed procedure; PDF access is explicitly incomplete. Do not mark source validation complete for mechanism internals.

**Book candidate.** An ablation showing a coordination mechanism helps only when its corresponding task dependency exists; confirm no current Book treatment and obtain full source before using.

## Coverage and outstanding source limits

All 12 B04 IDs are covered. Full-text/method access was strongest for the two sheaf papers (targeted methods), ReAct, ToT, Voyager, and Big Brother Logic. Tree-sitter official documentation and Decker–Lesser author record were read; the latter’s PDF body was not accessible, so algorithm-level validation remains open. Wooldridge full book chapters were not accessed; the 2002 CSE article was abstract/record only; the 1983 author scan was inspected at framing level. None of these access gaps is silently treated as a completed source validation. Existing detailed bibliographies and code inventories remain in `foundations-B04.md`.
