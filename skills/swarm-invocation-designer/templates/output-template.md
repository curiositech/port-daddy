# Swarm Invocation Spec

## Operator Intent

[What the operator is trying to accomplish.]

## Invocation Surface

- Entry point: [button / command / context menu / natural language]
- Scope source: [selected diff / issue / files / session / dashboard row]
- Default roles: [agent roles]
- Confirmation gate: [what must be approved before tools run]

## Agent Roster

| Role | Goal | Files/Systems | Budget | Stop Condition |
| --- | --- | --- | --- | --- |
| [role] | [goal] | [scope] | [limit] | [kill/complete condition] |

## Message Contracts

| Contract | Hot Or Durable | Max Bytes | Schema | Receipt |
| --- | --- | --- | --- | --- |
| agent.intent.v1 | hot | 1024 | [fields] | intent accepted |

## Latency Budget

Run:

```bash
node skills/swarm-invocation-designer/scripts/latency_budget.mjs --input latency-plan.json
```

Paste the latency report and explain hot-path versus durable-path placement.

## Failure Handling

- Stop: [operator kill path]
- Rollback: [workspace/checkpoint path]
- Salvage: [where unfinished work is recoverable]
- Audit: [transcript, cost, review proof]
