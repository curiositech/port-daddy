import assert from "node:assert/strict";
import { selectContextParts } from "./context-budget.mjs";
import { planLocalRetry } from "./retry-policy.mjs";

let cases = 0;
function check(name, fn) { cases += 1; try { fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const part = (id, tokenEstimate, required, priority) => ({ id, tokenEstimate, required, priority });
const envelopeMeasure = (parts) => 7 + parts.reduce((sum, item) => sum + item.tokenEstimate, 0);

check("source-order exact remeasurement and deterministic priority", () => {
  const parts = [part("required", 20, true, 0), part("optional-low", 30, false, 1), part("optional-high", 30, false, 9)];
  const calls = [];
  const result = selectContextParts({ capacityTokens: 70, reservedTokens: 5, overheadTokens: 5, parts, measureEnvelope: (selected) => { calls.push(selected.map((x) => x.id)); return envelopeMeasure(selected); } });
  assert.equal(result.status, "READY");
  assert.deepEqual(calls, [["required", "optional-low", "optional-high"], ["required", "optional-high"]]);
  assert.deepEqual(result.parts.map((x) => x.id), ["required", "optional-high"]);
  assert.equal(result.measuredTokens, 57);
});
check("codepoint tie break retains deterministic winner while measuring source order", () => {
  const parts = [part("required", 1, true, 0), part("b", 10, false, 1), part("a", 10, false, 1)];
  const result = selectContextParts({ capacityTokens: 18, reservedTokens: 0, overheadTokens: 0, parts, measureEnvelope: (selected) => selected.reduce((n, x) => n + x.tokenEstimate, 0) });
  assert.deepEqual(result.parts.map((x) => x.id), ["required", "b"]);
});
check("reserves and mandatory envelope are unresolved without dropping required", () => {
  let result = selectContextParts({ capacityTokens: 20, reservedTokens: 10, overheadTokens: 11, parts: [], measureEnvelope: () => 0 });
  assert.equal(result.reason, "RESERVES_EXCEED_CAPACITY");
  result = selectContextParts({ capacityTokens: 26, reservedTokens: 0, overheadTokens: 0, parts: [part("required", 20, true, 0)], measureEnvelope: envelopeMeasure });
  assert.equal(result.reason, "REQUIRED_ENVELOPE_EXCEEDS_BUDGET");
  assert.deepEqual(result.parts.map((x) => x.id), ["required"]);
});
for (const [name, measureEnvelope] of [["negative", () => -1], ["nan", () => NaN], ["infinite", () => Infinity], ["fraction", () => 1.5], ["throw", () => { throw new RangeError("fixture"); }]]) {
  check(`invalid measurement ${name}`, () => {
    const result = selectContextParts({ capacityTokens: 10, reservedTokens: 0, overheadTokens: 0, parts: [part("required", 1, true, 0)], measureEnvelope });
    assert.equal(result.status, "UNRESOLVED_CONTEXT_BUDGET");
    assert.equal(result.reason, name === "throw" ? "ENVELOPE_MEASUREMENT_THROWN" : "INVALID_ENVELOPE_MEASUREMENT");
  });
}
check("malformed context inputs", () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  for (const bad of [-1, 1.5, unsafe]) {
    const result = selectContextParts({ capacityTokens: bad, reservedTokens: 0, overheadTokens: 0, parts: [], measureEnvelope: () => 0 });
    assert.equal(result.reason, "INVALID_LOCAL_BUDGET_INPUT");
  }
});

const policy = { maxAttempts: 3, deadlineMs: 1_000, initialDelayMs: 20, maxDelayMs: 80, retryableCodes: ["RATE_LIMITED"], knownRejectionCodes: ["FORBIDDEN"] };
check("stable key and remote maxRetries have no policy authority", () => {
  const result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 100, error: { code: "RATE_LIMITED", retryable: true, maxRetries: 999 }, policy });
  assert.deepEqual(result, { kind: "RETRY", code: "RATE_LIMITED", operationKey: "op-7", nextAttemptNumber: 2, delayMs: 20, nextAttemptAtMs: 120 });
});
check("trusted retry after is a minimum and cap mismatch is unresolved", () => {
  let result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 100, error: { code: "RATE_LIMITED", retryable: true, trustedRetryAfterMs: 30 }, policy });
  assert.equal(result.delayMs, 30);
  result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 100, error: { code: "RATE_LIMITED", retryable: true, trustedRetryAfterMs: 81 }, policy });
  assert.equal(result.reason, "RETRY_AFTER_EXCEEDS_LOCAL_CAP");
});
check("attempt, equality deadline, and overflow boundaries", () => {
  let result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 100, error: { code: "RATE_LIMITED", retryable: true }, policy: { ...policy, maxAttempts: 1 } });
  assert.equal(result.reason, "ATTEMPT_BUDGET_EXHAUSTED");
  result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 1_000, error: { code: "RATE_LIMITED", retryable: true }, policy });
  assert.equal(result.reason, "WALLTIME_BUDGET_EXHAUSTED");
  result = planLocalRetry({ operationKey: "op-7", completedAttempts: 54, nowMs: 1, error: { code: "RATE_LIMITED", retryable: true }, policy: { ...policy, maxAttempts: 55, deadlineMs: Number.MAX_SAFE_INTEGER } });
  assert.equal(result.reason, "DELAY_OVERFLOW");
});
check("malformed policy and known rejection confirmation", () => {
  let result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 1, error: { code: "RATE_LIMITED", retryable: true }, policy: { ...policy, initialDelayMs: undefined } });
  assert.equal(result.reason, "INVALID_LOCAL_POLICY");
  result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 1, error: { code: "FORBIDDEN", retryable: true }, policy });
  assert.equal(result.kind, "UNRESOLVED_EXTERNAL_OUTCOME");
  result = planLocalRetry({ operationKey: "op-7", completedAttempts: 1, nowMs: 1, error: { code: "FORBIDDEN", retryable: true, confirmedKnownRejection: true }, policy });
  assert.equal(result.kind, "KNOWN_REJECTION");
});
console.log(JSON.stringify({ valid: true, cases }));
