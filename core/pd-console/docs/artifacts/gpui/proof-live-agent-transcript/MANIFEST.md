# pd-console live agent transcript proof

Captured against an isolated dev daemon on `http://127.0.0.1:9988` with
`PD_LANE_AGENT=proof-agent-1`.

Seeded transcript evidence:

- agent id: `proof-agent-1`
- transcript id: `proof-tx-1`
- visible stream phrase: `Draft diff is live`
- live update phrase: `LIVE UPDATE AFTER SUBSCRIBE`
- file artifact rows:
  - `core/pd-console/src/lane_pane.rs`
  - `manual-pane-lane.png`
  - `live-motion/live-lane-proof.gif`

Artifacts:

- `manual-pane-lane.png` - PID-targeted screenshot of `pd-console --pane lane` opened as a single Lane experience, showing the seeded daemon transcript, tool call, steering event, and file references rendered as artifact rows with filetree-relative paths and `open / preview in current worktree` metadata.
- `live-motion/live-lane-proof.gif` - PID-targeted frame sequence showing the Lane moving from live transcript/tool evidence into explicit artifact reference rows while pd-console was open.
- `live-motion/live-lane-proof.mp4` - MP4 derivative of the same frame-sequence motion proof.
