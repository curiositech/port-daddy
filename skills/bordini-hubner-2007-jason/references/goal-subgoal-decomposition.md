# Goal and subgoal decomposition

A plan body can post a subgoal to separate the route decision, movement, and arrival record. This is a practical way to expose intermediate outcomes. It does not demonstrate that a subgoal runs immediately, in a new thread, or with a particular intention-stack shape; check the pinned runtime documentation and tests.

Use a constructed cycle guard rather than arbitrary depth: retain the local key `(goal name, normalized arguments, admitted evidence revision)`. If the same key is re-adopted without a relevant evidence change, return a `repeat-without-new-evidence` disposition. Decide locally whether to stop, solicit a bounded review, or defer. That preserves the useful termination method while avoiding a false universal cutoff.

## Intention operators

`!g` runs an achievement subgoal in the current intention and suspends its caller until it completes. `!!g` starts a separate intention and lets its caller continue. `|&|` fork-joins both subgoals; `|||` finishes on the first and drops the other. Default intentions interleave round-robin one topmost body step at a time, but a long Java/internal action can still occupy the cycle. `atomic` prevents other intentions from running and should remain short.

Use `!deliver → !choose_route → !move_to → !record_arrival` when each parent result matters. Use `!!notify` only when delivery may safely proceed without notification completion. Jason’s [Concurrency guide](https://jason-lang.github.io/jason/tech/concurrency.html), accessed 2026-09-24, supports these rules.

## Test goals are queries, not achievement goals

Use `?p` when the current belief base must satisfy `p` before the next deed runs. Jason first queries the belief base. If it succeeds, bindings flow into the remaining plan body. If it fails, the interpreter can generate an internal `+?p` event so an applicable plan can establish the test; the FAQ describes test-goal failure handling via `-?p`. Unhandled or failed recovery can propagate to an enclosing achievement goal and ultimately discard the intention; a `-?p` handler is not a guarantee that the query obtained a binding.

```agentspeak
// Constructed local-only query example; no external movement is authorized.
+!show_route(P) : assigned(P) <- ?route(P, D); .print("candidate route", D).
+?route(P, D) : route_record(P, D) <- +route(P, D).
-?route(P, D) : route_unavailable(P) <- .fail.
```

The example uses a pre-existing local `route_record` to supply a binding. A declared unavailable route makes the recovery plan fail rather than pretending that printing an error supplied a destination. No enclosing `-!show_route` handler is provided; unhandled failure ends that intention. These fragments are unexecuted and require a pinned interpreter check. The example expresses a local evidence policy: `?route(P,D)` does not wait for arbitrary remote completion or establish route truth outside the belief base. The exact Jason test-goal/failure mechanism is documented in the author-maintained [FAQ](https://jason-lang.github.io/doc/faq.html), test-goal and plan-failure sections (page labeled Jason 3.2), accessed 2026-09-24; it was checked in the supplied source-depth audit.
