# Imported-library credential scan

Gitleaks 8.30.0 scanned approximately 69 MB under `skills/` on 23 September 2026 with full output redaction. Its nonzero result reported 13 candidate matches. The redacted machine report is `secret-scan-redacted.json`.

All 13 were reviewed in their documentation or fixture context:

- Six curl-header matches use the explicit `YOUR_API_TOKEN` placeholder.
- Three Cloudflare examples illustrate prohibited hardcoded credentials with short dummy values.
- One adjudicator idempotency identifier is a fixed test-fixture identifier.
- One ONNX tokenizer revision is a model artifact revision, not a credential.
- One Rust distribution example explicitly labels a public key and abbreviates it.
- One Vercel configuration example uses an illustrative SESSION_SECRET value.

No live credential was identified by this review. This is a bounded scanner-and-context review, not a guarantee that arbitrary external content is free of secrets. No credentials were tested, contacted, copied from the environment, or printed in this disposition.
