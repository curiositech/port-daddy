# Case Study: The 313 GB Write Storm (Port Daddy)

The grounding incident for this skill. Read it to understand *why* every rule here
exists — each one is a scar. The numbers are real.

## What happened

Port Daddy runs a long-lived local daemon. A fleet-agent tick calls
`semantic-resolver.getEmbedder()` to load an ONNX embedding model. On the affected
dev machine the model's native dylib was missing, so the load **failed permanently**.

Two design mistakes compounded:

1. **A poisoned load-once promise.** `embedderPromise` was memoized on first use and
   *never reset on failure*. A permanently-rejected promise was re-awaited on every
   tick — the failure never healed and never backed off.
2. **Error-level logging inside an unthrottled poll loop with no dedup.** Each tick
   caught the rejection and logged the full error object as `error`, and wrote a DB row.

The tick fired every few seconds, forever. Result:

| Symptom | Magnitude |
|---------|-----------|
| `semantic_resolution_failed` log lines | **7,182** identical, no backoff, no dedup |
| Total bytes written by dev-latest-daemon | **~313 GB** |
| Captured daemon stdout (a single file) | **255 MB**, unrotated |
| SQLite DB (with a companion `semantic_resolution_events` leak) | **~231 MB** |

The winston logger in `server.ts` was configured *correctly* — File transports with
`maxsize: 50MB, maxFiles: 5, tailable: true`. It rotated its files fine. But most of
the volume never went through winston: it went to **raw stdout**, which the
`launchd` job captured to `StandardOutPath` — and **launchd never rotates that file**.
255 MB of it accumulated in one handle. (See `rotation-and-capture-traps.md`.)

## The recurrence — why "patch the call site" is not a fix

This exact shape had happened **before**. Post-mortem
`docs/recovery/2026-05-31-gardener-triage` documented an identical runaway:
`bosun_heartbeat_write_failed` logged in a heartbeat loop with no dedup. It was
patched **narrowly** — that one call site got a guard — and the team moved on.

The *class* stayed open. Months later `semantic_resolution_failed` reproduced it byte
for byte in a different subsystem. **A narrow patch closes an instance; only a shared
primitive closes a class.** The lesson that this skill encodes: when you find one
unthrottled-error-in-a-loop, assume there are others, and fix the *capability gap*
(there was no bounded-logging primitive to reach for) rather than the single line.

## The fix: five composable primitives

The class was closed by building `lib/observability/` — one module a subsystem imports
instead of reaching for `console.*`, a bespoke `appendFileSync`, or a hand-rolled retry:

| Primitive | File | Closes |
|-----------|------|--------|
| `LogGovernor` | `log-governor.ts` | dedup + rate-limit + sampling, with suppression **rollups** so the tail is never silently dropped |
| `RetentionRegistry` | `retention-registry.ts` | one declared TTL/cap policy per table + `VACUUM` reclaim (the 231 MB DB leak) |
| `SelfMonitor` | `self-monitor.ts` | alarms on the daemon's **own** DB/WAL/row footprint — nobody was watching the thing that was growing |
| `GatedLoader` | `gated-loader.ts` | circuit-breaker + jitter around a lazily-loaded dep so a poisoned promise heals instead of re-throwing forever |
| `Correlation` | `correlation.ts` | `requestId`/`actorId`/`tenantId` threaded through every line via `AsyncLocalStorage` |

Each primitive is **pure, dependency-free, and injectable** (`now()`/`random()` passed
in) so it is exhaustively testable, and each **fails safe**: a dropped log or a broken
sink must never throw. Observability is never critical for liveness.

### How a call site changed

```ts
// BEFORE — spams 7,182 lines + a DB row per tick
logger.error('semantic_resolution_failed', { term, error });

// AFTER — first 3 per 60s window emit; the rest are counted and a single
// rollup line reports "…and 4,312 more in 60s". Correlation ids auto-merged.
obs.governed({
  key: 'semantic_resolution_failed',        // STABLE key — no term/id/timestamp in it
  level: 'error',
  message: 'semantic_resolution_failed',
  meta: { term, error: String(error) },
});
```

And the load itself moved behind a `GatedLoader`, so after 3 failures the breaker OPENs,
`tryGet()` returns `null` immediately (the caller skips optional enrichment), and a
half-open probe re-tests after the cool-down — a transient failure still recovers.

## Transferable checklist

- [ ] Is there ONE structured logger, or does `console.*` / `print` sprawl bypass it?
- [ ] Does any `error`/`warn` call sit inside a `for`/`while`/`setInterval`/`.on(`/retry
      loop **without** dedup or backoff? (Run `audit_logging.py`.)
- [ ] When a log is suppressed, is a **rollup** emitted so the tail count survives?
- [ ] Is the daemon's captured stdout (launchd/systemd) rotated by *something*?
- [ ] Is anything watching the daemon's **own** disk/DB footprint, not just whole-disk %?
- [ ] Does a poisoned load-once dependency back off, or re-throw forever?
- [ ] When you fix one instance, did you check for the whole class?
