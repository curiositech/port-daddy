# Discovery topology record

```mermaid
flowchart LR
  C[Central directory] --> R[Measure trust, churn, query and failure needs]
  F[Federated directories] --> R
  M[Multicast or DNS-SD] --> R
  H[DHT] --> R
  R --> D[Document selected deployment and recovery rules]
```