# Exact session plan and history proof

These artifacts show the real built dashboard against synthetic fixtures, not
operator records. They do not prove deployment to the canonical daemon, remote
roadmap synchronization, or native Porthole screen-recording permissions.

## Source and reproduction

- Base: `cc317ed19` (`origin/main` at the source checkpoint).
- Worktree: `port-daddy-session-plan-view-20260902`.
- Build: from `fleet-config-ui`, run `npm ci --ignore-scripts`,
  `npm test`, `npx tsc -b`, then
  `npx vite build --outDir ../.scratch/session-plan-build`.
- Fixture server: from the repository root, run
  `node fleet-config-ui/scripts/session-plan-proof.mjs`.
- The server binds port zero on loopback, prints its actual address, accepts
  reads only, and does not contact a daemon or other service. Stop that exact
  process after inspection. The recorded inspection used PID 28763, port 58086.
  That exact server was stopped after capture; a listener check confirmed the
  port was no longer listening. Generated build files were preserved outside
  Git, separately from these committed proof artifacts.
- Initial URL: `/fleet-ui/?surface=sessions&session=session-synthetic-a`.
  The old `sessions` route resolves into the existing Agents surface.

## Observed checks

- All 75 UI tests in five files passed, as did TypeScript checking and Vite build.
- Both synthetic sessions share a working directory but have distinct IDs and
  owners. Selection uses the exact ID, never directory/title similarity.
- The current nine-item plan is complete on screen after seven older notes;
  three items are checked. Receipt #9 remains the first history entry.
- Pressing Enter on receipt #9 opens its native disclosure and exposes the
  synthetic PR link. The fake PR explicitly says published, not merged.
- At 375 × 812, document and main widths are both 375 pixels: no horizontal
  overflow. The entire checklist is readable after normal vertical scrolling.
- Missing and denied IDs display their own errors without selecting another
  session. Source-bound links retain the selected daemon without copying
  unrelated query parameters or credentials.
- Tests also exercise stale async responses, unsafe note markup, timestamp ties,
  complete history, and directory-free exact-session navigation.

## Images

| Artifact | Viewport | What it proves |
| --- | --- | --- |
| `dark-desktop.png` | 1440 × 1100 | Dark house theme, source provenance, full current plan |
| `light-desktop.png` | 1440 × 1100 | Light theme and full current plan |
| `light-mobile.png` | 375 × 812 | Wrapped identity/source metadata and compact controls |
| `light-mobile-plan.png` | 375 × 812 | All nine checklist rows without truncation |
| `keyboard-history.png` | 1440 × 1100 | Keyboard-opened newest evidence receipt |
| `missing-session.png` | 1440 × 1100 | Exact missing-ID error, no fallback |
| `denied-session.png` | 1440 × 1100 | Exact forbidden-ID error, no fallback |

The in-app browser emitted JPEG screenshots, converted to PNG using
`sips -s format png`; dimensions and depicted content were unchanged.
No private window, audio, microphone, operator text, or background media was
captured.

## Sampled browser capture (not continuous or native Porthole)

`sampled-browser-capture.webm` contains 42 acquired browser frames from one real
sequential interaction run against source checkpoint
`6dcf18498e391159e2c52078836ba75d8c594618`. It is **sampled browser capture**, not a
native Porthole recording and not continuous full-rate video. The browser API
provided screenshots but no video stream. Missing native Porthole capture
integration remains product debt, not a user-permission failure.

The run actually opened the newest receipt with Enter, followed the source-bound
session link, refreshed the same session, opened a missing ID, refreshed it
without fallback, and opened a forbidden ID. `sampled-capture.json` preserves
action times, frame acquisition start/end times, byte lengths and phases.
`frames/` preserves every original JPEG. All acquisition gaps survive in
`sampled-frames.ffconcat`; no interpolation, transitions, invented states or
speed-up were applied. The WebM runs 12.526 seconds at 1440 × 1100, VP9.

The reusable `fleet-config-ui/scripts/capture-session-plan.mjs` accepts the existing documented
browser runtime's tab. It never launches another controller or captures an OS
window. Its timeline writer produced the committed FFmpeg manifest. Encoding:

```sh
ffmpeg -f concat -safe 0 -i sampled-frames.ffconcat -fps_mode vfr \
  -c:v libvpx-vp9 -crf 28 -b:v 0 -pix_fmt yuv420p sampled-browser-capture.webm
```

FFmpeg's output timestamps follow frame acquisition timestamps relative to the
first frame, to millisecond precision. The final frame ends the recording;
there is no invented trailing interaction.
