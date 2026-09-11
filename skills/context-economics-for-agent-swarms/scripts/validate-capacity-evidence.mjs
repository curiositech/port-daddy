#!/usr/bin/env node

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/validate-capacity-evidence.mjs <evidence.json>");
  process.exit(2);
}

let evidence;
try {
  evidence = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [`invalid JSON: ${error.message}`] }, null, 2));
  process.exit(1);
}

const errors = [];
const epsilon = 1e-9;
const eligibleQualities = new Set(["authoritative", "observed"]);

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

requireValue(evidence?.schemaVersion === "1.0.0", "schemaVersion must be 1.0.0");
requireValue(evidence?.kind === "capacity-evidence", "kind must be capacity-evidence");
requireValue(evidence?.launchAuthority === false, "capacity evidence must explicitly deny launch authority");
requireValue(["real-provider", "fake-or-replay"].includes(evidence?.executionClass), "executionClass must be real-provider or fake-or-replay");
if (evidence?.executionClass === "fake-or-replay") {
  requireValue(evidence?.observation?.sourceKind === "fake-fixture", "fake-or-replay evidence must come from a fake fixture");
}
if (evidence?.executionClass === "real-provider" && evidence?.admissible === true) {
  requireValue(
    ["documented-provider-response", "documented-first-party-client"].includes(evidence?.observation?.sourceKind),
    "admissible real-provider evidence requires a documented structured source"
  );
}

const observedAt = Date.parse(evidence?.observation?.observedAt);
const expiresAt = Date.parse(evidence?.observation?.expiresAt);
const evaluatedAt = Date.parse(evidence?.evaluatedAt);
const readingFresh = Number.isFinite(observedAt) && Number.isFinite(expiresAt) && Number.isFinite(evaluatedAt) && observedAt <= evaluatedAt && evaluatedAt <= expiresAt;
requireValue(Number.isFinite(observedAt) && Number.isFinite(expiresAt) && observedAt < expiresAt, "observation expiry must follow observation time");

const buckets = Array.isArray(evidence?.buckets) ? evidence.buckets : [];
const bucketIds = new Set();
const aliases = new Map();
const bucketById = new Map();
let everyBucketEligible = buckets.length > 0;

for (const bucket of buckets) {
  requireValue(!bucketIds.has(bucket.capacityBucketId), `duplicate capacityBucketId ${bucket.capacityBucketId}`);
  bucketIds.add(bucket.capacityBucketId);
  bucketById.set(bucket.capacityBucketId, bucket);
  for (const alias of bucket.routeAliases ?? []) {
    const owner = aliases.get(alias);
    requireValue(owner === undefined || owner === bucket.capacityBucketId, `route alias ${alias} is split across ${owner} and ${bucket.capacityBucketId}`);
    aliases.set(alias, bucket.capacityBucketId);
  }

  const numericInputs = [
    bucket.observedRemaining,
    bucket.operatorReserve,
    bucket.outstandingReservations,
    bucket.unresolvedAttemptHolds,
    bucket.driftMargin,
    bucket.checkpointTailReserve,
    bucket.forecast?.p95
  ];
  const calculable = numericInputs.every(Number.isFinite);
  const expectedAllocatable = calculable
    ? bucket.observedRemaining - bucket.operatorReserve - bucket.outstandingReservations - bucket.unresolvedAttemptHolds - bucket.driftMargin
    : null;
  const expectedRisk = calculable
    ? (bucket.forecast.p95 + bucket.checkpointTailReserve) / Math.max(expectedAllocatable, epsilon)
    : null;
  const expectedEligible = Boolean(
    calculable &&
    readingFresh &&
    eligibleQualities.has(bucket.quality) &&
    evidence.discrepancies?.length === 0 &&
    bucket.forecast.p95 + bucket.checkpointTailReserve <= expectedAllocatable
  );

  if (calculable) {
    requireValue(nearlyEqual(bucket.allocatable, expectedAllocatable), `bucket ${bucket.capacityBucketId} allocatable does not match the native-unit formula`);
    requireValue(nearlyEqual(bucket.risk, expectedRisk), `bucket ${bucket.capacityBucketId} risk does not match p95 plus checkpoint tail`);
  } else {
    requireValue(bucket.allocatable === null, `bucket ${bucket.capacityBucketId} must use null allocatable when inputs are unknown`);
    requireValue(bucket.risk === null, `bucket ${bucket.capacityBucketId} must use null risk when inputs are unknown`);
  }
  requireValue(bucket.eligible === expectedEligible, `bucket ${bucket.capacityBucketId} eligibility disagrees with evidence`);
  everyBucketEligible &&= expectedEligible;
}

const reservation = evidence?.reservation;
const reservationItems = Array.isArray(reservation?.items) ? reservation.items : [];
const reservationBucketIds = new Set();
for (const item of reservationItems) {
  requireValue(!reservationBucketIds.has(item.capacityBucketId), `duplicate reservation item for ${item.capacityBucketId}`);
  reservationBucketIds.add(item.capacityBucketId);
  const bucket = bucketById.get(item.capacityBucketId);
  requireValue(Boolean(bucket), `reservation references unknown bucket ${item.capacityBucketId}`);
  if (bucket && Number.isFinite(bucket.forecast?.p95)) {
    requireValue(nearlyEqual(item.reservedUnits, bucket.forecast.p95 + bucket.checkpointTailReserve), `reservation for ${item.capacityBucketId} must include p95 burn plus checkpoint tail`);
  }
}

if (evidence?.admissible === true) {
  requireValue(everyBucketEligible, "admissible evidence requires every bucket eligible");
  requireValue(reservation?.state === "committed", "admissible evidence requires a committed reservation");
  requireValue(Boolean(reservation?.reservationId), "admissible evidence requires reservationId");
  requireValue(reservation?.atomicAcrossBucketsAndAliases === true, "admissible evidence requires atomic reservation across every canonical bucket and route alias");
  requireValue(reservationItems.length === buckets.length, "admissible evidence requires exactly one reservation item per bucket");
} else {
  requireValue(!everyBucketEligible || evidence?.preemptionState === "UNKNOWN" || evidence?.preemptionState === "WAIT_FOR_RESET" || evidence?.preemptionState === "EXHAUSTED" || evidence?.preemptionState === "CHECKPOINT_NOW", "inadmissible evidence must expose a blocking preemption state or ineligible bucket");
}

requireValue(evidence?.admissible === (everyBucketEligible && reservation?.state === "committed"), "root admissible must equal all-bucket eligibility with committed reservation");

console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
