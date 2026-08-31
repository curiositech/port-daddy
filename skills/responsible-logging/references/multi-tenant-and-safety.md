# Two Horizons: Correlation Ids + Observability-as-Non-Critical

Two concerns that outlive the immediate storm fix.

## Horizon (a): multi-tenant — correlation ids in every line

When a service grows to many users/devices/tenants, a log line that says only
`semantic_resolution_failed` is nearly useless: *whose* request? *which* tenant? You
cannot correlate a slow request across its own lines, let alone bill or audit it. The
Port Daddy absence audit's #1 multi-tenant blocker was exactly this: `tenantId` appeared
**nowhere** and no request/trace id was threaded through logging.

### Thread `{ requestId, actorId, tenantId }` implicitly

Passing ids through every function signature is infeasible. Carry them in
**`AsyncLocalStorage`** (Node), a context var (Python `contextvars`), or a `context.Context`
(Go) so they ride the async call tree without touching call sites:

```ts
// establish once, in the request entry hook (Fastify onRequest, middleware, etc.)
runWithContext({ requestId: newRequestId(), actorId, tenantId }, () => handler());

// downstream: every governed line auto-merges request_id/actor_id/tenant_id into meta
function withCorrelationSink(sink) {
  const wrap = (lvl) => (msg, meta) => sink[lvl](msg, withCorrelation(meta));
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
}
```

Compose it **under** the governor so correlation is automatic on every line — no call
site changes, and even suppression rollups carry the ids of the last occurrence.

### Attribution is not authorization

`tenantId`/`actorId` in a log are for **attribution**, only as trustworthy as whatever
resolved them (a verified token, say). **Never gate access on them** without a real auth
check. A log field is evidence of what happened, not a permission.

### Dedup keys stay tenant-STABLE

Do **not** put `tenantId` in the governor key, or a storm that hits 10,000 tenants
becomes 10,000 distinct keys and the dedup collapses. Keep the key the event shape; put
`tenant_id` in `meta`. If you truly need per-tenant burst budgets, cap `maxKeys` and
accept LRU eviction (which still flushes rollups) — never make the key unbounded.

## Horizon (b): dev-on-dev dogfooding (present reality)

Today the same daemon is often a developer running the daemon against their own machine.
The stakes look lower, but the 313 GB storm happened *precisely here* — on a dev box,
overnight, unwatched. Two implications:

- **The `SelfMonitor` matters most in dev.** Nobody is paging on a dev daemon. Alarm on
  the daemon's **own** DB/WAL/per-table footprint and growth rate, not whole-disk % (a
  whole-disk alarm fires only when it is already far too late). Route those alarms
  *through the governor* so the alarm can't become the storm it watches for.
- **`requestId` still pays off** even single-tenant: it correlates one slow local request
  across its own lines. Set `actorId`/`tenantId` to a dev placeholder now so the wiring
  exists before real tenants arrive — retrofitting correlation across a live codebase is
  the expensive path.

## Observability must never be critical for liveness

The hardest rule, and the easiest to violate under deadline. **A broken observability
sink must not be able to crash or stall the process it observes.**

- **Every emit is wrapped.** A sink that throws (disk full, closed fd, serialization
  bomb) is swallowed — the daemon keeps serving: wrap the sink call in `try { emit } catch {}`.
- **Failure-logging is itself governed.** The log that reports "the retention sweep
  failed" must dedup, or a persistent failure re-creates the storm one level up. Every
  primitive in `lib/observability/` logs its *own* failures through the governor.
- **Optional enrichment degrades, it does not block.** If the embedder/enricher is down,
  `tryGet()` returns `null` and the caller skips it — the request still completes. Never
  make a log-enrichment dependency a hard requirement on the request path.
- **Bounded memory everywhere.** The governor's key map, the self-monitor's history — all
  capped. An observability component that leaks memory is an outage it caused, not caught.

The test for all of this: *inject a sink that throws on every call and assert the service
still processes requests.* If it can't, observability is critical and must be fixed.
