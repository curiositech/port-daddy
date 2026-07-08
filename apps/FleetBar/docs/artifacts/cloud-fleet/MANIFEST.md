# FleetBar Cloud Fleet Visual Proof

Rendered offscreen on July 8, 2026 with `NSHostingView`, using deterministic
Cloud Fleet telemetry fixture data and one local FleetBar project. The proof
targets the native `CloudFleetSection`, not an adjacent web surface.

## Artifacts

- `fleetbar-cloud-fleet.png` - native FleetBar Cloud Fleet section showing local
  daemon state beside remote Cloud Fleet telemetry.
- `fleetbar-cloud-fleet.gif` - motion companion generated from the rendered
  native snapshot for the PR visual-artifact gate.

## Command

```sh
FLEETBAR_CLOUD_FLEET_SNAPSHOT_OUT=$PWD/apps/FleetBar/docs/artifacts/cloud-fleet/fleetbar-cloud-fleet.png \
swift test --package-path apps/FleetBar --filter CloudFleetSectionSnapshotTests

magick -delay 80 -loop 0 \
  apps/FleetBar/docs/artifacts/cloud-fleet/fleetbar-cloud-fleet.png \
  apps/FleetBar/docs/artifacts/cloud-fleet/fleetbar-cloud-fleet.png \
  apps/FleetBar/docs/artifacts/cloud-fleet/fleetbar-cloud-fleet.gif
```
