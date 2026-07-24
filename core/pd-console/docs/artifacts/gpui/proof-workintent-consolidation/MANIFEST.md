# pd-console WorkIntent consolidation proof

Branch: `codex/pd-console-story-linework-motion`
Captured on virtual display selector `2` (off the operator's screen).
Native release binary connected to an isolated source daemon at `http://127.0.0.1:9918`.

## Runtime truth

- WorkIntent: `work_intent_console_proof-20260713`
- Budget ceiling: `$10`
- Initial WorkPlan: `intent-captured / unshaped / 0 nodes / 0% confidence`
- Ledger: sequence `1` WorkIntent, sequence `2` WorkPlan
- No AgentNode or AgentRun was materialized.
- Next action: `WORK_PLANNER_REQUIRED`
- No provider, model, backend, or Body was selected by pd-console.
- The daemon was stopped and restarted against the same ledger; the projection
  rehydrated and the transient failure alert cleared.

## Panes
- `work` — ![pane-work](./pane-work.png)
- restart recovery — ![restart-recovery](./restart-recovery.png)

## Video
- [proof.mp4](./proof.mp4) · [proof.mov](./proof.mov)
