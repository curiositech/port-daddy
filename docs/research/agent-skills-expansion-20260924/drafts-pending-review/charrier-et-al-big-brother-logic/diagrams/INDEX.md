# Diagrams for charrier-et-al-big-brother-logic

**Primary Focus:** Designing distributed agent systems by making implicit epistemic dependencies explicit—determining what each agent must know, what they can observe, and what communication architecture ensures proper coordination.

## Generated Diagrams

| File | When to load |
|------|-------------|
| [01_flowchart_knowledge_state_decision_tree.md](01_flowchart_knowledge_state_decision_tree.md) | You need to decide which knowledge mode (common, distributed, or individual) fits your coordination task, or you're branching on tight vs. loose agent coupling |
| [02_sequenceDiagram_knowledge_propagation_public.md](02_sequenceDiagram_knowledge_propagation_public.md) | You're designing a communication protocol and need to see exactly how public announcement differs from point-to-point messaging in its effect on agent Kripke models |
| [03_stateDiagram-v2_agent_knowledge_state_evolutio.md](03_stateDiagram-v2_agent_knowledge_state_evolutio.md) | You need to trace how an agent's knowledge state evolves as it makes local observations, receives public announcements, or exchanges point-to-point messages |
