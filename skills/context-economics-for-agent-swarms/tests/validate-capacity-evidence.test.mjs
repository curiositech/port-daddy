import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateCapacityEvidence, parseStrictTimestamp } from "../scripts/validate-capacity-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ready = JSON.parse(readFileSync(resolve(root, "examples/capacity-evidence.ready.json"), "utf8"));
const unknown = JSON.parse(readFileSync(resolve(root, "examples/capacity-evidence.unknown.json"), "utf8"));
const schema = JSON.parse(readFileSync(resolve(root, "schemas/capacity-evidence.schema.json"), "utf8"));
const cli = resolve(root, "scripts/validate-capacity-evidence.mjs");
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js").default;
const schemaAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
schemaAjv.addFormat("date-time", (value) => parseStrictTimestamp(value) !== null);
const schemaValidator = schemaAjv.compile(schema);

function copy(value) { return structuredClone(value); }
function blockNewAdmission(evidence) {
  evidence.admissible = false;
  evidence.preemptionState = "UNKNOWN";
  for (const bucket of evidence.buckets) if (bucket) bucket.eligible = false;
  return evidence;
}

test("ready and unknown canonical fixtures validate against schema and semantic contract", () => {
  for (const evidence of [ready, unknown]) {
    assert.equal(schemaValidator(evidence), true, JSON.stringify(schemaValidator.errors));
    assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
  }
  assert.equal(ready.launchAuthority, false);
  assert.equal(unknown.admissible, false);
  assert.equal(unknown.executionClass, "fake-or-replay");
});

test("malformed null bucket and reservation rows return structured errors, never throw", () => {
  const nullBucket = copy(ready);
  nullBucket.buckets = [null];
  const nullReservation = copy(ready);
  nullReservation.reservation.items = [null];
  for (const evidence of [null, nullBucket, nullReservation]) {
    assert.doesNotThrow(() => validateCapacityEvidence(evidence));
    const result = validateCapacityEvidence(evidence);
    assert.equal(result.valid, false);
    assert(result.errors.length > 0);
  }
});

test("CLI emits structured JSON and nonzero exit for schema-invalid containers", () => {
  const result = spawnSync(process.execPath, [cli, resolve(root, "tests/fixtures/null-bucket.json")], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, false);
  assert(output.errors.some((error) => error.startsWith("schema ")));
});

test("timestamp profile rejects date-only, impossible calendar dates, and invalid clock fields", () => {
  assert.equal(parseStrictTimestamp("2026-09-24"), null);
  assert.equal(parseStrictTimestamp("2026-02-31T00:00:00Z"), null);
  assert.equal(parseStrictTimestamp("2026-02-28T24:00:00Z"), null);
  assert.notEqual(parseStrictTimestamp("2024-02-29T18:00:00-07:00"), null);
  for (const value of ["2026-09-24", "2026-02-31T00:00:00Z"]) {
    const invalid = copy(ready);
    invalid.observation.observedAt = value;
    assert.equal(schemaValidator(invalid), false);
    assert.equal(validateCapacityEvidence(invalid).valid, false);
  }
});

test("future and stale observations cannot produce eligible buckets or admission", () => {
  const future = blockNewAdmission(copy(ready));
  future.observation.observedAt = "2026-09-11T18:02:00Z";
  assert.deepEqual(validateCapacityEvidence(future), { valid: true, errors: [] });

  const stale = blockNewAdmission(copy(ready));
  stale.evaluatedAt = "2026-09-11T18:06:00Z";
  stale.preemptionState = "UNKNOWN";
  assert.deepEqual(validateCapacityEvidence(stale), { valid: true, errors: [] });
});

test("remaining greater than stated limit is contradictory", () => {
  const evidence = copy(ready);
  evidence.buckets[0].observedLimit = 20;
  const result = validateCapacityEvidence(evidence);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("observedRemaining exceeds observedLimit")));
});

test("p50, p90, and p95 must remain nondecreasing", () => {
  const evidence = copy(ready);
  evidence.buckets[0].forecast.p50 = 20;
  const result = validateCapacityEvidence(evidence);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("forecast quantiles must be nondecreasing")));
});

test("split route aliases and foreign forecast route fail closed", () => {
  const split = copy(ready);
  const second = copy(split.buckets[0]);
  second.capacityBucketId = "bucket:other";
  second.routeAliases = [split.buckets[0].routeAliases[0]];
  second.forecast.route = second.routeAliases[0];
  split.buckets.push(second);
  const splitResult = validateCapacityEvidence(split);
  assert.equal(splitResult.valid, false);
  assert(splitResult.errors.some((error) => error.includes("route alias") && error.includes("split")));

  const repeatedInBucket = copy(ready);
  repeatedInBucket.buckets[0].routeAliases.push(repeatedInBucket.buckets[0].routeAliases[0]);
  assert.equal(validateCapacityEvidence(repeatedInBucket).valid, false);

  const foreign = copy(ready);
  foreign.buckets[0].forecast.route = "provider-demo/unlisted";
  foreign.buckets[0].eligible = false;
  foreign.admissible = false;
  foreign.preemptionState = "UNKNOWN";
  const foreignResult = validateCapacityEvidence(foreign);
  assert.equal(foreignResult.valid, false);
  assert(foreignResult.errors.some((error) => error.includes("is not one of its routeAliases")));
});

test("null unknown capacity remains unknown and ineligible, never coerced to zero", () => {
  const evidence = copy(unknown);
  const bucket = evidence.buckets[0];
  assert.equal(bucket.observedRemaining, null);
  assert.equal(bucket.allocatable, null);
  assert.equal(bucket.risk, null);
  assert.equal(validateCapacityEvidence(evidence).valid, true);
});

test("derived arithmetic must remain finite", () => {
  const evidence = copy(ready);
  const bucket = evidence.buckets[0];
  bucket.forecast.p95 = 1e308;
  bucket.checkpointTailReserve = 1e308;
  const result = validateCapacityEvidence(evidence);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("derived allocatable, required amount, and risk must remain finite")));
});

test("unresolved-attempt hold reduces native allocatable capacity", () => {
  const evidence = copy(ready);
  const bucket = evidence.buckets[0];
  bucket.unresolvedAttemptHolds = 8;
  bucket.allocatable = 15;
  bucket.risk = 12 / 15;
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
});

test("capacity fit without a committed reservation is valid but not admissible", () => {
  const evidence = copy(ready);
  evidence.reservation = {
    state: "none",
    reservationId: null,
    atomicAcrossBucketsAndAliases: false,
    issuedAt: null,
    expiresAt: null,
    items: [],
  };
  evidence.preemptionState = "ROOMY";
  evidence.admissible = false;
  assert.equal(evidence.buckets.every((bucket) => bucket.eligible), true);
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
});

test("expired reservation is a valid but inadmissible evidence state", () => {
  const evidence = copy(ready);
  evidence.evaluatedAt = "2026-09-11T18:02:00Z";
  evidence.reservation.expiresAt = "2026-09-11T18:02:00Z";
  evidence.admissible = false;
  evidence.preemptionState = "UNKNOWN";
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
});

test("CHECKPOINT_NOW consistently blocks new admission while retaining its committed evidence", () => {
  const evidence = copy(ready);
  evidence.preemptionState = "CHECKPOINT_NOW";
  evidence.admissible = false;
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });

  const claimedAdmissible = copy(evidence);
  claimedAdmissible.admissible = true;
  const result = validateCapacityEvidence(claimedAdmissible);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.startsWith("schema "))
    || result.errors.some((error) => error.includes("blocks new admission")));
});

test("schema parity retains native ledger fields and contract vocabulary", () => {
  assert.deepEqual(schema.properties.preemptionState.enum, ["ROOMY", "TIGHTENING", "CHECKPOINT_NOW", "SWITCH_ELIGIBLE", "WAIT_FOR_RESET", "EXHAUSTED", "UNKNOWN"]);
  assert.equal(schema.properties.launchAuthority.const, false);
  assert(schemaValidator(ready));
  assert(schemaValidator(unknown));
  for (const bad of [null, { ...copy(ready), buckets: [null] }, { ...copy(ready), reservation: { ...copy(ready.reservation), items: [null] } }]) {
    assert.equal(schemaValidator(bad), false);
  }
});

function addSecondRequiredWindow(evidence) {
  const weekly = copy(evidence.buckets[0]);
  weekly.capacityBucketId = "bucket:provider-demo:seat-demo:weekly";
  weekly.windowId = "weekly:2026-09-15T18:00:00Z";
  weekly.resetsAt = "2026-09-15T18:00:00Z";
  evidence.buckets.push(weekly);
  evidence.reservation.items.push({
    capacityBucketId: weekly.capacityBucketId,
    expectedRevision: 13,
    reservedUnits: weekly.forecast.p95 + weekly.checkpointTailReserve,
  });
  return evidence;
}

test("one route can reserve distinct five-hour and weekly windows together", () => {
  const evidence = addSecondRequiredWindow(copy(ready));
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
  assert.equal(evidence.admissible, true);
  assert.equal(evidence.buckets[0].routeAliases[0], evidence.buckets[1].routeAliases[0]);
  assert.notEqual(evidence.buckets[0].windowId, evidence.buckets[1].windowId);
});

test("renaming a bucket cannot split one declared provider window", () => {
  const evidence = addSecondRequiredWindow(copy(ready));
  evidence.buckets[1].windowId = evidence.buckets[0].windowId;
  const result = validateCapacityEvidence(evidence);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("split across same window")));
});

test("one insufficient required window makes a two-window declaration inadmissible", () => {
  const evidence = addSecondRequiredWindow(copy(ready));
  const weekly = evidence.buckets[1];
  weekly.observedRemaining = 38;
  weekly.allocatable = 10;
  weekly.risk = 12 / 10;
  weekly.eligible = false;
  evidence.admissible = false;
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
});

test("two-window admission rejects incomplete committed reservation coverage", () => {
  const evidence = addSecondRequiredWindow(copy(ready));
  evidence.reservation.items.pop();
  const result = validateCapacityEvidence(evidence);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("exactly one reservation item per bucket")));
});

test("negative allocatable capacity cannot become eligible through zero burn", () => {
  const evidence = copy(ready);
  const bucket = evidence.buckets[0];
  bucket.observedRemaining = 27;
  bucket.allocatable = -1;
  bucket.forecast.p50 = 0;
  bucket.forecast.p90 = 0;
  bucket.forecast.p95 = 0;
  bucket.checkpointTailReserve = 0;
  bucket.risk = 0;
  bucket.eligible = false;
  evidence.reservation = {
    state: "none", reservationId: null, atomicAcrossBucketsAndAliases: false,
    issuedAt: null, expiresAt: null, items: [],
  };
  evidence.admissible = false;
  assert.deepEqual(validateCapacityEvidence(evidence), { valid: true, errors: [] });
});

test("exported validator rejects non-finite JavaScript numbers with strict false Ajv", () => {
  const mutations = [
    (evidence) => { evidence.buckets[0].operatorReserve = Infinity; },
    (evidence) => { evidence.buckets[0].forecast.p95 = Infinity; },
    (evidence) => { evidence.buckets[0].risk = NaN; },
    (evidence) => { evidence.reservation.items[0].reservedUnits = Infinity; },
  ];
  for (const mutate of mutations) {
    const evidence = copy(ready);
    mutate(evidence);
    assert.doesNotThrow(() => validateCapacityEvidence(evidence));
    assert.equal(validateCapacityEvidence(evidence).valid, false);
  }
});
