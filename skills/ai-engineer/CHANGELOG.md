# AI Engineer — Changelog

## v1.1.0 (2026-07-04)

- Imported from the global jury_rig skill catalog (`ai-engineer`, SKILL.md-only) into the repo.
- Upgraded to the port-daddy agentic-family standard: block-style `metadata.provenance` (first-party/port-daddy),
  `metadata.pairs-with` re-pointed at real repo skills (`agentic-app-architecture`, `agentic-infrastructure-2026`,
  `llm-router`, `episodic-memory-algorithms`; dropped `prompt-engineer`/`chatbot-analytics`/`backend-architect`,
  which are not vendored under `skills/`), and `metadata.io-contract`.
- Fixed the `allowed-tools` MCP identifier casing (`mcp__SequentialThinking__sequentialthinking` →
  `mcp__sequentialthinking__sequentialthinking`) so the tool actually resolves.
- Added a deterministic build-quality auditor, `scripts/ai_system_audit.mjs` (`auditAiSystem`), covering the
  gates this skill's own Quality Gates section already named but never machine-checked: eval harness existence,
  measured retrieval (RAG), required + enforced grounding/citations, hallucination guardrails, low-confidence
  fallback, streaming UX, prompt injection defense, an enforced per-request cost ceiling, and tool-call
  validation (Tool Hallucination Loop). Deliberately scoped to NOT duplicate `agentic-infrastructure-2026`'s
  `infra_readiness.mjs` (framework selection, MCP context overhead, observability, org/adoption readiness).
- Added `schemas/ai-system-plan.schema.json`, `examples/sample-input.json` (`pass: true`),
  `examples/expected-output.md` (a "ships on vibes" system audited, then fixed and passing).
- Built the full bundle: `README.md`, `templates/output-template.md`, `agents/openai.yaml`.
- Added three Novice/Expert/Detection anti-patterns wired to the new auditor's finding ids.
- Extended the Not-For Boundaries section with explicit NOT-clauses against `agentic-infrastructure-2026`
  (infra/framework/observability/cost-governance selection) and `llm-router` (model-routing mechanics).

## v1.0.0 (imported, undated)

- Original jury_rig-catalog content: Decision Points (RAG component selection, model routing strategy,
  agent-vs-RAG), five Failure Modes, a worked customer-support-chatbot example, and Quality Gates.
