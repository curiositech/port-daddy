# Stampede Mitigation and Eviction Policy

Read this when implementing Step 5 of SKILL.md — you've already decided to cache, picked cache-aside
or write-through, and picked TTL or event-based invalidation. This is the "don't let the cache layer
create a new outage mode" checklist.

## Cache stampede (thundering herd)

**The failure**: A hot key expires (or the cache restarts cold). N concurrent requests all miss at
once, all go to the database simultaneously to recompute the same value, and the DB gets hit with N
copies of the same expensive query at the exact moment it was supposed to be protected.

### Mitigation 1: Single-flight lock (recompute-once)

Only one request repopulates the cache; the rest either wait briefly for it or serve stale data.

```python
def get_with_singleflight(key, compute_fn, ttl=300, lock_ttl=10, stale_ttl=None):
    value = cache.get(key)
    if value is not None:
        return value

    lock_key = f"lock:{key}"
    got_lock = cache.set(lock_key, "1", nx=True, ex=lock_ttl)

    if got_lock:
        try:
            value = compute_fn()
            cache.set(key, value, ex=ttl)
            return value
        finally:
            cache.delete(lock_key)
    else:
        # Someone else is recomputing. Serve stale if we have it, else
        # short-poll for a bounded time, else fall through to compute_fn
        # as a last resort (do not let every request block forever).
        stale = cache.get(f"stale:{key}") if stale_ttl else None
        if stale is not None:
            return stale
        for _ in range(5):
            time.sleep(0.05)
            value = cache.get(key)
            if value is not None:
                return value
        return compute_fn()  # last resort — accept the DB hit rather than fail the request
```

The `nx=True` (set-if-not-exists) lock is the key primitive: Redis's `SET key val NX EX ttl` is atomic,
so exactly one concurrent caller wins the race to recompute.

### Mitigation 2: Probabilistic early expiration

Instead of a hard TTL where every reader agrees the key is stale at the same instant, refresh
*slightly before* the real expiry, with the exact moment randomized per key so refreshes are staggered
rather than synchronized.

```python
import random, time, math

def get_with_early_refresh(key, compute_fn, ttl=300, beta=1.0):
    entry = cache.get_with_metadata(key)  # (value, computed_at, delta)
    if entry is None:
        value, delta = _recompute(key, compute_fn, ttl)
        return value

    value, computed_at, delta = entry
    now = time.time()
    # XFetch-style early recompute probability — the older the value, the more
    # likely a given reader triggers an early refresh, spreading load out over time.
    should_refresh = (now - computed_at - beta * delta * math.log(random.random())) >= ttl
    if should_refresh:
        return _recompute(key, compute_fn, ttl)
    return value

def _recompute(key, compute_fn, ttl):
    start = time.time()
    value = compute_fn()
    delta = time.time() - start
    cache.set_with_metadata(key, value, computed_at=time.time(), delta=delta, ex=ttl)
    return value
```

This is the "XFetch" pattern (probabilistic early expiration): cheap to implement, avoids a
synchronized wall of misses without needing a distributed lock.

**Never do**: set every key in a batch job to the identical TTL, or restart a cold cache and let
traffic hit it unthrottled. Both create a synchronized expiry wall. Stagger TTLs with jitter
(`ttl = base_ttl + random.uniform(-jitter, jitter)`) even without the full early-refresh pattern above.

## Eviction policy: always set `maxmemory-policy` explicitly

Redis's default (`noeviction`) makes writes start failing with `OOM command not allowed` once memory
fills — it does not gracefully evict anything. For a cache (as opposed to a durable store), that's
almost never what you want.

| Workload shape | Recommended `maxmemory-policy` |
|---|---|
| General-purpose cache-aside, uniform popularity | `allkeys-lru` |
| Cache-aside with a clear hot/cold split (some keys much hotter) | `allkeys-lfu` |
| Mixed cache + durable keys in the same instance (avoid this if possible) | `volatile-lru` (only evicts keys with a TTL set) |
| You need to know immediately when capacity is exceeded, and can't tolerate silent eviction | `noeviction` + alerting on `used_memory` approaching `maxmemory` — but this is rarely the right default for a cache |

Set it explicitly in config (`maxmemory-policy allkeys-lru`) or via `CONFIG SET` — don't rely on the
Redis default. Combine with `maxmemory` sized to your actual working set plus headroom, and monitor
eviction rate (`evicted_keys` in `INFO stats`) — a rising eviction rate under steady traffic is an
early signal that either the working set has outgrown the instance or key cardinality is unbounded
(see the "Unbounded Cache Key Growth" anti-pattern in SKILL.md).
