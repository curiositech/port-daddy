# pd-console Sextant UI Proof

Fresh live proof for the operator-facing Galaxy-to-Sextant UI rename.

- Captured from the feature `pd-console` window after real control-socket interactions.
- Bound to daemon `http://127.0.0.1:3164`, where `/galaxy/map` returned populated map data.
- Stable/dev daemons on `9876` and `9886` lacked `/galaxy/map`, so these artifacts intentionally prove the branch daemon/window rather than the stable FleetBar berth.
- `sextant-live-window-controls.gif` and `.mp4` are assembled from the four live screenshots after the real control-socket interactions. Continuous ScreenCaptureKit recording failed in the detached context with `CGS_REQUIRE_INIT`.

Artifacts:

- `sextant-live-24h.png`
- `sextant-live-72h.png`
- `sextant-live-7d.png`
- `sextant-live-30d.png`
- `sextant-live-window-controls.gif`
- `sextant-live-window-controls.mp4`
- `state-sextant-initial.json`
- `state-sextant-final.json`
