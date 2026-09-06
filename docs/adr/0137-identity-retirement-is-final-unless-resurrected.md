# 0137. Identity retirement is final unless resurrected — enforced by the database

## Status

Accepted (2026-09-05)

- **Amends:** ADR-0022 (actor souls and body leases), ADR-0040 (identity keystone)
- **Journals through:** ADR-0089 (durable security-forensics journal)

## Context

Port Daddy carries two durable identity surfaces, and until now neither could
make retirement stick:

- **Actor souls** (`actor_souls`, `lib/actor-souls.ts`) are the daemon-minted,
  non-forgeable principals of ADR-0040. The table had no retirement concept at
  all. "Retire" was whatever a caller did to the row, and whatever a caller did
  could be undone by any code path — or any process holding the SQLite file —
  with one `UPDATE`.
- **Durable agents** (`lib/durable-agent-roster.ts`) keep their profile in the
  append-only `harbor_events` ledger with `lifecycle: ready | paused | retired`.
  `POST /durable-agents/:id/retire` set `retired`; `PATCH /durable-agents/:id`
  with `{ lifecycle: 'ready' }` set it back, with no receipt and no journal
  entry. A retired agent was one request away from being active again.

The whitepaper's identity keystone depends on retirement being final unless it
is reversed through an explicit, audited step. Retire-and-respawn is the classic
whitewashing move: an identity that earned a throttle, a slash, or a halt comes
back clean. The 2026-09-05 spend incident makes this concrete: while the fleet
is halted, a runaway agent flipping a retired identity back on must be
impossible at the storage layer, not merely discouraged by the app that happens
to be running.

The rest of the resurrection machinery is unaffected by this gap: the reaper
(`lib/agents.ts` `cleanup()`), the resurrection queue (`lib/resurrection.ts`)
and `pd session takeover` (`lib/sessions.ts` `takeover()`) act on the `agents`
display-handle table and on sessions. None of them read or write a soul's or a
durable agent's lifecycle. ADR-0008's "resurrection" recovers a dead body's
work; this ADR governs whether an identity may act at all.

## Decision

Retirement is a tombstone. The only way back is a resurrection that carries a
fresh receipt, and both transitions are written to the forensics journal. The
rules are SQLite triggers, so the app layer explains them rather than being the
thing that enforces them.

### Actor souls

Additive columns on `actor_souls`, added with a PRAGMA-guarded `ALTER TABLE`
(the same shape as `roadmap_items.deleted_at`, safe on a database written by an
older daemon, verified against the live table after the ALTER):

| Column | Meaning |
|---|---|
| `retired_at`, `retired_reason`, `retired_by` | the tombstone |
| `resurrection_receipt`, `resurrected_at`, `resurrected_by` | the audited way back |

Three triggers:

1. `actor_souls_retired_no_silent_resurrection` — `BEFORE UPDATE`: clearing
   `retired_at` aborts unless the same statement sets a `resurrection_receipt`
   that differs from the one the row already carried. A replayed receipt is not
   a fresh audit.
2. `actor_souls_retired_frozen` — `BEFORE UPDATE`: while the tombstone stands,
   the credential hash and salt, `operator_trusted`, `clean_exits`, the tombstone
   timestamp, and the identity key cannot change. Re-keying a retired soul is a
   resurrection in disguise.
3. `actor_souls_retired_tombstone` — `BEFORE DELETE`: a retired row cannot be
   deleted. Together with the `(harbor, actor_id)` primary key this is what makes
   re-minting the same identity key while retired a constraint failure rather
   than a clean slate.

A partial unique index on `resurrection_receipt` makes each receipt usable for
exactly one resurrection of one soul.

Behaviour of a retired soul: `verifyCredential` returns null; `register` with
its credential returns `IDENTITY_RETIRED` (403) — only a caller that already
holds the valid secret learns this, so an unknown selector and a bad verifier
stay indistinguishable; `classify`/`resolveActor` return `'unknown'`, which
every consumer already floors to the shared newcomer pool / no verified
principal; `recordCleanExit` and the register-touch are no-ops.

App surface: `souls.retire(actorId, { reason, by })`,
`souls.resurrect(actorId, { reason, by })`, and the operator-token routes
`POST /actors/souls/:actorId/retire` and `POST /actors/souls/:actorId/resurrect`.

### Durable agents

- `update()` refuses to move a `retired` profile to any other lifecycle
  (`DURABLE_AGENT_RETIRED`, 409), so `PATCH /durable-agents/:id` cannot
  reactivate.
- `resurrect(agentNodeId, { by, reason })` appends a fact whose payload carries
  `resurrection: { receipt, at, by, reason, fromLedgerSeq }` and sets the
  lifecycle to `paused` — never straight to `ready`. The receipt is carried on
  that one fact only; `nodePayload` strips it before the next fact inherits the
  previous payload.
- The ledger trigger `harbor_events_agent_node_no_silent_resurrection`
  (`BEFORE INSERT`) aborts an `agent-node` fact whose lifecycle is not
  `retired` when the newest prior fact for that agent is `retired` and the new
  fact carries no receipt, or only the receipt the prior fact already carried.
  A raw `appendEvent` gets the same answer as the route.
- Route: `POST /durable-agents/:id/resurrect` (loopback-only, like every other
  roster mutation).

`assertUniqueAlias` already counted retired facts, so creating a new agent
under a retired agent's slug was and remains a `DURABLE_AGENT_ALIAS_CONFLICT`.

### Journal

Both stores take the ADR-0089 `ForensicsSink`. `retire` writes rule
`IDENTITY_RETIRED`; `resurrect` writes rule `IDENTITY_RESURRECTED` with the
receipt, actor, reason, and who asked. `server.ts` creates the sink before the
identity stores and passes it to both; the Arbiter keeps using the same sink.

## Why a same-statement receipt column, not a session token

Three mechanisms were considered for "this update is a sanctioned resurrection":

- **A connection-scoped token** (a `PRAGMA` value or a temp table the
  resurrection path sets and clears). Invisible in the database afterwards, and
  invisible to a second connection on the same file; a forensic reviewer could
  not tell a sanctioned resurrection from a trigger that was simply absent.
- **Dropping and recreating the trigger around the sanctioned write.** DDL on
  the hot path, and a crash between the two statements leaves the wall down.
- **A receipt column set in the same `UPDATE`** (chosen). The evidence lives on
  the row, is unique across the table, can be joined by value to the journal
  entry, and needs no state a second handle would miss. The trigger's condition
  is a pure function of `OLD` and `NEW`.

The ledger twin uses the same idea: the receipt is in the fact's JSON, and the
trigger compares it with the previous fact's.

## Consequences

- A retired identity cannot act, be re-keyed, be promoted, be deleted, or be
  re-minted, from any code path or any SQLite client, until an operator
  resurrects it with a receipt that lands in the forensics journal.
- Existing databases migrate on first boot; existing souls and durable agents
  are unaffected (`retired_at IS NULL`, lifecycles unchanged).
- Reaper, resurrection queue, and session takeover are untouched and keep
  passing their suites; they never wrote identity lifecycle.
- `SoulClass` gains no new member. A retired soul is `'unknown'`, which is the
  standing a forged id already has. A dedicated `'retired'` class would have
  needed every consumer (budget-guard, resource-scope, sessions, sugar) to learn
  a new branch for no change in behaviour.
- Cost: one `PRAGMA table_info` and three `CREATE TRIGGER IF NOT EXISTS` at
  store creation; one correlated subquery per `agent-node` fact insert.

## Related

- `tests/unit/identity-retirement-keystone.test.ts` — the incidental
  reactivation paths reproduced and refused, audited resurrection, journal
  entries, migration idempotency, tombstone and receipt-replay refusals.
- ADR-0022, ADR-0040, ADR-0089, ADR-0008, ADR-0132.
