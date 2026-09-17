#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion", "recordId", "identity", "authorities", "dimensions", "eligibility", "reservation", "admission", "effects", "settlement", "truthEffect", "runtimeAuthority"];
const ID = ["planDigest", "planRevision", "nodeId", "attemptId", "bodyGeneration", "principalId", "authorityEpoch", "repository", "targetDigest", "route", "providerProfile", "policyDigest"];
const AU = ["scheduler", "capacityBroker", "admissionWriter", "effectBoundary", "settlementAuthority"];
const DI = ["name", "unit", "source", "opening", "granted", "available", "reserved", "consumed", "held", "released", "settled", "stopProtected"];
const EL = ["commitId", "attemptId", "status", "schedulerId"];
const RE = ["commitId", "attemptId", "brokerId", "status", "oneUse", "expiresAt", "idempotencyKey"];
const AD = ["writerId", "eligibilityCommitId", "reservationCommitId", "status", "leaseId", "dispatchIntentDurable"];
const EF = ["effectId", "reservationCommitId", "status", "retryAuthority", "capacityHeld", "closureReceiptRef", "closureAuthorityId", "handoffId"];
const SE = ["profile", "authorityId", "outboxId", "status", "compensationEffectRef"];

function add(errors, condition, code, path) {
  if (condition) errors.push({ code, path });
}

function exact(value, fields, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({ code: "E_SHAPE", path });
    return;
  }
  for (const field of fields) add(errors, !(field in value), "E_REQUIRED", `${path}.${field}`);
  for (const field of Object.keys(value)) add(errors, !fields.includes(field), "E_UNKNOWN_FIELD", `${path}.${field}`);
}

export function validateConservedAttempt(record) {
  const errors = [];
  exact(record, TOP, "$", errors);
  if (errors.length) return errors;
  exact(record.identity, ID, "$.identity", errors);
  exact(record.authorities, AU, "$.authorities", errors);
  exact(record.eligibility, EL, "$.eligibility", errors);
  exact(record.reservation, RE, "$.reservation", errors);
  exact(record.admission, AD, "$.admission", errors);
  exact(record.settlement, SE, "$.settlement", errors);
  add(errors, record.schemaVersion !== "1.0.0", "E_VERSION", "$.schemaVersion");
  add(errors, record.truthEffect !== "NONE", "E_TRUTH_AUTHORITY", "$.truthEffect");
  add(errors, record.runtimeAuthority !== "NONE", "E_RUNTIME_AUTHORITY", "$.runtimeAuthority");

  const authorityIds = Object.values(record.authorities ?? {});
  add(errors, new Set(authorityIds).size !== authorityIds.length, "E_AUTHORITY_NOT_DISJOINT", "$.authorities");
  add(errors, record.eligibility.schedulerId !== record.authorities.scheduler, "E_SCHEDULER_BINDING", "$.eligibility.schedulerId");
  add(errors, record.reservation.brokerId !== record.authorities.capacityBroker, "E_BROKER_BINDING", "$.reservation.brokerId");
  add(errors, record.admission.writerId !== record.authorities.admissionWriter, "E_ADMISSION_BINDING", "$.admission.writerId");
  add(errors, record.settlement.authorityId !== record.authorities.settlementAuthority, "E_SETTLEMENT_BINDING", "$.settlement.authorityId");

  const names = new Set();
  for (const [index, dimension] of (record.dimensions ?? []).entries()) {
    exact(dimension, DI, `$.dimensions[${index}]`, errors);
    add(errors, names.has(dimension.name), "E_DUPLICATE_DIMENSION", `$.dimensions[${index}].name`);
    names.add(dimension.name);
    const numbers = ["opening", "granted", "available", "reserved", "consumed", "held", "released", "settled", "stopProtected"];
    add(errors, numbers.some((field) => !Number.isFinite(dimension[field]) || dimension[field] < 0), "E_INVALID_NATIVE_VALUE", `$.dimensions[${index}]`);
    const left = dimension.opening + dimension.granted;
    const right = dimension.available + dimension.reserved + dimension.consumed + dimension.held + dimension.released + dimension.settled;
    add(errors, Math.abs(left - right) > 1e-9, "E_CONSERVATION", `$.dimensions[${index}]`);
    add(errors, dimension.stopProtected > dimension.available + dimension.reserved, "E_STOP_RESERVE_EXPOSED", `$.dimensions[${index}].stopProtected`);
  }

  const attempt = record.identity.attemptId;
  add(errors, record.eligibility.attemptId !== attempt || record.reservation.attemptId !== attempt, "E_ATTEMPT_BINDING", "$.identity.attemptId");
  add(errors, record.reservation.oneUse !== true, "E_RESERVATION_REUSABLE", "$.reservation.oneUse");
  add(errors, record.admission.eligibilityCommitId !== record.eligibility.commitId, "E_ELIGIBILITY_JOIN", "$.admission.eligibilityCommitId");
  add(errors, record.admission.reservationCommitId !== record.reservation.commitId, "E_RESERVATION_JOIN", "$.admission.reservationCommitId");
  if (record.admission.status === "ADMITTED") {
    add(errors, record.eligibility.status !== "ELIGIBLE", "E_ADMIT_INELIGIBLE", "$.eligibility.status");
    add(errors, record.reservation.status !== "CONSUMED", "E_ADMIT_UNCONSUMED", "$.reservation.status");
    add(errors, !record.admission.leaseId, "E_LEASE_MISSING", "$.admission.leaseId");
    add(errors, record.admission.dispatchIntentDurable !== true, "E_DISPATCH_NOT_DURABLE", "$.admission.dispatchIntentDurable");
  } else {
    add(errors, record.admission.leaseId !== null || record.admission.dispatchIntentDurable, "E_UNADMITTED_DISPATCH", "$.admission");
  }

  for (const [index, effect] of (record.effects ?? []).entries()) {
    exact(effect, EF, `$.effects[${index}]`, errors);
    add(errors, effect.reservationCommitId !== record.reservation.commitId, "E_EFFECT_RESERVATION", `$.effects[${index}].reservationCommitId`);
    if (["AMBIGUOUS", "QUARANTINED_UNRESOLVED"].includes(effect.status)) {
      add(errors, effect.retryAuthority || !effect.capacityHeld, "E_AMBIGUITY_RELEASED", `$.effects[${index}]`);
    }
    if (effect.status === "CLOSED") {
      add(errors, !effect.closureReceiptRef, "E_CLOSURE_RECEIPT", `$.effects[${index}].closureReceiptRef`);
      add(errors, effect.closureAuthorityId !== record.authorities.effectBoundary, "E_EFFECT_AUTHORITY_BINDING", `$.effects[${index}].closureAuthorityId`);
    } else add(errors, effect.closureAuthorityId !== null, "E_EFFECT_AUTHORITY_ORPHAN", `$.effects[${index}].closureAuthorityId`);
    if (effect.handoffId) add(errors, effect.status !== "CLOSED", "E_HANDOFF_BEFORE_CLOSURE", `$.effects[${index}].handoffId`);
  }

  if (record.settlement.profile === "NO_SETTLEMENT") {
    add(errors, record.settlement.status !== "NOT_REQUIRED" || record.settlement.outboxId !== null || record.settlement.compensationEffectRef !== null, "E_NO_SETTLEMENT_EFFECT", "$.settlement");
    add(errors, record.effects.some((effect) => effect.handoffId !== null), "E_NO_SETTLEMENT_HANDOFF", "$.effects");
  } else {
    add(errors, !record.settlement.outboxId || record.settlement.status === "NOT_REQUIRED", "E_SETTLEMENT_HANDOFF", "$.settlement");
    add(errors, !record.effects.some((effect) => effect.status === "CLOSED" && effect.handoffId === record.settlement.outboxId), "E_SETTLEMENT_NOT_BOUND", "$.settlement.outboxId");
    if (record.settlement.status === "SETTLED") add(errors, !record.settlement.compensationEffectRef, "E_COMPENSATION_EFFECT_MISSING", "$.settlement.compensationEffectRef");
  }
  return errors.sort((a, b) => (a.code + a.path).localeCompare(b.code + b.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const record = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const errors = validateConservedAttempt(record);
    console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 2;
  }
}
