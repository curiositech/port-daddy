# Squid stale-probe recovery visual proof

These deterministic FleetBar artifacts show the operator-visible transition repaired by this branch:

- `05-hook-recovery-active.png` — one bounded recovery probe is genuinely active, with its start and expected-finish timestamps visible.
- `06-hook-recovery-ready.png` — the marker has expired, no probe is running, and FleetBar truthfully reports that recovery is ready.
- `hook-recovery.gif` — the same two states as a 0.9-second-per-frame loop.

The fixture contains sanitized synthetic timing only. It does not contain an operator transcript, tool input, tool output, prompt, environment snapshot, stdout, or stderr.

## Reproduce

From `apps/FleetBar` at commit `f1e2e87e9`:

```sh
FLEETBAR_SQUID_SNAPSHOT_DIR="$PWD/../../docs/pr-assets/squid-stale-probe-recovery" \
  swift test \
  --filter SquidHarnessSnapshotTests/testRenderBoundedProbeExpiryAndRecoveryProofWhenRequested \
  --jobs 1
```

The focused test rendered one SwiftUI sheet per state, asserted the decoded circuit/probe state, wrote both PNGs, and assembled the GIF. Result: 1 test passed, 0 failures.

## Integrity

```text
706f70cf10741afeaed57cb24ed0c014a44d70623c1a7ee4c8e7e97608c90825  05-hook-recovery-active.png
a851f1679954f4e296898b56c6c44bf58cd0a38c77763328d9f6e0ab0b5a24ce  06-hook-recovery-ready.png
1c69e8d5c4b38c433084d7d04779524e57749d99a8542a0a9e5d543e79b532f9  hook-recovery.gif
```
