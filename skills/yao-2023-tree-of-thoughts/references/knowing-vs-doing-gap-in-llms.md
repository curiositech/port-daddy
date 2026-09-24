# From proposed method to checked execution

## Keep the distinction narrow and operational

An LM may generate a plausible procedure and still fail to produce a valid result under a task's constraints. This is a useful evaluation distinction: the system's proposal is one event; valid state transitions and a checked final property are separate events. It is not a general theorem about what an LM “knows,” a measurement of internal cognition, or a diagnosis that every wrong answer reflects a knowledge deficit.

The Tree of Thoughts paper motivates explicit state search partly by observing that a model can fail after making an early choice. Its experimental evidence comes from specific puzzle, writing, and crossword tasks. The paper does not show that externalizing every task step will close a broad knowledge/application gap.

## Evidence from the paper, with scope attached

For Game of 24, the paper compares direct input-output generation, chain-of-thought generation, self-consistency sampling, iterative refinement, and ToT search under its 2023 model/prompt setup. On its 100 selected hard puzzles, it reports 4.0% success for CoT and 74% for ToT with a stated breadth of five. The authors also show that some CoT samples fail after the first equation. This is evidence that the tested search representation and controller helped on that benchmark; it does not isolate a universal cause called “knowing but not doing.”

The crossword results expose different gaps. The ToT evaluator sometimes pruned a valid word, and the oracle-best-state ablation outperformed the authors' final-state output heuristic. In this case, more explicit search does not remove evaluator or selection errors; it makes some of those stages visible for separate testing.

The paper's appendix reports smaller CoT-to-ToT differences on its chosen GSM8K and StrategyQA samples than on Game of 24. It identifies external knowledge as a bottleneck for its StrategyQA setup. That observation cautions against using search to address an information gap that search itself cannot fill.

## Separate proposal, transition, and outcome

For each meaningful step, store the following record:

| Record | Question it answers | Example |
|---|---|---|
| Proposal | What action did the model suggest? | Combine two remaining values with multiplication. |
| Transition | Did the action obey the current state rules? | Both operand identities were present; operation parsed; child state updated. |
| Observation | What did a tool, source, or environment return? | Arithmetic result is 24; file diff shows named lines changed. |
| Verification | Which property was checked, by which exact mechanism? | All four inputs occur once and the expression equals 24. |
| Selection | Why was this state expanded, retained, pruned, or returned? | The beam selector kept it under the configured ranking rule. |
| Outcome | What can be claimed at the stopping boundary? | `verified_solution` for arithmetic constraints, or `budget_exhausted`. |

This separation is especially useful when one layer can succeed while another fails. A transition can be valid without leading to a solution. A high evaluator score can lead to an invalid expression. A passing parser can establish syntax but not whether the proposed program meets user intent.

## Worked arithmetic record

Task: use inputs `4, 9, 10, 13` exactly once with basic arithmetic to reach 24.

| Step | Proposal | Transition result | Exact/heuristic status |
|---|---|---|---|
| 1 | `13 - 9 = 4` | Child remaining multiset is `[4, 4, 10]`. | Exact transition checks operand identity and operation. |
| 2 | `10 - 4 = 6` | Child remaining multiset is `[4, 6]`. | Exact transition check; the choice among candidate pairs may have been heuristic. |
| 3 | `4 * 6 = 24` | Complete expression is `(10 - 4) * (13 - 9)`. | Exact terminal check evaluates result and input multiplicity. |

The valid arithmetic result shows that this path meets the defined puzzle predicate. It does not show the model used an internal method faithfully, that the search explored all possible paths, or that a higher score predicts correctness elsewhere.

## Worked stateful action record

For an application with tools, preserve the same separation without assuming the effects are reversible:

```yaml
state_id: plan-4
proposal: "write the result to report.md"
preconditions_checked: ["destination authorized", "source data present"]
tool_result: "write returned success"
readback: "report.md reopened and expected digest matches"
claimed_property: "this output file matches the declared content digest"
not_claimed: ["deployment succeeded", "all user needs are met"]
```

This schema is illustrative. Use the actual authorization, effect, and evidence controls for the system. A successful tool call or self-report is not independent evidence of an external side effect; read back from the relevant source when the claim requires it.

## Design implications

1. **Make important state visible to the controller.** Record inputs used, remaining constraints, prior decisions, and current version. Omitted state can produce illegal or repeated transitions.
2. **Separate exact predicates from estimated progress.** A parser or constraint checker can decide only the property it implements. A model can estimate other properties but should mark them heuristic.
3. **Keep generation and evaluation errors separate.** If no valid candidate is generated, evaluator changes may not help. If candidates are good but all are pruned, inspect the evaluator and selection rule.
4. **Add observation where missing information is the bottleneck.** Search does not supply absent external evidence by itself; use retrieval or an authorized tool, and check its result.
5. **Test proposed methods against completed outcomes.** Report proposal validity, accepted transitions, verified results, false prunes/keeps where measurable, and resource use for the specified workload.
6. **Return typed uncertainty.** Use an unverified candidate or budget-exhausted result when no checked solution is available; do not convert process completion into task success.

## What the distinction does not justify

- It does not establish that the model contains a specific correct internal plan.
- It does not identify the cause of one error without evidence about generation, tools, state, evaluation, and selection.
- It does not justify hidden-chain-of-thought capture. A concise state-grounded decision summary and tool/evidence trace can support review without requesting private detailed reasoning.
- It does not make every task a search problem. A direct answer plus a targeted checker may be cheaper and adequate.
- It does not make state history a proof. State provenance should be checked against the actual tool or domain where that matters.

For the paper-specific examples and reported outcomes, see [Paper method and worked examples](paper-method-and-worked-examples.md). For a failure taxonomy and recovery traces, see [Failure and recovery](failure-modes-in-deliberate-search.md).
