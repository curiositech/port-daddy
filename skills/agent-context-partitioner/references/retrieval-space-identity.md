# Retrieval-space identity

Canonical `spaceId` input, in this order:

```text
modelArtifactDigest
modelConfigDigest
preprocessingDigest
chunkerDigest
pooling
dimensions
normalization
metric
coordinatePrecision
quantizationDigest
redactionPolicyDigest
modality
```

Serialize the closed object as canonical JSON with those keys in that order and compute SHA-256. Store the result as `sha256:<lowercase hex>`.

Execution provider, endpoint, and transport encoding are recorded separately as provenance. They never make two spaces comparable. A cross-space migration produces a new item revision and requires a migration receipt supplied by another authority.
