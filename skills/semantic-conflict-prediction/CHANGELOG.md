# Semantic Conflict Prediction — Changelog

## v1.1 (2026-07-06)

- Added "2026 Research Extensions" section: evaluated HalluJudge (arXiv
  2601.19072, FSE'26) and an interactive-diff-optimization paper (arXiv
  2409.13590, SCAM 2024) against this skill's existing algorithm. Both were
  topic mismatches against their hypothesized framing (flagged honestly, not
  stretched to fit); HalluJudge's escalating-verification pattern is still
  portable as an optional mid-confidence LLM-judge tier.
- Added "Beyond Single-Prediction: MASE Coordination-Layer Failure Modes"
  section: context thrashing, cascading hallucinations, and the
  Manager/semantic-lock/Continuous-Semantic-Integration solution family,
  explicitly scoped as `multi-agent-coordination`/`agentic-patterns`
  territory rather than folded into this skill's algorithm.
- Added "Port Daddy Integration: Cross-PR Watch and the Two Proposed
  Extensions" section: cites the working Lookout ideation ship (PR #721) as
  the existing cross-PR-watch instantiation and evaluates two
  operator-proposed extensions (semantic-cloud-proximity broadcast;
  continuous pre-emptive merge simulation) on a cost/latency/false-positive
  basis.
- Moved deep material (full paper digests, MASE framework catalog, detailed
  tradeoff writeup) to `references/2026-agentic-conflict-research.md` plus a
  `references/INDEX.md`, per progressive-disclosure practice — `SKILL.md`
  keeps only the decision-relevant summary.
- Companion work packets (not part of the skill bundle):
  `docs/architecture/agent-harbor-technical-binder/work-packets/semantic-intent-sentinel-agent-proposal.md`
  (new agent proposal) and
  `.../m8-semantic-conflict-predictor-architecture-recommendation.md`
  (shared-vs-local placement recommendation for this skill's content).

## v1.0 (2026-04-12)

- Initial version: tree-sitter fundamentals, symbol-level claims, dependency
  graph construction, conflict prediction algorithm, Port Daddy integration
  (symbol claims API, Arbiter invariant, CLI verbs), practical limitations,
  and anti-patterns.
