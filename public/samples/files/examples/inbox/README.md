# Agent Inbox Examples

The Port Daddy inbox gives every registered agent a personal message queue. Any caller can send a message; only the registered agent (or a caller that knows the agent ID) can read it.

## When to use the inbox

Use the inbox when you need **targeted, persistent** messages between specific agents:

- Handoffs: "Schema migration complete, ready for your review."
- Blockers: "Waiting on auth types from agent-backend before I can proceed."
- Task results: "Tests passed, PR branch is ready."

For **broadcast** signals that any subscriber should hear, use pub/sub instead (`pd pub` / `pd sub`).

## Examples

### `agent-dm.sh`

A shell script demonstration of the full inbox lifecycle: register two agents, send a message from Alice to Bob, read Bob's inbox, mark all read, clear, and clean up.

```bash
bash examples/inbox/agent-dm.sh
```

### `inbox-monitor.ts`

A TypeScript polling monitor: polls an agent's inbox every 5 seconds, prints unread messages, and marks them as read.

```bash
# Monitor your agent's inbox
npx tsx examples/inbox/inbox-monitor.ts my-agent-id
```

## API Summary

| HTTP | CLI | SDK |
|------|-----|-----|
| `POST /agents/:id/inbox` | `pd inbox send <id> <msg>` | `pd.inboxSend(id, content, opts)` |
| `GET /agents/:id/inbox` | `pd inbox` | `pd.inboxList(id, opts)` |
| `GET /agents/:id/inbox/stats` | `pd inbox stats` | `pd.inboxStats(id)` |
| `PUT /agents/:id/inbox/read-all` | `pd inbox read-all` | `pd.inboxMarkAllRead(id)` |
| `DELETE /agents/:id/inbox` | `pd inbox clear` | `pd.inboxClear(id)` |

Full reference: [docs/sdk.md](../../docs/sdk.md) — Inbox section.
