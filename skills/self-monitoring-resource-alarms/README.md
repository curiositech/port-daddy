# Self-Monitoring Resource Alarms

A skill for making a service watch its OWN resource footprint (its data-store
bytes, WAL bytes, per-table row counts, and growth rate) and raise graduated,
dedup-governed warn/crit alarms *before* a runaway fills the disk — instead of
discovering it when the volume is already full.

Born from a real incident: a daemon wrote **313 GB with zero alarm** because its
resource view was pull-only (computed only when a human opened a panel) and
measured the wrong subject (whole-disk percent, not its own store).

## Structure

```
self-monitoring-resource-alarms/
├── SKILL.md                          # Core process, anti-patterns, diagrams (<500 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
├── references/
│   ├── reference-implementation.md   # Copy-paste LogGovernor + SelfMonitor + wiring
│   └── threshold-tuning.md           # Baselining, growth rate, two horizons, testing
└── scripts/
    └── audit_self_monitoring.py      # Structured code-symbol scan for the four gaps
```

## Quick Start

1. Audit a service: `python3 scripts/audit_self_monitoring.py path/to/service`
2. Read SKILL.md for the six-step process and the four anti-patterns.
3. Implement using `references/reference-implementation.md`.

The audit exits non-zero on any HIGH-severity gap, so it drops into CI.
