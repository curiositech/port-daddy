# Callable methods

Primary source read 2026-09-24: [Cloudflare Callable methods](https://developers.cloudflare.com/agents/runtime/lifecycle/callable-methods/), including basic RPC, client forms, serialization, streaming, typed stubs, and errors. The callable decorator exposes an Agent method over WebSocket RPC to browsers, mobile clients, or external services. A Worker or peer Agent in the same Worker uses Durable Object RPC directly.

## Basic command and client forms

    import { Agent, callable } from "agents";
    type State = { count: number; items: string[] };

    export class CounterAgent extends Agent<Env, State> {
      initialState: State = { count: 0, items: [] };

      @callable()
      increment(): number {
        if (!Number.isSafeInteger(this.state.count) || this.state.count >= Number.MAX_SAFE_INTEGER)
          throw new Error("counter outside domain");
        this.setState({ ...this.state, count: this.state.count + 1 });
        return this.state.count;
      }

      @callable()
      async addItem(item: string): Promise<string[]> {
        if (typeof item !== "string" || item.length === 0)
          throw new Error("invalid item"); // add application length/quota checks
        this.setState({ ...this.state, items: [...this.state.items, item] });
        return this.state.items;
      }
    }

    const count = await agent.stub.increment();  // recommended typed form
    const items = await agent.stub.addItem("new item");
    const sameCount = await agent.call("increment"); // also documented

Use explicit JSON value shapes for WebSocket RPC. Functions and object identity do not survive JSON transport; a Date can stringify to a timestamp string but is not transported as a Date instance, and Map/Set contents need explicit conversion. The documentation lists those rich types as unsupported; encode/decode deliberately rather than relying on a round trip. A void callable still resolves a client Promise when the method completes. Exceptions propagate to the caller, so return expected domain outcomes deliberately and avoid exposing raw internal failures.

## Streaming calls

    import { Agent, callable, type StreamingResponse } from "agents";

    export class SearchAgent extends Agent {
      @callable({ streaming: true })
      async streamResults(stream: StreamingResponse, query: string) {
        for await (const item of searchAuthorizedCorpus(query)) stream.send(item);
        stream.end({ complete: true });
      }
    }

    await agent.call("streamResults", ["release notes"], {
      stream: { onChunk: render, onDone: showComplete, onError: showError },
    });

The source documents send(chunk), end(finalChunk?), and error(message). Close or error every stream; RPC completion proves transport completion, not an external task effect.

## Authority, idempotency, and lifetime

Treat a callable as a public command boundary: authenticate the connection, authorize the selected instance and payload, validate input at runtime, and bind an idempotency key before non-idempotent work. A disconnected client, timeout, or RPC error does not prove the method did not start or that a provider effect did not occur. Persist an application effect receipt and expose a separate status/readback path for work that outlives the RPC.

The snippets are illustrative and untypechecked in this bundle. No package, Worker, WebSocket, or external service ran.
