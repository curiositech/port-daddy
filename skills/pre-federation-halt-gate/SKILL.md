---
name: pre-federation-halt-gate
version: 0.1.0
description: >
  Polya principal-parts validation gate that runs before any bond-writing or DAG decomposition
  begins. Inspects the Sensemaker's validity_assessment output and enforces a hard halt when
  overall confidence falls below 0.6, emitting a structured clarification request rather than
  allowing an ill-defined problem to propagate downstream. The gate is named "pre-federation"
  because it fires before agents federate around a shared decomposition — once subtasks exist
  and skills are assigned, reverting is expensive; catching ambiguity here is cheap.
author: soma-windags-graft
tags: [windags, halt-gate, sensemaker, validation, polya, federation, problem-definition]
pairs-with: [windags-sensemaker, windags-decomposer, windags-premortem]
---

# Pre-Federation Halt Gate

## When to Use

- A `SensemakerOutput` (or `ProblemUnderstanding`) has been produced and its `confidence` or
  `validity_assessment.overall` must be checked before the Decomposer runs.
- Any pipeline that writes subtask bonds, DAG edges, or skill assignments from a problem
  statement that has not yet been validated for clarity, feasibility, and coherence.
- Resuming a checkpointed pipeline after a human clarification round — re-run the gate to
  confirm the updated problem now clears the threshold before unlocking downstream waves.

NOT for:
- Post-decomposition quality checks (use `windags-premortem` for structural DAG risks).
- Validating skill assignments or model-tier choices (those belong in the skill-selector stage).
- Real-time streaming responses where latency forbids a blocking gate call.

## Core Concepts

**Halt threshold (0.6)**: The numerical floor below which a problem is considered too
ill-defined for automated decomposition. Derived from the weighted validity formula
`overall = (clarity * 0.4) + (feasibility * 0.3) + (coherence * 0.3)`. An overall score
below 0.6 means at least one dimension is severely degraded and the pipeline would produce
a structurally unsound DAG.

**SensemakerOutput / confidence field**: The Sensemaker agent in `meta-dag-predict.ts`
(Wave 0) emits a JSON object with a `confidence: number` field and an optional
`halt_reason?: string`. The gate reads both: `confidence < 0.6` triggers halt regardless
of whether `halt_reason` is set; a non-null `halt_reason` triggers halt regardless of the
numeric score. Either condition is sufficient.

**Hard halt vs soft warning**: A hard halt returns a `PredictedDAG` stub with `waves: []`,
`estimated_total_minutes: 0`, `estimated_total_cost_usd: 0`, and
`premortem.recommendation: 'ESCALATE_TO_HUMAN'`. No downstream agents run. This is
distinct from a soft warning (e.g., ACCEPT_WITH_MONITORING), which lets the pipeline
proceed with heightened risk awareness.

**Polya principal parts**: Before scoring validity, the Sensemaker must extract four
parts: `unknown` (what we are solving), `data` (what we have), `conditions` (testable
constraints), and `output_type` (the answer's form). The gate implicitly validates that
these parts were producible — an inability to state the `unknown` in one sentence is itself
a signal that clarity is below 0.5 and a halt is warranted.

**Clarification request structure**: On halt, the gate must emit targeted questions
keyed to the weakest scoring dimension (clarity, feasibility, or coherence), not generic
"please clarify" prompts. The questions must be answerable by the user without domain
expertise in the pipeline's internals.

## Implementation Pattern

The following pseudocode mirrors the actual logic in
`packages/core/src/context/meta-dag-predict.ts` lines 347-360, with the
`windags-sensemaker` SKILL.md's validity formula applied as the pre-check:

```
function preFederationHaltGate(sensemaker: SensemakerOutput): HaltDecision {
  // Primary numeric check (matches meta-dag-predict.ts line 348)
  const numericHalt = sensemaker.confidence < 0.6;

  // Secondary explicit reason check (matches meta-dag-predict.ts line 348)
  const reasonHalt = Boolean(sensemaker.halt_reason);

  if (numericHalt || reasonHalt) {
    // Diagnose weakest dimension if ProblemUnderstanding is available
    const lowestDimension = argmin({
      clarity:     validity_scores?.clarity     ?? 0,
      feasibility: validity_scores?.feasibility ?? 0,
      coherence:   validity_scores?.coherence   ?? 0,
    });

    // Generate targeted questions for the weakest dimension
    const questions = generateClarificationQuestions(lowestDimension, sensemaker);

    // Emit halt event (mirrors meta-dag-predict.ts emitter.emitProgress type:'halt')
    emitter?.emitProgress({
      type:       'halt',
      reason:     sensemaker.halt_reason ?? 'Confidence below threshold',
      confidence: sensemaker.confidence,
    });

    // Return stub PredictedDAG — no downstream waves are populated
    return {
      title:                    sensemaker.inferred_problem || 'Unable to determine next move',
      problem_classification:   sensemaker.classification,
      confidence:               sensemaker.confidence,
      halt_reason:              sensemaker.halt_reason ?? 'Confidence below threshold (0.6)',
      waves:                    [],
      estimated_total_minutes:  0,
      estimated_total_cost_usd: 0,
      premortem: {
        recommendation: 'ESCALATE_TO_HUMAN',
        risks: [],
      },
      clarification_questions: questions,   // added by this gate
    };
  }

  // Gate cleared — pass sensemaker output to Decomposer (Wave 1)
  return { should_halt: false };
}

function generateClarificationQuestions(
  dimension: 'clarity' | 'feasibility' | 'coherence',
  sensemaker: SensemakerOutput,
): string[] {
  switch (dimension) {
    case 'clarity':
      return [
        'What specifically should the output contain or achieve?',
        `When you say "${sensemaker.inferred_problem}", what does success look like?`,
        'Can you describe the end state in one sentence?',
      ];
    case 'feasibility':
      return [
        'Are the tools or APIs required for this available in the current environment?',
        'What is the time or budget constraint?',
        'Has this been attempted before — if so, what happened?',
      ];
    case 'coherence':
      return [
        'Two or more of the requirements appear to conflict — which takes priority?',
        'Can any constraint be relaxed to make the others satisfiable?',
        'Are all listed conditions hard requirements, or are some aspirational?',
      ];
  }
}
```

**Dimensional halt overrides** (from `windags-sensemaker` SKILL.md):
- `clarity < 0.5` → halt immediately, even if overall >= 0.6
- `feasibility < 0.4` → halt and flag as potentially infeasible
- `coherence < 0.4` → halt, contradictions must be resolved first

**Resume behavior**: When `MetaDAGPredictConfig.resume` is true and a checkpoint exists
for the `sensemaker` node (`MetaDAGCheckpointer.loadNode('sensemaker')`), the gate still
runs against the cached output. A human-clarified re-run must produce a new Sensemaker
call (bypass cache) so the gate evaluates fresh confidence.

## Key References

1. **`packages/core/src/context/meta-dag-predict.ts`** (workgroup-ai repo) — authoritative
   implementation. The halt gate is lines 347-360 (`if (sensemaker.confidence < 0.6 || sensemaker.halt_reason)`).
   `SensemakerOutput`, `MetaDAGPredictConfig`, `withRetry`, and `MetaDAGCheckpointer` are
   defined in the same file and `./fault-tolerance`.

2. **`skills/windags-sensemaker/SKILL.md`** (workgroup-ai repo) — defines the
   `ProblemUnderstanding` output schema, the three validity dimensions and their weights
   (`clarity * 0.4 + feasibility * 0.3 + coherence * 0.3`), the halt decision rules, and
   the Polya principal-parts extraction protocol that the gate depends on.

3. **Polya, G. (1945). *How to Solve It*.** Princeton University Press. — Source of the
   four principal parts (unknown, data, conditions, solution). The gate's halt logic is
   essentially a check that the Sensemaker was able to fill in all four parts with
   sufficient precision; if it could not, the problem is not ready for decomposition.

4. **`SENSEMAKER_JSON_SCHEMA`** (meta-dag-predict.ts lines 116-127) — the JSON Schema
   enforced on Sensemaker output. Fields: `classification` (enum), `confidence` (number),
   `halt_reason` (optional string), `inferred_problem` (string), `key_signals` (string[]).
   The gate reads `confidence` and `halt_reason` from this schema-validated object.

## Imported bundle navigation

These preserved source files add depth when their stated topic is needed.

- [agents/default-agent.md](agents/default-agent.md) — Default Agent Template: pre-federation-halt-gate.
- [diagrams/01_flowchart_decision-points.md](diagrams/01_flowchart_decision-points.md) — Diagram 1: flowchart.
- [examples/01_worked_example.md](examples/01_worked_example.md) — Worked Example: Ambiguous Data Pipeline Request.
- [references/bonds-require-well-defined-problems.md](references/bonds-require-well-defined-problems.md) — Bonds Cannot Be Written on Ill-Defined Problems.
- [references/halt-gate-implementation.md](references/halt-gate-implementation.md) — Halt Gate Implementation: validityassessment.overall < 0.6 → HALT.
- [references/polya-principal-parts.md](references/polya-principal-parts.md) — Polya's Principal Parts and Ill-Posed Problem Detection.
