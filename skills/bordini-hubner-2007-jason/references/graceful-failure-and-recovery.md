# Graceful failure and recovery

A failed action or failed subgoal can become a failure event that activates a recovery plan. This is useful because recovery is ordinary plan-library material with visible contexts. It does not establish that all failures are recoverable or that a handler will be selected automatically.

For the constructed delivery example, `-!move_to(D)` with an admitted `route_blocked(D)` can request a route review. If the block evidence is absent, stale, or contradictory, the recovery context does not hold; record the disposition and let an independently authorized operator/process decide the next action. A timeout is a local absence observation, not proof that a recipient or external action failed.

## Failure-event method

A failed `+!g` produces `-!g` in the same intention. Jason can re-evaluate currently applicable options; a `-!g` recovery plan can inspect failure annotations or `.current_intention`, clean up, and retry under local policy. The failed plan stays on the intention stack until the handler completes.

```agentspeak
+!move_to(D) : route_known(D) <- .move(D); .mark_arrived(D).
-!move_to(D) : route_blocked(D) & not compensated(D) <-
  .release_reservation(D); +compensated(D); !request_route_review(D).
```

No automatic rollback occurs for `.move(D)` or other environment effects. The compensation needs authority and outcome evidence; use an attempt belief/ledger to prevent repeat attempts. Jason [FAQ: plan failure](https://jason-lang.github.io/doc/faq.html), accessed 2026-09-24, describes the failure event and notes the mechanism is not formalized in semantics.
