# Think harness

Verified against the linked Cloudflare documentation on 2026-09-24. Think manages the model/tool conversation loop; AIChatAgent exposes a lower-level application-owned loop. These examples are illustrative and have not been typechecked against an installed package or run against a provider.

## Model, context, and configuration

Override `getModel()` with an approved AI SDK `LanguageModel`; its default throws. `getSystemPrompt()` supplies fallback context. `configureSession(session)` can return a configured Session with context blocks, memory, compaction, or search; context blocks replace that fallback prompt. `getTools()` supplies custom tools. Review `workspaceBash` and `includeMcpTools`, both enabled by default. `maxSteps` defaults to ten tool-call rounds per turn, not a campaign spend limit. Dynamic `configure<T>()` and `getConfig<T>()` write/read persisted configuration. [Configuration](https://developers.cloudflare.com/agents/harnesses/think/configuration/).

Application integration shape; `approvedModelFor` is an application factory, not an SDK export:

```typescript
import { Think } from "@cloudflare/think";
import type { LanguageModel } from "ai";

export class ResearchAgent extends Think<Env> {
  getModel(): LanguageModel {
    return approvedModelFor(this.env, this.getConfig<ResearchConfig>());
  }
  getSystemPrompt() {
    return "Summarize authorized evidence and cite its source identifiers.";
  }
}
```

Define `Env`, `ResearchConfig`, and the factory in the application. Validate configuration changes against a current principal, corpus disclosure policy, budget, and approved model registry. A model-written memory block is evidence to assess, not an authority store. Use [configuration.md](configuration.md) for bindings and package verification; do not carry forward an old experimental flag or model identifier without checking the installed version.

## Custom tool boundary

The current AI SDK tool shape uses `inputSchema`. Custom tools can replace same-named workspace tools, while later tool sources may override custom ones; audit the final exposed set rather than assuming your definition wins. [Tools](https://developers.cloudflare.com/agents/harnesses/think/tools/).

```typescript
// Inside getTools(); imports: tool from "ai", z from "zod".
return {
  inspectEvidence: tool({
    description: "Read an authorized evidence record by identifier",
    inputSchema: z.object({ evidenceId: z.string().min(1) }),
    execute: async ({ evidenceId }) => {
      const scope = await currentAuthorizedRequestScope(this);
      return readEvidenceWithinScope(scope, evidenceId);
    }
  })
};
```

Both helpers are application code. Derive scope from authenticated request/session state, never from model arguments. Apply pre-ranking disclosure filters and return only the authorized derivative. For write tools, add an action digest, current authority check, operation key and outcome receipt; a tool schema or approval dialog alone supplies none of those.

## Hooks and turn completion

| Hook | Useful boundary |
|---|---|
| `beforeTurn(ctx)` | Adjust model, active tools, and context once for the assembled turn |
| `beforeStep(ctx)` | Adjust a later model step; output-format configuration belongs at turn level |
| `beforeToolCall(ctx)` | Inspect a proposed server tool call |
| `afterToolCall(ctx)` | Observe the tool outcome |
| `onChunk(ctx)` / `onStepFinish(ctx)` | Stream / step observations |
| `onChatResponse(result)` | Assistant message persisted, turn lock released |
| `onChatError(error, ctx?)` | Handle turn errors, including early failures without a saved assistant reply |

Hooks apply across ingress paths, including programmatic turns. [Lifecycle hooks](https://developers.cloudflare.com/agents/harnesses/think/lifecycle-hooks/). Recheck effect authority at the effect boundary even after a hook admits a call. Use typed application signals and a persisted finite continuation budget; model text is not a control protocol. Transcript persistence does not establish external task success.

## Child-agent turns

Await `this.subAgent(ChildAgent, stableChildName)`, then invoke `child.chat(message, callbackObject, options?)`. The callback has `onStart` (request ID), `onEvent` (serialized stream chunk), `onDone` (saved assistant response), `onError`, and optional `onInterrupted`. An interrupted attempt can resolve its RPC promise while scheduled recovery owns the result: retain a recovering state instead of finalizing partial output. Children own their tool configuration; `options.tools` is ignored. Same-isolate cancellation uses `options.signal`; RPC cancellation uses `child.cancelChat(requestId, reason)`. [Sub-agent turns](https://developers.cloudflare.com/agents/harnesses/think/sub-agents/).

Persist the authorized parent request, child identity, request ID and result state in application storage if the caller must survive restart. Distinguish chat completion from adjudicated task completion. Avoid fire-and-forget delegation from recovery hooks; await the work or preserve an independently recoverable durable intent.

## Browser client

Use `useAgent` from `agents/react` and `useAgentChat` from `@cloudflare/ai-chat/react`. The current chat hook supplies `messages`, `sendMessage`, and `status`; submit with `sendMessage({ text })` and render text parts from `message.parts`. The older controlled-input helpers in this skill are not assumed available. [Getting started](https://developers.cloudflare.com/agents/harnesses/think/getting-started/).

Bind the routed instance name to authenticated access on the server; a browser-selected name is not authorization. Preserve input on submission failure and show partial/recovering outcomes distinctly. See [client-sdk.md](client-sdk.md) and [routing.md](routing.md).

No model, tool, child-agent, channel, submission, or recovery flow was run for this reference.
