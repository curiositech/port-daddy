# Agent Inbox Examples

The Port Daddy inbox gives every daemon-minted actor a personal message queue. External callers may submit bounded content with fixed provenance, but only the exact live actor credential can read or acknowledge that inbox. Knowing an actor ID or alias grants no authority.

## When to use the inbox

Use the inbox when you need **targeted, persistent** messages between specific agents:

- Handoffs: "Schema migration complete, ready for your review."
- Blockers: "Waiting on auth types from agent-backend before I can proceed."
- Task results: "Tests passed, PR branch is ready."

For **broadcast** signals that any subscriber should hear, use pub/sub instead (`pd pub` / `pd sub`).

## Examples

### `agent-dm.sh`

A shell script demonstration of the full inbox lifecycle: mint two actors in isolated context slots, send a daemon-attributed message from Alice to Bob, read Bob's inbox with Bob's stored credential, mark it read, and clean up.

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
| `POST /agents/:id/inbox` | `pd inbox send <canonical-id> <msg>` | `pd.inboxSend(id, content)` |
| `GET /agents/:id/inbox` | `pd inbox` | `pd.inboxList(id, opts)` |
| `GET /agents/:id/inbox/stats` | `pd inbox stats` | `pd.inboxStats(id)` |
| `PUT /agents/:id/inbox/read-all` | `pd inbox read-all` | `pd.inboxMarkAllRead(id)` |

Read and acknowledgement calls present the actor credential stored by `pd begin`. The public send path accepts only `content` plus optional `contentType`; the daemon selects sender provenance, rate limits delivery, and never wakes or controls the recipient runtime.

Full reference: [docs/sdk.md](../../docs/sdk.md) — Inbox section.
