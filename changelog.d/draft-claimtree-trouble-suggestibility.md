type: added

- **Claim-tree trouble now has a machine-readable contract.** `lib/claim-tree-trouble.ts` exports the ordered transition table, renders the Mermaid state graph from that table, and validates the graph against it. The unit tests snapshot the table and diagram so the contract stays deterministic for agents and readers alike.
