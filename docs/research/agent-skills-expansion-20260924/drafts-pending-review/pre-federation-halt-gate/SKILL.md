---
name: pre-federation-halt-gate
version: 0.1.0
description: >
  Pre-decomposition review of task definition, constraints, authority, and feasibility.
  Uses typed hard blockers and decision-relevant clarification; any scalar score or cutoff
  is an implementation-specific policy that requires its own calibration and error-cost
  rationale. Avoids presenting Polya's problem-analysis framework as a source for numeric
  weights or thresholds. The gate is named "pre-federation"
  because it fires before agents federate around a shared decomposition — once subtasks exist
  and skills are assigned, reverting is expensive; catching ambiguity here is cheap.
author: soma-windags-graft
tags: [windags, halt-gate, sensemaker, validation, polya, federation, problem-definition]
pairs-with: [windags-sensemaker, windags-decomposer, windags-premortem]
---

# Pre-Federation Halt Gate

## When to Use

- A pipeline emits a `SensemakerOutput`/`ProblemUnderstanding` and needs a pre-decomposition decision contract. Inspect any scalar score as source-specific telemetry; do not assume it is calibrated.
- Any pipeline that writes subtask bonds, DAG edges, or skill assignments from a problem
  statement that has not yet been validated for clarity, feasibility, and coherence.
- Resuming a checkpointed pipeline after a human clarification round — re-run the gate to
  confirm that the updated, versioned problem satisfies the declared hard invariants before unlocking downstream waves.

NOT for:
- Post-decomposition quality checks (use `windags-premortem` for structural DAG risks).
- Validating skill assignments or model-tier choices (those belong in the skill-selector stage).
- Real-time streaming responses where latency forbids a blocking gate call.

## Core Concepts

**Scoring is implementation-specific.** Some upstream implementations expose a scalar confidence and use a fixed cutoff; this is their local policy, not a Polya-derived value or a validated general gate. A weighted average can mask a critical unknown (authority, rollback, trust, or resource bound), so check defined hard blockers separately. Do not treat an uncalibrated model score as probability.

**Source-specific interface:** the inherited reference says one `meta-dag-predict.ts` version returns `confidence` and `halt_reason`, with code-level branching on a cutoff and explicit reason. Pin and inspect that exact source revision before depending on its fields or behavior. A score is not calibrated probability unless separately evaluated.

**Halt vs warning:** define typed outcomes in the consuming pipeline. A blocking result must prevent downstream decomposition at the actual transition; a warning is advisory only. Any `PredictedDAG` shape, event name, or output field is version-specific and must be checked against the pinned caller.

**Problem-analysis prompts:** use `unknown`, available `data`, constraints/conditions, and desired output form as elicitation questions. This is a practical adaptation, not a numeric Polya test. If an important item is absent or ambiguous, classify it as unknown and decide whether to ask, investigate reversibly, or halt based on downstream consequence.

**Clarification request structure:** ask targeted, answerable questions tied to a decision-relevant unknown or constraint. Do not rely on a scalar ranking to choose the question when a hard blocker is known.

## Recommended decision pattern

The following language-neutral pseudocode illustrates the decision boundary. It does not define a production schema or upstream API:

```text
assessment = assess(versioned_problem, declared_policy)
if assessment.has_critical_false_or_unknown:
    return HALT(typed_blockers, decision_changing_questions, assessment.version)
if assessment.requires_investigation:
    require_explicit_authority_and_limits()
    return INVESTIGATE(reversible_plan, assessment.version)
return CLEAR_FOR_NEXT_STAGE(assessment.version)

on_clarification(updated_problem):
    new_version = record(updated_problem, provenance)
    invalidate_derived_cache_for(old_version)
    return pre_federation_gate(new_version)
```

Questions should name a missing field or incompatible constraint, explain why it changes the downstream decision, and allow an answer without internal pipeline terminology. The caller must enforce `HALT`; a returned label alone is not a gate.

**Typed blockers:** define critical blockers from the downstream transition and threat model, such as missing authority, rollback, resource cap, or mutually incompatible hard constraints. The old `.5`/`.4` dimension cutoffs are local heuristics and are not retained as general rules. If a clarification resolves an unknown, create a new assessment version and rerun the gate before decomposition.

**Resume behavior:** determine whether checkpointed input/output bytes are still current. A human clarification must change the assessment version or invalidate the relevant cache; then rerun the gate on the clarified problem before downstream work. Verify this against the exact pipeline version.

## Key References and Source Boundary

The inherited references describe one external Workgroup AI implementation and local skill text. They are preserved in `references/halt-gate-implementation.md` and `references/polya-principal-parts.md` for version-specific inspection. The cited source paths, line numbers, schema, cache behavior, and `.6` cutoff are not independently verified as current in this offline draft. Polya’s book supports a problem-analysis vocabulary; it does not validate a weighted score or gate accuracy. See the [source correction ledger](references/source-correction-ledger.md).

## Imported bundle navigation

These preserved source files add depth when their stated topic is needed.

- [agents/default-agent.md](agents/default-agent.md) — Default Agent Template: pre-federation-halt-gate.
- [diagrams/01_flowchart_decision-points.md](diagrams/01_flowchart_decision-points.md) — Diagram 1: flowchart.
- [examples/01_worked_example.md](examples/01_worked_example.md) — Worked Example: Ambiguous Data Pipeline Request.
- [references/bonds-require-well-defined-problems.md](references/bonds-require-well-defined-problems.md) — Bonds Cannot Be Written on Ill-Defined Problems.
- [references/halt-gate-implementation.md](references/halt-gate-implementation.md) — source-specific external implementation behavior; not a universal threshold.
- [references/gate-policy-and-calibration.md](references/gate-policy-and-calibration.md) — typed hard blockers, decision costs, and fresh reassessment.
- [references/source-correction-ledger.md](references/source-correction-ledger.md) — disposition of unsupported threshold/weight claims.
- [references/polya-principal-parts.md](references/polya-principal-parts.md) — Polya's Principal Parts and Ill-Posed Problem Detection.


## Hard-blocker policy and calibration boundary

Check the downstream transition, not a single aggregate number. Enumerate authority, trust, data access, rollback, resources, reversibility, and acceptance conditions. For each, record `satisfied`, `false`, or `unknown` with evidence and owner. A critical false/unknown blocks federation. A bounded reversible investigation may proceed only if its authority and limits are established. Ask the smallest question that changes the decision. A clarified request receives a new assessment version and fresh gate run.

Scalar confidence, dimension weights, `.6` overall cutoffs, and `.5`/`.4` subscore cutoffs in the inherited materials are implementation-specific heuristics without a verified primary justification for universal use. If a system retains a scalar, version it, state decision costs, calibrate against independently adjudicated outcomes, and keep its data separate from held-out efficacy claims. Polya's problem-analysis vocabulary supplies prompts; it does not establish those numbers.

- [Typed gate and reassessment flow](diagrams/research-h01-typed-pre-federation-gate-rewrites-existing-mermaid.md)
- [Missing definition to affected guarantee](diagrams/research-h02-missing-definitions-to-affected-guarantees.md)


