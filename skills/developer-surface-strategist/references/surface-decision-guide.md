# Surface Decision Guide

Use this when deciding whether a workflow belongs in SDK, CLI, MCP, GUI, API, webhook, or background agent.

## Surface Rules

| Surface | Best For | Avoid When |
| --- | --- | --- |
| GUI | Routine human operations, status, credentials, recovery, review. | The action is primarily scripted or embedded. |
| CLI | Local automation, emergency actions, agent shell workflows, CI scripts. | A human must do it routinely. |
| SDK | Embedding behavior inside apps, services, tests, or language-native workflows. | The user only needs a one-off command. |
| MCP | Model clients need safe tool invocation with schemas and permissions. | Non-model services or humans are the primary caller. |
| API | Networked service-to-service integration. | Local-only workflows or rich language ergonomics are required. |
| Webhook | External events should trigger work. | Caller needs a synchronous typed result. |
| Background agent | Long-running autonomous work with receipts and control. | Work is short, deterministic, and easier as a command. |

## Why SDK Instead Of CLI Or MCP?

Use an SDK when the caller is code:

- The workflow lives inside another app or service.
- The caller needs typed objects, retries, fixtures, and integration tests.
- The user wants to compose calls with their own business logic.
- The workflow must run in a long-lived process rather than a shell command.

Use CLI when the caller is a person, shell, CI job, or agent operating locally.
Use MCP when the caller is a model client that needs schema-governed tools.
Use GUI when the caller is a human doing setup, review, status, or recovery.

## Python SDK Parity Bar

If Python developers are in the target audience, the plan must include:

- install command
- typed request/response objects or dataclasses
- async and sync examples if the workflow is networked
- local fake/server fixture
- retries, idempotency keys, and receipt parsing
- examples for listener and sender workflows
- CI coverage that imports the package and runs a minimal round trip
