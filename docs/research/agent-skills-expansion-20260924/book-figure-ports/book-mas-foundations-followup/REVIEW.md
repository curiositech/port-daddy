# MAS foundations: manuscript-grounded planning review

Disposition: retain **Model before mechanism** as one exercise sequence and a compact worksheet. It is useful teaching synthesis, not a new theorem, new chapter, or established world-first contribution. No manuscript prose or diagram port is authorized by this review.

## Reader question and placement

“Is my proposed coordination mechanism solving a feasibility problem, a strategic-choice problem, or both—and what exactly does its certificate establish?”

Primary manuscript working bytes were read directly, read only. All eight chapter SHA256 values match the inherited manuscript-snapshot.json; INPUTS.json records the frozen values and source locations. These are working-source anchors, not a released-edition claim.

| Existing coverage | Exact source anchor | Planned treatment |
|---|---|---|
| A concrete game, payoff matrix, repeated strategy, deviation calculation, conditional equilibrium statement | website-v2/public/whitepaper/agent-transactions-whitepaper.tex:831–909, “Truthful Claim Signaling as Nash Equilibrium” | Best home: a chapter-end Check/Trace/Open sequence under this section; body margin pointer beside the model setup at 835. Already teaches incentives; do not add a duplicate introductory game-theory survey. |
| Conditional bilateral-trade impossibility, worked rejected efficient trade, explicit lack of truthfulness proof | website-v2/public/whitepaper/harbor-economy.tex:1157–1206, “The Myerson–Satterthwaite corner” | Cross-reference worksheet assumptions and distinguish equilibrium bidding from truthful reporting. Existing example already supplies the main teaching point. |
| Reserve adequacy versus expected-loss pricing | harbor-economy.tex:1624–1638 | Optional Open exercise application: identify whether the constraint changes at the transaction or insurer level; do not invent a reserve formula. |
| Read-surface decision procedure | whitepaper/legible-swarm.tex:836–852 | Existing questions address evidence/authority, not equilibrium computation. Keep as related material, not the worksheet's primary placement. |
| “All agents serve one operator, so … no incentive problem” | legible-swarm.tex:2496–2508 | Reconcile premise: common ownership permits an aligned-team model only if alignment is assumed or justified. Preserve the practical accounting-first recommendation; do not infer absence of specification gaming or conflicting effective objectives from ownership alone. |

The prior ASTRA-BOOK-REVIEW and BOOK-PLACEMENT-REVIEW already separate teaching additions from proposed mechanisms. book-B03-B04-followup/REVIEW already proposes a witness-versus-unsuccessful-search exercise. Reuse that distinction here, specialized to game representation and deviations, rather than introducing another general “verification matters” candidate. These earlier reviews are contextual evidence, not independent verification of every theorem they mention. This pass does not certify the repeated-game proof or its machine artifacts.

## Evidence and prior-art position

The proposed gap is editorial: connecting an explicit model to a named computational question and then to operational evidence on one worksheet. A targeted scan cannot establish absence from the entire literature.

- [Shoham and Leyton-Brown, Revision 1.1](https://www.masfoundations.org/mas.pdf), §10.7 and §10.7.1, author PDF pp.321–322 (PDF pages 339–340), explicitly treats restricted strategy spaces and a center able to monitor and fine. Targeted body inspected. This is direct precedent for separating a payoff transformation from the ability to enforce it. The repaired draft's verify/find/property reference is useful scaffolding; this pass read it but did not independently audit all its complexity citations.
- [Bergemann, Koh and Morris, Mechanism Design for Alignment and Control, 2609.01595v1](https://arxiv.org/html/2609.01595v1), introduction and §§2.1–2.3: inspected the type tuple, information/action distinction, verification order and timing. It separates reporting incentives from downstream actions. Its hard-evidence order, credible commitment and modeled preferences are assumptions; stylized results are not observed guarantees about current coding agents. It strengthens the case for qualifying the single-owner premise, not for asserting every agent actually has a conflicting utility.
- [MultiAgentBench, 2503.01935v1](https://arxiv.org/html/2503.01935v1), §§3.1–3.3: inspected topology/planner design, shared/conflicting goals, and milestone metrics. Coordination and completion are already evaluated separately in this prior art. LLM-detected milestones are not an exhaustive deviation certificate. The proposed small exact-game fixture complements such benchmarks; it does not supersede them or demonstrate a performance improvement.
- [Liu et al., Second-Best Bilateral Trade is 1/2 Efficient, 2606.03849v1](https://arxiv.org/html/2606.03849v1), introduction, Theorem 1.1 and §2: actual body inspected, so the title is no longer merely an unreviewed lead. Relevant to optional further reading beside the existing bilateral-trade boundary. The paper states a tight second-best/first-best gains-from-trade ratio for its independent-value bilateral model with BIC, interim IR and budget constraints. We did not audit its proof. Do not import its bound into the Book's three-sided market, a specific auction, or empirical LLM behavior. The core worksheet does not need this result.

Other search hits (Microeconomic Foundations of Multi-Agent Learning, AgentSociety, peer-review mechanism position paper, and aggregator descriptions) were metadata/search leads only. They supply no result claims here. Source versions above were inspected on 2026-09-24; no claim is made that these are the latest revisions. No experiments were reproduced.

## Constructed teaching fixture and evaluation

Start with two workers choosing A or B. All four action profiles are feasible in the declared baseline. Payoffs: (A,A)=(3,3), (B,B)=(2,2), and mismatches=(0,0). These are constructed utility numbers, not measured worker preferences.

**Check:** Given (A,A), inspect both unilateral deviations: each drops 3 to 0. The supplied profile passes the Nash check. This establishes a fact about this profile and model.

**Trace:** Find an equilibrium, then challenge “every equilibrium has total payoff at least 5.” (B,B) is also a Nash equilibrium and has total payoff 4, refuting that property. Existence of a good equilibrium neither selects it nor proves all equilibria good. Restrict any exhaustive exercise to *pure* profiles unless mixed strategies are explicitly included; the counterexample itself refutes the universal claim even if mixed strategies are allowed.

**Open:** Add a capacity constraint permitting at most one worker on A. The old (A,A) certificate is invalid. Require the learner to specify the new game: forbidden joint outcomes, constrained deviations, or an admission/rejection mechanism have different semantics. Merely deleting a payoff-table cell leaves the game incomplete. Separately ask who observes resource occupancy, who can reject execution, and what happens on stale admission data. An equilibrium analysis grants no execution authority.

Evaluate the worksheet's educational value before adding prose. Compare equal-length instruction with and without the worksheet on held-out small models. Freeze independent answer keys and score: correct feasibility model; named solution concept and quantifier; valid deviation arithmetic; false universal claims; omitted enforcement assumptions; time and answer length. Include aligned common-payoff games, conflicting-interest games, shared-owner agents with stipulated differing objectives, imperfect observation, and changed constraints. Do not reward unnecessary market mechanisms. Human comprehension requires consenting readers; scripted solvers only validate the answer keys. An LLM study requires frozen models/prompts, equal budgets, independent checks and uncertainty across tasks; it cannot establish reader learning. No study was run.

## Semantic visual brief

Prefer one compact worksheet/table to another full-page conceptual diagram. Show the same two-worker case across four aligned rows: feasible outcomes; utilities and allowed deviations; exact question (verify / find / property); certificate and boundary. Keep a separate operational column for observation, authority, payment/penalty enforcement and effect readback. An arrow may mean “supplies modeled input” or “checked against”; never “equilibrium implies safe execution.” The capacity change should visibly invalidate the old certificate, then leave the revised outcome rule as an explicit open obligation. No invented performance curves or generic mechanism-selection quadrant. If ported later, use the Book's existing example/exercise grammar, place exercises at chapter end, and inspect compiled pages before visual acceptance.

## Scope, skills, and remaining boundary

Applied research-craft (reader cost, claim/reason/evidence), research-analyst (bounded source scan and limitations), agentic-patterns (scoped read/plan/verify), and textbook-craft (worked example and Check/Trace/Open progression). Installed SKILL.md sources were read; large combined outputs were partly truncated, so this is targeted instruction use. Competitive-cartographer and competitive-landscape were inspected: their evidence/differentiation discipline is relevant, but commercial market sizing, pricing and strategy maps are outside this manuscript task. No competitive superiority claim follows.

W verified clean at start and completion: /Users/erichowens/coding/tmp/agent-skills-expansion-20260924, branch codex/agent-skills-expansion-20260924, gitdir /Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924. Repository stayed read only pending Register renewal. Only this owned handoff subdirectory was written; no Git mutation/publication, Port Daddy runtime, hooks, MCP, service or application was used. Parent is correcting MAS methods concurrently; hashes identify the particular draft bytes inspected, not final acceptance. Author placement approval, exercise answer-key validation, and any later manuscript/render work remain separate steps.
