# Query-Fix-First: The Step 1 Diagnostic Checklist

Read this when you're at the top of the decision tree in SKILL.md and need to actually distinguish
"this needs a cache" from "this needs a 10-minute query fix." Skipping this step is the single most
common reason caching layers get added and then don't help (or make things worse at the next cold start).

## The three culprits, in order of frequency

### 1. Missing index

**Symptom**: `EXPLAIN ANALYZE` shows a `Seq Scan` (Postgres) or `type: ALL` (MySQL) on a table with more
than a few thousand rows, where the query filters or joins on a column with no index.

**Check**:
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42 AND status = 'pending';
```
If you see `Seq Scan on orders` with a high `cost` and `rows` estimate far larger than what's actually
returned, that's the tell. Add a composite index matching the filter columns in selectivity order
(most selective first), then re-run `EXPLAIN ANALYZE` to confirm it now uses an `Index Scan` or
`Index Only Scan`.

**Fix cost**: Usually one `CREATE INDEX CONCURRENTLY` statement plus a migration. Minutes, not days.

### 2. N+1 query pattern

**Symptom**: One "logical" request to render a list triggers 1 query for the list plus N queries
(one per row) for related data — visible as a burst of near-identical queries in slow-query logs or
ORM debug output, scaling linearly with result-set size.

**Check**: Turn on ORM query logging for one request and count queries. If loading 20 items in a list
view issues 21+ queries where 2 would do, you have an N+1.

**Fix**: Batch the related-data fetch — eager loading (`.includes` / `JOIN` / `dataloader` pattern /
`selectinload`) instead of lazy-loading inside a loop. This is a code change in the query-building
layer, not a cache.

### 3. Unbounded scan / missing pagination

**Symptom**: An endpoint does `SELECT * FROM table` (or an unfiltered/unlimited equivalent) and the
table has grown from hundreds of rows at launch to hundreds of thousands at scale. The query was fine
in dev and staging and only became slow as data volume grew — not as traffic grew.

**Check**: Does the query have a `LIMIT`/cursor? Does response size grow linearly with table size over
time, independent of request volume?

**Fix**: Add pagination (offset/limit for simple cases, keyset/cursor pagination for large or
frequently-inserted tables) and push filtering into the query rather than the application layer.

## Decision after diagnosis

- Any of the three found and fixed, and the endpoint is now fast enough — **done, no cache needed.**
- Fixed and still too slow because the *computation itself* is expensive (aggregation across millions
  of rows, cross-service fan-out, full-text search ranking) — **caching is now justified.** Return to
  SKILL.md Step 3.
- None of the three present, and read volume vastly exceeds write volume on data that tolerates some
  staleness — **caching is justified without a query-level fix**, because there's nothing broken to
  fix — the query is doing necessary, correctly-indexed work, just very often.

## Why this order matters

A cache papers over exactly the query patterns above without removing their cost. The DB still runs
the expensive query at each cache miss (deploy, restart, eviction, or key expiry) — and now those
misses can arrive in a synchronized burst (see `references/stampede-and-eviction.md`), making the
worst case *worse* than the uncached baseline. Fixing the query removes the cost everywhere, forever;
caching only defers and reshapes it.
