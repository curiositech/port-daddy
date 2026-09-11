#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
const capacityPath = process.argv[3];
if (!path) {
  console.error("usage: node scripts/validate-resurrection-plan.mjs <plan.json> [capacity-evidence.json]");
  process.exit(2);
}

let capacityEvidence = null;
let capacityEvidenceReadError = null;
if (capacityPath) {
  try {
    capacityEvidence = JSON.parse(readFileSync(capacityPath, "utf8"));
  } catch (error) {
    capacityEvidenceReadError = `invalid capacity evidence: ${error.message}`;
  }
}

let plan;
try {
  plan = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [`invalid JSON: ${error.message}`] }, null, 2));
  process.exit(1);
}

const errors = [];
const readyVerdicts = new Set(["REBODIMENT_READY", "NATIVE_RESUME_ELIGIBLE"]);
const nonReadyCapabilityDispositions = new Set(["OMITTED", "BLOCKED", "UNKNOWN"]);

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

requireValue(plan?.schemaVersion === "1.0.0", "schemaVersion must be 1.0.0");
requireValue(plan?.operation === "rebody", "operation must be rebody");
requireValue(plan?.execution?.planIsLaunchAuthority === false, "a plan must explicitly deny being launch authority");
requireValue(["real-provider", "fake-or-replay"].includes(plan?.execution?.executionClass), "executionClass must be real-provider or fake-or-replay");
requireValue(plan?.capacity?.permittedExecutionClass === plan?.execution?.executionClass, "capacity evidence execution class must match the proposed body");

const effectItems = Array.isArray(plan?.effects?.items) ? plan.effects.items : [];
const seenSlots = new Set();
const seenFingerprints = new Set();
const seenKeys = new Set();
for (const effect of effectItems) {
  requireValue(!seenSlots.has(effect.effectSlotId), `duplicate effect slot ${effect.effectSlotId}`);
  requireValue(!seenFingerprints.has(effect.canonicalFingerprint), `duplicate canonical effect fingerprint ${effect.canonicalFingerprint}`);
  seenSlots.add(effect.effectSlotId);
  seenFingerprints.add(effect.canonicalFingerprint);
  for (const key of effect.idempotencyKeys ?? []) {
    requireValue(!seenKeys.has(key), `idempotency key reused across effect slots: ${key}`);
    seenKeys.add(key);
  }
  requireValue(effect.replayAllowed === false, `effect ${effect.effectSlotId} must not authorize replay`);
}

if (plan?.execution?.authorizationState === "issued") {
  requireValue(plan?.halt?.state === "inactive", "execution authorization cannot be issued under active or unknown halt");
  requireValue(Boolean(plan.execution.authorizedExecutor), "issued execution authorization requires authorizedExecutor");
  requireValue(Boolean(plan.execution.authorizationReceipt), "issued execution authorization requires authorizationReceipt");
}

if (readyVerdicts.has(plan?.verdict)) {
  requireValue(plan?.halt?.state === "inactive", "ready verdict requires halt state inactive");
  requireValue(["birth-failed", "fenced", "hibernated"].includes(plan?.predecessor?.state), "ready verdict requires proved predecessor absence, fence, or hibernation");
  requireValue(Boolean(plan?.predecessor?.fenceOrAbsenceReceipt), "ready verdict requires fenceOrAbsenceReceipt");
  requireValue(["never-started-proven", "gone"].includes(plan?.predecessor?.processWitness?.state), "ready verdict requires process absence proof");
  requireValue(Boolean(plan?.predecessor?.processWitness?.receipt), "ready verdict requires process witness receipt");
  requireValue(plan?.destination?.generation === plan?.predecessor?.generation + 1, "destination generation must equal predecessor generation + 1");
  requireValue(plan?.capsule?.audience === plan?.destination?.proposedBodyLeaseId, "capsule audience must match the proposed body lease");
  requireValue((plan?.capsule?.sequence === 1) === (plan?.capsule?.predecessorDigest === null), "capsule lineage requires predecessorDigest exactly when sequence exceeds one");
  requireValue(Date.parse(plan?.destination?.bootstrapLease?.expiresAt) > Date.parse(plan?.capsule?.issuedAt) && Date.parse(plan?.destination?.bootstrapLease?.expiresAt) <= Date.parse(plan?.capsule?.expiresAt), "bootstrap lease must expire after capsule issue and no later than capsule expiry");
  requireValue(plan?.destination?.workingCapabilitiesIssued === false, "a resurrection plan must not pre-issue working capabilities");
  requireValue(plan?.effects?.completeForGeneration === true, "ready verdict requires a complete predecessor effect ledger");
  requireValue(!effectItems.some((effect) => effect.state === "ambiguous"), "ready verdict forbids ambiguous effects");
  requireValue(Boolean(plan?.destination?.workingCapabilitySetId), "ready verdict requires a working capability set identity");
  requireValue(plan?.destination?.requiredCapabilitiesSatisfied === true, "ready verdict requires all required capabilities satisfied");
  requireValue(plan?.destination?.inheritedToolsReset === true, "ready verdict requires explicit inherited-tool reset");
  requireValue(!(plan?.destination?.capabilityReport ?? []).some((row) => row.required && nonReadyCapabilityDispositions.has(row.disposition)), "required capability is omitted, blocked, or unknown");
  requireValue(plan?.capacity?.capacityEvidenceSchemaVersion === "1.0.0", "ready verdict requires capacity-evidence schema 1.0.0");
  requireValue(plan?.capacity?.capacityEvidenceDigestAlgorithm === "sha256", "ready verdict requires sha256 capacity evidence");
  requireValue(plan?.capacity?.capacityEvidenceCanonicalEncoding === "RFC8785-JCS", "ready verdict requires RFC8785-JCS capacity evidence");
  requireValue(/^sha256:[0-9a-f]{64}$/.test(plan?.capacity?.capacityEvidenceDigest ?? ""), "ready verdict requires a content-addressed capacity evidence digest");
  requireValue(Boolean(capacityPath), "ready verdict semantic validation requires the referenced capacity-evidence file");
  requireValue(capacityEvidenceReadError === null, capacityEvidenceReadError ?? "capacity evidence could not be read");
  if (capacityEvidence) {
    requireValue(capacityEvidence?.schemaVersion === plan?.capacity?.capacityEvidenceSchemaVersion, "capacity evidence schema version mismatch");
    requireValue(capacityEvidence?.digestAlgorithm === plan?.capacity?.capacityEvidenceDigestAlgorithm, "capacity evidence digest algorithm mismatch");
    requireValue(capacityEvidence?.canonicalEncoding === plan?.capacity?.capacityEvidenceCanonicalEncoding, "capacity evidence canonical encoding mismatch");
    requireValue(capacityEvidence?.evidenceId === plan?.capacity?.capacityEvidenceId, "capacity evidence ID mismatch");
    requireValue(digest(capacityEvidence) === plan?.capacity?.capacityEvidenceDigest, "capacity evidence digest mismatch");
    requireValue(capacityEvidence?.executionClass === plan?.capacity?.permittedExecutionClass, "referenced capacity evidence execution class mismatch");
    requireValue(capacityEvidence?.reservation?.reservationId === plan?.capacity?.reservationId, "capacity reservation ID mismatch");
    requireValue(capacityEvidence?.admissible === plan?.capacity?.admissible, "capacity admissibility mismatch");
    const evidenceBucketIds = new Set(Array.isArray(capacityEvidence?.buckets) ? capacityEvidence.buckets.map((bucket) => bucket.capacityBucketId) : []);
    const planBucketIds = Array.isArray(plan?.capacity?.buckets) ? plan.capacity.buckets : [];
    requireValue(evidenceBucketIds.size === planBucketIds.length && planBucketIds.every((id) => evidenceBucketIds.has(id)), "capacity bucket set mismatch");
  }
  requireValue(Boolean(plan?.capacity?.reservationId), "ready verdict requires a fresh reservation");
  requireValue(plan?.capacity?.admissible === true, "ready verdict requires admissible capacity evidence");
  requireValue(["authoritative", "observed"].includes(plan?.capacity?.quality), "ready verdict requires authoritative or observed capacity quality");
  requireValue((plan?.capsule?.unsupportedClaims ?? []).length === 0, "ready verdict forbids unsupported capsule claims");
  const requiredFacts = new Set(plan?.capsule?.requiredFactTypes ?? []);
  const satisfiedFacts = new Set(plan?.capsule?.satisfiedFactTypes ?? []);
  requireValue(requiredFacts.size === satisfiedFacts.size && [...requiredFacts].every((fact) => satisfiedFacts.has(fact)), "ready verdict requires every typed capsule fact");
  requireValue(plan?.capsule?.redemption?.state === "pending" && plan?.capsule?.redemption?.receipt === null, "ready verdict requires an unredeemed one-time capsule");
  requireValue(Date.parse(plan?.capsule?.expiresAt) > Date.parse(plan?.capsule?.issuedAt), "capsule expiry must follow issue time");
}

if (plan?.verdict === "NATIVE_RESUME_ELIGIBLE") {
  requireValue(plan?.destination?.mode === "native-resume", "native resume verdict requires native-resume mode");
  requireValue(plan?.destination?.nativeSessionLease?.required === true, "native resume requires native-session lease");
  requireValue(plan?.destination?.nativeSessionLease?.exclusive === true, "native-session lease must be exclusive");
  requireValue(Boolean(plan?.destination?.nativeSessionLease?.receipt), "native-session lease requires a receipt");
}

console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
