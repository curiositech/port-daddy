/**
 * Gated Loader — the fix for "a load-once dependency failed permanently, so every tick re-awaits
 * a cached rejected promise and re-logs the full error." That is the exact shape of the
 * `semantic-resolver.getEmbedder()` runaway: `embedderPromise` is memoized on first use and NEVER
 * reset on failure, so a missing ONNX dylib becomes a permanently-rejected promise that each of
 * 7,182 fleet-agent ticks awaits, logs, and writes a DB row for.
 *
 * A gated loader composes the CircuitBreaker + full-jitter backoff already in
 * `lib/agent-resilience.ts` (which was dead code) around a lazily-loaded resource:
 *
 *   - On success the value is memoized and returned forever (the happy path is unchanged).
 *   - On failure the value is NOT cached as a poison pill. The breaker records the failure; while
 *     it is OPEN, `tryGet()` returns null IMMEDIATELY without re-attempting the load and without
 *     logging — the caller simply skips its optional work. One governed line reports the outage.
 *   - After the cool-down, a single HALF_OPEN probe re-attempts the load, so a genuinely transient
 *     failure (cache warm-up, races) still recovers.
 *
 * `tryGet()` is for OPTIONAL enrichment (semantic resolution, embeddings) — work you skip when the
 * dependency is down. `get()` is for REQUIRED dependencies — it throws `CircuitOpenError` when open.
 */

import {
  BackendCircuitBreaker,
  CircuitOpenError,
  classifyAgentError,
  runResilientSpawn,
  safeDiagnosticIdentifier,
  type BackoffConfig,
} from '../agent-resilience.js';
import type { LogGovernor } from './log-governor.js';

export interface GatedLoaderConfig {
  /** Name for logs + the breaker key. */
  name: string;
  /** Consecutive failures before the breaker OPENs. Default 3. */
  failureThreshold?: number;
  /** Cool-down before a HALF_OPEN probe is allowed. Default 60_000 ms. */
  openTimeoutMs?: number;
  /** Backoff between in-call retries of the load. Default base 500 / cap 30_000. */
  backoff?: BackoffConfig;
  /** Max load attempts within a single get() before giving up. Default 1 (rely on the breaker). */
  maxAttempts?: number;
  totalTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface GatedLoader<T> {
  /** Resolve the value, throwing CircuitOpenError while the breaker is open. */
  get(): Promise<T>;
  /** Resolve the value, or null when the dependency is down (breaker open or load failed). */
  tryGet(): Promise<T | null>;
  /** Current breaker state, for the self-monitor / dashboards. */
  state(): 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export function createGatedLoader<T>(
  load: (signal: AbortSignal) => Promise<T>,
  cfg: GatedLoaderConfig,
  log?: LogGovernor,
): GatedLoader<T> {
  const now = cfg.now ?? Date.now;
  const backoff = cfg.backoff ?? { baseMs: 500, capMs: 30_000 };
  const maxAttempts = cfg.maxAttempts ?? 1;
  const label = safeDiagnosticIdentifier(cfg.name, 'dependency');
  const breaker = new BackendCircuitBreaker({
    failureThreshold: cfg.failureThreshold ?? 3,
    successThreshold: 1,
    openTimeoutMs: cfg.openTimeoutMs ?? 60_000,
    now,
  });

  let value: T | undefined;
  let loaded = false;
  // Coalesce concurrent callers onto one in-flight load so a burst can't stampede the resource.
  let inFlight: Promise<T> | null = null;

  async function attemptLoad(): Promise<T> {
    const v = await runResilientSpawn(cfg.name, load, {
      breaker, maxAttempts, backoff, now, sleep: cfg.sleep,
      totalTimeoutMs: cfg.totalTimeoutMs,
      // A dependency that cannot load needs cooldown even when this particular
      // error must not be retried. This does not authorize retrying auth errors.
      circuitFailurePolicy: 'any-failure',
      onEvent: event => {
        if (event.kind !== 'permanent' && event.kind !== 'retry' && event.kind !== 'exhausted') return;
        log?.governed({
          key: `dependency_load_failed:${label}`,
          level: 'error',
          message: 'dependency_load_failed',
          meta: { dependency: label, code: event.error.code, retryable: event.error.retryable },
        });
      },
    }).catch((failure: unknown) => {
      if (failure instanceof CircuitOpenError) throw failure;
      // Required dependency callers use the Error-instance contract. Preserve
      // only closed classified fields, never the original exception or cause.
      const error = classifyAgentError(failure);
      throw Object.assign(new Error(error.message), error);
    });
    value = v;
    loaded = true;
    return v;
  }

  async function get(): Promise<T> {
    if (loaded) return value as T;
    if (inFlight) return inFlight;
    inFlight = attemptLoad().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function tryGet(): Promise<T | null> {
    try {
      return await get();
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        // Breaker open: skip silently (already reported when it opened). This is the anti-spam path.
        log?.governed({
          key: `dependency_unavailable:${label}`,
          level: 'warn',
          message: 'dependency_unavailable',
          meta: { dependency: label, state: breaker.state(cfg.name) },
          windowMs: 300_000,
        });
        return null;
      }
      return null; // load failed; attemptLoad already governed-logged the cause
    }
  }

  return { get, tryGet, state: () => breaker.state(cfg.name) };
}
