type: security

- **Broker actions now require one-use, actor-bound capabilities.** The Rust boundary mints versioned action credentials bound to issuer, audience, actor, harbor, tenant, operation, resource digest, validity window, nonce, and credential provenance; SQLite-atomic redemption prevents cross-scope reuse, replay after expiry, caller-supplied authority, and transport identity from becoming action authority.
