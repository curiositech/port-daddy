# Salvage Entry Shape

Authoritative source: `lib/resurrection.ts`, `routes/resurrection.ts` (now exposed as `/salvage/*`).

When an agent dies mid-task — crashed, lost connection, ran out of context, was killed — its work is preserved in the **salvage queue** so another agent can finish it. This is the only mechanism in PD that survives a single agent's lifetime.

## Lifecycle

```
register → heartbeat (5m loop) → [stop heartbeat]
   ↓                                ↓
   alive → stale (10m) → dead (20m) → enqueued for salvage
                                          ↓
                              another agent runs `pd salvage`
                                          ↓
                              `pd salvage claim <agentId>`
                                          ↓
                              continues in same session,
                              writes notes, finishes work
                                          ↓
                              `pd salvage complete <agentId>`
```

## Stored shape

```ts
interface SalvageEntry {
  agent_id: string          // dead agent's PD id
  identity_project?: string // parsed from agent identity
  identity_stack?: string
  identity_context?: string
  purpose?: string          // "Build auth refresh-token flow"
  worktree_id?: string
  last_heartbeat: number    // epoch ms — when we last saw the agent
  enqueued_at: number       // epoch ms — when reaper moved it to queue
  state: 'pending' | 'claimed' | 'completed' | 'abandoned'
  claimed_by?: string       // id of the agent that took the work
  claimed_at?: number
  session_id?: string       // session preserved for the salvager
}
```

## Filtering by project / stack

The salvage queue is populated across all projects on the daemon. Filter to your scope:

```bash
pd salvage                         # everything (don't do this in big shops)
pd salvage --project myapp         # only myapp:*
pd salvage --project myapp --stack api
```

Identity-aware salvage is what makes this useful: register agents with `--identity` so the queue knows their scope.

## Claiming

```bash
pd salvage claim <agentId>
```

This:
1. Marks the entry `claimed`.
2. Returns the dead agent's last session (notes, file claims, purpose).
3. Implicitly registers your current session as the continuation.
4. The dashboard will show the new owner.

## Completing or abandoning

```bash
# You finished the work
pd salvage complete <agentId>

# You couldn't finish — release back to queue for someone else
pd salvage abandon <agentId>
```

A claimed-but-never-completed entry can also be re-reaped if the new agent also dies — it's salvageable again.

## What you should read after claiming

```bash
pd notes --session <session_id> --type handoff
pd notes --session <session_id> --type blocker
pd notes --session <session_id>            # full thread
pd files --session <session_id>            # what was claimed
```

Notes tagged `handoff` are the dying agent's last message to you.

## Heartbeat contract

To stay out of the salvage queue, an agent **must** beat at least every 10 minutes:

```bash
pd agent heartbeat --agent <id>
```

The `pd begin` / `pd done` sugar wraps this for you. If you write your own loop, beat at 5-minute intervals to give yourself a margin.

## Dashboard

The Salvage Queue panel auto-refreshes every 15s, groups by project, and shows:

- agent id, identity, purpose
- dead-since duration
- claim / dismiss buttons

If you see a dead agent that should be picked up, claim it. That's the dogfooding contract.

## Anti-patterns

| Wrong | Right | Why |
|---|---|---|
| Registering without `--identity`. | `pd agent register --identity {project}:{stack}:{ctx} --purpose "..."`. | Without identity, salvage can't filter or attribute. |
| Skipping `--purpose`. | Always set a one-line purpose. | The salvager has nothing to go on otherwise. |
| Claiming without writing a `handoff` note when you finish. | `pd note --type handoff "Salvaged X. Did Y. Open: Z."` | Future-you may also die. |
| Treating salvage as real checkpointing. | It's note-passing, not state recovery. Plan accordingly. | The dying agent didn't checkpoint code state. Re-derive from git. |
