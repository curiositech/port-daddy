#!/usr/bin/env node
import fs from "node:fs";
import { validateAssessment } from "./validate-mechanism-assessment.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../examples/valid-no-settlement-assessment.json", import.meta.url), "utf8"));
const clone = () => structuredClone(base);
const cases = [
  ["valid", () => clone(), null],
  ["unknown", () => { const x = clone(); x.secure = true; return x; }, "E_UNKNOWN_FIELD"],
  ["fake number", () => { const x = clone(); x.scenarios[0].victimLoss.low = 0; x.scenarios[0].victimLoss.high = 0; return x; }, "E_UNKNOWN_PRETENDS_NUMERIC"],
  ["unsourced bound", () => { const x = clone(); x.scenarios[0].externality.sourceRefs = []; return x; }, "E_QUANTITY_UNSOURCED"],
  ["backward interval", () => { const x = clone(); x.scenarios[0].externality.low = 2; return x; }, "E_QUANTITY_RANGE"],
  ["shared settlement", () => { const x = clone(); x.authorities[1].controlDomain = "effects"; return x; }, "E_SETTLEMENT_NOT_DISJOINT"],
  ["green conflict", () => { const x = clone(); x.settlement.conflictTerminal = "SETTLED"; return x; }, "E_CONFLICT_GREEN"],
  ["compensation free", () => { const x = clone(); x.settlement.compensationRequiresNewEffect = false; return x; }, "E_COMPENSATION_NOT_EFFECT"],
  ["no-settlement evidence", () => { const x = clone(); x.settlement.evidenceClasses = ["oracle"] ; return x; }, "E_NO_SETTLEMENT_DRIFT"],
  ["missing defense", () => { const x = clone(); x.scenarios[0].defenseIds = ["missing"]; return x; }, "E_DEFENSE_REFERENCE"],
  ["unowned risk", () => { const x = clone(); x.scenarios[0].defenseIds = []; return x; }, "E_RISK_UNOWNED"],
  ["soft critical defense", () => { const x = clone(); x.scenarios[0].residualSeverity = "CRITICAL"; x.defenses[0].classes = ["ECONOMIC", "SOCIAL"]; return x; }, "E_HIGH_RISK_SOFT_DEFENSE_ONLY"],
  ["unfalsifiable defense", () => { const x = clone(); x.defenses[0].assumptions = []; return x; }, "E_DEFENSE_UNFALSIFIABLE"],
  ["runtime authority", () => { const x = clone(); x.runtimeAuthority = "ADMIT"; return x; }, "E_RUNTIME_AUTHORITY"],
  ["settle authority", () => { const x = clone(); x.settlementAuthority = "PAY"; return x; }, "E_SETTLEMENT_AUTHORITY"],
  ["legal conclusion", () => { const x = clone(); x.legalConclusion = "EMPLOYEE"; return x; }, "E_LEGAL_CONCLUSION"],
  ["truth mint", () => { const x = clone(); x.truthEffect = "SAFE"; return x; }, "E_TRUTH_AUTHORITY"]
];

const failures = [];
for (const [name, make, expected] of cases) {
  const codes = validateAssessment(make()).map((error) => error.code);
  if (expected === null ? codes.length !== 0 : !codes.includes(expected)) failures.push({ name, expected, codes });
}
console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
