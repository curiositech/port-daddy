# Diagrams for wu-2023-autogen

**Primary Focus:** Designing decentralized multi-agent AI systems that coordinate through conversational message-passing rather than centralized orchestration, with specialized agents handling distinct concerns (execution, validation, safety, expertise) in iterative feedback loops.

| File | When to load |
|------|--------------|
| [01_sequenceDiagram_multi-agent_conversation_flow_.md](01_sequenceDiagram_multi-agent_conversation_flow_.md) | You need to visualize how messages flow between executor, critic, safeguard, and domain expert agents across conversation turns |
| [02_stateDiagram-v2_agent_computation_vs_control_f.md](02_stateDiagram-v2_agent_computation_vs_control_f.md) | You're designing the separation between what agents compute and how the conversation routes between them |
| [03_mindmap_agent_specialization_architect.md](03_mindmap_agent_specialization_architect.md) | You need to decompose a monolithic agent into specialized roles — mapping concerns (hallucination, safety, logic errors, execution) to agent types |
