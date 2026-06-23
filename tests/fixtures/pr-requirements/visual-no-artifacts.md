## Summary

Restyle the Fleet Control Center health pane so the degraded state reads as
amber instead of the old muted grey, which operators kept missing during
incidents. Pure presentation change; no behavior change to the health probe.

## Test Plan

- `npm --prefix fleet-config-ui test` — 88 pass, including the updated
  health-pane snapshot.
- `npm --prefix fleet-config-ui run build` succeeds.
- Loaded the Control Center locally and clicked through nominal / degraded /
  down to confirm the amber only shows on degraded.
