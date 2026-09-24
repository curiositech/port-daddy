#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdjudicationAudit } from "./validate-adjudication-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(resolve(root, "examples/static-verifier-audit.json"), "utf8"));
const schema = JSON.parse(readFileSync(resolve(root, "schemas/adjudication-audit.schema.json"), "utf8"));
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
  { id: "mediation-inventory-not-array", document: (() => { const d = copy(); d.mediationInventory = {}; return d; })(), valid: false, finding: "mediationInventory must be a non-empty array" },
  { id: "bypass-tests-not-array", document: (() => { const d = copy(); d.bypassTests = {}; return d; })(), valid: false, finding: "bypassTests must be a non-empty array" },
  { id: "witnesses-not-array", document: (() => { const d = copy(); d.witnesses = {}; return d; })(), valid: false, finding: "witnesses must be a non-empty array" },
  { id: "null-inventory-item", document: (() => { const d = copy(); d.mediationInventory = [null]; return d; })(), valid: false, finding: "must be an object" },
  { id: "null-bypass-test-item", document: (() => { const d = copy(); d.bypassTests = [null]; return d; })(), valid: false, finding: "must be an object" },
  { id: "null-witness-item", document: (() => { const d = copy(); d.witnesses = [null]; return d; })(), valid: false, finding: "must be an object" },
  { id: "numeric-reason-code", document: (() => { const d = copy(); d.decision.reasonCodes = [7]; return d; })(), valid: false, finding: "reasonCodes[0] must be a non-empty string" },
  { id: "numeric-unknown", document: (() => { const d = copy(); d.unknowns = [7]; return d; })(), valid: false, finding: "unknowns[0] must be a non-empty string" },
  { id: "non-string-bypass-case", document: (() => { const d = copy(); d.mediationInventory[0].bypassCases = [7]; return d; })(), valid: false, finding: "bypassCases[0] must be a non-empty string" },
  { id: "non-string-independent-principal", document: (() => { const d = copy(); d.witnesses[0].independentOf = [7]; return d; })(), valid: false, finding: "independentOf[0] must be a non-empty string" },
  { id: "lax-natural-language-expiry", document: (() => { const d = copy(); d.proposal.expiresAt = "September 24, 2026"; return d; })(), valid: false, finding: "RFC 3339 date-time" },
  { id: "invalid-calendar-expiry", document: (() => { const d = copy(); d.proposal.expiresAt = "2026-02-30T12:00:00Z"; return d; })(), valid: false, finding: "RFC 3339 date-time" },
  { id: "all-out-of-scope-cannot-claim-witnessed", document: (() => { const d = copy(); d.claim.level = "MEDIATION_WITNESSED"; d.claim.truthState = "DYNAMIC_WITNESSED"; d.mediationInventory.forEach((item) => { item.coverage = "OUT_OF_SCOPE"; item.witnessId = null; }); d.unknowns = []; d.status = "PASS"; return d; })(), valid: false, finding: "at least one externally witnessed in-scope effect class" },
  { id: "externally-witnessed-claim-shape-accepted", document: (() => { const d = copy(); d.claim.level = "MEDIATION_WITNESSED"; d.claim.truthState = "DYNAMIC_WITNESSED"; d.mediationInventory[0].coverage = "EXTERNALLY_WITNESSED"; d.mediationInventory[0].witnessId = "host-observer"; d.mediationInventory[1].coverage = "OUT_OF_SCOPE"; d.witnesses.push({ id: "host-observer", class: "HOST_OBSERVER", principal: "external-host", independentOf: [d.proposal.requester, d.effect.channelOwner], evidenceDigest: `sha256:${"b".repeat(64)}` }); d.unknowns = []; d.status = "PASS"; return d; })(), valid: true },
  { id: "valid-rfc3339-offset-expiry", document: (() => { const d = copy(); d.proposal.expiresAt = "2026-09-24T12:30:00+02:00"; return d; })(), valid: true },
];

const failures = [];
if (schema.properties.decision.properties.reasonCodes.items.type !== "string") failures.push("schema: reasonCodes items must be strings");
const witnessedRule = schema.allOf?.find((rule) => rule.if?.properties?.claim?.properties?.level?.const === "MEDIATION_WITNESSED");
if (witnessedRule?.then?.properties?.mediationInventory?.contains?.properties?.coverage?.const !== "EXTERNALLY_WITNESSED") failures.push("schema: MEDIATION_WITNESSED must require external witnessed coverage");
for (const test of cases) {
  const errors = validateAdjudicationAudit(test.document);
  const actual = errors.length === 0;
  if (actual !== test.valid) failures.push(`${test.id}: expected valid=${test.valid}, got ${actual}: ${errors.join(" | ")}`);
  if (test.finding && !errors.some((error) => error.includes(test.finding))) failures.push(`${test.id}: missing expected finding ${test.finding}: ${errors.join(" | ")}`);
}

const result = { valid: failures.length === 0, cases: cases.length, failures };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
