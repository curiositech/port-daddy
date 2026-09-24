# Mapping team patterns onto an invocation contract

These are design inputs. Each pattern still needs an external admission controller,
capacity reservations, effect boundaries and independent review. A lead or observer role
does not acquire those powers from its place in a diagram.

| Pattern | Static projection | Retain in the review record | Characteristic failure |
|---|---|---|---|
| Lead and specialists | Declared disjoint work nodes, artifacts and sealed gather | Scope map, dependency contracts, reviewer and integration owner | Vague ownership or a lead approving its own output |
| Tournament | Bounded independent candidate attempts and declared comparison reducer | Per-candidate isolation, fixed rubric, evaluator, artifact hashes, disposition of nonselected work | Spending past the ceiling or selecting after changing the rubric |
| Relay chain | Acyclic stage dependencies with versioned input/output schemas | Handoff acceptance, exact consumed artifacts and downstream invalidation rules | A later stage consuming an unaccepted revision |
| Ambient observation | Finite watch window, observation inputs and named action owner | Coverage, last observation, escalation conditions, stop and renewal rules | Silent missing observations interpreted as healthy state |

Constructed tournament: two candidates may finish and one reviewer compares them. A
quorum result may be meaningful for the product while the absent candidate still holds
capacity. Record semantic closure and each attempt's termination/accounting separately.
A losing artifact is retained or discarded under its declared policy; selection alone is
not permission to delete another worker's checkout.

For a relay, record the producer revision and artifact hash at every edge. A changed
producer invalidates affected downstream consumption according to the artifact contract;
independent branches need not be rerun. Resource conflicts constrain admission rather
than changing what the artifact depends on.
