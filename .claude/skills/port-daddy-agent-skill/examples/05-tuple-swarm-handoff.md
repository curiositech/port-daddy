# 05 — Swarm Handoff via Tuple Space

**Scenario:** Multiple fleet agents need to hand work off without a queue, a database, or polling. Linda-style tuples solve this.

## The mental model

A **tuple** is a JSON array. The first element is a kind tag; the rest is payload. Tuples sit in a shared, harbor-scoped space. Agents `out` (write), `rd` (read non-destructively), or `in` (atomic read-and-remove).

Read = fan-out. Take (`in`) = work-stealing.

See `../schemas/tuple-shape.md` for the full grammar.

## Worked scenario: "Spider finds → Spark elaborates → QA verifies"

Three fleet agents, one harbor (`myapp:fleet`):

- **spider** — discovers cross-cutting connections in the codebase, writes `connection` tuples.
- **spark** — reads strong connections and writes `idea` tuples to elaborate them.
- **qa** — picks up `task` tuples to test.

### Spider writes a connection

```bash
pd tuple out '["connection", "trie+pubsub=routing", "spider", 0.9]' \
  --harbor myapp:fleet \
  --ttl 3600000        # auto-expire in 1h
```

### Spark reads only high-confidence connections

```bash
pd tuple rd '["connection", "*", "*", ">0.8"]' --harbor myapp:fleet
# returns the spider tuple above; Spark elaborates it
pd tuple out '["idea", "trie-pubsub-routing-cache", "spark", "Use trie keys as channel names"]' \
  --harbor myapp:fleet
```

`rd` is non-destructive — many sparks can read the same connection.

### QA work-steals tasks

```bash
# Anyone publishes a task
pd tuple out '["task", "build-auth", "pending"]' --harbor myapp:fleet

# QA workers compete to take it
pd tuple in '["task", "*", "pending"]' --harbor myapp:fleet
# Only one worker gets the tuple; others see nothing.
```

`in` is **atomic read-and-remove**. This is your work-stealing primitive — no Redis, no SQS.

## Pattern grammar cheatsheet

| Pattern | Matches |
|---|---|
| `["connection", "*", "spider", "*"]` | Any spider connection. |
| `["connection", "*", "*", ">0.7"]` | Confidence > 0.7 by anyone. |
| `["task"]` | Any tuple whose first element is `"task"` (trailing positions = `*`). |
| `["task", "build-auth", "pending"]` | Exact. |

`*` is a string, not the JSON null. `>0.7` is the string `">0.7"`, parsed by the daemon.

## Harbor scoping

Always pass `--harbor "$PROJECT:fleet"` from a fleet. Tuples without a harbor are global and visible to every agent on the daemon — useful for cross-project signaling, but noisy by default.

```bash
PROJECT=$(basename "$(pwd)")
pd tuple out '["task", "..."]' --harbor "$PROJECT:fleet"
```

## TTLs are mandatory for transient state

```bash
# 1-hour expiry
pd tuple out '["intent", "refactor-auth"]' --harbor myapp:fleet --ttl 3600000
```

A tuple without a TTL is a permanent fixture in the space. Use that for slowly-changing facts (`["config", "production-region", "us-east-1"]`), not for tasks.

## Anti-patterns

| Wrong | Right |
|---|---|
| Storing diffs / file contents in tuple payload | Store a path or a content-hash; embed the file by reference. |
| Untagged tuples (`["build-auth", "pending"]`) | Tag everything: `["task", "build-auth", "pending"]`. Patterns rely on the leading tag. |
| `in` for a tuple multiple agents need to react to | Use `rd`. `in` removes — readers after lose. |
| No harbor in a fleet | Always `--harbor "$PROJECT:fleet"`. |

## When to NOT use tuples

- You only need the most recent value of one thing → use **pheromone** (`pd pheromone spray`).
- You need durable, append-only history → use **notes** (`pd note --type ...`).
- You need delivery guarantees and ordering → use **pub/sub** with a watched channel + acks. Tuples have no inherent ordering.

## Inspecting the space

```bash
pd tuple scan --harbor myapp:fleet                 # everything
pd tuple count --harbor myapp:fleet                # how many
pd tuple rd '["task"]' --harbor myapp:fleet        # all pending tasks
```

The dashboard's Tuple panel does the same with auto-refresh.
