# FleetBar Fleet Proposals Visual Proof

Rendered offscreen on July 3, 2026 with `NSHostingView`, not by capturing the
operator's primary display. The fixture source was the throwaway feature daemon at
`http://127.0.0.1:9919` with two pending Spark/Spider proposal packets.

## Artifacts

- `fleetbar-proposals.png` — native FleetBar Proposals section with pending
  packet detail and `Yes, Assign` / `No` controls.

## Command

```sh
FLEETBAR_PROPOSAL_SNAPSHOT_BASE_URL=http://127.0.0.1:9919 \
FLEETBAR_PROPOSAL_SNAPSHOT_OUT=$PWD/apps/FleetBar/docs/artifacts/fleet-proposals/fleetbar-proposals.png \
swift test --package-path apps/FleetBar --filter FleetProposalSectionSnapshotTests
```
