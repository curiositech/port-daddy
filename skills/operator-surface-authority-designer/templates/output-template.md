# Operator Surface Authority Decision

Fill in one row per capability before assigning it to a surface. Validate the result with `node scripts/surface_authority_audit.mjs --input <this-as-json>.json` before calling the placement final.

```markdown
## Capability Authority Table

| Capability | Distance | Surface | Evidence screens | Daemon-enforceable? | Bus |
| --- | --- | --- | --- | --- | --- |
| <name> | intake / ambient / deep | scout / fleetbar / pd-console | <n> | yes / no | hot / cool |

## Runtime State

- surfacesOwnRuntimeState: <true/false — must be false. If any surface caches state it treats as authoritative, name it here and move it into the daemon before shipping.>

## Rationale (one line per capability that isn't obviously placed)

- <capability>: <why this distance, and why this surface follows from it>
```

## Checklist before calling placement final

- [ ] Every capability has exactly one `assignedSurface`, and it matches the canonical mapping for its `distance` (`intake` → scout, `ambient` → fleetbar, `deep` → pd-console).
- [ ] No capability needing `evidenceScreens > 1` is assigned to FleetBar — it is on pd-console with a FleetBar deep link instead.
- [ ] Every rendered control has `daemonEnforceable: true` — if the daemon can't back it yet, the control does not ship yet either (acceptance criterion 6).
- [ ] Every `intake`/`deep` capability subscribes to the `cool` bus; `ambient` capabilities may legitimately mix `hot` and `cool`.
- [ ] `surfacesOwnRuntimeState` is `false` — no surface treats a local cache as authoritative.
- [ ] `node scripts/surface_authority_audit.mjs --input <spec>.json` returns `pass: true`.
