# Reactive and proactive integration

Percepts and goal adoptions may both lead to events in a BDI design. This supports a useful local pattern: a goal pursues a delivery, while newly admitted route evidence may offer a new plan selection opportunity. It does not prove continuous automatic revalidation, fairness of event scheduling, or real-time responsiveness.

Define which evidence changes are relevant, how stale/conflicting input is handled, and whether ongoing work is cancellable. For any external cancellation, use the target system’s independent authority and outcome evidence.

## Design and test method

Treat perception/belief updates, adopted goals, and interpreted ACL messages as distinct event sources. At each cycle, select an event, derive relevant/applicable plans, select an intention, and execute one body element. An event can offer a new plan-selection opportunity, but it does not continuously revalidate every executing plan. Tests should deliberately create conflicting route evidence, an unmatched event, a long action, and competing intentions; thrashing, starvation, and deadlock are possible application designs, not platform guarantees.

Record the provenance of context beliefs and check cancellation through the external system’s own authority/evidence. The Jason [Hello BDI tutorial](https://jason-lang.github.io/jason/tutorials/hello-bdi/readme.html) and [Concurrency guide](https://jason-lang.github.io/jason/tech/concurrency.html), accessed 2026-09-24, are the active sources for this cycle boundary.
