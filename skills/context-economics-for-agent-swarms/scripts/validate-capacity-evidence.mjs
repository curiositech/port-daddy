#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Ajv 8 is an existing runtime dependency of this validator. Resolve it through
// Node's standard CommonJS resolution so normal local installs and NODE_PATH
// based test environments both work; never pin a machine-specific path here.
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js").default;
const capacitySchema = JSON.parse(
  readFileSync(new URL("../schemas/capacity-evidence.schema.json", import.meta.url), "utf8"),
);
const schemaValidator = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: true,
});
schemaValidator.addFormat("date-time", (value) => parseStrictTimestamp(value) !== null);
const validateCapacitySchema = schemaValidator.compile(capacitySchema);

const epsilon = 1e-9;
const eligibleQualities = new Set(["authoritative", "observed"]);
const blockingPreemptionStates = new Set(["CHECKPOINT_NOW", "WAIT_FOR_RESET", "EXHAUSTED", "UNKNOWN"]);

function nearlyEqual(left, right) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

// Accepted timestamp profile: RFC3339 full date-time with seconds and either
// Z or an explicit numeric offset. Validate calendar fields before Date.parse,
// which otherwise normalizes dates such as February 31 on some runtimes.
export function parseStrictTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function schemaErrors(evidence) {
  if (validateCapacitySchema(evidence)) return [];
  return (validateCapacitySchema.errors ?? []).map(
    (error) => `schema ${error.instancePath || "/"} ${error.message}`,
  );
}

/**
 * Validate declared capacity evidence and its cross-field arithmetic.
 * This validates only the supplied declaration: it does not authenticate its
 * digests, observe an account, commit a reservation, or grant launch authority.
 */
export function validateCapacityEvidence(evidence) {
  // Return before semantic traversal when structural validation fails. This is
  // deliberate: malformed null rows and containers must be reportable, not throw.
  const errors = schemaErrors(evidence);
  if (errors.length) return { valid: false, errors };

  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };
  requireValue(evidence.schemaVersion === "1.0.0", "schemaVersion must be 1.0.0");
  requireValue(evidence.kind === "capacity-evidence", "kind must be capacity-evidence");
  requireValue(evidence.launchAuthority === false, "capacity evidence must explicitly deny launch authority");
  requireValue(
    ["real-provider", "fake-or-replay"].includes(evidence.executionClass),
    "executionClass must be real-provider or fake-or-replay",
  );
  if (evidence.executionClass === "fake-or-replay") {
    requireValue(evidence.observation.sourceKind === "fake-fixture", "fake-or-replay evidence must come from a fake fixture");
  }
  if (evidence.executionClass === "real-provider" && evidence.admissible === true) {
    requireValue(
      ["documented-provider-response", "documented-first-party-client"].includes(evidence.observation.sourceKind),
      "admissible real-provider evidence requires a documented structured source",
    );
  }

  const observedAt = parseStrictTimestamp(evidence.observation.observedAt);
  const observationExpiresAt = parseStrictTimestamp(evidence.observation.expiresAt);
  const evaluatedAt = parseStrictTimestamp(evidence.evaluatedAt);
  requireValue(observedAt !== null, "observation.observedAt must be a valid RFC3339 full date-time");
  requireValue(observationExpiresAt !== null, "observation.expiresAt must be a valid RFC3339 full date-time");
  requireValue(evaluatedAt !== null, "evaluatedAt must be a valid RFC3339 full date-time");
  requireValue(
    observedAt !== null && observationExpiresAt !== null && observedAt < observationExpiresAt,
    "observation expiry must follow observation time",
  );
  const readingFresh = observedAt !== null
    && observationExpiresAt !== null
    && evaluatedAt !== null
    && observedAt <= evaluatedAt
    && evaluatedAt < observationExpiresAt;

  const buckets = evidence.buckets;
  const bucketIds = new Set();
  // An alias may draw more than one required window (for example, five-hour
  // and weekly). Its local ownership key is therefore (alias, windowId), not
  // alias alone. capacityBucketId remains unique for the supplied evidence.
  const aliasesByWindow = new Map();
  const bucketById = new Map();
  let everyBucketEligible = buckets.length > 0;

  for (const bucket of buckets) {
    requireValue(!bucketIds.has(bucket.capacityBucketId), `duplicate capacityBucketId ${bucket.capacityBucketId}`);
    bucketIds.add(bucket.capacityBucketId);
    bucketById.set(bucket.capacityBucketId, bucket);
    for (const alias of bucket.routeAliases) {
      const windowOwners = aliasesByWindow.get(alias) ?? new Map();
      const owner = windowOwners.get(bucket.windowId);
      requireValue(
        owner === undefined || owner === bucket.capacityBucketId,
        `route alias ${alias} is split across same window ${bucket.windowId} in ${owner} and ${bucket.capacityBucketId}`,
      );
      windowOwners.set(bucket.windowId, bucket.capacityBucketId);
      aliasesByWindow.set(alias, windowOwners);
    }

    const finiteFields = [
      ['observedLimit', bucket.observedLimit],
      ['observedRemaining', bucket.observedRemaining],
      ['operatorReserve', bucket.operatorReserve],
      ['outstandingReservations', bucket.outstandingReservations],
      ['unresolvedAttemptHolds', bucket.unresolvedAttemptHolds],
      ['driftMargin', bucket.driftMargin],
      ['checkpointTailReserve', bucket.checkpointTailReserve],
      ['allocatable', bucket.allocatable],
      ['risk', bucket.risk],
      ['forecast.contextTokens', bucket.forecast.contextTokens],
      ['forecast.p50', bucket.forecast.p50],
      ['forecast.p90', bucket.forecast.p90],
      ['forecast.p95', bucket.forecast.p95],
      ['forecast.sampleSize', bucket.forecast.sampleSize],
      ['forecast.calibrationErrorP95', bucket.forecast.calibrationErrorP95],
    ];
    for (const [field, value] of finiteFields) {
      requireValue(value === null || Number.isFinite(value), `bucket ${bucket.capacityBucketId} ${field} must be finite when supplied`);
    }

    const forecastRouteOwned = bucket.routeAliases.includes(bucket.forecast.route);
    requireValue(
      forecastRouteOwned,
      `bucket ${bucket.capacityBucketId} forecast route ${bucket.forecast.route} is not one of its routeAliases`,
    );

    if (Number.isFinite(bucket.observedRemaining) && Number.isFinite(bucket.observedLimit)) {
      requireValue(
        bucket.observedRemaining <= bucket.observedLimit,
        `bucket ${bucket.capacityBucketId} observedRemaining exceeds observedLimit`,
      );
    }

    const quantiles = [bucket.forecast.p50, bucket.forecast.p90, bucket.forecast.p95]
      .filter((value) => value !== null);
    for (let index = 1; index < quantiles.length; index += 1) {
      requireValue(
        quantiles[index - 1] <= quantiles[index],
        `bucket ${bucket.capacityBucketId} forecast quantiles must be nondecreasing (p50 <= p90 <= p95)`,
      );
    }

    const numericInputs = [
      bucket.observedRemaining,
      bucket.operatorReserve,
      bucket.outstandingReservations,
      bucket.unresolvedAttemptHolds,
      bucket.driftMargin,
      bucket.forecast.p95,
      bucket.checkpointTailReserve,
    ];
    const calculable = numericInputs.every(Number.isFinite);
    const expectedAllocatable = calculable
      ? bucket.observedRemaining
        - bucket.operatorReserve
        - bucket.outstandingReservations
        - bucket.unresolvedAttemptHolds
        - bucket.driftMargin
      : null;
    const requiredAmount = calculable
      ? bucket.forecast.p95 + bucket.checkpointTailReserve
      : null;
    const expectedRisk = calculable && Number.isFinite(requiredAmount) && Number.isFinite(expectedAllocatable)
      ? requiredAmount / Math.max(expectedAllocatable, epsilon)
      : null;
    const derivedArithmeticFinite = Number.isFinite(expectedAllocatable)
      && Number.isFinite(requiredAmount)
      && Number.isFinite(expectedRisk);
    // Eligibility is a declared local rule: finite native arithmetic, a route
    // actually owned by the bucket, fresh observation, usable quality, no
    // discrepancy, and required p95+tail amount no greater than allocatable.
    // risk <= 1 alone is insufficient when allocatable is negative and burn is 0.
    const expectedEligible = Boolean(
      calculable
      && derivedArithmeticFinite
      && forecastRouteOwned
      && readingFresh
      && eligibleQualities.has(bucket.quality)
      && evidence.discrepancies.length === 0
      && requiredAmount <= expectedAllocatable,
    );

    if (calculable && derivedArithmeticFinite) {
      requireValue(
        nearlyEqual(bucket.allocatable, expectedAllocatable),
        `bucket ${bucket.capacityBucketId} allocatable does not match the native-unit formula`,
      );
      requireValue(
        nearlyEqual(bucket.risk, expectedRisk),
        `bucket ${bucket.capacityBucketId} risk does not match p95 plus checkpoint tail`,
      );
    } else if (!calculable) {
      requireValue(bucket.allocatable === null, `bucket ${bucket.capacityBucketId} must use null allocatable when inputs are unknown`);
      requireValue(bucket.risk === null, `bucket ${bucket.capacityBucketId} must use null risk when inputs are unknown`);
    } else {
      requireValue(false, `bucket ${bucket.capacityBucketId} derived allocatable, required amount, and risk must remain finite`);
    }
    requireValue(bucket.eligible === expectedEligible, `bucket ${bucket.capacityBucketId} eligibility disagrees with evidence`);
    everyBucketEligible &&= expectedEligible;
  }

  const reservation = evidence.reservation;
  const reservationIssuedAt = parseStrictTimestamp(reservation.issuedAt);
  const reservationExpiresAt = parseStrictTimestamp(reservation.expiresAt);
  if (reservation.issuedAt !== null) {
    requireValue(reservationIssuedAt !== null, "reservation.issuedAt must be a valid RFC3339 full date-time");
  }
  if (reservation.expiresAt !== null) {
    requireValue(reservationExpiresAt !== null, "reservation.expiresAt must be a valid RFC3339 full date-time");
  }
  const reservationFresh = reservationIssuedAt !== null
    && reservationExpiresAt !== null
    && evaluatedAt !== null
    && reservationIssuedAt <= evaluatedAt
    && evaluatedAt < reservationExpiresAt;
  const reservationItems = reservation.items;
  const reservationBucketIds = new Set();
  for (const item of reservationItems) {
    requireValue(Number.isFinite(item.expectedRevision), `reservation expectedRevision for ${item.capacityBucketId} must be finite`);
    requireValue(Number.isFinite(item.reservedUnits), `reservation reservedUnits for ${item.capacityBucketId} must be finite`);
    requireValue(!reservationBucketIds.has(item.capacityBucketId), `duplicate reservation item for ${item.capacityBucketId}`);
    reservationBucketIds.add(item.capacityBucketId);
    const bucket = bucketById.get(item.capacityBucketId);
    requireValue(Boolean(bucket), `reservation references unknown bucket ${item.capacityBucketId}`);
    if (bucket && Number.isFinite(bucket.forecast.p95)) {
      requireValue(
        nearlyEqual(item.reservedUnits, bucket.forecast.p95 + bucket.checkpointTailReserve),
        `reservation for ${item.capacityBucketId} must include p95 burn plus checkpoint tail`,
      );
    }
  }

  const preemptionBlocksNewAdmission = blockingPreemptionStates.has(evidence.preemptionState);
  const expectedAdmissible = Boolean(
    everyBucketEligible
    && reservation.state === "committed"
    && reservation.reservationId
    && reservation.atomicAcrossBucketsAndAliases === true
    && reservationFresh
    && reservationItems.length === buckets.length
    && !preemptionBlocksNewAdmission,
  );

  if (evidence.admissible === true) {
    requireValue(everyBucketEligible, "admissible evidence requires every bucket eligible");
    requireValue(reservation.state === "committed", "admissible evidence requires a committed reservation");
    requireValue(Boolean(reservation.reservationId), "admissible evidence requires reservationId");
    requireValue(
      reservationFresh,
      "admissible evidence requires issuedAt <= evaluatedAt < expiresAt",
    );
    requireValue(
      reservation.atomicAcrossBucketsAndAliases === true,
      "admissible evidence requires atomic reservation across every canonical bucket and route alias",
    );
    requireValue(
      reservationItems.length === buckets.length,
      "admissible evidence requires exactly one reservation item per bucket",
    );
    requireValue(
      !preemptionBlocksNewAdmission,
      `preemptionState ${evidence.preemptionState} blocks new admission`,
    );
  }
  requireValue(
    evidence.admissible === expectedAdmissible,
    "admissible must match fresh eligible buckets, complete reservation, and nonblocking preemption state",
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
