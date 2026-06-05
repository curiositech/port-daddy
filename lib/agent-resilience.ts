/**
 * Resilience for expensive-agent launches: it composes ON TOP OF the structured
 * `AgentError` retry contract already defined in `lib/event-envelope.ts` and
 * adds the three pieces that contract is missing for *expensive external
 * backends* (Codex/Claude/OpenAI/Gemini):
 *
 *   1. CLASSIFICATION from a raw provider error STRING into an `AgentError` with
 *      the right closed code — so a spawner that only has free text can still
 *      feed the structural retry contract (which forbids prose-reading at the
 *      decision point).
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
 * Transport-agnostic and dependency-free: exhaustively unit-testable, reusable
 * by the tube router, the fleet runner, and the daemon spawner.
 */

import {
  type AgentError,
  type AgentErrorCode,
  isRetryable,
  makeError,
} from './event-envelope.js';

/** The circuit breaker for a backend is OPEN; the call was not attempted. */
export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN' as const;
  constructor(readonly backend: string, readonly retryAtMs: number) {
    super(`circuit OPEN for backend '${backend}'; retry after ${new Date(retryAtMs).toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

// ── Classify a raw provider error string → AgentError ────────────────────────
//
// Providers hand us free text. We map it to the closed AGENT_ERROR_CODES enum so
// the retry decision downstream is purely structural (`isRetryable`). The regexes
// key on the structured tokens providers literally emit (HTTP codes, canonical
// phrases) — a closed, provider-defined vocabulary, not open-ended NLP.

interface Signal {
  re: RegExp;
  code: AgentErrorCode;
}

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
  const m = /retry.?after[^0-9]*([0-9]+)\s*(ms|s|sec|seconds|m|min)?/i.exec(message);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? 's').toLowerCase();
  if (unit === 'ms') return n;
  if (unit.startsWith('m') && unit !== 'ms') return n * 60_000;
  return n * 1000;
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
  const message = err instanceof Error ? err.message : String(err);
  const hit = SIGNALS.find((s) => s.re.test(message));
  const code: AgentErrorCode = hit?.code ?? 'INTERNAL';
  const retryAfterMs = parseRetryAfterMs(message);
  return makeError({
    code,
    message,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    ...(opts.backend ? { details: { backend: opts.backend } } : {}),
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
  const rand = cfg.random ?? Math.random;
  const exponential = Math.min(cfg.capMs, cfg.baseMs * Math.pow(2, attempt));
  return Math.floor(rand() * exponential);
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
}

/**
 * One breaker per backend name. `before()` gates a launch (throws
 * CircuitOpenError when OPEN and still cooling). `onSuccess`/`onRetryableFailure`
 * drive the state machine. NON-retryable failures do NOT trip the breaker — a
 * malformed task must not take a healthy backend offline.
 */
export class BackendCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly now: () => number;
  constructor(private readonly cfg: CircuitConfig) {
    this.now = cfg.now ?? Date.now;
  }

  private entry(backend: string): CircuitEntry {
    let e = this.entries.get(backend);
    if (!e) {
      e = { state: 'CLOSED', failures: 0, successes: 0, openedAt: null };
      this.entries.set(backend, e);
    }
    return e;
  }

  state(backend: string): CircuitState {
    return this.entry(backend).state;
  }

  /** Throws CircuitOpenError if the backend is OPEN and still cooling down. */
  before(backend: string): void {
    const e = this.entry(backend);
    if (e.state === 'OPEN') {
      const elapsed = this.now() - (e.openedAt ?? 0);
      if (elapsed < this.cfg.openTimeoutMs) {
        throw new CircuitOpenError(backend, (e.openedAt ?? this.now()) + this.cfg.openTimeoutMs);
      }
      e.state = 'HALF_OPEN';
      e.successes = 0;
    }
  }

  onSuccess(backend: string): void {
    const e = this.entry(backend);
    e.failures = 0;
    if (e.state === 'HALF_OPEN') {
      e.successes += 1;
      if (e.successes >= this.cfg.successThreshold) {
        e.state = 'CLOSED';
        e.openedAt = null;
      }
    }
  }

  /** A retryable failure: counts toward opening (or re-opens a HALF_OPEN probe). */
  onRetryableFailure(backend: string): void {
    const e = this.entry(backend);
    if (e.state === 'HALF_OPEN') {
      e.state = 'OPEN';
      e.openedAt = this.now();
      return;
    }
    e.failures += 1;
    if (e.failures >= this.cfg.failureThreshold) {
      e.state = 'OPEN';
      e.openedAt = this.now();
    }
  }
}

// ── The resilient runner ─────────────────────────────────────────────────────

export interface ResilientSpawnConfig {
  maxAttempts: number;
  backoff: BackoffConfig;
  breaker: BackendCircuitBreaker;
  /** Sleep impl; injected for tests. */
  sleep?: (ms: number) => Promise<void>;
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

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run an expensive launch with classification + full-jitter backoff + circuit
 * breaking. `fn` throws on failure (string or Error). Returns the value on
 * success; throws CircuitOpenError when the breaker is OPEN, or the structured
 * `AgentError` on terminal failure. Retry is decided structurally
 * (`isRetryable`), never by reading a message string at the call site.
 */
export async function runResilientSpawn<T>(
  backend: string,
  fn: () => Promise<T>,
  cfg: ResilientSpawnConfig,
): Promise<T> {
  const sleep = cfg.sleep ?? defaultSleep;
  const emit = (e: ResilienceEvent) => cfg.onEvent?.(e);
  let lastErr: AgentError | null = null;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      cfg.breaker.before(backend);
    } catch (e) {
      if (e instanceof CircuitOpenError) emit({ kind: 'circuit-open', backend, retryAtMs: e.retryAtMs });
      throw e;
    }

    emit({ kind: 'attempt', backend, attempt });
    try {
      const value = await fn();
      cfg.breaker.onSuccess(backend);
      emit({ kind: 'success', backend, attempt });
      return value;
    } catch (raw) {
      const error = classifyAgentError(raw, { backend });
      lastErr = error;
      if (!isRetryable(error)) {
        emit({ kind: 'permanent', backend, attempt, error });
        throw error; // structural decision — never retry a non-retryable failure
      }
      cfg.breaker.onRetryableFailure(backend);
      const isLast = attempt === cfg.maxAttempts - 1;
      if (isLast) break;
      // Honour an upstream Retry-After; else full-jitter backoff.
      const delayMs = error.retryAfterMs ?? fullJitterDelay(attempt, cfg.backoff);
      emit({ kind: 'retry', backend, attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  const exhausted = lastErr ?? makeError({ code: 'INTERNAL', message: 'spawn exhausted retries', retryable: false });
  emit({ kind: 'exhausted', backend, attempts: cfg.maxAttempts, error: exhausted });
  throw exhausted;
}
