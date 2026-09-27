# Rule libraries as generalized planning knowledge

## Source role

HTP uses a task-specific rule library `R`, not a collection of mandatory agent personas. A rule author supplies a start-node category and a child set; Algorithm 1 uses the rule to expand a selected divisible leaf. The source evaluates this representation in its named planning benchmarks. It does not prove that rules eliminate examples for every domain or that they generalize independently of rule quality.

## Rule authoring procedure

1. Name the parent concern and the complete candidate child set.
2. State the evidence that makes the parent divisible.
3. List shared constraints that no child owns alone.
4. Provide a no-rule outcome: keep the node as a leaf rather than fabricating a branch.
5. Test the rule on at least two constructed inputs and record whether it omitted a required concern.

Example: `Accommodation(city) -> {availability, policy, room-type, cost}` is a planning checklist. It is not a statement that cost can be computed without availability or that the children may run concurrently. A missing `policy` child is a coverage defect; a shared stay-date constraint is an integration obligation.

## Experiment reading

The paper’s rule-versus-baseline observations are setup-bound. Preserve the model, dataset, prompt, and table row before stating a comparison. For a local rule library, test coverage, ambiguity, pruning behavior, and integration failures; do not use a benchmark gap as proof that a new rule set will generalize.
