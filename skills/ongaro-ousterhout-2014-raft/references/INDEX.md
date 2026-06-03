# References for ongaro-ousterhout-2014-raft

| File | When to load |
|------|--------------|
| [decomposition-as-coordination-strategy.md](decomposition-as-coordination-strategy.md) | You're designing a multi-component system and experiencing tight coupling, or you want to understand why Raft's three-way split reduces interdependency |
| [failure-modes-and-recovery-design.md](failure-modes-and-recovery-design.md) | You're implementing fault tolerance, the system is hitting undefined failure states, or you're designing recovery logic from scratch |
| [implementing-vs-specifying-distributed-systems.md](implementing-vs-specifying-distributed-systems.md) | You're writing specs or documentation and need to close the gap between theoretical description and implementable detail |
| [randomization-and-coordination-simplicity.md](randomization-and-coordination-simplicity.md) | You're facing split-brain or coordination deadlocks, or a deterministic approach keeps generating new corner cases |
| [state-space-reduction-through-constraints.md](state-space-reduction-through-constraints.md) | Your system has too many edge cases, you're debugging mysterious state corruption, or you're choosing which invariants to enforce |
| [strong-leadership-vs-democratic-coordination.md](strong-leadership-vs-democratic-coordination.md) | You're choosing between a centralized orchestrator and peer coordination, or designing a leader election mechanism |
| [understandability-as-measurable-goal.md](understandability-as-measurable-goal.md) | You're evaluating competing design alternatives and need criteria beyond performance, or the system is theoretically correct but brittle in practice |
