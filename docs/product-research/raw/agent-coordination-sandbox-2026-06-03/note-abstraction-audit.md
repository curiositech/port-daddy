# Note-abstraction audit — Port Daddy coordination surfaces

Snapshot taken against the live production DB: `~/port-daddy-stable/port-registry.db` (720 MB, 44 tables) on 2026-05-19.

## TL;DR

The user's intuitions are mostly right, and one is wrong:

| Intuition | Reality |
|---|---|
| "Way too many note abstractions" | **Confirmed.** session_notes and episodic_memory both dominated by `handoff` type — same concept, two tables. |
| "Agents rarely coordinate without poking" | **Confirmed.** `agent_inbox` has **46 rows ever**. DMs don't carry coordination. |
| "I never see AST use" | **Confirmed.** `session_files` schema has `start_line`, `end_line`, `symbol`, `symbol_path`. Of **1,637 claims, exactly 0 use region, 0 use symbol.** 100% whole-file. |
| "Tuples underutilized" | **Partly wrong.** Tuples have 16k writes/week, but ~99% are *fleet event telemetry* and *semantic-router cache* — almost zero inter-agent coordination tuples. So the felt absence is real, the volume isn't. |
| "Pheromones underutilized" | **Worse.** `pheromones` is not a table. Doctrine only. |
| "Harbor-wide communal memory wired or not?" | `episodic_memory` has a `harbor` column. Whether it's actually *queried* harbor-wide is the next question (see open #4). |

Three doctrine surfaces don't exist: **pheromones, signals, coordination_inconsistencies, briefing, transcript_events, roadmap_claims** (6 total). `transcript_events` is the most painful — `lib/transcript-store.ts` is built and `lib/cost-ledger.ts` already SELECTs from it. Defined-but-not-wired orphan.

---

## Write-surface inventory (production DB, 2026-05-19)

| Surface | Rows | Last write | 7d writes | What it really is |
|---|---:|---|---:|---|
| `usage_events` | 915,164 | now | 915k | Telemetry firehose (API calls, sessions, etc.) |
| `metric_counters` | 154,154 | now | 154k | Pre-aggregated counters — **but only 22 distinct keys** |
| `messages` | 57,526 | now | 57k | Pub/sub channel firehose — mostly `fleet:events`, `bond:lifecycle`, per-actor channels |
| `tuples` | 16,334 | now | 16k | Stigmergy substrate — **but 99% fleet events + semantic cache, near-zero coordination use** |
| `activity_log` | 10,012 | now | 10k | History stream |
| `semantic_resolution_events` | 8,158 | now | 8k | DNS / identity resolution telemetry |
| `episodic_memory` | 4,859 | now | 4.9k | Per-actor episodes — **99% type=handoff** |
| `cost_events` | 3,244 | now | 3.2k | Cost ledger |
| `session_files` | 1,637 | — | n/a | File claims — **0 use region/symbol** |
| `session_notes` | 891 | now | 891 | Notes attached to sessions — **74% type=handoff** |
| `sessions` | 844 | now | 844 | Session lifecycle |
| `harbor_members` | 221 | — | n/a | Harbor membership |
| `resurrection_queue` | 219 | — | n/a | Salvage queue |
| `sortie_events` | 147 | 6d ago | 147 | Fleet-execution events |
| `agent_inbox` | 46 | 7d ago | 46 | Direct DMs — **lifetime total, not 7d** |
| `sorties` | 37 | 6d ago | 37 | Fleet runs |
| `harbors` | 31 | — | n/a | Harbor records |
| `agents` | 3 | — | n/a | Registered agents |
| `dns_records` | **0** | — | 0 | **Completely unused** |
| `locks` | 1 | — | n/a | Cross-cutting locks — barely used |

### What the 22 `metric_counters` keys actually instrument

```
spawn.duration_ms       99,430,174    spawn.* covers pd-spawn lifecycle
usage.daemon.api_call      741,349    usage.* covers API surface call telemetry
usage.ui.api_call          169,744
semantic.resolution.*      ~15,000    semantic.* covers DNS / identity router
spawn.started                1,749
spawn.failed                   975
spawn.completed                333
spawn.blocked                  327
spawn.killed                    28
usage.daemon.agent_work        326
...
```

**Three families: spawn, usage, semantic.** Zero counters on tuples, messages, session_notes, session_files claims, episodic_memory writes, agent_inbox, activity_log, sortie events, lock acquisitions, resurrection promotions.

So we have the *infrastructure* for telemetry (the table, the buckets, the API) but **the coordination primitives are dark**. We can't answer "how often did a tuple get read?" or "what % of file claims got contested?" today.

---

## Ghost surfaces (doctrine but no schema)

| Surface | Where doctrine mentions it | Reality |
|---|---|---|
| `pheromones` | MEMORY.md, V4-DAG, stigmergy ADRs | No table. No `lib/pheromones.ts`. Pure vapor. |
| `signals` | Integration ADRs | No table. May be folded into `messages` or `tuples` as `signal` envelopes — needs verification. |
| `coordination_inconsistencies` | User's coordination feedback channel rule | No table. Likely a `messages` channel pattern. |
| `briefing` | `pd briefing` command | File-only (`.portdaddy/briefing.md`). Not coordination-readable by other agents. |
| `transcript_events` | `lib/transcript-store.ts`, `cost-ledger.ts:117-118` (read) + `cost-ledger.ts:387` (`ensureSourceTables` create) | **Double orphan: schema exists in code, neither `createTranscriptStore` nor `createCostLedger` is wired into `server.ts`, so the table is never created in the production DB.** |
| `roadmap_claims` | ADR-0033 (status: SHIPPED) | Table does **not** exist in prod DB. Either renamed, stored in tuples under a key pattern, or the ADR is wrong about shipped status. |

**This is the biggest finding.** When agents try to "drop a pheromone" or "flag a coordination inconsistency" or "claim a roadmap item," there is no primitive. They fall back to `messages` or a free-text `session_note`, which is why coordination decays into poking.

---

## The handoff duplication

Two surfaces, one concept:

```
session_notes:    659/891 rows = type 'handoff'   (74%)
episodic_memory:  4810/4859 rows = type 'handoff' (99%)
```

Same domain idea ("here's where I'm leaving off"), written to two different tables, by different paths in the code. `episodic_memory` is also where "communal harbor memory" would live if it were used — but if 99% is handoff records, it's not playing the communal-memory role either.

**Likely consolidation:** `episodic_memory` becomes the canonical store; `session_notes` becomes a typed view on it. Or kill the duplication outright and pick one.

---

## The AST-claim dead zone

`session_files` table:
```sql
file_path TEXT NOT NULL,
start_line INTEGER,    -- nullable, never set
end_line INTEGER,      -- nullable, never set
symbol TEXT,           -- nullable, never set
symbol_path TEXT,      -- nullable, never set
claimed_at INTEGER NOT NULL,
released_at INTEGER
```

1,637 claims. 0 with regions. 0 with symbols. Schema is ready. Indexes exist (`idx_session_files_symbol_path`, `idx_session_files_region`). The pipe is laid; no water.

The blocker per user is probably "no informative code index." That's not entirely true:
- `symbols` table exists in prod DB
- `symbol_dependencies` table exists
- `parsed_files` table exists

So an AST index *partially* exists. The next question is whether (a) `symbols` is actually populated for active projects and (b) the claim API surfaces symbol-level options at all. Worth a follow-up probe.

---

## Tuples: what they're actually for

The 16k/week is not coordination. Sample of the most recent fields:

```
["fleet:event","agent_failed", ...]       — fleet telemetry
["fleet:event","agent_started", ...]      — fleet telemetry
["semantic:resolution","reject", ...]     — semantic router events
["semantic:alias", "fleet", ...]          — semantic router cache
```

Harbor distribution (top):
- `port-daddy:fleet` — 6,565 (fleet plumbing)
- `port-daddy` — 5,442 (mixed)
- `(null)` — 3,848 (no harbor scope set)
- `workgroup-ai` — 105
- everything else — < 100

The Linda-style tuple-space is being used as an **event log**, not as the coordination substrate it was designed to be. There's nothing technically wrong with that, but it's why agents don't "drop a tuple to signal X" — when they look at the existing tuples they see fleet events, not coordination patterns to imitate.

---

## What this audit unblocks

1. **Honest consolidation proposal.** 14 surfaces → ~5 load-bearing. See below.
2. **Counter-coverage plan.** 22 keys → ~40 needed to cover coordination primitives.
3. **The case for fixing AST claims.** Schema ready, infra partial. Mostly a wiring + UX problem.
4. **Killing or shipping the ghosts.** Either delete doctrine references or build the tables.

---

## Proposed consolidation (first cut, for discussion)

### Keep as load-bearing
- **`messages`** — pub/sub firehose. Genuinely used by fleet plumbing; don't fight it.
- **`tuples`** — stigmergy primitive. Has the substrate, just needs *coordination* tuple kinds beyond fleet events.
- **`session_files`** — file claims. Needs the AST surface wired through.
- **`sessions`** + **`session_notes`** — session lifecycle + per-session notes.
- **`episodic_memory`** — durable cross-session memory.
- **`metric_counters`** — telemetry counters.

### Collapse
- **`session_notes` vs `episodic_memory`** — pick one as canonical for handoffs. Recommend: `episodic_memory` (richer schema, harbor-scoped, has source_type/source_id). `session_notes` becomes either a typed view or deprecated.
- **`agent_inbox`** — used 46 times ever. Either delete and route inbox-style DMs through `messages` with a channel naming convention, or invest in it and make it the *only* DM path. Pick one.

### Build (de-ghost)
- **`transcript_events`** — wire the orphan. Already designed (see `transcript-ingestion-design.md`).
- **`roadmap_claims`** — either find where ADR-0033 actually persists state, or build the missing table. ADR claims SHIPPED; production says otherwise.

### Delete or document-as-deferred
- **`pheromones`** — either build it (it would be distinct from tuples by having decay semantics) or strip from doctrine.
- **`signals`** — clarify whether this is just a typed envelope on `messages` and write down the convention.
- **`coordination_inconsistencies`** — almost certainly should be a `messages` channel pattern + a typed `episodic_memory` episode_type.
- **`dns_records`** — 0 rows, has been since creation. Either kill or wire.

---

## Counter-coverage gap (to fix in same wave)

Minimum new `metric_counters` keys to add:

```
tuples.write{harbor,kind}             — kind from fields[0]
tuples.read{harbor,kind}              — currently invisible
messages.publish{channel}
messages.deliver{channel}             — currently invisible
session_notes.write{type}
session_files.claim{has_region,has_symbol}    — instantly proves AST adoption
session_files.contested                — surface lock contention
episodic_memory.write{episode_type,source_type}
episodic_memory.read{episode_type}    — currently invisible
agent_inbox.write
agent_inbox.read
locks.acquire / locks.contend
resurrection.enqueue / resurrection.claim
```

~13 new keys would take coverage from "spawn + usage + semantic" to "+ every coordination primitive." Implementation is mechanical: each module's write path calls `metricCounters.bump(key, dims)`. We already have the bump primitive (it's how the 22 existing keys work).

---

## Open questions for the user

1. **Handoff duplication:** kill `session_notes` and route everything through `episodic_memory`, or keep both with a clear typed split? (My lean: kill `session_notes`, migrate the 7 types to `episodic_memory.episode_type`.)
2. **Agent inbox:** invest or delete? 46 lifetime DMs is a verdict, not a sample. (My lean: delete; route through `messages` with `inbox:<actor>` channel pattern, which is already how cartographer's inbox works.)
3. **Pheromones:** real plan or doctrine cleanup? (My lean: real plan — a tuple subtype with TTL + decay + spatial-ish scope, distinct from event-log tuples.)
4. **Harbor communal memory:** is `episodic_memory.harbor` actually read harbor-wide anywhere, or is every read scoped to the writer? (Need code probe to answer.)
5. **AST claim adoption:** is the blocker (a) no symbol index for active projects, (b) no claim API exposing symbol-level, (c) no agent prompt telling them to use it, or (d) all three? Worth a 1-hour spike to determine.
6. ~~**ADR-0033 truth:** does `roadmap_claims` exist by another name (e.g., tuples with `kind:roadmap-claim`) or is the "SHIPPED" claim wrong?~~ **RESOLVED.** `lib/roadmap-pop.ts:171` self-inits the table. It exists in the local repo DB (`~/coding/port-daddy/port-registry.db`) but NOT in the production stable DB (`~/port-daddy-stable/port-registry.db`). Conclusion: **`pd roadmap pop` has never been invoked against the production daemon.** The shipped command exists, the table schema is correct, but nothing has used it in production. Same is true of `roadmap_items` tuples — zero rows. Both the atomic-claim path and the auto-promote path of ADR-0033 are dark in production.

---

## Recommended next moves

1. **Ship the counter-coverage wave** (mechanical, ~half-day): add ~13 missing keys to coordination primitives' write paths. Gives us *ongoing* visibility for free, no architecture decisions needed.
2. **Resolve ADR-0033 / roadmap_claims mystery** (~30 min): grep + DB probe. Tells us whether to trust other "SHIPPED" claims at face value.
3. **Wire `transcript_events`** (the chat-log capture work — see `transcript-ingestion-design.md`). Already designed by Agent B; recon is done by Agent A. Implementation is unblocked.
4. **Run the handoff-consolidation question** as a small design doc once user picks a direction on Q1.
5. **AST claim adoption spike** to answer Q5 with evidence before any work to "fix AST claims."

Counter-coverage (#1) is the highest-leverage first move because every other audit and consolidation decision gets sharper once we have ongoing read/write telemetry on coordination primitives, not just on the spawn/usage/semantic surfaces.
