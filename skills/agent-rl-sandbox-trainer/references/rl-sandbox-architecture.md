# RL Sandbox Architecture For Coding Agents

Use this when designing a training or eval loop.

## Primary Sources

- LoRA paper: https://arxiv.org/abs/2106.09685
- QLoRA paper: https://arxiv.org/abs/2305.14314
- AgentGym: https://arxiv.org/abs/2406.04151
- SWE-agent agent-computer interface paper: https://arxiv.org/abs/2405.15793
- OpenAI reinforcement fine-tuning guide: https://developers.openai.com/api/docs/guides/reinforcement-fine-tuning
- OpenAI agent improvement loop with traces and evals: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop

## Sandbox Requirements

- disposable repository fixture
- deterministic reset command
- fake secrets and fake external services
- explicit tool allowlist
- trace capture: state, action, observation, reward, artifacts
- hidden tests or held-out tasks
- unhooks: kill switch, revert command, model fallback, budget cap, policy gate

## Intervention Ladder

Use the lightest intervention that passes held-out evals:

1. Rule or AGENTS.md instruction
2. Script or hook
3. Skill with examples and output contract
4. Behavior cloning / SFT on trajectories
5. Preference optimization or RFT with graders
6. LoRA/QLoRA adapter for local/open models

Move down the ladder only when the previous layer fails on varied tasks.

## Reward Design

Good reward sources:

- command exit code
- test pass/fail
- diff shape and touched files
- claim/lock row exists before edit
- review reply includes evidence
- unsafe command refused
- artifact persisted
- replayable artifact object with kind, content, status, and exit code

Bad reward sources:

- self-reported success
- token count alone
- "looks confident"
- hidden policy bypass
- exact transcript imitation without state checks
- `finalState` prose without matching artifacts

`scripts/trajectory_eval_harness.mjs` deliberately treats `finalState` as a human-readable summary only. A task earns reward from expected tool actions plus `expectedEvidence` matched against captured trajectory artifacts. A suite without validated unhooks can still produce useful training rows, but it is not deployable. A suite with any failed eval row is also not deployable, even when unhooks are present.

## QLoRA Notes

QLoRA is useful when the behavior gap recurs across many tasks, the base model is local/open enough to adapt, and memory is constrained. It is not a substitute for missing product affordances. For Port Daddy, likely training targets are narrow behaviors:

- claim-before-edit discipline
- focused test selection
- refusing unsafe setup scripts
- writing evidence-rich PR replies
- closing sessions with useful handoffs

Use adapter names tied to behavior and eval suite, not vague model names.
