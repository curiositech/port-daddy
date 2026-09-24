# Tree of Thoughts references

Use the entrypoint for the short operational model. These references preserve the method details and separate paper claims from application choices.

| Reference | Use it when | What's inside |
|---|---|---|
| [Paper method and worked examples](paper-method-and-worked-examples.md) | Designing, comparing, or reporting an explicit search controller | Primary-source method, component contracts, task walkthroughs, search and evaluation choices, experiment scope, and budget accounting |
| [Thought decomposition](thought-decomposition-and-problem-structure.md) | Choosing what a state represents and what one step changes | Invariants, granularity tests, domain examples, and decomposition worksheet |
| [Search algorithms](search-algorithm-modularity-and-problem-structure.md) | Selecting BFS/beam-like selection, DFS, or backtracking | Bounded algorithms, controller state, duplicate policy, termination and state examples |
| [State evaluation](llm-self-evaluation-as-search-heuristic.md) | Designing values, comparisons, or local aggregation | Prompt forms, state values vs comparative votes, uncertainty, exact-check separation, and evaluator comparison protocol |
| [Failure and recovery](failure-modes-in-deliberate-search.md) | Investigating a search run that pruned, stalled, or returned a bad candidate | Failure taxonomy, recoverable traces, and source-bounded ablation evidence |
| [Knowledge and execution](knowing-vs-doing-gap-in-llms.md) | Separating a plausible proposal from a completed transition | State/effect records, validators, and measured proposal-to-verification gaps |
| [Direct generation and search](system-1-vs-system-2-and-reasoning-modes.md) | Comparing direct generation with deliberate search | Careful account of the paper's dual-process analogy, matched-budget comparison, and when not to infer cognitive claims |

The three additional diagrams in [`diagrams/INDEX.md`](../diagrams/INDEX.md) explain the controller, state lifecycle, and configuration questions. All counts, prompts, outputs, and model results from the paper are tied to their stated experiments; local settings below are examples to test, not defaults.
