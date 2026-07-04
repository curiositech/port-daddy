# Agent RL Sandbox Training Spec

## Behavior

[Specific behavior the base agent cannot perform reliably enough.]

## Sandbox Fixture

- Repo/app state: [fixture]
- Allowed tools: [tool list]
- Forbidden tools: [tool list]
- Reset hook: [command or procedure]
- Determinism check: [how replay is verified]

## Task Suite

| Task | Expected Tool Trace | Expected Artifact Evidence | Reward | Failure Modes |
| --- | --- | --- | --- | --- |
| [id] | [tool calls] | [artifact kind, contains, exit code] | [0-1] | [bad behavior] |

## Eval Harness

Run:

```bash
node skills/agent-rl-sandbox-trainer/scripts/trajectory_eval_harness.mjs --input suite.json
```

Paste the JSON report and include failed rows.

## Adapter Plan

- Base model: [model]
- Adapter: [LoRA/QLoRA/RFT/none]
- Dataset source: [chosen/rejected trajectories]
- Holdout tasks: [tasks not used for training]
- Promotion gate: [minimum eval result]

## Unhooks

| Name | Command Or Procedure | Validated |
| --- | --- | --- |
| [reset fixture] | [command] | true / false |
| [disable adapter] | [procedure] | true / false |
| [fallback agent] | [procedure] | true / false |
| [delete bad generated data] | [procedure] | true / false |

A report with only suggested unhooks is not deployable.
