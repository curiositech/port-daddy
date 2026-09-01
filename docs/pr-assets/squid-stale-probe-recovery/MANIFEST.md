# Squid stale-probe recovery visual proof

These deterministic FleetBar artifacts show the operator-visible transition repaired by this branch:

- `05-hook-recovery-active.png` — one bounded recovery probe is genuinely active, with its start and expected-finish timestamps visible.
- `06-hook-recovery-ready.png` — the marker has expired, no probe is running, and FleetBar truthfully reports that recovery is ready.
- `squid-hook-recovery.cast` — a native Porthole asciicast of the real focused Swift test and the resulting artifact hashes. It is 100×28, contains 395 replay events, and runs for 17.428 seconds.
- `squid-hook-recovery.webm` — that exact cast replayed at 2× through Port Daddy's real Porthole browser player. The VP8 recording is 1440×1040 at 25 fps, runs for 12.4 seconds, and is 1,171,380 bytes.
- `capture-porthole-webm.mjs` — the replay/capture program. It injects the checked-in cast into the checked-in self-contained Porthole gallery, serves it on an ephemeral loopback port, records with Playwright, and removes its temporary video directory.

The FleetBar fixture contains sanitized synthetic timing only. The cast and WebM contain the literal test command, its unfiltered test output, and the two PNG hashes; they contain no operator transcript, prompt, environment snapshot, hook stdout, or hook stderr. This proves the deterministic FleetBar decoder, assertions, renderer, and Porthole replay. It does not claim a live production hook invocation or an operator click.

## Reproduce

From the repository root:

```sh
FLEETBAR_SQUID_SNAPSHOT_DIR="$PWD/docs/pr-assets/squid-stale-probe-recovery" \
  swift test --package-path apps/FleetBar \
  --filter SquidHarnessSnapshotTests/testRenderBoundedProbeExpiryAndRecoveryProofWhenRequested \
  --jobs 1
```

The focused test rendered one SwiftUI sheet per state, asserted the decoded circuit/probe state, and wrote both PNGs. The recorded run passed 1 test with 0 failures in 0.220 seconds. The cast was recorded with `website-v2/scripts/record-porthole-cast.sh`, then replay-parsed with the repository's `Porthole` parser; its final frame contains both PNG hashes.

Recreate the browser recording from the checked-in cast:

```sh
/opt/homebrew/opt/node@22/bin/node \
  docs/pr-assets/squid-stale-probe-recovery/capture-porthole-webm.mjs
```

The capture script uses the same `PortholePlayer`, self-contained gallery, Playwright video context, and `~/coding/tmp` scratch convention as `website-v2/scripts/capture-harness-transcript-gallery.mjs`.

## Integrity

```text
44033cbd525bff2c6c0036b0d0e7ce35c91eae09c70dcdf1c4dc46ea3b9a9252  05-hook-recovery-active.png
5170792a438092e99382346d24151f55e171bbcf02d7850e7945fc5956bcf480  06-hook-recovery-ready.png
36719cdd3adbe83ab5bf83c7850ab688f5c887aa6e490c8e505e4c9f8bd18196  squid-hook-recovery.cast
72de8b23e667aff8b13a47ea7e34a64e51ca89d10220d54798559210b060191b  squid-hook-recovery.webm
94de3424753c4acd8d1f4a691754867c6a49fd03fb3015c8620a94ce8011b302  capture-porthole-webm.mjs
```
