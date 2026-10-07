# From outline `O` to content `C` and plan `P`

## Source sequence

HTP constructs an outline `O`, then applies self-guided planning with the permitted knowledge base to form detailed content `C`, and generates final plan `P`. The source explains that `O` alone is incomplete when leaves require knowledge-intensive subtask reasoning. Do not mark an outline as execution, completed work, or final plan.

## Evidence-bearing leaf contract

For every leaf, state: required inputs, permitted knowledge source, output predicate, shared constraints, failure state, and integration owner. Example: a `Route` leaf may require dates and budget, use an approved route source, output an itinerary plus cost, and declare an unknown effect if a booking request may have been sent but no receipt exists.

## Integration check

Combine Route and Lodging only after both return records. Validate date alignment, total cost, provenance, and authority. If route time makes the lodging unavailable, record `constraint_conflict`, identify both inputs, and revise an affected leaf. This is an implementation contract layered around HTP; it is not a claim that Algorithm 1 performs booking, retries, or backtracking.

## Use in a deployment

Materializing `O` can make planning reviewable. It does not itself materialize a runtime DAG or authorize any action. Add a scheduler only after defining the task-system semantics separately.
