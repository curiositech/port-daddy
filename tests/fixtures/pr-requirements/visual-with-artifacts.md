## Summary

Restyle the Fleet Control Center health pane so the degraded state reads as
amber instead of the old muted grey, which operators kept missing during
incidents. Pure presentation change; no behavior change to the health probe.

## Test Plan

- `npm --prefix fleet-config-ui test` — 88 pass, including the updated snapshot.
- `npm --prefix fleet-config-ui run build` succeeds.

## Visual Proof

Light + dark screenshots and a tour GIF of the degraded state:

![degraded pane light](https://raw.githubusercontent.com/curiositech/port-daddy/abc123/fleet-config-ui/docs/health-degraded-light.png)
![degraded pane dark](https://raw.githubusercontent.com/curiositech/port-daddy/abc123/fleet-config-ui/docs/health-degraded-dark.png)

Tour: https://raw.githubusercontent.com/curiositech/port-daddy/abc123/fleet-config-ui/docs/health-tour.gif
