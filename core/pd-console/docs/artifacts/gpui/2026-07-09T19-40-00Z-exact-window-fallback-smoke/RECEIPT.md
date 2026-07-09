<!-- pd-console-proof-metadata
{
  "schema": "pd-console.visual-proof.v1",
  "artifactKind": "receipt",
  "captureCommit": "fc235d5016bfd1c325013b0c472aacc7e585b073",
  "captureCommitShort": "fc235d501",
  "captureCommitPolicy": "documented-capture-commit",
  "artifactStatus": "historical-non-current-real-capture",
  "proofScope": "exact-window-harness-only",
  "providerTranscriptE2E": false,
  "dryRun": false
}
-->

# pd-console visual proof receipt

Artifact dir:
`core/pd-console/docs/artifacts/gpui/2026-07-09T19-40-00Z-exact-window-fallback-smoke`

Historical status: this is a real exact-window fallback capture from commit
`fc235d501`, retained as historical visual evidence. It is not claimed as fresh
provider/transcript E2E proof for the current PR head.

## Context

- Branch: `codex/pd-console-visual-proof-lane`
- Commit: `fc235d501`
- Daemon URL: `<daemon-url-from-port-daddy-discovery>`
- Display selector: `104115ce-748a-4d96-afa9-170076c0e4b4`
- Source binary: `${REPO_ROOT}/core/pd-console/../target/release/pd-console`
- Proof launch binary: `${REPO_ROOT}/core/pd-console/../target/proof/pd-console-proof`
- Quartz owner name: `pd-console-proof`
- Video mode: `screencapture`
- Settle delay: `8s`

## Safety Contract

- exact-window capture: stills and fallback video frames use `screencapture -x -o -l"<windowid>"`.
- Each `<windowid>` is discovered from a proof-owned pd-console window launched by this harness.
- Window discovery is filtered by the launched process PID before capture.
- No full-screen capture is used.
- No operator browser, terminal, or unrelated windows are captured.

## Artifacts

Screenshots:
- `pane-lane.png`

Video:
- `proof-window-fallback.mp4`
- `proof-window-fallback.gif`

Supporting evidence:
- `MANIFEST.md`
- `RECEIPT.md`
- `video-frames/frame-*.png`

## Window IDs

- `pane=lane pid=19245 window=53748`
- `pane=lane-video pid=21412 window=53773`

## Commands

Launch proof-owned window:

```sh
PORT_DADDY_URL="<daemon-url-from-port-daddy-discovery>" "${REPO_ROOT}/core/pd-console/../target/proof/pd-console-proof" --pane "<pane>" --display "104115ce-748a-4d96-afa9-170076c0e4b4"
```

Exact-window still capture:

```sh
screencapture -x -o -l"<windowid>" "$OUT/pane-<pane>.png"
```

Exact-window fallback video path:

```sh
screencapture -x -o -l"<windowid>" "$OUT/video-frames/frame-001.png"
ffmpeg -y -loglevel error -framerate "$FPS" -i "$OUT/video-frames/frame-%03d.png" \
  -vf "scale=1280:852:force_original_aspect_ratio=decrease,pad=1280:852:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/proof-window-fallback.mp4"
ffmpeg -y -loglevel error -i "$OUT/proof-window-fallback.mp4" \
  -vf "fps=6,scale=960:-1:flags=lanczos" "$OUT/proof-window-fallback.gif"
```

Best-effort ScreenCaptureKit path:

```sh
"$REC" --window-id "<windowid>" --duration "$DURATION" --fps "$FPS" --out "$OUT/proof.mov"
```

## Method

- ScreenCaptureKit: skipped by PD_PROOF_VIDEO_MODE=screencapture
- Exact-window fallback: captured 4 window-only frames (4 unique hashes)
- Accepted video method: screencapture-window-frames

## Limitations

- Requires a logged-in macOS GUI session for real GPUI capture.
- Requires Screen Recording permission for window-only `screencapture` and ScreenCaptureKit.
- Requires a virtual display for non-intrusive proof unless `PD_PROOF_ALLOW_PRIMARY=1` is explicitly set for local debugging.
