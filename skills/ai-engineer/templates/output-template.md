# AI System Design Template

Fill in every section before implementation begins. Validate the underlying claims with
`node scripts/ai_system_audit.mjs --input <this-design-as-json>.json` before calling the design done.

```markdown
## Overview

- <System type: RAG / agent / chatbot / multi-agent / pipeline / hybrid.>
- <What it does, in plain language, and who/what consumes its output.>
- <What this system deliberately does NOT attempt (scope boundary).>

## RAG / Retrieval Design (omit if `retrieval.used` is false)

- Vector DB / hybrid search choice: <e.g. pgvector, Pinecone, Weaviate> — see Decision Points > RAG Component Selection.
- Reranking: <Cohere Rerank / cross-encoder / none> and why.
- Retrieval eval: recall@k = <value>, precision@k = <value>, eval set size = <n>.

## Model & Routing

- Model tier per task complexity — see Decision Points > Model Routing Strategy.
- Delegate model-selection mechanics to `llm-router` if routing gets non-trivial.

## Agent / Tool Design (omit if the system makes no tool calls)

- Tools exposed: <list>.
- Tool-call validation layer: <schema validation approach>.
- Planning pattern: <ReAct / plan-and-execute / single-shot with tools>.

## Guardrails

- Grounding: citations required = <yes/no>; enforcement mechanism = <how it's checked, not just prompted>.
- Hallucination guardrails: <mechanism(s) — citation-check, confidence-scoring, self-consistency, output validation>.
- Prompt injection defense: <system-prompt isolation, untrusted-content tagging, tool-output sanitization>.

## Fallback & Confidence

- Low-confidence threshold: <value> on <what signal>.
- Fallback action: <decline / escalate to human / request clarification>.

## Streaming & UX (omit if `interactive` is false)

- Token streaming: <enabled/disabled>, cancellable: <yes/no>.

## Cost

- Per-request cost ceiling: $<value>, enforced by <mechanism — context truncation, retry cap, model downgrade>.
- (Operational budget alerts / kill switches / quotas are an infra concern — see `agentic-infrastructure-2026`.)

## Eval Harness

- Coverage: <unit / retrieval / end-to-end / adversarial — list which exist>.
- Where it runs: <CI / pre-deploy gate / scheduled>.

Roadmap-Item: <slug>            <!-- or: Roadmap-Item: none — <one-line reason> -->
```

## Checklist before calling the design done

- [ ] Eval harness exists and covers at least unit + end-to-end.
- [ ] If retrieval is used, recall/precision are measured against a held-out set — not eyeballed.
- [ ] If the system makes factual claims, citations are required AND enforced (checked, not just prompted).
- [ ] A named hallucination guardrail mechanism exists.
- [ ] A low-confidence fallback path exists with an explicit action.
- [ ] If interactive, tokens stream to the user.
- [ ] If input can be untrusted (user text, retrieved docs, tool output), prompt injection defense exists.
- [ ] A per-request cost ceiling is enforced in the design (not just an infra-level budget alert).
- [ ] If tools are used, tool calls are validated against a real schema before execution.
- [ ] `node scripts/ai_system_audit.mjs --input <design>.json` returns `pass: true`.
