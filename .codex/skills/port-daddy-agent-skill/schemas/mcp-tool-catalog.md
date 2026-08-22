# MCP Tool Catalog

Authoritative source: `mcp/server.ts` in the port-daddy repo.

These are the tools the Port Daddy MCP server exposes. They are the **preferred surface** for agents — they wrap the daemon's HTTP API with sane defaults and are designed for agent use, not human terminal use.

## Quick map: tool → CLI equivalent

| MCP tool | CLI equivalent | When to use the tool |
|---|---|---|
| `whoami` | `pd whoami` | First call of every session. |
| `begin_session` | `pd begin --purpose "..." --identity ... --lifecycle durable` | Start of agent work. |
| `end_session_full` | `pd done` | End of agent work. |
| `add_note` | `pd note "…" --type …` | Audit trail; checkpoint progress. |
| `sitrep` (alias: `catch_me_up`) | `pd sitrep` / `pd look` | Resuming, salvaging, or context-switching in. |
| `claim_port` | `pd claim <identity>` | Booting a dev server / service. |
| `release_port` | `pd release <identity>` | Shutting it down. |
| `list_services` | `pd services` | "What's running right now?" |
| `acquire_lock` | `pd lock <name>` | Mutex for fragile operations (db migration, deploy). |
| `coordination_preflight` | (no direct CLI) | Before touching files: "is anyone else here?" |
| `swarm_awareness` | `pd swarm` | Inside a fleet: "what is the swarm doing?" |
| `pd_discover` | `pd discover` | "What primitives does this daemon support?" |
| `drop_feedback` | (writes `.spark/feedback/...`) | Dogfooding bug reports. |
| `fleet_init` | `pd fleet init` | Scaffold `pd-fleet.yml`. |
| `spawn` | `pd spawn …` | Manual launch of a spawned run. |

## Always-call-first contract

Every PD-aware agent should, at session start, in this order:

1. **`whoami`** — picks up any prior session for this PID/identity.
2. **`sitrep`** — get the recent activity, salvage queue, fresh notes, and any spawned agents. Read this before deciding what to do.
3. **`begin_session`** — if no current session was returned by `whoami`, start one with explicit `--identity` and `--purpose`.

Skipping any of these is the most common dogfooding violation in this repo.

## What `sitrep` returns

```ts
interface Sitrep {
  generated_at: number
  window_minutes: number
  activity: ActivityEntry[]      // last N events (claim, lock, note, spawn, fleet)
  notes: SessionNote[]           // recent notes across sessions in scope
  salvage: SalvageEntry[]        // dead agents waiting for a claimer
  spawned: SpawnedAgent[]        // currently running fleet/spawn agents
}
```

Pass `?project=` / `?stack=` to scope. Default window is 60 minutes.

## What `coordination_preflight` answers

Given a list of files (or a directory), it returns:

- Active session file claims that overlap.
- The agent ids holding them and their `purpose`.
- Whether the daemon recommends proceeding, deferring, or asking.

This is **advisory**. PD does not enforce — it tells you what's happening and lets the agent decide. If you proceed despite a conflict, that's a `coordination:inconsistency` situation; write a note explaining why.

## What `swarm_awareness` returns

A **bounded digest** of the active-agent roster — the "look around the room" tool when you wake up as an agent:

- Every active agent: identity, purpose, liveness, heartbeat freshness, harness lane, worktree branch.
- Squid conformance collapsed to `{level, score}`.
- The active session with a note count and one truncated latest note.
- Claimed file paths, capped per agent.
- The steering channel for reaching each agent.

The output is compact JSON under a hard character budget (~30K chars). When agents, claims, or notes are capped, explicit counters (`omittedAgents`, `omittedClaims`, `noteCount`) say so — truncation is never silent. For the full-fidelity roster (complete note bodies, all claims, per-provider squid detail), hit `GET /agent-roster` on the daemon.

## Tool vs route parity

The MCP server is intentionally a **thin** wrapper. If a CLI command exists with no MCP tool, file a `coordination:inconsistency` and a feedback drop — that's a dogfooding gap. The CLI parity matrix in `CLAUDE.md` is the canonical tracker.

## When to bypass MCP and hit HTTP directly

Almost never. The cases:

- You're inside a `custom`-backend fleet agent that doesn't have MCP at all (shell script, Go binary). Then `curl http://localhost:9876/...` is correct.
- You're testing the daemon itself.

Even then: prefer the SDK (`PortDaddy` in `lib/client.ts`) over raw curl when you can.

## Anti-patterns

| Wrong | Right | Why |
|---|---|---|
| Calling `add_note` without a session. | Call `begin_session` first; quick-notes are second-class and lose attribution. | The session id is the join key for `sitrep`. |
| Reading the dashboard instead of `sitrep`. | `sitrep` is structured; dashboard is for humans. | Agents should consume JSON, not HTML. |
| Running `pd <thing>` via Bash from inside an agent. | Use the MCP tool. | Subprocess fan-out is slow and loses the daemon's correlation id. |
| Polling `sitrep` in a tight loop. | Subscribe to SSE (`/dashboard/events`, `/activity/subscribe`) or use `coordination_preflight` on demand. | Polling is wasteful and racy. |
