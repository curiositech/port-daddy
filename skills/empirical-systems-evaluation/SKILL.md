---
name: empirical-systems-evaluation
description: >
  Rigorous benchmarking of multi-agent coordination systems: experiment design,
  statistical analysis, human evaluation protocols, and reproducible reporting.
  NOT FOR ML model evaluation (use llm-evaluation-harness), A/B testing for
  web products, survey design, or general data science.
license: Apache-2.0
version: 1.0.0
tags: [benchmarking, statistics, multi-agent, experiment-design, coordination]
---

# Empirical Systems Evaluation

Design, execute, and report experiments that measure multi-agent coordination systems. Match uncertainty summaries and effect measures to the estimand, assignment unit, dependence, and measurement process; intervals do not repair a biased design. State threats to validity and label examples as synthetic or observed.

## Scope Boundaries

**IN SCOPE**: benchmarking coordination protocols, measuring recovery latency,
comparing scheduling algorithms, evaluating fault tolerance, assessing human-agent
handoff quality, timing distributed consensus.

**NOT FOR**:
- ML model evaluation (accuracy, perplexity, BLEU) -- use `llm-evaluation-harness`
- A/B testing for web products (conversion funnels, click-through) -- use split-testing tools
- Survey design or psychometrics -- use validated instruments from the literature
- General data science (EDA, feature engineering, model selection) -- wrong skill entirely

---

## 1. Experiment design and analysis choice

State the estimand, assignment unit, outcome oracle, comparison conditions, pairing or clustering, and budget before selecting a test. Distinguish task success from process measures such as latency, tokens, retries, and coordination overhead. The design determines the analysis; a normality test or sample-size slogan does not select a valid method. See [matched experiment](diagrams/research-e01-matched-experiment-and-causal-measurement.md) and [design-aware analysis](diagrams/research-e02-choose-analysis-from-design-not-a-normality-gate.md).

## 2. Automated Metrics Protocol

For latency, throughput, recovery time, message counts, resource usage:

1. **Define the metric precisely.** "Salvage latency" = wall-clock ms from
   agent death detection to first recovered work unit passing validation.
2. **Instrument, don't approximate.** Timestamps at event boundaries, not
   log-line scraping.
3. **Plan precision and power for the stated estimand and assignment design.** Section 8 gives planning examples, not a universal sample-size floor.
4. **Choose summaries that match the estimand and observed distribution.** Median + IQR may describe skewed latency; mean + SD may be useful for other estimands. Do not select an inferential method from a normality test alone.
5. **Report uncertainty at the experimental unit.** Use a bootstrap only when
   its resampling assumptions and effective sample size are credible; otherwise
   use an appropriate analytical interval, a paired/permutation method, or
   report the result as descriptive and underpowered (Section 9).

### 2a. Valid comparison protocol

Write the estimand before instrumenting: for example, “difference in useful
completion under the same task, model snapshot, grants, token/time budget, and
acceptance tests.” Use an independent oracle for the claimed outcome; a system's
own log, self-score, or planner is telemetry, not proof. Pair conditions on the
same scenario and seed where that is legitimate, and use common random variates
(the same crash timing, queue delay, or fixture) to reduce noise. Report that
pairing and the unit of randomization. Do not reuse the treatment's ranking,
monitor, or acceptance model as the oracle.

For multi-agent claims, include an equal-budget single-agent baseline and state
whether retries, human review, and coordination overhead count against each
condition. A multi-agent result only supports the workload class tested; it does
not establish a general agent-count rule. See `references/evaluation-validity.md`.

---

## 3. Human Evaluation Protocol

For recovery fidelity, code quality, correctness of salvaged work:

### 3a. Rater Selection
Choose the number and expertise of raters from the evaluation design and the uncertainty you need to characterize. Use blinded condition labels where feasible, and document rater expertise, independence, and any adjudication process. Do not claim that a fixed rater count guarantees reliable judgments.

### 3b. Rating Scale Design
- Use concrete anchored scales (not "1=bad, 5=good").
- Example for recovery fidelity:
  - 1: Output is unrelated to original task
  - 2: Output addresses the right task but is mostly wrong
  - 3: Output is partially correct, major gaps remain
  - 4: Output is mostly correct, minor issues only
  - 5: Output is equivalent to or better than pre-crash state

### 3c. Inter-Rater Reliability
- Choose an agreement statistic that matches the rating scale, number of raters, missingness, and study question; report its definition and uncertainty.
- Report the observed disagreement pattern and rater protocol. Do not treat a fixed kappa band as a universal pass/fail gate; agreement can be affected by prevalence and category imbalance.
- If disagreement is material, revise the rubric on development examples, retrain, and use fresh held-out examples for any confirmatory reliability claim.

### 3d. Resolving Disagreements
- Resolve disagreement using a procedure set before reviewing outcomes when feasible. A third rater, adjudication, or consensus discussion may fit some designs; report how it was used and preserve initial ratings where relevant. Do not treat majority vote as a correctness oracle.

---

## 4. Binary and sparse outcomes

For binary outcomes, report the numerator, denominator, experimental unit, and an interval suited to the design. Use exact or randomization-based inference when sparse cells or the assignment mechanism require it; use a model only when its assumptions fit the estimand and dependence structure. Do not choose chi-squared versus exact methods from universal `n >= 30` or expected-cell cutoffs alone. See [design-aware analysis](diagrams/research-e02-choose-analysis-from-design-not-a-normality-gate.md).

## 5. Choose an analysis from the design

Choose the method from the target estimand, randomization/assignment unit, pairing, clustering, dependence, outcome scale, and planned contrast. Inspect distributions and residuals as diagnostics; a normality-test p-value does not route a design to “parametric” or “non-parametric.” For repeated tasks, keep task-level paired differences; for tasks nested in repositories or seeds, account for that clustering. When assumptions are not credible, select an exact, randomization, robust, or descriptive approach that matches the design and state its limits. See [design-aware analysis](diagrams/research-e02-choose-analysis-from-design-not-a-normality-gate.md).

See [conditional methods and formulas](references/design-conditioned-methods.md) for paired and independent mean contrasts, rank-based estimands, and a worked sample-size approximation.

## 6. Pairwise Comparisons (2 Conditions)

1. Choose test from Section 5.
2. Report a test statistic and p-value when inferential testing is part of the prespecified analysis.
3. Report an effect measure defined for the estimand and outcome scale, with uncertainty when the design supports it. Standardized effects may help compare studies but are not universal labels for practical importance; state any domain-specific smallest effect of interest and how it was chosen.

---

## 7. Confirmatory contrasts and exploratory follow-up

Pre-specify primary and confirmatory contrasts and the familywise or false-discovery procedure appropriate to the claim. An omnibus test is not a universal permission gate for all pairwise contrasts: report planned contrasts according to the declared analysis plan, and label unplanned searches exploratory. Follow-up should preserve effect estimates and intervals rather than suppressing contrasts solely because an omnibus p-value exceeds `.05`. See [contrast workflow](diagrams/research-e03-confirmatory-contrasts-and-exploratory-follow-up.md).

## 8. Sample size and precision planning

Plan sample size from the estimand, assignment unit, expected variance or event rate, dependence/clustering, smallest effect of practical interest, and desired interval width or power. State all assumptions and do sensitivity analysis. Do not use `d = .5`, 30 runs per condition, or a generic “medium” effect as a universal floor or minimum interesting effect. Where assumptions are weak, present feasible-sample precision and label the evaluation exploratory rather than manufacturing certainty.

Do not treat a run count as a universal floor. A pilot can estimate feasibility and inform variance or event-rate assumptions, but a small pilot is often too imprecise for stable planning. Show sensitivity to uncertain inputs; if feasible sample size is limited, report the resulting precision and keep claims commensurate with it.

---

## 9. Bootstrapped Confidence Intervals

Use when observations are exchangeable at the experimental unit and there are
enough independent units for resampling to approximate the sampling process.
Unknown distributions alone do not justify a bootstrap.

### Unit and small-sample check

Define the experimental unit before choosing an interval: it might be a task,
repository, user, run, or matched task pair, but not correlated retries,
messages, or token samples from one run. Resample whole units (or paired
differences), never their dependent subevents. With only two seeds, a few
repositories, or strong dependence, percentile or BCa intervals can look
precise without providing reliable coverage. Use a model/interval appropriate
to the design when its assumptions are defensible; otherwise show every unit,
state the limitation, and avoid confirmatory claims.

### Procedure and interval choice

1. Declare the statistic, resampling unit, dependence structure, interval method, and confidence level. For matched conditions, resample matched units together; for a cluster design, use a method that represents the cluster structure.
2. Draw bootstrap samples with replacement at that unit and recompute the full statistic. Choose and record enough resamples for acceptable Monte Carlo stability.
3. A two-sided 95% percentile interval uses the 2.5th and 97.5th percentiles of those statistics. That construction alone does not establish coverage for this design.
4. BCa adjusts for bias and acceleration; it is not automatically appropriate because latency looks skewed. Check whether the statistic and sample support the calculation. Degenerate data can produce undefined BCa endpoints.
5. If reasonable methods disagree, disclose the sensitivity and investigate assumptions and influential units. Do not silently choose whichever interval gives the desired conclusion.

The [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html) documents paired resampling and degenerate BCa behavior. Record the software version and method; its defaults are implementation choices, not a study-design justification.

---

## 10. Meaningful vs Strawman Baselines

A comparison is only as strong as the baseline it beats.

### Optional baseline vocabulary

The following labels are a local organizing aid, not a published or validated ranking scale. Evaluate each alternative on relevance, tuning, resources, and coverage for the declared task.

### Illustrative baseline labels

| Tier | Description | Example |
|------|-------------|----------|
| S: State-of-Art | Best known system for this task | Published coordination protocol with code |
| A: Strong | Reasonable well-tuned alternative | Round-robin assignment with retry |
| B: Naive | Simplest reasonable approach | Random assignment, no recovery |
| F: Strawman | Designed to lose | No coordination at all / sleep(random) |

**Baseline selection**: Choose credible alternatives that address the same task under comparable resources and constraints. Explain why each baseline is relevant and disclose when only a simple baseline is feasible. A deliberately weak baseline cannot support a broad superiority claim by itself; do not impose a fixed tier or baseline-count requirement independent of the study question.

---

## 11. Quality Gates

Before any result leaves your desk, verify ALL of the following:

- [ ] Report uncertainty suited to the assignment unit and estimand; explain when an interval is not credible
- [ ] Every comparison has an effect measure suited to its estimand and outcome
- [ ] Report uncertainty for the effect measure when the design supports it
- [ ] Planned contrasts and multiplicity are handled according to the prespecified analysis plan and claim
- [ ] Human evaluations describe the rater protocol, disagreement, and an agreement summary only where appropriate to the scale and design
- [ ] Sample size justification is stated (power analysis or pilot-informed)
- [ ] Baselines are credible for the task, resource budget, and comparison claim
- [ ] Model/design assumptions and dependence structure are checked
- [ ] Threats to validity section exists and is honest
- [ ] Raw data or summary statistics are available for reproduction
- [ ] Code for analysis is provided or described precisely

---

## 12. Failure Modes (Anti-Patterns)

### 12a. P-Hacking
**What it looks like**: Running many statistical tests, trying different
subsets, transformations, or exclusion criteria until p < 0.05. Reporting
only the "significant" result.

**Detection**: Ask "was this comparison pre-registered or decided after
seeing the data?" If the answer is after, it is exploratory, not confirmatory.

**Fix**: Separate prespecified confirmatory analyses from post-hoc exploration. Use a multiplicity strategy justified by the planned family of claims, and label discoveries made after inspecting results as exploratory. A smaller alpha alone does not repair selective reporting or design flaws.

### 12b. Strawman Baselines
**What it looks like**: Comparing your coordination system to "no coordination"
and celebrating the win. Or comparing to a deliberately misconfigured alternative.

**Detection**: Would a skeptical reviewer say "of course it's better than nothing"?

**Fix**: See Section 10. Include a credible alternative when one is available
and relevant to the estimand. If only a deliberately weak comparator is
feasible, narrow the claim and present the comparison as a limited check.

### 12c. Reporting Means Without Variance
**What it looks like**: "System A achieved 340ms recovery latency vs 890ms
for System B." No standard deviation, no CI, no indication of spread.

**Detection**: Can a reader assess whether the difference is reliable?

**Fix**: Report a summary and uncertainty measure that match the estimand,
experimental unit, and dependence structure. A **synthetic formatting example only**, with no data or inferential test implied:
"System A: median 340ms (IQR 280-410, 95% CI [310, 370]) vs System B:
median 890ms (IQR 720-1100, 95% CI [810, 970])."
A real report must name the unit, interval method, paired contrast estimate, and assumptions; marginal intervals alone do not supply the contrast interval.

### 12d. Ignoring Multiple Comparisons
**What it looks like**: Searching many metrics and system contrasts, then presenting only the small p-values. The number of tests is the number of hypotheses actually tested, not just the number of metrics. For an illustrative family of ten true null hypotheses, each tested at a valid level of .05, the expected number of false rejections is at most .5; that expectation is not the probability of any false rejection.

**Fix**: Declare the family of claims and intended error criterion. Holm can control familywise error across valid component tests; false-discovery procedures answer a different question and have their own dependence conditions. Exploratory status does not exempt a search from multiplicity or selective-reporting concerns: disclose the search and use an appropriate strategy, or reserve discoveries for a fresh confirmatory study. See the [R adjustment reference](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html).

### 12e. Confounding Experimental Conditions
**What it looks like**: System A on fast hardware, System B on slow. Or easy scenarios for A, hard for B.

**Fix**: Same hardware, same scenarios, same network. If infrastructure differs, run both systems on both and analyze as a crossed design.

---

## 13. Threats to Validity Checklist

Every report must address four categories:

- **Internal**: confounds controlled, randomization applied, instrumentation non-intrusive, no unexplained exclusions
- **External**: scenarios representative, scale stated (8 agents != 800), hardware/network documented, generalization boundaries explicit
- **Construct**: metrics measure what you claim, definitions concrete not hand-waved, rubrics aligned with rater task
- **Statistical**: sufficient power, test assumptions met, effect sizes practically meaningful (not just p < 0.05)

---

## 14. Worked Example: Bonded Commons Crash Recovery Experiment

> **ILLUSTRATIVE DESIGN ONLY — NOT RUN.** Every numeric scenario, sample size, timing, test result, p-value, interval, rating, and effect below is synthetic. Do not cite it as a finding or treat it as a recommended threshold; replace it with a preregistered design and actual collected data.

### 14a. Research Question

"Does the Bonded Commons salvage protocol recover agent work faster and with
higher fidelity than round-robin reassignment after random agent crashes?"

### 14b. Experimental Setup

- **System Under Test**: Bonded Commons (salvage protocol with context-aware
  resurrection, session notes, file claims)
- **Candidate baseline**: Round-robin reassignment -- when an agent dies, its
  tasks are assigned to the next available agent in rotation, with full task
  description but no session context. Assess whether this is a credible
  comparator for the target workload before drawing a comparative claim.
- **Additional candidate**: Random reassignment -- tasks assigned to a random
  live agent, no context transfer; a deliberately simple comparison is
  descriptive context, not a sufficient basis for broad superiority claims.

### 14c. Variables

| Variable | Type | Values |
|----------|------|--------|
| Coordination protocol | Independent (3 levels) | Bonded Commons, Round-Robin, Random |
| Crash schedule | Exogenous common input | Prespecified time/work-unit schedule shared across matched conditions |
| Number of agents | Fixed | 8 |
| Scenarios | Fixed set | 20 human-designed coordination tasks |
| Salvage latency (ms) | Dependent, automated | Time from crash to first valid output |
| Recovery fidelity (1-5) | Dependent, human-rated | Quality of recovered work vs pre-crash |
| Task completion rate | Dependent, automated | Proportion of tasks completed successfully |

### 14d. Scenario Design

20 scenarios, stratified by difficulty:
- 5 simple (single-file edit, clear specification)
- 10 moderate (multi-file change, some ambiguity)
- 5 complex (cross-system coordination, architectural decisions)

Each scenario has a gold-standard completion for fidelity comparison.

### 14e. Crash Injection Protocol

For each scenario x protocol combination:
1. Start 8 agents on the task.
2. Apply the prespecified common crash schedule to a designated eligible role
   (SIGKILL, no graceful shutdown). Record when the target role is unavailable.
   If timing is defined by progress, specify an externally measurable reference;
   treatment-dependent completion percentages change the intervention itself.
3. Measure time until the system detects the crash and reassigns work.
4. Measure time until the replacement agent produces first valid output.
5. Let the system run to completion or 10-minute timeout.
6. Collect the final output for human evaluation.

### 14f. Sample Size Planning (illustrative design only)

This hypothetical design proposes 20 scenarios and five repetitions per condition, but those runs are clustered within scenario; they are not automatically 100 independent units per condition. Do not reuse a two-independent-groups calculation as proof of power. Define the target estimand and assignment unit, model scenario/repetition/rater dependence, then plan precision or power from pilot variance and a meaningful effect. If inputs are unavailable, label the exercise exploratory and report the limitation. The numbers here are design placeholders, not a validated minimum.

### 14g. Human Evaluation Setup

- 3 raters: senior engineers with multi-agent system experience
- Blinded: raters see recovered outputs labeled only as "Output A/B/C"
- The proposed five repetitions yield 300 outputs (20 scenarios x 3 protocols x 5), before missing/failed runs. Specify whether all outputs are rated or a prespecified balanced subset is sampled. Budget rater workload and model repeated ratings; do not silently select the best repetition.
- Rubric: the 1-5 fidelity scale from Section 3b
- Pilot: raters independently score 5 practice outputs, discuss, calibrate
- Report a scale-appropriate agreement measure and uncertainty; use a prespecified, context-justified action rule rather than a universal kappa cutoff

### 14h. Analysis Plan (Pre-Registered)

**Primary outcomes and contrasts** (illustrative plan, to be completed before collection):

1. Recovery latency: specify the summary and how timeouts/censoring enter it; use a matched task-level contrast or a model representing scenario and repetition dependence. Skew alone does not justify an independent-groups Kruskal-Wallis test on these repeated scenarios.
2. Recovery fidelity: retain ordinal ratings and rater identity. Prespecify aggregation or an ordinal model that represents the repeated scenario/rater structure; a median rating followed by an independent-groups test does not remove that dependence.

Declare the contrast family and multiplicity strategy. For secondary completion rates, retain matched scenario/repetition denominators and failure categories. Difficulty-stratum plots are exploratory and may be too sparse for inference. Report estimand-specific effect estimates and uncertainty; standardized effects are optional, and require a defined denominator and interpretation.

### 14i. Synthetic Reporting Example (not observed results)

The numbers below are constructed solely to show descriptive formatting. They are not simulated or observed data, internally validated statistical outputs, or proposed performance targets.

```text
Recovery latency (ms), descriptive median [IQR]:
  Bonded Commons: 340 [280, 410]
  Round-Robin:    890 [720, 1100]
  Random:       1450 [1100, 2200]

Report alongside real data:
  assignment unit and number of independent units: <fill from protocol>
  repetitions, missing runs, timeouts, and exclusions: <actual counts>
  prespecified matched contrast and effect estimate: <computed estimate>
  uncertainty method, interval, assumptions: <computed and justified>
  multiplicity family and adjustment: <declared before analysis>
  rater disagreement and initial ratings: <observed summary>
```

Do not generate inferential statistics from these descriptive placeholders. Raw matched outcomes and the declared assignment design are required.

### 14j. Threats to Validity (for this experiment)

**Internal**: The common crash schedule covers only its declared window and eligible roles. Treatment-dependent progress or absent roles can alter exposure and must be accounted for. The SIGKILL model may not represent all
real failure modes (network partition, OOM, context window exhaustion).

**External**: 8 agents is a small fleet. Results may not generalize to 50+
agents where network effects dominate. All agents run on the same machine;
distributed deployment adds latency variance.

**Construct**: "Recovery fidelity" is a proxy for "did the user get what they
wanted." The 1-5 scale compresses nuance. Future work should include task-
specific correctness checks.

**Statistical**: 20 scenarios may not cover the full distribution of
coordination tasks. The scenarios were author-designed, not sampled from
production logs.

---

## 15. Reporting Template

See [source correction ledger](references/source-correction-ledger.md) for dispositions of inherited sample-size, agreement, and expected-result claims.

A useful reporting template can contain these sections; adapt it to the design and venue:
1. **Research Question** -- one falsifiable sentence
2. **Method** -- systems (with versions), scenarios, metrics, sample size justification, procedure
3. **Results** -- descriptive stats (central tendency + spread + CI), test statistics, p-values, effect sizes with CIs, inter-rater reliability
4. **Discussion** -- interpretation tied to effect sizes, practical significance, null results reported honestly
5. **Threats to Validity** -- internal, external, construct, statistical conclusion
6. **Reproduction** -- code link, data availability, exact software versions
7. **Instrument and protocol amendments** -- oracle ownership, pairing/randomization,
   excluded runs, retry policy, and dated changes made after registration

---

## 16. Quick Reference Card

| Concept | When to Use | Key Number |
|---------|-------------|------------|
| Bootstrap CI | Exchangeable, adequately independent units | B is a sensitivity choice, not a proof of coverage |
| Cohen's d | Continuous, 2-group standardized difference | Report the estimate and interval; magnitude labels are context-dependent conventions, not universal practical-significance rules. |
| Rank-biserial r | Rank-based comparison | Define estimand and interpretation for the design; do not treat inherited magnitude cutoffs as universal. |
| Agreement statistic | Rater agreement | Match scale, prevalence, missingness, and question |
| Bonferroni | k comparisons | alpha / k |
| Holm-Bonferroni | k comparisons (less conservative) | Ordered p-values |
| Sample-size planning | Depends on estimand, unit, variance, dependence, target precision | State assumptions; no universal n |
| Distribution diagnostics | Inspect data/model residuals as appropriate | Not a test-selection gate |
| Mann-Whitney U | Independent groups; distribution/rank contrast with stated interpretation | Not a generic test of medians |
| Wilcoxon signed-rank | Paired differences with appropriate symmetry/location assumptions | Not assumption-free |
| Kruskal-Wallis | Independent-group rank comparison | Does not handle repeated scenarios by itself |
| Proportion interval | Binary outcomes | Match assignment and dependence design |

---

## 17. Bundled Assets

This skill includes worked evaluation cases in `evals/evals.json`. Load when you're designing experiments for multi-agent systems: the file contains prompt-and-rubric test cases that exercise the decision trees above. Each case includes expected behaviors (what a good experiment design must include), so you can validate your work before running trials.

Use [diagrams/INDEX.md](diagrams/INDEX.md) for compact visual checks of evidence
classes and matched-budget evaluation. They support instrument validity and
comparison design; they do not substitute for an independent outcome oracle.


## Research-backed practice and diagrams

The design and evidence boundary is expanded in [evaluation-methods-and-scope](references/evaluation-methods-and-scope.md).


ACM SIGSOFT Empirical Standards and Ralph et al. emphasize design- and question-specific methods; they do not establish the fixed cutoffs formerly listed here. Use the paired-task recipe in `references/evaluation-validity.md`, and distinguish confirmatory contrasts from exploratory follow-up. The diagrams below are operational summaries, not empirical findings.

- [Matched experiment and causal measurement](diagrams/research-e01-matched-experiment-and-causal-measurement.md)
- [Choose analysis from design](diagrams/research-e02-choose-analysis-from-design-not-a-normality-gate.md)
- [Confirmatory and exploratory contrasts](diagrams/research-e03-confirmatory-contrasts-and-exploratory-follow-up.md)
- [Process and outcome metrics](diagrams/research-e04-keep-process-metrics-distinct-from-outcome-evidence.md)

Sources: [ACM SIGSOFT Empirical Standards](https://www2.sigsoft.org/EmpiricalStandards/); [Ralph et al., 2020](https://arxiv.org/abs/2010.03525); [Kitchenham, Madeyski, and Brereton, published online 2019](https://link.springer.com/article/10.1007/s10664-019-09747-0). They support disciplined, context-specific empirical reporting, not the removed universal numerical thresholds.
