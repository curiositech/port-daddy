# Context-driven plan selection

Plan contexts encode applicability conditions; they are not a claim that the condition is true outside the belief base. Retain the source bundle’s useful distinction between a trigger, a context, and a plan body. Build a local coverage table:

| Event | Context evidence | Candidate plan | Unknown/none disposition |
| --- | --- | --- | --- |
| `+!deliver(P,D)` | fresh `route_known(D)` and no admitted block | move-and-record | request/reject evidence or record unmatched |
| `+!deliver(P,D)` | admitted `route_blocked(D)` | route review | record unmatched if no review plan |
| `-!move_to(D)` | evidence says block remains | recovery review | stop/escalate under local policy |

If two rows apply, a runtime may have a selection mechanism, but an application should not fabricate “specificity” or historical-score precedence. State its actual policy and preserve enough evidence to reproduce the choice. Do not use a `true` catch-all merely to satisfy a coverage count; it turns an unknown precondition into apparent success.

## Jason cycle and selection boundary

An initial belief/goal or received update creates an event. Jason selects it, finds plans whose trigger matches, evaluates contexts in the current belief base, selects an option, instantiates an intention, then executes one body element. Selection is customizable (`selectEvent`, `selectOption`, and `selectIntention` are extension points); plan order is not an invariant. A belief update creates another event but does not silently replace a running plan. Put stale-assumption checks in the body or recovery plan.

The official [Hello BDI tutorial](https://jason-lang.github.io/jason/tutorials/hello-bdi/readme.html) demonstrates sourced beliefs: a received `tell` can create a `+belief` event, and a trust-sensitive context can require `[source(self)]`. It supports local admission design, not sender authentication. Source accessed 2026-09-24.
