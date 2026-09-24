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
