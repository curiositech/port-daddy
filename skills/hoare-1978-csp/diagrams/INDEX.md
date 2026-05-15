# Diagrams for hoare-1978-csp

**Primary Focus:** Architecting multi-component systems through process-oriented concurrency via synchronous message-passing, where communication topology determines coordination safety, parallelism, and termination behavior.

| File | When to load |
|------|--------------|
| [01_flowchart_process_communication_topology.md](01_flowchart_process_communication_topology.md) | You need to analyze whether a proposed process graph has cycles or can deadlock |
| [02_sequenceDiagram_synchronous_rendezvous_&_proto.md](02_sequenceDiagram_synchronous_rendezvous_&_proto.md) | You're designing a request-response or handshake protocol between two processes |
| [03_stateDiagram-v2_guarded_command_state_machine_.md](03_stateDiagram-v2_guarded_command_state_machine_.md) | You're reasoning about which guards are enabled, nondeterministic selection, or blocked states |
