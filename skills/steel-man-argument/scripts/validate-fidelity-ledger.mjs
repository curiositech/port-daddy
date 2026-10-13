#!/usr/bin/env node

import { createHash, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUESTED_USES = ["UNDERSTAND", "RECIPROCAL_REVIEW", "CRITIQUE", "PERSUADE", "JUSTIFY"];
const HARM_CLASSES = ["SAFE", "BOUNDED_NEUTRAL_ONLY", "REFUSE_OPTIMIZATION"];
const VERIFICATION_STATES = ["DRAFT", "SOURCE_BOUND", "HOLDER_CONFIRMED"];
const TERMINAL_STATUSES = ["VALID", "BLOCKED", "REFUSED"];

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const computeFidelityDigest = (data) => {
  const unsigned = JSON.parse(JSON.stringify(data));
  if (unsigned.confirmationReceipt && typeof unsigned.confirmationReceipt === "object") {
    delete unsigned.confirmationReceipt.ledgerDigest;
    delete unsigned.confirmationReceipt.signatureBase64;
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(unsigned))).digest("hex")}`;
};

export const validateFidelityLedger = (data, { trustedHolderKeys = new Map() } = {}) => {
  const errors = [];
  const shape = (value, allowedKeys, requiredKeys, where) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${where} must be an object`);
      return false;
    }
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(`${where}.${key} is not allowed`);
    }
    for (const key of requiredKeys) {
      if (!Object.hasOwn(value, key)) errors.push(`${where}.${key} is required`);
    }
    return true;
  };
  const text = (value, where) => {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${where} must be non-empty text`);
  };

  shape(
    data,
    ["schemaVersion", "ledgerId", "requestedUse", "harmGate", "targetPosition", "propositions", "reciprocity", "verificationState", "confirmationReceipt", "unknowns", "terminalStatus"],
    ["schemaVersion", "ledgerId", "requestedUse", "harmGate", "targetPosition", "propositions", "reciprocity", "verificationState", "unknowns", "terminalStatus"],
    "ledger",
  );
  if (data?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  text(data?.ledgerId, "ledgerId");
  if (!REQUESTED_USES.includes(data?.requestedUse)) errors.push("requestedUse is invalid");

  shape(data?.harmGate, ["classification", "rationale"], ["classification", "rationale"], "harmGate");
  if (!HARM_CLASSES.includes(data?.harmGate?.classification)) errors.push("harmGate.classification is invalid");
  text(data?.harmGate?.rationale, "harmGate.rationale");

  shape(
    data?.targetPosition,
    ["thesis", "audience", "scope", "burdenOfProof", "sourceHolder", "sourceCorpus"],
    ["thesis", "audience", "scope", "burdenOfProof", "sourceCorpus"],
    "targetPosition",
  );
  for (const key of ["thesis", "audience", "scope", "burdenOfProof"]) {
    text(data?.targetPosition?.[key], `targetPosition.${key}`);
  }
  if (data?.targetPosition?.sourceHolder !== undefined) text(data.targetPosition.sourceHolder, "targetPosition.sourceHolder");
  if (!Array.isArray(data?.targetPosition?.sourceCorpus) || data.targetPosition.sourceCorpus.length === 0) {
    errors.push("targetPosition.sourceCorpus must be non-empty");
  } else {
    data.targetPosition.sourceCorpus.forEach((entry, index) => text(entry, `targetPosition.sourceCorpus[${index}]`));
  }

  if (!Array.isArray(data?.propositions) || data.propositions.length === 0) errors.push("propositions must be non-empty");
  const propositionIds = new Set();
  for (const [index, proposition] of (data?.propositions ?? []).entries()) {
    const where = `propositions[${index}]`;
    shape(
      proposition,
      ["id", "text", "provenance", "sourceLocator", "holderWouldEndorse", "confidence", "evidence", "falsifier"],
      ["id", "text", "provenance", "sourceLocator", "holderWouldEndorse", "confidence", "evidence", "falsifier"],
      where,
    );
    if (!/^P[1-9][0-9]*$/.test(proposition?.id ?? "")) errors.push(`${where}.id is invalid`);
    if (propositionIds.has(proposition?.id)) errors.push(`${where}.id must be unique`);
    propositionIds.add(proposition?.id);
    text(proposition?.text, `${where}.text`);
    if (!["explicit", "inferred", "supplemented"].includes(proposition?.provenance)) errors.push(`${where}.provenance is invalid`);
    text(proposition?.sourceLocator, `${where}.sourceLocator`);
    if (!["YES", "NO", "UNKNOWN"].includes(proposition?.holderWouldEndorse)) errors.push(`${where}.holderWouldEndorse is invalid`);
    if (!Number.isFinite(proposition?.confidence) || proposition.confidence < 0 || proposition.confidence > 1) {
      errors.push(`${where}.confidence must be a finite number from 0..1`);
    }
    if (!Array.isArray(proposition?.evidence)) errors.push(`${where}.evidence must be an array`);
    for (const [evidenceIndex, evidence] of (proposition?.evidence ?? []).entries()) {
      const evidenceWhere = `${where}.evidence[${evidenceIndex}]`;
      shape(evidence, ["claim", "locator", "relation"], ["claim", "locator", "relation"], evidenceWhere);
      text(evidence?.claim, `${evidenceWhere}.claim`);
      text(evidence?.locator, `${evidenceWhere}.locator`);
      if (!["SUPPORTS", "CONTRADICTS", "CONTEXT"].includes(evidence?.relation)) errors.push(`${evidenceWhere}.relation is invalid`);
    }
    text(proposition?.falsifier, `${where}.falsifier`);
    if (proposition?.provenance === "supplemented" && proposition.evidence?.length === 0) {
      errors.push(`${where} supplemented premise requires evidence`);
    }
    if (proposition?.holderWouldEndorse === "YES" && data?.verificationState !== "HOLDER_CONFIRMED") {
      errors.push(`${where} cannot claim holder endorsement without HOLDER_CONFIRMED`);
    }
  }

  shape(data?.reciprocity, ["applied", "standard"], ["applied", "standard"], "reciprocity");
  if (typeof data?.reciprocity?.applied !== "boolean") errors.push("reciprocity.applied must be boolean");
  text(data?.reciprocity?.standard, "reciprocity.standard");
  if (data?.requestedUse === "RECIPROCAL_REVIEW" && data?.reciprocity?.applied !== true) {
    errors.push("reciprocal review requires reciprocal standards");
  }

  if (!VERIFICATION_STATES.includes(data?.verificationState)) errors.push("verificationState is invalid");
  if (data?.verificationState === "HOLDER_CONFIRMED") {
    text(data?.targetPosition?.sourceHolder, "targetPosition.sourceHolder");
    shape(data?.confirmationReceipt, ["confirmer", "signerKeyId", "signatureAlgorithm", "ledgerDigest", "signatureBase64"], ["confirmer", "signerKeyId", "signatureAlgorithm", "ledgerDigest", "signatureBase64"], "confirmationReceipt");
    text(data?.confirmationReceipt?.confirmer, "confirmationReceipt.confirmer");
    text(data?.confirmationReceipt?.signerKeyId, "confirmationReceipt.signerKeyId");
    if (data?.confirmationReceipt?.confirmer !== data?.targetPosition?.sourceHolder) {
      errors.push("confirmationReceipt.confirmer must equal targetPosition.sourceHolder");
    }
    if (data?.confirmationReceipt?.signatureAlgorithm !== "Ed25519") errors.push("confirmationReceipt.signatureAlgorithm must equal Ed25519");
    if (!/^sha256:[a-f0-9]{64}$/.test(data?.confirmationReceipt?.ledgerDigest ?? "")) {
      errors.push("confirmationReceipt.ledgerDigest is invalid");
    } else if (data.confirmationReceipt.ledgerDigest !== computeFidelityDigest(data)) {
      errors.push("confirmationReceipt.ledgerDigest does not bind this exact ledger");
    }
    const trustedKey = trustedHolderKeys.get(data?.confirmationReceipt?.signerKeyId);
    if (!trustedKey || trustedKey.sourceHolder !== data?.targetPosition?.sourceHolder) {
      errors.push("confirmationReceipt.signerKeyId is not trusted for targetPosition.sourceHolder");
    } else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data?.confirmationReceipt?.signatureBase64 ?? "")) {
      errors.push("confirmationReceipt.signatureBase64 is invalid");
    } else {
      try {
        const authentic = verify(
          null,
          Buffer.from(data.confirmationReceipt.ledgerDigest, "utf8"),
          trustedKey.publicKeyPem,
          Buffer.from(data.confirmationReceipt.signatureBase64, "base64"),
        );
        if (!authentic) errors.push("confirmationReceipt signature is not authentic");
      } catch {
        errors.push("confirmationReceipt signature is not authentic");
      }
    }
  } else if (data?.confirmationReceipt !== undefined) {
    errors.push("confirmationReceipt is allowed only for HOLDER_CONFIRMED");
  }

  if (!Array.isArray(data?.unknowns)) {
    errors.push("unknowns must be an array");
  } else {
    data.unknowns.forEach((entry, index) => text(entry, `unknowns[${index}]`));
  }
  if (!TERMINAL_STATUSES.includes(data?.terminalStatus)) errors.push("terminalStatus is invalid");
  if (data?.harmGate?.classification === "REFUSE_OPTIMIZATION" && ["PERSUADE", "JUSTIFY"].includes(data?.requestedUse) && data?.terminalStatus !== "REFUSED") {
    errors.push("harmful persuasion or justification must be refused");
  }
  if (data?.terminalStatus === "VALID" && data?.propositions?.some((item) => item.holderWouldEndorse === "NO")) {
    errors.push("VALID cannot include a holder-rejected proposition");
  }

  return { valid: errors.length === 0, errors };
};

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const [file, trustFile] = process.argv.slice(2);
  if (!file) {
    console.error("usage: validate-fidelity-ledger.mjs <ledger.json> [trusted-holder-keys.json]");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const trustBundle = trustFile ? JSON.parse(readFileSync(trustFile, "utf8")) : { keys: [] };
  const trustedHolderKeys = new Map((trustBundle.keys ?? []).map((key) => [key.keyId, key]));
  const result = validateFidelityLedger(data, { trustedHolderKeys });
  console.log(JSON.stringify({ ...result, ledgerDigest: computeFidelityDigest(data) }, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}
