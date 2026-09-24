# Typed Graph Contracts

Candidate edges come from data, authority, or acceptance prerequisites, not words
such as “then” or “and.” [JSON Schema 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)
is an official structural-contract specification. **Access depth:** the official
specification was opened as a schema-contract reference. A schema pass proves
structural conformance only; it does not prove that a producer ran, an approval
was authorized, or an output is true.

```mermaid
flowchart TD
 A[Fetch snapshot receipt] --> B[Security scan]
 A --> C[Unit tests]
 A --> D[Review]
 B --> E{All required receipts and approval?}
 C --> E
 D --> E
 E -->|Yes| F[Deploy proposal]
```
```mermaid
flowchart LR
 A[Producer output schema] --> B[Typed edge rationale]
 B --> C[Consumer input schema]
 C --> D[Topological and contract validation]
```

The diagrams are planning artifacts, not execution proof.

## Edge record

For every edge, record the graph revision; producer node and output schema;
consumer node and input schema; all applicable rationale types (`data`, `authority`, and/or
`acceptance`); immutable source/snapshot identifier; effect and idempotency
policy; and the check that may satisfy the edge. A condition is a gate with a
declared evaluator, not a magic dependency.

```mermaid
sequenceDiagram
    participant P as Producer
    participant R as Receipt store
    participant C as Consumer
    P->>R: output plus schema, snapshot, and attempt ID
    C->>R: request required receipt
    R-->>C: matching contract and acceptance status
    C->>C: start only when declared prerequisites hold
```
