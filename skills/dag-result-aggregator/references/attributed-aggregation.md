# Attributed aggregation

[W3C PROV-O Recommendation (30 April 2013)](https://www.w3.org/TR/prov-o/) was inspected as official provenance vocabulary. **Accessed:** 2026-09-24. **Access depth:** vocabulary only. Preserve source identity, scope, timestamp, missingness, conflict, and merge rule; a merge does not make competing claims compatible.

```mermaid
flowchart LR
 A[Branch receipts] --> B[Version/schema/provenance check]
 B --> C{Declared merge and partial-result policy?}
 C -->|Yes| D[Attributed aggregate plus unresolved items]
 C -->|No| E[Hold for policy]
```

```mermaid
flowchart TD
 A[Conflicting values] --> B[Preserve each source and predicate]
 B --> C[Apply declared evaluator or escalate]
 C --> D[Record disposition without silent overwrite]
```
