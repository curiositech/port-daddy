# Hsts Planning Scheduling — Changelog

## 2026-04-17
- Recovered legacy frontmatter into the canonical metadata-based repo shape
- Added provenance metadata and moved runtime/custom fields under metadata

## 2026-04-20
- Replaced the interrupted merge placeholder with a full canonical wrapper and nested `metadata.provenance` / `metadata.authorship`
- Added exact description-level and body-level `NOT for` boundaries plus L3 sections for decision points, failure modes, worked examples, and quality gates
- Added a validated inline Mermaid decision flow and a reference index while preserving the existing diagram bundle

## 2026-07-05
- Fixed four references that ended mid-sentence from an interrupted extraction pass: `token-networks-and-incremental-commitment.md`, `incremental-heuristics-and-the-scalability-condition.md`, `compatibility-specifications-and-causal-justification.md`, and `unified-planning-scheduling-state-variables.md`. Completed each with grounded technical content (the formal compatibility grammar and 5-tuple token definition are shared, verified facts already present in full in sibling references) and cross-referenced the sibling reference that covers the same formal machinery in more depth, instead of duplicating it wholesale.
