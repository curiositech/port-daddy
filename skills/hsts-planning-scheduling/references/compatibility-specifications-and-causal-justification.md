# Compatibility Specifications and Causal Justification: Encoding Domain Knowledge as Constraint Templates

## The Problem with Unstructured Domain Knowledge

Classical planning systems carry domain knowledge as operators: preconditions that must be true before an action can be executed, and effects that become true (or false) after execution. This captures the *logical* structure of action but poorly captures the *temporal* and *resource* structure. An action's preconditions must be satisfied at the instant of execution, but what about conditions that must persist throughout the action? What about resources that must be reserved not just at the moment of use but during preparation and cleanup? What about sequences of intermediate states that an action necessarily passes through?

Classical scheduling systems carry domain knowledge as resource profiles and processing time distributions. These capture temporal structure but sacrifice all causal content — there is no record of *why* an activity requires a particular resource, or what happens to related resources during its execution.

HSTS takes a different approach: domain knowledge is encoded as **compatibility specifications** — formal templates describing the patterns of temporal relationships that must hold in any legal system behavior. These templates are attached directly to state variable values, not to actions, which means they can express both what happens during a value's occurrence and what must be true in the surrounding context.

## The Structure of Compatibilities

A compatibility has the form:

`[temporal-relation <comp-class, state-variable, value-type>]`

which reads: "while this value is occurring on its state variable, a behavior segment of type
`value-type` on `state-variable` must exist, standing in relation `temporal-relation` to the current
value." (See `compatibility-constraints-as-causal-knowledge.md` for the full temporal-relation
vocabulary — `before`, `after`, `contained-by`, `contains`, `meets`, `equals` — and a worked example
built from a telescope's `LOCKED` state.)

## From Templates to Justification Trees

The distinctive move in HSTS is what happens to a compatibility once it is attached to an actual
occurrence in the plan: it becomes an obligation the planner must discharge, and every value token
in the timeline accumulates its own instance of its type's compatibility template, called a **causal
justification tree**. Each leaf of that tree is one compatibility; a leaf is "open" until a matching
behavior segment is found or created elsewhere on the timeline, and "achieved" once it is. The tree's
root is achieved only when every mandatory compatibility underneath it is achieved — at that point,
the token's presence in the plan is fully explained: every state it depends on, every resource it
needs, and every legal predecessor/successor it requires has been accounted for.

This is what "causal justification" means concretely: not just that a value is scheduled, but that
the *reason* it is legal to schedule is recorded and checkable. A plan is not just a set of
non-conflicting activities; it is a set of activities each of which carries an explicit, inspectable
argument for why it is allowed to occur where it does.

## Application to Agent Systems

For agent orchestration, the causal-justification-tree idea is the difference between "the workflow
ran without erroring" and "every step in the workflow can point to the specific upstream fact,
resource, or approval that justified it." Attaching a compatibility template to each task type (what
inputs must exist, what capability must be available, what prior approval must be recorded) and
tracking which of those obligations are open versus achieved gives an orchestrator the same benefit
HSTS gets: when something goes wrong, the open leaves of the justification tree localize exactly what
was never established, instead of leaving the failure as an undifferentiated "the pipeline broke."