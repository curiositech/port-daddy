type: added

- **Consequential actions now have a fail-closed adjudication evidence contract.** Canonical `ActionProposal`, `AdjudicationReceipt`, and `EffectReceipt` records bind exact action, policy, authority, and effect digests; the pure verifier rejects stale, self-issued, post-effect, untrusted, or mismatched decisions and records effects without prior permission as bypass evidence.
