/**
 * Durable Fleet queue delivery identity.
 *
 * Cloudflare restarts `message.attempts` at one for every explicit
 * continuation message. The executor therefore needs a monotonic cursor for
 * compare-and-swap deduplication, but that cursor is not an attempt count and
 * must never be rendered as one. This module is shared by the executor and
 * relay so new evidence and legacy cursor-only rows project the same truth.
 */

/** Cursor space reserved for one continuation's bounded platform retries. */
export const FLEET_CONTINUATION_ATTEMPT_STRIDE = 100;

/** Internal cursor plus the two operator-facing delivery coordinates. */
export interface FleetDeliveryAttempt {
  attemptCursor: number;
  continuationSequence: number | null;
  platformAttempt: number;
}

/**
 * Normalize persisted numeric evidence without inventing truth.
 * Design intent: corrupt cursor data stays visibly invalid instead of being
 * coerced into an operator-facing attempt that never happened.
 *
 * @param value - Untrusted stored or message-derived value.
 * @returns A positive safe integer, or null when the evidence is invalid.
 */
function positiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * Bound continuation sequences to the cursor space by design.
 *
 * @param value - Candidate continuation sequence.
 * @returns A valid sequence, or null when it cannot be encoded safely.
 */
function validContinuationSequence(value: unknown): number | null {
  const sequence = positiveSafeInteger(value);
  return sequence != null && sequence < 10_000 ? sequence : null;
}

/**
 * Reserve one cursor stride for bounded platform retries.
 * Design intent: a platform retry can never spill into the next continuation.
 *
 * @param value - Candidate per-message platform attempt.
 * @returns A valid platform attempt, or null outside the cursor stride.
 */
function validPlatformAttempt(value: unknown): number | null {
  const attempt = positiveSafeInteger(value);
  return attempt != null && attempt < FLEET_CONTINUATION_ATTEMPT_STRIDE
    ? attempt
    : null;
}

/**
 * Encode one queue delivery without conflating its sequence and retry count.
 *
 * Design rationale: storage needs one monotonic compare-and-swap value while
 * receipts need two truthful coordinates.
 *
 * The returned cursor is storage authority only. Receipts should render
 * `continuationSequence` and `platformAttempt`.
 *
 * @param continuationSequence - Explicit checkpoint successor, or null for admission.
 * @param platformAttempt - Cloudflare's per-message delivery attempt.
 * @returns Internal cursor plus the truthful public coordinates.
 */
export function encodeFleetDeliveryAttempt(
  continuationSequence: number | null | undefined,
  platformAttempt: number,
): FleetDeliveryAttempt {
  const attempt = validPlatformAttempt(platformAttempt);
  if (attempt == null) {
    throw new Error(
      `platform attempt must be between 1 and ${FLEET_CONTINUATION_ATTEMPT_STRIDE - 1}`,
    );
  }
  const sequence = continuationSequence == null
    ? null
    : validContinuationSequence(continuationSequence);
  if (continuationSequence != null && sequence == null) {
    throw new Error('continuation sequence must be between 1 and 9999');
  }
  return {
    attemptCursor: sequence == null
      ? attempt
      : sequence * FLEET_CONTINUATION_ATTEMPT_STRIDE + attempt,
    continuationSequence: sequence,
    platformAttempt: attempt,
  };
}

/**
 * Decode stored cursor-only evidence written before explicit attempt fields.
 *
 * Design intent: historical rows remain readable without keeping the cursor's
 * misleading public meaning.
 *
 * Invalid or corrupt values remain visible as zero rather than inventing an
 * attempt. Generated cursors can never end in zero.
 *
 * @param cursor - Persisted internal comparison cursor.
 * @returns Decoded public coordinates, or zero-valued evidence when corrupt.
 */
export function decodeFleetDeliveryAttemptCursor(cursor: unknown): FleetDeliveryAttempt {
  const safeCursor = positiveSafeInteger(cursor) ?? 0;
  if (safeCursor < FLEET_CONTINUATION_ATTEMPT_STRIDE) {
    return {
      attemptCursor: safeCursor,
      continuationSequence: null,
      platformAttempt: safeCursor,
    };
  }
  const continuationSequence = Math.floor(
    safeCursor / FLEET_CONTINUATION_ATTEMPT_STRIDE,
  );
  const platformAttempt = safeCursor % FLEET_CONTINUATION_ATTEMPT_STRIDE;
  if (
    validContinuationSequence(continuationSequence) == null ||
    validPlatformAttempt(platformAttempt) == null
  ) {
    return {
      attemptCursor: safeCursor,
      continuationSequence: null,
      platformAttempt: 0,
    };
  }
  return { attemptCursor: safeCursor, continuationSequence, platformAttempt };
}

/**
 * Read new explicit evidence or legacy `{ attempt: cursor }` detail.
 *
 * Design rationale: one projection path prevents old and new receipts from
 * disagreeing about the same queue delivery.
 *
 * @param value - Parsed transcript detail or a legacy numeric cursor.
 * @returns One normalized delivery coordinate for receipt rendering.
 */
export function readFleetDeliveryAttempt(value: unknown): FleetDeliveryAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return decodeFleetDeliveryAttemptCursor(value);
  }
  const detail = value as Record<string, unknown>;
  const explicitPlatformAttempt = validPlatformAttempt(detail.platformAttempt);
  if (explicitPlatformAttempt != null) {
    const explicitSequence = detail.continuationSequence == null
      ? null
      : validContinuationSequence(detail.continuationSequence);
    const encoded = encodeFleetDeliveryAttempt(explicitSequence, explicitPlatformAttempt);
    const storedCursor = positiveSafeInteger(detail.attemptCursor);
    return {
      ...encoded,
      attemptCursor: storedCursor ?? encoded.attemptCursor,
    };
  }
  return decodeFleetDeliveryAttemptCursor(detail.attempt);
}

/**
 * Build one honest operator label without exposing the internal cursor.
 *
 * Design intent: sequence and platform retry count are always named separately.
 *
 * @param attempt - Normalized delivery coordinate.
 * @param capitalize - Whether the first word begins a sentence.
 * @returns A sequence-aware platform-attempt label.
 */
export function fleetDeliveryAttemptLabel(
  attempt: FleetDeliveryAttempt,
  capitalize = false,
): string {
  const platform = attempt.platformAttempt > 0 ? String(attempt.platformAttempt) : '?';
  const label = attempt.continuationSequence == null
    ? `platform attempt ${platform}`
    : `continuation ${attempt.continuationSequence}, platform attempt ${platform}`;
  return capitalize ? `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}` : label;
}
