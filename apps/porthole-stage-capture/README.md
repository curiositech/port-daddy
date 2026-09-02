# Porthole Stage for macOS

This package is the native Stage prototype for one operator-approved macOS
window or app. It combines ScreenCaptureKit capture, an explicit source
allowlist, visible local/agent presence, cooperative pointers and comments, and
a synthetic fixture that is safe to use when collecting product proof.

It is not yet a distributed Porthole release. Pull-request CI emits a short-lived,
ad-hoc-signed artifact whose name and embedded manifest both say
`NOT-FOR-DISTRIBUTION`. That artifact can prove compilation, tests, bundle
shape, and deterministic assembly. It cannot preserve Screen Recording consent,
establish a stable TCC identity, prove visual quality, or authorize release.

## Local verification

```sh
swift test --package-path apps/porthole-stage-capture
/usr/bin/python3 apps/porthole-stage-capture/Scripts/test-ci-artifact.py

apps/porthole-stage-capture/Scripts/package-apps.sh \
  --configuration release \
  --output "$HOME/coding/tmp/porthole-stage-local" \
  --signing-identity - \
  --allow-ad-hoc
```

The ad-hoc option is test-only. Never use that bundle for distribution, for a
TCC/Screen Recording acceptance claim, or as evidence that the stable Porthole
identity retains permission across rebuilds.

The required `porthole-stage` CI job performs the same tests, packages two
copies from one release build, strictly verifies both app bundles, creates two
normalized tar archives, and requires them to be byte-identical. The manifest
hashes every file and rejects extra files, links, wrong bundle identifiers,
missing or additional privacy declarations, signing entitlements, mismatched
app/fixture versions, non-Mach-O executables, or anything other than the
expected ad-hoc CI signature. Negative cases exercise those fail-closed
boundaries, and the job is part of the required aggregate `ci-gate`. This
proves deterministic assembly from one compiled payload; it does not claim
that different Xcode/Swift versions produce byte-identical binaries.

The Swift suite covers all 49 lifecycle edges, all 24 scope/capability
combinations, a 384-case source-authority/privacy persistence matrix, malformed
decoded approvals, process/launch/window drift, stale operation completions,
every byte split of a Unicode cursor event, actual pipe EOF/stop/restart, broken
metadata output, and strict finite proof durations (2 through 30 seconds).
Capture authority and cursor leases remain independent: cursor participation
cannot grant recording permission or prevent an otherwise approved preview.

Stop closes frame delivery and the recording input before waiting for macOS.
Stream shutdown and movie finalization share one five-second monotonic deadline;
missing, duplicate, and late framework callbacks cannot keep the UI waiting or
publish a successful proof receipt. Cancellation still requests system cleanup,
and application quit uses the same bounded path. A timeout means local delivery
is closed, **not** that macOS confirmed its stream stopped. Blocking writer
cancellation runs off the UI thread. Synthetic media tests exercise the actual
writer without requesting Screen Recording or inspecting any operator window.

### Synthetic visual proof, without capture permission

```sh
swift run --package-path apps/porthole-stage-capture PortholeStageCapture \
  --render-synthetic-proof "$HOME/coding/tmp/porthole-synthetic-proof"
```

The output directory must be new. This separate command is handled before a
capture controller, system picker, Keychain lookup, window, or cursor reader is
created. It draws the actual `StageView` through an inert presentation model and
offscreen AppKit view rasterization; it does not screenshot the desktop. Normal
startup still constructs the real controller and requires its signed-source and
picker protections. Mixing render-only and capture flags is rejected.

It emits four labeled light/dark PNGs and two three-second, 24 fps movies with
generated pointers, selection outlines, comments, a clock, and moving shapes.
Both movies are decoded back to verify all 72 frames, their dimensions, and the
absence of audio. `synthetic-ui-manifest.json` binds each artifact by SHA-256 and
explicitly denies capture, permission, background, cursor-transport, and release
proof. No `receipt.json` is emitted. The native package's Python suite exercises
this actual command, its refusal cases, and the resulting artifacts. Stage now
respects the system's light/dark appearance using semantic surface/text colors.

These renders demonstrate presentation and animation only. They do not prove
that a person or agent moved a real cursor, selected a real window, granted
consent, or captured in the background. The manual acceptance gates below remain.

Packaging generates all ten ICNS representations and signs the fixture before
sealing its executable digest into Porthole's resources. Fixture verification
checks that resource seal and the running program's identity and digest; it no
longer depends on the two apps occupying sibling directories. Relocation and
resource-tampering tests exercise the actual signed bundles. The separate Python
integration suite runs against the debug build by default; CI sets
`PORTHOLE_TEST_CONFIGURATION=release`. It also proves rejection leaves no archive.

## Review follow-up and next slices

This is a working task list, not a replacement for the shared roadmap. Source
inputs are [native PR #9992](https://github.com/curiositech/port-daddy/pull/9992),
[universal contract PR #9970](https://github.com/curiositech/port-daddy/pull/9970),
and [Convoy requirements #9987](https://github.com/curiositech/port-daddy/pull/9987).

| Order | Work | Acceptance gate |
| --- | --- | --- |
| Now | Finish #9992 review hardening, tests, and attributed replies | Published exact head, all actionable threads addressed, green required CI and terminal independent review |
| Next | Focused #9970 security contract successor | Strict schemas, immutable-ledger trigger regressions, and ciphertext-envelope/AAD validation at ingestion; preserve the original broad branch as lineage |
| Then | Shared macOS release machinery, with FleetBar and Porthole consumers | Extract the existing signing/notarization ceremony; accepted notarization, stapling, strict signature and Gatekeeper verification; missing credentials or rejected tickets prevent publication |
| Release gate | Version/platform contract and stable Developer ID hardware proof | Resolve macOS minimum version, stamp versions, and preserve fresh attributed permission/background/privacy/interaction evidence |
| Integration | Bind native evidence to Convoy source/stage/capsule receipts | One canonical evidence/authority model, immutable input digests, capability narrowing, and inspectable acceptance receipts; no parallel action ledger |

The release helper belongs in a separately scoped child change. Reuse FleetBar's
generic ceremony, not its app-specific packager under a new name. Code signing
and notarization establish artifact identity; they do not prove that a policy
is safe or replace Convoy's staged acceptance tests.

Deferred: a separate cursor-monitoring dashboard, serializing proof configuration
without a consumer, and new general-purpose geometry/packaging skills before a
second real consumer. Synthetic fixture geometry, identity, clock, icon, and
package contracts are automated here; hosted moving visual snapshots are not a
substitute for operator-hardware acceptance.

## Manual acceptance evidence

On 2026-09-01, operator Erich Owens reported that Screen Recording permission
worked, cursors worked, the interaction felt perfect, and he loved it. This is
valuable attributed product acceptance. It is not an automated test and no
recording artifact is inferred from the report.

The release gate still requires a fresh operator-hardware Porthole proof made
with the stable Developer ID bundle:

- show the selected app/window identity and explicit allowlist; no unapproved
  apps or windows may appear in Porthole's catalog;
- keep Porthole working in the background while the operator uses the selected
  app;
- show local and agent pointers moving, selections, clocks, typed comments,
  pause/resume/stop, and source identity without conflating typed telemetry with
  visible cursor motion;
- keep microphone and system audio off, exclude background media, and exercise
  privacy/secret blocking and revocation;
- capture fresh screenshots plus a motion artifact, then record provenance,
  source scope, privacy review, app version, bundle identifier, Team ID, CDHash,
  and artifact digests.

Headless CI cannot grant or inspect the operator's Screen Recording consent and
cannot judge whether the Stage looks good. Those are separate human-observed
release facts, not skipped automated assertions.

## Fail-closed production release boundary

No production Porthole workflow is added by this prototype. FleetBar provides
the repository's strongest Developer ID and notarization precedent; Porthole
still lacks an approved version source, release channel, update contract, and
current operator-hardware proof. Its plist currently promises macOS 14 while
exact picker binding fails closed below macOS 15.2, so that install/runtime
contract must also be reconciled before distribution. A production workflow
must refuse to publish until all of these gates exist and pass in one run:

1. Build once from an immutable tag with a pinned Xcode/Swift toolchain. Stamp
   both version fields from the tag; never hand-maintain the plist version.
2. Import the Curiositech Developer ID credential from the protected production
   environment. Sign with hardened runtime and a secure timestamp, then verify
   `Authority=Developer ID Application: Curiositech LLC (P5H9P59X2M)`,
   `TeamIdentifier=P5H9P59X2M`, stable bundle identifiers, CDHashes, and the
   absence of unnecessary entitlements. Missing credentials are a hard failure,
   never an ad-hoc fallback.
3. Submit a `ditto` archive with `notarytool --wait`; require Apple's accepted
   result, staple each distributed app, run `stapler validate`, strict
   `codesign`, and Gatekeeper assessment. Any missing ticket or failed check
   stops publication.
4. Generate SHA-256 checksums, a dependency/source SBOM in SPDX or CycloneDX,
   and GitHub build-provenance attestation for the exact uploaded archive. Sign
   the update metadata separately from the app-signing identity.
5. Publish only `Porthole.app`. `PortholeFixture.app` remains a test/proof tool.
   FleetBar's current native-app precedent is a version-pinned GitHub asset and
   checksum consumed by its custom updater, alongside Homebrew distribution;
   the shared `latest.json` schema has no Porthole product. Porthole has none of
   those integrations yet. Sparkle is not present, so no auto-update claim or
   appcast may be made. Choosing Sparkle later requires a separately protected
   EdDSA update key and signed appcast.
6. Update the release pointer or cask only after the artifact, checksum, SBOM,
   provenance, notarization, and operator-hardware proof receipts all read back.
   Keep the previous release addressable for rollback.

Until that boundary is implemented, the CI artifact is useful engineering
evidence and nothing more.
