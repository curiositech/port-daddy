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

  /**
   * Whether this run has already given up on the provider.
   * @returns True once a retryable failure has tripped the circuit.
   */
  get isOpen(): boolean {
    return this.openedBy !== null;
  }

  /**
   * The failure that tripped the circuit, for transcripts and retry policy.
   * @returns The recorded detail, or null while the circuit is closed.
   */
  get failure(): AiFailureDetail | null {
    return this.openedBy?.failure ?? null;
  }

  /**
   * Run one provider call under the circuit and the wall-clock deadline.
   *
   * DESIGN — the fail-fast half of {@link FLEET_AI_CALL_DEADLINE_MS}: once the
   * circuit is open this rejects BEFORE awaiting anything, so the remaining
   * MAP chunks of a run cost no waiting at all. That is what bounds an
   * invocation to a single deadline's worth of wall clock regardless of
   * fan-out, and it is why the deadline can be generous without risking the
   * queue consumer's own budget. Only retryable failures latch; a permanent
   * one (bad model id, bad config) is an ordinary broken-ship verdict and
   * leaves the circuit closed so later ships still get their chance.
   *
   * @param call - Thunk performing the Workers AI binding call.
   * @returns The call's resolved value.
   * @throws FleetAiDependencyError on timeout, provider failure, or an
   * already-open circuit.
   */
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
 *
 * DESIGN — fail toward "this is the last try": the counter arrives from the
 * platform as `unknown`, and the two ways of guessing wrong are not
 * symmetric. Reading a garbled counter as an EARLY attempt would keep
 * redelivering against a provider outage; reading it as the FINAL attempt
 * stops, records the cause, and lets a human or the DLQ handler decide. So
 * anything unverifiable takes the conservative path. Counters from older
 * queue configurations are additionally capped, so a transcript never claims
 * an impossible `4/3` provider budget.
 *
 * @param attempt - Cloudflare's delivery counter, of unverified type.
 * @returns A 1-based attempt number clamped to the provider budget.
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
 * `attempt=1` samples [1,15], attempt 2 [1,30], and so on. The DESIGN INTENT
 * of full jitter over fixed backoff: every queued run that fails against the
 * same provider outage would otherwise wake at the same instant and re-stampede
 * a dependency that is already short of capacity. Spreading the wake times is
 * what turns a retry ladder into relief rather than a second wave. A provider's
 * own `retry-after` is honored as a FLOOR, never a ceiling — if it asks for
 * longer than our jitter drew, it gets it.
 *
 * @param attempt - 1-based provider attempt number.
 * @param random - Injected uniform source; the seam that makes the
 * distribution and its cap directly testable.
 * @param retryAfterSeconds - Provider-requested minimum wait, when it gave one.
 * @returns Whole seconds to delay, within Cloudflare's queue delay cap.
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
 *
 * WHY REDACTION IS PART OF THE PARSE, not a later step: this detail is written
 * verbatim into run transcripts that operators read and that ship in PR
 * comments. Anything not stripped here becomes a durable, public artifact, so
 * the safe shape is built at the only point where the raw error exists.
 *
 * @param error - Whatever the Workers AI binding threw; shape is not trusted.
 * @returns Bounded, redacted detail carrying the retry decision.
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

/**
 * Decide whether a failure deserves another delivery.
 *
 * RATIONALE — precedence is the whole design: Cloudflare's numeric code is
 * consulted before the HTTP status because the two disagree in the case that
 * matters most. A permanent configuration fault (nonexistent model id, bad
 * account binding) can surface behind a 500, and retrying it burns the entire
 * ladder plus the model spend to arrive at the same answer three times. When
 * the code says nothing, status is the next-best signal, and a bare transport
 * error name is the last. Anything unrecognized is treated as PERMANENT — the
 * conservative direction, since a wrongly-retried permanent fault costs real
 * money while a wrongly-final transient one costs one run.
 *
 * @param input - Classified name/status/code from {@link describeAiFailure}.
 * @returns True when the queue should redeliver this failure.
 */
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

/**
 * Redact and bound provider error text before it can be persisted.
 *
 * PURPOSE: this text lands in run transcripts and PR comments — durable,
 * operator-visible, sometimes public. Provider errors have been observed to
 * echo request material back, so PEM blocks, bearer tokens and
 * `key: value` credential pairs are stripped by pattern rather than trusted
 * not to appear. Whitespace is collapsed and the result truncated so one
 * pathological error cannot dominate a transcript row. Redaction is
 * deliberately pattern-based and lossy in the safe direction: over-redacting
 * an innocent string costs legibility, under-redacting costs a leak.
 *
 * @param value - Raw provider error text.
 * @param limit - Maximum characters to keep before ellipsis.
 * @returns Redacted, whitespace-collapsed, length-bounded text.
 */
function sanitizeErrorText(value: string, limit: number): string {
  const redacted = value
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, '[redacted-pem]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(authorization|token|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

/**
 * Narrow an unknown thrown value to an indexable object.
 *
 * WHY: everything reaching this module came out of a `throw`, so its shape is
 * genuinely unknown — a string, null, or a class instance are all possible.
 * Funnelling every field read through one guard keeps the classifier from
 * being the place that throws while describing a throw.
 *
 * @param value - Any thrown value or nested cause.
 * @returns The value as a record, or null when it is not an object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/**
 * Read one non-empty string field from an untrusted record.
 *
 * DESIGN: empty strings are treated as absent so callers' `??` fallback chains
 * work as written — an empty `name` should defer to the next source, not win
 * and produce a blank label in a transcript.
 *
 * @param record - Untrusted record, or null.
 * @param key - Field to read.
 * @returns The non-empty string, or null.
 */
function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Read the first usable number from any of several aliased field names.
 *
 * WHY A KEY LIST: the same fact arrives under different names depending on
 * which layer raised the error — `status` / `statusCode` / `httpStatus`,
 * `code` / `errorCode` / `internalCode`. Accepting the aliases in priority
 * order is what lets one classifier serve the whole boundary. Numeric strings
 * are coerced because providers are inconsistent about quoting them.
 *
 * @param record - Untrusted record, or null.
 * @param keys - Candidate field names, in priority order.
 * @returns The first finite number found, or null.
 */
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

/**
 * Pull one labelled number out of free-form provider error text.
 *
 * WHY SCRAPING AT ALL: Workers AI reports the details that matter for retry
 * policy — the numeric code, the HTTP status, a requested wait — inside a
 * human-readable message rather than as structured fields. Refusing to read
 * them would mean treating every failure identically, which is how a
 * permanent model-configuration error ends up consuming the whole retry
 * ladder. Parsing is therefore deliberate, and deliberately total: any shape
 * the pattern does not match yields null so the caller degrades to its
 * default rather than acting on a half-read value.
 *
 * @param value - The provider error text to search.
 * @param pattern - A regex whose first capture group is the number.
 * @returns The captured finite number, or null when absent or unparseable.
 */
function labelledNumber(value: string, pattern: RegExp): number | null {
  const match = pattern.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Keep a parsed provider number only if it can be a real retry/status value.
 *
 * WHY THE GUARD IS THIS STRICT: these values are scraped out of provider error
 * text, so `0`, `-1`, `1.5` and `NaN` all arrive as plausible-looking numbers.
 * Each would be actively harmful downstream — a zero or negative
 * `retryAfterSeconds` schedules an immediate redelivery against a provider
 * that just asked for room, and a fractional one silently truncates. Returning
 * null instead lets the caller fall back to the jittered backoff ladder, which
 * is the behavior we actually want when the provider did not say something we
 * can trust.
 *
 * @param value - A number parsed from provider text, or null when absent.
 * @returns The value when it is a positive integer, otherwise null.
 */
function positiveIntegerOrNull(value: number | null): number | null {
  return value != null && Number.isInteger(value) && value > 0 ? value : null;
}
