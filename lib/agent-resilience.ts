/**
 * Resilience for expensive-agent launches: it composes ON TOP OF the structured
 * `AgentError` retry contract already defined in `lib/event-envelope.ts` and
 * adds the three pieces that contract is missing for *expensive external
 * backends* (Codex/Claude/OpenAI/Gemini):
 *
 *   1. CLASSIFICATION preserves structural transport status before consulting
 *      descriptive text. Dispatch additionally requires a process-local host
 *      witness; a string classification alone cannot authorize a successor.
 *   2. FULL-JITTER backoff — `event-envelope.nextRetryDelayMs` is plain
 *      exponential (no jitter), which thundering-herds a recovering provider
 *      when many callers retry in lockstep. We add `random(0, base·2^attempt)`.
 *   3. A per-backend CIRCUIT BREAKER — absent entirely today. After N
 *      consecutive retryable failures a backend's breaker OPENs and we STOP
 *      launching against it until a cool-down, then one HALF_OPEN probe decides
 *      whether to resume. This is what stops a throttled/dead backend from
 *      draining budget one expensive 429 at a time.
 *
 * Reuses the canonical error type and codes — no parallel error hierarchy. The
 * decision to retry is always `isRetryable(AgentError)`, never a string match.
 * Transport-agnostic with platform-only dependencies: unit-testable, reusable
 * by the tube router, the fleet runner, and the daemon spawner.
 */

import {
  type AgentError,
  type AgentErrorCode,
  isRetryable,
  makeError,
} from './event-envelope.js';
import { createHash } from 'node:crypto';
import { setTimeout as sleepTimer } from 'node:timers/promises';

/** The circuit breaker for a backend is OPEN; the call was not attempted. */
export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN' as const;
  readonly backend: string;
  constructor(backend: string, readonly retryAtMs: number) {
    super(`Circuit unavailable: ${safeDiagnosticIdentifier(backend)}`);
    this.backend = safeDiagnosticIdentifier(backend);
    this.name = 'CircuitOpenError';
  }
}

// ── Classify a raw provider error string → AgentError ────────────────────────
//
// Some dependency callers only have free text. We map that to existing error
// codes after preserving concrete exception status facts. The regexes
// key on the structured tokens providers literally emit (HTTP codes, canonical
// phrases) — a closed, provider-defined vocabulary, not open-ended NLP.

interface Signal {
  re: RegExp;
  code: AgentErrorCode;
}

// Only an in-process host/transport witness may authorize dispatch retry or
// backend replacement. JSON, stderr, and model output cannot mint this identity.
const witnessedFailures = new WeakSet<object>();

/**
 * Preserve a locally observed terminal fact in the existing AgentError shape.
 * The motivation for object identity is that display text and deserialized tool
 * payloads must never impersonate a timer or OS error at the failover boundary.
 * @param fact A timer expiry or a code from the actual child error event.
 * @returns A frozen error carrying an in-process witness, without raw text.
 */
export function witnessedBackendFailure(fact: { kind: 'timeout' } | { kind: 'os'; code: string }): AgentError {
  const code = fact.kind === 'timeout' ? 'TIMEOUT'
    : fact.code === 'ENOENT' ? 'BACKEND_ABSENT'
      : ['EAGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(fact.code) ? 'UNAVAILABLE'
        : ['EACCES', 'EPERM'].includes(fact.code) ? 'UNAUTHORIZED' : 'INTERNAL';
  const error = Object.freeze(makeError({ code, message: `Backend failure: ${code}` }));
  witnessedFailures.add(error);
  return error;
}

/**
 * Check provenance before using a failure to launch a successor, by design.
 * @param value A potentially untrusted adapter result.
 * @returns Whether this process created the host witness, not just its shape.
 */
export function isWitnessedBackendFailure(value: unknown): value is AgentError {
  return typeof value === 'object' && value !== null && witnessedFailures.has(value);
}

/**
 * Read data properties without executing an untrusted getter, by design.
 * @param value Exception being inspected at the classification boundary.
 * @param key Name of the structural field, never a path expression.
 * @returns The own data value, or undefined when access cannot be proved safe.
 */
function ownData(value: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

/**
 * Keep diagnostic labels bounded by design without copying a private name.
 * Known runtime aliases stay readable; custom ids use an opaque correlation tag.
 * @param value Internal backend or dependency identifier, never error prose.
 * @param kind The closed diagnostic namespace.
 * @returns A bounded label; opaque tags are correlation, not encryption.
 */
export function safeDiagnosticIdentifier(value: unknown, kind: 'backend' | 'dependency' = 'backend'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return `${kind}:unspecified`;
  const known = new Set(['codex', 'claude', 'claude-code', 'gemini', 'agy', 'groq', 'groq-cli', 'openai', 'anthropic', 'embedder']);
  const name = value.startsWith('cli:') ? value.slice(4) : value;
  if (known.has(name)) return value;
  return `${kind}:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

/**
 * Keep exception-cause traversal bounded and cycle-safe by design.
 * @param value Raw failure; arbitrary JSON is not an Error instance.
 * @returns At most eight concrete exceptions, without running accessors.
 */
function errorChain(value: unknown): Error[] {
  const chain: Error[] = [];
  const seen = new Set<Error>();
  while (value instanceof Error && !seen.has(value) && chain.length < 8) {
    seen.add(value);
    chain.push(value);
    value = ownData(value, 'cause');
  }
  return chain;
}

/**
 * Classify a structured HTTP status without descriptive content, by design.
 * @param status Status data from a concrete transport exception.
 * @returns The existing error code, or undefined for an unsupported status.
 */
function statusCode(status: unknown): AgentErrorCode | undefined {
  if (typeof status !== 'number' || !Number.isInteger(status)) return undefined;
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status >= 400 && status < 500) return 'VALIDATION_ERROR';
  if (status >= 500 && status < 600) return 'UNAVAILABLE';
  return undefined;
}

const TRANSIENT_CODES = new Set(['RATE_LIMITED', 'TIMEOUT', 'UNAVAILABLE', 'CONFLICT']);

const SIGNALS: ReadonlyArray<Signal> = [
  // Transient → retryable codes
  { re: /\b429\b|rate.?limit|too many requests/i, code: 'RATE_LIMITED' },
  { re: /\busage limit\b/i, code: 'RATE_LIMITED' }, // codex/claude-cli quota windows reset
  { re: /\btimed?.?out\b|\btimeout\b|\bETIMEDOUT\b|\bEAI_AGAIN\b/i, code: 'TIMEOUT' },
  { re: /\b5(00|02|03|04)\b|service unavailable|temporarily unavailable|overloaded|\bECONNRESET\b|\bECONNREFUSED\b|socket hang ?up/i, code: 'UNAVAILABLE' },
  { re: /\b409\b|\bconflict\b/i, code: 'CONFLICT' },
  // Permanent → non-retryable codes
  { re: /\b400\b|\b422\b|invalid (api )?key|malformed|task is required|unknown backend/i, code: 'VALIDATION_ERROR' },
  { re: /\b401\b|\b403\b|\bunauthorized\b|\bforbidden\b/i, code: 'UNAUTHORIZED' },
  { re: /\b404\b|\bnot found\b/i, code: 'NOT_FOUND' },
];

/**
 * Parse a Retry-After hint (ms) out of a provider error string, if present.
 * Honours `Retry-After: 30`, `retry after 1500ms`, `retry-after 2 min`.
 */
export function parseRetryAfterMs(message: string): number | undefined {
  let minimum: number | undefined;
  for (const hint of message.matchAll(/\bretry[- ]after\b/gi)) {
    const m = /^\s*:?\s*([0-9]+)\s*(ms|seconds|sec|s|min|m)?(?=$|[\s;,])/i.exec(message.slice(hint.index + hint[0].length));
    if (!m) return undefined;
    const n = Number(m[1]);
    const unit = (m[2] ?? 's').toLowerCase();
    const delay = n * (unit === 'ms' ? 1 : unit.startsWith('m') ? 60_000 : 1000);
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(delay)) return undefined;
    minimum = Math.max(minimum ?? 0, delay);
  }
  return minimum;
}

/**
 * Classify a raw error (string or Error) from an expensive backend into a
 * structured `AgentError`. Unknown failures default to INTERNAL (non-retryable,
 * fail-closed) — we never retry a failure we cannot recognize as transient.
 */
export function classifyAgentError(
  err: unknown,
  opts: { backend?: string; maxRetries?: number } = {},
): AgentError {
  if (isWitnessedBackendFailure(err)) return err;
  const chain = errorChain(err);
  const messages = chain.length ? chain.map(error => ownData(error, 'message')) : [err];
  const message = messages.filter((value): value is string => typeof value === 'string').join('\n');
  const structuralFields = chain.flatMap(error => ['status', 'statusCode'].map(key => {
    try { return Object.getOwnPropertyDescriptor(error, key); } catch { return { get: true }; }
  }));
  const opaqueStatus = structuralFields.some(field => field && !('value' in field));
  const statuses = structuralFields.map(field => field && 'value' in field ? statusCode(field.value) : undefined).filter((code): code is AgentErrorCode => code !== undefined);
  // An explicit permanent status in the exception chain wins over a transient
  // wrapper. Plain object/tool JSON status fields have no transport provenance.
  const structured = statuses.find(code => !TRANSIENT_CODES.has(code)) ?? statuses[0];
  const hits = SIGNALS.filter(signal => signal.re.test(message));
  const hit = hits.find(signal => !TRANSIENT_CODES.has(signal.code)) ?? hits[0];
  const code: AgentErrorCode = opaqueStatus ? 'INTERNAL' : structured ?? hit?.code ?? 'INTERNAL';
  const retryAfterMs = parseRetryAfterMs(message);
  const invalidRetryHint = /\bretry[- ]after\b/i.test(message) && retryAfterMs === undefined;
  return makeError({
    code,
    message: `Backend failure: ${code}`,
    ...(invalidRetryHint ? { retryable: false } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    ...((opts.backend || invalidRetryHint) ? { details: {
      ...(opts.backend ? { backend: safeDiagnosticIdentifier(opts.backend) } : {}),
      ...(invalidRetryHint ? { reason: 'invalid_retry_after' } : {}),
    } } : {}),
  });
}

// ── Full-jitter exponential backoff ──────────────────────────────────────────

export interface BackoffConfig {
  baseMs: number;
  capMs: number;
  /** Injected for tests; defaults to Math.random. */
  random?: () => number;
}

/** Full-jitter backoff: random(0, min(cap, base * 2^attempt)). attempt is 0-indexed. */
export function fullJitterDelay(attempt: number, cfg: BackoffConfig): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0
    || !Number.isSafeInteger(cfg.baseMs) || cfg.baseMs < 0
    || !Number.isSafeInteger(cfg.capMs) || cfg.capMs < 0 || cfg.capMs > MAX_TIMER_MS) {
    throw new RangeError('Invalid bounded backoff configuration');
  }
  const rand = cfg.random ?? Math.random;
  // Zero times an overflowing exponent is NaN, not zero. Cap the exponent
  // before evaluating it; a positive base needs at most 31 doublings here.
  const exponential = cfg.baseMs === 0 || cfg.capMs === 0 ? 0
    : attempt >= Math.ceil(Math.log2(cfg.capMs / cfg.baseMs)) ? cfg.capMs
      : cfg.baseMs * Math.pow(2, attempt);
  const sample = rand();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new RangeError('Invalid jitter sample');
  return Math.floor(sample * exponential);
}

// ── Per-backend circuit breaker ──────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitConfig {
  /** Consecutive retryable failures before the breaker OPENs. */
  failureThreshold: number;
  /** Successes in HALF_OPEN before the breaker CLOSEs. */
  successThreshold: number;
  /** How long to stay OPEN before allowing one probe. */
  openTimeoutMs: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number | null;
  generation: number;
  probe: object | null;
  abandoned: Set<object>;
}

/** A single admitted operation; closures bind settlement to its exact generation. */
export interface CircuitLease {
  /** Settle exactly once, after the underlying operation has stopped. */
  settle(outcome: 'success' | 'failure' | 'neutral'): void;
  /** Invalidate an unfinished operation, retaining its probe slot until settlement. */
  abandon(): void;
}

const MAX_TIMER_MS = 2_147_483_647;

/**
 * One breaker per backend name. `before()` gates a launch (throws
 * CircuitOpenError when cooling or a probe is running). The returned lease
 * binds completion to one operation and generation. No string-only completion
 * API exists: old completions cannot repair a newer outage.
 */
export class BackendCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly now: () => number;
  constructor(private readonly cfg: CircuitConfig) {
    if (![cfg.failureThreshold, cfg.successThreshold].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isSafeInteger(cfg.openTimeoutMs) || cfg.openTimeoutMs < 0 || cfg.openTimeoutMs > MAX_TIMER_MS) {
      throw new RangeError('Invalid bounded circuit configuration');
    }
    this.now = cfg.now ?? Date.now;
  }

  private entry(backend: string): CircuitEntry {
    let e = this.entries.get(backend);
    if (!e) {
      e = { state: 'CLOSED', failures: 0, successes: 0, openedAt: null, generation: 0, probe: null, abandoned: new Set() };
      this.entries.set(backend, e);
    }
    return e;
  }

  state(backend: string): CircuitState {
    return this.entry(backend).state;
  }

  /**
   * Admit one operation; the motivation is atomic single-probe ownership.
   * @param backend Internal backend key, not diagnostic text.
   * @returns An idempotent lease that must settle when physical work ends.
   */
  before(backend: string): CircuitLease {
    const e = this.entry(backend);
    if (e.probe || e.abandoned.size) throw new CircuitOpenError(backend, this.now() + this.cfg.openTimeoutMs);
    if (e.state === 'OPEN') {
      const elapsed = this.now() - (e.openedAt ?? 0);
      if (elapsed < this.cfg.openTimeoutMs) {
        throw new CircuitOpenError(backend, (e.openedAt ?? this.now()) + this.cfg.openTimeoutMs);
      }
      e.state = 'HALF_OPEN';
      e.successes = 0;
    }
    const token = {};
    const generation = e.generation;
    if (e.state === 'HALF_OPEN') e.probe = token;
    let settled = false;
    let abandoned = false;
    /** Invalidate old completion authority by design. @returns Nothing. */
    const open = () => {
      e.state = 'OPEN';
      e.openedAt = this.now();
      e.generation += 1;
      e.successes = 0;
    };
    return Object.freeze({
      settle: (outcome: 'success' | 'failure' | 'neutral') => {
        if (settled) return;
        settled = true;
        e.abandoned.delete(token);
        if (e.probe === token) e.probe = null;
        if (abandoned || e.generation !== generation) return;
        if (outcome === 'failure') {
          e.failures += 1;
          if (e.state === 'HALF_OPEN' || e.failures >= this.cfg.failureThreshold) open();
        } else if (outcome === 'success') {
          e.failures = 0;
          if (e.state === 'HALF_OPEN' && ++e.successes >= this.cfg.successThreshold) {
            e.state = 'CLOSED';
            e.openedAt = null;
            e.generation += 1;
          }
        } else if (e.state === 'HALF_OPEN') {
          // A rejected task is not successful proof that the backend recovered.
          open();
        }
      },
      abandon: () => {
        if (settled || abandoned) return;
        abandoned = true;
        e.abandoned.add(token);
        if (e.generation === generation) open();
        // Keep e.probe until physical completion; abort is only a request.
      },
    });
  }
}

// ── The resilient runner ─────────────────────────────────────────────────────

export interface ResilientSpawnConfig {
  maxAttempts: number;
  backoff: BackoffConfig;
  breaker: BackendCircuitBreaker;
  /** Total operation + retry budget. Default 60 seconds, never per-attempt. */
  totalTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  /** Dependency availability is distinct from whether a call is retryable. */
  circuitFailurePolicy?: 'retryable-only' | 'any-failure';
  /** Sleep impl; injected for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Structured observer for each attempt/outcome (logging/telemetry hook). */
  onEvent?: (e: ResilienceEvent) => void;
}

export type ResilienceEvent =
  | { kind: 'attempt'; backend: string; attempt: number }
  | { kind: 'success'; backend: string; attempt: number }
  | { kind: 'retry'; backend: string; attempt: number; delayMs: number; error: AgentError }
  | { kind: 'permanent'; backend: string; attempt: number; error: AgentError }
  | { kind: 'circuit-open'; backend: string; retryAtMs: number }
  | { kind: 'exhausted'; backend: string; attempts: number; error: AgentError };

const defaultSleep = (ms: number, signal: AbortSignal) => sleepTimer(ms, undefined, { signal });

/**
 * Run an expensive launch with classification + full-jitter backoff + circuit
 * breaking. `fn` throws on failure (string or Error). Returns the value on
 * success; throws CircuitOpenError when the breaker is OPEN, or the structured
 * `AgentError` on terminal failure. Retry is decided structurally
 * (`isRetryable`), never by reading a message string at the call site.
 */
export async function runResilientSpawn<T>(
  backend: string,
  fn: (signal: AbortSignal) => Promise<T>,
  cfg: ResilientSpawnConfig,
): Promise<T> {
  const totalTimeoutMs = cfg.totalTimeoutMs ?? 60_000;
  if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs <= 0 || totalTimeoutMs > MAX_TIMER_MS
    || !Number.isSafeInteger(cfg.maxAttempts) || cfg.maxAttempts < 1) {
    throw new RangeError('Invalid bounded retry configuration');
  }
  const now = cfg.now ?? Date.now;
  const deadline = now() + totalTimeoutMs;
  const sleep = cfg.sleep ?? defaultSleep;
  const label = safeDiagnosticIdentifier(backend);
  const emit = (e: ResilienceEvent) => { try { cfg.onEvent?.(e); } catch { /* diagnostics cannot change execution */ } };
  const controller = new AbortController();
  let boundaryError: AgentError | null = null;
  /**
   * Preserve the first terminal boundary, never the caller's private reason.
   * This design makes timeout and cancellation stable across racing callbacks.
   * @param code Closed terminal reason.
   * @returns Nothing; wakes bounded waits through the local signal.
   */
  const stop = (code: 'CANCELLED' | 'TIMEOUT') => {
    boundaryError ??= makeError({ code, message: `Backend failure: ${code}`, retryable: false, details: { reason: code === 'TIMEOUT' ? 'total_deadline' : 'cancelled' } });
    controller.abort();
  };
  /** Forward cancellation without its payload by design. @returns Nothing. */
  const onAbort = () => stop('CANCELLED');
  cfg.signal?.addEventListener('abort', onAbort, { once: true });
  if (cfg.signal?.aborted) onAbort();
  const timer = setTimeout(() => stop('TIMEOUT'), totalTimeoutMs);
  /** Enforce elapsed injected time as well as timers by design. @returns Nothing. */
  const checkBoundary = () => {
    if (now() >= deadline) stop('TIMEOUT');
    if (boundaryError) throw boundaryError;
  };
  /**
   * Race a physical operation with the shared terminal boundary by design.
   * @param work Already observed work whose late outcome cannot mutate a lease.
   * @returns Its value while within budget, or the closed terminal error.
   */
  const bounded = async <V>(work: Promise<V>): Promise<V> => {
    /** Keep listener identity stable for cleanup by design. @returns Nothing. */
    let rejectBoundary: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { rejectBoundary = () => reject(boundaryError); });
    controller.signal.addEventListener('abort', rejectBoundary, { once: true });
    if (controller.signal.aborted) rejectBoundary();
    try {
      const result = await Promise.race([work, interrupted]);
      checkBoundary();
      return result;
    } catch (error) {
      checkBoundary();
      throw error;
    } finally {
      controller.signal.removeEventListener('abort', rejectBoundary);
    }
  };
  let lastErr: AgentError | null = null;
  try {
    for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
      checkBoundary();
      let lease: CircuitLease;
      try {
        lease = cfg.breaker.before(backend);
      } catch (e) {
        if (e instanceof CircuitOpenError) emit({ kind: 'circuit-open', backend: label, retryAtMs: e.retryAtMs });
        throw e;
      }
      emit({ kind: 'attempt', backend: label, attempt });
      const operation = Promise.resolve().then(() => { checkBoundary(); return fn(controller.signal); });
      try {
        const value = await bounded(operation);
        lease.settle('success');
        emit({ kind: 'success', backend: label, attempt });
        return value;
      } catch (raw) {
        if (boundaryError) {
          lease.abandon();
          void operation.then(() => lease.settle('neutral'), () => lease.settle('neutral'));
          emit({ kind: 'permanent', backend: label, attempt, error: boundaryError });
          throw boundaryError;
        }
        const error = classifyAgentError(raw, { backend });
        lastErr = error;
        lease.settle(isRetryable(error) || cfg.circuitFailurePolicy === 'any-failure' ? 'failure' : 'neutral');
        if (!isRetryable(error)) {
          emit({ kind: 'permanent', backend: label, attempt, error });
          throw error; // structural decision — never retry a non-retryable failure
        }
        const isLast = attempt === cfg.maxAttempts - 1;
        if (isLast) break;
        // Honour an upstream Retry-After; else full-jitter backoff.
        const delayMs = error.retryAfterMs ?? fullJitterDelay(attempt, cfg.backoff);
        if (delayMs >= deadline - now()) {
          const deferred = makeError({ ...error, retryable: false, details: { reason: 'retry_after_exceeds_deadline' } });
          emit({ kind: 'permanent', backend: label, attempt, error: deferred });
          throw deferred;
        }
        emit({ kind: 'retry', backend: label, attempt, delayMs, error });
        try {
          await bounded(Promise.resolve().then(() => { checkBoundary(); return sleep(delayMs, controller.signal); }));
        } catch {
          const stopped = boundaryError ?? makeError({ code: 'INTERNAL', message: 'Backoff failed', retryable: false });
          emit({ kind: 'permanent', backend: label, attempt, error: stopped });
          throw stopped;
        }
      }
    }

    const exhausted = lastErr ?? makeError({ code: 'INTERNAL', message: 'spawn exhausted retries', retryable: false });
    emit({ kind: 'exhausted', backend: label, attempts: cfg.maxAttempts, error: exhausted });
    throw exhausted;
  } finally {
    clearTimeout(timer);
    cfg.signal?.removeEventListener('abort', onAbort);
  }
}
