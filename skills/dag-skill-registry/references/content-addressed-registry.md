# Content-addressed registry

[IPFS content addressing](https://docs.ipfs.tech/concepts/content-addressing/) and [Merkle DAG documentation](https://docs.ipfs.tech/concepts/merkle-dag/) were inspected. **Accessed:** 2026-09-24; living concept documentation, no fixed edition claimed. **Access depth:** official concept documentation. A digest detects changes to chosen bytes; it does not prove author identity, trust, quality, licensing, or safe execution.

```mermaid
flowchart LR
 A[Mutable alias] --> B[Immutable version manifest] --> C[Body/reference digests]
 B --> D[Recorded resolved snapshot]
```

```mermaid
flowchart TD
 A[Digest equality] --> B[Integrity check]
 C[Signature/provenance policy] --> D[Identity/trust check]
 B --> E[Separate decisions]
 D --> E
```
