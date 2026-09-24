# Imperative and declarative routing are design choices

Imperative routing records a decision and follows its selected edge. Declarative
coordination records constraints and lets an engine choose a satisfying schedule. Either
can implement a workflow only when its observable traces meet the required semantics.

For an OR-split, persist the activated branch set and carry it to the synchronizing
merge. For a deferred choice, expose alternatives and record the external event that
wins. A hybrid model may be preferable; do not claim that one style is intrinsically
more capable without a stated model and test.

## Choose from obligations, not language labels

| Requirement | Possible representation | What still needs checking |
|---|---|---|
| Independent reviews with an all-of result | Dependency constraints and an explicit join | Membership, version identity and absent results |
| One selected route from returned decision data | Predicate and Exclusive Choice | Exactly one route, including malformed decision data |
| First of two external events selects a route | Deferred Choice protocol | Winner arbitration and withdrawing the other alternative |
| Iterate until a bounded acceptance test | State machine, repeated subworkflow or versioned attempts | Stop condition, budget and stale iteration results |
| Admit tasks within four slots | Resource constraint attached to ready work | Actual admission and release accounting |

Constructed contrast: a quality service returning `accept=false` gives input to a
predicate; it is not a deferred choice merely because the service is external. An
operator decision competing with a timeout is a deferred-choice candidate when the
contract enables one alternative and withdraws the other. State what happens if both
observations arrive close together and if a late message has already caused an effect.

## Hybrid design review

Keep the artifact dependency graph distinct from mutable attempt state and resource
admission. An embedded loop may be a legitimate encoding if its lifecycle, exit and
observability are specified. An external coordinator may be appropriate if its ownership
and failure boundary are explicit. Neither a declarative syntax nor arbitrary embedded
code proves an implementation has the required semantics.

For an encoding, publish the minimal state variables, transition guards, emitted events,
reset condition and failure handling. Inspect those details before deciding whether an
escape hatch is maintainable for the team's actual workload.
