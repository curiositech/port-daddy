# Diagrams for ongaro-ousterhout-2014-raft

**Primary Focus:** Designing distributed consensus systems that are empirically more correct through strategic simplification and human-understandable decomposition rather than theoretical optimization.

## Diagrams

| File | When to load |
|------|--------------|
| [01_stateDiagram-v2_raft_server_state_transitions_.md](01_stateDiagram-v2_raft_server_state_transitions_.md) | You're tracing how a server transitions between Follower, Candidate, and Leader roles, or debugging why a node isn't winning election |
| [02_sequenceDiagram_log_replication_protocol_happ.md](02_sequenceDiagram_log_replication_protocol_happ.md) | You're implementing AppendEntries RPC, stepping through the happy-path replication flow, or debugging a scenario where log entries aren't being committed |
| [03_mindmap_decomposition_hierarchy_raft.md](03_mindmap_decomposition_hierarchy_raft.md) | You need a visual map of how leader election, log replication, and safety constraints relate as independent subproblems |
