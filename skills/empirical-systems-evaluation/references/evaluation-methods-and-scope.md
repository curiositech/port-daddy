# Evaluation methods and scope

## Recipe

1. State the estimand, assignment unit, outcome oracle, conditions, budget, and smallest practically meaningful difference.
2. Identify pairing, task/repository/seed clustering, repeated measures, and exclusions before collection. Keep retries and repeated runs within the task-level unit when appropriate.
3. Predeclare primary outcomes and contrasts; distinguish correctness/quality from latency, tokens, retries, and coordination cost.
4. Select analysis from the design and estimand. Distribution plots and residual checks diagnose a model; a normality-test threshold does not choose one. Sparse outcomes require an interval/test suited to the assignment and data, not a universal `n` or expected-cell rule.
5. Report task-level outcomes, effect estimate, suitable uncertainty, missingness, assumptions, and external-validity scope. Treat post-hoc discoveries as exploratory and design a fresh confirmatory evaluation.
6. For human ratings, document blinding, rubric, rater assignment, disagreement, and an agreement measure appropriate to scale/prevalence/missingness. No universal kappa cutoff makes an evaluation valid.

A matched study with 12 tasks has 12 paired task-level differences, not 24 independent scenarios. If tasks are nested in repositories or seeds, account for that dependency. Pairing reduces noise only when the shared scenario/seed is a legitimate common block.

## Source scope

[ACM SIGSOFT Empirical Standards](https://www2.sigsoft.org/EmpiricalStandards/) and [Ralph et al., Empirical Standards for Software Engineering Research, arXiv:2010.03525v2](https://arxiv.org/abs/2010.03525) concern method-specific community expectations for empirical software-engineering research. [Kitchenham, Madeyski, and Brereton, Meta-analysis for families of experiments in software engineering: a systematic review and reproducibility and validity assessment](https://link.springer.com/article/10.1007/s10664-019-09747-0) examines the validity and reproducibility of meta-analysis in experiment families; it is not a Jørgensen paper. Neither supplies universal numerical thresholds for this skill.

Access on 2026-09-24: Ralph metadata and abstract; Kitchenham publisher metadata, abstract and introductory/method excerpts. The full methods of either paper were not independently reproduced. [Conditional methods](design-conditioned-methods.md) use the cited official statistical documentation for their narrower formulas and caveats.
