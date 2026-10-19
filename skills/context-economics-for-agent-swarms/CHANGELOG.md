# Context Economics for Agent Swarms — Changelog

## Second-review repair (2026-09-24)

- Corrected the GPT-6 Luna **Standard** short-context worked rates and arithmetic; cache-write, storage, and other omitted cost classes are now explicit.
- Replaced global route-alias uniqueness with alias ownership per declared provider `windowId`: a route can reserve separate five-hour and weekly windows, while a same-window split still fails.
- Defined capacity eligibility from finite native arithmetic, route ownership, freshness, quality, no discrepancy, and required p95-plus-tail amount no greater than allocatable; risk is diagnostic only.
- Added two-window positive/negative, zero-burn-negative-capacity, incomplete-reservation, and non-finite JavaScript-number regression cases.

## Handoff revision (2026-09-24)

- Corrected subscription cost arithmetic and separated cached-input price from context occupancy.
- Added source-scoped ACON, parallel-compaction, and Slipstream procedures plus an inert local evaluation recipe.
- Recast unvalidated budget/tool-count/position rules as measured local hypotheses.
- Made provider plan/quota notes dated source pointers, not maintained capacity truth.
- Strengthened the capacity declaration validator for malformed rows, strict calendar timestamps, limit/remaining contradictions, non-monotone forecast quantiles, aliases, and finite derived arithmetic.
- Defined `admissible` as a local evidence consistency result only; `CHECKPOINT_NOW` blocks new admission and `launchAuthority` remains false.
- Added regression tests for the nine root-audit reproduction classes and schema/runtime parity.

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
