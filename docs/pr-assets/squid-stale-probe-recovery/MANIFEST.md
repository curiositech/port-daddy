# Squid stale-probe recovery visual proof

These deterministic FleetBar artifacts show the operator-visible transition repaired by this branch:

- `05-hook-recovery-active.png` — one bounded recovery probe is genuinely active, with its start and expected-finish timestamps visible.
- `06-hook-recovery-ready.png` — the marker has expired, no probe is running, and FleetBar truthfully reports that recovery is ready.
- `squid-hook-recovery.cast` — a native Porthole asciicast of the real focused Swift test and the resulting artifact hashes. It is 100×28, contains 395 replay events, and runs for 17.428 seconds.

The FleetBar fixture contains sanitized synthetic timing only. The cast contains the literal test command, its unfiltered test output, and the two PNG hashes; it contains no operator transcript, prompt, environment snapshot, hook stdout, or hook stderr. This proves the deterministic FleetBar decoder, assertions, and renderer. It does not claim a live production hook invocation or an operator click.

## Reproduce

From the repository root:

```sh
FLEETBAR_SQUID_SNAPSHOT_DIR="$PWD/docs/pr-assets/squid-stale-probe-recovery" \
  swift test --package-path apps/FleetBar \
  --filter SquidHarnessSnapshotTests/testRenderBoundedProbeExpiryAndRecoveryProofWhenRequested \
  --jobs 1
```

The focused test rendered one SwiftUI sheet per state, asserted the decoded circuit/probe state, and wrote both PNGs. The recorded run passed 1 test with 0 failures in 0.220 seconds. The cast was recorded with `website-v2/scripts/record-porthole-cast.sh`, then replay-parsed with the repository's `Porthole` parser; its final frame contains both PNG hashes.

## Integrity

```text
44033cbd525bff2c6c0036b0d0e7ce35c91eae09c70dcdf1c4dc46ea3b9a9252  05-hook-recovery-active.png
5170792a438092e99382346d24151f55e171bbcf02d7850e7945fc5956bcf480  06-hook-recovery-ready.png
36719cdd3adbe83ab5bf83c7850ab688f5c887aa6e490c8e505e4c9f8bd18196  squid-hook-recovery.cast
```
