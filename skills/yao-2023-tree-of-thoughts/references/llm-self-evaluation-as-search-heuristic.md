# State evaluation: LM values, comparative votes, and exact checks

## Separate the questions

An evaluator answers a particular question about a particular candidate set. The Tree of Thoughts paper separates two heuristic forms:

- **State value:** “How promising does this state appear under this task criterion?” A value may be a numeric score or a categorical label. The methods section gives `sure`, `likely`, and `impossible` as a generic classification example; the Game-of-24 experiment specifically prompts for `sure`, `maybe`, and `impossible`.
- **Comparative vote:** “Which of these candidate states is more promising for this stated objective?” The paper uses this form for creative-writing plans and passages, where coherence is harder to reduce to a local exact value.

The two forms return different information. A value can compare states only if its scale is interpretable across those states and prompts. A vote is relative to the candidate set supplied and can hide a shared defect in every option. Neither form verifies correctness, completeness, feasibility, truth, or quality by itself.

Keep three functions separate:

| Function | Example | What its result establishes |
|---|---|---|
| Heuristic evaluation | “State B looks more promising than state A because two remaining values can form the target.” | A model judgment for the supplied state/prompt. |
| Exact domain check | Parse equation, verify the input multiset, and compute its value. | The named arithmetic constraints passed for that candidate. |
| Search selection | Keep B in the beam or follow it in DFS. | The controller applied its stated policy; not that B is a solution. |

An answer can pass one row and fail the others. For example, the evaluator may correctly rank a candidate under a heuristic while the exact goal test rejects it; a verified solution can also be found on a branch that the beam later drops unless verification occurs before dropping.

## Prompt independent values

For independent state valuation, give the evaluator one state plus the current task goal and constraints. Ask for a typed output that separates the judgment from its basis and uncertainty. Example:

```text
Task goal and hard constraints: [state the goal and exact invariants]
Current domain state: [serialized state]
Judge only the named heuristic question: [e.g. whether the remaining values look promising]
Return one category from {promising, uncertain, unlikely}, one sentence naming domain evidence,
and any missing information. This is a heuristic, not a proof. Do not expose private chain-of-thought.
```

If a numeric score is needed for a local policy, define scale anchors and the selection rule. A 7/10 is not a probability of success unless a calibration study supports that interpretation for the target workload. Prompted confidence is not calibration evidence.

The paper's Game-of-24 evaluator illustrates lookahead and commonsense judgments: a small arithmetic combination can sometimes be checked directly, while a judgment about whether a larger remaining set can reach 24 is heuristic. That distinction should appear in records: `exact_partial_check` versus `heuristic_value`.

## Prompt comparative votes

For a vote, pass stable candidate identifiers, the same criteria for each item, and an explicit abstain/tie route. Example:

```text
Goal: choose a plan for a four-paragraph passage that must end each paragraph with one supplied sentence.
Criteria: required-sentence placement, coherent progression, and support from the input constraints.
Candidates: A=[...], B=[...], C=[...]
Compare each candidate against every criterion. Return a rank, criterion-linked summary,
and tie/insufficient-evidence if appropriate. A preference is not a factual or exact validity check.
```

The paper's creative-writing procedure samples candidate plans, casts multiple votes, chooses a plan, then generates and votes over passages. This is a worked choice for the paper's subjective coherence task. It does not establish that voting is the best evaluator for all open-ended work or that a majority preference is an objective quality measure.

## Aggregation is a declared local policy

The paper notes that repeated value or vote sampling can trade time, resources, and cost for a more faithful heuristic. It does not establish a universal sample count, confidence threshold, independent-error assumption, or monotone reliability law. Its specific Game-of-24 and creative-writing sample counts are experiment settings; do not turn them into a default.

Before aggregation, define:

1. candidate-set construction and stable candidate IDs;
2. prompt, model/configuration, temperature or sampling method, and sample count;
3. whether the response is a numeric value, categorical label, pairwise preference, or ranking;
4. the aggregation rule, missing-response treatment, tie behavior, and abstention path;
5. how correlated responses and shared prompt bias will be considered;
6. what a disagreement changes (for example, defer a prune or spend an extra exact check);
7. the extra token, latency, and money budget.

Do not average incomparable scores, count repeated calls as independent evidence without justification, or equate “three of five say impossible” with a sound prune. More votes may repeat a common error; if the branch matters, keep it, widen the search, ask for an independent evidence source, or label the result uncertain.

Example local vote ledger:

| Candidate | Raw responses | Aggregate under declared rule | Downstream check |
|---|---|---|---|
| A | `A, A, B, abstain, A` | A preferred; one abstention retained | Exact constraints pass; final quality unassessed. |
| B | `B, A, B, A, abstain` | Tie under plurality | Defer pruning; exact check not run. |

This table is illustrative only. It demonstrates record structure, not an empirical result or recommended voting procedure.

## Do not turn heuristics into pruning proofs

A false prune removes a branch that might have reached a valid solution. On a small exact Game-of-24 fixture, the rule “all inputs below 5 makes 24 impossible” fails: `4 * 4 + 4 + 4 = 24`. This is a counterexample to that specific rule, not a calibration study.

For any heuristic prune, log:

| Field | Example value |
|---|---|
| State and parent | Stable IDs plus the state serialization. |
| Evaluator/version | Model, prompt version, and call/sample IDs. |
| Decision | `prune_heuristic`, not `infeasible`. |
| Basis | Short state-grounded reason or features; no hidden-reasoning transcript required. |
| Exact evidence | Which exact checks ran and their results, if any. |
| Recovery | Revisit policy, alternate evaluator, or explicit no-reopen choice. |

Measure false-prune and false-keep rates only where a trusted answer set, exhaustive small instance, or independently checked completion gives a reference. When reference truth is unavailable, describe sampled observations and uncertainty; do not claim a measured error rate.

## A* is not a synonym for value-guided search

The ToT paper's algorithms use heuristic evaluation and bounded search. It explicitly identifies A* as future work rather than presenting its LM values as A* heuristics. A* requires a defined state graph, edge/path costs, goal predicate, heuristic, and duplicate policy. An LM value does not come with admissibility or consistency properties. In graph search, closing states without reopening is commonly justified by heuristic consistency; if a heuristic is only admissible but inconsistent, an implementation may need to reopen states to retain the relevant optimality result. Do not claim those properties for a prompt score without a proof about the actual state space and a tested implementation.

Likewise, beam width, top-k selection, DFS thresholds, model votes, and visit limits are policy parameters. They may control resource use but do not establish completeness, optimality, or impossibility.

## Evaluator evaluation plan

To compare evaluators, predeclare the target judgment. Example target: “Does an exact solver find a path from this state within a fixed node cap?” This differs from “Does this branch eventually contain any mathematical solution?” unless the exact search is complete and the cap is sufficient.

On held-out states from the intended task distribution, report:

- false keeps and false prunes against the declared reference property;
- rank or vote agreement with downstream verified outcomes, with the candidate-set construction stated;
- exact-check calls avoided or added;
- downstream verified solutions or quality judgments;
- generation/evaluation calls, samples, tokens, latency, and cost;
- uncertainty from small or clustered samples and any task exclusions.

If numeric outputs are interpreted as probabilities, assess calibration separately on data not used to tune the prompt or threshold. If the objective is ranking, report a ranking metric and its candidate set rather than describing rank agreement as calibration. Programmed, learned, prompted, and human evaluators may each have advantages or failure modes; the ToT source does not establish a universal ordering or required training-set size.

## Source boundary

See [Paper method and worked examples](paper-method-and-worked-examples.md) for the paper's Game-of-24 and creative-writing evaluator examples and exact experimental scope. These techniques are useful candidate methods to measure; none of the prompt forms above is claimed to reproduce the paper's results on a new task.
