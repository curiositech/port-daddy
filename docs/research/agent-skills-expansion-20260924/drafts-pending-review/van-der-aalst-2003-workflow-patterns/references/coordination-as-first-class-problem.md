# Coordination requirements as explicit specifications

Separate task logic from a control-flow contract: name the activity, enabled condition,
incoming branch identities, completion event, and terminal disposition. This preserves
the useful coordination-first lesson without asserting a universal complexity curve.
The number of possible interleavings or paths is a property of a particular workflow,
input domain, and reduction rule; measure it from an executable trace when it matters.

For a review workflow, record whether security and performance branches are both
required (Pattern 2 then 3), one is selected (Pattern 4 then 5), or a runtime subset is
enabled (Pattern 6 then 7). A label such as “parallel review” is not sufficient evidence
of its join semantics.

## Three views of the same review task

| View | Question | Concrete record |
|---|---|---|
| Task/domain | What counts as a sufficient review? | Security and correctness are mandatory; style is advisory. |
| Control flow | What enables publication review? | Mandatory reviews complete for the same artifact revision. |
| Execution substrate | How are those completions observed? | Attempt IDs, artifact hashes, delivery/reconciliation policy and capacity records. |

A task returning a document is not automatically a control-flow completion for the
current revision. A graph edge is not proof of delivery. If the mandatory review changes,
the control contract changes even when the transport and worker code are identical.

## Expose scattered coordination

1. Enumerate every place that can enable, repeat, cancel or declare completion.
2. For each, name the owner, condition, correlation scope and durable observation.
3. Compare duplicate rules: do two workers each retry the same logical operation?
4. Move shared decisions into an explicit contract or document their composition.
5. Test a stale completion and a missing mandatory branch before considering the
   ordinary path sufficient.

Constructed failure: reviewer B returns an old-revision artifact after A completed the
new revision. A join over unversioned role names closes incorrectly. The repair is to
bind membership to the intended revision and record the stale result separately, not
merely to change the display label from “parallel” to “synchronized.”

## Complexity and limits

Routing predicates, active-set tracking, dynamic instance counts, external choice,
failures and resource limits are distinct sources of state. Record the states and
interleavings relevant to the actual workflow. No universal exponential cost follows
from combining a few patterns; equally, a small diagram does not establish easy
verification. Document which combinations the implementation supports and tests.
