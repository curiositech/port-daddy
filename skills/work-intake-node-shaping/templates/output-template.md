# Work Intake Decision Template

Fill in every section before materializing an Agent Node. Validate the underlying claims with
`node scripts/node_shaping_audit.mjs --input <this-decision-as-json>.json` before treating the
archetype call as final.

```markdown
## WorkIntent

- id: `<stable-work-intent-id>`
- Operator ask (one line): <what the operator actually asked for>

## Signal Vector

| Signal | Value | Why |
| --- | --- | --- |
| coupling | `low` / `medium` / `high` | <one line> |
| contextPressure | `low` / `medium` / `high` | <one line> |
| skillBoundary | `single` / `few` / `many` | <one line> |
| reviewIndependence | `shared` / `independent` | <one line> |
| budget | `small` / `medium` / `large` | <one line> |
| operatorBurden | `low` / `medium` / `high` | <one line> |

## Archetype Decision

Selected archetype (exactly one): `node` / `scout` / `chain` / `dag-workgroup` / `tournament` /
`ambient-watcher` / `human-gate`

- Why this one and not the nearest runner-up: <one paragraph, citing references/seven-archetypes.md
  disambiguation heuristics>

## Legacy Route Audit

| Verb reachable from this entrypoint | Writes independent state? | Evidence |
| --- | --- | --- |
| `spawn` / `dispatch` / `sortie` / `conjure` / `nightshift` / (none) | `false` (must be proven, not assumed) | <call-site trace or "no legacy verb in this path"> |
```

## Checklist before materializing the Agent Node

- [ ] `selectedArchetypes` has exactly one entry, drawn from the canonical seven.
- [ ] Every legacy route's `writesIndependentState` is traced to the actual call site, not assumed.
- [ ] No legacy route independently opens a session id, transcript stream, or Agent Node outside the shared WorkPlan pipeline.
- [ ] `node scripts/node_shaping_audit.mjs --input <decision>.json` returns `pass: true`.
