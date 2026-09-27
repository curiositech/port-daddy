# ML Trust & Safety Signal Detection

A generically-reusable Agent Skill for designing ML/classifier-based
automated signal detection on any UGC platform (forums, marketplaces,
social apps, dating apps, livestreams). Covers hash-matching vs. ML
classifier scoring, three-tier threshold routing (no-action / human-review
/ auto-action), behavioral/velocity/network signals, and the
score-vs-human-verdict feedback loop needed to keep thresholds calibrated.

## Structure

```
ml-trust-safety-signal-detection/
|-- SKILL.md                          # Core process, both flowcharts, anti-patterns
|-- CHANGELOG.md                      # Version history
|-- README.md                         # This file
`-- references/
    |-- classifier-architecture.md    # Hash+ML pipeline shape, CSAM reference architecture generalized
    |-- threshold-tuning.md           # Setting cutoffs, sizing the review band, recalibration cadence
    `-- behavioral-signals.md         # Velocity, network, engagement-anomaly signal definitions
```

## Relationship to Other Skills

- `moderation-triage-routing` owns the human side: review queues, case
  assignment, reviewer tooling. This skill's output (a flag + confidence +
  category) is that skill's input.
- `mlops-engineer` / `nlp-engineer` own training and architecting the
  underlying classifier model. This skill assumes a classifier/API already
  exists or is being integrated, and focuses on how its output is used.

## Quick Start

1. Read SKILL.md for the two-classifier-type pipeline and the mandatory
   three-tier threshold flowchart.
2. Pull `references/classifier-architecture.md` when designing the
   hash-match + ML-scoring pipeline itself.
3. Pull `references/threshold-tuning.md` when setting or re-tuning cutoff
   values, or building the feedback-loop recalibration cadence.
4. Pull `references/behavioral-signals.md` when adding velocity/network/
   engagement signals alongside content classifiers.
