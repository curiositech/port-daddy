# Changelog

## 1.0.2 — 2026-09-17

### Fixed

- Require `HOLDER_CONFIRMED` ledgers to carry an Ed25519 signature verified by
  a key in the verifier's external trust set for the named source holder.
- Reject self-minted confirmation, forged signatures, and post-signature ledger
  mutation with direct deterministic tests.

## 1.0.1 — 2026-09-17

### Fixed

- Bound `HOLDER_CONFIRMED` to the exact named source holder and a recomputed
  canonical digest of the complete ledger.
- Rejected duplicate proposition IDs and non-finite confidence values.
- Replaced subprocess and temporary-directory tests with direct deterministic
  validator tests, including post-confirmation mutation coverage.

## 1.0.0 — 2026-09-16

### Breaking

- Replaced unconstrained “maximum strength” advocacy with a source-bound
  Fidelity Ledger.
- Added categorical refusal of persuasive optimization for abuse, coercion,
  discrimination, atrocity, scams, and deceptive influence.
- Split `DRAFT`, `SOURCE_BOUND`, and `HOLDER_CONFIRMED`; only the actual source
  holder can produce the latter.
- Added premise provenance, counterevidence, falsifier, reciprocity, and
  uncertainty requirements.
- Removed unsourced empirical and clinical claims, phantom skill routes, and the
  stale hand-maintained affordance scorecard.
