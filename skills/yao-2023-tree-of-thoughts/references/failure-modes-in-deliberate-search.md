# Failure modes in deliberate search

## Use a failure record, not one generic “reasoning failure” label

A poor final answer may come from the state representation, candidate generation, heuristic evaluation, search selection, terminal-state recognition, state restoration, task fit, or budget. These failures require different remedies. Keep the candidate and transition record, heuristic record, exact-check record, controller decision, and stop reason separate.

The categories below distinguish a risk to test from an observation in the ToT paper. The paper's quantitative findings apply only to its stated tasks, prompts, model, and experiment. The recovery actions are local engineering options; they are not all evaluated by Yao et al.

## 1. Evaluator and generator mismatch

**Failure:** The generator produces a valid candidate that an evaluator underrates, or a weak generator provides no candidate that the evaluator can rescue. A prompt may ask the evaluator to judge a property that the state does not expose.

**Paper example:** In mini crosswords, the authors report that their model-based pruning sometimes marked a valid rare word (“agend”) impossible. Their analysis notes that a correct puzzle solution could be pruned. The correct response is not to label the value “confidence” or treat its threshold as a theorem.

**Trace:**

```text
state s17: crossing letters agree for candidate word
generator proposal: "agend"
exact local crossing check: pass
LM remaining-clue evaluator: "impossible"
controller action: heuristic prune
later reference puzzle answer: candidate was valid
classification: false prune by evaluator; root cause not proved by this one case
```

**Check and recover:** Measure false prunes against a trusted answer source on held-out states. Preserve the candidate and exact local evidence. For high-cost branches, consider deferring irreversible pruning, using a second independent evidence source, or revisiting a small set of pruned states within budget. Do not call any such change generally robust without measurement.

## 2. Evaluation cost exceeds its decision value

**Failure:** Repeated model evaluations consume time or tokens without improving the number or quality of verified outcomes enough to justify them.

**Source observation:** Appendix B of the ToT paper reports that its Game-of-24 ToT setup used about 5.5k completion tokens per case; 100 CoT trials used about 6.7k. Its historical dollar table is tied to the 2023 model/pricing setup. In its creative-writing task, ToT required substantially more generation and cost than single IO/CoT samples. The paper explicitly treats performance-cost tradeoffs as configurable.

**Check:** Count generation requests, candidate outputs, evaluation requests and samples, exact checks, tokens, elapsed time, measured cost, and verified outcomes separately. One request may emit several candidates; do not multiply the wrong units.

**Recover:** Reduce repeated voting or widen only the most consequential frontier; perform a cheap exact partial check before a model call when possible; compare against direct generation and simpler search under the same total budget. Run an ablation to see whether a particular evaluation step changes verified results. Do not carry historical prices forward as current cost.

## 3. Final-state or solution-recognition error

**Failure:** Search visits a valid or promising state but the output-selection rule returns a different state, or no verifier is run on the selected candidate.

**Paper observation:** In the crossword experiment, the authors report 4/20 games solved under their output heuristic and 7/20 when selecting the oracle best explored state. This establishes a gap in that setup between explored states and chosen output; an oracle is not an available production selector.

**Check:** Log every terminal candidate, depth, heuristic output, and exact-verifier result. Evaluate the final selector separately from the state evaluator. For subjective tasks, state which quality measure or reviewer supplied the final comparison.

**Recover:** Verify candidate leaves before discarding them; keep the best verified result separately from the current DFS state; if the task lacks an exact verifier, return a ranked/unverified candidate set with the selection basis rather than asserting a solution.

## 4. Pruning or voting loses a viable branch

**Failure:** A finite frontier or heuristic threshold discards a branch that would have succeeded.

**Source observations:** The crossword paper reports false “impossible” evaluations and its `-prune` ablation performs below the full method on the reported measures, although it finds some solutions the pruning configuration does not within its step cap. The paper's ablation also reports lower word-level success without backtracking. These comparisons concern that 20-game setup.

**Check:** On small instances, compare heuristic-pruned runs against exhaustive enumeration or trusted solutions. For larger instances, sample pruned states for later exact checking where possible. Separate “not expanded” from “proved infeasible.”

**Recover:** Widen the frontier, defer low-confidence pruning, keep an alternate queue of pruned candidates, or use DFS backtracking. State which budget is consumed by recovery. No option guarantees the hidden branch will be found.

## 5. No-backtrack path commitment

**Failure:** An early choice constrains later steps, but the controller continues down that path or overwrites previous assignments without restoring dependent state.

**Source observation:** The ToT crossword ablation without backtracking reports lower word-level performance than the paper's full method. That does not imply backtracking always helps when transitions are reversible, or that an agent can undo real-world effects.

**Check:** Create a fixture with a deliberately wrong first choice; require the controller to restore the original parent and try a sibling. Verify that dependent crossing/derived fields are recomputed. For effectful systems, test only reversible planning state; do not assume a sent message, payment, or external write can be undone by restoring an in-memory node.

**Recover:** Store immutable parent states and action IDs, or use a tested inverse transition. If the transition has side effects, plan separately and require appropriate authorization and effect controls before executing it.

## 6. Budget exhaustion mistaken for failure proof

**Failure:** A node, time, depth, or cost limit is reached and the system reports that no solution exists.

**Source observation:** The ToT crossword setup limits search steps to 100, an experiment-specific bound. The paper returns a deepest explored state under its method; that output is not a proof of no solution. The 100 value is not a default or evidence of a universal threshold.

**Check:** Record configured caps and consumed amounts per resource: proposals, evaluated candidates, expanded states, exact checks, wall time, token count, and cost. Make stop reason part of the result schema.

**Recover:** Return `budget_exhausted` with best retained candidates and verification state. If a later attempt is authorized and affordable, resume from a checkpoint or rerun under an explicitly changed budget. Do not relabel a timeout or cap as “impossible.”

## 7. Granularity does not match what can be judged

**Failure:** An intermediate state is too large to compare usefully or too small to support a progress judgment; a check is applied at the wrong level.

**Paper basis:** The paper uses equations, writing plans/passages, and crossword word placements for its three different tasks. It demonstrates these selected representations, not universal optimal granularity. Its crossword rare-word example shows that even a state with explicit constraints can be misjudged by an LM evaluator.

**Check:** Compare candidate decompositions on the same data, same stop rule, and same verifier. Inspect candidate diversity, transition validity, evaluator error, recovery effort, and cost. Include a counterexample where the chosen unit conceals a needed alternative.

**Recover:** Change only one representation boundary at a time; preserve the previous representation so the trial is comparable. Revisit whether the evaluator has evidence for that unit at all.

## 8. Search is applied where direct generation is enough

**Failure:** Search adds calls without an observed benefit on the target workload, or a task is bottlenecked by missing knowledge rather than alternate reasoning paths.

**Source observations:** The ToT discussion says deliberative search may not be necessary for tasks a model already handles well. Appendix B reports only small differences between CoT and ToT on its selected GSM8K and StrategyQA samples, and identifies external knowledge as a bottleneck for StrategyQA. These are scoped outcomes, not a rule for classifying a new task.

**Check:** Compare direct IO/CoT baseline and the proposed ToT configuration on the same test inputs, model, exact checker or rating rubric, and declared resource budget. A costlier method may still be justified where errors are consequential, but state that as a policy choice and measure its result.

**Recover:** Use direct generation with a specific exact check, targeted refinement, retrieval, or human review when those address the bottleneck. Do not add search merely because the task has several steps.

## 9. State identity or restoration is wrong

**Failure:** A duplicate key omits a field that changes legal successors; a child mutates its parent; a graph-search revisit is incorrectly suppressed; an improved path is ignored when it should be reopened under the declared policy.

**Check:** Use an immutable state fixture and assert parent snapshots remain unchanged. Create two states that look textually similar but differ in an invariant-relevant field. Verify canonical keys distinguish them. If graph search is used, specify and test the best-record/reopen rule.

**Recover:** Store state version, canonical key, parent/action, and transition evidence. Clear or recompute derived fields after a rollback. If the duplicate policy is not justified, retain both states and measure the extra cost rather than silently merging.

## Failure and recovery trace schema

Record enough to replay the controller choice without requesting private chain-of-thought:

| Field | Contents |
|---|---|
| Run and state IDs | Stable IDs, state key, parent state, and transition ID. |
| Task scope | Goal, hard constraints, and verifier property. |
| Generator | Prompt/version, model/configuration, request count, candidate IDs, parse failures. |
| Evaluator | Value/vote type, raw structured outputs, candidate set, samples, rule, and limitation. |
| Exact checks | Check name/version, inputs, result, and missing checks. |
| Controller | Expand/keep/defer/prune/backtrack decision and named rule. |
| Budget | Before/after candidate, expansion, call, token, time, and cost counters. |
| Outcome | Verified/unverified/budget/no-candidate/error and any recovery performed. |

Example recovery:

```text
run-12, parent=s08, child=s09, action=fill-v1("agend")
transition: crossing-letter check passed
heuristic: clue evaluator returned "impossible"; confidence category, not proof
initial action: prune child
recovery policy: inspect false-prune audit sample; retain s09 for alternate branch pass
terminal check: not yet run
stop: budget_exhausted; no claim that crossword is solved or infeasible
```

This trace is a local illustrative record. It is not a claim that a second pass will find a solution.

## Source boundary

The paper results and ablations cited above are summarized in [Paper method and worked examples](paper-method-and-worked-examples.md). Their datasets, prompts, models, metrics, and caps remain attached to each result. No failure rate or recovery effectiveness is inferred for systems not evaluated there.
