# MCP to A2A bridge

```mermaid
sequenceDiagram
  participant H as MCP host
  participant S as MCP server
  participant A as A2A agent
  H->>S: tool call with caller authority
  S->>S: authorize and map versioned contract
  S->>A: A2A task plus application operation key
  A-->>S: task state and artifacts
  S->>S: independently verify local artifact
  S-->>H: bounded tool result
```

Successful-path illustration for a configured adapter. Denied authority, incompatible versions, invalid artifacts and unknown effects follow the separate [validation disposition diagram](02_validation-provenance.md). The sequence does not certify wire conformance.
