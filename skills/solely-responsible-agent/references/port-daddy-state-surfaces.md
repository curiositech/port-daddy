# Port Daddy State Surfaces for Solely-Responsible Agents

Repo inventory (2026-06-10) of what an avatar can build on in
port-daddy (and any repo running the pd daemon). Verify route/CLI
existence before depending on anything here — surfaces evolve; the
repo is truth, this file is a map.

## Fleet orchestration (the chassis)

`pd-fleet.yml` + `lib/fleet-engine.ts` (ADR-0019). An agent ("ship")
declares: `schedule` (cron) and/or `trigger` (pub/sub channel or tuple
pattern), `backend` + `fallbacks` preference order, `singleton: true`
(engine enforces one live instance per name — this IS the exclusivity
primitive), `identity: "{project}:fleet:<name>"`, `telos` (one-line
purpose), `allowedTools` (authority envelope), `cooldown_ms` /
`dedupe_window_ms` (anti-thrash). Behavior contracts live in
`fleet/ships/<name>.md`; the yml prompt says "read your contract
first."

Output convention (2026-05-20 retool): operator-visible findings go to
**GitHub** (PR comments edited in place, issues deduped by title,
draft PRs) via `lib/fleet/github-output.ts`. Pub/sub channels are
ship-to-ship plumbing only — findings published to channels died
unread, which is the incident class this whole pattern exists to fix.

## Writable state surfaces, by audience

### Operator must read it → immutable typed notes
- Table `session_notes` — append-only, immutable (ADR-0007), optional
  encryption. Write: `pd note "..."` (CLI) or `POST /notes`. Query:
  `pd notes`, `GET /sessions/notes?type=...&since=...`.
- Structured prefixes (e.g. `watch-log:`) make a ledger queryable
  without schema changes; `pd note --type` feeds the changelog bridge.
- **Best ledger surface available today.**

### Agent's own working memory → episodes (read-only over HTTP today!)
- Table `episodes` (`lib/episodic-memory.ts`): agent_id-scoped, typed,
  metadata-rich, durable. `addEpisode()` exists in the lib, but as of
  2026-06-10 routes expose only `GET /memory/episodes` — **no POST**.
  CLI: `pd memory episodes` (inspect).
- Until a write route lands, use typed notes for the ledger and tuples
  for live state. When it lands, migrate working memory there.

### Other agents should react now → tuples & pheromones
- Tuples (`lib/tuples.ts`, routes verified writable: `POST /tuples`,
  `GET /tuples`, `GET /tuples/poll|scan|count`, `DELETE /tuples`).
  Harbor-scoped (default `{project}:fleet`), optional TTL, pattern
  matching (`'*'`, `'>N'`, `'prefix:*'`). Fleet agents can use
  `trigger_tuple` to wake on patterns.
- Pheromones (`lib/pheromone.ts`): numeric 0–1 signals on
  services/projects/sessions that decay automatically — ambient "how
  hot is this right now," no cleanup needed.

### Full execution record (automatic) → transcripts
- `fleet_transcripts` + `fleet_transcript_messages`
  (`lib/transcripts.ts`) — every ship run recorded, secrets scrubbed.
  `GET /fleet/transcripts?ship=<name>&since=...`. The avatar's
  *input*: failed runs and repeated errors of other ships live here.
- `transcript_store` — append-only event log per turn/tool-call
  (cost ledger rides on it).

### Direct messages → actor inbox
- `agent_inbox` (`lib/agent-inbox.ts`): per-agent_id mailbox, max 1000
  msgs. Send to any agent; only the owner reads. `pd attention` reads
  yours first thing.

### Event stream → activity log
- `activity` table (`lib/activity.ts`): typed events, 7-day/10k
  retention. `GET /activity?limit=...`. Good sweep input; bad ledger
  (it expires).

### Causal chains → graph edges
- `graph_edges` (`lib/graph-edges.ts`): scope + source + edge_type +
  target + weight + metadata. For "error spike caused-by commit X"
  chains the next watch can query.

## Accountability machinery (status as of 2026-06-10)

| Mechanism | ADR | Status | What it gives an avatar |
|---|---|---|---|
| Coordination guard | — | shipped, enforce mode | commits require session + claims |
| Honest attestation `pd attest` | 0045 | partial | verify daemon health before escalating |
| Non-forgeable actor id | 0040 | proposed/partial | reputation that survives re-registration |
| Compulsion rent (note-per-commit) | 0050 ph.4 | shipped 2026-06-10 | precedent: ledger entries ENFORCED in guard |
| Commitments + obligation monitor | 0041 | **not built** | the real enforcement of "ledger entry every cycle" |
| Graduated sanctions | 0041 follow-on | not built | warn → throttle → slash → exile (Ostrom) |
| Coast Guard sandbox/meter/receipts | 0050 | phase 0 shipped | confinement + signed receipts for spawned avatars |

The compulsion-rent keystone matters as precedent: "no note since last
commit → commit blocked" is exactly the mandatory-ledger pattern,
enforced in code. The avatar's "deck-log entry every watch" wants the
same treatment once ADR-0041's monitor exists: a commitment row whose
`success_check` queries the notes table for an entry in the last
cycle, evaluated daemon-side, sanctioning the durable actor id.

## The log-visibility gap (motivating incident)

Daemon logs (`port-daddy.log`), fleet transcripts, channel messages,
and activity all exist — and as of 2026-06-10 **nothing consumed them
looking for problems**. "File not found: ollama/qwen2.5-coder" flooded
MESSAGE TRAFFIC for weeks unread. Gaps that need new code:

1. `lib/error-monitor.ts` (proposed, not yet built) — daemon-side consumer
   that polls transcript/activity error events, classifies, detects floods.
   Until it exists, the watch ship does its own grouping in-prompt.
2. `POST /memory/episodes` — write route for episodic memory.
3. ADR-0041 obligation monitor + sanction ladder.
4. Persistent pub/sub (channels are lossy across daemon restarts) —
   low priority if the avatar reconciles from its ledger instead of
   trusting event delivery (level-triggered beats edge-triggered here
   too).

## Reference implementation

`fleet/ships/officer-of-the-watch.md` + the `officer-of-the-watch`
entry in `pd-fleet.yml` — six 4-hour watches/day, deck log as
`watch-log:` notes, three-tier escalation, honest gaps section.
