# Runtime Verification For Agents — Changelog

## 2026-04-17
- Normalized frontmatter into the canonical metadata-based repo shape
- Added or refreshed repo-local provenance metadata
- Recorded this automated migration for future structural upgrades

## 2026-04-17
- Structural bridge pass added or normalized decision, failure, example, quality-gate, and Mermaid scaffolding

## 2026-04-17
- Folder affordance pass refreshed scorecard, reference index, and Mermaid companion artifacts

## 2026-04-18
- Normalized frontmatter into the canonical metadata-based repo shape
- Added or refreshed repo-local provenance metadata
- Added or refreshed repo-local authorship metadata
- Recorded this automated migration for future structural upgrades

## 2026-09-24 offline review repair
- Aligned monitor outcomes, baseline lifecycle, examples, recovery language, and all four eval scenarios; removed inherited fixed heartbeat/crash/digest thresholds and the unsupported NTP/count explanation.
- Corrected R01/R06 admission and recovery state diagrams; distinguished TLA+ state invariants from action properties and added source-depth notes.

## 2026-09-24 bounded monitor contract closure
- Added a zero-effect Node example and negative fixtures for invalid counts, stale/out-of-order revisions, exact session generation, unverified empty inventory, and property/session/generation-bound closure.
- Moved the long adapter contract behind a linked reference, scoped TLA+ state/action guards to active tracked generations, and kept restart continuity unknown without a durable baseline.

- Bound baseline initialization to a one-use atomic source claim; added durable restore/retirement fixture paths so restart cannot replay a first-baseline receipt to mask the monitoring gap.
- Bound committed snapshots to exact authoritative high-water revisions and baseline receipts to exact count/revision values.

- Require every accepted count/revision advancement to commit through an exact-prior durable CAS before the monitor updates in-memory state; add restart-after-increase and stale/failed-CAS fixtures.
