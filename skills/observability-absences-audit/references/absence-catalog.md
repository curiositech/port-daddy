# Absence Catalog — Six Categories, With Detection Methods

The audit hunts for *events that should exist and don't*. For each category below:
a one-line definition, the **questions** that expose the gap, the **grep patterns**
that find the code that computes-but-drops the event, and the **fix shape** (what
event to emit and to which plane — see `event-plane-routing.md`).

Grep patterns are starting points, not a keyword classifier. They locate *code
sites* (functions, enums, catch blocks) to inspect by hand. Read the surrounding
code; the absence is a judgement call, not a string match.

---

## 1. SECURITY audit trail

**Definition**: Security-relevant actions land only in ephemeral stdout logs, or
nowhere — so a tenant can never be shown who touched their data, and an incident
can't be reconstructed.

**The events that must exist (and usually don't):**
- token mint / issue
- token validate → **reject** (the reject is the interesting one; accepts are noise)
- token revoke / expire
- permission or scope grant / change
- secret / credential access (read of an API key, private key, env secret)
- membership change (add/remove a member from a tenant, org, or team)

**Questions to ask:**
- If a tenant emails "who accessed my project last Tuesday?", can you answer from a
  durable, queryable store — or only from log files that rotated away?
- When a token is rejected, is there a durable row naming the actor, the reason, the
  tenant, and the time? Or does the reject just return 401 and vanish?
- Is secret *access* recorded, or only secret *rotation*?
- Do membership changes produce an audit row, or only mutate a table with no history?

**Grep patterns** (locate the code, then check whether it emits a durable event):
```
grep -rniE 'mint|issue.?token|sign.?token|jwt|verifyToken|validateToken' lib/ src/
grep -rniE 'revoke|scope|permission|grant|authoriz' lib/ src/
grep -rniE 'process\.env\[|readFileSync.*(secret|key|cred)|getSecret' lib/ src/
grep -rniE 'addMember|removeMember|invite|membership|role\s*=' lib/ src/
# Then: does the hit sit near an activity.log(...) / audit insert? If not → absence.
```

**Fix shape**: emit to the **durable audit plane** with
`{ type, actor_id, tenant_id, target, reason, ts }`. Rejects and revokes are P0 for
GA even if accepts are sampled. A `SECURITY_TOKEN_REJECT` that only `console.warn`s
is a silent event.

---

## 2. COORDINATION integrity

**Definition**: The daemon computes a coordination decision — a lock was stolen, a
claim conflicted, a split-brain was detected and a takeover performed — and then
throws the finding away instead of recording it.

**The events that must exist:**
- lock steal / forced release / **expire** (an expiring lock is a coordination fact,
  not a cleanup detail)
- lock contention (N waiters blocked on one lock)
- port-claim conflict (two agents wanted the same berth)
- split-brain detection + daemon takeover (the code path exists *because* an incident
  happened — and yet it often logs nothing durable)

**Real example (port-daddy):** `ActivityType.LOCK_EXPIRE` is defined in the enum but
never emitted anywhere — a **dead enum is a silent event**. A daemon-takeover module,
written specifically in response to a split-brain outage, computed the takeover and
logged only to stdout. The most safety-critical path was the least observable.

**Questions to ask:**
- For every enum value / event constant, grep for its emit site. Any with zero emits?
- When a lock expires vs is released cleanly, are they distinguishable in the record?
- When a takeover fires, is there a durable row (who won, who was evicted, why)?
- Is contention (waiters queued) ever counted, or only the eventual acquire?

**Grep patterns:**
```
# Dead-enum hunt: every constant should have an emit site.
grep -rnoE "ActivityType\.[A-Z_]+" lib/ src/ | sort -u        # defined
grep -rn  "ActivityType.LOCK_EXPIRE" lib/ src/                 # emitted? (often 0)
grep -rniE 'takeover|split.?brain|steal|force.?release|preempt' lib/ src/
grep -rniE 'EADDRINUSE|port.*in use|claim.*conflict|already claimed' lib/ src/
```

**Fix shape**: emit takeover/steal/expire/conflict to the **durable audit plane**
(they are forensic); emit contention *depth* as a **metric** on the ephemeral plane.

---

## 3. RESOURCE self-monitoring

**Definition**: The process watches everything except itself. No alarm fires as its
own database, WAL, disk, or write-rate grows without bound.

**Real example (port-daddy):** a SQLite database grew to **313 GB** unnoticed — the
"313 GB blind spot" — because nothing sampled the daemon's own on-disk footprint.

**The signals that must exist:**
- DB / WAL file size (sampled on a timer, with a threshold alarm)
- write rate (rows/sec into hot tables; runaway inserts)
- table row counts for unbounded tables (activity_log, events, metrics)
- open file descriptors, RSS, respawn count of the daemon itself

**Questions to ask:**
- What samples the daemon's own DB size, and what threshold alarms on it?
- Is there any bound on the largest table, and is the *bound itself* monitored (a
  retention job that silently stops is a second blind spot)?
- If writes 10×'d overnight, what surface would show it before disk fills?

**Grep patterns:**
```
grep -rniE 'statSync|\.size|du -sh|WAL|wal_checkpoint|PRAGMA' lib/ src/
grep -rniE 'retention|cleanup|prune|MAX_.*ENTRIES|vacuum' lib/ src/
# Absence signal: retention/cleanup exists but nothing ALARMS when it under-runs.
```

**Fix shape**: a periodic self-probe emitting **metrics** (`db_bytes`, `wal_bytes`,
`writes_per_min`, `table_rows{table}`) plus a **durable** `RESOURCE_ALARM` row when a
threshold trips (so the trip is auditable after the fact, not just a transient gauge).

---

## 4. FAILURE visibility

**Definition**: Failures that don't route through a caller's try/catch are invisible:
process-level crashes, and dependencies that fail to load leaving the service in a
silently degraded mode.

**The handlers that must exist:**
- global `process.on('unhandledRejection', …)`
- global `process.on('uncaughtException', …)`
- a **degraded-mode signal** when an optional dependency/module fails to load
  (feature silently off is worse than a hard failure — nobody knows it's gone)

**Questions to ask:**
- Is there exactly one global unhandledRejection / uncaughtException handler that
  logs durably before exit? Grep says how many (often zero).
- When a plugin/loader/optional dep throws at startup, does the service announce
  "running degraded: X unavailable", or does it just skip X in a swallowed catch?
- Do `catch {}` / `.catch(() => {})` blocks swallow errors with no record?

**Grep patterns:**
```
grep -rn  "unhandledRejection\|uncaughtException" .    # expect ≥1; zero = P0 absence
grep -rniE 'catch\s*\{\s*\}|catch\s*\(\w*\)\s*\{\s*\}' lib/ src/   # empty catches
grep -rniE '\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)' lib/ src/   # swallowed rejects
grep -rniE 'try\s*\{\s*require|import\(' lib/ src/       # optional-dep loads
```

**Fix shape**: install global handlers that write a durable `CRASH` record then exit
non-zero (let the supervisor restart). For optional deps, emit a durable
`DEGRADED_MODE{component, reason}` event and expose it on a health surface.

---

## 5. CORRELATION / ATTRIBUTION

**Definition**: Nothing threads `requestId` / `actorId` / `tenantId` through logs,
metrics, and audit rows. This is the **#1 multi-tenant blocker** — without it none of
categories 1–4 can be attributed to *who* or *which tenant*.

**Real example (port-daddy):** `tenant_id` appeared **literally nowhere** in the
codebase, and no request/trace id was threaded through logging. A slow request could
not be correlated across its own log lines, let alone to a tenant for audit or billing.

**Questions to ask:**
- Grep the whole tree for `tenant_id` / `tenantId`. Zero hits in a multi-tenant
  service is a five-alarm absence.
- Can two log lines from the same request be joined? Is there a `request_id` on both?
- Is correlation carried implicitly (AsyncLocalStorage) so call sites don't each have
  to thread it, or is it absent because threading-by-hand was deemed infeasible?

**Grep patterns:**
```
grep -rniE 'tenant_?id|actor_?id|request_?id|trace_?id|correlation' lib/ src/
grep -rniE 'AsyncLocalStorage|als\.getStore|runWithContext' lib/ src/
# Absence signal: logger.info(...) calls with a bare message and no correlation meta.
```

**Fix shape**: a `CorrelationContext { requestId, actorId, tenantId }` carried in
`AsyncLocalStorage`, established in an `onRequest` hook, auto-merged into every log
line / metric / audit row by the governed logger — **no call-site changes**. Note:
these fields are for **attribution, not authorization** — never gate access on them
without a real auth check.

---

## 6. Ephemeral vs durable — the plane question

Every event above has a second question after "should this be logged?": **on which
plane?** Getting this wrong is its own absence — a security event on the ephemeral
plane is *effectively unlogged* because it rotates away before anyone queries it.

See `event-plane-routing.md` for the full routing table. The one-line rule:

> If someone will one day need to **query** this event (an incident, an audit request,
> a bill dispute), it belongs on the **durable, queryable audit plane**. If it's only
> useful **live** (tailing, dashboards, aggregate rates), the **ephemeral log/metric
> plane** is correct. When unsure, ask: "who asks for this, and how long after it
> happened?"
