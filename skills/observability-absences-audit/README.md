# Observability Absences Audit

An audit skill that hunts for observability **absences** — the events a service or
daemon *should* log, audit, or alarm on but doesn't — across six categories: security
audit trail, coordination integrity, resource self-monitoring, failure visibility,
request/actor/tenant correlation, and ephemeral-vs-durable plane routing. Complements
the how-to-log skills (`logging-observability`, `structured-logging-design`) by
finding the silence rather than authoring the log lines.

## Structure

```
observability-absences-audit/
├── SKILL.md                          # Core process, checklist, anti-patterns (<500 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
└── references/
    ├── absence-catalog.md            # Six categories: grep patterns, questions, fix shapes
    └── event-plane-routing.md        # Ephemeral log plane vs durable queryable audit plane
```

Read-only skill (`allowed-tools: Read,Grep,Glob`) — it produces an absence report,
not a code diff. The full bundle inventory that matters at runtime lives in SKILL.md.

## Quick Start

1. Review SKILL.md for the audit method, the two-horizon scoring, and the checklist
2. Consult `references/absence-catalog.md` while grepping the target codebase
3. Validate with the skill-architect tooling:
   `python ~/.claude/skills/skill-architect/scripts/validate_skill.py .`
