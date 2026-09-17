#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LEVELS = [
  "CONTRACT_PARSED",
  "VERIFIER_TESTED",
  "AUTHORITY_BOUND",
  "PRE_EFFECT_BOUND",
  "MEDIATION_INVENTORIED",
  "MEDIATION_WITNESSED",
];
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function keys(value, required, allowed, at, errors) {
  if (!object(value)) {
    errors.push(`${at} must be an object`);
    return false;
  }
  for (const key of required) if (!(key in value)) errors.push(`${at}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${at}.${key} is not allowed`);
  return true;
}

function string(value, at, errors) {
  if (typeof value !== "string" || value.length === 0) errors.push(`${at} must be a non-empty string`);
}

function digest(value, at, errors) {
  if (typeof value !== "string" || !DIGEST.test(value)) errors.push(`${at} must be a sha256 digest`);
}

function oneOf(value, choices, at, errors) {
  if (!choices.includes(value)) errors.push(`${at} must be one of ${choices.join(", ")}`);
}

export function validateAdjudicationAudit(doc) {
  const errors = [];
  const top = ["schemaVersion", "subject", "claim", "proposal", "authority", "decision", "effect", "mediationInventory", "bypassTests", "witnesses", "unknowns", "status"];
  if (!keys(doc, top, top, "$", errors)) return errors;
  if (doc.schemaVersion !== "1.0.0") errors.push("$.schemaVersion must equal 1.0.0");

  const subjectKeys = ["repo", "commit", "buildDigest", "boundaryId"];
  if (keys(doc.subject, subjectKeys, subjectKeys, "$.subject", errors)) {
    string(doc.subject.repo, "$.subject.repo", errors);
    if (typeof doc.subject.commit !== "string" || !/^[a-f0-9]{40}$/.test(doc.subject.commit)) errors.push("$.subject.commit must be a 40-character lowercase hex commit");
    digest(doc.subject.buildDigest, "$.subject.buildDigest", errors);
    string(doc.subject.boundaryId, "$.subject.boundaryId", errors);
  }

  const claimKeys = ["level", "statement", "truthState", "scope"];
  if (keys(doc.claim, claimKeys, claimKeys, "$.claim", errors)) {
    oneOf(doc.claim.level, LEVELS, "$.claim.level", errors);
    oneOf(doc.claim.truthState, ["STATIC_INSPECTED", "DYNAMIC_WITNESSED", "BLOCKED_BY_HALT"], "$.claim.truthState", errors);
    string(doc.claim.statement, "$.claim.statement", errors);
    string(doc.claim.scope, "$.claim.scope", errors);
  }

  const proposalKeys = ["digest", "requester", "principal", "bodyGeneration", "repo", "harbor", "operation", "targetDigest", "parametersDigest", "expiresAt", "idempotencyKey"];
  if (keys(doc.proposal, proposalKeys, proposalKeys, "$.proposal", errors)) {
    for (const key of ["digest", "targetDigest", "parametersDigest"]) digest(doc.proposal[key], `$.proposal.${key}`, errors);
    for (const key of ["requester", "principal", "repo", "harbor", "operation", "idempotencyKey"]) string(doc.proposal[key], `$.proposal.${key}`, errors);
    if (!Number.isInteger(doc.proposal.bodyGeneration) || doc.proposal.bodyGeneration < 0) errors.push("$.proposal.bodyGeneration must be a non-negative integer");
    if (typeof doc.proposal.expiresAt !== "string" || Number.isNaN(Date.parse(doc.proposal.expiresAt))) errors.push("$.proposal.expiresAt must be an ISO date-time");
  }

  const authorityKeys = ["receiptDigest", "proposalDigest", "issuer", "audience", "scopeDigest", "verified", "revocationChecked"];
  if (keys(doc.authority, authorityKeys, authorityKeys, "$.authority", errors)) {
    for (const key of ["receiptDigest", "proposalDigest", "scopeDigest"]) digest(doc.authority[key], `$.authority.${key}`, errors);
    string(doc.authority.issuer, "$.authority.issuer", errors);
    string(doc.authority.audience, "$.authority.audience", errors);
    if (typeof doc.authority.verified !== "boolean") errors.push("$.authority.verified must be boolean");
    if (typeof doc.authority.revocationChecked !== "boolean") errors.push("$.authority.revocationChecked must be boolean");
  }

  const decisionKeys = ["receiptDigest", "proposalDigest", "authorityReceiptDigest", "policyDigest", "stateDigest", "adjudicator", "verdict", "reasonCodes", "issuedBeforeEffect"];
  if (keys(doc.decision, decisionKeys, decisionKeys, "$.decision", errors)) {
    for (const key of ["receiptDigest", "proposalDigest", "authorityReceiptDigest", "policyDigest", "stateDigest"]) digest(doc.decision[key], `$.decision.${key}`, errors);
    string(doc.decision.adjudicator, "$.decision.adjudicator", errors);
    oneOf(doc.decision.verdict, ["ALLOW", "DENY", "INDETERMINATE"], "$.decision.verdict", errors);
    if (!Array.isArray(doc.decision.reasonCodes) || doc.decision.reasonCodes.length === 0) errors.push("$.decision.reasonCodes must be a non-empty array");
    if (typeof doc.decision.issuedBeforeEffect !== "boolean") errors.push("$.decision.issuedBeforeEffect must be boolean");
  }

  const effectKeys = ["channelOwner", "permitDigest", "redemptionState", "intentRecordedBeforeEffect", "executionState", "effectReceiptDigest", "reconciliationState"];
  if (keys(doc.effect, effectKeys, effectKeys, "$.effect", errors)) {
    string(doc.effect.channelOwner, "$.effect.channelOwner", errors);
    if (doc.effect.permitDigest !== null) digest(doc.effect.permitDigest, "$.effect.permitDigest", errors);
    if (doc.effect.effectReceiptDigest !== null) digest(doc.effect.effectReceiptDigest, "$.effect.effectReceiptDigest", errors);
    oneOf(doc.effect.redemptionState, ["NOT_APPLICABLE", "UNREDEEMED", "REDEEMED", "REPLAY_REJECTED"], "$.effect.redemptionState", errors);
    oneOf(doc.effect.executionState, ["NOT_EXECUTED", "EXECUTED", "AMBIGUOUS"], "$.effect.executionState", errors);
    oneOf(doc.effect.reconciliationState, ["NOT_REQUIRED", "SETTLED", "AMBIGUOUS", "UNOBSERVED"], "$.effect.reconciliationState", errors);
    if (typeof doc.effect.intentRecordedBeforeEffect !== "boolean") errors.push("$.effect.intentRecordedBeforeEffect must be boolean");
  }

  if (!Array.isArray(doc.mediationInventory) || doc.mediationInventory.length === 0) errors.push("$.mediationInventory must be non-empty");
  const inventoryIds = new Set();
  for (const [index, item] of (doc.mediationInventory ?? []).entries()) {
    const at = `$.mediationInventory[${index}]`;
    const itemKeys = ["effectClass", "boundary", "owner", "coverage", "witnessId", "bypassCases"];
    if (!keys(item, itemKeys, itemKeys, at, errors)) continue;
    for (const key of ["effectClass", "boundary", "owner"]) string(item[key], `${at}.${key}`, errors);
    oneOf(item.coverage, ["SOURCE_PRESENT", "EXTERNALLY_WITNESSED", "UNKNOWN", "OUT_OF_SCOPE"], `${at}.coverage`, errors);
    if (item.witnessId !== null) string(item.witnessId, `${at}.witnessId`, errors);
    if (!Array.isArray(item.bypassCases) || item.bypassCases.length === 0) errors.push(`${at}.bypassCases must be non-empty`);
    if (inventoryIds.has(item.effectClass)) errors.push(`${at}.effectClass must be unique`);
    inventoryIds.add(item.effectClass);
  }

  if (!Array.isArray(doc.bypassTests) || doc.bypassTests.length === 0) errors.push("$.bypassTests must be non-empty");
  for (const [index, test] of (doc.bypassTests ?? []).entries()) {
    const at = `$.bypassTests[${index}]`;
    const testKeys = ["id", "mutation", "expected", "observed", "passed", "witnessId"];
    if (!keys(test, testKeys, testKeys, at, errors)) continue;
    for (const key of ["id", "mutation", "expected", "observed", "witnessId"]) string(test[key], `${at}.${key}`, errors);
    if (typeof test.passed !== "boolean") errors.push(`${at}.passed must be boolean`);
  }

  if (!Array.isArray(doc.witnesses) || doc.witnesses.length === 0) errors.push("$.witnesses must be non-empty");
  const witnessIds = new Set();
  const witnessById = new Map();
  for (const [index, witness] of (doc.witnesses ?? []).entries()) {
    const at = `$.witnesses[${index}]`;
    const witnessKeys = ["id", "class", "principal", "independentOf", "evidenceDigest"];
    if (!keys(witness, witnessKeys, witnessKeys, at, errors)) continue;
    string(witness.id, `${at}.id`, errors);
    string(witness.principal, `${at}.principal`, errors);
    oneOf(witness.class, ["SOURCE_INSPECTOR", "VERIFIER_RUNNER", "HOST_OBSERVER", "PROVIDER_RECONCILER"], `${at}.class`, errors);
    if (!Array.isArray(witness.independentOf)) errors.push(`${at}.independentOf must be an array`);
    digest(witness.evidenceDigest, `${at}.evidenceDigest`, errors);
    if (witnessIds.has(witness.id)) errors.push(`${at}.id must be unique`);
    witnessIds.add(witness.id);
    witnessById.set(witness.id, witness);
  }

  if (!Array.isArray(doc.unknowns)) errors.push("$.unknowns must be an array");
  oneOf(doc.status, ["PASS", "FAIL", "BLOCKED"], "$.status", errors);

  if (object(doc.proposal) && object(doc.authority) && doc.authority.proposalDigest !== doc.proposal.digest) errors.push("authority must bind the exact proposal digest");
  if (object(doc.proposal) && object(doc.decision) && doc.decision.proposalDigest !== doc.proposal.digest) errors.push("decision must bind the exact proposal digest");
  if (object(doc.authority) && object(doc.decision) && doc.decision.authorityReceiptDigest !== doc.authority.receiptDigest) errors.push("decision must bind the exact authority receipt");
  if (object(doc.proposal) && object(doc.decision) && doc.proposal.requester === doc.decision.adjudicator) errors.push("requester and adjudicator must be identity-disjoint");
  if (object(doc.effect) && object(doc.proposal) && doc.effect.channelOwner === doc.proposal.requester) errors.push("requester cannot own the protected effect channel");
  if (object(doc.effect) && object(doc.decision) && doc.effect.channelOwner === doc.decision.adjudicator) errors.push("adjudicator cannot own the protected effect channel");
  if (object(doc.decision) && !doc.decision.issuedBeforeEffect) errors.push("decision must be issued before effect");

  if (object(doc.decision) && object(doc.effect) && doc.decision.verdict !== "ALLOW") {
    if (doc.effect.executionState !== "NOT_EXECUTED") errors.push("DENY or INDETERMINATE must make execution unreachable");
    if (doc.effect.permitDigest !== null) errors.push("DENY or INDETERMINATE cannot carry a permit");
    if (doc.effect.redemptionState !== "NOT_APPLICABLE") errors.push("DENY or INDETERMINATE redemption must be NOT_APPLICABLE");
  }
  if (object(doc.decision) && object(doc.effect) && doc.decision.verdict === "ALLOW") {
    if (doc.effect.permitDigest === null) errors.push("ALLOW requires an exact permit digest");
    if (doc.effect.executionState !== "NOT_EXECUTED" && doc.effect.redemptionState !== "REDEEMED") errors.push("executed or ambiguous ALLOW requires redeemed permit");
    if (doc.effect.executionState !== "NOT_EXECUTED" && !doc.effect.intentRecordedBeforeEffect) errors.push("intent must be recorded before transmission");
    if (doc.effect.executionState === "EXECUTED" && doc.effect.effectReceiptDigest === null) errors.push("executed effect requires a receipt digest");
  }

  const levelIndex = LEVELS.indexOf(doc.claim?.level);
  if (levelIndex >= LEVELS.indexOf("VERIFIER_TESTED") && (doc.bypassTests ?? []).length === 0) errors.push("VERIFIER_TESTED and above require bypass tests");
  if (levelIndex >= LEVELS.indexOf("AUTHORITY_BOUND") && (!doc.authority?.verified || !doc.authority?.revocationChecked)) errors.push("AUTHORITY_BOUND and above require verified, revocation-checked authority");
  if (doc.claim?.level === "MEDIATION_WITNESSED") {
    if (doc.claim.truthState !== "DYNAMIC_WITNESSED") errors.push("MEDIATION_WITNESSED requires DYNAMIC_WITNESSED truth state");
    for (const item of doc.mediationInventory ?? []) {
      if (!["EXTERNALLY_WITNESSED", "OUT_OF_SCOPE"].includes(item.coverage)) errors.push(`MEDIATION_WITNESSED cannot retain ${item.coverage} coverage for ${item.effectClass}`);
      if (item.coverage === "EXTERNALLY_WITNESSED") {
        const witness = witnessById.get(item.witnessId);
        if (!witness || !witness.independentOf?.includes(doc.proposal?.requester) || !witness.independentOf?.includes(doc.effect?.channelOwner)) errors.push(`witness for ${item.effectClass} must be independent of requester and channel owner`);
      }
    }
  }

  if (doc.status === "PASS") {
    if ((doc.unknowns ?? []).length > 0) errors.push("PASS cannot retain unknowns");
    if ((doc.bypassTests ?? []).some((test) => !test.passed)) errors.push("PASS requires every bypass test to pass");
  }
  if (doc.status === "BLOCKED" && (doc.unknowns ?? []).length === 0 && doc.claim?.truthState !== "BLOCKED_BY_HALT") errors.push("BLOCKED requires an unknown or BLOCKED_BY_HALT truth state");
  if (doc.claim?.truthState === "BLOCKED_BY_HALT" && doc.status === "PASS") errors.push("BLOCKED_BY_HALT cannot be PASS");

  return errors;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: validate-adjudication-audit.mjs <audit.json>");
    process.exit(2);
  }
  let document;
  try {
    document = JSON.parse(readFileSync(resolve(input), "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ valid: false, errors: [`cannot read JSON: ${error.message}`] }, null, 2));
    process.exit(1);
  }
  const errors = validateAdjudicationAudit(document);
  console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
