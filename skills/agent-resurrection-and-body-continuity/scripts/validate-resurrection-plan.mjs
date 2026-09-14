#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import { validateCapacityEvidence } from "../../context-economics-for-agent-swarms/scripts/validate-capacity-evidence.mjs";

const resurrectionSchema = JSON.parse(
  readFileSync(new URL("../schemas/resurrection-plan.schema.json", import.meta.url), "utf8"),
);
const validateResurrectionSchema = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(resurrectionSchema);

const readyVerdicts = new Set(["REBODIMENT_READY", "NATIVE_RESUME_ELIGIBLE"]);
const nonReadyCapabilityDispositions = new Set(["OMITTED", "BLOCKED", "UNKNOWN"]);

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

export function effectFingerprint(effect) {
  return digest({
    schema: "drydock-effect-fingerprint-v1",
    logicalIdentity: effect?.logicalIdentity,
    operation: effect?.operation,
    normalizedDestination: effect?.normalizedDestination,
    normalizedArguments: effect?.normalizedArguments,
    approvalSlot: effect?.approvalSlot,
  });
}

export function capsuleDigestPayload(capsule) {
  return {
    schema: capsule?.digestScope,
    capsuleId: capsule?.capsuleId,
    sequence: capsule?.sequence,
    predecessorDigest: capsule?.predecessorDigest,
    digestAlgorithm: capsule?.digestAlgorithm,
    canonicalEncoding: capsule?.canonicalEncoding,
    signer: {
      keyId: capsule?.signer?.keyId,
      algorithm: capsule?.signer?.algorithm,
    },
    audience: capsule?.audience,
    issuedAt: capsule?.issuedAt,
    expiresAt: capsule?.expiresAt,
    retentionRoot: capsule?.retentionRoot,
    artifactAvailabilityRoot: capsule?.artifactAvailabilityRoot,
    requiredFactTypes: capsule?.requiredFactTypes,
    satisfiedFactTypes: capsule?.satisfiedFactTypes,
    verifiedFacts: capsule?.verifiedFacts,
    unsupportedClaims: capsule?.unsupportedClaims,
    decisions: capsule?.decisions,
    toolPairs: capsule?.toolPairs,
    tests: capsule?.tests,
    transcript: capsule?.transcript,
    memoryDisposition: capsule?.memoryDisposition,
    omissions: capsule?.omissions,
    oneTime: capsule?.oneTime,
  };
}

export function capsuleDigest(capsule) {
  return digest(capsuleDigestPayload(capsule));
}

export function capsuleSignatureDigest(capsule) {
  return digest({ signature: capsule?.signer?.signature });
}

export function validateResurrectionPlan(plan, options = {}) {
  const {
    capacityEvidence = null,
    capacityEvidenceSupplied = capacityEvidence !== null,
    capacityEvidenceReadError = null,
  } = options;
  const errors = [];
  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };

  if (!validateResurrectionSchema(plan)) {
    for (const error of validateResurrectionSchema.errors ?? []) {
      errors.push(`schema ${error.instancePath || "/"} ${error.message}`);
    }
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
    const expectedFingerprint = effectFingerprint(effect);
    requireValue(!seenSlots.has(effect.effectSlotId), `duplicate effect slot ${effect.effectSlotId}`);
    requireValue(
      effect.canonicalFingerprint === expectedFingerprint,
      `effect ${effect.effectSlotId} canonical fingerprint mismatch; expected ${expectedFingerprint}`,
    );
    requireValue(
      !seenFingerprints.has(expectedFingerprint),
      `duplicate canonical effect fingerprint ${expectedFingerprint}`,
    );
    seenSlots.add(effect.effectSlotId);
    seenFingerprints.add(expectedFingerprint);
    for (const key of effect.idempotencyKeys ?? []) {
      requireValue(!seenKeys.has(key), `idempotency key reused across effect slots: ${key}`);
      seenKeys.add(key);
    }
    requireValue(effect.replayAllowed === false, `effect ${effect.effectSlotId} must not authorize replay`);
  }

  const capsule = plan?.capsule;
  const expectedCapsuleDigest = capsuleDigest(capsule);
  const expectedSignatureDigest = capsuleSignatureDigest(capsule);
  const signatureReceipt = capsule?.signatureVerificationReceipt;
  requireValue(
    capsule?.digest === expectedCapsuleDigest,
    `capsule digest mismatch; expected ${expectedCapsuleDigest}`,
  );
  requireValue(signatureReceipt?.capsuleDigest === capsule?.digest, "signature receipt must bind the capsule digest");
  requireValue(signatureReceipt?.signerKeyId === capsule?.signer?.keyId, "signature receipt must bind the signer key");
  requireValue(signatureReceipt?.signatureAlgorithm === capsule?.signer?.algorithm, "signature receipt must bind the signature algorithm");
  requireValue(signatureReceipt?.signatureDigest === expectedSignatureDigest, "signature receipt must bind the exact signature bytes");
  const capsuleIssuedAt = Date.parse(capsule?.issuedAt);
  const capsuleExpiresAt = Date.parse(capsule?.expiresAt);
  const signatureVerifiedAt = Date.parse(signatureReceipt?.verifiedAt);
  requireValue(
    Number.isFinite(signatureVerifiedAt)
      && capsuleIssuedAt <= signatureVerifiedAt
      && signatureVerifiedAt < capsuleExpiresAt,
    "signature receipt must be verified during the capsule validity window",
  );

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
    requireValue(capsule?.audience === plan?.destination?.proposedBodyLeaseId, "capsule audience must match the proposed body lease");
    requireValue((capsule?.sequence === 1) === (capsule?.predecessorDigest === null), "capsule lineage requires predecessorDigest exactly when sequence exceeds one");
    const bootstrapExpiresAt = Date.parse(plan?.destination?.bootstrapLease?.expiresAt);
    requireValue(
      Number.isFinite(bootstrapExpiresAt)
        && bootstrapExpiresAt > capsuleIssuedAt
        && bootstrapExpiresAt <= capsuleExpiresAt,
      "bootstrap lease must expire after capsule issue and no later than capsule expiry",
    );
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
    requireValue(capacityEvidenceSupplied, "ready verdict semantic validation requires the referenced capacity-evidence file");
    requireValue(capacityEvidenceReadError === null, capacityEvidenceReadError ?? "capacity evidence could not be read");
    if (capacityEvidence) {
      const capacityResult = validateCapacityEvidence(capacityEvidence);
      for (const error of capacityResult.errors) errors.push(`capacity evidence: ${error}`);
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
    requireValue((capsule?.unsupportedClaims ?? []).length === 0, "ready verdict forbids unsupported capsule claims");
    const requiredFacts = new Set(capsule?.requiredFactTypes ?? []);
    const satisfiedFacts = new Set(capsule?.satisfiedFactTypes ?? []);
    requireValue(requiredFacts.size === satisfiedFacts.size && [...requiredFacts].every((fact) => satisfiedFacts.has(fact)), "ready verdict requires every typed capsule fact");
    requireValue(capsule?.redemption?.state === "pending" && capsule?.redemption?.receipt === null, "ready verdict requires an unredeemed one-time capsule");
    requireValue(capsuleExpiresAt > capsuleIssuedAt, "capsule expiry must follow issue time");
  }

  const nativeVerdict = plan?.verdict === "NATIVE_RESUME_ELIGIBLE";
  const nativeMode = plan?.destination?.mode === "native-resume";
  requireValue(nativeVerdict === nativeMode, "native-resume mode and NATIVE_RESUME_ELIGIBLE verdict must be equivalent");
  if (nativeVerdict || nativeMode) {
    requireValue(plan?.destination?.nativeSessionLease?.required === true, "native resume requires native-session lease");
    requireValue(plan?.destination?.nativeSessionLease?.exclusive === true, "native-session lease must be exclusive");
    requireValue(Boolean(plan?.destination?.nativeSessionLease?.receipt), "native-session lease requires a receipt");
  }

  return { valid: errors.length === 0, errors };
}

function readJson(path, label) {
  try {
    return { value: JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8")), error: null };
  } catch (error) {
    return { value: null, error: `invalid ${label}: ${error.message}` };
  }
}

function runCli() {
  const planPath = process.argv[2];
  const capacityPath = process.argv[3];
  if (!planPath) {
    console.error("usage: node scripts/validate-resurrection-plan.mjs <plan.json> [capacity-evidence.json]");
    process.exit(2);
  }

  const planRead = readJson(planPath, "plan JSON");
  if (planRead.error) {
    console.error(JSON.stringify({ valid: false, errors: [planRead.error] }, null, 2));
    process.exit(1);
  }
  const capacityRead = capacityPath
    ? readJson(capacityPath, "capacity evidence")
    : { value: null, error: null };
  const result = validateResurrectionPlan(planRead.value, {
    capacityEvidence: capacityRead.value,
    capacityEvidenceSupplied: Boolean(capacityPath),
    capacityEvidenceReadError: capacityRead.error,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
