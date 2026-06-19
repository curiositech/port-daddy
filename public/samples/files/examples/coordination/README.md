# Coordination Patterns

Port Daddy coordination is a small set of durable primitives:

| Primitive | CLI | SDK | Use it for |
| --- | --- | --- | --- |
| Sessions | `pd begin`, `pd done`, `pd session files add` | `begin()`, `done()`, `claimFiles()` | Work identity, notes, file claims, attribution |
| Channels | `pd channels ensure`, `pd pub`, `pd sub` | `ensureChannel()`, `publish()`, `subscribe()` | Broadcast events and discoveries |
| Tuple space | `pd tuple out`, `pd tuple rd`, `pd tuple in` | `tupleOut()`, `tupleRd()`, `tupleIn()` | Shared queryable state for swarms |
| Locks | `pd lock`, `pd with-lock` | `withLock()` | Critical sections that must be exclusive |
| Notes | `pd note`, `pd notes` | `note()`, `notes()` | Durable human-readable trail |
| Inbox | `pd inbox send` | `inboxSend()` | Targeted handoffs to one agent |

## Recommended Pattern

Use sessions for identity, channels for live notification, tuples for durable
coordination state, and locks only around the short critical section.

```typescript
import { PortDaddy } from '../../lib/client.js';

const pd = new PortDaddy({ agentId: 'agent-scout' });
const { sessionId } = await pd.begin('Investigate flaky checkout test', {
  lifecycle: 'durable',
  identity: 'myapp:test:checkout-flake',
  files: ['tests/checkout.test.ts'],
});

await pd.ensureChannel('myapp:checkout-flake', {
  scope: 'worktree',
  projectDir: process.cwd(),
});

await pd.tupleOut(['finding', 'checkout-flake', { file: 'checkout.test.ts' }], {
  harbor: 'myapp',
  writtenBy: 'agent-scout',
  ttlMs: 30 * 60 * 1000,
});

await pd.publish('myapp:checkout-flake', {
  agent: 'agent-scout',
  type: 'finding',
  message: 'The flaky assertion depends on stale localStorage state.',
  ts: Date.now(),
});

await pd.done('Published checkout flake finding', { sessionId });
```

## Runnable Examples

```bash
# Complete tuple-backed swarm board.
npx tsx examples/swarm/coordination-board.ts

# File edit coordination helper.
npx tsx examples/coordination/file-edit-guard.ts status examples/README.md

# Typed helper you can import into your own scripts.
npx tsx -e "import { createCoordinator } from './examples/coordination/agent-protocol.ts'; console.log(createCoordinator('demo-agent').id)"
```

## When To Pick What

- Use `pd session files add` or `claimFiles()` for edit intent.
- Use `pd tuple out` when another agent or tool should query the fact later.
- Use `pd pub` for "wake up and look at this" signals.
- Use `pd lock` / `withLock()` only while performing a non-mergeable action.
- Use inboxes for direct handoffs to a known agent or durable role.
