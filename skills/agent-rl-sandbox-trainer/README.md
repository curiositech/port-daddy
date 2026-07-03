# Agent RL Sandbox Trainer

Procedural guidance for building deterministic simulation sandboxes, trajectory eval harnesses, adapter-training plans, and unhooks for specialized agents.

Use this skill when the desired behavior is narrower than general coding ability and must be learned, measured, replayed, and safely disabled.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/rl-sandbox-architecture.md` for the training/eval loop.
3. Load `references/eval-examples.md` for task and reward examples.
4. Write a trajectory suite.
5. Run `node scripts/trajectory_eval_harness.mjs --input suite.json`.

Fine-tune only after a replayable eval proves a persistent behavior gap. Keep base-model fallback and adapter disable paths available.
