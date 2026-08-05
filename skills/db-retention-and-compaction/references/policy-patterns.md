# Retention Policy Patterns

Deep reference for the three policy shapes, the unified registry, the coverage guard, and the
multi-tenant horizon. Consult when authoring a policy for a specific table or wiring the registry
into a service. Code samples are TypeScript + `better-sqlite3`, but the shapes port to any embedded
SQLite binding (Python `sqlite3`, Go `mattn/go-sqlite3`, Rust `rusqlite`).

## The three policy shapes

Every bounded table falls into one (or a *combination*) of these. Pick by asking: *what makes a row
worthless?*

| Shape | A row is worthless when... | Column needed | Example table |
|-------|----------------------------|---------------|---------------|
| **TTL** | its own expiry timestamp has passed | `expires_at` (nullable) | sessions, issued tokens, caches, nonces |
| **Absolute-age** | it is older than a fixed horizon, regardless of intent | `created_at` | audit/event logs, raw metrics, webhook receipts |
| **Row-count cap** | a newer row pushed it past the keep-N window | any monotonic order column | activity feeds, "last N runs", recent-errors ring |

### TTL policy

```sql
DELETE FROM <table> WHERE <expires> IS NOT NULL AND <expires> < :now;
```

The `IS NOT NULL` guard is deliberate: a NULL expiry means **opt-in permanence** (see below). A row
the caller explicitly wants to keep forever sets `expires_at = NULL` and survives every sweep.

### Absolute-age policy

```sql
DELETE FROM <table> WHERE <created> < :now - :max_age_ms;
```

Use when rows have no useful life past a fixed horizon *even if someone forgot to set an expiry*. This
is the policy that would have saved `harbor_issued_tokens`: an issued auth token is useless a few days
past issuance no matter what, so an absolute-age reaper is a hard backstop.

### Row-count cap

```sql
DELETE FROM <table>
WHERE <order_col> < (
  SELECT MIN(<order_col>) FROM (
    SELECT <order_col> FROM <table> ORDER BY <order_col> DESC LIMIT :max_rows
  )
);
```

Bounds a table that has no natural time horizon — a UI "recent activity" feed only ever shows the
newest N, so keep exactly N. Index `<order_col>` or the subquery scans.

## Opt-in permanence needs an absolute ceiling

The seductive trap: "let callers keep a row forever by setting `expires_at = NULL`." Fine — until
`tuples` and `messages` accumulate tens of thousands of no-TTL rows that nothing ever reaps. **Opt-in
permanence is not opt-out-of-all-bounds.** Pair the TTL policy with an absolute ceiling so "permanent"
means "years, not forever":

```ts
registry.register(ttlPolicy(db, "messages", "expires_at"));          // honors NULL = keep
registry.register(maxAgePolicy(db, "messages", "created_at", YEARS(2))); // but nothing lives past 2y
```

Two policies, same table, different names (`messages` and `messages:maxage`) so both run and both are
individually visible in `sweepAll()` results.

## The unified registry (vs. "each module hand-rolls its own DELETE")

The failure mode is organizational, not technical. When each module writes its own cleanup, three
things rot:
1. Some modules **forget entirely** (`semantic_resolution_events` — no prune at all).
2. Some build the machinery but **never finish** (`harbor_issued_tokens` had `idx_hit_expires` — the
   reaper index — but the `DELETE` was never written; 101K rows).
3. There is **no single list** of "what gets cleaned and how," so a new unbounded table is invisible
   until the DB is 231 MB.

A registry inverts this: one object holds every policy; `sweepAll(now)` runs them all, isolates
per-policy failures (one broken sweep can't starve the others), and returns per-table deleted counts
for a single governed log line. Adding a table is **one line**, not a new bespoke function:

```ts
const registry = new RetentionRegistry(db, log)
  .registerAll([
    ttlPolicy(db, "sessions", "expires_at"),
    ttlPolicy(db, "harbor_issued_tokens", "expires_at"),
    maxAgePolicy(db, "harbor_issued_tokens", "issued_at", DAYS(7)),  // backstop
    maxAgePolicy(db, "activity_log", "created_at", DAYS(30)),
    capPolicy(db, "recent_errors", "id", 1000),
  ]);
```

## Fail-loud coverage guard

The registry is worthless if a new table silently escapes it. The guard makes omission a **test
failure, not a prod incident**: maintain a `WATCHED_TABLES` list (or derive it from `sqlite_master`),
and assert every entry has *some* policy.

```ts
// In a unit test — trips RED the moment someone ships an unbounded table.
registry.assertRegistered(WATCHED_TABLES);   // throws: "no policy registered for table(s): foo"
```

Derive `WATCHED_TABLES` from the live schema so the test *can't* be gamed by forgetting to add the
table to two lists:

```ts
const live = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
).all().map(r => r.name);
registry.assertRegistered(live.filter(t => !EXEMPT.has(t)));  // EXEMPT = config/lookup tables
```

`EXEMPT` is the explicit, reviewed escape hatch for genuinely-bounded config tables. Making exemption
*explicit* is the point: a reviewer sees the addition in the diff.

The standalone `scripts/db_retention_audit.py` is the CI/ops mirror of this guard — point it at a live
DB file with `--registered <covered tables>` and it flags every base table without coverage, plus the
compaction problems the in-process guard can't see (freelist waste, `auto_vacuum=NONE`).

## Scheduling the sweep

Run `sweepAll(now)` on a timer (e.g. every few minutes) *and* opportunistically (the counters module
prunes on flush every 6h — cheap because it piggybacks on work already happening). Then call
`reclaim()` — see `compaction-and-wal.md`; pruning rows is only half the job.

## Two horizons

### Dev-on-dev (single tenant, one machine)
Conservative fixed horizons (30–90 days), a single global sweep timer, `auto_vacuum=INCREMENTAL` so
the file breathes. The whole registry is ~15 lines. The goal is simply "the DB doesn't grow forever on
my laptop." This is the port-daddy case.

### Multi-tenant (per-tenant quota + ceilings)
Horizons alone don't bound a *noisy tenant* — one tenant can blow the shared file with in-horizon rows.
Add a **per-tenant cap** on top of the global age policy:

```sql
-- Keep only the newest :per_tenant_max rows PER tenant (windowed cap).
DELETE FROM events WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at DESC) AS rn
    FROM events
  ) WHERE rn > :per_tenant_max
);
```

Design rules for multi-tenant retention:
- **Quota is a product tier, not a constant** — store `retention_days` / `row_cap` per tenant, join it
  in, so an enterprise tenant keeps 400 days and free keeps 30 without code forks.
- **Enforce the ceiling even for "permanent" rows** — a tenant setting `expires_at = NULL` must not let
  them mint unbounded storage; the per-tenant absolute cap still applies.
- **Reclaim is global** — `incremental_vacuum` operates on the whole file; you can't vacuum "one
  tenant." Budget freelist growth across all tenants.
- **Isolate the sweep per tenant** so one tenant's malformed data (e.g. a null `created_at`) can't
  block every other tenant's cleanup — same failure-isolation principle as per-policy `try/catch`.
