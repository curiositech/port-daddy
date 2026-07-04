# Control Command Contract Template

Fill in every section before wiring a verb to a clickable operator control. Validate the underlying spec with `node scripts/control_contract_audit.mjs --input <this-contract-as-json>.json` before it counts as done.

```markdown
## Verb Set

| Verb | Terminal states | Notes |
| --- | --- | --- |
| steer | queued, delivered, acknowledged, failed, expired, unsupported | |
| interrupt | queued, delivered, acknowledged, failed, expired, unsupported | |
| pause | queued, delivered, acknowledged, failed, expired, unsupported | |
| kill | queued, delivered, acknowledged, failed, expired, unsupported | |
| checkpoint | queued, delivered, acknowledged, failed, expired, unsupported | |
| fork | queued, delivered, acknowledged, failed, expired, unsupported | |

<!-- Every row must be its own claim. Do not add a generic "control" or "stop" row. -->

## Backend Support Matrix

| Backend | Supports | Does not support (must render "unsupported", not hidden) |
| --- | --- | --- |
| <backend name> | <verb, verb, ...> | <verb, verb, ...> |

## Authorization Source

- `authorizationSource`: <authoritative-lease | authoritative-event>  <!-- never cached-projection or ui-state -->
- Where the command handler re-resolves the target before delivery: <lease table / event log location>
- Proof the projection used for display is NOT the same read path as authorization: <one line + code pointer>

## Matrix Proof

- <For every verb x backend cell: how hasDistinctTerminalStates was proven (probe, adapter test, or explicit unsupported declaration) — not assumed.>
```

## Checklist before wiring a control to the UI

- [ ] `interrupt`, `pause`, `kill`, and `steer` each appear as their own verb entry — no generic "control"/"stop" claim.
- [ ] Every verb's `terminalStates` includes `delivered`, `acknowledged`, `failed`, and `expired`.
- [ ] Every verb a backend cannot perform has `unsupported` in that verb's `terminalStates` AND a matrix cell proving it.
- [ ] `authorizationSource` is `authoritative-lease` or `authoritative-event` — never `cached-projection` or `ui-state`.
- [ ] Every verb x backend combination has a matrix cell (an absent cell is a gap, not a pass).
- [ ] `node scripts/control_contract_audit.mjs --input <spec>.json` returns `pass: true`.
