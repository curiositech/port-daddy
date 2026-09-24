---
license: Apache-2.0
name: llm-evaluation-harness
description: "Build automated LLM evaluation pipelines with benchmarks, regression tests, RAGAS, and human eval workflows. Activate on: LLM evaluation, benchmark testing, eval pipeline, RAGAS, model regression tests. NOT for: traditional software testing (testing-expert), model training (ai-engineer)."
allowed-tools: Read,Write,Edit,Bash(python:*,pip:*,npm:*,npx:*)
category: AI & Machine Learning
tags:
  - evaluation
  - benchmarks
  - ragas
  - llm-testing
  - regression
pairs-with:
  - skill: ai-engineer
    reason: Evaluation validates LLM application quality before deployment
  - skill: prompt-template-manager
    reason: A/B test results feed into prompt version promotion decisions
  - skill: fine-tuning-dataset-curator
    reason: Eval sets curated alongside training data measure fine-tune effectiveness
---

# LLM Evaluation Harness

Build automated evaluation pipelines for LLM applications with benchmarks, regression tests, RAG evaluation (RAGAS), and human eval workflows.

## Activation Triggers

**Activate on**: "evaluate LLM", "benchmark model", "regression test AI", "RAGAS evaluation", "eval pipeline", "LLM quality metrics", "compare model versions", "human evaluation workflow", "test AI responses"

**NOT for**: Traditional unit/integration testing (testing-expert), model training loops (ai-engineer), or prompt writing (prompt-engineer)

## Quick Start

1. **Define eval dimensions** — Correctness, faithfulness, relevance, coherence, safety. Pick the 2-3 that matter most for your use case.
2. **Build an eval dataset** — size it for the task mix, experimental unit, desired precision, and available oracle; include edge cases and adversarial inputs.
3. **Choose eval methods** — LLM-as-judge for scalable scoring, exact-match for structured outputs, RAGAS for RAG systems, human eval for nuance.
4. **Automate in CI** — Run the relevant evals when a prompt, model, or pipeline change affects the measured behavior. Apply a predeclared decision rule that accounts for uncertainty and decision costs; do not fail a build on any score movement alone.
5. **Track trends** — Store versioned task-level results and uncertainty over time; define a task-specific regression rule before inspecting release results.

## Core Capabilities

| Domain | Technologies | Notes |
|--------|-------------|-------|
| **RAG Evaluation** | RAGAS, DeepEval, custom | Faithfulness, answer relevance, context precision |
| **LLM-as-Judge** | Explicit provider/model/revision chosen for this task | Rubric-based observations with held-out calibration |
| **Deterministic checks** | Exact/reference match, semantic predicates, JSON Schema | Reference matching and structural validity are distinct outcomes |
| **Human Eval** | Argilla, Label Studio, custom UI | Rubric-based judgments; quality depends on oracle, rater design, and construct |
| **Benchmarks** | MMLU, HumanEval, custom domain benchmarks | Comparisons require aligned benchmark version, prompting, harness, and scoring protocol |
| **CI Integration** | GitHub Actions, pytest, Vitest | Versioned regression checks with a declared, uncertainty-aware decision rule |

## Architecture Patterns

### Pattern 1: Multi-Method Evaluation Pipeline

Route each item to a metric with an appropriate oracle; aggregate method-specific evidence without collapsing preference, task success, and effect truth into one score. See [multi-method evaluation](diagrams/research-l01-multi-method-evaluation-outputs-remain-distinct.md).

```python
# LLM-as-judge evaluation skeleton; pin the actual provider model/revision here.
import json

PINNED_JUDGE_MODEL_VERSION = "provider/model@revision"

JUDGE_RUBRIC = """
Score the following response on a scale of 1-5 for each dimension:

- **Correctness** (1-5): Is the information factually accurate?
- **Completeness** (1-5): Does it address all parts of the question?
- **Clarity** (1-5): Is it well-organized and easy to understand?

Question: {question}
Expected: {expected}
Response: {response}

Return JSON: {{"correctness": N, "completeness": N, "clarity": N, "reasoning": "..."}}
"""

def parse_judge_scores(raw):
    scores = json.loads(raw)
    dimensions = ("correctness", "completeness", "clarity")
    if not isinstance(scores, dict) or set(scores) != {*dimensions, "reasoning"}:
        raise ValueError("judge shape")
    if any(type(scores[k]) is not int or not 1 <= scores[k] <= 5 for k in dimensions):
        raise ValueError("judge scale")
    if not isinstance(scores["reasoning"], str):
        raise ValueError("judge explanation")
    return scores

async def evaluate_with_judge(test_cases, model_output_fn, llm_call):
    # Caller supplies authorized, budget-bounded adapters; no implicit retries.
    results = []
    for case in test_cases:
        row = {"task_id": case["id"], "judge_model": PINNED_JUDGE_MODEL_VERSION}
        try:
            response = await model_output_fn(case["question"])
        except Exception:
            results.append({**row, "status": "system_error"})
            continue
        prompt = JUDGE_RUBRIC.format(question=case["question"],
                                     expected=case["expected"], response=response)
        try:
            raw = await llm_call(prompt, model=PINNED_JUDGE_MODEL_VERSION, temperature=0)
        except Exception:
            results.append({**row, "status": "judge_error"})
            continue
        try:
            scores = parse_judge_scores(raw)
        except (ValueError, TypeError):
            results.append({**row, "status": "invalid_judge_output"})
            continue
        results.append({**row, "status": "scored", "scores": scores})
    return {"results": results}  # Keep errors in denominators and separate outcome lanes.
```

Keep run, response and prompt digests in the surrounding evaluation manifest; do not log private raw answers by default. Parsing an ordinal score validates its shape, not the judge’s factual accuracy. Temperature zero does not guarantee deterministic judging.

### Pattern 2: RAG Evaluation with RAGAS

Keep retrieval/context evidence distinct from answer support and answer relevance; report the metric definitions and dataset/oracle assumptions. See [RAG metric decomposition](diagrams/research-l02-rag-metric-decomposition.md).

The [official v0.3-to-v0.4 migration guide](https://docs.ragas.io/en/stable/howtos/migrations/migrate_from_v03_to_v04/) (read 2026-09-24) documents collections metrics, keyword-argument `ascore`, and `MetricResult.value`. Pin the installed Ragas and evaluator revisions; this documentation-based example has not called a provider.

```python
from ragas.metrics.collections import Faithfulness

async def score_support(case, evaluator_llm):
    metric = Faithfulness(llm=evaluator_llm)
    result = await metric.ascore(
        user_input=case["question"],
        response=case["answer"],
        retrieved_contexts=case["contexts"],
    )
    return {"task_id": case["id"], "metric": "faithfulness",
            "value": result.value}
```

Configure answer relevance and reference-based context precision as separate metrics with their own inputs and oracle requirements. Faithfulness concerns support from supplied context; that context can itself be false. Retain errors/unscorable cases and never relabel a diagnostic metric as verified task success.

### Pattern 3: CI Regression Gate

A reusable regression suite detects changes against a declared gate. Promotion claims require a fresh, untouched holdout after any rubric, prompt, or threshold tuning; never promote on items already inspected during calibration. See [regression review](diagrams/research-l03-regression-review-with-task-level-uncertainty.md).

## Anti-Patterns

1. **Evaluating without a relevant comparison** — A score needs context. Compare with a task-relevant prior version or alternative when the claim is comparative, and keep model/harness/budget changes visible.
2. **LLM-as-judge without calibration** — Judges can prefer verbosity or positions. Measure disagreement and order sensitivity on task-relevant development items, then freeze the rubric before held-out evaluation; no universal calibration count applies.
3. **Unjustified test-set size** — State the experimental unit, task mix, desired precision or power, and limitations. A universal item count does not establish reliable estimates.
4. **Evaluating only happy paths** — Include adversarial inputs, edge cases, ambiguous questions, and out-of-scope queries. The model should fail gracefully.
5. **Treating one method as sufficient by default** — Human, deterministic, and model-judge methods answer different questions. Use the method or combination that matches the task and oracle; human judgment may remain primary when appropriate.
6. **Structural score labeled efficacy** — A schema, lint, or rubric coverage score
   checks a release surface; it does not show that a skill improves task outcomes.
   Measure versioned skill efficacy in paired, held-out tasks.
7. **Judge as sole oracle** — Keep at least one independent outcome check for
   consequential claims, blind treatment where feasible, and report disagreement.

## Release-efficacy protocol

Evaluate a skill version against its prior version or no-skill condition on a frozen,
held-out task set. Hold model/harness versions, tool grants, retries, total token/time
budget, and acceptance oracle constant. Report useful completion, cost, latency,
failures, and uncertainty; keep structural quality and activation checks as separate
release gates. See `references/skill-efficacy.md`. For judge calibration, fresh holdouts, and correlated errors, use the linked protocol and cite the pinned source with its limits.

## Quality Checklist

- [ ] Dataset size and task coverage are justified for the target claim
- [ ] Multiple eval dimensions defined (correctness, completeness, safety, etc.)
- [ ] Where model judges are used, agreement, order sensitivity, and disagreement are audited on task-relevant examples
- [ ] A relevant comparison is included when the release claim is comparative
- [ ] Regression rule and decision costs are specified before release results are inspected
- [ ] Edge cases and adversarial inputs included at a documented, task-appropriate rate
- [ ] Regression checks run for changes affecting the evaluated behavior, under a declared decision rule
- [ ] Results stored with timestamps for trend analysis
- [ ] Human evaluation is used where the target construct or oracle requires it; it is not automatically subordinate to model scoring
- [ ] For RAG claims, report retrieval, support, and answer relevance separately with defined metrics and oracle limits


## Judge evidence and calibrated evaluation

See [skill efficacy](references/skill-efficacy.md) for the linked procedure and source limits.

An LLM judge is an evaluator observation, not ground truth. Freeze task identifiers, system/harness version, tool/budget/retry policy, rubric, and independent outcome oracle. Split by task/repository before tuning; randomize response order and repeat with swapped order where feasible. Report pairwise agreement, order-flip rate, invalid-output rate, task outcome, cost, failures, and uncertainty separately. Keep preference scores distinct from task acceptance and externally verified effects.

Hossain, Yousefi, and Lim, [arXiv:2609.22512v1](https://arxiv.org/html/2609.22512v1), define a calibrated error-correlation matrix and held-out retention filters (§§2.1–2.3). Their filters did not improve the tested factuality and code tasks (§4.5/limitations). Their effective-sample-size value summarizes variance in that setup; it does not predict vote accuracy or replace judge count. Do not infer a universal correlation cutoff or tune on held-out labels.

- [Judge calibration and held-out evaluation](diagrams/research-l04-judge-calibration-and-held-out-evaluation.md)

