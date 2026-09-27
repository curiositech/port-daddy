# Halt Gate Implementation: validity_assessment.overall < 0.6 → HALT

The halt gate is a hard synchronization barrier in `meta-dag-predict.ts` between Wave 0 (Sensemaker) and Wave 1 (Decomposer). It evaluates two independent conditions and fires on either: `sensemaker.confidence < 0.6` (numeric) or `Boolean(sensemaker.halt_reason)` (explicit). The conjunction is an OR — a Sensemaker that scores 0.61 but sets `halt_reason` still halts; a Sensemaker that scores 0.35 without a `halt_reason` also halts. This is the live check at line 348:

```typescript
if (sensemaker.confidence < 0.6 || sensemaker.halt_reason) {
```

The `SensemakerOutput` type (lines 15-21) carries only five fields: `classification`, `confidence`, `halt_reason?`, `inferred_problem`, `key_signals`. The gate reads `confidence` and `halt_reason` from this schema-validated object — `SENSEMAKER_JSON_SCHEMA` (lines 116-127) marks `halt_reason` as optional. The richer `ProblemUnderstanding.validity_scores` struct (with separate `clarity`, `feasibility`, `coherence`, `overall`) lives in the Sensemaker SKILL.md's output contract but is **not transmitted** to `meta-dag-predict.ts` — the pipeline receives only the collapsed `confidence` scalar. Dimensional scores inform the Sensemaker's reasoning and clarification-question generation internally; the gate itself only sees the scalar.

**What each dimension measures:**

- **Clarity (weight 0.4)** — Can the problem be restated without importing new assumptions? Score ≥0.7: specific, bounded, single-interpretation. 0.5–0.69: significant ambiguity, multiple interpretations plausible. <0.5: cannot restate; the `unknown` Polya field cannot be written as a single sentence. Clarity carries the highest weight because an unclear problem cannot be solved correctly regardless of resources. Dimension-level override: `clarity < 0.5` triggers halt even if overall ≥ 0.6.

- **Feasibility (weight 0.3)** — Are the required tools, skills, and time bounds available? Score ≥0.7: known capabilities, bounded effort. 0.5–0.69: skills may not exist or scope is unclear. <0.4: missing critical capabilities or unbounded effort. Dimension-level override: `feasibility < 0.4` → halt and flag as potentially infeasible.

- **Coherence (weight 0.3)** — Do the stated conditions form a consistent, simultaneously satisfiable set? Score ≥0.7: no conflicting requirements. 0.5–0.69: real contradictions requiring tradeoffs. <0.4: fundamental contradictions; the conditions array has pairs that cannot all hold. Dimension-level override: `coherence < 0.4` → halt, contradictions must be resolved by the requester.

- **Overall** — `(clarity × 0.4) + (feasibility × 0.3) + (coherence × 0.3)`. The 0.6 floor is the aggregate. A problem that scores (0.6, 0.6, 0.6) lands exactly at 0.6 and passes. A problem that scores (0.5, 0.8, 0.8) lands at 0.68 but trips the `clarity < 0.5` override and still halts.

**What the gate emits on halt:**

The halt path (lines 349-359) calls `em?.emitProgress({ type: 'halt', reason, confidence })` and returns a stub `PredictedDAG` with `waves: []`, `estimated_total_minutes: 0`, `estimated_total_cost_usd: 0`, and `premortem.recommendation: 'ESCALATE_TO_HUMAN'`. No downstream agents are invoked — the Decomposer, Skill Selector, and Premortem agents are all skipped. The stub is a valid `PredictedDAG` type so callers don't need special null handling; they inspect `waves.length === 0` or `halt_reason` to detect the gate fired.

**What the gate does not emit (by design):**

The `meta-dag-predict.ts` halt stub does not include `clarification_questions`. That field lives in `ProblemUnderstanding.halt_decision.clarification_questions` (Sensemaker SKILL.md output contract), which the Sensemaker populates internally. The gate surface in `meta-dag-predict.ts` is intentionally thin — it halts the pipeline and surfaces the `halt_reason` string; question generation is the Sensemaker's responsibility, not the gate's. When building UI around halts, read `halt_reason` from the returned `PredictedDAG`; retrieve the full clarification questions from the Sensemaker's own structured output if you cached it.

**Resume behavior and the cache trap:**

When `MetaDAGPredictConfig.resume` is true, `cp.loadNode('sensemaker')` returns the cached Sensemaker output and skips the LLM call (line 322). The gate still runs against the cached output. This means: if the user clarifies the problem, you must bust the Sensemaker cache (`resume: false` or delete the checkpoint node) to force a fresh call. Running the pipeline with `resume: true` after a clarification round will re-halt on the stale cached confidence score — a common debugging failure mode.

**The Polya completeness invariant:**

A Sensemaker that cannot fill `principal_parts.unknown` in one sentence cannot truthfully score `clarity ≥ 0.5`. The principal-parts extraction is the functional pre-condition for scoring, not a separate step. If the Sensemaker is observed setting `clarity ≥ 0.5` while `inferred_problem` is vague or multi-sentence, the Sensemaker is miscalibrated — trust the gate, not the score.

## Key Points

- The gate reads only two fields from `SensemakerOutput`: `confidence` (numeric floor 0.6) and `halt_reason?` (string presence). Either alone is sufficient to halt; the check is an OR.
- Dimensional scores (`clarity`, `feasibility`, `coherence`) are internal to the Sensemaker's reasoning; the pipeline sees only the collapsed `confidence` scalar. Dimension-level overrides (`clarity < 0.5`, `feasibility < 0.4`, `coherence < 0.4`) must be enforced by the Sensemaker before emitting `confidence`, not by the gate.
- A halted pipeline returns a structurally valid `PredictedDAG` stub with `waves: []` and `ESCALATE_TO_HUMAN` — callers detect halt via `waves.length === 0` or `halt_reason` presence, not via a thrown exception.
- Clarification questions are the Sensemaker's output, not the gate's. The gate surfaces `halt_reason`; questions live in `ProblemUnderstanding.halt_decision.clarification_questions`.
- Cache busting is required after human clarification: `resume: true` re-evaluates the cached Sensemaker output, not the new input, and will re-halt on stale scores.

## See Also

- `skills/windags-sensemaker/SKILL.md` — definitive spec for `ProblemUnderstanding`, the three-dimension validity formula, dimension-level halt overrides, and clarification-question generation templates.
- `packages/core/src/context/fault-tolerance.ts` — `MetaDAGCheckpointer.loadNode` / `saveNode` and the `withRetry` wrapper (model upgrade on failure) that wraps the Sensemaker call upstream of the gate.
- `skills/windags-decomposer/SKILL.md` — the first agent the gate protects; its input is `sensemaker_output: SensemakerOutput` (line 372 in `meta-dag-predict.ts`), so gate failure means it never receives context.
