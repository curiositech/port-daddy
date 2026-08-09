# The Log Governor Primitive (stack-agnostic)

A **log governor** turns "log this, but never let it spam" into a first-class call.
It is the single primitive that closes the unthrottled-error-in-a-loop class. This
reference gives the reusable design; the Port Daddy implementation
(`lib/observability/log-governor.ts`) is the reference realization in TypeScript.

## The contract

`governed(entry)` wraps any leveled sink (`debug/info/warn/error`). Given a **stable
key** and a level/message/meta, it emits the first `burst` occurrences of that key per
`windowMs` window, counts the rest, and — when the window rolls over — emits **one
rollup line** reporting how many were suppressed. Returns whether it actually emitted
(useful to gate expensive meta construction).

```
governed({ key, level, message, meta, sampleEveryN?, windowMs?, burst? }) -> emitted: bool
```

### Three behaviors in one primitive

1. **Dedup + rate-limit per key.** First `burst` (default 3) per window emit; the rest
   are dropped and counted. Window rollover flushes a rollup:
   `{ log_rollup: true, key, suppressed: 4312, seen: 4315, window_ms: 60000 }`.
   You lose redundant bytes, never the fact that it kept happening.
2. **Sampling for high-volume non-error streams.** `sampleEveryN: 100` emits 1-in-100
   (after dedup accounting) and the rollup reports the **true total** via `seen`, so a
   sampled request log never silently under-counts.
3. **Bounded memory.** Track at most `maxKeys` (LRU, default 2000). A bug that generates
   unbounded distinct keys **evicts the oldest and flushes its rollup** — it never leaks
   and never silently drops a tail.

## The rules that make it correct

- **The key must be low-cardinality and STABLE.** Use the *shape* of the event, never
  its instance. `semantic_resolution_failed` — **never** `semantic_resolution_failed:<term>`
  or `...:<timestamp>`. A high-cardinality key defeats dedup: every occurrence is a new
  key, nothing collapses, and you rebuild the storm. Put the varying detail in `meta`,
  not the key.
- **Rollups emit at the level of the event they summarize.** An error storm's rollup is
  an `error`; a sampled info stream's rollup is `info`.
- **Flush on shutdown.** Call `flushAll()` in the shutdown path so suppressed tails from
  the final, still-open window are not lost.
- **A dropped log must never throw.** Wrap the sink call; swallow sink exceptions.
  Observability is not load-bearing for liveness (see the safety reference).
- **Pure + injectable clock.** Pass `now()` in so the whole thing is deterministically
  testable with zero real time and zero filesystem.

## Reference pseudocode

```
class LogGovernor(sink, windowMs=60000, burst=3, maxKeys=2000, now=clock):
    keys = OrderedMap()   # insertion-ordered → used as LRU

    def governed(entry):
        st = touch(entry.key)                 # LRU get-or-create; evict+flush oldest at cap
        if now() - st.windowStart >= (entry.windowMs or windowMs):
            flushRollup(st)                    # emit suppression summary for closed window
            st.reset(windowStart=now())
        st.seen += 1
        N = entry.sampleEveryN or 1
        if N > 1 and st.seen % N != 0:
            st.suppressed += 1; return False   # sampling gate
        if st.emitted < (entry.burst or burst):
            st.emitted += 1
            safeEmit(entry.level, entry.message, entry.meta); return True
        st.suppressed += 1; return False       # rate-limit gate

    def flushRollup(st):
        if st.suppressed <= 0: return
        safeEmit(st.level, st.message,
                 { log_rollup: True, key, suppressed: st.suppressed,
                   seen: st.seen, window_ms: elapsed })

    def safeEmit(level, msg, meta):
        try: sink[level](msg, meta)
        except: pass                           # a broken sink cannot crash the daemon
```

## Where to reach for which primitive

| Situation | Primitive | Note |
|-----------|-----------|------|
| Error/warn that can fire every tick | `governed({level:'error', key})` | dedup + rollup |
| Chatty request/trace stream | `governed({sampleEveryN:N})` | true total in rollup |
| Genuinely one-shot event (boot, shutdown) | passthrough `info()/error()` | no key needed |
| A dependency that can fail permanently | **GatedLoader** (circuit breaker) | governor alone doesn't heal the *source*; back off the retry too |
| A table/file that grows forever | **RetentionRegistry** / rotation | governing the log doesn't bound the data |

The governor bounds the **logging** of a failure. It does **not** fix the failure. Pair
it with backoff/circuit-breaking on the failing operation itself, or you have a quiet
loop that still burns CPU and still never recovers.

## Porting to other stacks

- **Go**: wrap `slog.Handler`; key off a stable string; `sync.Map` + a mutex-guarded LRU.
- **Rust**: a `tracing` layer; `parking_lot::Mutex<LruCache>`; emit rollup on window roll.
- **Python**: a `logging.Filter` keyed on a stable `extra['log_key']`, or a thin wrapper.
- **Any**: the primitive is ~150 lines and dependency-free. Copy the contract, not the code.
