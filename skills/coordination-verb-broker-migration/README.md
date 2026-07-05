# Coordination Verb Broker Migration

Audit whether an enforced-coordination MCP has actually shrunk its ~19 legacy etiquette verbs into the 5 enforced tools — `work`/`act`/`ask`/`recall`/`status` — each carrying one denial shape and one transcript event, migrated through a real retirement path, with zero legacy-verb calls once a body is at compliance mode C4+.

Use this skill when reviewing a broker-collapse migration plan, gating a body's move from advisory (`C0`-`C3`) to enforced (`C4`+) coordination, or verifying IT-018 Broker Collapse compliance.

## Quick Start

1. Read `SKILL.md` for the mapping-migration-surface-gate process and the three anti-patterns.
2. Skim `references/verb-collapse-migration-paths.md` before building or reviewing the legacy-verb-to-tool mapping.
3. Skim `references/compliance-mode-gate-ladder.md` before gating a body's compliance-mode claim.
4. Fill in `templates/output-template.md` for the actual migration gap report.
5. Build a broker-migration-spec JSON matching `schemas/broker-migration-spec.schema.json` and audit it:

```bash
node scripts/broker_migration_audit.mjs --input <your-migration-spec>.json
```

6. Compare against `examples/expected-output.md` to see a bad migration audited, then the same migration fixed and passing.
