type: added

- **Embedding vector spaces now have one canonical declared identity target.** `config/models.yaml` declares model revisions and their binding evidence alongside dimensions, normalization, metric, pooling, and effective coordinate encoding; the generator emits the same domain-separated `embed-v2` SHA-256 profile to daemon and Workers artifacts while keeping mutable quality/provenance policy and both unpinned embedding profiles outside text-generation admission.
