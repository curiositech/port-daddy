# Changelog — rag-retrieval-pattern-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/rag_retrieval_pattern_design_audit.mjs`), draft-07
schema (`schemas/rag-retrieval-pattern-design-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: retrieval failure-mode triage, chunking strategy comparison (recursive
512/10-20% baseline), embedding selection criteria, hybrid BM25+dense with RRF (k=60),
cross-encoder reranking (20 -> 5), context ordering, RAGAS evaluation thresholds, latency
budget, freshness/monitoring, anti-patterns, and quality gates. Grounded in the 2026
production-RAG guides cited in Sources.
