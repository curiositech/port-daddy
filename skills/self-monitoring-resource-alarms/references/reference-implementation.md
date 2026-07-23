# Reference Implementation

Two composable primitives. Copy them into any service (Node/TypeScript shown;
the shapes port directly to Python, Go, Rust). Both are pure and dependency-free
so they are exhaustively unit-testable with an injected clock and injected
metric sources — no filesystem, no real timers.

The pairing is deliberate:

- **`SelfMonitor`** answers *"is my own footprint growing toward a ceiling?"*
- **`LogGovernor`** answers *"can this alarm ever become the spam it was built to catch?"* (no)

Route every `SelfMonitor` alarm through a `LogGovernor` so a sustained breach
reports once per window with a rollup, not once per sample.

---

## 1. LogGovernor — dedup + rate-limit so an alarm cannot spam

The class of bug this closes: a persistently-failing operation inside a loop
that fires every few seconds, each failure logging a full error object. No
backoff, no dedup → thousands of identical lines, an unrotated multi-hundred-MB
stdout capture, a bloated DB. The fix is to make *"log this, but never let it
spam"* a first-class call.

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A leveled sink shaped like a winston logger. */
export interface LeveledSink {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface GovernorConfig {
  windowMs: number;   // window over which burst + suppression reset. Default 60_000.
  burst: number;      // occurrences of a key that emit per window before suppression. Default 3.
  maxKeys: number;    // max distinct keys tracked before LRU eviction. Default 2_000.
  now?: () => number; // injected clock; defaults to Date.now.
}

const DEFAULTS = { windowMs: 60_000, burst: 3, maxKeys: 2_000 };

export interface GovernedLog {
  /**
   * Stable dedup key. MUST NOT embed unbounded/high-cardinality values (ids,
   * timestamps, raw error strings) or the governor can't collapse the spam.
   * Use the STABLE shape of the event: `semantic_resolution_failed`,
   * never `semantic_resolution_failed:<term>`.
   */
  key: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  sampleEveryN?: number; // emit 1-in-N after dedup, for chatty info streams. Default 1.
  windowMs?: number;     // per-key override (e.g. a slow, expensive alarm).
  burst?: number;        // per-key override.
}

interface KeyState {
  windowStart: number;
  emitted: number;    // real emissions in the current window
  suppressed: number; // dropped occurrences (dedup + sampling)
  seen: number;       // total occurrences (for honest sampling rollups)
  level: LogLevel;
  message: string;
}

export class LogGovernor {
  private readonly cfg: Omit<Required<GovernorConfig>, 'now'>;
  private readonly now: () => number;
  /** Insertion-ordered Map used as an LRU (delete+set moves a key to newest). */
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly sink: LeveledSink, cfg: Partial<GovernorConfig> = {}) {
    this.cfg = {
      windowMs: cfg.windowMs ?? DEFAULTS.windowMs,
      burst: cfg.burst ?? DEFAULTS.burst,
      maxKeys: cfg.maxKeys ?? DEFAULTS.maxKeys,
    };
    this.now = cfg.now ?? Date.now;
  }

  // Passthrough for genuinely one-shot events (startup, shutdown, config load).
  debug(m: string, meta?: Record<string, unknown>) { this.safeEmit('debug', m, meta); }
  info(m: string, meta?: Record<string, unknown>)  { this.safeEmit('info', m, meta); }
  warn(m: string, meta?: Record<string, unknown>)  { this.safeEmit('warn', m, meta); }
  error(m: string, meta?: Record<string, unknown>) { this.safeEmit('error', m, meta); }

  /**
   * Log an event that may fire in a loop. Returns true if emitted, false if
   * suppressed (useful for gating expensive meta construction).
   */
  governed(entry: GovernedLog): boolean {
    const now = this.now();
    const windowMs = entry.windowMs ?? this.cfg.windowMs;
    const burst = entry.burst ?? this.cfg.burst;
    const st = this.touch(entry.key, now, entry.level, entry.message);

    // Roll the window forward, flushing a rollup for the window that just closed.
    if (now - st.windowStart >= windowMs) {
      this.flushRollup(entry.key, st, now - st.windowStart);
      st.windowStart = now; st.emitted = 0; st.suppressed = 0; st.seen = 0;
    }

    st.seen += 1; st.level = entry.level; st.message = entry.message;

    const n = entry.sampleEveryN && entry.sampleEveryN > 1 ? Math.floor(entry.sampleEveryN) : 1;
    if (n > 1 && st.seen % n !== 0) { st.suppressed += 1; return false; }

    if (st.emitted < burst) { st.emitted += 1; this.safeEmit(entry.level, entry.message, entry.meta); return true; }
    st.suppressed += 1; return false;
  }

  /** Flush every pending rollup — call on shutdown so suppressed tails aren't lost. */
  flushAll(): void {
    const now = this.now();
    for (const [key, st] of this.keys) {
      this.flushRollup(key, st, now - st.windowStart);
      st.suppressed = 0; st.seen = 0; st.emitted = 0; st.windowStart = now;
    }
  }

  /** Snapshot for the self-monitor / dashboards: which keys are being suppressed. */
  snapshot() {
    return [...this.keys.entries()].map(([key, st]) => ({ key, suppressed: st.suppressed, seen: st.seen }));
  }

  private touch(key: string, now: number, level: LogLevel, message: string): KeyState {
    const existing = this.keys.get(key);
    if (existing) { this.keys.delete(key); this.keys.set(key, existing); return existing; }
    if (this.keys.size >= this.cfg.maxKeys) {
      const oldestKey = this.keys.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        const oldest = this.keys.get(oldestKey)!;
        this.flushRollup(oldestKey, oldest, now - oldest.windowStart);
        this.keys.delete(oldestKey);
      }
    }
    const fresh: KeyState = { windowStart: now, emitted: 0, suppressed: 0, seen: 0, level, message };
    this.keys.set(key, fresh);
    return fresh;
  }

  private flushRollup(key: string, st: KeyState, elapsedMs: number): void {
    if (st.suppressed <= 0) return;
    this.safeEmit(st.level, st.message, {
      log_rollup: true, key, suppressed: st.suppressed, seen: st.seen,
      window_ms: Math.max(0, Math.round(elapsedMs)),
    });
  }

  /** Emitting a log must never throw — a broken sink cannot crash the daemon. */
  private safeEmit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    try { this.sink[level](message, meta); } catch { /* observability is not load-bearing for liveness */ }
  }
}
```

Key discipline: **the dedup key must be low-cardinality.** `resource_threshold_crossed:db_bytes:crit` is stable; `resource_threshold_crossed:db_bytes:crit:1721430000` defeats the governor because every sample mints a new key.

---

## 2. SelfMonitor — sample your OWN footprint and alarm on growth

Reads the service's own footprint (not whole-disk), evaluates graduated
thresholds, and raises a governed alarm plus an optional **durable** audit event.
Growth-rate between samples is included so a fast climb alarms *before* it hits
the ceiling. All measurement is behind an injected `MetricSources` so tests drive
exact byte/row values with no filesystem.

```ts
export interface MetricSources {
  dbBytes(): number;          // main data-store bytes
  walBytes(): number;         // write-ahead-log bytes (0 if absent)
  rowCount(table: string): number;
}

export interface Threshold { warn: number; crit: number; }

export interface SelfMonitorConfig {
  dbBytes: Threshold;
  walBytes: Threshold;
  tableRows: Record<string, Threshold>; // per-table row ceilings
  now?: () => number;
}

export type AlarmSeverity = 'warn' | 'crit';

export interface Alarm {
  metric: string;
  severity: AlarmSeverity;
  value: number;
  threshold: number;
  ratePerSec?: number; // bytes/rows per second since the previous sample
}

export interface Sample {
  at: number;
  dbBytes: number;
  walBytes: number;
  rows: Record<string, number>;
  alarms: Alarm[];
}

/** Production sources for SQLite: size via pragma, WAL via fs.stat, rows via COUNT(*). */
export function createSqliteSources(db: Database, dbPath: string): MetricSources {
  const countStmts = new Map<string, Statement>();
  return {
    dbBytes() {
      const pageCount = db.pragma('page_count', { simple: true }) as number;
      const pageSize = db.pragma('page_size', { simple: true }) as number;
      return pageCount * pageSize; // NOT whole-disk free space — the DB's own bytes
    },
    walBytes() {
      try { return fs.statSync(`${dbPath}-wal`).size; } catch { return 0; }
    },
    rowCount(table) {
      let stmt = countStmts.get(table);
      if (!stmt) { stmt = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`); countStmts.set(table, stmt); }
      return (stmt.get() as { n: number }).n;
    },
  };
}

export class SelfMonitor {
  private readonly now: () => number;
  private prev: { at: number; dbBytes: number; walBytes: number } | null = null;

  constructor(
    private readonly sources: MetricSources,
    private readonly cfg: SelfMonitorConfig,
    private readonly log?: LogGovernor,
    /** Optional DURABLE sink (e.g. an append-only audit table) for crit alarms. */
    private readonly onAlarm?: (a: Alarm, sample: Sample) => void,
  ) {
    this.now = cfg.now ?? Date.now;
  }

  /** Take one measurement, evaluate thresholds, raise governed + durable alarms. */
  sample(): Sample {
    const at = this.now();
    const dbBytes = safe(() => this.sources.dbBytes(), 0);
    const walBytes = safe(() => this.sources.walBytes(), 0);
    const rows: Record<string, number> = {};
    for (const table of Object.keys(this.cfg.tableRows)) {
      rows[table] = safe(() => this.sources.rowCount(table), 0);
    }

    const dtSec = this.prev ? Math.max(1e-3, (at - this.prev.at) / 1000) : undefined;
    const dbRate = this.prev && dtSec ? (dbBytes - this.prev.dbBytes) / dtSec : undefined;
    const walRate = this.prev && dtSec ? (walBytes - this.prev.walBytes) / dtSec : undefined;

    const alarms: Alarm[] = [];
    pushAlarm(alarms, 'db_bytes', dbBytes, this.cfg.dbBytes, dbRate);
    pushAlarm(alarms, 'wal_bytes', walBytes, this.cfg.walBytes, walRate);
    for (const [table, th] of Object.entries(this.cfg.tableRows)) {
      pushAlarm(alarms, `rows:${table}`, rows[table], th);
    }

    const sample: Sample = { at, dbBytes, walBytes, rows, alarms };
    this.prev = { at, dbBytes, walBytes };

    for (const alarm of alarms) {
      // Governed: a sustained breach reports once/window, not every sample.
      this.log?.governed({
        key: `resource_threshold_crossed:${alarm.metric}:${alarm.severity}`,
        level: alarm.severity === 'crit' ? 'error' : 'warn',
        message: 'resource_threshold_crossed',
        meta: {
          metric: alarm.metric, severity: alarm.severity,
          value: alarm.value, threshold: alarm.threshold,
          ...(alarm.ratePerSec !== undefined ? { rate_per_sec: Math.round(alarm.ratePerSec) } : {}),
        },
        windowMs: 300_000,
      });
      // Crit alarms ALSO go to the durable sink — the log is ephemeral, the audit is not.
      if (alarm.severity === 'crit') safe(() => this.onAlarm?.(alarm, sample), undefined);
    }
    return sample;
  }
}

function pushAlarm(out: Alarm[], metric: string, value: number, th: Threshold, ratePerSec?: number): void {
  if (value >= th.crit) {
    out.push({ metric, severity: 'crit', value, threshold: th.crit, ...(ratePerSec !== undefined ? { ratePerSec } : {}) });
  } else if (value >= th.warn) {
    out.push({ metric, severity: 'warn', value, threshold: th.warn, ...(ratePerSec !== undefined ? { ratePerSec } : {}) });
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
```

---

## 3. Wiring: the background driver + failure-visibility handlers

The sampler is worthless if nobody calls `sample()`. Drive it on a timer, and
install the global failure handlers in the same bootstrap so a crash is never
silent.

```ts
// --- 3a. Global failure-visibility handlers (install ONCE, at process start) ---
// Without these, an unhandled rejection prints to stderr (maybe unrotated) and a
// throw in a microtask can take the process down with no durable record.
process.on('uncaughtException', (err) => {
  gov.error('uncaught_exception', { name: err.name, message: err.message, stack: err.stack });
  durableAudit({ kind: 'uncaught_exception', name: err.name, message: err.message });
  // Decide deliberately: crash-only (let a supervisor restart) vs. best-effort continue.
});
process.on('unhandledRejection', (reason) => {
  gov.error('unhandled_rejection', { reason: String(reason) });
  durableAudit({ kind: 'unhandled_rejection', reason: String(reason) });
});

// --- 3b. The background sampler (PUSH, not pull) ---
const monitor = new SelfMonitor(
  createSqliteSources(db, dbPath),
  {
    dbBytes:  { warn: 200 * MB, crit: 1 * GB },
    walBytes: { warn: 64 * MB,  crit: 256 * MB },
    tableRows: { activity_log: { warn: 500_000, crit: 5_000_000 } },
  },
  gov,
  durableAlarm,        // append-only audit sink for crit alarms
);

const timer = setInterval(() => monitor.sample(), 30_000);
timer.unref?.(); // don't keep the event loop alive just for monitoring

process.on('SIGTERM', () => { clearInterval(timer); gov.flushAll(); });
```

The `setInterval` is the whole point: the footprint is measured **whether or not
a human is looking**. A pull-only status endpoint that computes the same numbers
on request is not monitoring — it is a report that nobody reads until after the
incident.
