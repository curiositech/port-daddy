# Agent Inbox: Direct Messaging

**Difficulty:** Intermediate | **Time:** 8 min

You've got four agents running in parallel — one building an API, one running tests, one writing migrations, one updating docs. Pub/sub is great for broadcasting "I'm done," but sometimes you need to tell one specific agent something private: "The schema changed. Update your types before you run the next test suite."

That's the inbox.

## What the Inbox Is

Every registered agent gets a personal message queue. Any caller can deliver a message; only the intended recipient reads it. Messages are persistent — they sit in the inbox until read or cleared, unlike pub/sub which delivers to current subscribers only.

```
pub/sub channel  →  everyone subscribed hears it
agent inbox      →  only the named agent receives it
```

## Registration is the Inbox Address

The inbox exists as long as the agent is registered. Registration creates the address:

```bash
# Register yourself — this creates your inbox
pd agent register --agent my-agent --purpose "Building the payment API"

# Now other agents (or humans) can message you:
pd inbox send my-agent "Hey, the stripe webhook secret changed"
```

Using the SDK:

```javascript
const pd = new PortDaddy({ agentId: 'my-agent' });
await pd.register({ type: 'ci', purpose: 'Building the payment API' });
// Inbox is now live at: POST /agents/my-agent/inbox
```

## Sending Messages

### CLI

```bash
# Basic message
pd inbox send agent-bob "Schema migration complete, ready for review"

# From the API (curl)
curl -X POST http://localhost:9876/agents/agent-bob/inbox \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Schema migration complete, ready for review",
    "from": "agent-alice",
    "type": "handoff"
  }'
```

### SDK

```javascript
await pd.inboxSend('agent-bob', 'Schema migration complete, ready for review', {
  from: 'agent-alice',
  type: 'handoff',
});
```

**Message types** are free-form strings. Common conventions:
- `message` — general note
- `handoff` — "I finished X, you can proceed with Y"
- `alert` — "Something needs your attention"
- `result` — "Here's the output of a task"

## Reading Your Inbox

### CLI

```bash
# Read your inbox (all messages)
pd inbox

# Output:
# [09:42:15] [handoff] From agent-alice: Schema migration complete, ready for review
# [09:38:02] [alert]   From system: Lock db-migrations held >30m
```

### SDK

```javascript
// All messages
const { messages } = await pd.inboxList('my-agent');

// Unread only
const { messages } = await pd.inboxList('my-agent', { unreadOnly: true });

// With pagination
const { messages } = await pd.inboxList('my-agent', { limit: 20, since: '2026-01-01T00:00:00Z' });

// Print each message
for (const msg of messages) {
  const ts = new Date(msg.createdAt).toISOString().slice(11, 19);
  console.log(`[${ts}] [${msg.type}] From ${msg.from ?? 'system'}: ${msg.content}`);
}
```

**InboxMessage shape:**
```typescript
interface InboxMessage {
  id: string;
  agentId: string;    // recipient
  from?: string;      // sender (optional, free-form)
  content: string;
  type: string;
  read: boolean;
  createdAt: string;  // ISO 8601
}
```

## Stats, Mark Read, Clear

```bash
# Stats
pd inbox stats
# Total: 5, Unread: 2

# Mark all read
pd inbox read-all

# Clear the inbox entirely
pd inbox clear
```

SDK equivalents:

```javascript
// Stats
const { total, unread } = await pd.inboxStats('my-agent');

// Mark one message read
await pd.inboxMarkRead('my-agent', messageId);

// Mark all read
await pd.inboxMarkAllRead('my-agent');

// Clear inbox — returns count deleted
const { deleted } = await pd.inboxClear('my-agent');
```

## Polling for New Messages

A common pattern for agents that process inbox messages in the background:

```typescript
import { PortDaddy } from 'port-daddy/client';

const pd = new PortDaddy({ agentId: 'my-agent' });

async function poll(): Promise<void> {
  const { messages } = await pd.inboxList('my-agent', { unreadOnly: true });
  for (const msg of messages) {
    console.log(`[${msg.type}] ${msg.from ?? 'system'}: ${msg.content}`);
    // Handle the message...
    await pd.inboxMarkRead('my-agent', msg.id);
  }
}

// Poll every 10 seconds
setInterval(poll, 10_000);
poll();
```

See `examples/inbox/inbox-monitor.ts` for a complete working example.

## A Real Workflow: Migration Handoff

Here is a four-agent workflow where agents communicate task completion through the inbox:

**Agent: db-agent** — runs migrations, messages api-agent when done

```bash
# db-agent runs migrations
npx prisma migrate dev
pd inbox send api-agent "Migrations complete. New tables: payments, refunds." \
  --from db-agent --type handoff
pd note "Migrations deployed, signaled api-agent"
```

**Agent: api-agent** — waits for the signal, then proceeds

```javascript
// Poll inbox, waiting for the handoff
async function waitForMigrations(): Promise<void> {
  while (true) {
    const { messages } = await pd.inboxList('api-agent', { unreadOnly: true });
    const handoff = messages.find(
      (m) => m.from === 'db-agent' && m.type === 'handoff'
    );
    if (handoff) {
      console.log('Got handoff:', handoff.content);
      await pd.inboxMarkRead('api-agent', handoff.id);
      break;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

await waitForMigrations();
// Now safe to start the API
```

## Inbox vs Pub/Sub: Choosing the Right Tool

| Situation | Use |
|-----------|-----|
| "Tell agent-bob one specific thing" | Inbox |
| "Signal all subscribers that the build is ready" | Pub/Sub |
| "Deliver a task result that must not be lost" | Inbox |
| "Broadcast status to a monitoring dashboard" | Pub/Sub |
| "Handoff context from one agent to another" | Inbox |
| "Coordinate work across an unknown number of agents" | Pub/Sub |

The inbox is persistent — messages wait until retrieved. Pub/sub is ephemeral — only current subscribers receive messages at publish time.

## Inbox Limits

- **1000 messages** per agent inbox. Old messages are dropped when the limit is reached.
- Messages have no TTL — they stay until read or explicitly cleared.
- There is no SSE/push notification for inbox messages; poll with `inboxList({ unreadOnly: true })`.

## What's Next

- `examples/inbox/agent-dm.sh` — Shell script walkthrough of the full inbox lifecycle
- `examples/inbox/inbox-monitor.ts` — TypeScript polling monitor
- [Multi-Agent Orchestration tutorial](02-multi-agent-orchestration.md) — Sessions, pub/sub, and locks
- [SDK Reference: Inbox](../../docs/sdk.md) — Full method signatures
