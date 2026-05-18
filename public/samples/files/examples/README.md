# Port Daddy Examples

These examples are meant to be copied into real projects. They use the current
Port Daddy SDK and CLI surfaces instead of raw localhost snippets.

Before running anything:

```bash
pd status
```

If the daemon is not running, start it with `pd start` or `pd setup`.

## Current Example Set

| Area | File | Shows |
| --- | --- | --- |
| Swarm coordination | `swarm/coordination-board.ts` | Tuple-backed work board, declared channels, locks, notes, sessions, convergence |
| Managed public previews | `tunnel/share-preview.ts` | "PD Tube" style workflow using the current `pd tunnel`/SDK tunnel surface |
| Dev tools | `devtools/agent-workbench.ts` | A tiny terminal workbench built from services, agents, sessions, tunnels, channels, locks, and tuples |
| File coordination | `coordination/file-edit-guard.ts` | Claim, inspect, and release file-edit ownership |
| Typed protocol wrapper | `coordination/agent-protocol.ts` | Reusable TypeScript wrapper for pub/sub, locks, questions, answers, and notes |
| Migrations | `locks/migration-guard.ts` | Safe one-agent-at-a-time migration execution with `withLock` |
| Session lifecycle | `phases/session-lifecycle.sh` | Start, claim, phase, note, and complete a Port Daddy session |
| DNS | `dns/service-discovery.ts` | Register and discover local service names through the SDK |
| Inbox | `inbox/inbox-monitor.ts` | Targeted durable agent mail |
| Services | `services/` | Small services that can be claimed, waited on, and exposed |

## Run The Highlights

```bash
# A complete multi-agent coordination pass in one process.
npx tsx examples/swarm/coordination-board.ts

# Inspect tunnel provider readiness and see the exact managed-preview flow.
npx tsx examples/tunnel/share-preview.ts inspect

# Build a local operator/devtool view from Port Daddy APIs.
npx tsx examples/devtools/agent-workbench.ts

# Exercise a real lock around critical work.
npx tsx examples/locks/migration-guard.ts
```

## Naming Note: Tube vs Tunnel

The product idea is often called "PD Tube" in design notes. The current shipped
CLI command is `pd tunnel`, and the SDK methods are `tunnelStart`,
`tunnelStatus`, `tunnelList`, `tunnelStop`, and `tunnelProviders`. Examples use
the shipped command names so they are runnable today.

## Safety

The examples use unique demo identities and short-lived tuple records. Tunnel
examples default to inspection/status commands. Starting a tunnel can expose a
local service through ngrok, cloudflared, or localtunnel, so `share-preview.ts`
requires an explicit `start` command.
