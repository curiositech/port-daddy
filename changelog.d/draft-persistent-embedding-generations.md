type: security

- **Roadmap, durable-roster, and semantic-term retrieval no longer trust model-only vector caches.** Each projection now binds rows and reads to an exact corpus policy digest and vector-space identity, drops unverifiable legacy rows instead of relabelling them, admits sanitized source/query derivatives before ranking, requires explicit retrieval scope, and fuses roadmap BM25 plus dense ranks with RRF at `k=60`.
