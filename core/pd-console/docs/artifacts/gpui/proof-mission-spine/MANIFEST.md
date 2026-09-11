# pd-console conversation-first Mission proof

This proof separates three witnesses instead of pretending one artifact proves
everything:

- [`runtime-proof.json`](./runtime-proof.json) records the real native dev app,
  a source-backed isolated development daemon, two distinct WorkIntent receipts,
  exact agents, worktree/branch binding, and exact attributed replies. The final
  app was then relaunched cold against the same ledger: it restored the exact
  operator turn, one reconstructed Port Daddy receipt, and one attributed reply.
  It preferred the native console WorkIntent over the Surface Gateway's
  compatibility alias for the same execution. The second operator turn was sent
  only after the first execution became terminal. Both no-change prompts
  correctly ended in `salvage` because neither produced a reviewable artifact;
  the UI surfaced that outcome instead of repainting it as success.
- The isolated compiled `port-daddy` artifact and its manifest prove that all 28
  Agent Harbor schemas are embedded and that capture plus query read-back works
  outside the source checkout. It is packaging proof, separate from the longer
  native lifecycle run.
- [`mission-starting.png`](./mission-starting.png),
  [`mission-running.png`](./mission-running.png), and
  [`mission-settled.png`](./mission-settled.png) are deterministic rasters of the
  console's render-agnostic Mission `Block` model. [`proof.gif`](./proof.gif)
  animates those three states. They verify semantic state, content hierarchy,
  and palette without claiming to be GPUI/Metal pixels.

The live GPUI window was inspected through its control socket after the cold
relaunch and returned the same goal, exact body, runtime, worktree, branch,
historical tool/artifact trace, separate Port Daddy receipt, and one final
attributed reply. Its alert list was empty. Exact-window capture was attempted
against window `31602`, but macOS denied Screen Recording to the Codex process.
No full-screen capture was attempted and no mock native screenshot was
substituted.

## Reproduction

```bash
PD_CONSOLE_NO_LAUNCH=1 bash core/pd-console/scripts/package-console.sh --devbuild mission-spine

PORT_DADDY_URL=http://127.0.0.1:3186 \
  PD_CONSOLE_WORKDIR="$PWD" \
  ~/Applications/pd-console-dev-apps/pd-console-dev-20260829-1954-mission-spine.app/Contents/MacOS/pd-console \
  --pane mission \
  --control-sock ~/coding/tmp/pd-console-mission-spine-20260829-1954.sock

python3 core/pd-console/scripts/console-ctl.py \
  --sock ~/coding/tmp/pd-console-mission-spine-20260829-1954.sock \
  state mission
python3 core/pd-console/scripts/console-ctl.py \
  --sock ~/coding/tmp/pd-console-mission-spine-20260829-1954.sock \
  alerts

core/target/release/pd-console \
  --headless-capture core/pd-console/docs/artifacts/gpui/proof-mission-spine/mission-running.png \
  --mission-state in_progress
```

## Artifact hashes

- `mission-starting.png`: `aa35bb4449784631f67deec4f01d23715a7a8a10153db7dbdb0011574bd91e5e`
- `mission-running.png`: `083dc19c70b3f805a5de421addb5ac9b153a786171a549ff4c972826a7d717bf`
- `mission-settled.png`: `ef94690eb3593ea1c9dfc75a26afa644c56f968adc6c1ef757860eb8df85424a`
- `proof.gif`: `411da1f45e9cd321fb6cdaa965c73413da7812667f06f52291dcaee35cf70fd0`
