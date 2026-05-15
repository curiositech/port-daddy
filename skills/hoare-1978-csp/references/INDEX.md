# References for hoare-1978-csp

Deep-dive materials on CSP's core mechanisms, drawn from Hoare's 1978 CACM paper.

| File | When to load |
|------|--------------|
| [failure-modes-in-concurrent-systems.md](failure-modes-in-concurrent-systems.md) | You're debugging a hang or deadlock and need the formal taxonomy of failure modes |
| [guarded-commands-for-nondeterministic-choice.md](guarded-commands-for-nondeterministic-choice.md) | You're designing a server that must select among multiple ready clients or input sources |
| [nondeterminism-and-fairness-in-coordination.md](nondeterminism-and-fairness-in-coordination.md) | You need to reason about fairness guarantees when multiple guards are simultaneously enabled |
| [pattern-matching-for-message-discrimination.md](pattern-matching-for-message-discrimination.md) | You're routing different message types to different handlers on a shared channel |
| [process-topology-as-system-architecture.md](process-topology-as-system-architecture.md) | You're making top-level decisions about how to decompose a concurrent system into communicating processes |
| [synchronous-communication-as-coordination-primitive.md](synchronous-communication-as-coordination-primitive.md) | You're choosing between synchronous vs. async messaging or justifying synchronous handshake overhead |
| [termination-propagation-through-process-networks.md](termination-propagation-through-process-networks.md) | You're designing clean shutdown or lifecycle management for a pipeline or process network |
