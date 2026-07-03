# Example Output: Agent RL Sandbox Trainer

## Behavior Goal

Train or tune a reviewer-fix agent to respond to PR review comments with code changes, focused tests, and a substantive reply, without broadening the diff.

## Sandbox

- Fixture repo with two failing review threads.
- Deterministic test command.
- Tool permissions limited to read, edit claimed files, run focused tests, and write PR reply draft.
- Reset hook restores the fixture after each trajectory.

## Trajectory Eval

```json
{
  "summary": {
    "taskCount": 2,
    "passed": 1,
    "failed": 1,
    "averageReward": 0.667,
    "deployable": true,
    "validatedUnhookCount": 2
  },
  "trainingRows": [
    {
      "taskId": "reply-thread",
      "reward": 1,
      "preference": "chosen"
    },
    {
      "taskId": "missed-test",
      "reward": 0,
      "preference": "rejected"
    }
  ],
  "validatedUnhooks": [
    {
      "name": "reset fixture",
      "command": "npm run fixture:reset",
      "validated": true
    },
    {
      "name": "disable adapter",
      "procedure": "unset adapter and fall back to base model",
      "validated": true
    }
  ]
}
```

## Training Plan

- Start with replayable demonstrations and rejection examples.
- Use LoRA/QLoRA only after the eval detects a stable behavior gap.
- Keep the base model fallback and adapter disable switch in the deployment path, and mark both as validated unhooks.
- Never train on trajectories that cannot be replayed from a clean sandbox.

## Unhooks

- Reset sandbox fixture, with a validated command.
- Revert workspace snapshot, with a replayed proof.
- Disable adapter and fall back to base model, with a validated procedure.
- Drop generated trajectories that cannot be replayed deterministically.
