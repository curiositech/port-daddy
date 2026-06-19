# Diagrams for fipa-00023-agent-management

**Primary Focus:** Infrastructure patterns for agent naming, discovery, lifecycle management, and federated registry architecture in multi-agent systems.

| File | When to load |
|------|-------------|
| [01_stateDiagram-v2_agent_lifecycle_state_machine.md](01_stateDiagram-v2_agent_lifecycle_state_machine.md) | You need to reason about valid agent state transitions, who is authorized to trigger each one, or what to do when an agent is in a non-Active state |
| [02_sequenceDiagram_agent_discovery_&_registration.md](02_sequenceDiagram_agent_discovery_&_registration.md) | You're implementing the AMS-before-DF registration sequence, tracing a federated discovery flow, or debugging why a consumer agent can't find a newly registered peer |
| [03_flowchart_decision_tree_agent_addressin.md](03_flowchart_decision_tree_agent_addressin.md) | You need to decide how to resolve an agent reference — whether to query AMS first, check lifecycle state, or handle the case where a stored AID is stale |
