# Streaming chat with AIChatAgent

**Primary source read on 2026-09-24:** Cloudflare's [Chat agents guide](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/) (server API, React API, tools, data parts, resumable streaming, storage, provider examples, and protocol sections) and [streaming callable-methods guide](https://developers.cloudflare.com/agents/runtime/lifecycle/callable-methods/) (streaming RPC server and client examples).

`AIChatAgent` from `@cloudflare/ai-chat` manages a persisted `UIMessage[]` transcript and streams a response over the agent connection. It builds on Durable Object SQLite persistence and supports resuming an active stream after a client reconnects. A visible token chunk is not a receipt for an external effect: record effect idempotency and completion separately from the chat transcript.

## Basic chat agent

The completion callback and abort signal from `onChatMessage` belong to the chat lifecycle. Pass both through to the model call. The current Cloudflare example uses `createWorkersAI({ binding: this.env.AI })` with its documented model identifier; choose a provider and model according to the application’s own routing, availability, and data policy.

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, streamText } from "ai";

export class Chat extends AIChatAgent<Env> {
  maxPersistedMessages = 200; // example retention policy, not an SDK default

  async onChatMessage(onFinish: Parameters<typeof streamText>[0]["onFinish"], options?: {
    abortSignal?: AbortSignal;
    body?: Record<string, unknown>;
    continuation?: boolean;
  }) {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersAI("@cf/zai-org/glm-4.7-flash"),
      system: "You are a helpful assistant.",
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}
```

`this.messages` is the persisted transcript. `maxPersistedMessages` caps storage and deletes the oldest stored messages when the cap is exceeded; it does **not** limit what is supplied to the model. Apply `pruneMessages()` or an application-specific context policy when model context needs a separate bound.

The original OpenAI example remains a valid provider shape when the appropriate AI SDK provider package is installed. The current Cloudflare guide uses the explicit provider factory form:

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";

const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
const result = streamText({
  model: openai.chat("gpt-4o"),
  messages: await convertToModelMessages(this.messages),
  abortSignal: options?.abortSignal,
  onFinish,
});
```

Keep the API key in a Worker secret or binding rather than client code. The server selects the provider; the browser should not be able to replace it by supplying a model name.

## Server-side tools

The current AI SDK shape is `inputSchema`, rather than the original `parameters` property. A server tool with `execute` runs automatically, so validate its input and make any external operation idempotent. The step bound below is an application policy chosen for the example; it is not a platform-wide limit.

```ts
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

const tools = {
  getWeather: tool({
    description: "Get weather for a city",
    inputSchema: z.object({ city: z.string().min(1).max(120) }),
    execute: async ({ city }) => {
      const data = await fetchWeather(city);
      return { temperature: data.temp, condition: data.condition };
    },
  }),
};

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<typeof streamText>[0]["onFinish"], options?: {
    abortSignal?: AbortSignal;
  }) {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersAI("@cf/zai-org/glm-4.7-flash"),
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
      onFinish,
    });
    return result.toUIMessageStreamResponse();
  }
}
```

Use a client-side tool only for browser-local capabilities. Define it without `execute` on the server; the client supplies a result using `addToolOutput`. For payment, deletion, or other external action, model the approval in the tool definition with `needsApproval` and make the user’s approval a scoped effect authorization, rather than treating streamed text as approval.

## Workers AI binding

Workers AI needs an `ai` binding in the Worker configuration. The following is the relevant deployment shape; names are application-specific:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "CHAT", "class_name": "Chat" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Chat"] }],
  "ai": { "binding": "AI" }
}
```

```ts
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, streamText } from "ai";

const workersAI = createWorkersAI({ binding: this.env.AI });
const result = streamText({
  model: workersAI("@cf/zai-org/glm-4.7-flash"),
  messages: await convertToModelMessages(this.messages),
  abortSignal: options?.abortSignal,
  onFinish,
});
```

The model identifier above is the one in the Cloudflare guide read for this repair. It demonstrates the binding API; it is not a promise that this model suits every workload or remains available indefinitely.

## Custom UI message streams and data parts

Use `createUIMessageStream` when a response needs typed data parts alongside model output. `writer.merge(result.toUIMessageStream())` preserves the model stream, while `writer.write()` appends or reconciles application data. A repeated `type` plus `id` reconciles a persisted data part in place. Mark ephemeral status as `transient: true`; transient data is broadcast but is not added to `message.parts` or SQLite persistence.

```ts
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<typeof streamText>[0]["onFinish"], options?: {
    abortSignal?: AbortSignal;
  }) {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: workersAI("@cf/zai-org/glm-4.7-flash"),
          messages: await convertToModelMessages(this.messages),
          abortSignal: options?.abortSignal,
          onFinish,
        });

        writer.write({
          type: "data-sources",
          id: "search-42",
          data: { query: "agents", status: "searching", results: [] },
        });
        writer.merge(result.toUIMessageStream());
        // Application helper: current scope filters, compatible hybrid retrieval,
        // and source identifiers backed by actual records; failures throw.
        const sources = await findAuthorizedSourcesForCurrentRequest(this);
        writer.write({
          type: "data-sources",
          id: "search-42",
          data: { query: "agents", status: "found", results: sources },
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
```

The source lookup runs independently of the model stream in this sketch; those results are displayed as application data, not claimed as evidence the model consumed. Implement the named helper and bind query/scope to the same request before using this example. Persist a source or effect receipt only after it is known. A progress part can describe work in flight, but it must not be rendered as a completed citation, tool result, or durable side effect.

## Resumable streaming, cancellation, and durable recovery

On a normal reconnect, `AIChatAgent` buffers emitted chunks in SQLite, keeps the server turn running, sends buffered chunks to the reconnected client, then continues live streaming. The React hook enables this with `resume: true` by default; use `resume: false` only when the application intentionally declines automatic stream resumption.

```tsx
const { messages, stop, isRecovering } = useAgentChat({
  agent,
  resume: true,
  // false is the documented default: browser cleanup does not cancel the server turn.
  cancelOnClientAbort: false,
});

// Explicit stop() cancels the server stream.
return <button onClick={stop}>Stop</button>;
```

`cancelOnClientAbort: true` changes the ownership rule: generic browser abort or cleanup then cancels server work. Choose it for request-lifetime or token-saving flows only when that cancellation behavior is wanted. Explicit `stop()` cancels the server turn regardless of that option.

Reconnect resumption is distinct from recovery after a Durable Object interruption. Cloudflare documents `onChatRecovery(ctx)` for provider-specific recovery; its default persists a partial response and schedules `continueLastTurn()`. Recovered work can have already-settled tool results, so recovery code must not silently re-run a non-idempotent effect.

```ts
import type {
  ChatRecoveryContext,
  ChatRecoveryOptions,
} from "@cloudflare/ai-chat";

export class Chat extends AIChatAgent<Env> {
  override async onChatRecovery(
    ctx: ChatRecoveryContext,
  ): Promise<ChatRecoveryOptions> {
    console.log("Partial response length:", ctx.partialText.length);
    // Keep Cloudflare’s documented default: persist the partial and continue.
    return {};
  }
}
```

Use a stable business request ID and an effect receipt for any tool that can charge, send, mutate, or enqueue. A resumed UI stream can repeat delivery of presentation chunks; it must not determine whether the effect runs again.

## React client

The old `input`, `handleInputChange`, and `handleSubmit` example was from an older chat-hook API. The current hook exposes `sendMessage` and `UIMessage.parts`.

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

export function ChatUI() {
  const [input, setInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const agent = useAgent({ agent: "Chat", name: "my-chat-session" });
  const {
    messages,
    sendMessage,
    status,
    isStreaming,
    isServerStreaming,
    isToolContinuation,
    isRecovering,
  } = useAgentChat({ agent, resume: true });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const draft = input;
    const text = draft.trim();
    if (!text) return;
    setSubmitError(null);
    try {
      await sendMessage({ text });
      setInput((current) => current === draft ? "" : current);
    } catch {
      setSubmitError("Message submission failed; your draft is retained.");
    }
  }

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          <strong>{message.role}:</strong>
          {message.parts.map((part, index) =>
            part.type === "text" ? <span key={index}>{part.text}</span> : null,
          )}
        </div>
      ))}
      {isRecovering && <p>Recovering interrupted turn…</p>}
      {submitError && <p role="alert">{submitError}</p>}
      <form onSubmit={submit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isStreaming || isRecovering}
        />
        <button type="submit" disabled={isStreaming || isRecovering}>Send</button>
      </form>
      <small>
        {status}; server stream: {String(isServerStreaming)}; continuation:
        {" "}{String(isToolContinuation)}
      </small>
    </div>
  );
}
```

`status` is one of `"ready"`, `"submitted"`, `"streaming"`, or `"error"`. `isStreaming` also covers time spent awaiting a client tool; `isServerStreaming` covers server-initiated streaming or a client-tool phase; and `isRecovering` means an interrupted durable turn is resuming but is not yet producing tokens. A non-React client can use `WebSocketChatTransport`, but must itself implement history loading, reconnect resumption, transcript synchronization, and client-tool continuations that `useAgentChat` provides.

## Streaming RPC methods

Use a callable stream for a non-chat RPC. The current API ends the stream with `stream.end()`; the original `stream.close()` is not the documented current method. A handler should surface a typed terminal error with `stream.error(message)` when it can no longer produce a valid result.

```ts
import { Agent, callable, StreamingResponse } from "agents";

export class SearchAgent extends Agent<Env> {
  @callable({ streaming: true })
  async streamData(stream: StreamingResponse, query: string) {
    // Application helper authenticates caller and applies pre-ranking disclosure
    // filters plus the configured compatible hybrid retrieval profile.
    for (const result of await searchAuthorizedIndexedDocuments(this, query)) {
      stream.send({ type: "result", id: result.id, title: result.title });
    }
    stream.end({ type: "complete" });
  }
}
```

```ts
await agent.call("streamData", ["durable objects"], {
  stream: {
    onChunk(chunk) {
      renderResult(chunk);
    },
    onDone(finalChunk) {
      markComplete(finalChunk);
    },
    onError(message) {
      showStreamError(message);
    },
  },
});
```

A Worker must handle an unmatched Agent route and authorize the instance before routing. Await here to apply the null fallback, not because returning a promise is inherently invalid:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await requireAuthorizedAgentRoute(request, env); // Application helper.
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
};
```

## Operational controls

| Control | Current documented behavior | Design consequence |
| --- | --- | --- |
| `this.messages` | Persisted `UIMessage[]` transcript | Treat it as conversation state, not an external-effect ledger. |
| `maxPersistedMessages` | Limits SQLite transcript storage; does not control model context | Pair it with context pruning if needed. |
| `messageConcurrency = "queue"` | `"queue"` is the documented default; `"latest"`, `"merge"`, and `"drop"` have distinct persistence and turn-start behavior | Select one per intent semantics; do not assume all overlap policies are interchangeable. |
| `waitForMcpConnections` | The guide documents waiting for connected MCP servers before a turn | Use only when the turn actually depends on MCP tools; avoid silently turning connection wait into an unbounded user request. |
| `onChatRecovery` | Runs after interrupted durable work; default persists a partial and schedules continuation | Preserve settled tool results and reconcile idempotently before continuing. |

For `messageConcurrency`, `"latest"` preserves superseded user messages but does not start their model turns; `"merge"` combines trailing user messages before the latest queued turn; and `"drop"` ignores overlapping submissions without persisting them. Design the UI and audit record around the chosen policy.

## Source and compatibility limits

This reference records current Cloudflare documentation read on 2026-09-24. It validates documented public APIs and examples, not a deployed Worker, a provider credential, or a particular package lockfile. The exact AI SDK and provider package versions remain application dependencies; verify them with the application’s installed package and type checker before deployment. No backpressure contract is asserted here because the reviewed public Chat and callable-stream sections do not define one.
