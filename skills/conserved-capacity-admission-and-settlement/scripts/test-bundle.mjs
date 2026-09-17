#!/usr/bin/env node
import fs from "node:fs";
import { validateConservedAttempt } from "./validate-conserved-attempt.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../examples/valid-no-settlement-attempt.json", import.meta.url), "utf8"));
const clone = () => structuredClone(base);
const cases = [
  ["valid", () => clone(), null],
  ["unknown field", () => { const x = clone(); x.ship = true; return x; }, "E_UNKNOWN_FIELD"],
  ["shared authority", () => { const x = clone(); x.authorities.settlementAuthority = x.authorities.capacityBroker; x.settlement.authorityId = x.authorities.capacityBroker; return x; }, "E_AUTHORITY_NOT_DISJOINT"],
  ["scalar drift", () => { const x = clone(); x.dimensions[0].available = 1; return x; }, "E_CONSERVATION"],
  ["NaN capacity", () => { const x = clone(); x.dimensions[0].consumed = Number.NaN; return x; }, "E_INVALID_NATIVE_VALUE"],
  ["stop reserve spent", () => { const x = clone(); x.dimensions[1].stopProtected = 8; return x; }, "E_STOP_RESERVE_EXPOSED"],
  ["other attempt", () => { const x = clone(); x.reservation.attemptId = "attempt-2"; return x; }, "E_ATTEMPT_BINDING"],
  ["reusable reservation", () => { const x = clone(); x.reservation.oneUse = false; return x; }, "E_RESERVATION_REUSABLE"],
  ["unconsumed admission", () => { const x = clone(); x.reservation.status = "COMMITTED"; return x; }, "E_ADMIT_UNCONSUMED"],
  ["dispatch not durable", () => { const x = clone(); x.admission.dispatchIntentDurable = false; return x; }, "E_DISPATCH_NOT_DURABLE"],
  ["wrong reservation", () => { const x = clone(); x.effects[0].reservationCommitId = "other"; return x; }, "E_EFFECT_RESERVATION"],
  ["ambiguous retry", () => { const x = clone(); x.effects[0].status = "AMBIGUOUS"; x.effects[0].retryAuthority = true; x.effects[0].capacityHeld = false; x.effects[0].closureReceiptRef = null; return x; }, "E_AMBIGUITY_RELEASED"],
  ["closed without receipt", () => { const x = clone(); x.effects[0].closureReceiptRef = null; return x; }, "E_CLOSURE_RECEIPT"],
  ["free settlement", () => { const x = clone(); x.settlement.compensationEffectRef = "effect:pay"; return x; }, "E_NO_SETTLEMENT_EFFECT"],
  ["truth mint", () => { const x = clone(); x.truthEffect = "VERIFIED"; return x; }, "E_TRUTH_AUTHORITY"],
  ["runtime authority", () => { const x = clone(); x.runtimeAuthority = "ADMIT"; return x; }, "E_RUNTIME_AUTHORITY"]
];

const failures = [];
for (const [name, make, expected] of cases) {
  const codes = validateConservedAttempt(make()).map((error) => error.code);
  if (expected === null ? codes.length !== 0 : !codes.includes(expected)) failures.push({ name, expected, codes });
}
console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
