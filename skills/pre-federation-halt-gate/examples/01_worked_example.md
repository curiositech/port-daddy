# Worked Example: Ambiguous Data Pipeline Request

## Scenario

A user asks WinDAGs: *"Set up the ETL thing so the dashboards update faster."* The Sensemaker runs Wave 0 and produces a `SensemakerOutput`. Before the Decomposer writes any DAG edges or assigns skills, the pre-federation halt gate inspects that output — and fires.

## Step-by-Step Application

**Step 1 — Sensemaker emits output.**

```json
{
  "classification": "SYSTEM_MODIFICATION",
  "confidence": 0.44,
  "halt_reason": null,
  "inferred_problem": "Improve dashboard refresh latency for an unspecified ETL pipeline",
  "key_signals": ["ETL", "dashboards", "faster"]
}
```

The Polya principal-parts extraction failed to produce a concrete `unknown` — "faster" is not a measurable output type, and `data` (which pipeline? which dashboards?) is absent. Clarity scored 0.35, feasibility 0.60, coherence 0.65.

**Step 2 — Gate evaluates halt conditions.**

```
numericHalt = 0.44 < 0.6          → true
reasonHalt  = Boolean(null)        → false
→ HALT triggered on numeric check

lowestDimension = argmin({
  clarity:     0.35,   ← winner
  feasibility: 0.60,
  coherence:   0.65,
})
→ 'clarity'
```

**Step 3 — Gate emits stub DAG + clarification questions.**

```json
{
  "title": "Improve dashboard refresh latency for an unspecified ETL pipeline",
  "confidence": 0.44,
  "halt_reason": "Confidence below threshold (0.6)",
  "waves": [],
  "estimated_total_minutes": 0,
  "estimated_total_cost_usd": 0,
  "premortem": { "recommendation": "ESCALATE_TO_HUMAN", "risks": [] },
  "clarification_questions": [
    "What specifically should the output contain or achieve?",
    "When you say \"Improve dashboard refresh latency for an unspecified ETL pipeline\", what does success look like?",
    "Can you describe the end state in one sentence?"
  ]
}
```

No downstream agents run. The Decomposer never receives input.

## Expected Result

The user sees the three targeted clarity questions and responds: *"The Redshift → dbt → Metabase pipeline. Dashboards currently refresh every 4 hours; we want under 15 minutes. No schema changes."* A new Sensemaker call (cache bypassed) now scores clarity 0.85, feasibility 0.75, coherence 0.80 → overall 0.80. Gate clears. Decomposer proceeds.

## Failure Modes

**1. Dimensional override missed.** If the implementation only checks the `overall` score and skips the per-dimension overrides, a problem with `clarity = 0.45` but high feasibility/coherence could slip through with an overall of 0.615. Guard against this: after the numeric halt check, always evaluate `clarity < 0.5`, `feasibility < 0.4`, `coherence < 0.4` as independent halt triggers before passing to the Decomposer.

**2. Resume skips fresh Sensemaker call.** On checkpoint resume, the gate runs against the cached Sensemaker output. If the user clarified but the cache was not invalidated, the gate re-evaluates the old low-confidence object and halts again — the pipeline appears stuck. Fix: when `MetaDAGPredictConfig.resume` is true and a clarification round occurred, set `bypassCache: true` on the Sensemaker node before re-running Wave 0.
