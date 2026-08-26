# AST + Suggestibility D0 native visual voyage

This directory is a deterministic **fixture**, not live fleet evidence. It
drives the real Rust/GPUI `core/pd-console` Harbor pane through loopback HTTP,
and the pane renders the source label and current proof state on-canvas.

One command performs two CI-safe semantic captures and proves that their state
and provenance contracts match:

```sh
demos/ast-suggestibility/capture.sh --ci --repeat 2 --output .scratch/ast-d0-ci
```

On macOS with Screen Recording permission, the same driver builds and launches
the exact GPUI Harbor window, captures five exact-window stills, records a
10-second 24 fps motion take, derives GIF/MP4 media, and writes a manifest
sidecar for every visual artifact:

```sh
demos/ast-suggestibility/capture.sh --native --repeat 2 \
  --output core/pd-console/docs/artifacts/gpui/ast-suggestibility-d0
```

The native command never uses a display-wide capture. It targets the PID of the
proof-owned console process, resolves its Quartz window id, and uses that exact
window for screenshots and recording. `sourceLabel: fixture` is intentionally
visible in both the pixels and every manifest.

## Contract

- `scenario.fixture.json` is the frozen seed, synthetic clock, camera timeline,
  and five-state D0 story.
- `fixture-daemon.mjs` serves daemon-shaped roster, transcript, blackboard, and
  receipt routes on loopback port `3997`.
- `action-driver.mjs` is the deterministic state/camera-beat adapter.
- `run-voyage.mjs` owns receipts, redaction checks, artifact sidecars, and the
  two-run repeatability comparison.
- `proof-harness.e2e.mjs` is desktop-free and fails closed for wrong daemons,
  stale/missing provenance, false `real` labels, private paths, missing
  receipts, and broad capture commands.

The schema reserves the full control-panel vocabulary `active`, `historical`,
`blocked`, `stale`, `gate`, `interrupt`, and `receipt`. D0 captures baseline,
active, blocked, gate, and receipt; later voyages add the remaining states
without changing the manifest contract.
