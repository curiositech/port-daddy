# Search algorithms and state management

## Controller inputs

Before choosing a search policy, specify the object it controls:

```text
SearchProblem:
  initial_state
  generate(state, limit, mode) -> candidate actions
  transition(state, action) -> child state | rejection
  evaluate(state or candidate-set) -> heuristic record
  goal(state) -> true | false | unknown
  verify(candidate) -> checked property | fail | unknown
  canonical_key(state) -> key for duplicate handling
  budget -> generation, expansion, evaluation, exact-check, time and cost limits
```

These names are an implementation sketch, not runnable ToT code. Treat `unknown` as a distinct result, never as a truthy success value. Every costly generator, evaluator, or verifier call must reserve its permitted budget before it starts, then account for actual use; a loop-top check alone does not bound an in-flight call. The controller sketches below assume this shared call gate. A real application must specify each return type and failure path. In particular, an evaluator score does not replace `goal` or `verify`, and a parser failure is not a heuristic value.

Tree of Thoughts treats thought generation, state evaluation, and the search procedure as separable choices. The paper demonstrates bounded breadth-first search for Game of 24 and creative writing and depth-first search for mini crosswords. It explicitly leaves A* and Monte Carlo tree search for future work. Do not infer an A* guarantee from an LM heuristic.

## Breadth-first with bounded selection

The paper's BFS procedure starts with the input state, generates candidate successors from each retained state at one depth, evaluates them, and keeps a bounded set for the next iteration. Since it selects a limited set by heuristic value, it is beam-like pruning, not exhaustive breadth-first enumeration. A viable branch can be dropped.

```text
frontier = [initial_state]
for depth in 1..depth_limit:
    candidates = []
    for state in frontier:
        actions = generate(state, generation_limit, mode)
        for action in actions:
            child = transition(state, action)
            if child is accepted by exact transition invariants:
                candidates.append(child with parent/action provenance)
    candidates = apply_duplicate_policy(candidates)
    evaluations = evaluate(candidates)
    frontier = select_declared_width(candidates, evaluations)
    verify any candidate leaves if the task permits early checking
    stop if verified solution, budget limit, or explicit error condition
return typed result and search record
```

The paper's Game-of-24 and creative-writing breadth/depth values belong to its experiment. For a local task, breadth selection can be based on a value ranking or comparative votes, but the selection policy must name how ties, malformed outputs, duplicate states, and uncertain evaluations are handled.

### BFS worked state

For Game of 24, one state after `13 - 9 = 4` is remaining values `[4, 4, 10]` plus the expression node and consumed input identities. A breadth-limited controller can retain this state alongside other candidates at the same depth. If it discards the only viable arithmetic path because a score is low, later exact checking of retained leaves cannot recover that lost branch. Keep a prune record and allow a wider retry or alternate policy only if its declared budget permits.

## Depth-first search and backtracking

The paper's DFS configuration creates an ordered list of child candidates, evaluates a candidate, follows one deemed promising, and returns to its parent when a branch is rejected or exhausted. The mini-crossword experiment uses crossings to constrain remaining word placements and forbids later thoughts from changing already filled entries. These constraints make each state and its parent relationship explicit.

```text
visit(state, depth):
    if goal(state) is exactly true:
        result = verify(state)
        if result passes the named property:
            record verified candidate
            return according to stop policy
    if depth >= depth_limit or budget exhausted:
        record limit at this state
        return

    children = generate_and_validate(state)
    order children using the declared heuristic or vote policy
    for child in children:
        if global budget exhausted:
            propagate budget_exhausted to every caller
        record parent, action, evaluation, and remaining budget
        if local exact invariant fails:
            record transition rejection
            continue
        if optional heuristic says prune:
            record heuristic prune, not proved impossibility
            continue
        outcome = visit(child, depth + 1)
        if outcome requests global stop:
            propagate that outcome to every caller
        restore the parent snapshot before trying the next sibling
```

The paper uses a task-specific step cap in its crosswords experiment. A cap is a stop condition, not a proof of infeasibility. On exhaustion, preserve the deepest or best candidate only with a clear `unverified` label unless the task's exact verifier passed.

### Crossword-style restoration

Suppose a parent grid has a partially constrained vertical clue. A proposed horizontal word fills a crossing letter and leaves no plausible vertical entry under the model's evaluation. The controller should:

1. retain the parent grid and the proposed word as separate immutable records;
2. record which crossing checks passed and which clue evaluation caused the prune;
3. return to the parent state;
4. try the next sibling candidate, or relax only the named heuristic policy under a recorded budget;
5. run an exact grid/answer check on a completed candidate.

Do not mutate the only grid in place and then attempt an informal “undo.” A missing restoration can silently contaminate sibling branches. The paper's reported rare-word false prune is a concrete reason to preserve the rejected branch and distinguish exact crossing conflicts from model judgments about vocabulary.

## Choosing among policies

Properties in this table are design considerations, not universal thresholds:

| Question | Breadth/beam-like choice may help when… | Depth-first choice may help when… |
|---|---|---|
| Depth and frontier | Several high-level alternatives should remain alive and the useful depth is limited. | A path can be extended one choice at a time and memory for a large frontier is costly. |
| Partial evaluator | Candidate states can be ranked well enough to choose a retained set, with false-prune risk measured. | There is a useful local dead-end check; each branch can be abandoned and parent restored. |
| Constraints | Alternatives remain comparable at the same depth. | Assignments impose useful constraints on later choices. |
| Recovery | Dropped states can be logged and revisited if later evidence warrants it. | Parent state and sibling cursor are reliable. |
| Stop condition | A layer, verification, or budget boundary can define a clear stop. | A verified candidate or exhausted stack can define the stop; a finite step cap still yields only “budget exhausted.” |

The paper's configurations are not a benchmark sweep over all possible tree shapes. A hybrid, iterative-deepening, or graph-search policy is an application design; test it separately and do not attribute its properties or results to Yao et al.

## Duplicate states and graph search

A repeated state can arise through different actions. The key must include every field that affects the available transitions, evaluator context, or terminal predicate. In Game of 24, a multiset of remaining numeric values is insufficient if the expression or original input identity is needed for final provenance; canonicalize expression-equivalent states only if that equivalence preserves every relevant constraint.

For a strict tree, retain the parent chain because the same logical state may have distinct paths. For a graph, a visited set can avoid repeated work, but it may change which paths remain available. If path cost or depth affects future choices, store the relevant best record and define when an improved path reopens a state. A closed-state policy must not erase a potentially better route without a stated argument.

Use a duplicate record like:

| Field | Meaning |
|---|---|
| Canonical key | State identity under an explicitly justified equivalence. |
| First parent/action | How the state was reached. |
| Alternate parents | Other derivations kept for provenance or recovery. |
| Evaluation records | Score/votes with prompt, model, and state version. |
| Expanded version | Whether a later change warrants reopening. |
| Verification | Exact property checked, result, and verifier version. |

Never remove meaningful state context merely to increase deduplication. A key collision is not a harmless optimization if it merges different legal successor sets or goal predicates.

## Budget accounting and adaptive choices

Search cost is not captured by `candidate_count / depth`. A generation request can return several proposals, one evaluation can sample multiple times, and exact checks can have different costs. Track these separately:

```yaml
run_id: local-test-07
policy: beam_width_3
generation_requests: 12
candidate_states: 31
invalid_transitions: 2
duplicate_states: 4
expanded_states: 7
evaluator_requests: 31
evaluator_samples: 3
exact_partial_checks: 10
exact_terminal_checks: 2
backtracks: 0
elapsed_seconds: 18.4
completion_tokens: 5800
stop_reason: budget_exhausted
verified_solution: false
```

The values are illustrative and do not report an experiment. For a local policy, define caps before execution and return the cap reached. You can use observed costs to adapt later runs, but tuning and evaluating on the same held-out labels can overstate performance. A practical staged policy might begin with a small frontier, check whether exact valid leaves appear, and widen or change strategy only within an explicit total budget. Such an adaptive policy is a local proposal to test, not a ToT paper result.

The paper's Appendix B reports higher computation for ToT than IO/CoT in its experiments, while also showing task-specific performance/cost tradeoffs. Its historical dollar amounts depend on the paper's 2023 setup and are not current pricing. Preserve actual prompt/completion tokens or measured price from the tested provider rather than carrying those dollar values into a new deployment estimate.

## Terminal selection and stop outcomes

State ranking and final candidate selection are separate controller decisions. The paper's crossword experiment reports that choosing an oracle best explored state improved solved-game count over its heuristic output-selection procedure. That ablation shows selection error in that experiment; it does not establish a generally available oracle.

At each stop, state the strongest evidence actually obtained:

| Outcome | Required record |
|---|---|
| `verified_solution` | Candidate, verifier/property, verifier version, and successful result. |
| `unverified_candidate` | Candidate and heuristic/ranking basis; clearly say verification was not established. |
| `budget_exhausted` | Which budget ended the run and best retained states. |
| `no_candidate_generated` | Prompt/generator attempts and parse/transition failures. |
| `exhausted_search` | Exact search space, completeness conditions, and exhaustive completion evidence; only then may an exact infeasible label be warranted. |
| `error` | Failing state, component, and recovery/continuation status. |

A high-valued state, a dead evaluator response, or a finite search limit does not by itself establish impossibility. The central skill is to keep the controller's selection decision distinct from verified outcomes.

## Related methods and limits

ToT's primary paper defines its own BFS and DFS algorithms and notes A* and MCTS as directions for future work. Do not fold A* path-cost/heuristic conditions into a prompted value evaluator or claim ToT has formal optimality guarantees. If implementing another algorithm, use its authoritative source and test the exact assumptions on the real state graph.

For the full four-component method, paper-bound benchmark descriptions, and complete task walkthroughs, read [Paper method and worked examples](paper-method-and-worked-examples.md). For properties of LLM values and comparative votes, see [State evaluation](llm-self-evaluation-as-search-heuristic.md).
