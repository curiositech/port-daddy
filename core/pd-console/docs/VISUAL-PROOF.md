# Visual proof for pd-console PRs

Every GPUI/console diff ships visual artifacts. This is the harness that produces
them — **per-pane stills + a short video** — and renders the app on an **off-screen
virtual display** so capture never intrudes on the operator's physical monitor.

## Why this design (and not "headless render inside the app")

pd-console is a **GPUI 0.2.2** app, not a raw `winit`+`wgpu` app. GPUI owns its
platform layer: on macOS it renders through its own Metal renderer into a
`CAMetalLayer`/`NSWindow` drawable, and **0.2.2 exposes no public "render to an
offscreen texture and read it back" API** (its `TestPlatform` is a no-op renderer
that produces no pixels). True in-app headless capture would mean forking GPUI's Mac
window + Metal renderer to draw into an `MTLTexture` and read it back — a heavy,
brittle fork chasing fast-moving upstream. Not worth it for PR proof.

So we record a *real* rendered window, but keep it off the operator's screen:

- **Off-screen, still rendering** — open the window with `--display <virtual>` so it
  lives on a virtual display (BetterDisplay or a dummy plug). The compositor keeps
  drawing it (animations, shaders run for real); your physical monitor stays clean.
- **Window-only capture** — stills use `screencapture -l<windowid>`. Video first
  tries ScreenCaptureKit's independent-window capture when available, then falls
  back to repeated exact-window `screencapture -l<windowid>` frames stitched into
  MP4/GIF. Both paths target **only** the proof-owned pd-console window backing
  store, never operator browser, terminal, desktop, or unrelated windows.

## Pieces

| File | Role |
|------|------|
| `core/pd-console/src/main.rs` `--display` / `--list-displays` | Open the window on a chosen display; enumerate displays |
| `core/pd-console/scripts/proof/recorder.swift` | Best-effort ScreenCaptureKit window → `.mov` recorder (cropped to the window) |
| `core/pd-console/scripts/proof/capture-proof.sh` | Orchestrator: build → resolve virtual display → exact-window stills + best-effort/fallback video → `RECEIPT.md` + `MANIFEST.md` |
| `core/pd-console/scripts/proof/check-capture-proof.sh` | Deterministic dry-run receipt smoke; no GPUI launch, display, or TCC required |
| `core/pd-console/scripts/proof/setup-virtual-display.sh` | One-time: install BetterDisplay, create the virtual screen, grant TCC |
| `core/pd-console/scripts/capture-gpui.sh` | The original stills-only script (kept; `make shots`) |

## One-time setup (interactive)

```sh
make -C core/pd-console proof-setup
```

This installs BetterDisplay (if missing), helps you create a virtual screen, opens
the Screen Recording permission pane, and lists the displays pd-console can see. Two
steps are inherently interactive on macOS and cannot be scripted away:

1. **Create the virtual display** — easiest in the BetterDisplay menubar app
   ("Create New Virtual Screen"), or just plug in a dummy HDMI/DisplayPort adapter.
2. **Grant Screen Recording** — System Settings → Privacy & Security → Screen
   Recording → enable the terminal you'll run the harness from. A detached/CI
   context is denied by TCC and capture fails loudly ("could not create image from
   display").

Confirm a non-primary display appears:

```sh
make -C core/pd-console displays
#   [0] id=… uuid=… origin=(0,0)     size=5120x2134   ← primary
#   [1] id=… uuid=… origin=(5120,0)  size=1920x1080   ← virtual (use this)
```

## Capture proof for a PR

```sh
make -C core/pd-console proof
# auto-detects the virtual display; writes docs/artifacts/gpui/proof-<stamp>/
#   pane-fleet.png pane-sorties.png ... proof.mov/proof.mp4
#   or proof-window-fallback.mp4/proof-window-fallback.gif
#   plus RECEIPT.md and MANIFEST.md
```

Run the deterministic receipt smoke before trusting the harness:

```sh
make -C core/pd-console proof-check
```

`proof-check` verifies more than receipt vocabulary. It runs a dry-run capture,
parses the machine-readable `pd-console-proof-metadata` JSON block in each
`RECEIPT.md` and `MANIFEST.md`, and checks committed artifact bundles for a
current HEAD commit or an explicitly documented capture commit. Real sample
bundles may be retained as historical proof when a headless/no-GUI context
cannot refresh them, but they must say so in metadata and must not claim
provider/transcript end-to-end coverage.

Tunables (env):

| Var | Default | Meaning |
|-----|---------|---------|
| `PD_PROOF_DRY_RUN` | `0` | set `1` to emit a deterministic receipt/manifest without launching GPUI |
| `PD_PROOF_STAMP` | UTC timestamp | deterministic artifact stamp for dry-run or scripted proof |
| `PD_PROOF_DISPLAY` | auto | virtual-display selector (index or UUID) |
| `PD_PROOF_PANES` | `fleet sorties dispatch sessions health lane` | panes to snapshot |
| `PD_PROOF_VIDEO_PANE` | `fleet` | pane to record |
| `PD_PROOF_DURATION` | `10` | video seconds |
| `PD_PROOF_FPS` | `30` | video frame rate |
| `PD_PROOF_SETTLE` | `3` | seconds to wait after the proof window appears before screenshot/video capture |
| `PD_PROOF_VIDEO_MODE` | `auto` | `auto`, `screencapture`, or `sck`; `auto` falls back to exact-window frames |
| `PD_PROOF_ALLOW_PRIMARY` | `0` | set `1` to allow recording on the primary display when auto-detect finds no virtual display; this is visible and intended only for explicit local debugging |

Paste `MANIFEST.md` into the PR and keep `RECEIPT.md` with the artifact bundle.
The receipt records the display selector, launched proof binary, window IDs,
exact commands, video method, and limitations.

When `PD_PROOF_DISPLAY` is set explicitly, the harness prevalidates the selector
against `pd-console --list-displays` and fails with `OPERATOR-INTERVENTION.md`
if it is missing or resolves to the primary display. It must never rely on
pd-console's display fallback for proof capture.

## CI note

This runs on **macOS with a logged-in GUI session** and a TCC Screen-Recording
grant — it is not a headless Linux CI step. Fully unattended capture on a
self-hosted macOS runner additionally needs auto-login + a pre-provisioned TCC grant
+ a virtual display; that is a separate hardening task, not wired here.

## Troubleshooting

- **"could not create image from display" / 0 frames** → the running terminal lacks
  Screen Recording permission, or you're in a detached/SSH/CI context. The
  harness writes `OPERATOR-INTERVENTION.md` and stops instead of broadening
  capture.
- **ScreenCaptureKit aborts or records no frames** → the harness falls back to
  exact-window `screencapture -l<windowid>` frames and produces
  `proof-window-fallback.mp4` plus `proof-window-fallback.gif`.
- **Window opens on the physical monitor** → no virtual display was found; the
  harness aborts unless `PD_PROOF_ALLOW_PRIMARY=1`. Run `proof-setup`.
- **Empty/blank panes** → the daemon isn't running or `PORT_DADDY_URL` is wrong;
  panes render an error state, which is itself valid proof of the UI.
