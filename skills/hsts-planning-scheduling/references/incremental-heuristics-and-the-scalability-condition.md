# Incremental Heuristics and the Scalability Condition: Building Systems That Grow Without Exploding

## The Scalability Problem

Complex real-world systems are large. The Hubble Space Telescope involves dozens of subsystems, hundreds of possible configurations, thousands of temporal constraints, and tens of thousands of scheduling requests per year. Any problem-solving framework must address a fundamental question: as the domain model grows larger and more complex, what happens to computational effort?

For classical combinatorial approaches, the answer is typically: computational effort grows exponentially with problem size. This is not just a performance concern; it is a feasibility concern. A system that takes 10 seconds to plan for 5 components and 10,000 seconds to plan for 10 components is not a system that can be deployed in practice.

Muscettola makes scalability a first-class design criterion: "a modular and scalable framework should display the following two features: (1) the search procedure for the entire problem should be assembled by combining heuristics independently developed for each sub-problem, with little or no modification of the heuristics; (2) the computational effort needed to solve the complete problem should not increase with respect to the sum of the efforts needed to solve each component sub-problem." (p. 19-20)

Feature (2) — additive scalability — is a remarkably strong requirement. Most systems are satisfied with polynomial growth. Muscettola demands additive growth: solving a problem with ten independent sub-problems should cost roughly ten times what solving one sub-problem costs, not a multiplicative or exponential blow-up.

## Why Additive Scalability Is the Right Bar

Polynomial growth still fails in practice at real system scale. If per-component cost grows even quadratically with the number of components, a system with an order of magnitude more subsystems (dozens of instruments and support systems, in the Hubble Space Telescope's case) becomes computationally intractable long before it becomes physically complex. Additive scalability is the only growth rate compatible with treating the whole system as literally "the sum of its parts" from a computational standpoint.

Feature (1) is what makes feature (2) achievable: heuristics developed independently, sub-problem by sub-problem, are exactly the kind of building block that composes additively. If a heuristic for scheduling the tape recorder had to be re-derived, or even re-tuned, every time a new instrument was added to the model, the framework would fail feature (1) and, as a direct consequence, fail feature (2) as well — the cross-heuristic interactions would grow combinatorially with the number of subsystems.

## The Mechanism: Search Localized to Bottlenecks

HSTS achieves additive scalability by localizing search to *bottlenecks* — the state variables and resources under the tightest contention — rather than searching the full joint space of all state variables simultaneously. A heuristic evaluates each bottleneck's local conflicts and proposes a resolution; because the evaluation and resolution are scoped to that bottleneck's neighborhood in the constraint graph, adding an unrelated subsystem elsewhere in the model does not change the cost of resolving this bottleneck. Cost grows with the *number* of bottlenecks addressed, not with the size of the joint configuration space.

## Application to Agent Systems

For multi-agent orchestration, the scalability condition translates directly: an orchestrator's per-task heuristics (which agent to invoke, how to schedule a retry, how to resolve a resource conflict) should be developed and evaluated locally, against the specific contention they address, not against the full joint state of every agent in the system. A workflow with twice as many independent agent lanes should cost roughly twice as much to plan and execute, not four times as much. Where that additive property breaks down — where adding an unrelated agent to the DAG measurably slows down decisions about agents it never interacts with — is exactly where the orchestration design has smuggled in a global search over the joint state space, and it is worth going back and re-scoping the heuristic to the actual point of contention.