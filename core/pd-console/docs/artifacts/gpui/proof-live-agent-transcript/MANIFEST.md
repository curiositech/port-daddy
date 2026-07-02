# pd-console live agent transcript proof

Captured against an isolated dev daemon on `http://127.0.0.1:9988` with
`PD_LANE_AGENT=proof-agent-1`.

Seeded transcript evidence:

- agent id: `proof-agent-1`
- transcript id: `proof-tx-1`
- visible stream phrase: `Draft diff is live`
- live update phrase: `LIVE UPDATE AFTER SUBSCRIBE`

Artifacts:

- `manual-pane-lane.png` - PID-targeted screenshot of `pd-console --pane lane` opened as a single Lane experience, showing the seeded daemon transcript, tool call, steering event, and live update rows as transcript typography.
- `live-motion/live-lane-proof.gif` - PID-targeted frame sequence showing the Lane moving from connecting state to live transcript/tool evidence while pd-console was open.
- `live-motion/live-lane-proof.mp4` - MP4 derivative of the same frame-sequence motion proof.
