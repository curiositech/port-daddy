# State and scheduling

Sources read 2026-09-24: Cloudflare [Store and sync state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/), [Schedule tasks](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/), and [WebSocket lifecycle hooks](https://developers.cloudflare.com/agents/runtime/communication/websockets/). State and schedules belong to one Agent instance's SQLite-backed Durable Object; they survive restarts and hibernation. That persistence does not authorize a client-originated state change or an eventual external effect.

## State management

### Define typed state

`initialState` supplies the first persisted state for a new instance. On later wakes the persisted state is used; without `initialState`, `this.state` can be `undefined`. The second `Agent` generic gives TypeScript the state shape.

```ts
import { Agent, Connection } from "agents";

type ListState = {
  count: number;
  items: string[];
};

export class ListAgent extends Agent<Env, ListState> {
  initialState: ListState = { count: 0, items: [] };
}
```

### Read and replace state

`setState()` replaces the complete state object: it persists to SQLite, broadcasts to connected eligible clients, then invokes `onStateChanged()` best-effort. The old abbreviated `{ count: ... }` update was invalid for the declared `count` plus `items` shape. Preserve the other field with a spread:

```ts
add(item: string) {
  const current = this.state; // Persisted state, lazy initialized on first access.
  this.setState({
    ...current,
    count: current.count + 1,
    items: [...current.items, item],
  });
}
```

State is JSON-serialized: use plain objects, arrays, and primitives; write dates as ISO strings. Keep large history and queryable collections in SQL rather than broadcasting them as state on every change.

### Validate before persistence; react after

`validateStateChange(nextState, source)` is the synchronous, gating hook. It runs before persistence and broadcast; throwing aborts the update. `onStateChanged(state, source)` is the post-broadcast notification hook and must not be used as a rejection mechanism.

```ts
function requireListState(value: unknown): ListState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("state must be an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "count" && key !== "items")) {
    throw new Error("unexpected state field");
  }
  const { count, items } = record;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("count must be a non-negative integer");
  }
  if (!Array.isArray(items) || !items.every(
    (item) => typeof item === "string" && item.length <= 200,
  )) {
    throw new Error("items must be strings of at most 200 characters");
  }
  if (count !== items.length) {
    throw new Error("count must match items");
  }
  return { count, items };
}

// Application contract: synchronous lookup of a verified, unexpired,
// instance-scoped state-write grant at the current authority epoch.
// Throw if evidence is missing, stale, revoked, or unavailable.
declare function requireCurrentStateWriteAuthority(source: Connection): void;

validateStateChange(nextState: ListState, source: Connection | "server") {
  // TypeScript annotations do not validate a WebSocket-provided value at runtime.
  requireListState(nextState as unknown);
  if (source !== "server") requireCurrentStateWriteAuthority(source);
}

onStateChanged(state: ListState, source: Connection | "server") {
  console.info("state changed", {
    purpose: "state-observability",
    count: state.count,
    source: source === "server" ? "server" : "connection",
  });
  // Notification or side effect only; it cannot roll back this state update.
}
```

The documented sequence is: validate synchronously, persist, broadcast (except connections opting out of protocol messages), then call `onStateChanged()` best-effort. Treat source as attribution information, not proof of an application's identity or authorization policy.

### Client-side React sync

`useAgent` receives synchronized state and can issue a client state update. The callback is a view-update point; authoritative restrictions still belong in `validateStateChange` and in the application's request/connection authorization path.

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";

function ListView() {
  const [state, setState] = useState<ListState | null>(null);
  const agent = useAgent({
    agent: "list-agent",
    name: "instance-1",
    onStateUpdate: (nextState) => {
      // The documented hook does not promise a ListState generic. Validate wire data.
      setState(requireListState(nextState));
    },
  });

  const add = (item: string) => {
    if (!state) return; // State has not yet synchronized.
    agent.setState({
      ...state,
      count: state.count + 1,
      items: [...state.items, item],
    });
  };

  return (
    <button disabled={!state} onClick={() => add("next")}>
      Count: {state?.count ?? "loading"}
    </button>
  );
}
```

This mirrors the documented `useAgent({ agent, name, onStateUpdate })` option shape and intentionally does not claim a state-type generic signature that the reviewed docs do not show. For non-React clients, `AgentClient` from `agents/client` uses the same `onStateUpdate` and `setState` pattern. This whole-state replacement example does not preserve concurrent additive edits: two clients can overwrite each other. Use an authorized server append operation or an atomic expected-revision update when additions must be retained. Avoid optimistic state mutations that cannot tolerate a later validation rejection; if a UI uses them, reconcile from the synchronized state.

## SQL API

Each Agent instance has its own SQLite database through `this.sql`. The current state guide documents tagged-template queries and a generic result type; preserve query parameters as interpolated values rather than concatenating untrusted strings into SQL.

```ts
type ItemRow = { id: string; name: string; created_at: number };

installSchema() {
  this.sql`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `;
}

saveItem(id: string, name: string) {
  this.sql`INSERT INTO items (id, name) VALUES (${id}, ${name})`;
}

findItemById(id: string): ItemRow[] {
  return this.sql<ItemRow>`
    SELECT id, name, created_at FROM items WHERE id = ${id}
  `;
}
```

This is a structural identifier lookup. For search over free-text names or content, follow the corpus-policy hybrid retrieval contract; a LIKE substring query does not satisfy it. The generic is TypeScript inference for returned rows, not runtime validation. Validate incoming data before it reaches SQL, define migrations and retention in the application, and query historical/large data from SQL while keeping state small.

## Scheduling

Scheduled tasks are stored in SQLite, survive Agent restarts, and invoke ordinary Agent methods. A numeric delay is seconds; `Date` schedules one occurrence; a cron string uses `minute hour day month weekday`; and `scheduleEvery` repeats at a fixed interval.

| Mode | Current form | Typical use |
| --- | --- | --- |
| Delay | `this.schedule(60, "checkStatus", payload)` | deferred check or debounce |
| Date | `this.schedule(new Date(...), "sendGreeting", payload)` | one-time appointment |
| Cron | `this.schedule("0 9 * * 1-5", "weekdayReport", payload)` | calendar recurrence |
| Interval | `this.scheduleEvery(30, "pollUpdates", payload)` | periodic polling |

The following is a constructed fixture for the documented forms; it does not create a schedule during this documentation build. The fixed date is deliberately in 2026.

```ts
await this.schedule(60, "checkStatus", { id: "job-1" });
await this.schedule(new Date("2026-12-25T00:00:00Z"), "sendGreeting", { to: "user-1" });
await this.schedule("0 9 * * 1-5", "weekdayReport", { workspaceId: "w1" });
await this.scheduleEvery(30, "pollUpdates", { source: "api" });
```

### Handlers, inspection, and cancellation

The callback must name a method that exists on the Agent. Creation returns a `Schedule` with an ID, callback, payload, next execution time, and mode information. Store that ID when a caller must later cancel the work.

```ts
async sendGreeting(payload: { to: string }) {
  console.info("greeting scheduled", {
    purpose: "scheduled-greeting",
    hasRecipient: payload.to.length > 0,
  });
  // Recheck current target, authorization, and deduplication before any external effect.
}

async inspectAndCancel(scheduleId: string) {
  const schedule = await this.getScheduleById(scheduleId);
  if (!schedule) return { status: "already-absent" as const };

  const cancelled = await this.cancelSchedule(schedule.id);
  return { status: cancelled ? "cancelled" : "already-absent" as const };
}

async listCronSchedules() {
  return this.listSchedules({ type: "cron" });
}
```

`getSchedules()` and synchronous `getSchedule()` are deprecated; use `await this.listSchedules(criteria)` and `await this.getScheduleById(id)`. `cancelSchedule(id)` returns `false` when the task is absent, including when it already executed. The original code's `getSchedules({ type: "cron" })` is therefore retained as an inspection intent but corrected to `await this.listSchedules({ type: "cron" })`.

### Intervals, retries, and duplicate recovery

`scheduleEvery` first runs after the requested seconds. If an interval callback is still running when the next turn is due, the next execution is skipped rather than queued; an error fails that execution but leaves the interval active. The public API accepts documented retry options:

```ts
await this.schedule(60, "checkStatus", { id: "job-1" }, {
  retry: { maxAttempts: 3 },
  idempotent: true,
});
await this.scheduleEvery(30, "pollUpdates", { source: "api" }, {
  retry: { maxAttempts: 2 },
});
```

Cron schedules are idempotent by default for the same callback, cron expression, and payload. Delayed and date schedules default to non-idempotent; opt in with `idempotent: true`, particularly if installing them from `onStart()`. `scheduleEvery` is idempotent for the same callback, interval, and payload. Those SDK deduplication rules do not make an external handler exactly once: record an application operation key before a payment, notification, or write, and make the handler tolerate replay after a restart, retry, or cancellation race.

### Lifecycle callbacks

These documented lifecycle hooks retain the original setup and connection examples. Cloudflare documents both a server-level `onError(error)` and a connection-level `onError(connection, error)` hook; this example keeps the server-level form from the original file rather than defining two TypeScript method bodies with the same name:

```ts
import { Agent, Connection, ConnectionContext, WSMessage } from "agents";

export class LifecycleAgent extends Agent<Env, ListState> {
  initialState: ListState = { count: 0, items: [] };

  async onStart() {
    // Rebuild ephemeral memory; persisted state, SQL, and schedules already survive a wake.
    await this.scheduleEvery(300, "pollUpdates", { source: "startup" });
  }

  async pollUpdates(payload: { source: string }) {
    // Concrete scheduled method: preserve the declared count/items invariant.
    const state = this.state;
    this.setState({ ...state, count: state.items.length });
    console.info("scheduled poll finished", {
      purpose: "state-invariant-check",
      source: payload.source,
      itemCount: state.items.length,
    });
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // This is an application-owned verifier, configured with issuer, audience,
    // signature keys, expiry checks, and the per-agent authorization decision.
    // Merely finding a token in a URL is never authentication.
    const identity = await verifyUpgradeAuthorization(ctx.request, this.env.AUTH);
    if (!identity) {
      connection.close(4001, "Unauthorized");
      return;
    }
    connection.setState({ subject: identity.subject });
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (message === "ping") {
      connection.send(JSON.stringify({ type: "pong", purpose: "liveness" }));
      return;
    }
    connection.send(JSON.stringify({ type: "error", code: "unsupported-message" }));
  }

  onStateChanged(state: ListState, source: Connection | "server") {
    console.info("state changed", {
      purpose: "state-observability",
      count: state.count,
      source: source === "server" ? "server" : "connection",
    });
  }

  onError(error: unknown) {
    console.error("server error", {
      purpose: "agent-error-observability",
      kind: error instanceof Error ? error.name : typeof error,
    });
  }
}
```

Authenticate and authorize the requested instance before routing the upgrade, as described in [routing.md](routing.md); onConnect verification is defense in depth and closing afterward cannot undo disclosure that already occurred. `verifyUpgradeAuthorization` is deliberately not a token-presence helper: implement it with an application-selected, separately configured verifier that returns `{ subject }` only after credential verification and per-instance authorization. If that verifier is unavailable, return `null` and close the connection. The example logs only a declared purpose, source class, and item count; it does not log the raw request, connection object, credential, or message body.

`onStart` runs when the Agent starts before connections; it is not a once-ever initialization transaction. If it registers a delayed or Date schedule, request `idempotent: true` or inspect existing schedules first. Test wake/restart before firing, duplicate submission, cancellation versus execution, expired authority, interval overrun, retry behavior, and a stale task that reaches an external-effect boundary after its useful time.
