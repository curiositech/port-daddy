# pd-console Lane visual-task proof

Captured on 2026-07-03 against an isolated proof daemon at
`http://127.0.0.1:9988` with `PD_LANE_AGENT=visual-proof-agent`.

## What This Proves

- Scout visual-task intake stores the screenshot through the real `/visual-tasks`
  route and blob store.
- The intake path publishes a sanitized `kind: "visual-task"` payload to
  `agent:visual-proof-agent`.
- pd-console Lane folds that payload into a Scout conversation row and an image
  artifact row with the real `/blob/<id>` screenshot reference.
- Lane backfills the watched agent's `agent:<id>` steering channel through
  `/msg/:channel`, so screenshot evidence that arrived before the pane opened is
  still visible to the operator.
- Lane hydrates the screenshot blob into a local cached image path for the
  operator thumbnail renderer.

## Artifacts

- `input-visual-task-screenshot.png` - the captured screenshot submitted to
  `/visual-tasks`.
- `seed-visual-task-daemon.ts` - the isolated Fastify daemon that registers the
  real visual-task, blob, and agent cockpit routes.
- `seed-result.json` - the `/visual-tasks` route result and the single lane
  message published to `agent:visual-proof-agent`.
- `lane-proof-repl.txt` - deterministic `pd-console-repl :lane` output showing
  the visual-task row, screenshot blob path, region/page metadata, and cached
  image path.
- `lane-proof-repl.png` - screenshot artifact generated from the saved Lane
  output plus the real screenshot fixture.
- `lane-proof-repl.gif` - motion artifact showing the first Lane render and the
  hydrated cached-image render.
- `lane-proof-repl.mp4` - screen recording equivalent of the same proof frames.

## Commands

```sh
PD_PROOF_PORT=9988 PD_PROOF_AGENT_ID=visual-proof-agent \
  /Users/erichowens/coding/port-daddy/node_modules/.bin/tsx \
  core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/seed-visual-task-daemon.ts
```

```sh
curl -sS -X POST http://127.0.0.1:9988/__proof/seed > \
  core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/seed-result.json
```

```sh
( sleep 0.2; echo ':lane'; sleep 1.2; echo ':lane'; sleep 0.2; echo ':quit' ) | \
  NO_COLOR=1 PORT_DADDY_URL=http://127.0.0.1:9988 \
  PD_LANE_AGENT=visual-proof-agent core/target/debug/pd-console-repl | \
  tee core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/lane-proof-repl.txt
```

Expected evidence:

- `seed-result.json` has `success: true`, `statusCode: 201`, and one lane
  message with `payload.kind: "visual-task"`.
- `lane-proof-repl.txt` contains
  `/blob/742a48d176775143f6b10c544cc70787f85d48727e5ebd63cdfcca6be9072387`
  and a cached file under `pd-console-lane-images`.

## Native GPUI Note

`cargo build --manifest-path core/pd-console/Cargo.toml --features gpui --bin pd-console`
passed. A direct native `pd-console --pane lane` screenshot attempt initially
exposed a debug-only grid id mismatch for `planner` and `coast-guard`; this
branch fixes that. Native window capture on this machine has multiple existing
pd-console windows, and the reliable captured evidence for this slice is the
deterministic Lane renderer proof above. No native empty/placeholder screenshot
is included or represented as proof. The committed proof artifacts exercise the
real route-to-Lane data path, the Lane backfill path, and the compiled GPUI
renderer now has an image-artifact block for the hydrated screenshot.
