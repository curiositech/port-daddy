#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeFidelityDigest, validateFidelityLedger } from "./validate-fidelity-ledger.mjs";

const example = JSON.parse(readFileSync(fileURLToPath(new URL("../examples/source-bound-review.json", import.meta.url)), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const holderConfirmed = () => {
  const value = clone(example);
  value.verificationState = "HOLDER_CONFIRMED";
  value.confirmationReceipt = {
    confirmer: value.targetPosition.sourceHolder,
    confirmerIsSourceHolder: true,
    ledgerDigest: "pending",
  };
  value.confirmationReceipt.ledgerDigest = computeFidelityDigest(value);
  return value;
};

const cases = [
  ["valid source-bound", example, true],
  ["valid holder confirmation", holderConfirmed(), true],
  ["unknown top field", Object.assign(clone(example), { surprise: true }), false],
  ["unlabeled provenance", (() => { const x = clone(example); delete x.propositions[0].provenance; return x; })(), false],
  ["missing source locator", (() => { const x = clone(example); x.propositions[0].sourceLocator = ""; return x; })(), false],
  ["missing falsifier", (() => { const x = clone(example); x.propositions[0].falsifier = ""; return x; })(), false],
  ["false holder identity", (() => { const x = holderConfirmed(); x.confirmationReceipt.confirmer = "observer"; x.confirmationReceipt.ledgerDigest = computeFidelityDigest(x); return x; })(), false],
  ["mismatched holder digest", (() => { const x = holderConfirmed(); x.propositions[0].text = "Changed after confirmation."; return x; })(), false],
  ["duplicate proposition id", (() => { const x = clone(example); x.propositions.push(clone(x.propositions[0])); return x; })(), false],
  ["source-bound claims endorsement", (() => { const x = clone(example); x.propositions[0].holderWouldEndorse = "YES"; return x; })(), false],
  ["asymmetric reciprocal review", (() => { const x = clone(example); x.reciprocity.applied = false; return x; })(), false],
  ["harmful persuasion not refused", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; return x; })(), false],
  ["valid harmful refusal", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; x.terminalStatus = "REFUSED"; return x; })(), true],
  ["supplemented without evidence", (() => { const x = clone(example); x.propositions[0].provenance = "supplemented"; x.propositions[0].evidence = []; return x; })(), false],
];

const failures = [];
for (const [name, data, expected] of cases) {
  const result = validateFidelityLedger(data);
  if (result.valid !== expected) failures.push({ name, expected, actual: result.valid, errors: result.errors });
}

console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
