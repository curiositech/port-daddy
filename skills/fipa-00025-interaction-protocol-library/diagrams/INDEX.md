# Diagrams for fipa-00025-interaction-protocol-library

**Primary Focus:** Protocol-based coordination for distributed multi-agent systems: designing reusable, interoperable interaction patterns that enable complex collaboration between autonomous agents while managing temporal coordination and supporting dynamic role assignment.

| File | When to load |
|------|--------------|
| [01_sequenceDiagram_fipa_interaction_protocol_mess.md](01_sequenceDiagram_fipa_interaction_protocol_mess.md) | You need to trace the exact message sequence through the FIPA Request protocol's agree/refuse/inform-done/inform-failed branches for a concrete Initiator–Participant pair |
| [02_stateDiagram-v2_protocol_state_machines_and_ag.md](02_stateDiagram-v2_protocol_state_machines_and_ag.md) | You're debugging agent conversation-state management or need to show how conversation IDs gate state transitions from IDLE through WAITING, PROCESSING, NEGOTIATION, and COMPLETED |
| [03_flowchart_decision_framework_for_protoco.md](03_flowchart_decision_framework_for_protoco.md) | You're choosing or designing a protocol and want the full branching decision tree from agent complexity through interoperability requirements, role assignment, and AUML specification |
