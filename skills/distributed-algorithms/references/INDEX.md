# References Index

| File | When to load |
|------|-------------|
| `impossibility-results-as-engineering-constraints.md` | You're hitting a wall and need to know if what you're attempting is provably impossible; FLP, Byzantine thresholds, or lower bounds are in scope |
| `reference-impossibility-results.md` | You need the full theoretical grounding for impossibility — complete landscape of what cannot be built and why, at Lynch's level of rigor |
| `timing-models-and-their-consequences.md` | You're choosing between synchronous/asynchronous/partially-synchronous architectures; failure detectors and "why does consensus work here but not there?" |
| `reference-timing-and-partial-synchrony.md` | You need deep formal treatment of the three timing models; partial synchrony, GST, and real-time bounds on specific protocol guarantees |
| `failure-models-and-fault-tolerance.md` | You're designing fault-tolerant systems; evaluating crash vs. Byzantine distinctions and the n > kf thresholds that govern them |
| `distributed-consensus-the-complete-picture.md` | Consensus, Paxos, Raft, leader election, atomic broadcast, or any agreement protocol is under discussion; need the complete problem taxonomy |
| `formal-proof-methods-for-distributed-systems.md` | You're proving correctness or finding subtle bugs via formal reasoning; invariant assertions and simulation relations are in scope |
| `reference-formal-models-and-proof-methods.md` | You need the foundational I/O automata model and the full formal proof machinery for reasoning about interleaved executions |
| `synchronization-primitives-and-atomic-objects.md` | Shared-memory concurrency; the compare-and-swap power hierarchy; wait-free vs. lock-free; building atomic objects from weaker primitives |
| `reference-atomicity-and-consistency.md` | You're building composable services from atomic objects; need the atomicity composition theorem in depth and what shared state can and cannot do |
| `algorithm-design-patterns-and-canonical-problems.md` | You need a known algorithm for a canonical problem (broadcast, election, snapshot) or are connecting a new problem to a known one |
| `reference-algorithm-families-and-patterns.md` | You want the full taxonomy of algorithm families by problem class — why canonical solutions are minimal and what their complexity signatures reveal |
