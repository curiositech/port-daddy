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
