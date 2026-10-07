# Queue tasks and retries

Primary sources read 2026-09-24: [Queue tasks](https://developers.cloudflare.com/agents/runtime/execution/queue-tasks/) and [Retries](https://developers.cloudflare.com/agents/runtime/execution/retries/). Queue tasks are SQLite-backed FIFO work owned by an Agent. Retry behavior repeats a callback after a thrown error; it does not settle an external outcome.

## Queue lifecycle

    type Mail = { operationKey: string; recipientId: string; summary: string };

    class MailAgent extends Agent {
      async accept(mail: Mail) {
        // Validate/authorize before admitting durable work.
        const taskId = await this.queue("processMail", mail, {
          retry: { maxAttempts: 5 }, // constructed local policy
        });
        return { status: "accepted", taskId, operationKey: mail.operationKey };
      }

      async processMail(mail: Mail, item: QueueItem<Mail>) {
        const prior = await this.findEffectReceipt(mail.operationKey);
        if (prior?.status === "completed") return;
        await this.recordAttempt(item.id, mail.operationKey);
        await this.deliverOrRecordUnknown(mail);
      }
    }

The documented queue signature returns a task ID. QueueItem contains an ID, payload, callback, created timestamp, and optional retry configuration. The queue validates the callback, processes tasks FIFO, removes successfully executed tasks, stores tasks through restart, and retries a throwing callback with configured RetryOptions.

The documented management methods are dequeue(id), dequeueAll(), dequeueAllByCallback(callback), getQueue(id), and getQueues(key, value). Removing a task is queue management, not reversal of an already dispatched provider request.

## Retry classification and unknown outcomes

    // Local example: retry only an authorized, repeatable HTTP read.
    // This is not an SDK error class or a policy for provider writes.
    class ReadFailure extends Error {
      constructor(readonly kind: "http" | "transport", readonly status?: number) {
        super("read failed");
      }
    }
    const retryableStatuses = new Set([429, 502, 503, 504]); // local policy
    const result = await this.retry(
      async () => {
        let response: Response;
        try {
          response = await fetch(authorizedReadUrl, { method: "GET" });
        } catch {
          throw new ReadFailure("transport");
        }
        if (!response.ok) throw new ReadFailure("http", response.status);
        return response.json();
      },
      {
        maxAttempts: 3,
        shouldRetry: (error, nextAttempt) =>
          nextAttempt <= 3 && error instanceof ReadFailure &&
          (error.kind === "transport" || retryableStatuses.has(error.status ?? 0)),
      },
    );

The typed classifier leaves invalid JSON, programming errors and HTTP authorization
failures outside this retry set. Supply request timeout, backoff, rate-limit handling
and the allowed destination in application policy. Never classify an error by a
substring of its human-readable message. A transport retry is appropriate here
only because this example's operation is a repeatable read.

The retry callback receives a one-indexed attempt; thrown errors retry by default, while shouldRetry can classify an error for this call. Queue/schedule callbacks use serializable retry options rather than this function predicate. Do not carry source defaults or a sample attempt count into product policy.

Classify invalid input and authorization failure as terminal. For timeout/disconnect after a provider request, persist the attempt and lookup/receipt key, then retain unknown until a provider readback or an explicit retry/compensation policy resolves it. Queue acceptance, a task ID, and a successful handler return are distinct evidence claims.

Examples are illustrative and package-untypechecked. No queue, retry, fetch, or provider request ran.
