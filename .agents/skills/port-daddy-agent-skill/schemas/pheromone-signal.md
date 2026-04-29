# Pheromone Signal Shape

Authoritative source: `lib/pheromone.ts`, `routes/pheromone.ts`.

Pheromones are **ambient numeric signals with geometric decay**. Use them to surface contention, heat, and "where is everyone working" without paying the cost of structured coordination.

## When to reach for pheromones

- "Which files are hot right now?" — file heat map.
- "Is anyone else working on auth?" — spray a trail when you start.
- "What did the last 6 agents converge on?" — read the strongest trail.

If you need an exact answer (who, when, what), use **notes** or **sessions**. Pheromones are for *gradients*, not records.

## Stored shape

```ts
interface PheromoneSignal {
  table: string       // logical bucket: "files", "decisions", "intents", ...
  id: string          // entity id within the bucket (e.g. file path, decision slug)
  key: string         // signal name within the entity ("editing", "broken", "owned-by:qa")
  strength: number    // 0..1, decays geometrically each tick
  last_updated: number // epoch ms — used for read-time decay
}
```

## Decay model

- Decay is **read-time, not write-time**. The stored `strength` is the value at `last_updated`. On read, the daemon multiplies by `decay^(now - last_updated)`.
- Default half-life is short — values fall to ~0 within minutes if no one re-sprays.
- Below a floor (~0.01) the signal is treated as zero and reaped.

This means **every spray is a vote**. To keep a trail alive, agents must keep spraying. Stale opinions evaporate on their own — no GC bookkeeping in agent code.

## Spraying

```bash
# Mark "src/auth.ts" as actively edited
pd pheromone spray --table files --id src/auth.ts --key editing --strength 0.9

# Vote for a decision
pd pheromone spray --table decisions --id use-jwt --key approve --strength 0.5
```

```bash
# Higher-level: pd say --heat
pd say "starting refactor of auth" --heat src/auth.ts=0.9
```

`pd say --heat <path>[=N]` is the one-call helper used by the operator skill. It writes a note **and** sprays a `files` pheromone in the same call.

## Reading

```bash
# All pheromones on one entity
pd pheromone show --table files --id src/auth.ts

# Heat map across the codebase
pd pheromone files                 # all hot files
pd pheromone files --path src/auth # only under src/auth
pd pheromone files --depth 2       # roll up to dir level

# Everything tracked
pd pheromone ls
```

`/pheromone/files` derives heat from active session file claims **and** explicit pheromone sprays — so you don't need to spray on every claim, but spraying boosts a signal you want others to feel.

## Use vs. notes vs. tuples

| Question | Use |
|---|---|
| "Who is editing what *right now*?" | Pheromones (`pd look --heat`). |
| "What did Erich decide about JWTs last Tuesday?" | Notes. |
| "Is there a pending build task to claim?" | Tuple `in`. |
| "Should everyone hear about the deploy?" | Pub/sub channel. |

Pheromones are **lossy by design**. Don't load-bear durable state on them.

## Anti-patterns

| Wrong | Right | Why |
|---|---|---|
| Spraying once and assuming the trail persists for an hour. | Spray each time you act, or set higher `strength`. | Decay is geometric — single sprays vanish in minutes. |
| Using pheromones as a queue. | Use a tuple-space `task` tuple. | Pheromones don't guarantee delivery or ordering. |
| Treating `strength=1.0` as authoritative. | Combine pheromones with a session note for the actual claim. | Strength is a heat signal, not a lock. |
| Spraying without `--table` partition. | Always namespace: `files`, `decisions`, `intents`, `agents`. | Mixed tables defeat the heat-map roll-up. |
