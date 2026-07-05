# AI Engineer

Build production-ready LLM applications, RAG systems, and intelligent agents: retrieval component selection, model routing strategy, agent-vs-RAG decisions, hallucination/grounding guardrails, and a deterministic build-quality audit before shipping.

Use this skill when building LLM features, RAG pipelines, chatbots, or AI agents — not when selecting agent infrastructure/frameworks (`agentic-infrastructure-2026`), routing between models mechanically (`llm-router`), or deciding an agentic app's overall shape (`agentic-app-architecture`).

## Quick Start

1. Read `SKILL.md` for the Decision Points (RAG component selection, model routing, agent-vs-RAG), the five Failure Modes, and the Anti-Patterns.
2. Fill in `templates/output-template.md` for the actual AI system design.
3. Build an AI-system-plan JSON matching `schemas/ai-system-plan.schema.json` and audit it:

```bash
node scripts/ai_system_audit.mjs --input <your-plan>.json
```

4. Compare against `examples/expected-output.md` to see a "ships on vibes" system audited, then the same system fixed and passing.

## Bundle

| File | Load When |
| --- | --- |
| `SKILL.md` | Always — Decision Points, Failure Modes, Worked Examples, Quality Gates, Anti-Patterns. |
| `templates/output-template.md` | Drafting an AI system design and its Roadmap-Item trailer. |
| `schemas/ai-system-plan.schema.json` | Validating an AI-system-plan JSON payload's shape before auditing it. |
| `scripts/ai_system_audit.mjs` | Deterministic scoring of a plan's build-quality readiness. |
| `examples/sample-input.json` | A complete plan that scores `pass: true`. |
| `examples/expected-output.md` | A bad plan audited, then the same plan fixed and passing. |
| `agents/openai.yaml` | Subagent descriptor for delegated AI-system design/build. |
