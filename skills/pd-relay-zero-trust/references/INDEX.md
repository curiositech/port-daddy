# references/ — Index

| File | When to load |
|------|--------------|
| `zero-trust-foundations.md` | You need NIST SP 800-207 or BeyondCorp grounding for an architectural argument |
| `pki-options-acme.md` | You are evaluating ACME — Let's Encrypt, ACME-DNS, ARI, ZeroSSL, EAB |
| `pki-options-oidc.md` | You are evaluating OIDC — GitHub OIDC, Google, Auth0, or a custom IdP |
| `pki-options-web-of-trust.md` | You are evaluating cross-cert, Web-of-Trust, or SSH-style TOFU |
| `pki-decision-matrix.md` | You are scoring PKI options against weighted criteria or running pki_decision.py |
| `merkle-chain-design.md` | You are specifying or implementing per-publisher Merkle event chains |
| `relay-architecture.md` | You are drafting the relay handshake, transport layer, or namespace design |
| `harbor-card-attenuation.md` | You are specifying Phase 3 Macaroon-style attenuation for delegated publishers |
| `e2e-payload-encryption.md` | You are specifying end-to-end payload encryption so the relay sees only metadata |
| `proverif-relay-extension.md` | You are extending the symbolic model to cover daemon ↔ relay ↔ daemon |
| `float-plans-deferred.md` | You need to understand why Float Plans must not be on the relay critical path |
| `v4-remote-harbor-redefinition.md` | You are killing Part XVII scope creep and redefining remote harbor as shared keypair + relay namespace |
| `threat-model.md` | You are reviewing the adversary catalog, invariants, or out-of-scope rationale |
