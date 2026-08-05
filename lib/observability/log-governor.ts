/**
 * Log Governor — the missing primitive that turns "error-level logging inside an
 * unthrottled retry/poll loop" from a disk-eating runaway into a bounded, honest
 * signal.
 *
 * Why this exists:
 *   Port Daddy has had the SAME incident at least twice — `daemon_heartbeat_write_failed`
 *   (post-mortem: docs/recovery/2026-05-31-gardener-triage) and `semantic_resolution_failed`
 *   (the 313 GB dev-latest-daemon write storm). In both, a persistently-failing operation
 *   sits inside a loop that fires every few seconds, and each failure logs a full error
 *   object. No backoff, no dedup: 7,000+ identical lines, an unrotated 255 MB stdout capture,
 *   and a 231 MB DB. The fix was patched narrowly each time and the CLASS was never closed.
 *
 *   The class is closed by making "log this, but never let it spam" a first-class call.
 *
 * What it does:
 *   - DEDUP + RATE-LIMIT per key: the first `burst` occurrences of a key in each `windowMs`
 *     window emit normally; the rest are counted and dropped. When the window rolls over,
 *     a single ROLLUP line reports how many were suppressed ("...and 4,312 more in 60s").
 *     You never lose the fact that it kept happening — you lose only the redundant bytes.
 *   - SAMPLING: for high-volume, non-error streams (request logs), emit 1-in-N and report
 *     the true total in the rollup, so sampled logs never silently under-count.
 *   - BOUNDED MEMORY: the governor tracks at most `maxKeys` keys (LRU). A bug that generates
 *     unbounded distinct keys evicts the oldest (flushing its rollup) instead of leaking.
 *
 * Design rules (match the repo):
 *   - Pure and dependency-free. `now()` and `random()` are injectable → exhaustively testable.
 *   - Wraps ANY leveled sink shaped like winston (`(message, meta) => void`), so it composes
 *     with the existing `server.ts` winston logger rather than replacing it.
 *   - A dropped log must never throw. Observability must not be able to crash the daemon.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A leveled sink shaped like a winston logger. */
export interface LeveledSink {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface GovernorConfig {
  /** Window over which burst + suppression accounting resets. Default 60_000 ms. */
  windowMs: number;
  /** How many occurrences of a key emit per window before suppression kicks in. Default 3. */
  burst: number;
  /** Max distinct keys tracked before LRU eviction. Default 2_000. */
  maxKeys: number;
  /** Injected clock; defaults to Date.now. */
  now?: () => number;
}

const DEFAULTS: Omit<Required<GovernorConfig>, 'now'> = {
  windowMs: 60_000,
  burst: 3,
  maxKeys: 2_000,
};

export interface GovernedLog {
  /**
   * Stable dedup key. MUST NOT embed unbounded/high-cardinality values (ids, timestamps,
   * raw error strings) or the governor can't collapse the spam. Use the STABLE shape of the
   * event: e.g. `semantic_resolution_failed` — never `semantic_resolution_failed:<term>`.
   */
  key: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  /** Emit 1-in-N of this key (after dedup). Default 1 (no sampling). Use for chatty info logs. */
  sampleEveryN?: number;
  /** Override the window for this key (e.g. a slow, expensive alarm). */
  windowMs?: number;
  /** Override the burst for this key. */
  burst?: number;
}

interface KeyState {
  windowStart: number;
  /** Real emissions in the current window. */
  emitted: number;
  /** Dropped occurrences in the current window (dedup + sampling). */
  suppressed: number;
  /** Total occurrences seen in the current window (for honest sampling rollups). */
  seen: number;
  level: LogLevel;
  message: string;
}

/**
 * Governs a leveled sink. Call `governed()` from any hot/looping path; call the passthrough
 * `debug/info/warn/error` for one-shot logs that never loop.
 */
export class LogGovernor {
  private readonly cfg: Omit<Required<GovernorConfig>, 'now'>;
  private readonly now: () => number;
  /** Insertion-ordered map used as an LRU (delete+set moves a key to the newest slot). */
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly sink: LeveledSink, cfg: Partial<GovernorConfig> = {}) {
    this.cfg = {
      windowMs: cfg.windowMs ?? DEFAULTS.windowMs,
      burst: cfg.burst ?? DEFAULTS.burst,
      maxKeys: cfg.maxKeys ?? DEFAULTS.maxKeys,
    };
    this.now = cfg.now ?? Date.now;
  }

  /** Passthrough helpers for genuinely one-shot events (startup, shutdown, config load). */
  debug(message: string, meta?: Record<string, unknown>): void { this.safeEmit('debug', message, meta); }
  info(message: string, meta?: Record<string, unknown>): void { this.safeEmit('info', message, meta); }
  warn(message: string, meta?: Record<string, unknown>): void { this.safeEmit('warn', message, meta); }
  error(message: string, meta?: Record<string, unknown>): void { this.safeEmit('error', message, meta); }

  /**
   * Log an event that may fire in a loop. Returns true if the line was actually emitted,
   * false if it was suppressed (useful for tests and for gating expensive meta construction).
   */
  governed(entry: GovernedLog): boolean {
    const now = this.now();
    const windowMs = entry.windowMs ?? this.cfg.windowMs;
    const burst = entry.burst ?? this.cfg.burst;
    const st = this.touch(entry.key, now, entry.level, entry.message);

    // Roll the window forward, flushing a suppression rollup for the window that just closed.
    if (now - st.windowStart >= windowMs) {
      this.flushRollup(entry.key, st, now - st.windowStart);
      st.windowStart = now;
      st.emitted = 0;
      st.suppressed = 0;
      st.seen = 0;
    }

    st.seen += 1;
    st.level = entry.level;
    st.message = entry.message;

    // Sampling gate (after dedup accounting) — drop all but every Nth occurrence.
    const sampleEveryN = entry.sampleEveryN && entry.sampleEveryN > 1 ? Math.floor(entry.sampleEveryN) : 1;
    if (sampleEveryN > 1 && st.seen % sampleEveryN !== 0) {
      st.suppressed += 1;
      return false;
    }

    if (st.emitted < burst) {
      st.emitted += 1;
      this.safeEmit(entry.level, entry.message, entry.meta);
      return true;
    }

    st.suppressed += 1;
    return false;
  }

  /** Flush every pending rollup — call on shutdown so suppressed tails aren't lost. */
  flushAll(): void {
    const now = this.now();
    for (const [key, st] of this.keys) {
      this.flushRollup(key, st, now - st.windowStart);
      st.suppressed = 0;
      st.seen = 0;
      st.emitted = 0;
      st.windowStart = now;
    }
  }

  /** Snapshot for the self-monitor / dashboards: which keys are currently being suppressed. */
  snapshot(): Array<{ key: string; suppressed: number; seen: number }> {
    return [...this.keys.entries()].map(([key, st]) => ({ key, suppressed: st.suppressed, seen: st.seen }));
  }

  private touch(key: string, now: number, level: LogLevel, message: string): KeyState {
    const existing = this.keys.get(key);
    if (existing) {
      // LRU: re-insert to move to newest slot.
      this.keys.delete(key);
      this.keys.set(key, existing);
      return existing;
    }
    // Evict oldest if at capacity, flushing its rollup so we never silently drop a tail.
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
    // Report the rollup at the same level as the event it summarizes.
    this.safeEmit(st.level, st.message, {
      log_rollup: true,
      key,
      suppressed: st.suppressed,
      seen: st.seen,
      window_ms: Math.max(0, Math.round(elapsedMs)),
    });
  }

  /** Emitting a log must never throw — a broken sink cannot be allowed to crash the daemon. */
  private safeEmit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    try {
      this.sink[level](message, meta);
    } catch {
      /* observability must not be load-bearing for liveness */
    }
  }
}
