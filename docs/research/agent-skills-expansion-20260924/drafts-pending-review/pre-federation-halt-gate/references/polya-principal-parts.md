> **Historical, source-specific material.** The cutoffs, field names, formulas, line references, behavior, and product-state claims below are preserved from an imported source version and were not independently verified as current. Do not use them as a current policy or threshold; use the typed, evidence-backed guidance in `../SKILL.md` and `gate-policy-and-calibration.md`.

# Polya's Principal Parts and Ill-Posed Problem Detection

Polya's *How to Solve It* (1945) introduces a four-part anatomy of any well-formed problem:
the **unknown** (what you are trying to find or produce), the **data** (what you are given
or can assume), the **conditions** (constraints that the unknown must satisfy, linking it to
the data), and implicitly the **output type** (the form the solution must take). Polya's
diagnostic insight — now operationalized as `validity_assessment` in `windags-sensemaker`
— is that a problem is **ill-posed** whenever any one of these parts is missing, vague to
the point of unmeasurability, or contradictory with another part. An ill-posed problem
cannot be correctly decomposed: any DAG built on it is structurally unsound because the
terminal acceptance criterion is undefined or self-defeating.

## The Four Parts, Precisely

**Unknown.** The thing to be determined. Must be stateable in one sentence as a specific
artifact, decision, or answer. If the Sensemaker cannot produce `inferred_problem` as a
concrete noun phrase — not a process ("analyze the situation"), not a vague desire ("make
it better") — the unknown is absent and `clarity` scores below 0.5. The halt gate fires on
`clarity < 0.5` unconditionally, even if the weighted overall score would clear 0.6.

**Data.** Everything present in the problem context: user-supplied text, attached artifacts,
tool outputs, session memory, injected signals. Data that is inaccessible (e.g., a required
API key not in scope, a referenced file not in context) degrades `feasibility`. Data that
contradicts itself (two signals giving incompatible system states) degrades `coherence`.
Polya emphasizes separating "what is given" from "what is desired" — conflating them
produces the characteristic "make it work" class of underspecified requests.

**Conditions.** The testable constraints the unknown must satisfy. These are what allow
acceptance testing. A problem with zero conditions is indistinguishable from "do
something" — any output trivially satisfies it. Conditions may be hard (must pass unit
tests, must complete in under 60 seconds) or soft (prefer minimal diffs). The Sensemaker
maps hard conditions to the `coherence` dimension: if two hard conditions are mutually
exclusive, `coherence` falls below 0.4 and the gate must halt. Soft conditions that appear
hard (because the user said "must" but meant "ideally") are a common source of spurious
`coherence` failures — hence the gate's clarification questions for that dimension ask
which constraints are actually inviolable.

**Output type.** Polya treats this implicitly, but it is explicit in the Sensemaker schema
as the expected form of the deliverable: a file diff, a JSON payload, a natural language
plan, a deployed artifact. Mismatched output type is the most common source of
`clarity` degradation when the unknown seems well-specified but the format is ambiguous
("fix the bug" — does that mean a patch, a PR, a commit, or a verbal explanation?).

## The Halt Gate as Validity Check

The `validity_assessment.overall` score in `windags-sensemaker` is the weighted composition:

```
overall = (clarity × 0.4) + (feasibility × 0.3) + (coherence × 0.3)
```

Mapping to Polya: `clarity` measures whether the **unknown** and **output type** are
sufficiently precise. `feasibility` measures whether the **data** (including tools,
budget, time) supports actually solving the problem. `coherence` measures whether the
**conditions** are mutually satisfiable and consistent with the data.

The threshold of **0.6** is the minimum at which all three parts are at least partially
present. Below it, at least one part is critically missing or contradictory under the
weighting scheme — e.g., `clarity = 0.4, feasibility = 0.9, coherence = 0.9` yields
`overall = 0.16 + 0.27 + 0.27 = 0.70`, which clears the gate — but the dimensional
override `clarity < 0.5` fires first and halts anyway, because an unclear unknown poisons
every downstream decomposition node regardless of how feasible and coherent the rest is.

The three dimensional overrides in the gate (`clarity < 0.5`, `feasibility < 0.4`,
`coherence < 0.4`) each correspond to a Polya part becoming so degraded that no
scoring composite can compensate for it. This mirrors Polya's observation that a problem
with a contradictory condition is not "almost solvable" — it is unsolvable in kind, not
just in degree.

## Why "Pre-Federation" Is the Right Location

Polya's solving strategy begins with understanding the problem before touching a solution
method. The pre-federation halt gate enforces this sequencing mechanically: agents cannot
federate around subtasks until the principal parts are all present. Post-federation
discovery of a missing unknown requires unwinding bond assignments and edge contracts —
an expensive operation. The gate's cost is one Sensemaker call and a structured question
emission; its benefit is preventing O(n_agents) wasted work on an incoherent decomposition.

## Key Points

- A problem is ill-posed if any of the four principal parts (unknown, data, conditions,
  output type) is absent, unmeasurable, or contradictory — not merely vague. Vague unknown
  → `clarity` hit; inaccessible data → `feasibility` hit; contradictory conditions →
  `coherence` hit.
- The halt threshold (0.6) is a weighted composite floor, but the three dimensional
  overrides (`clarity < 0.5`, `feasibility < 0.4`, `coherence < 0.4`) are absolute and
  fire before the composite is evaluated.
- `halt_reason` being non-null is sufficient for a halt regardless of the numeric score;
  the Sensemaker sets it when it detects contradictions it cannot score precisely.
- Clarification questions must be targeted to the weakest dimension and answerable without
  pipeline-internal knowledge — they address the Polya part that is missing, not the
  scoring system.
- The gate is stateless and idempotent: safe to re-run after a human clarification round
  as long as the Sensemaker cache is bypassed so a fresh confidence score is computed.

## See Also

- `skills/windags-sensemaker/SKILL.md` — defines `ProblemUnderstanding`, the validity
  formula, dimensional weights, and the Polya extraction protocol the gate depends on.
- `packages/core/src/context/meta-dag-predict.ts` lines 347-360 — authoritative halt gate
  implementation; `SENSEMAKER_JSON_SCHEMA` lines 116-127 defines the schema the gate reads.
- `skills/windags-premortem/SKILL.md` — post-decomposition structural risk assessment;
  conceptually downstream of this gate (runs after federation, not before).
