/**
 * Bounded resilience at the Workers AI dependency boundary.
 *
 * There is deliberately ONE retry layer: the Cloudflare Queue delivery. A
 * failed `AI.run()` opens this run's circuit, stops queued MAP work, and throws
 * a typed error to the consumer, which redelivers with full jitter. Retrying
 * inside every MAP call as well would multiply provider load by chunk fan-out
 * and queue attempts exactly when Workers AI is already out of capacity.
 */

/** Queue deliveries allowed to probe a retryable Workers AI failure. */
export const PROVIDER_MAX_DELIVERY_ATTEMPTS = 3;

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

/**
 * Per-run circuit. It never escapes into isolate-global state: a fresh queue
 * delivery is the half-open probe, so one PR cannot poison later Fleet runs.
 */
export class FleetAiCircuit {
  private openedBy: FleetAiDependencyError | null = null;

  get isOpen(): boolean {
    return this.openedBy !== null;
  }

  get failure(): AiFailureDetail | null {
    return this.openedBy?.failure ?? null;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.openedBy) throw this.openedBy;
    try {
      return await call();
    } catch (error) {
      const wrapped = new FleetAiDependencyError(describeAiFailure(error));
      if (wrapped.failure.retryable) this.openedBy = wrapped;
      throw wrapped;
    }
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
export function describeAiFailure(error: unknown): AiFailureDetail {
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
  const evidence = [
    status == null ? null : `HTTP ${status}`,
    code == null ? null : `code ${code}`,
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
