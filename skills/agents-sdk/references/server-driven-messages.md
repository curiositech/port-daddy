# Server-driven messages

**Primary source read 2026-09-24:** Cloudflare [Autonomous responses](https://developers.cloudflare.com/agents/communication-channels/chat/autonomous-responses/) (overview, stability guard, schedule/webhook/email patterns, persistence, response hooks, client flags, concurrency, and cancellation) and [Chat agents](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/) (chat lifecycle and current client hook). A schedule, webhook, email, or another Agent can create a server-driven turn. It does not by itself authorize a user interruption, contact, or external effect.

## Choose the primitive

| Primitive | What it does | When to use it |
| --- | --- | --- |
| `saveMessages` | persists messages and waits for the triggered `onChatMessage` turn to finish | caller can wait for the response |
| `submitMessages` | durably accepts a Think turn and returns a submission receipt | webhook/RPC caller needs a quick durable acknowledgement and later inspection |
| `persistMessages` | stores and broadcasts messages without starting a model turn | silent context for a later turn |
| `onChatResponse` | runs after every completed turn, including framework-initiated ones | react to a result regardless of its trigger |

`saveMessages((messages) => ...)` reads the latest persisted transcript when it executes. Its function form avoids a stale baseline when several triggers queue. `submitMessages` accepts serializable `UIMessage[]`, not that function form.

## Stabilize before an out-of-band turn

Call `waitUntilStable()` before reading `this.messages` or calling `saveMessages` from schedules, webhooks, email, and other non-chat entry points. It waits for a stream, pending client-tool interaction, and queued continuations to settle.

```ts
const stable = await this.waitUntilStable({ timeout: 30_000 });
if (!stable) {
  // Constructed operational event; no raw message, credential, or request body.
  console.info("server-trigger skipped", {
    purpose: "chat-stability",
    trigger: "scheduled-digest",
  });
  return;
}
```

The 30-second value is the current Cloudflare example's fixture, not a universal timeout. A false result means the turn was not started; decide whether to drop, reschedule, or persist work as an application policy.

## Scheduled digest

Cron schedules are idempotent by default for the same callback, cron expression, and payload. The callback below is declared before it is scheduled and uses the current `UIMessage.parts` representation.

```ts
// Add this method to an existing, configured AIChatAgent. It is not a complete
// model setup: its onChatMessage implementation and provider binding belong to
// that application and were not typechecked here.
async onStart() {
    await this.schedule("0 9 * * *", "dailyDigest");
}

async dailyDigest() {
    const stable = await this.waitUntilStable({ timeout: 30_000 });
    if (!stable) return;

    await this.saveMessages((messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [
          {
            type: "text",
            text: "Summarize eligible activity since the previous digest.",
          },
        ],
        createdAt: new Date(),
      },
    ]);
    // saveMessages has returned only after the model response is persisted.
}
```

Record an application operation key before an external notification, and recheck recipient eligibility at the effect boundary. A successfully persisted chat turn is not proof that a downstream email, push, or payment completed.

## Persist context without a model response

`persistMessages` is useful when a background event should be visible to the next model turn but must not immediately interrupt the conversation.

```ts
async addBackgroundContext(summary: string) {
  const stable = await this.waitUntilStable({ timeout: 30_000 });
  if (!stable) return;

  await this.persistMessages([
    ...this.messages,
    {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: `[Background context]: ${summary}` }],
      createdAt: new Date(),
    },
  ]);
}
```

Validate and minimize `summary` before adding it to a model-visible transcript. The method stores and broadcasts the message but does not invoke `onChatMessage`.

## Webhook: accept durable work when the caller cannot wait

For an HTTP provider that retries and expects a prompt response, validate the provider signature and payload before using `submitMessages`. The following application validator deliberately returns only a narrow event record; the literal message is a constructed internal task, not a claim that any incoming JSON is trusted.

```ts
async onRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return super.onRequest(request);

  const event = await verifyWebhookEvent(request, this.env.WEBHOOK_SECRET);
  if (!event) return new Response("Unauthorized", { status: 401 });

  const submission = await this.submitMessages(
    [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Process verified event ${event.kind} with id ${event.id}.`,
          },
        ],
      },
    ],
    { idempotencyKey: event.id },
  );

  return Response.json({
    submissionId: submission.submissionId,
    accepted: submission.accepted,
    status: submission.status,
  });
}
```

`verifyWebhookEvent` is application-owned: it must authenticate the provider, verify a replay-resistant event identity, validate the event shape, and authorize the event's target Agent. Do not call `request.json()` and interpolate arbitrary payloads into a model message as if JSON parsing authenticated it.

## Email and queue triggers

For an email or queued task, make the input boundary explicit before adding content to the transcript:

```ts
async processVerifiedQueueTask(task: { id: string; summary: string }) {
  const stable = await this.waitUntilStable({ timeout: 30_000 });
  if (!stable) return { status: "busy" as const };

  await this.saveMessages((messages) => [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: task.summary }],
      createdAt: new Date(),
    },
  ]);
  // This proves only that the transcript/model turn was saved. A separate,
  // idempotent application effect receipt is required to call task work done.
  return { status: "transcript_saved" as const, taskId: task.id };
}
```

This method expects a task already validated and authorized by its queue consumer. It is not an email parser or a provider-verification routine. Keep untrusted raw email, webhook, and queue payloads out of diagnostics and model prompts until their application-specific validation/redaction step completes.

## React after any completed response

`onChatResponse` observes user messages, `saveMessages`, and automatic continuations. Use its finalized `ChatResponseResult` fields and avoid the old `result.type === "finish"` check. Do not use text chosen by a model as a control signal.

```ts
import { AIChatAgent, type ChatResponseResult } from "@cloudflare/ai-chat";

type ContinuationSignal = {
  kind: "research_followup" | "review_followup";
  originRequestId: string;
};
type ReservedContinuation = { signal: ContinuationSignal; remainingAfterReserve: number };
type ContinuationStore = {
  // Application-owned atomic operation: returns null when no typed signal is
  // pending or its finite budget is exhausted; decrements before dispatch.
  reserveOneAfterTurn(requestId: string): Promise<ReservedContinuation | null>;
};

// Illustrative and untypechecked: continuationStoreFor and continuationPrompt
// are application-defined helpers, not SDK methods. Test store atomicity and
// schema independently before using the sketch.
class FollowUpAgent extends AIChatAgent<Env> {
  protected async onChatResponse(result: ChatResponseResult) {
    if (result.status !== "completed") return;
    // Application factory over this object's storage; not an SDK method or
    // a third constructor parameter supplied by the Workers runtime.
    const continuations: ContinuationStore = continuationStoreFor(this.ctx.storage);
    const reserved = await continuations.reserveOneAfterTurn(result.requestId);
    if (!reserved) return; // no application signal, or budget already exhausted
    await this.saveMessages((messages) => [
      ...messages,
      { id: crypto.randomUUID(), role: "user",
        parts: [{ type: "text", text: continuationPrompt(reserved.signal.kind) }],
        createdAt: new Date() },
    ]);
  }
}
```

Create the typed signal only in trusted application workflow code, with a finite requested budget. `reserveOneAfterTurn` must atomically consume a budget unit before `saveMessages` dispatches; a comment, a mutable local counter, or a lexical marker does not prevent an unbounded chain across turns/restarts. The SDK sequentially drains hooks, but sequential execution alone is not a budget.

## Client status for server turns

```tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

function Chat() {
  const agent = useAgent({ agent: "ChatAgent" });
  const { messages, sendMessage, isStreaming, isServerStreaming } =
    useAgentChat({ agent });

  return (
    <div>
      {messages.map((message) => <div key={message.id}>{/* render parts */}</div>)}
      {isServerStreaming && <p>Agent is working in the background…</p>}
      <button disabled={isStreaming} onClick={() => sendMessage({ text: "Continue" })}>
        Continue
      </button>
    </div>
  );
}
```

`status` remains the client-initiated AI SDK lifecycle. `isServerStreaming` is true for a server-triggered stream, while `isStreaming` covers either client or server work and is the usual flag for disabling duplicate submission.

## Concurrency and cancellation

`messageConcurrency` affects user `sendMessage()` submissions. `saveMessages()` uses serialized behavior regardless, so server-triggered turns queue and execute in order rather than being dropped, merged, or debounced.

When the same Durable Object starts and owns a server turn, pass an `AbortSignal` to `saveMessages` if the application has a real cancellation event. Cancellation changes model-turn lifetime; it does not roll back a completed tool or other external effect. Persist an operation receipt for effects that must not repeat.

## Source limits

This reference is based on public documentation read on 2026-09-24. It has not invoked a model, schedule, webhook provider, mailbox, queue, browser, or notification service. Code is illustrative and not package-typechecked. The examples keep current public message shapes and helper names while leaving model setup, provider credentials, verifier implementation, data handling, consent, durable continuation-store implementation, and external-effect policy to the application.
