# Work Intake Node Shaping

Route one operator WorkIntent to exactly one topology archetype (node, scout, chain,
dag-workgroup, tournament, ambient-watcher, human-gate), and audit that legacy launch verbs
(`spawn`/`dispatch`/`sortie`/`conjure`/`nightshift`) stay compatibility metadata instead of
writing independent Agent Node/session/transcript state.

Use this skill when routing a new WorkIntent to a topology before any Agent Node is
materialized, or when auditing/reviewing whether a launch path secretly opens parallel
governance state.

## Quick Start

1. Read `SKILL.md` for the score-map-commit-trace-audit process and the three anti-patterns.
2. Skim `references/seven-archetypes.md` before mapping a signal vector to an archetype.
3. Skim `references/legacy-verb-compatibility.md` before tracing a `spawn`/`dispatch`/`sortie`/`conjure`/`nightshift` route.
4. Fill in `templates/output-template.md` for the actual decision (signal vector + archetype + legacy route audit).
5. Build a work-intake spec JSON matching `schemas/work-intake-spec.schema.json` and audit it:

```bash
node scripts/node_shaping_audit.mjs --input <your-work-intake-spec>.json
```

6. Compare against `examples/expected-output.md` to see a bad intake audited, then the same intake fixed and passing.
