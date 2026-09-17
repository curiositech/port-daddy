#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: validate-fidelity-ledger.mjs <ledger.json>");
  process.exit(2);
}

const data = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const exact = (value, keys, where) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${where} must be an object`);
    return;
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${where}.${key} is not allowed`);
};
const text = (value, where) => {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${where} must be non-empty text`);
};

exact(data, ["schemaVersion", "ledgerId", "requestedUse", "harmGate", "targetPosition", "propositions", "reciprocity", "verificationState", "confirmationReceipt", "unknowns", "terminalStatus"], "ledger");
if (data.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
text(data.ledgerId, "ledgerId");
if (!["UNDERSTAND", "RECIPROCAL_REVIEW", "CRITIQUE", "PERSUADE", "JUSTIFY"].includes(data.requestedUse)) errors.push("requestedUse is invalid");
exact(data.harmGate, ["classification", "rationale"], "harmGate");
if (!["SAFE", "BOUNDED_NEUTRAL_ONLY", "REFUSE_OPTIMIZATION"].includes(data.harmGate?.classification)) errors.push("harmGate.classification is invalid");
text(data.harmGate?.rationale, "harmGate.rationale");
exact(data.targetPosition, ["thesis", "audience", "scope", "burdenOfProof", "sourceHolder", "sourceCorpus"], "targetPosition");
for (const key of ["thesis", "audience", "scope", "burdenOfProof"]) text(data.targetPosition?.[key], `targetPosition.${key}`);
if (!Array.isArray(data.targetPosition?.sourceCorpus) || data.targetPosition.sourceCorpus.length === 0) errors.push("targetPosition.sourceCorpus must be non-empty");
if (!Array.isArray(data.propositions) || data.propositions.length === 0) errors.push("propositions must be non-empty");
for (const [index, proposition] of (data.propositions ?? []).entries()) {
  const where = `propositions[${index}]`;
  exact(proposition, ["id", "text", "provenance", "sourceLocator", "holderWouldEndorse", "confidence", "evidence", "falsifier"], where);
  if (!/^P[1-9][0-9]*$/.test(proposition.id ?? "")) errors.push(`${where}.id is invalid`);
  text(proposition.text, `${where}.text`);
  if (!["explicit", "inferred", "supplemented"].includes(proposition.provenance)) errors.push(`${where}.provenance is invalid`);
  text(proposition.sourceLocator, `${where}.sourceLocator`);
  if (!["YES", "NO", "UNKNOWN"].includes(proposition.holderWouldEndorse)) errors.push(`${where}.holderWouldEndorse is invalid`);
  if (typeof proposition.confidence !== "number" || proposition.confidence < 0 || proposition.confidence > 1) errors.push(`${where}.confidence must be 0..1`);
  if (!Array.isArray(proposition.evidence)) errors.push(`${where}.evidence must be an array`);
  for (const [evidenceIndex, evidence] of (proposition.evidence ?? []).entries()) {
    const evidenceWhere = `${where}.evidence[${evidenceIndex}]`;
    exact(evidence, ["claim", "locator", "relation"], evidenceWhere);
    text(evidence.claim, `${evidenceWhere}.claim`);
    text(evidence.locator, `${evidenceWhere}.locator`);
    if (!["SUPPORTS", "CONTRADICTS", "CONTEXT"].includes(evidence.relation)) errors.push(`${evidenceWhere}.relation is invalid`);
  }
  text(proposition.falsifier, `${where}.falsifier`);
  if (proposition.provenance === "supplemented" && proposition.evidence?.length === 0) errors.push(`${where} supplemented premise requires evidence`);
  if (proposition.holderWouldEndorse === "YES" && data.verificationState !== "HOLDER_CONFIRMED") errors.push(`${where} cannot claim holder endorsement without HOLDER_CONFIRMED`);
}
exact(data.reciprocity, ["applied", "standard"], "reciprocity");
if (typeof data.reciprocity?.applied !== "boolean") errors.push("reciprocity.applied must be boolean");
text(data.reciprocity?.standard, "reciprocity.standard");
if (data.requestedUse === "RECIPROCAL_REVIEW" && data.reciprocity?.applied !== true) errors.push("reciprocal review requires reciprocal standards");
if (!["DRAFT", "SOURCE_BOUND", "HOLDER_CONFIRMED"].includes(data.verificationState)) errors.push("verificationState is invalid");
if (data.verificationState === "HOLDER_CONFIRMED") {
  exact(data.confirmationReceipt, ["confirmer", "confirmerIsSourceHolder", "ledgerDigest"], "confirmationReceipt");
  text(data.confirmationReceipt?.confirmer, "confirmationReceipt.confirmer");
  if (data.confirmationReceipt?.confirmerIsSourceHolder !== true) errors.push("holder confirmation requires the actual source holder");
  if (!/^sha256:[a-f0-9]{64}$/.test(data.confirmationReceipt?.ledgerDigest ?? "")) errors.push("confirmationReceipt.ledgerDigest is invalid");
} else if (data.confirmationReceipt !== undefined) errors.push("confirmationReceipt is allowed only for HOLDER_CONFIRMED");
if (!Array.isArray(data.unknowns)) errors.push("unknowns must be an array");
if (!["VALID", "BLOCKED", "REFUSED"].includes(data.terminalStatus)) errors.push("terminalStatus is invalid");
if (data.harmGate?.classification === "REFUSE_OPTIMIZATION" && ["PERSUADE", "JUSTIFY"].includes(data.requestedUse) && data.terminalStatus !== "REFUSED") errors.push("harmful persuasion or justification must be refused");
if (data.terminalStatus === "VALID" && data.propositions?.some((item) => item.holderWouldEndorse === "NO")) errors.push("VALID cannot include a holder-rejected proposition");
console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
process.exitCode = errors.length === 0 ? 0 : 1;
