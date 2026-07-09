<!-- pd-console-proof-metadata
{
  "schema": "pd-console.visual-proof.v1",
  "artifactKind": "receipt",
  "captureCommit": "0bf4ee31c315df3b629aa6c56aa1a74132b3bf73",
  "captureCommitShort": "0bf4ee31c",
  "captureCommitPolicy": "documented-capture-commit",
  "proofScope": "exact-window-harness-only",
  "providerTranscriptE2E": false,
  "dryRun": true
}
-->

# pd-console visual proof receipt

Artifact dir:
`core/pd-console/docs/artifacts/gpui/2026-07-09T19-58-44Z-current-head-dry-run`

## Context

- Branch: `codex/pd-console-visual-proof-lane`
- Commit: `0bf4ee31c`
- Daemon URL: `<daemon-url-from-port-daddy-discovery>`
- Display selector: `proof-display-current-head-dry-run`
- Source binary: `${REPO_ROOT}/core/pd-console/../target/release/pd-console`
- Proof launch binary: `${REPO_ROOT}/core/pd-console/../target/proof/pd-console-proof`
- Quartz owner name: `pd-console-proof`
- Video mode: `auto`
- Settle delay: `3s`

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
- `recorder.log`

## Window IDs

- `pane=lane pid=<pid> window=<windowid>`

## Commands

Launch proof-owned window:

```sh
PORT_DADDY_URL="<daemon-url-from-port-daddy-discovery>" "${REPO_ROOT}/core/pd-console/../target/proof/pd-console-proof" --pane "<pane>" --display "proof-display-current-head-dry-run"
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

- ScreenCaptureKit: not attempted in dry-run
- Exact-window fallback: planned first-class exact-window fallback
- Accepted video method: dry-run

## Limitations

- Dry-run receipt only; no GPUI window, screenshot, or video was captured.
- Requires a logged-in macOS GUI session for real GPUI capture.
- Requires Screen Recording permission for window-only `screencapture` and ScreenCaptureKit.
- Requires a virtual display for non-intrusive proof unless `PD_PROOF_ALLOW_PRIMARY=1` is explicitly set for local debugging.
