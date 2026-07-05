# Example Output: AI Engineer

Scenario: a team ships a customer-support RAG chatbot after two weeks of manual "looks good to me" spot-checking. Retrieval was never measured against a held-out set, citations are a nice-to-have in the prompt (not enforced), there's no confidence threshold so the bot always answers, and it accepts raw user text straight into the same context window as retrieved documents with no isolation. This is the "ships on vibes" system `ai_system_audit.mjs` is designed to catch.

## Bad system — input

```json
{
  "systemType": "rag",
  "factualClaimsMade": true,
  "interactive": true,
  "acceptsUntrustedInput": true,
  "evalHarness": { "exists": false },
  "retrieval": { "used": true, "recallMeasured": false, "precisionMeasured": false },
  "grounding": { "citationsRequired": false },
  "hallucinationGuardrails": { "exists": false },
  "lowConfidenceFallback": { "exists": false },
  "streamingUx": { "enabled": false },
  "promptInjectionDefense": { "exists": false },
  "costCeiling": { "enforced": false, "perRequestUsd": null },
  "toolUse": { "used": true, "validationLayer": false }
}
```

## Bad system — audit result

```json
{
  "pass": false,
  "score": 0,
  "findings": [
    { "severity": "critical", "id": "no-eval-harness", "message": "No repeatable evaluation harness exists — the system ships on vibes, not measurement." },
    { "severity": "critical", "id": "retrieval-never-measured", "message": "Retrieval is used but recall/precision were never measured against a held-out set — \"close but not quite right\" ships silently (Semantic Mismatch Cascade)." },
    { "severity": "critical", "id": "no-grounding-requirement", "message": "System makes factual claims but citation/source-attribution is not required — unbounded hallucination risk." },
    { "severity": "critical", "id": "no-hallucination-guardrails", "message": "No hallucination guardrail mechanism exists (citation-check, confidence-scoring, self-consistency, or output validation)." },
    { "severity": "critical", "id": "no-low-confidence-fallback", "message": "No fallback path exists for low-confidence outputs — the system will confidently answer when it should decline or escalate." },
    { "severity": "high", "id": "no-streaming-ux", "message": "System is interactive but does not stream tokens — perceived latency will read as broken, not just slow." },
    { "severity": "critical", "id": "no-injection-defense", "message": "System accepts untrusted input (user text, retrieved documents, or tool output) with no prompt injection defense." },
    { "severity": "high", "id": "no-cost-ceiling", "message": "No enforced per-request cost ceiling is set — a single request can run away in tokens/tool-calls with no cap." },
    { "severity": "critical", "id": "tool-hallucination-risk", "message": "Agent uses tools but tool calls are not validated against a real schema before execution — Tool Hallucination Loop risk." }
  ],
  "recommendations": [
    "Stand up a repeatable eval harness (unit + end-to-end at minimum) before shipping.",
    "Measure retrieval@k recall and precision on a held-out evaluation set before shipping; do not judge retrieval by eyeballing answers.",
    "Require every factual claim to cite the retrieved source or tool result it came from.",
    "Add at least one hallucination guardrail mechanism and measure its catch rate.",
    "Add a confidence threshold with an explicit fallback action (decline, escalate to human, request clarification).",
    "Stream tokens to the user as they generate; add cancellation if generation can run long.",
    "Isolate the system prompt from untrusted content, tag retrieved/tool content as untrusted, and validate tool-call schemas.",
    "Set and enforce an explicit per-request cost ceiling in the system design (distinct from operational budget alerts/kill switches, which are an infra concern).",
    "Add a tool-call validation layer and explicit error handling in the agent system prompt before execution."
  ]
}
```

## What fixing it actually looked like

1. **Stood up an eval harness**: 40 held-out support queries with expected retrieval@5 and expected answer intent, run in CI on every prompt/retrieval change.
2. **Measured retrieval**: recall@5 was 71% — well under the 85% bar in this skill's Quality Gates. Switched from a generic embedding model to a domain-tuned one, re-measured to 89%.
3. **Made citations mandatory and enforced**: the answer generator now must emit a source id per claim; a post-generation validator rejects answers with unmatched citations and triggers a regeneration.
4. **Added a confidence threshold**: below 0.6 combined retrieval-confidence score, the bot replies with an escalation offer instead of guessing.
5. **Turned on streaming** with a cancel button — P95 perceived latency dropped even though total generation time didn't change.
6. **Isolated untrusted content**: retrieved documents and user text are now tagged and placed in a clearly delimited untrusted block; the system prompt instructs the model to never treat content inside that block as instructions.
7. **Set a $0.50 per-request cost ceiling**, enforced by truncating context and capping tool-call retries.
8. **Added tool-call schema validation** so a hallucinated function name or malformed argument list is caught and retried once before failing closed to a human handoff.

## Fixed system — input

This is `examples/sample-input.json`, unmodified.

## Fixed system — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "AI system meets the build-quality bar: eval harness, measured retrieval where used, required grounding, hallucination guardrails, low-confidence fallback, streaming UX where interactive, injection defense, and an enforced cost ceiling."
  ]
}
```
