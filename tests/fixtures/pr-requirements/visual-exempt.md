## Summary

Rename the internal `HealthProbe` type to `HealthSignal` across fleet-config-ui
and its callers. Mechanical rename only — no rendered output changes, so there
is nothing to screenshot.

## Test Plan

- `npm --prefix fleet-config-ui run typecheck` clean.
- `npm --prefix fleet-config-ui test` — 88 pass, unchanged snapshots prove the
  render is byte-identical.

<!-- visual-exempt: pure type rename, zero rendered-output change -->
