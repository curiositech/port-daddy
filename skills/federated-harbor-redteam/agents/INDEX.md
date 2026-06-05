# Agents — Federated Harbor (red-team side)

Adversarial subagent role cards. Dispatch the one whose attack surface matches
the claim you are probing.

- `fh-redteam-trust.md`: attacks trust-establishment and federation-root
  attestation claims.
- `fh-redteam-tokens.md`: attacks capability-token issuance, scoping, and
  acceptance claims.
- `fh-redteam-revocation.md`: attacks revocation propagation and epoch-rollback
  claims.
- `fh-redteam-econ.md`: attacks the economic / incentive claims (bonding,
  pricing, griefing).
- `fh-proof-gap-auditor.md`: audits a defense's proof obligations for gaps —
  finds the unproven step before declaring a claim sound.
