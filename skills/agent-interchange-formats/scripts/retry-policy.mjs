/** Pure local retry planner. It performs no request and does not prove remote idempotency. */
function safeNonnegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function nonempty(value) { return typeof value === "string" && value.length > 0; }
function codeList(value) { return Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length; }
function unresolved(reason, code, operationKey) { return { kind: "UNRESOLVED_EXTERNAL_OUTCOME", reason, code, operationKey }; }

/**
 * Plans only the next *start*. The caller must separately bound request execution,
 * reconcile a stable operation key with the remote system, and persist the outcome.
 */
export function planLocalRetry({ operationKey, completedAttempts, nowMs, error, policy }) {
  const code = typeof error?.code === "string" ? error.code : "UNCLASSIFIED";
  if (!nonempty(operationKey) || !safeNonnegativeInteger(completedAttempts) || completedAttempts < 1 ||
      !safeNonnegativeInteger(nowMs) || !policy || !safeNonnegativeInteger(policy.maxAttempts) || policy.maxAttempts < 1 ||
      !safeNonnegativeInteger(policy.deadlineMs) || !safeNonnegativeInteger(policy.initialDelayMs) ||
      !safeNonnegativeInteger(policy.maxDelayMs) || policy.initialDelayMs > policy.maxDelayMs ||
      !codeList(policy.retryableCodes) || !codeList(policy.knownRejectionCodes)) {
    return unresolved("INVALID_LOCAL_POLICY", code, operationKey);
  }
  if (policy.knownRejectionCodes.includes(code) && error?.confirmedKnownRejection === true) {
    return { kind: "KNOWN_REJECTION", code, operationKey };
  }
  const retryable = error?.retryable === true && policy.retryableCodes.includes(code);
  if (!retryable) return unresolved("NOT_LOCALLY_RETRYABLE", code, operationKey);
  if (completedAttempts >= policy.maxAttempts) return unresolved("ATTEMPT_BUDGET_EXHAUSTED", code, operationKey);
  if (nowMs >= policy.deadlineMs) return unresolved("WALLTIME_BUDGET_EXHAUSTED", code, operationKey);
  const trustedMinimum = error?.trustedRetryAfterMs;
  if (trustedMinimum !== undefined && !safeNonnegativeInteger(trustedMinimum)) return unresolved("INVALID_TRUSTED_RETRY_AFTER", code, operationKey);
  if (trustedMinimum !== undefined && trustedMinimum > policy.maxDelayMs) return unresolved("RETRY_AFTER_EXCEEDS_LOCAL_CAP", code, operationKey);
  const exponent = completedAttempts - 1;
  if (exponent > 52) return unresolved("DELAY_OVERFLOW", code, operationKey);
  const localDelay = policy.initialDelayMs * 2 ** exponent;
  if (!safeNonnegativeInteger(localDelay)) return unresolved("DELAY_OVERFLOW", code, operationKey);
  const delayMs = Math.max(localDelay, trustedMinimum ?? 0);
  if (!safeNonnegativeInteger(delayMs) || delayMs > policy.maxDelayMs || delayMs >= policy.deadlineMs - nowMs) {
    return unresolved("WALLTIME_BUDGET_EXHAUSTED", code, operationKey);
  }
  const nextAttemptAtMs = nowMs + delayMs;
  if (!safeNonnegativeInteger(nextAttemptAtMs)) return unresolved("TIME_OVERFLOW", code, operationKey);
  return { kind: "RETRY", code, operationKey, nextAttemptNumber: completedAttempts + 1, delayMs, nextAttemptAtMs };
}
