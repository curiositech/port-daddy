# Agent Control Command Contract

Audit whether operator control verbs over live agent bodies — steer, interrupt, pause, kill, checkpoint, fork — are each modeled as a distinct claim with a real delivery lifecycle, and whether command authorization reads authoritative state instead of a stale projection.

Use this skill when designing or reviewing a control panel's command contract, a daemon's `control_commands` schema, or a backend adapter's verb-support matrix before any control renders as clickable.

## Quick Start

1. Read `SKILL.md` for the enumerate-verbs → assign-states → build-matrix → declare-authorization → audit process and the three anti-patterns.
2. Skim `references/verb-state-machine.md` before naming a verb or its terminal states — decide whether it's really a distinct claim.
3. Skim `references/authorization-sources.md` before wiring any control's authorization check.
4. Fill in `templates/output-template.md` for the actual verb/backend/authorization contract.
5. Build a spec matching `schemas/control-contract.schema.json` and audit it:

```bash
node scripts/control_contract_audit.mjs --input <your-contract>.json
```

6. Compare against `examples/expected-output.md` to see a weak contract audited, then the same contract fixed and passing.
