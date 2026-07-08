# Fleet HITL Proposal Visual Proof

Captured on July 3, 2026 with a BetterDisplay virtual screen, not the primary
display. The proof daemon was a throwaway feature daemon at
`http://127.0.0.1:9919` with two seeded pending proposals from Spark and Spider.

## Artifacts

- `pane-cloud-fleet.png` — pd-console Cloud Fleet pane showing pending proposals.
- `proof.mp4` — virtual-display recording of the same pane.
- `proof.gif` — short web-friendly motion artifact.

## Commands

```sh
betterdisplaycli create -devicetype=virtualscreen -virtualscreenname=pd-proof -aspectWidth=16 -aspectHeight=10
PORT_DADDY_URL=http://127.0.0.1:9919 PD_PROOF_DISPLAY=1 PD_PROOF_PANES="cloud-fleet" PD_PROOF_VIDEO_PANE="cloud-fleet" core/pd-console/scripts/proof/capture-proof.sh core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals
screencapture -x -v -V6 -D2 core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals/proof.mov
ffmpeg -y -loglevel error -i core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals/proof.mov -vf "scale='min(1280,iw)':-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals/proof.mp4
ffmpeg -y -loglevel error -i core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals/proof.mov -vf "fps=8,scale='min(960,iw)':-2:flags=lanczos" core/pd-console/docs/artifacts/gpui/proof-fleet-hitl-proposals/proof.gif
```

The repo ScreenCaptureKit recorder still hit `CGS_REQUIRE_INIT` in this desktop
session, so the MP4/GIF came from `screencapture -D2` against the BetterDisplay
virtual display. The bad window-id still from the generic helper was replaced by
a crop from the verified virtual-display recording frame because two unrelated
pd-console windows were already open.
