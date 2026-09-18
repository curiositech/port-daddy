#!/usr/bin/env node

import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeFidelityDigest, validateFidelityLedger } from "./validate-fidelity-ledger.mjs";

const example = JSON.parse(readFileSync(fileURLToPath(new URL("../examples/source-bound-review.json", import.meta.url)), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const holderKeyId = "holder-key:P8-author";
const holderKeys = generateKeyPairSync("ed25519");
const trustedHolderKeys = new Map([[holderKeyId, {
  sourceHolder: example.targetPosition.sourceHolder,
  publicKeyPem: holderKeys.publicKey.export({ type: "spki", format: "pem" }),
}]]);
const signConfirmation = (value, privateKey = holderKeys.privateKey) => {
  value.confirmationReceipt.ledgerDigest = computeFidelityDigest(value);
  value.confirmationReceipt.signatureBase64 = sign(
    null,
    Buffer.from(value.confirmationReceipt.ledgerDigest, "utf8"),
    privateKey,
  ).toString("base64");
  return value;
};
const holderConfirmed = () => {
  const value = clone(example);
  value.verificationState = "HOLDER_CONFIRMED";
  value.confirmationReceipt = {
    confirmer: value.targetPosition.sourceHolder,
    signerKeyId: holderKeyId,
    signatureAlgorithm: "Ed25519",
    ledgerDigest: "pending",
    signatureBase64: "pending",
  };
  return signConfirmation(value);
};

const cases = [
  ["valid source-bound", example, true, new Map()],
  ["valid authenticated holder confirmation", holderConfirmed(), true, trustedHolderKeys],
  ["self-minted holder confirmation", holderConfirmed(), false, new Map()],
  ["forged holder signature", (() => { const x = holderConfirmed(); x.confirmationReceipt.signatureBase64 = Buffer.alloc(64, 7).toString("base64"); return x; })(), false, trustedHolderKeys],
  ["unknown top field", Object.assign(clone(example), { surprise: true }), false, new Map()],
  ["unlabeled provenance", (() => { const x = clone(example); delete x.propositions[0].provenance; return x; })(), false, new Map()],
  ["missing source locator", (() => { const x = clone(example); x.propositions[0].sourceLocator = ""; return x; })(), false, new Map()],
  ["missing falsifier", (() => { const x = clone(example); x.propositions[0].falsifier = ""; return x; })(), false, new Map()],
  ["false holder identity", (() => { const x = holderConfirmed(); x.confirmationReceipt.confirmer = "observer"; return signConfirmation(x); })(), false, trustedHolderKeys],
  ["mismatched holder digest", (() => { const x = holderConfirmed(); x.propositions[0].text = "Changed after confirmation."; return x; })(), false, trustedHolderKeys],
  ["duplicate proposition id", (() => { const x = clone(example); x.propositions.push(clone(x.propositions[0])); return x; })(), false, new Map()],
  ["source-bound claims endorsement", (() => { const x = clone(example); x.propositions[0].holderWouldEndorse = "YES"; return x; })(), false, new Map()],
  ["asymmetric reciprocal review", (() => { const x = clone(example); x.reciprocity.applied = false; return x; })(), false, new Map()],
  ["harmful persuasion not refused", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; return x; })(), false, new Map()],
  ["valid harmful refusal", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; x.terminalStatus = "REFUSED"; return x; })(), true, new Map()],
  ["supplemented without evidence", (() => { const x = clone(example); x.propositions[0].provenance = "supplemented"; x.propositions[0].evidence = []; return x; })(), false, new Map()],
];

const failures = [];
for (const [name, data, expected, keys] of cases) {
  const result = validateFidelityLedger(data, { trustedHolderKeys: keys });
  if (result.valid !== expected) failures.push({ name, expected, actual: result.valid, errors: result.errors });
}

console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
