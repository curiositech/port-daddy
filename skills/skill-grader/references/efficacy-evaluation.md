# Structural grade is not efficacy

A structural grade measures discoverability, scope, contracts, and maintainability. It does not establish that a skill improves agent outcomes. Evaluate efficacy with a preregistered blocked assignment: freeze tasks and versions, then randomize availability within task/model/harness blocks.

Arms: no optional skill; current skill; revised skill; length-matched relevant prose; instructions without scripts; resources without prose. Keep mandatory safety policy equal. Record assignment, selection, read/injection, actual use, exact skill hash, context limit, tool environment, verifier hash, price schedule, retries, review, and rework. Estimate intention-to-treat before conditioning on use. Hold out repositories, versions, and attack/task families.

Report correctness, unsafe effects, total cost, elapsed time, and rework with intervals. A positive in-sample average does not promote a version if held-out slices regress, controls explain the gain, or selection into use drives the estimate.

## Worked example: paired composite-graft Q&A preference evidence

The WinDAGs paired-graft study supplies positive evidence that a composite skill package can improve Q&A preference in that evaluated setup. It used 50 unique question pairs and 100 answers, randomized judge presentation, the same Sonnet 4.6 model identifier, and a maximum 32,768 tokens per call. The graft was preferred over vanilla for 35 pairs, versus 6 vanilla preferences and 9 ties with Opus; it was preferred for 29, versus 20 vanilla preferences and 1 tie with GPT-5.5. Both judges preferred vanilla for hallucination avoidance.

The treatment was a composite graft: extra tools, four skill bodies, four adjacent skill descriptions, and a protocol. Vanilla was one call. It is therefore evidence for that versioned bundle and prompt/harness configuration, not evidence that any one skill is effective or that the result transfers to other models, tasks, or budgets. The study record is summarized in [Skills actually help: the numbers](https://windags.ai/blog/skills-actually-help-the-numbers); the pinned public export, script revision, and accounting limitations are recorded in the [WinDAGs efficacy audit](../../../docs/research/skills-reconciliation-20260923/windags-efficacy-evidence.md).

A confirmatory extension should separately test the product-default composite, randomized component ablations, and equal-total-resource comparisons. Ablations should hold non-treatment context fixed; resource-matched arms should preregister what is held equal, while tool access may differ when it is the treatment. Use held-out executed tasks with an independent outcome oracle and track useful completion, hallucination or unsafe-effect failures, total team cost, and rework rather than preference alone.
