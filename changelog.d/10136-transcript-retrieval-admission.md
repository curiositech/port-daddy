type: security

- **Transcript retrieval now applies scope and sanitization before ranking.** `pd memory search` requires an explicit harbor and exact repository; its disposable index stores only sanitized derivatives with redaction, retention, corpus-policy, embedding-space, and producer-conformance receipts; incompatible legacy rows are rebuilt; and hybrid mode fuses BM25 with only the exact compatible dense space through reciprocal-rank fusion at `k=60`.
