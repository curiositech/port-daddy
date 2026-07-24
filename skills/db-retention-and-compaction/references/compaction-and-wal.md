# Compaction, VACUUM & WAL Tuning

Consult when the DB file won't shrink after pruning, when tuning WAL/checkpoint behavior, or when
deciding between `auto_vacuum` modes and manual `VACUUM`. This is the half of the job that pruning
rows does **not** do.

## The core, non-obvious truth: DELETE does not shrink the file

When you `DELETE` rows, SQLite marks their pages **free** (adds them to the freelist) and reuses them
for future inserts. It does **not** return them to the OS. A DB that pruned millions of rows over
months can sit at 231 MB on disk with a mostly-empty freelist doing nothing — the real port-daddy
case. The retention sweep was working perfectly; the file just never gave anything back.

To actually shrink the file you need **one of**:

| Mechanism | What it does | Cost | When |
|-----------|--------------|------|------|
| `VACUUM` | Rebuilds the entire DB into a new compact file | Rewrites whole DB, takes a write lock, needs ~2x disk temporarily | Rare, off-peak; one-time after a big cleanup |
| `PRAGMA incremental_vacuum(N)` | Returns up to N freelist pages to the OS | Cheap, incremental, no full rewrite | Every maintenance cycle — the steady-state answer |
| `auto_vacuum=FULL` | Compacts on **every commit** automatically | Per-commit overhead, fragments | Rarely worth it; INCREMENTAL is almost always better |

## auto_vacuum modes

`PRAGMA auto_vacuum` is `NONE (0)`, `FULL (1)`, or `INCREMENTAL (2)`.

- **NONE** — the default. Freelist pages are never returned. `incremental_vacuum` is a no-op. The only
  way to shrink is a full `VACUUM`. **This is the setting that produced the 231 MB file.**
- **INCREMENTAL** — SQLite maintains the bookkeeping (a pointer map) needed for `incremental_vacuum` to
  return pages cheaply on demand. This is what you want for a long-lived pruning service.
- **FULL** — auto-compacts every commit; measurable write overhead and more fragmentation. Skip it.

### The gotcha that bites everyone

**`auto_vacuum` can only be changed on an empty DB, or by a full `VACUUM`.** Setting the pragma on an
existing populated NONE database does nothing by itself — you must follow it with one `VACUUM` to
rewrite the file with the new mode's page layout:

```sql
PRAGMA auto_vacuum = INCREMENTAL;   -- takes effect only after the rewrite below
VACUUM;                             -- one-time: rewrites file, now INCREMENTAL is live
```

For a **new** DB, set it in the open path *before the first table is created* and no VACUUM is needed.
This is precisely the gap in port-daddy's `lib/db.ts`: it sets `journal_mode=WAL`,
`synchronous=NORMAL`, `wal_autocheckpoint=200` — but never `auto_vacuum`, so it defaults to NONE and
`reclaim()`'s `incremental_vacuum` silently returns 0 pages forever.

### Steady-state reclaim pattern

```ts
// Run on the maintenance cycle, AFTER sweepAll(). Requires auto_vacuum=INCREMENTAL.
function reclaim(db, freePageThreshold = 2000): number {
  const freelist = db.pragma("freelist_count", { simple: true });
  if (freelist < freePageThreshold) return 0;   // don't churn for a handful of pages
  db.pragma(`incremental_vacuum(${freelist})`);
  return freelist;
}
```

Threshold-gate it: reclaiming 3 pages every cycle is pointless churn. Wait until enough waste
accumulates (a few thousand pages ≈ several MB), then return it in one cheap incremental pass.

## WAL & checkpoint tuning

WAL (Write-Ahead Logging) lets readers and a writer proceed concurrently. Two knobs matter for a
long-lived service:

```sql
PRAGMA journal_mode = WAL;          -- concurrent read/write; the -wal and -shm sidecar files appear
PRAGMA synchronous = NORMAL;        -- skip the per-commit fsync; crash-safe, NOT power-loss-durable
PRAGMA wal_autocheckpoint = 200;    -- checkpoint (fold WAL back into main db) every ~200 pages
PRAGMA busy_timeout = 5000;         -- wait for locks instead of throwing SQLITE_BUSY
```

- **`synchronous = NORMAL` + WAL** is the standard embedded-service trade: you keep process-crash
  consistency and drop the fsync-per-commit latency. It is *not* a power-loss durability guarantee —
  surfaces that need that must opt into `FULL` with a measured latency budget, or add explicit
  checkpoint+fsync.
- **`wal_autocheckpoint`** bounds how large the `-wal` file grows between checkpoints. Lower = smaller
  WAL, more frequent (cheap) checkpoints. 200 pages is a reasonable default for a chatty daemon; the
  1000-page default lets the WAL balloon between cleanups.
- **The `-wal` file is separate from bloat in the main file.** A large `-wal` means "checkpoint hasn't
  run," not "you need to VACUUM." Don't confuse the two.
- **Checkpoint on clean shutdown**: `PRAGMA wal_checkpoint(TRUNCATE)` folds the WAL back into the main
  file and truncates the sidecar, so you close on a single tidy file.
- **Copying a WAL database is unsafe** as a plain `cp` of the `.db` alone — the committed-but-not-yet-
  checkpointed data lives in `-wal`. Checkpoint first, or use the backup API / `VACUUM INTO`.

## Pre-aggregate metrics into buckets — don't keep raw events forever

The cheapest retention is the row you never store. Raw per-event rows are the fastest path to a bloated
DB. The counters module is the model: instead of one row per event, it **pre-aggregates into
time buckets** (minute as primary key, hour as a rollup index) and increments a `value` column. Dozens
of events per second collapse into one upserted row per (metric, dimensions, minute). Then a single
`maxAgePolicy` prunes buckets older than 30 days.

```
raw events forever:        1 row / event   -> millions of rows, unbounded
pre-aggregated buckets:    1 row / minute  -> 1440 rows/day/metric, then pruned at 30d
```

Design rules:
- Bucket at the coarsest granularity the query needs (minute for dashboards; hour for trends).
- Store dimensions as a canonical sorted-key JSON so grouping is stable and the primary key dedups.
- Batch increments in memory, flush on an interval — no per-event DB write.
- The bucket table *still* needs a retention policy; pre-aggregation shrinks the row rate, it does not
  remove the horizon. Bucketing + a cap/age policy together is the durable combination.

## Diagnosis checklist (map symptom → cause)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| DB file grows forever, rows are being deleted | `auto_vacuum=NONE`, no VACUUM | Set INCREMENTAL + one VACUUM, then `reclaim()` each cycle |
| DB file grows forever, row COUNT also grows | Missing/unwritten retention policy | Register a policy; run the coverage guard |
| `-wal` file is huge, main DB is fine | Checkpoint not running | Lower `wal_autocheckpoint`; checkpoint on shutdown |
| `incremental_vacuum` returns 0 | `auto_vacuum != INCREMENTAL` | Change mode (needs a VACUUM to take effect) |
| One table dwarfs the DB | Raw events, no pre-aggregation | Bucket + cap/age policy |
| Sweep runs but one table never shrinks | Reaper index exists, DELETE never written | Write the DELETE (the `harbor_issued_tokens` trap) |

Run `scripts/db_retention_audit.py <db> --registered <tables>` to get most of this table computed
against a live file: it reports `auto_vacuum`, freelist waste in bytes, and every uncovered table.
