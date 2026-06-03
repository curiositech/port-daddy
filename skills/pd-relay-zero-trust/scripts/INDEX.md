# scripts/ — Index

| File | When to load |
|------|--------------|
| `_envelope.py` | You are writing or debugging any script in this skill — provides shared stdin/stdout envelope helpers imported by all other scripts |
| `pki_decision.py` | You are scoring ACME, OIDC, or Web-of-Trust options against weighted criteria |
| `verify_relay_handshake.py` | You are verifying a captured handshake trace against the schema and signature |
| `chain_verify.py` | You are walking a per-publisher Merkle chain to detect breaks or forks |
| `chain_anchor.py` | You are signing and emitting a chain head for external anchoring |
| `attenuate_card.py` | You are generating a Phase 3 attenuated card chain for a delegated publisher |
| `e2e_encrypt.py` | You are testing or implementing AES-256-GCM envelope wrap/unwrap round-trips |
| `threat_review.py` | You are walking the threat model checklist against a new proposal |
| `validate_skill.py` | You need to self-check this skill's frontmatter, references, and schema validity |
