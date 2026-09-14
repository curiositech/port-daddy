#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const capacitySchema = JSON.parse(
  readFileSync(new URL("../schemas/capacity-evidence.schema.json", import.meta.url), "utf8"),
);
const validateCapacitySchema = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(capacitySchema);

const epsilon = 1e-9;
const eligibleQualities = new Set(["authoritative", "observed"]);

function nearlyEqual(left, right) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

export function validateCapacityEvidence(evidence) {
  const errors = [];
  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };

  if (!validateCapacitySchema(evidence)) {
    for (const error of validateCapacitySchema.errors ?? []) {
      errors.push(`schema ${error.instancePath || "/"} ${error.message}`);
    }
  }

  requireValue(evidence?.schemaVersion === "1.0.0", "schemaVersion must be 1.0.0");
  requireValue(evidence?.kind === "capacity-evidence", "kind must be capacity-evidence");
  requireValue(evidence?.launchAuthority === false, "capacity evidence must explicitly deny launch authority");
  requireValue(
    ["real-provider", "fake-or-replay"].includes(evidence?.executionClass),
    "executionClass must be real-provider or fake-or-replay",
  );
  if (evidence?.executionClass === "fake-or-replay") {
    requireValue(
      evidence?.observation?.sourceKind === "fake-fixture",
      "fake-or-replay evidence must come from a fake fixture",
    );
  }
  if (evidence?.executionClass === "real-provider" && evidence?.admissible === true) {
    requireValue(
      ["documented-provider-response", "documented-first-party-client"].includes(
        evidence?.observation?.sourceKind,
      ),
      "admissible real-provider evidence requires a documented structured source",
    );
  }

  const observedAt = Date.parse(evidence?.observation?.observedAt);
  const observationExpiresAt = Date.parse(evidence?.observation?.expiresAt);
  const evaluatedAt = Date.parse(evidence?.evaluatedAt);
  const readingFresh = Number.isFinite(observedAt)
    && Number.isFinite(observationExpiresAt)
    && Number.isFinite(evaluatedAt)
    && observedAt <= evaluatedAt
    && evaluatedAt <= observationExpiresAt;
  requireValue(
    Number.isFinite(observedAt)
      && Number.isFinite(observationExpiresAt)
      && observedAt < observationExpiresAt,
    "observation expiry must follow observation time",
  );

  const buckets = Array.isArray(evidence?.buckets) ? evidence.buckets : [];
  const bucketIds = new Set();
  const aliases = new Map();
  const bucketById = new Map();
  let everyBucketEligible = buckets.length > 0;

  for (const bucket of buckets) {
    requireValue(
      !bucketIds.has(bucket.capacityBucketId),
      `duplicate capacityBucketId ${bucket.capacityBucketId}`,
    );
    bucketIds.add(bucket.capacityBucketId);
    bucketById.set(bucket.capacityBucketId, bucket);
    const routeAliases = Array.isArray(bucket.routeAliases) ? bucket.routeAliases : [];
    for (const alias of routeAliases) {
      const owner = aliases.get(alias);
      requireValue(
        owner === undefined || owner === bucket.capacityBucketId,
        `route alias ${alias} is split across ${owner} and ${bucket.capacityBucketId}`,
      );
      aliases.set(alias, bucket.capacityBucketId);
    }

    const forecastRouteOwned = routeAliases.includes(bucket.forecast?.route);
    requireValue(
      forecastRouteOwned,
      `bucket ${bucket.capacityBucketId} forecast route ${bucket.forecast?.route ?? "<missing>"} is not one of its routeAliases`,
    );

    const numericInputs = [
      bucket.observedRemaining,
      bucket.operatorReserve,
      bucket.outstandingReservations,
      bucket.unresolvedAttemptHolds,
      bucket.driftMargin,
      bucket.checkpointTailReserve,
      bucket.forecast?.p95,
    ];
    const calculable = numericInputs.every(Number.isFinite);
    const expectedAllocatable = calculable
      ? bucket.observedRemaining
        - bucket.operatorReserve
        - bucket.outstandingReservations
        - bucket.unresolvedAttemptHolds
        - bucket.driftMargin
      : null;
    const expectedRisk = calculable
      ? (bucket.forecast.p95 + bucket.checkpointTailReserve)
        / Math.max(expectedAllocatable, epsilon)
      : null;
    const expectedEligible = Boolean(
      calculable
      && forecastRouteOwned
      && readingFresh
      && eligibleQualities.has(bucket.quality)
      && evidence.discrepancies?.length === 0
      && bucket.forecast.p95 + bucket.checkpointTailReserve <= expectedAllocatable,
    );

    if (calculable) {
      requireValue(
        nearlyEqual(bucket.allocatable, expectedAllocatable),
        `bucket ${bucket.capacityBucketId} allocatable does not match the native-unit formula`,
      );
      requireValue(
        nearlyEqual(bucket.risk, expectedRisk),
        `bucket ${bucket.capacityBucketId} risk does not match p95 plus checkpoint tail`,
      );
    } else {
      requireValue(
        bucket.allocatable === null,
        `bucket ${bucket.capacityBucketId} must use null allocatable when inputs are unknown`,
      );
      requireValue(
        bucket.risk === null,
        `bucket ${bucket.capacityBucketId} must use null risk when inputs are unknown`,
      );
    }
    requireValue(
      bucket.eligible === expectedEligible,
      `bucket ${bucket.capacityBucketId} eligibility disagrees with evidence`,
    );
    everyBucketEligible &&= expectedEligible;
  }

  const reservation = evidence?.reservation;
  const reservationIssuedAt = Date.parse(reservation?.issuedAt);
  const reservationExpiresAt = Date.parse(reservation?.expiresAt);
  const reservationFresh = Number.isFinite(reservationIssuedAt)
    && Number.isFinite(reservationExpiresAt)
    && Number.isFinite(evaluatedAt)
    && reservationIssuedAt <= evaluatedAt
    && evaluatedAt < reservationExpiresAt;
  const reservationItems = Array.isArray(reservation?.items) ? reservation.items : [];
  const reservationBucketIds = new Set();
  for (const item of reservationItems) {
    requireValue(
      !reservationBucketIds.has(item.capacityBucketId),
      `duplicate reservation item for ${item.capacityBucketId}`,
    );
    reservationBucketIds.add(item.capacityBucketId);
    const bucket = bucketById.get(item.capacityBucketId);
    requireValue(Boolean(bucket), `reservation references unknown bucket ${item.capacityBucketId}`);
    if (bucket && Number.isFinite(bucket.forecast?.p95)) {
      requireValue(
        nearlyEqual(item.reservedUnits, bucket.forecast.p95 + bucket.checkpointTailReserve),
        `reservation for ${item.capacityBucketId} must include p95 burn plus checkpoint tail`,
      );
    }
  }

  if (evidence?.admissible === true) {
    requireValue(everyBucketEligible, "admissible evidence requires every bucket eligible");
    requireValue(
      reservation?.state === "committed",
      "admissible evidence requires a committed reservation",
    );
    requireValue(Boolean(reservation?.reservationId), "admissible evidence requires reservationId");
    requireValue(
      reservationFresh,
      "admissible evidence requires finite reservation timestamps with issuedAt <= evaluatedAt < expiresAt",
    );
    requireValue(
      reservation?.atomicAcrossBucketsAndAliases === true,
      "admissible evidence requires atomic reservation across every canonical bucket and route alias",
    );
    requireValue(
      reservationItems.length === buckets.length,
      "admissible evidence requires exactly one reservation item per bucket",
    );
  } else {
    requireValue(
      !everyBucketEligible
        || evidence?.preemptionState === "UNKNOWN"
        || evidence?.preemptionState === "WAIT_FOR_RESET"
        || evidence?.preemptionState === "EXHAUSTED"
        || evidence?.preemptionState === "CHECKPOINT_NOW",
      "inadmissible evidence must expose a blocking preemption state or ineligible bucket",
    );
  }

  const expectedAdmissible = Boolean(
    everyBucketEligible
    && reservation?.state === "committed"
    && reservation?.reservationId
    && reservation?.atomicAcrossBucketsAndAliases === true
    && reservationFresh
    && reservationItems.length === buckets.length,
  );
  requireValue(
    evidence?.admissible === expectedAdmissible,
    "root admissible must equal eligible buckets with complete, atomic, unexpired reservation evidence",
  );

  return { valid: errors.length === 0, errors };
}

function runCli() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/validate-capacity-evidence.mjs <evidence.json>");
    process.exit(2);
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ valid: false, errors: [`invalid JSON: ${error.message}`] }, null, 2));
    process.exit(1);
  }

  const result = validateCapacityEvidence(evidence);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
