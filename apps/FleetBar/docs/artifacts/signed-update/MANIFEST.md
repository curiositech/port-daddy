# FleetBar Signed Update Visual Proof

Rendered from the native SwiftUI `FleetBarUpdateCard` on August 29, 2026. The
fixture fixes the app at 3.30.4 and the daemon at 3.30.5 so the exact operator
remediation remains reproducible after both products move forward.

## Artifacts

- `01-ready.png` — the in-product update action before any mutation.
- `02-verifying.png` — bounded progress while checksum and Developer ID gates run.
- `03-failed.png` — a notarization rejection stays visible and states that
  nothing was installed.
- `fleetbar-signed-update.gif` — motion companion cycling through the three
  authored native states for the PR visual-artifact gate.

## Commands

```sh
FLEETBAR_UPDATE_SNAPSHOT_DIR=$PWD/apps/FleetBar/docs/artifacts/signed-update \
  swift test --package-path apps/FleetBar \
    --filter FleetBarUpdaterTests.testRenderSignedUpdateStatesWhenRequested

ffmpeg -y -loop 1 -t 1 -i apps/FleetBar/docs/artifacts/signed-update/01-ready.png \
  -loop 1 -t 1 -i apps/FleetBar/docs/artifacts/signed-update/02-verifying.png \
  -loop 1 -t 1 -i apps/FleetBar/docs/artifacts/signed-update/03-failed.png \
  -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 apps/FleetBar/docs/artifacts/signed-update/fleetbar-signed-update.gif
```
