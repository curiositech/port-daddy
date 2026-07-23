# Threshold Tuning, Growth Rate, and the Two Horizons

## Picking warn/crit ceilings

Thresholds are absolute byte/row counts against your **own** footprint — not
percentages of a shared disk. Set them from a real baseline, not a guess.

1. **Measure steady state.** Run the service under normal load for a representative
   period and record `dbBytes`, `walBytes`, and each watched table's row count.
2. **warn = comfortable headroom above steady state.** Roughly 2–4x the observed
   steady-state high-water mark. Crossing warn means "something changed" — worth a
   glance, not a page.
3. **crit = the largest footprint you can tolerate before harm.** Below the point
   where the volume fills, backups blow their window, or query latency degrades.
   Crossing crit means "act now" and routes to the durable audit sink.
4. **Re-baseline on major schema or workload changes.** Stale thresholds are worse
   than none — a warn that fires constantly gets muted, and a muted alarm is a
   pull-only view with extra steps.

Rule of thumb ratios (adjust to your storage budget):

| Metric | warn | crit |
|--------|------|------|
| DB bytes | 2–4x steady state | volume budget minus backup/temp headroom |
| WAL bytes | a few checkpoints' worth | the point where checkpointing is clearly stalled |
| Per-table rows | 2–4x steady state | the count where scans/indexes degrade |

## Why growth rate matters more than the absolute

An absolute ceiling only alarms once you are *already near the cliff*. The rate
between consecutive samples is the leading indicator:

- `ratePerSec` is computed from `(value - prevValue) / dtSec`. Persist or log it
  with every alarm.
- A DB that normally grows kilobytes/minute suddenly growing megabytes/second is
  a runaway *even while still under the crit ceiling*. That is exactly the shape
  the 313 GB write storm had: a tight failing loop appending error rows.
- Optionally add a **rate threshold** alongside the level thresholds: alarm if
  `ratePerSec` exceeds N for two consecutive samples. Level thresholds catch the
  slow leak; rate thresholds catch the fast burst. You want both.

## Sampling cadence

- Too slow (minutes): a fast runaway can write tens of GB between samples.
- Too fast (sub-second): wasted CPU and `COUNT(*)` pressure on large tables.
- **30s is a sane default** for a daemon. Cache expensive `COUNT(*)`s or use
  table statistics if a watched table is huge.
- `unref()` the timer so monitoring never keeps the process alive on its own.

## Horizon 1 — Multi-tenant: per-tenant footprint metering

In a multi-tenant service, the aggregate footprint hides the abuser. One tenant
can bloat the shared store while every global number looks fine.

- Watch footprint **per tenant**, keyed by tenant id: bytes attributable to the
  tenant (row counts per tenant, or per-tenant table/partition sizes).
- Governor dedup key includes the tenant: `tenant_footprint_crossed:<tenantId>:crit`.
  This is a **structured id field you control** — safe to embed and still
  low-cardinality per tenant (bounded by tenant count, not by events).
- Graduated thresholds become **quota tiers**: warn = approaching plan limit (nudge
  / upsell), crit = hard cap (throttle writes, alert billing/ops).
- The per-tenant meter doubles as usage-based billing input — the same sampler
  that prevents a runaway also produces the metering ledger.

## Horizon 2 — Dev-on-dev: the local daemon that eats your laptop

The original incident was a **dev-latest daemon** writing 313 GB on a developer's
own machine with zero alarm. Dev is where this bites first and gets ignored.

- Ship the self-monitor **enabled by default in dev builds**, with tighter ceilings
  than prod (a dev laptop has far less headroom than a prod volume).
- Route dev alarms somewhere a developer actually sees — the dev console / a
  desktop notification — not just a log file they will never open.
- Treat a dev-build crit alarm as a release blocker: if the daemon can bloat its
  own store on a laptop, it will do it worse in prod. Soak new builds and watch
  the footprint curve before shipping.

## Ephemeral log alarm vs. durable audit alarm

Two sinks, on purpose:

| | Ephemeral (log) | Durable (audit) |
|---|---|---|
| Sink | governed logger → stdout/log file | append-only table / event store |
| Severity | warn and crit | crit only (keep it sparse) |
| Survives log rotation | no | yes |
| Purpose | operator sees it live | post-incident forensics, SLA evidence |
| Governed | yes (dedup + rollup) | yes — via the crit-only gate, not by rate |

The log tells you *now*; the audit tells you *what happened* after the log has
rotated away. A crit alarm that only ever hit a rotated stdout capture is how the
first two incidents became un-diagnosable. Always give crit a durable home.

## Testing the monitor without a filesystem

Because `MetricSources` and `now()` are injected, drive exact scenarios in unit
tests with zero I/O:

- **Threshold crossing:** feed dbBytes just below warn, then just above → assert
  a single `warn` alarm, correct metric/threshold.
- **Growth rate:** two samples with a known `dt` → assert `ratePerSec`.
- **Governed dedup:** many crit samples in one window → assert the log emitted
  `burst` times, then a single rollup; assert the durable sink saw every crit
  (crit is not rate-limited by the level gate — decide whether you want it to be).
- **Failure isolation:** make a source throw → assert `sample()` still returns and
  other metrics are unaffected (`safe()` fallback).
