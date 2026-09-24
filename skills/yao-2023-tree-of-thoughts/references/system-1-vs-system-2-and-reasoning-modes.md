# Direct generation and deliberate search

## Keep the dual-process language as an analogy

Yao et al. situate Tree of Thoughts alongside dual-process accounts of human decision making and draw an analogy between token-by-token language-model generation and more deliberate search. The paper does not establish that an autoregressive model literally uses human “System 1,” that ToT instantiates human “System 2,” or that either phrase identifies an internal mechanism. For engineering and evaluation, use the concrete terms **direct generation**, **candidate generation**, **heuristic evaluation**, **search control**, **backtracking**, and **verification**.

Direct generation produces an output from an input/prompt without explicit search over multiple intermediate states. Deliberate search makes some candidate alternatives and selection decisions explicit. The distinction describes an inference procedure, not the model's human-like mental mode.

## When to compare procedures

Consider search when the task has a useful state representation, multiple plausible branches, consequential early choices, a partial evaluator, and a bounded recovery path. This list is a design checklist, not a decision theorem: the absence of one item does not mathematically rule out search, and the presence of all items does not prove search will improve outcomes.

Direct generation may be a sensible baseline when the task is narrow, low-risk, or already solved adequately under the target budget. A specific exact check or one refinement step may address the observed error without maintaining a search tree. Search adds generation/evaluation work and may preserve a bad heuristic or false prune.

The paper's Appendix B reports only small differences between CoT and ToT on its selected GSM8K and StrategyQA samples and notes that StrategyQA performance was constrained by external knowledge. Its authors also report much larger differences on selected harder tasks. This is not a general classifier for deciding that a workload does or does not “need reasoning.”

## Comparison protocol

Compare direct generation, refinement, and ToT under a design that makes resource and verification boundaries explicit:

| Design item | Record before running |
|---|---|
| Task sample | Same test inputs, source/version, and inclusion rules for every procedure. |
| Model/prompt | Model snapshot/config, prompt version, tools, and retrieval context. |
| Resource budget | Either equalize total token/call/time/cost budget or report the difference clearly. Do not call unequal budgets “same compute.” |
| Output criterion | Exact checker for objective properties; separate rubric or blinded judgment for subjective quality. |
| Search choices | Thought/state unit, generation strategy, value or vote evaluator, search policy, width/depth/cap, duplicate handling. |
| Outcome types | Verified success, unverified candidate, invalid candidate, no candidate, budget exhaustion, or error. |
| Metrics | Verified outcomes, quality measure where relevant, calls/samples/tokens, latency, measured cost, and failure categories. |
| Analysis | Predeclared comparisons, uncertainty, excluded cases, and any search/evaluator ablations. |

Using a larger budget for ToT may be appropriate if the question is practical utility at each configuration's normal budget. It does not isolate the effect of search from the effect of extra computation. A second equal-budget analysis can help identify that distinction.

## Reconstructing the paper's comparisons

The paper compares ToT with input-output prompting, chain-of-thought prompting, and (on some tasks) self-consistency or iterative refinement. Its Game-of-24 setup uses exact arithmetic validity and reports, on 100 selected hard puzzles, 4% CoT success and 74% for ToT at the paper's stated breadth. It also reports best-of-100 CoT at 49%. These are the paper's 2023 results under its chosen model, prompts, sample and token setup; they should not be copied as predictions for another model or task.

For creative writing, the paper evaluates sentence-constrained passages with an automatic coherence rating and a human pairwise comparison on its chosen task sample. Its authors report ToT scores and preferences relative to their baselines; the target is passage coherence under that task, not factual accuracy or user satisfaction in general.

For mini crosswords, the paper reports results at letter, word, and complete-game levels. The full ToT configuration outperforms its IO/CoT baselines on that chosen set, while the `-prune` and `-backtrack` ablations lose performance. The oracle-best-state variant improves the number of completed games, showing that output selection is a separate part of the comparison. See [Paper method and worked examples](paper-method-and-worked-examples.md) for task sample, procedure, metrics, and the exact scope of each reported figure.

## Small staged evaluation plan

Use a low-cost local experiment before adopting an expensive controller:

1. Implement or select a direct-generation baseline and define exact outcome checks.
2. Add the explicit state representation without heuristic pruning; check transition and terminal correctness on tiny examples.
3. Add one evaluator, logging every score/vote, kept state, and dropped state.
4. Run with a small predeclared budget and inspect false prunes, false keeps, duplicates, and stop outcomes.
5. Compare wider/narrower selection, candidate sampling/proposal, or backtracking as separate ablations rather than changing all components at once.
6. Report whether any verified-outcome or quality gain is worth the measured additional cost on this task sample.

This is a practical experimental sequence, not a method evaluated by the ToT paper or an assurance that staged testing will find every failure.

## Limits

Do not infer from a ToT advantage that:

- model size is irrelevant, or search always beats a larger model;
- more computation always improves performance or intelligence;
- a readable intermediate state is a faithful explanation of hidden model processing;
- direct generation is cognitively shallow in the human sense;
- a task with multiple steps inherently benefits from tree search;
- “System 2” can be detected by a universal complexity threshold.

The paper motivates a search architecture and provides benchmark evidence under particular conditions. It does not validate a cognitive-mode detector or general deployment policy.
