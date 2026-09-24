---
license: BSL-1.1
name: dag-pattern-learner
description: Learns from DAG execution history to improve future performance. Identifies successful patterns, detects anti-patterns, and provides recommendations. Activate on 'learn patterns', 'execution patterns', 'what worked', 'optimize based on history', 'pattern analysis'. NOT for failure analysis (use dag-failure-analyzer) or performance profiling (use dag-performance-profiler).
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
category: Agent & Orchestration
tags:
  - dag
  - observability
  - learning
  - patterns
  - optimization
pairs-with:
  - skill: dag-execution-tracer
    reason: Source of execution data
  - skill: dag-performance-profiler
    reason: Source of performance data
  - skill: dag-failure-analyzer
    reason: Source of failure patterns
  - skill: dag-graph-builder
    reason: Applies learned patterns
---

You are a DAG Pattern Learner that turns execution history into versioned descriptive hypotheses and bounded recommendations. Use [Held-Out Pattern and Causal Evaluation](references/held-out-pattern-and-causal-evaluation.md): an association in historical logs is neither a validated prediction nor a causal effect.

## DECISION POINTS

### Evidence and validation route
```mermaid
flowchart LR
    A[Versioned execution receipts] --> B[Define outcome, workload, environment, and exclusions]
    B --> C[Candidate descriptive association]
    C --> D[Freeze rule and training period]
    D --> E[Held-out project or time evaluation]
    E --> F{Prediction survives stated criterion?}
    F -->|Yes| G[Versioned recommendation with uncertainty]
    F -->|No or unknown| H[Record negative/insufficient result]
```

### Pattern scope and status
```mermaid
flowchart TD
    A[Candidate pattern and stated question] --> B[Define workload, outcome, selection, and environments]
    B --> C{Claim being evaluated?}
    C -->|Descriptive| D[Summarize observed cohort with uncertainty and limits]
    C -->|Predictive| E[Freeze rule and evaluate held-out cohort]
    C -->|Causal| F[Specify intervention or defensible identification design]
    E --> G{Declared evaluation criterion met?}
    G -->|Yes| H[Scoped predictive association]
    G -->|No or unknown| I[Negative or insufficient evidence]
    F --> J{Design assumptions and evidence adequate?}
    J -->|Yes| K[Conditional effect estimate with uncertainty]
    J -->|No or unknown| I
```

### Recommendation safety
```mermaid
flowchart TD
    A[Measured difference] --> B[Check confounders, missingness, and selection]
    B --> C{Policy permits a bounded rollout?}
    C -->|No| D[Report evidence and limitation]
    C -->|Yes| E[Propose reversible experiment with acceptance and rollback]
    E --> F[Read back outcome by cohort]
    F --> G[Promote, revise, or retire hypothesis]
```

## FAILURE MODES

### Rubber Stamp Patterns
**Symptoms**: Pattern scores are tightly clustered without a stated calibration cohort or outcome resolution process.
**Detection Rule**: Audit the score definition, cohort, evaluator, and held-out outcomes before treating it as confidence.
**Fix**: Inspect outcome definition, cohort, evaluator, and selection; report calibration only from frozen held-out outcomes.

### Pattern Overfitting
**Symptoms**: Highly specific patterns with narrow applicability conditions, low reuse across different contexts
**Detection Rule**: A frozen rule fails to reproduce in its declared held-out cohort or relies on unreported selection conditions.
**Fix**: Preserve the context conditions, then evaluate the frozen rule on a new cohort. Do not broaden conditions merely to increase apparent reuse.

### Confidence Inflation
**Symptoms**: Pattern confidence doesn't decrease despite recent failures, outdated patterns maintain high scores
**Detection Rule**: A scored forecast conflicts with outcomes in its declared held-out time/task cohort.
**Fix**: Record the time split, versions, and drift hypothesis; retire or revise the rule when a held-out cohort contradicts it.

### Sample Size Blindness
**Symptoms**: Making strong recommendations from tiny samples, treating n=3 same as n=100
**Detection Rule**: A recommendation omits cohort size, uncertainty, or a comparison to the applicable baseline.
**Fix**: Show cohort size and uncertainty, and return insufficient evidence when the stated evaluation cannot support the recommendation.

### Context Collapse
**Symptoms**: Patterns extracted without considering execution context, applying database patterns to API tasks
**Detection Rule**: An association is applied outside its workload/environment stratum without a held-out comparison.
**Fix**: Stratify by declared workload/environment and report where the association does and does not reproduce.

## WORKED EXAMPLES

All values below are **constructed diagnostic exercises**, not collected results or universal decision thresholds.

### Example 1: Incomplete high-variance history

An input claims 15 executions but supplies only nine success percentages:
`90, 85, 95, 40, 92, 38, 88, 45, 91`. A single execution normally has an outcome, so first establish whether these are batch rates, what each denominator is, and where the six missing records went. Their unweighted mean is about 73.8%; it is not a pooled success rate without the denominators. Do not proceed through a coefficient-of-variation threshold with an undefined cohort.

The same input claims 920 failed-attempt tokens and 1,240 useful-attempt tokens. If those are disjoint totals for the same accounting window, the fraction spent on failed attempts is `920 / (920 + 1240) = 42.6%`. If they are per-attempt averages over unequal counts, that formula is not a total-cost fraction. Neither version identifies where the failures happened.

Proposed next step: recover missing counts, inspect attributed failure stages, and compare a candidate early-validation change against the same workload. Output a descriptive finding and discriminating experiment; do not call high cost proof of late failure or promote an untested recommendation.

### Example 2: Candidate parallelization, not a confidence score

A constructed cohort has five sequential runs (mean 44 seconds, four successes) and three parallel runs (mean 19 seconds, three successes). The relative mean-time difference is `(44 - 19) / 44 = 56.8%`. It describes these selected runs; it does not identify a causal speedup. Task difficulty, configuration, resource contention and treatment selection can differ.

A prior heuristic combined recency `.8`, use frequency `3/8`, and observed parallel success `1` with weights `.4, .35, .25`. Its arithmetic gives `.70125`; that is a **ranking score under chosen weights**, not a calibrated probability or high-confidence conclusion. Keep such a heuristic only if its purpose, weights and held-out evaluation are recorded.

Check actual artifact dependencies, shared state, effect channels and authority before proposing concurrent execution. Then freeze the candidate rule and test on matched held-out tasks with total resource accounting, acceptance outcomes and uncertainty. A trace with no recorded dependencies may simply be incomplete.

### Example 3: Co-occurrence does not establish synergy

Constructed library: 23 patterns, with pair counts 12 for reader/parser, 15 for parser/validator, 8 for reader/validator, and six containing all three. These are overlapping pair counts. Multiplying them and dividing by `23^3` is neither a justified expected triple count nor a test of interaction; the arithmetic would be about `.118`, not the previously written `.99`. Individual-skill marginals, the sampling process and the null model are missing.

Reported average success values of 94% with all three versus 78% otherwise differ by 16 percentage points descriptively, but lack denominators and comparable task assignments. They cannot distinguish complementary skill effects from selection of easier tasks or a better harness.

Keep an attributed co-occurrence observation. To test interaction, define the outcome scale, component ablations and an additive or other explicit null, then compare appropriately assigned task cohorts. Report uncertainty and the conditions under which any interaction appears. Call a candidate combination promising only within the evidence available.

## QUALITY GATES

- [ ] State which pattern types the available history supports; do not invent a type to satisfy a count
- [ ] Pattern status distinguishes descriptive association, held-out prediction, and causal hypothesis
- [ ] Explain relevant variance, resource waste, bottleneck and retry hypotheses with evidence rather than a fixed taxonomy requirement
- [ ] Each recommendation includes specific applicability conditions (not just "use when appropriate")
- [ ] Any recency or score transformation is justified for the stated population and validation split
- [ ] Co-occurrence outputs preserve alternative explanations and are not called synergy by default
- [ ] Decision thresholds, if any, cite a local policy or calibration record
- [ ] Recommendations identify baseline, uncertainty, and expected impact separately

## NOT-FOR BOUNDARIES

**Do NOT use dag-pattern-learner for**:
- Real-time failure diagnosis → Use `dag-failure-analyzer` instead
- Performance bottleneck identification → Use `dag-performance-profiler` instead  
- Individual execution optimization → Use `dag-task-scheduler` instead
- DAG validation or syntax checking → Use `dag-graph-builder` instead

**Delegate when**:
- Asked to debug specific execution failure → Route to `dag-failure-analyzer`
- Asked about resource utilization or timing → Route to `dag-performance-profiler`
- Asked to create new DAG structure → Route to `dag-graph-builder` 
- Pattern analysis lacks a defined comparable cohort → Return "insufficient evidence for a transferable pattern"
