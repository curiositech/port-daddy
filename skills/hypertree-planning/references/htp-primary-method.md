# Primary method reconstruction: HyperTree Planning (HTP)

**Primary source.** Runquan Gui et al., [*HyperTree Planning: Enhancing LLM Reasoning via Hierarchical Thinking*](https://arxiv.org/abs/2505.02322), arXiv:2505.02322v1, submitted 2025-05-05. Full body consulted at the pinned [arXiv v1 HTML](https://arxiv.org/html/2505.02322v1): §§3.1–3.2, §4.1–4.3, Algorithm 1, Figure 3, §5, and Appendices B–E.

## Definition and inputs

The paper’s hypertree library is `L=(G,q,R)`. `q` is the query/root and `G` is a task-node set. A rule maps one start node to a set of children. In a valid generated hypertree, leaves belong to `G`, non-leaves are divisible rule-start nodes, and each parent-to-child-set branch has a rule license. The structure is rooted and acyclic. This definition is for HTP’s natural-language outline generation; it is not the `chi`/`lambda` bag-and-width definition used for database hypergraph decompositions.

The HTP pipeline takes query `q`, rules `R`, a model `pi_theta`, depth `K`, width `W`, and any relevant knowledge base. It produces an outline before it produces detailed plan content.

## Algorithm 1, reconstructed step by step

1. Convert the rule set into its divisible-node set `D`; initialize the current structure at root `q`.
2. At each depth `d=1..K`, generate candidate hyperchains from the current structure.
3. When the candidate count `m` exceeds width `W`, filter it. The paper names width-based selection, confidence/probability-based selection, and LLM-guided filtering; it does not give one fixed score formula.
4. **For each retained hyperchain**, determine which leaves are divisible members of `D` in context and choose an expandable leaf `g*`.
5. At `g*`, retrieve or sample `P` applicable rules. **For each sampled rule**, ask the model to instantiate that rule’s complete child set and attach it as a distinct branch below `g*`.
6. Finish the inner per-rule loop and outer per-hyperchain loop; repeat depth selection and expansion until the configured construction stopping condition, then have the model choose a final hyperchain as outline `O`.
7. Separately perform self-guided planning: use `O` and permitted knowledge to develop leaf-level content `C`.
8. Generate final plan `P` from the completed content representation.

The selected outline `O` is not the final plan. The paper explicitly motivates the second stage because outline leaves can require knowledge-intensive subtask reasoning.

## Alternative branches versus child sets (`P=2`)

Let `G={Plan,Route,Flight,Lodging}`. At a selected divisible leaf `Plan`, suppose `P=2` sampled rules are `r_road: Plan -> {Route, Lodging}` and `r_air: Plan -> {Flight, Lodging}`. The source procedure creates two candidate alternative branches under `Plan`, one licensed by each rule. Once a final hyperchain selects `r_road`, `Route` and `Lodging` remain the complete child set of that selected branch; they are not two competing branch choices. This finite check distinguishes the per-rule alternative loop from the all-children-within-one-rule requirement. It does not add a scheduler, independence claim, or authority semantics.

## Finite structural hand check

Let `G={Plan,Route,Lodging,Route-A,Route-B}`; let `q=Plan`; and set rules `Plan -> {Route,Lodging}` and `Route -> {Route-A,Route-B}`. Then `D={Plan,Route}`. First attach Route and Lodging together below Plan. Then attach Route-A and Route-B together below Route. Plan and Route are rule-start internal nodes; the leaves are in G; no arc cycles to an ancestor. The check establishes only source-structure validity. A budget or date constraint can couple Lodging to either route result, so it establishes neither independence nor schedulability.

## Results and limits

The paper evaluates named models and task setups. Its validation sets include 180 TravelPlanner queries, 600 PlanBench Blocksworld queries, 600 Mystery Blocksworld queries, and 1,600 Natural Plan Trip Planning queries (paper §5.1 and Appendix C.1). Report table rows with their exact model, task, prompt, and comparator.

One useful scoped example is Table 3’s GPT-4o TravelPlanner ablation: HTP 20.0; without division 6.1; without self-guided planning 8.3. It supports the paper’s component investigation in that setup. It does not establish a task-length threshold, a universal “structure is the cause” conclusion, independent branches, or a multi-agent protocol. The abstract/§5.3 3.6× statement is a specific Gemini-1.5-Pro versus o1-preview TravelPlanner comparison, not a portable multiplier.

## Implementation boundary

An implementation can add outline review, shared-constraint integration, workers, scheduling, retries, or action authorization. Those are additional semantics. Any claim about them needs its own contract and test evidence.
