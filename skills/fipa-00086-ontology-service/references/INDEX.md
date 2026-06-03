# References for fipa-00086-ontology-service

| File | When to load |
|------|--------------|
| [bottom-up-integration-fallacy.md](bottom-up-integration-fallacy.md) | You're evaluating a "find the common subset" integration strategy, or someone argues that syntactic overlap between ontologies guarantees semantic compatibility. |
| [conceptualization-vs-ontology-for-coordination.md](conceptualization-vs-ontology-for-coordination.md) | You need to distinguish the three layers (conceptualization / ontology / knowledge base) or explain why identical field names can mean different things to different agents. |
| [explicit-vs-implicit-ontologies-tradeoffs.md](explicit-vs-implicit-ontologies-tradeoffs.md) | You're deciding whether to use explicit declarative ontologies vs. hardcoded shared assumptions, especially when the system might admit unknown agents at runtime. |
| [failure-modes-semantic-interoperability.md](failure-modes-semantic-interoperability.md) | Agents appear to communicate successfully but take contradictory actions, or coordination quality is degrading without any syntax errors. |
| [okbc-knowledge-model-as-interlingua.md](okbc-knowledge-model-as-interlingua.md) | You're implementing the Ontology Agent's meta-knowledge vocabulary or need the OKBC model as the shared interlingua for multi-ontology translation. |
| [ontology-agent-as-coordination-infrastructure.md](ontology-agent-as-coordination-infrastructure.md) | You're designing or deploying a centralized Ontology Agent service, or deciding whether to centralize translation logic vs. per-agent duplication. |
| [ontology-relationship-as-action-constraint.md](ontology-relationship-as-action-constraint.md) | You need to determine which coordination actions are safe given a specific relationship level (Identical / Equivalent / Extension / Strongly-Translatable / Weakly-Translatable / Approximately-Translatable). |
| [translation-hierarchy-as-coordination-strategy.md](translation-hierarchy-as-coordination-strategy.md) | You're selecting a translation strategy between two ontologies and need to understand the six relationship levels and their operational implications as action constraints. |
