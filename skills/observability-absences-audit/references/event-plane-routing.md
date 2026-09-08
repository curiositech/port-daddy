# Event-Plane Routing — Ephemeral Log Plane vs Durable Queryable Audit Plane

Two planes, two purposes. The most common observability absence is not "no log" but
"logged on the wrong plane" — a security reject that only `console.warn`s is
effectively unlogged, because the plane it lives on is not queryable after the fact.

## The two planes

| | Ephemeral log/metric plane | Durable queryable audit plane |
|---|---|---|
| Examples | stdout/stderr, structured JSON logs shipped to a rotating store, Prometheus/StatsD gauges & counters | an `activity_log` / `audit` table (SQLite/Postgres), append-only, indexed, retained |
| Lifetime | minutes → days (rotates, sampled, aggregated) | months → forever (retention is a compliance decision) |
| Access | tail live, dashboards, alert rules | SQL / API query by tenant, actor, time-range, type |
| Question it answers | "what is happening **now**? what's the **rate**?" | "who did **what**, to **whom**, **when** — and can I prove it?" |
| Cardinality | high-volume, lossy-OK | lower-volume, loss-**not**-OK |

## Routing decision

```
Will anyone QUERY this event later (incident, audit, billing, dispute)?
  ├── yes → DURABLE audit plane  (row with actor_id, tenant_id, type, target, ts)
  └── no  → is it a RATE / live signal?
             ├── yes → ephemeral METRIC (counter/gauge)
             └── no  → ephemeral LOG line (structured, correlated)
```

A single action often emits to **both**: a token reject writes a durable
`SECURITY_TOKEN_REJECT` audit row *and* increments an ephemeral
`auth_rejects_total{reason}` counter. That's correct — the row is for the tenant's
"who touched my data" question; the counter is for the on-call "are we under attack
right now" question.

## Per-category routing (defaults)

| Category | Durable audit plane | Ephemeral plane |
|---|---|---|
| 1. Security | mint, **reject**, revoke, grant, secret-access, membership change | auth-attempt rate, reject-rate-by-reason counter |
| 2. Coordination | lock steal/**expire**/force-release, port conflict, split-brain takeover | contention depth (waiters), lock-hold-time histogram |
| 3. Resource | `RESOURCE_ALARM` when a threshold trips | `db_bytes`, `wal_bytes`, `writes_per_min`, `table_rows{table}` gauges |
| 4. Failure | `CRASH`, `DEGRADED_MODE{component}` | error-rate counter, restart counter |
| 5. Correlation | (not an event — a *field* on every durable row) | (a *field* on every log line & metric label) |

## Anti-absence for the durable plane itself

The durable plane has its own failure modes that are absences in disguise:
- **Unbounded growth with no self-monitor** → feeds category 3 (the 313 GB blind spot
  was an unbounded audit-ish table). Retention must exist *and* be monitored.
- **Retention silently stops** → the table grows or the history vanishes with no alarm.
  Emit a metric for the retention job's last-run and rows-pruned.
- **No index for the query you'll actually run** → "who touched tenant X" needs an
  index on `(tenant_id, timestamp)`, not just `timestamp`. An audit row you can't
  query in time is a soft absence.

## Correlation is not a plane — it's a field on both

`requestId` / `actorId` / `tenantId` are not events; they are the join keys that make
both planes answerable. Absent them, a durable audit row saying "token rejected" can't
name the tenant, and two ephemeral log lines from one request can't be stitched. Carry
them in `AsyncLocalStorage` and auto-merge in the logger so every emit on either plane
inherits them without call-site changes.
