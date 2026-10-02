# Moderation Triage Routing

Designs the human side of content moderation operations: severity-tiered
report queues, automatic reviewer context assembly, isolation of child-safety
and imminent-harm content into a restricted queue, admin-tool selection for
small/solo teams, and the operational metrics that keep a moderation program
defensible. Generic across any UGC platform — not tied to a specific product,
content vertical, or classifier implementation.

## Structure

```
moderation-triage-routing/
├── SKILL.md                          # Core process, decision tree, anti-patterns (<500 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
└── references/
    ├── queue-architecture.md         # Severity tiers, Tier 0 isolation mechanics
    ├── tooling-comparison.md         # Directus vs Retool vs Refine vs self-built
    ├── report-triage-context.md      # Auto-assembling reviewer context + templated responses
    └── metrics-and-audit.md          # Turnaround/false-positive/time-per-report + audit export
```

## Quick Start

1. Read SKILL.md for the intake → severity triage → queue routing → action →
   audit-log pipeline and the two core anti-patterns.
2. Pull the relevant reference file for the specific decision you're facing
   (queue design, tooling choice, context assembly, or metrics).
3. This skill assumes flags/reports already exist — pair it with
   `ml-trust-safety-signal-detection` if you also need the automated
   classifiers that produce those flags.
