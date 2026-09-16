# Context Economics for Agent Swarms — Changelog

## v2.0.1 (2026-09-14)

- Required every forecast route to belong to its capacity bucket's route
  aliases and made outsider-route claims ineligible.
- Required an admissible committed reservation to satisfy
  `issuedAt <= evaluatedAt < expiresAt`.
- Made the structural and semantic validator importable so resurrection proof
  validates the referenced artifact itself, not only its digest and metadata.

## v2.0.0 (2026-09-11)

- Added subscription allowance as a fourth economic view alongside token COGS,
  working memory, and legibility.
- Added a versioned `capacity-evidence` schema, deterministic semantic validator,
  and ready/unknown fixtures so shared-window aliases, freshness, native-unit
  arithmetic, and atomic reservation coverage fail closed.
- Separated financial and provider-native capacity ledgers.
- Added authentication-mode witnesses, observation quality, p95 burn forecasts,
  reset-aware reserves, and preemptive checkpoint/model-switch states.
- Rejected `$0 marginal` and “tasks remaining” as autonomous routing authority.
- Bound every evidence object to `real-provider` or `fake-or-replay`; synthetic
  capacity can no longer be mistaken for real-provider admissibility.
