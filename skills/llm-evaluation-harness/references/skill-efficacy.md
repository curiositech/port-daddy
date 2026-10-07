# Skill efficacy is not structural quality

Keep bundle hygiene, schema validity, activation routing, and reviewer scores as
structural evidence. To claim efficacy, run paired task trials with a versioned
skill, fixed model/harness/tool budget, independent oracle, and held-out tasks.
Report beneficial and harmful cases, uncertainty, and the release decision.

SkillsBench evaluates skill effects across model-harness combinations and finds
non-uniform benefits, making a local paired release assay preferable to an
assumed universal gain: [SkillsBench v4](https://arxiv.org/html/2602.12670v4).


## Worked example: paired composite-graft Q&A preference evidence

The WinDAGs paired-graft study supplies positive evidence that a composite skill package can improve Q&A preference in that evaluated setup. It used 50 unique question pairs and 100 answers, randomized judge presentation, the same Sonnet 4.6 model identifier, and a maximum 32,768 tokens per call. The graft was preferred over vanilla for 35 pairs, versus 6 vanilla preferences and 9 ties with Opus; it was preferred for 29, versus 20 vanilla preferences and 1 tie with GPT-5.5. Both judges preferred vanilla for hallucination avoidance.

The treatment was a composite graft: extra tools, four skill bodies, four adjacent skill descriptions, and a protocol. Vanilla was one call. It is therefore evidence for that versioned bundle and prompt/harness configuration, not evidence that any one skill is effective or that the result transfers to other models, tasks, or budgets. The study record is summarized in [Skills actually help: the numbers](https://windags.ai/blog/skills-actually-help-the-numbers); the pinned public export, script revision, and accounting limitations are recorded in the [WinDAGs efficacy audit](../../../docs/research/skills-reconciliation-20260923/windags-efficacy-evidence.md).

A confirmatory extension should separately test the product-default composite, randomized component ablations, and equal-total-resource comparisons. Ablations should hold non-treatment context fixed; resource-matched arms should preregister what is held equal, while tool access may differ when it is the treatment. Use held-out executed tasks with an independent outcome oracle and track useful completion, hallucination or unsafe-effect failures, total team cost, and rework rather than preference alone.


## Operational paired-evaluation protocol

Freeze task IDs, model and harness versions, tool permissions, retries, time/token budget, prompts/rubric, and an independent outcome oracle. Split by task and, where feasible, repository/time before tuning. Run both versions under equal declared resources and preserve task-level paired outcomes. Report useful completion, correctness/quality, harmful or hallucinated output, failures, rework, cost, and latency as separate outcomes with uncertainty. Preference-only results do not establish task completion or external-effect safety.

For judge audits, randomize answer order, include a swapped-order repeat, blind system identity where practical, retain ties/unscorable cases, and compare against human or deterministic labels. Report pairwise agreement, order-flip rate, invalid-output rate, and task outcomes separately. After changing prompt/rubric/selection, the prior set remains useful for regression but cannot serve as untouched promotion evidence; use a fresh holdout.

Hossain, Yousefi, and Lim, [arXiv:2609.22512v1](https://arxiv.org/html/2609.22512v1), define a calibrated error-correlation matrix and held-out retention filters (§§2.1–2.3), but report no improvement on their tested factuality/code tasks (§4.5/limitations). The reported effective sample size summarizes variance in that setup; it is not a vote-accuracy predictor or substitute judge count. No universal correlation cutoff is justified.


## Source access and implementation boundary

Research pages above were accessed 2026-09-24 at the pinned versions shown. SkillsBench and the judge-correlation paper provide source-specific evidence; the WinDAGs paired Q&A study supports its composite-graft comparison. None measures this draft. The official [Ragas v0.3-to-v0.4 migration guide](https://docs.ragas.io/en/stable/howtos/migrations/migrate_from_v03_to_v04/) was read for metric imports/scoring/results. The entrypoint separates ordinal-score parsing, structural validation, task outcome and context-support metrics. Documentation inspection and offline parser fixtures are not a live provider evaluation.
