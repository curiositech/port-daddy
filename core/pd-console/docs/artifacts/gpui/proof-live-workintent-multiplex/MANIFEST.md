# pd-console live WorkIntent proof

Captured against the named codebase berth `pd-console-live` on
`http://127.0.0.1:3166`, with its fleet worker explicitly armed. The native
release app and all screenshots target that berth directly.

## Visual proof

- `02-live-agent-multiplex.png`: two daemon-launched Squid bodies visible at once
  in Active Agents, each with a distinct dispatch session and worktree.
- `03-live-transcript-steer.png`: a real operator turn, steering receipt, tool
  output, and later agent response in the live Lane transcript.
- `04-live-transcript-stream.mov`: six seconds of the transcript arriving in the
  GPUI app on the virtual proof display.
- `05-two-roadmap-work-bonds.png`: Conductor shows both active roots and their
  independent `$10` governed bonds.
- `06-completed-roadmap-receipt.png`: the dispatch pane reads the live daemon and
  displays the completed roadmap run with its durable PR #1866 receipt.
- `07-berth-ledger-survived-restart.png`: after an ordinary stop/start, the
  Sessions pane reads back the same durable proof session from the preserved
  named-berth database.

## Runtime proof

- `runtime-proof.json`: concise final daemon, dispatch, session, body, PR, test,
  and console-receipt identifiers.
- `runtime-proof-pre-preservation-fix.json`: raw snapshot of the first two proof
  runs that exposed a destructive lifecycle bug: null artifacts were marked
  settled and their dirty worktrees were reaped.

That regression is part of the proof, not omitted from it. The adapter now maps
`produced` or `settled` without a durable artifact to `salvage`; DispatchWorker
therefore preserves the worktree for inspection and replay. A run is shown as
complete only when a reviewable artifact exists.

The same proof pass exposed and fixed a second lifecycle bug: ordinary
`pd dev down` deleted the entire named-berth database. Normal stop now reports
`state preserved`, relaunch reports `kept existing berth DB`, and the session
plus note in `07-berth-ledger-survived-restart.png` were read back after restart.
Only explicit `--purge`/`--reset` or `pd dev gc` destroys berth state.
