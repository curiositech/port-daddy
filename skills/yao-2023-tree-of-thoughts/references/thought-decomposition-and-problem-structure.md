# Thought decomposition and problem structure

## Why the state boundary matters

Tree of Thoughts makes the intermediate unit an explicit design choice. In the paper's formalization, a search state contains the task input and the thought steps chosen so far. A transition adds a candidate continuation. The useful unit is neither fixed by the model nor equivalent to a token, sentence, subtask, or hidden mental state. It is defined by the domain and the job the search controller must perform.

Yao et al. give three task-specific examples: an equation for Game of 24, a paragraph-level plan and then a passage for creative writing, and an individual word placement for a mini crossword. These show how their experiments instantiate the framework. They do not prove one decomposition is optimal or that similar-looking real tasks should use the same unit.

An operational state definition should include:

- **Fields:** information needed to decide which transitions are legal or useful.
- **Invariants:** properties every accepted transition must preserve.
- **Transition:** what the candidate action adds, replaces, or consumes.
- **Partial evaluation:** what can be checked before the goal is reached.
- **Recovery:** how the controller restores the parent or reopens a state after rejection.
- **Goal and terminal check:** when a candidate is complete and what property is actually verified.

Do not call the state a thought and stop there. For example, an arithmetic search state is not just the text “subtract 9 from 13”; it also needs the remaining values, the expression tree, and the exact multiset of consumed inputs.

## Match generation, evaluation, and granularity

The paper frames the unit-size choice as a balance: a unit too large may be difficult to generate as a useful alternative; a unit too small may not contain enough context for a meaningful progress judgment. The search space and evaluation budget also matter. Treat these as hypotheses to test on the task rather than a three-factor law with fixed cutoffs.

| Design question | If the unit is too coarse | If the unit is too fine | What to test |
|---|---|---|---|
| Can the generator offer distinct continuations? | A whole solution may commit before alternatives can be compared. | Candidate lists may fill with fragments that differ syntactically but not strategically. | Distinct, valid candidates per generation request. |
| Can the evaluator judge partial progress? | A large plan or artifact may hide which decision caused risk. | A token or trivial edit may have no interpretable relation to the goal. | Agreement of heuristic judgment with later exact or human review, scoped to the task. |
| Can a transition preserve state? | Large revisions may obscure what changed. | Many small transitions may create a long sequence of nearly redundant states. | Transition validity, duplicate rate, rollback effort, and cost. |
| Can a failed branch be undone? | The action may bundle several decisions with different dependencies. | Excessive granularity may require many backtracks for one useful alternative. | Parent restoration, dependency invalidation, and recovery correctness. |

The objective is not to maximize branching or minimize depth. A representation is useful when candidates can be generated, differentiated, evaluated at the right scope, and restored without losing required context.

## Task-specific examples from the paper

### Game of 24: equation transitions

The paper represents a state through the remaining values and equation history. Starting with `[4, 9, 10, 13]`, one path is:

| Step | Available values | Transition | Remaining values |
|---|---|---|---|
| 1 | `4, 9, 10, 13` | `13 - 9 = 4` | `4, 4, 10` |
| 2 | `4, 4, 10` | `10 - 4 = 6` | `4, 6` |
| 3 | `4, 6` | `4 * 6 = 24` | `24` |

An exact leaf check evaluates the expression `(10 - 4) * (13 - 9)`, checks that it equals 24, and checks that each input was used exactly once. A partial evaluator may estimate whether the remaining values can reach the target; it is not the leaf checker.

One transition rule can be written without relying on a natural-language “thought” label:

```text
state = (remaining-values, expression-forest, consumed-input-identities)
action = (left-value-id, operator, right-value-id)
child = replace the selected values by the computed result and append its expression node
reject child if an input identity is repeated, an operand is missing, or the operation is undefined
```

This makes repeated equal numbers unambiguous: the two `4` values still have distinct input identities. It also makes subtraction and division order explicit. The expression tree is evidence for a later exact check, not a substitute for that check.

### Creative writing: plan then passage

The paper's task supplies four random sentences and requires a four-paragraph passage ending each corresponding paragraph with one input sentence. Its ToT configuration uses a plan as the intermediate unit, then a completed passage as the next unit. It generates plan candidates, uses comparative votes to select one, and repeats the process for passages. This is one concrete way to separate global organization from realization.

For a local writing task, the plan state might hold paragraph purpose, which required sentence closes each paragraph, and unresolved constraints. A mechanical checker can verify paragraph count and endings. A reviewer or prompted evaluator may compare coherence or thematic fit, but that preference is not a fact-check or proof of quality. Keep objective constraints and subjective ratings in separate fields.

The paper also evaluates iterative refinement from an earlier output. Refinement can be treated as a generation operator that maps one artifact to a new candidate; it need not be mislabeled as a second search algorithm. Record the parent artifact and change request so an evaluator can see what changed.

### Mini crosswords: word placements and crossings

A crossword state stores the grid or placed words and the letter patterns they impose on remaining clues. One transition chooses a clue and proposes a word. The exact crossing constraint can reject an entry that conflicts with already fixed letters. A language-model judgment about whether remaining clues can be filled is weaker: the paper reports that a rare valid entry (“agend”) was treated as impossible, leading to a false prune.

The authors constrain the experiment so later placements do not alter already filled words; this bounds how the search revises its earlier commitments. That makes parent-state backtracking meaningful. It is an experimental design decision; a solver that permits word revisions needs a different transition model and dependency invalidation rule.

## Other domains: design the checker before the branch factor

The following are application examples, not claims made by the ToT paper:

| Domain | Possible state | Invariant or exact check | Candidate partial evaluator |
|---|---|---|---|
| Code repair | patch set, files, tests run, parent revision | parser/typecheck/test for named property; diff stays within authorized files | likely coverage, risk, or suspected cause, explicitly heuristic |
| Data analysis | question, transformations, dataset version, intermediate result | schema and transformation checks; reproducible calculation | whether a result bears on the question |
| Travel/resource plan | remaining tasks, route, resource commitments | time windows, capacities, permissions, and hard constraints | likely utility under stated assumptions |
| Proof search | assumptions, derived lemmas, proof obligations | checker or kernel validates each accepted inference | estimate which obligation or lemma is useful next |
| Document revision | claim ledger, proposed wording, sources, unresolved decisions | citation existence, required-field checks, scope constraints | clarity or comparison against named reader criteria |

For a state with irreversible real-world effects, ordinary tree backtracking is not enough: a plan can be restored in memory while an external action remains. Keep effectful execution behind the relevant authorization and recovery controls; use ToT only for the search that can safely be evaluated.

## Decomposition worksheet

Before implementing search, fill in one row for each candidate representation:

| Field | Decision to record |
|---|---|
| Task/goal | Exact problem statement, audience, and stopping condition. |
| State key | Which values determine legal successors, terminal status, and future evaluation? |
| Action shape | What one proposal changes and which earlier decisions it may revise. |
| Invariants | Exact constraints checked at transition time. |
| Partial evaluator | Property estimated, evidence available, output schema, and known failure cases. |
| Terminal checker | The exact predicate, tool, or reviewer that checks a completed candidate. |
| Backtracking | Parent snapshot, reversible update, or explicit restart requirement. |
| Budget | Candidate generation, expansion, evaluator samples, exact checks, wall time, and cost. |
| Stop result | Verified solution, unverified candidate, no candidate, budget exhaustion, or error. |

Then test at least one successful transition, one rejected transition, one duplicate state, and one deliberately misleading evaluator result. If those cannot be represented clearly, revise the state boundary before scaling the search.

## Practical tradeoffs to measure

The original reference used a heuristic `N / depth` formula to estimate whether an evaluation budget could discriminate states. That is not a supported model: evaluations are not necessarily independent or equally costly, and candidate generation, branching, and prompt length vary. Use measured counts instead.

For each run, record:

1. distinct parent states expanded;
2. generation requests and candidate states returned;
3. invalid and duplicate proposals;
4. evaluator calls and samples per candidate;
5. exact partial checks and exact terminal checks;
6. states discarded by each named policy;
7. backtracks, reopens, and state-restoration errors;
8. verified results and false-prune/false-keep examples where ground truth exists;
9. prompt/completion tokens, elapsed time, and cost if measured;
10. typed stop reason.

Compare different thought units on the same test inputs with the same verifier and a declared resource budget. A coarser unit may save transitions but conceal alternatives; a finer unit may make pruning informative but increase calls. Neither outcome is universal.

## Limits and source

The original ToT experiments manually define the thought representation for each task. The paper does not prove that domain-specific decompositions are unavoidable, that one granularity is best, or that a chosen state representation transfers to a new workload. Its reported results are specific to the paper's prompts, model setup, benchmark samples, and metrics. The primary method, experiment descriptions, and limits are summarized in [Paper method and worked examples](paper-method-and-worked-examples.md).
