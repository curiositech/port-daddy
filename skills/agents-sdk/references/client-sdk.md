# Client SDK

**Primary sources read 2026-09-24:** Cloudflare [Client SDK](https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/), [Routing](https://developers.cloudflare.com/agents/runtime/communication/routing/), [Store and sync state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/), [Readonly connections](https://developers.cloudflare.com/agents/runtime/communication/readonly-connections/), and [Chat agents](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/). The SDK offers a React `useAgent` hook, `AgentClient` for JavaScript runtimes, and `agentFetch` for one-off HTTP requests.

## Pick the transport for the interaction

| Client | Use it for | Keep in mind |
| --- | --- | --- |
| `useAgent` | React views with connection lifecycle and reactive state | It reconnects automatically and cleans up on unmount. |
| `AgentClient` | vanilla JS, Node.js, Deno, Bun, or another UI framework | Call `close()` when the owner is done. |
| `agentFetch` | one HTTP request without state sync | It does not create a persistent WebSocket session. |

WebSocket state sync and RPC do not authorize a client. The Worker must authenticate the upgrade/request and the Agent must validate state and sensitive method arguments.

## React: current state and RPC

The public documentation shows `useAgent<CounterAgent, CounterState>` when server class/types are available to the frontend. `agent.state` starts as `undefined` until the server's first state message, so never spread or dereference it before checking it.

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";
import type { CounterAgent, CounterState } from "../server/counter";

export function CounterView() {
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<"server" | "client" | null>(null);
  const agent = useAgent<CounterAgent, CounterState>({
    agent: "CounterAgent",
    name: "my-instance",
    onStateUpdate: (_state, source) => {
      // Render state; do not treat source as authenticated identity.
      setLastSource(source);
    },
    onStateUpdateError: (message) => {
      setError(message);
    },
  });

  const state = agent.state;
  const increment = async () => {
    if (!state) return; // Initial state has not synchronized yet.
    try {
      await agent.stub.increment();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed");
    }
  };

  return (
    <>
      <button disabled={!state} onClick={increment}>
        Count: {state?.count ?? "loading"}
      </button>
      {lastSource && <small>Last update: {lastSource}</small>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

Use `stub` for a typed method marked `@callable()` on the server; `agent.call("method", [args])` remains available when a dynamic method name is necessary. Guard write UI with application permissions and handle `onStateUpdateError`: server validation and readonly-connection policy can reject a client `setState`.

For a complete client-owned state update, build a valid whole state value only after synchronization:

```tsx
function addItem(item: string) {
  const state = agent.state;
  if (!state) return;
  agent.setState({
    ...state,
    count: state.count + 1,
    items: [...state.items, item],
  });
}
```

The server remains authoritative. Validate unknown wire data and enforce authorization in `validateStateChange` or callable methods; the browser's TypeScript type and disabled button are usability controls, not a trust boundary.

## Fresh connection parameters

The Client SDK documents an asynchronous `query` function that returns a record and is refreshed on reconnect. Use it only to transmit a fresh credential to a server-side verifier; do not log it or infer authorization from its presence.

```tsx
const agent = useAgent({
  agent: "UserAgent",
  basePath: "user",
  query: async () => ({ access_token: await getAccessToken() }),
  queryDeps: [sessionVersion],
  cacheTtl: 55 * 60 * 1000, // application policy for a roughly hourly token
});
```

`cacheTtl` above is a constructed policy example, not an SDK default or a token lifetime. The server must verify signature, issuer, audience, expiry, and per-instance authority on every new connection.

## Chat UI

The old `input`, `handleInputChange`, and `handleSubmit` shape is no longer the current chat hook example. `useAgentChat` provides `sendMessage`, `messages`, `status`, `isStreaming`, and `isServerStreaming`; render message parts rather than assuming a `content` field.

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

export function ChatView() {
  const [input, setInput] = useState("");
  const agent = useAgent({ agent: "ChatAgent", name: "session-1" });
  const { messages, sendMessage, status, isStreaming, isServerStreaming } =
    useAgentChat({ agent, resume: true });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.parts.map((part, index) =>
            part.type === "text" ? <span key={index}>{part.text}</span> : null,
          )}
        </div>
      ))}
      {isServerStreaming && <p>Agent is working in the background…</p>}
      <form onSubmit={submit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming}>Send</button>
      </form>
      <small>{status}</small>
    </div>
  );
}
```

`isStreaming` covers client- and server-initiated streams. `isServerStreaming` distinguishes a background/server turn. UI chunks are presentation state; reconcile a completed message and any tool/effect receipt separately.

## Vanilla JavaScript: AgentClient

```ts
import { AgentClient } from "agents/client";

const client = new AgentClient({
  agent: "CounterAgent",
  name: "my-counter",
  host: "your-worker.your-subdomain.workers.dev",
  onStateUpdate: (state, source) => {
    const status = document.querySelector("#counter-status");
    if (status) {
      status.textContent = JSON.stringify({
        purpose: "counter-state-sync",
        source,
        hasState: state !== undefined,
      });
    }
  },
});

try {
  await client.call("increment");
} finally {
  // Invoke when the page/module/process owner is done with this connection.
  client.close();
}
```

`AgentClient.state` starts undefined until the initial state message arrives and is then updated synchronously for broadcast or local `setState` updates. It supports `call`, `stub`, `setState`, `send`, `close`, and `reconnect`. Raw `send` is for an Agent's non-RPC WebSocket protocol; design and validate that message schema explicitly before using it.

## One-off HTTP: agentFetch

```ts
import { agentFetch } from "agents/client";

const response = await agentFetch(
  {
    agent: "DataAgent",
    name: "instance-1",
    host: "my-worker.workers.dev",
  },
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "process" }),
  },
);

if (!response.ok) throw new Error("DataAgent request failed");
const data = await response.json();
```

Use an application-defined JSON schema for `action` and perform request authentication before the Agent receives it. The literal payload is a constructed fixture, not an authenticated protocol.

## Streaming RPC

The current Client SDK accepts streaming handlers on `call`:

```ts
const chunks: unknown[] = [];
await client.call("streamResults", ["query"], {
  stream: {
    onChunk(chunk) {
      chunks.push(chunk);
    },
    onDone(finalChunk) {
      console.info("stream completed", {
        purpose: "stream-results",
        chunkCount: chunks.length,
        hasFinalChunk: finalChunk !== undefined,
      });
    },
    onError(_message) {
      console.info("stream failed", { purpose: "stream-results" });
    },
  },
});
```

The server must expose a compatible `@callable({ streaming: true })` method. Treat `onDone` as stream completion, not proof that a related external side effect ran; persist or retrieve the application effect receipt separately.

## Client lifecycle checklist

- Handle `undefined` state during first connection and after identity/context changes.
- Refresh credentials through `query` only if the server verifies them.
- Use `onIdentityChange` to clear local data tied to a prior session.
- Handle state-write errors and callable rejections.
- Close manually owned `AgentClient` connections.
- Do not expose sensitive instance names through identity callbacks when `sendIdentityOnConnect` is unsuitable.

This reference is source-grounded static guidance. It does not prove a package lockfile, deployed host, CORS policy, session verifier, or provider/model configuration.
