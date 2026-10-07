# Bonded Commons Crash Recovery Experiment

Use this worked example when you need a comparative study design for crash recovery or salvage behavior. **Illustrative design, not run:** all counts and descriptive values are constructed placeholders; the analysis plan must be finalized for the actual assignment and data.

## Research Question

"Does the Bonded Commons salvage protocol recover agent work faster and with higher fidelity than round-robin reassignment after random agent crashes?"

## Experimental Setup

- System under test: Bonded Commons with salvage, session notes, and file claims
- Candidate baseline: round-robin reassignment with full task description but no session context; assess relevance and tuning for the target task.
- Additional simple comparator: random reassignment with no context transfer; do not use it alone to claim broad superiority.

## Variables

| Variable | Type | Values |
|---|---|---|
| Coordination protocol | Independent | Bonded Commons, Round-Robin, Random |
| Crash schedule | Exogenous common input | Prespecified schedule shared across matched conditions |
| Number of agents | Fixed | 8 |
| Scenarios | Fixed | 20 human-designed coordination tasks |
| Salvage latency (ms) | Dependent, automated | Time from crash to first valid output |
| Recovery fidelity (1-5) | Dependent, human-rated | Quality of recovered work vs pre-crash |
| Task completion rate | Dependent, automated | Proportion of tasks completed successfully |

## Scenario Design

- 5 simple scenarios: single-file edit, clear specification
- 10 moderate scenarios: multi-file change with some ambiguity
- 5 complex scenarios: cross-system coordination with architectural decisions

Each scenario needs an independent task-specific correctness oracle. Where no gold output exists, define the rubric and adjudication evidence; do not present rater preference as ground truth.

## Crash Injection Protocol

For each scenario x protocol combination:

1. Start 8 agents on the task.
2. Apply the prespecified common crash schedule to the designated eligible role with `SIGKILL`. Define any progress reference externally; using each treatment's own completion percentage changes the intervention. Record absent roles and unequal exposure.
3. Measure time until the system detects the crash and reassigns work.
4. Measure time until the replacement agent produces first valid output.
5. Let the system run to completion or 10-minute timeout.
6. Collect the final output for human evaluation.

## Sample Size Justification

- 20 scenarios x 3 protocols = 60 scenario-condition cells, not automatically 60 independent experimental units
- 5 repetitions per scenario-protocol pair = 300 total runs, 100 per condition
- The proposed 20 scenarios and repeated crash runs form clustered observations; do not count 100 runs as 100 independent scenarios.
- Plan precision/power for the intended estimand using scenario, run, and rater dependence. The proposed counts are placeholders, not validated adequacy.

## Human Evaluation Setup

- 3 raters with multi-agent systems experience
- Blinded condition labels (`Output A/B/C`)
- Five repetitions yield 300 outputs before failures/missingness. Prespecify all-output rating or a balanced subset and budget workload; retain repetition and rater identities.
- Rubric: the 1-5 fidelity scale from the main skill
- Pilot calibration on 5 practice outputs before the full run
- Inspect disagreement and use a scale-appropriate agreement summary; preregister any decision rule from the use case. No universal kappa cutoff is established here.

## Analysis Plan

Prespecify the primary outcome family and contrasts. Choose a multiplicity strategy from the intended claims, and select an analysis that represents scenario pairing/clustering, repeated runs, outcome scale, and rater effects. Do not treat an omnibus test as a universal gate to planned contrasts. The exact model or randomization procedure depends on the assignment design and should be justified before outcome inspection.

Secondary metrics, exploratory:

3. Task completion rate: report matched denominators and select an analysis representing scenario/repetition dependence
4. Latency by difficulty stratum: descriptive only

For all comparisons:

- report an interval suited to the experimental unit and dependence; document assumptions and assess Monte Carlo error if bootstrapping
- report an effect measure matched to the estimand and outcome scale
- report effect-measure uncertainty when the design supports it

## Synthetic Reporting Shape (not results)

Use the [main skill's reporting template](../SKILL.md#14i-synthetic-reporting-example-not-observed-results). It contains clearly marked descriptive placeholders and fields for actual matched contrasts, uncertainty, exclusions and rater disagreement. Do not invent p-values or claim interval coverage without the underlying data and valid analysis.

## Threats to Validity

- Internal: the declared crash schedule and eligible roles bound exposure; treatment-dependent progress or absent roles can confound the comparison
- External: 8 agents on one machine does not imply 50+ agents in distributed deployment
- Construct: recovery fidelity is a proxy for user satisfaction, not a perfect substitute
- Statistical: 20 curated scenarios may not represent the full production task distribution
