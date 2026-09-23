# Evaluation validity for agent systems

Use this note when a systems result is intended to justify a product or
coordination choice. The primary estimand is a cost-quality outcome under a
frozen task distribution and operating budget, rather than accuracy alone.

1. Freeze the task corpus, model/harness versions, grants, acceptance oracle,
   retry policy, and accounting boundary before the confirmatory run.
2. Pair conditions by task and shared exogenous fault draws when possible. A
   common draw is a variance-reduction device, not evidence of independence;
   analyse the paired difference.
3. Keep an outcome oracle independent of the system under study. Record the
   oracle's failure modes and adjudicate disagreements without revealing the
   treatment.
4. Compare equal total compute, elapsed-time limit, retry allowance, and human
   review. Report useful completion, cost, latency, intervention, and unresolved
   external effects together.
5. Preserve a dated amendment trail and hold out a final corpus. Exploratory
   thresholds and post-hoc slices must stay labelled exploratory.

Kapoor et al. identify accuracy-only optimization, weak holdouts, and
non-reproducible agent evaluation as threats to downstream usefulness:
[AI Agents That Matter, 2024](https://arxiv.org/abs/2407.01502). This is a
methodological reference, not a claim that any given harness satisfies these
conditions.


## Worked example: what the WinDAGs graft result can and cannot identify

A paired WinDAGs Q&A study reports positive composite-graft preference evidence: 50 unique pairs and 100 answers, randomized presentation, one Sonnet 4.6 model identifier with a 32,768-token maximum per call, and preference counts of 35 graft / 6 vanilla / 9 ties with Opus and 29 / 20 / 1 with GPT-5.5. Both judges preferred vanilla for hallucination avoidance. See [Skills actually help: the numbers](https://windags.ai/blog/skills-actually-help-the-numbers) and the pinned public-export and script details in the [WinDAGs efficacy audit](../../../docs/research/skills-reconciliation-20260923/windags-efficacy-evidence.md).

The graft included extra tools, four skill bodies, four adjacent skill descriptions, and a protocol; vanilla was a single call. The observed comparison evaluates that versioned composite treatment in this Q&A setting. It does not establish an individual-skill effect, equal-budget efficiency, general task execution quality, or a production outcome.

The next confirmatory design should separately evaluate the product-default composite, component ablations, and equal-total-resource comparisons. Hold non-treatment context fixed for ablations; preregister the equalized resources for resource-matched arms, while permitting tool access to differ when it is the treatment. Score held-out executed tasks with an independent oracle and analyse paired differences for useful completion, hallucination or unsafe effects, rework, and total team cost.
