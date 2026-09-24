# Hierarchical teaching models for ReAct-style trajectories

## A teaching representation, not a hidden state model

A useful way to review the ALFWorld knife example is to name four **declared** layers:

1. task goal: put a clean knife on a countertop;
2. proposed decomposition: find, take, clean, place;
3. proposed next action: navigate or manipulate;
4. observation: environment response.

These layers are an authoring and controller-review model. ReAct does not formally prove that they are internal model states, that every generated trace obeys them, or that they causally explain an action.

## What the representation can do

A task controller can store a proposed subgoal and attach explicit preconditions. For example, before calling a clean action, it can require an observed held knife and observed sink location. The controller rejects a failed precondition regardless of whether the model wrote a plausible plan.

The paper's successful knife trajectory supplies a worked prompt example: it names finding, taking, cleaning, and placing. Its generated list of likely locations is a search hypothesis in that environment, not a verified probability distribution or exhaustive ordering. A bounded implementation may try a candidate location, record the observation, then revise the plan.

This representation can reduce a controller's candidate set **if** the task schema, preconditions, and candidate ranking are supplied. It does not eliminate irrelevant actions, make a next action obvious, or prevent a model from emitting an invalid action.

## Observation-driven revision

In HotpotQA, a generated plan can be revised after a search observation introduces a bridge entity. Preserve this practical method:

- state the missing relation or fact;
- perform an authorized task-specific action;
- retain the observation and source;
- revise the next query or state a limitation.

The paper's examples show such revisions. They do not establish that every fixed plan is hard to change, that a generated plan cannot skip a satisfied step, or that the model must alternate in all implementations. If a step can be skipped, the controller should record the observed completion condition and authorize the transition.

## Relation to Inner Monologue results

The paper reports ALFWorld results for particular prompts, models, tasks, and metrics, including an average ReAct/IM comparison. A possible interpretation is that the shown ReAct prompt supplies more useful goal-decomposition and progress text than the IM prompt in that setup. It is not causal proof that an abstraction hierarchy alone produced the difference, and it is not a guarantee that a future hierarchy outperforms a future dense trace.

## A controller fixture

```text
state: holding_knife=false, at_sink=false, knife_clean=false
proposed_subgoal: clean knife
precondition: holding_knife && at_sink
result: reject clean action; request navigation or acquisition action
```

This fixture is a constructed enforcement policy. The visible subgoal text assists inspection; state and preconditions carry enforcement.

## Source boundary

The hierarchical labels are an explanatory reconstruction of ReAct examples, not named formal levels in the paper. The source supports interleaved thought/action/observation trajectories and observation-driven plan adjustment in specific tasks.
