# References for fipa-00023-agent-management

| File | When to load |
|------|-------------|
| [fipa-two-registry-architecture.md](fipa-two-registry-architecture.md) | You're designing a registry that conflates agent existence with service availability — the canonical argument for the AMS/DF split |
| [fipa-identity-vs-location-separation.md](fipa-identity-vs-location-separation.md) | You're tempted to store transport addresses as identifiers, or you need the formal AID model for why agent identity must be stable across moves and protocol changes |
| [fipa-agent-lifecycle-state-machine.md](fipa-agent-lifecycle-state-machine.md) | You need the authoritative breakdown of all lifecycle states, which entity owns each transition, and what orchestrators must do for each state |
| [lifecycle-states-as-coordination-contracts.md](lifecycle-states-as-coordination-contracts.md) | You're handling a dependency on an agent that is suspended, in transit, or unknown and need to know which orchestrator response each state requires |
| [agent-discovery-without-omniscience.md](agent-discovery-without-omniscience.md) | You're building a capability registry and want to understand why a single central table fails under real-world dynamic conditions |
| [federated-discovery-without-central-authority.md](federated-discovery-without-central-authority.md) | Agents in your platform need to discover capabilities that exist in another organization's platform without a shared global registry |
| [fipa-capability-search-and-matching.md](fipa-capability-search-and-matching.md) | You're implementing DF search and need to understand partial template matching — how to find agents when you don't have the exact capability spec |
| [partial-matching-as-coordination-under-uncertainty.md](partial-matching-as-coordination-under-uncertainty.md) | Your capability query returns no results even though a matching agent exists, because the search template is over-specified |
| [fipa-exception-taxonomy-as-reasoning-tool.md](fipa-exception-taxonomy-as-reasoning-tool.md) | You're designing error responses for agent-to-agent calls and need the formal FIPA exception ontology |
| [exception-hierarchies-as-failure-language.md](exception-hierarchies-as-failure-language.md) | You're writing recovery logic and need to map each FIPA exception type to its correct remediation action |
| [separation-of-existence-and-capability.md](separation-of-existence-and-capability.md) | You're auditing a unified registry design and need the argument for why existence and capability must be tracked separately |
| [fipa-registry-patterns-and-authorization.md](fipa-registry-patterns-and-authorization.md) | You need to implement ownership and access-control rules — who may modify an agent's registration and how unauthorized modification is prevented |
| [fipa-message-performatives-and-interaction-patterns.md](fipa-message-performatives-and-interaction-patterns.md) | You're choosing between REQUEST, INFORM, and QUERY-REF and need the formal grammar of FIPA communication performatives |
| [fipa-platform-abstraction-and-interoperability.md](fipa-platform-abstraction-and-interoperability.md) | You're designing interfaces between agent platforms and need to understand what FIPA mandates at the boundary vs. what it leaves to implementation |
