# Shipwright Component Shots

These PNGs are browser-captured review artifacts for the current Shipwright
Fleet Control Center surfaces. They satisfy the screenshot artifact expectation
in `docs/shipwright/COMPONENT-BRIEF.md` while the component suite is still
landing inside `fleet-config-ui`.

## Captured Views

| File | Route state | Primary surface |
| --- | --- | --- |
| `shipwright-harbor.png` | `surface=shipwright&shipwright=harbor` | Harbor survey and project cards |
| `shipwright-focus.png` | `surface=shipwright&shipwright=focus` | Focus proposal evidence and budget envelope |
| `shipwright-simulation.png` | `surface=shipwright&shipwright=simulation` | Simulation timeline and file-write preview |
| `shipwright-control.png` | `surface=shipwright&shipwright=control` | FleetControl dry-run verdict and launch controls |

Each image is captured at `1280x900` from the Vite-served Fleet UI route:

```text
/fleet-ui/?surface=shipwright&shipwright=<view>
```

## Refresh Notes

1. Start the Fleet Config UI dev server from `fleet-config-ui/`.
2. Use Playwright to visit each Shipwright route and wait for the surface's
   unique heading before taking the screenshot.
3. Keep screenshots scoped to this directory so generated `public/fleet-ui`
   build output does not become part of the docs artifact slice.
