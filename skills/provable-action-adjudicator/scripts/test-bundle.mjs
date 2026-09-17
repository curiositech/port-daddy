#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdjudicationAudit } from "./validate-adjudication-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(resolve(root, "examples/static-verifier-audit.json"), "utf8"));
const copy = () => structuredClone(base);

const cases = [
  { id: "valid-static-blocked", document: copy(), valid: true },
  { id: "unknown-top-level", document: Object.assign(copy(), { surprise: true }), valid: false, finding: "not allowed" },
  { id: "authority-wrong-proposal", document: (() => { const d = copy(); d.authority.proposalDigest = `sha256:${"b".repeat(64)}`; return d; })(), valid: false, finding: "exact proposal" },
  { id: "requester-self-adjudicates", document: (() => { const d = copy(); d.decision.adjudicator = d.proposal.requester; return d; })(), valid: false, finding: "identity-disjoint" },
  { id: "deny-executes", document: (() => { const d = copy(); d.effect.executionState = "EXECUTED"; d.effect.effectReceiptDigest = `sha256:${"c".repeat(64)}`; return d; })(), valid: false, finding: "execution unreachable" },
  { id: "pass-with-unknowns", document: (() => { const d = copy(); d.status = "PASS"; d.claim.truthState = "STATIC_INSPECTED"; return d; })(), valid: false, finding: "PASS cannot retain unknowns" },
  { id: "witnessed-with-static-truth", document: (() => { const d = copy(); d.claim.level = "MEDIATION_WITNESSED"; d.claim.truthState = "STATIC_INSPECTED"; return d; })(), valid: false, finding: "DYNAMIC_WITNESSED" },
  { id: "allow-without-permit", document: (() => { const d = copy(); d.decision.verdict = "ALLOW"; d.decision.reasonCodes = ["policy_allow"]; return d; })(), valid: false, finding: "permit digest" },
  { id: "decision-after-effect", document: (() => { const d = copy(); d.decision.issuedBeforeEffect = false; return d; })(), valid: false, finding: "before effect" },
  { id: "duplicate-bypass-test", document: (() => { const d = copy(); d.bypassTests.push(structuredClone(d.bypassTests[0])); return d; })(), valid: false, finding: "must be unique" },
  { id: "missing-bypass-witness", document: (() => { const d = copy(); d.bypassTests[0].witnessId = "missing"; return d; })(), valid: false, finding: "independent VERIFIER_RUNNER" },
  { id: "dangling-inventory-witness", document: (() => { const d = copy(); d.mediationInventory[0].witnessId = "missing"; return d; })(), valid: false, finding: "existing witness" },
  { id: "failure-record-is-valid", document: (() => { const d = copy(); d.status = "FAIL"; d.bypassTests[0].passed = false; return d; })(), valid: true },
];

const failures = [];
for (const test of cases) {
  const errors = validateAdjudicationAudit(test.document);
  const actual = errors.length === 0;
  if (actual !== test.valid) failures.push(`${test.id}: expected valid=${test.valid}, got ${actual}: ${errors.join(" | ")}`);
  if (test.finding && !errors.some((error) => error.includes(test.finding))) failures.push(`${test.id}: missing expected finding ${test.finding}: ${errors.join(" | ")}`);
}

const result = { valid: failures.length === 0, cases: cases.length, failures };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
