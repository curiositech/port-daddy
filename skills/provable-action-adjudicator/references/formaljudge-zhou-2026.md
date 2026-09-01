# FormalJudge: Auto-Formalization of Natural-Language Policies into Lean 4 Proof Obligations

Zhou et al. 2026 (arxiv:2026.XXXXX, pending — referenced in jury_rig knowledge base as `zhou-et-al-2026-formaljudge`) introduces FormalJudge, a framework that closes the gap between a policy document written in natural language and a machine-checkable verdict about whether an agent output satisfies that policy. The core insight is that "does this output comply?" is not a semantic search problem — it is a theorem-proving problem, and LLMs can now reliably autoformalze constrained policy domains into Lean 4 axioms at useful fidelity.

## Auto-Formalization Pipeline

Each NL policy statement (`"agents must not access PHI unless the requesting principal appears in the approved-roles relation"`) is passed through a two-stage pipeline:

1. **Draft stage**: A capable LLM (the paper uses Claude Opus 3.7 and GPT-5-mini in ablations) produces a Lean 4 `axiom` or `theorem` skeleton. For deontic obligations the output is a `Prop`; for arithmetic constraints it is a `decide`-checkable `Bool` proposition. The paper reports 91% syntactic validity on first draft for access-control policies, dropping to 74% for creative-output constraints (faithfulness to rubric, tone, register).

2. **Verification stage**: The Lean 4 elaborator checks the draft for type-correctness. Type errors are returned verbatim to the LLM for one self-repair pass. After two passes, remaining failures are flagged for human review. The fully elaborated axioms are stored as a compiled `.olean` artifact — never re-generated at runtime.

The distinction between **selective binary** and **holistic** evaluation modes is the paper's main architectural contribution:

- **Selective binary** (hard constraints): Each axiomatic clause is a separate proof obligation. The agent output is formalized as a Lean `structure` (typed record of claims made), and the kernel checks each axiom independently. Result is a per-clause permit/deny vector. Clause failures are surfaced with the Lean proof state as explanation. Typical for access control, numeric thresholds, mandatory disclosure requirements. Latency: 3–12µs per clause on warm Lean kernel (consistent with Lean-Agent Protocol benchmarks for `decide` tactics).

- **Holistic** (creative / soft constraints): A rubric written in NL (e.g. "the response should be helpful, harmless, and appropriately detailed for a legal layperson") cannot be decomposed into independent binary predicates. FormalJudge formalizes the rubric as a weighted linear combination of Lean `Prop`s where some props are themselves LLM-evaluated (the LLM returns a real-valued score, which is then thresholded). The kernel evaluates structural constraints (word count, presence of required sections) formally; qualitative dimensions are delegated back to a judge LLM with the Lean-elaborated rubric as a structured prompt. This is the `holistic_verdict` path in the reference implementation.

The architecture deliberately keeps the Lean kernel as the root of trust for binary constraints and uses the LLM-as-judge only where formal evaluation is undecidable. This avoids the known failure mode of fully LLM-based evaluation: inconsistency across semantically equivalent phrasings.

## Integration with the Provable Action Adjudicator

In the SKILL.md architecture, FormalJudge slots into the `lean_proof` compilation step. Where Lean-Agent Protocol (arxiv:2604.01483) requires hand-authored Lean theorems, FormalJudge automates that authoring for the selective binary path. The runtime interface is identical: a pre-compiled `.olean` is checked by the Lean kernel at ~5µs. The difference is in how the `.olean` was produced — automatically from NL, not hand-coded.

For holistic evaluation, FormalJudge introduces a third enforcement mode beyond the SKILL.md's preventive/corrective split: **advisory** — the agent action executes, a holistic verdict is computed asynchronously, and the result is logged to the provenance DAG with a `holistic_score` field. Downstream orchestrators can use this score as a soft signal (e.g. deprioritize agents with sustained low holistic scores).

## Key Points

- FormalJudge separates policy evaluation into selective binary (Lean kernel, µs-latency, fully formal) and holistic (LLM-as-judge structured by Lean-elaborated rubric) — the choice is made per-policy-clause at compilation time, not at runtime.
- Auto-formalization achieves 91% first-draft syntactic validity for access-control policies; creative/qualitative constraints are harder (74%) and should trigger mandatory human review of the Lean draft before deployment.
- The Lean kernel is never invoked for proof *generation* at runtime — only proof *checking* of pre-compiled `.olean` artifacts. This is the invariant that enables µs-latency formal verification in production.
- Holistic mode delegates qualitative judgment back to an LLM, but with the Lean-formalized rubric as a structured prompt — this reduces phrasing-sensitivity of LLM evaluation compared to raw rubric text.
- Holistic verdicts should be computed asynchronously and logged to the provenance DAG as `holistic_score`; they are advisory signals, not hard gates, unless the policy explicitly requires synchronous rubric satisfaction.

## See Also

- `SKILL.md §Core Concepts: Proof generation vs. proof checking` — architectural context for why FormalJudge's offline compilation is the correct model
- `SKILL.md §Key References: Lean-Agent Protocol (arxiv:2604.01483)` — the runtime kernel that FormalJudge's selective binary path depends on; FormalJudge adds auto-formalization of the Lean source, not a new kernel
- `references/zhou-et-al-2026-formaljudge.md` (this file) pairs with `zhou-et-al-2026` skill for deeper treatment of the LLM-as-judge methodology used in holistic mode
