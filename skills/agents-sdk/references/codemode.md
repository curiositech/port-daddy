# Code Mode

Code Mode lets a model compose declared tools in generated JavaScript executed in an isolated Worker. Root opened the current [AI SDK integration](https://developers.cloudflare.com/agents/tools/codemode/ai-sdk/) and [durable runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/) pages on 2026-09-24 after the old URL failed. Pin the installed package versions and validate your integration before deployment.

## When composition helps

Use ordinary tool calls for one action. Use Code Mode when a task needs conditional logic, iteration, or composition across local and MCP tools. It does not make generated code trusted, make tool output instructions, or authorize an effect.

## Tool and executor shape

```ts
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";

const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER });
const codeMode = createCodeTool({ tools: { getWeather, lookupInventory }, executor });
// Give `codeMode` to the model as its sole composition capability.
```

The original `worker_loaders` binding is still the relevant deployment surface. Generated code should receive only declared tool capabilities. Keep outbound network disabled unless a separately authorized Fetcher boundary is supplied; do not let generated composition smuggle a broad credential or cross-tenant reference into a tool call.

## MCP and effects

MCP tools can join the declared tool set only after their principal, tenant scope, schema, and effect policy are checked. The two paths differ: stateless `createCodeTool` excludes tools whose `needsApproval` is true or a function; it does not pause for approval. A durable `ToolSetConnector` maps that marker to the runtime approval protocol. Function-valued approval becomes always-required in that connector. [Approval behavior](https://developers.cloudflare.com/agents/tools/codemode/ai-sdk/). Record requested tool calls and completed receipts separately; a sandbox crash or model response does not settle an external-effect outcome.

## Durable execution and approval

For a restart-aware composition, construct a `toolSetConnector(this.ctx, { name, tools })` and pass it into `createCodemodeRuntime({ ctx, executor, connectors })`; expose `runtime.tool()` to the model. Inspect paused executions and resolve the exact pending operation through the runtime approval interface. Replay reuses recorded completed call results. Rejection ends the paused run without reversing prior effects; compensation requires a configured connector `revert` implementation and its own outcome evidence. [Durable runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/).

Bind the application decision to principal, execution ID, pending call/sequence, exact arguments, current scope, and expiry. Verify callback identity and recheck current authority before resuming. A saved completed call cannot establish a provider outcome if the connector recorded it incorrectly; test the acceptance-to-recording crash gap.

## Test cases

Test prompt injection in tool output, unknown tool references, malformed generated code, resource exhaustion, egress denial, cross-tenant input, approval expiry, and partial failure across a multi-tool program. This page provides no runnable sandbox or external action.
