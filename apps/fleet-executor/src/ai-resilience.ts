/**
 * Bounded resilience at the Workers AI dependency boundary.
 *
 * There is deliberately ONE retry layer: the Cloudflare Queue delivery. A
 * failed `AI.run()` opens this run's circuit, stops queued MAP work, and throws
 * a typed error to the consumer, which redelivers with full jitter. Retrying
 * inside every MAP call as well would multiply provider load by chunk fan-out
 * and queue attempts exactly when Workers AI is already out of capacity.
 */

import { DEFAULT_AI_CALL_DEADLINE_MS } from '../../shared/repo-ai-settings.js';

/** Queue deliveries allowed to probe a retryable Workers AI failure. */
export const PROVIDER_MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Default hard wall-clock budget for one Workers AI binding call, used only
 * when a repository has not configured its own deadline. Re-exported from
 * `apps/shared/repo-ai-settings.ts` (rather than a second `300_000` literal
 * "kept in sync by comment") so there is exactly one place this number is
 * declared — a duplicated constant with a synchronization comment is not
 * drift prevention (pd-qa adversarial finding, PR #9800).
 *
 * Workers AI's binding does not document an AbortSignal option. Racing the
 * binding promise is therefore the local fail-fast boundary: Fleet stops
 * awaiting that call, opens the circuit, and lets the queue invocation end.
 * The next delivery becomes the half-open probe. This bounds Fleet control
 * flow without pretending the underlying provider operation was cancelled.
 *
 * Raised from 60s to 5 minutes (2026-08-23): 60s was an arbitrary defensive
 * value, not derived from any Workers AI-side limit, and it was tripping on
 * ordinary latency for larger prompts. Operators can now configure this
 * per-repository; this is just the floor when they haven't. See
 * {@link RUN_ABSOLUTE_DEADLINE_MS} for the compensating run-level bound this
 * raise required.
 */
export const FLEET_AI_CALL_DEADLINE_MS = DEFAULT_AI_CALL_DEADLINE_MS;

/**
 * Hard ceiling on how long ONE LOGICAL RUN (a PR review, spanning every
 * Cloudflare Queue continuation and retry it takes) may run before Fleet
 * gives up and completes the check neutral rather than continuing to spend.
 *
 * Design rationale: raising {@link FLEET_AI_CALL_DEADLINE_MS} to 5 minutes
 * (configurable up to 10) without a compensating run-level bound turns a
 * roster of ships into an unbounded retry storm — each ship's own AI calls
 * can be retried across up to `PROVIDER_MAX_DELIVERY_ATTEMPTS` (3) queue
 * deliveries, so a ~9-ship roster's worst case is roughly
 * `9 ships × 3 attempts × 5–10 minutes` = 135–270 minutes with no ceiling at
 * all. This is the DO-NOT-SHIP finding from the human adversarial review on
 * PR #9800: a per-call deadline bounds one call; nothing bounded the run.
 *
 * 45 minutes is chosen to comfortably fit a legitimate large roster running
 * slowly-but-successfully (the common case this deadline should never touch)
 * while firmly ruling out the multi-hour pathological case. It is a flat,
 * non-configurable constant on purpose: making it a per-repo setting would
 * reopen the same cross-user-authority problem the deadline setting itself
 * was flagged for (see `apps/shared/repo-ai-settings.ts`'s admin-authorization
 * requirement) for a knob whose only honest value is "as small as the fleet's
 * genuine worst-case legitimate runtime requires."
 */
export const RUN_ABSOLUTE_DEADLINE_MS = 45 * 60_000;

/** Full-jitter queue backoff: 15s, 30s, 60s ceilings, capped at two minutes. */
const PROVIDER_RETRY_BASE_SECONDS = 15;
const PROVIDER_RETRY_CAP_SECONDS = 120;
const CLOUDFLARE_QUEUE_DELAY_CAP_SECONDS = 43_200;

/** Operator-safe description of one Workers AI exception. */
export interface AiFailureDetail {
  name: string;
  message: string;
  summary: string;
  status: number | null;
  code: number | null;
  retryAfterSeconds: number | null;
  retryable: boolean;
  /**
   * Wall-clock time the failed call actually ran before failing, in
   * milliseconds. Distinct from the deadline itself (a timeout's
   * `elapsedMs` is ~the deadline; a provider-rejected call's `elapsedMs` is
   * however long the round trip took before Cloudflare replied) — this is
   * the field that answers "how long did an agent take" for one AI call,
   * which no fleet-facing surface showed before this existed.
   */
  elapsedMs: number;
}

/** Per-ship accumulator for one queue delivery's Workers AI calls. */
export interface ShipAiCallStats {
  ship: string;
  calls: number;
  okCalls: number;
  timeoutCalls: number;
  errorCalls: number;
  totalElapsedMs: number;
  maxElapsedMs: number;
}

function emptyShipAiCallStats(ship: string): ShipAiCallStats {
  return { ship, calls: 0, okCalls: 0, timeoutCalls: 0, errorCalls: 0, totalElapsedMs: 0, maxElapsedMs: 0 };
}

const RETRYABLE_AI_CODES = new Set([3007, 3008, 3040]);
const PERMANENT_AI_CODES = new Set([
  3003, 3006, 3036, 3039, 3041, 3042, 5004, 5005, 5007, 5016, 5018, 5019, 5035,
]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ERROR_CHARS = 600;

/**
 * Error raised by the AI boundary. Retryable instances open the run circuit;
 * permanent instances remain ordinary broken-ship verdicts.
 */
export class FleetAiDependencyError extends Error {
  readonly failure: AiFailureDetail;

  constructor(failure: AiFailureDetail) {
    super(failure.summary);
    this.name = 'FleetAiDependencyError';
    this.failure = failure;
  }
}

/** Provider-shaped timeout so the existing classifier and queue retry apply. */
class FleetAiCallDeadlineError extends Error {
  readonly status = 408;
  readonly code = 3007;

  constructor(readonly deadlineMs: number) {
    super(`Workers AI call exceeded its ${deadlineMs}ms deadline`);
    this.name = 'FleetAiCallDeadlineError';
  }
}

/**
 * Per-run circuit. It never escapes into isolate-global state: a fresh queue
 * delivery is the half-open probe, so one PR cannot poison later Fleet runs.
 */
export class FleetAiCircuit {
  private openedBy: FleetAiDependencyError | null = null;
  /** Per-ship call aggregates for this run, flushed once per ship at run end. */
  private readonly shipStats = new Map<string, ShipAiCallStats>();

  constructor(private readonly deadlineMs = FLEET_AI_CALL_DEADLINE_MS) {
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
      throw new RangeError('Fleet AI call deadline must be a positive finite number');
    }
  }

  get isOpen(): boolean {
    return this.openedBy !== null;
  }

  get failure(): AiFailureDetail | null {
    return this.openedBy?.failure ?? null;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.openedBy) throw this.openedBy;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new FleetAiCallDeadlineError(this.deadlineMs)),
          this.deadlineMs,
        );
      });
      return await Promise.race([call(), timedOut]);
    } catch (error) {
      const wrapped = new FleetAiDependencyError(describeAiFailure(error, Date.now() - startedAt));
      if (wrapped.failure.retryable) this.openedBy = wrapped;
      throw wrapped;
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
  }

  /**
   * Same call contract as {@link run}, plus in-memory aggregation keyed by
   * `ship` — the "aggregate per ship logging" the deadline setting shipped
   * alongside. One call site's outcome (ok / timeout / other error) and its
   * elapsed time fold into that ship's running totals; nothing is written to
   * D1 here (`snapshotShipStats` + a caller-owned flush do that once per ship,
   * not once per call — see `recordShipAiCallStats` in execute.ts).
   *
   * Design rationale for the split: the MAP phase can invoke this once per
   * diff chunk per ship, so a per-call D1 write would multiply write volume
   * by chunk fan-out.
   *
   * @param ship - The ship name this call belongs to, for aggregation.
   * @param call - The Workers AI call to race against the deadline.
   * @returns Whatever {@link run} resolves to; rejects the same way.
   */
  async runForShip<T>(ship: string, call: () => Promise<T>): Promise<T> {
    const stats = this.shipStats.get(ship) ?? emptyShipAiCallStats(ship);
    this.shipStats.set(ship, stats);
    const startedAt = Date.now();
    try {
      const result = await this.run(call);
      stats.calls += 1;
      stats.okCalls += 1;
      const elapsed = Date.now() - startedAt;
      stats.totalElapsedMs += elapsed;
      stats.maxElapsedMs = Math.max(stats.maxElapsedMs, elapsed);
      return result;
    } catch (error) {
      stats.calls += 1;
      stats.errorCalls += 1;
      const elapsedMs =
        error instanceof FleetAiDependencyError ? error.failure.elapsedMs : Date.now() - startedAt;
      if (error instanceof FleetAiDependencyError && error.failure.name === 'FleetAiCallDeadlineError') {
        stats.timeoutCalls += 1;
      }
      stats.totalElapsedMs += elapsedMs;
      stats.maxElapsedMs = Math.max(stats.maxElapsedMs, elapsedMs);
      throw error;
    }
  }

  /**
   * Read (never clear) this run's per-ship aggregates so far. Why a plain
   * getter rather than a drain: the caller flushes once per ship at the
   * moment that ship finishes, but the circuit itself is shared across every
   * ship in the run and must keep the accumulator alive for ships still to
   * come.
   *
   * @param ship - The ship name to look up.
   * @returns The accumulated stats, or null if that ship made no calls
   *   through {@link runForShip}.
   */
  snapshotShipStats(ship: string): ShipAiCallStats | null {
    return this.shipStats.get(ship) ?? null;
  }
}

/**
 * Normalize Cloudflare's 1-based delivery counter at the trust boundary.
 * Direct callers and malformed counters take the conservative final-attempt
 * path; counters from older queue configurations are capped so transcripts
 * never claim an impossible `4/3` provider budget.
 */
export function normalizeProviderQueueAttempt(attempt: unknown): number {
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt <= 0) {
    return PROVIDER_MAX_DELIVERY_ATTEMPTS;
  }
  return Math.min(attempt, PROVIDER_MAX_DELIVERY_ATTEMPTS);
}

/**
 * Full-jitter queue delay for a provider retry.
 *
 * `attempt=1` samples [1,15], attempt 2 [1,30], and so on. The injected random
 * source makes the distribution and hard cap directly testable.
 */
export function providerRetryDelaySeconds(
  attempt: number,
  random: () => number = Math.random,
  retryAfterSeconds: number | null = null,
): number {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const ceiling = Math.min(
    PROVIDER_RETRY_CAP_SECONDS,
    PROVIDER_RETRY_BASE_SECONDS * 2 ** Math.max(0, safeAttempt - 1),
  );
  const draw = random();
  const sample = Number.isFinite(draw) ? Math.max(0, Math.min(0.999999, draw)) : 0;
  const jittered = Math.max(1, Math.floor(sample * ceiling) + 1);
  const providerMinimum = positiveIntegerOrNull(retryAfterSeconds) ?? 0;
  return Math.min(CLOUDFLARE_QUEUE_DELAY_CAP_SECONDS, Math.max(jittered, providerMinimum));
}

/**
 * Extract structured Cloudflare status/code evidence and produce bounded,
 * redacted text. No request body, prompt, token, stack, or headers are stored.
 */
export function describeAiFailure(error: unknown, elapsedMs = 0): AiFailureDetail {
  const record = asRecord(error);
  const cause = asRecord(record?.cause);
  const rawName =
    stringField(record, 'name') ?? stringField(cause, 'name') ??
    (error instanceof Error ? error.name : 'WorkersAiError');
  const rawMessage =
    stringField(record, 'message') ?? stringField(cause, 'message') ?? String(error ?? 'unknown error');

  const status =
    numberField(record, ['status', 'statusCode', 'httpStatus']) ??
    numberField(cause, ['status', 'statusCode', 'httpStatus']) ??
    labelledNumber(
      rawMessage,
      /\b(?:http(?:\/\d(?:\.\d)?)?(?:\s+status)?|status)\s*[:=]?\s*(\d{3})\b/i,
    );
  const code =
    numberField(record, ['code', 'errorCode', 'internalCode']) ??
    numberField(cause, ['code', 'errorCode', 'internalCode']) ??
    labelledNumber(
      rawMessage,
      /\b(?:(?:workers?\s+ai\s+)?(?:internal\s+)?(?:error\s+)?code|workers?\s+ai\s+error)\s*[:=#-]?\s*(\d{3,5})\b/i,
    );
  const retryAfterSeconds =
    numberField(record, ['retryAfterSeconds', 'retry_after', 'retryAfter']) ??
    numberField(cause, ['retryAfterSeconds', 'retry_after', 'retryAfter']);

  const retryable = isRetryableAiFailure({ name: rawName, status, code });
  const name = sanitizeErrorText(rawName, 80) || 'WorkersAiError';
  const message = sanitizeErrorText(rawMessage, MAX_ERROR_CHARS) || 'unknown Workers AI error';
  const safeElapsedMs = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;
  const evidence = [
    status == null ? null : `HTTP ${status}`,
    code == null ? null : `code ${code}`,
    // Surfaced here, not just in the raw ShipAiCallStats row, because this
    // string is what actually reaches the PR check-run summary and the run
    // page's step detail — the two places an operator asks "how long did
    // this call actually take" without a separate query.
    safeElapsedMs <= 0 ? null : `${safeElapsedMs}ms elapsed`,
  ].filter(Boolean).join(', ');
  const summary = `${name}${evidence ? ` (${evidence})` : ''}: ${message}`;

  return {
    name,
    message,
    summary: sanitizeErrorText(summary, MAX_ERROR_CHARS),
    status,
    code,
    retryAfterSeconds: positiveIntegerOrNull(retryAfterSeconds),
    retryable,
    elapsedMs: safeElapsedMs,
  };
}

function isRetryableAiFailure(input: {
  name: string;
  status: number | null;
  code: number | null;
}): boolean {
  if (input.code != null) {
    if (RETRYABLE_AI_CODES.has(input.code)) return true;
    if (PERMANENT_AI_CODES.has(input.code)) return false;
  }
  if (input.status != null) return RETRYABLE_HTTP_STATUSES.has(input.status);
  return input.name === 'NetworkError' || input.name === 'AbortError';
}

function sanitizeErrorText(value: string, limit: number): string {
  const redacted = value
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, '[redacted-pem]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(authorization|token|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : null;
}

function numberField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record?.[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function labelledNumber(value: string, pattern: RegExp): number | null {
  const match = pattern.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveIntegerOrNull(value: number | null): number | null {
  return value != null && Number.isInteger(value) && value > 0 ? value : null;
}
