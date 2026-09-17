#!/usr/bin/env node
import fs from "node:fs";
import { validateEvaluation } from "./validate-trial-basin-evaluation.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../examples/valid-deterministic-fake-evaluation.json", import.meta.url), "utf8"));
const clone = () => structuredClone(base);
const cases = [
  ["valid", () => clone(), null],
  ["unknown", () => { const x = clone(); x.certified = true; return x; }, "E_UNKNOWN_FIELD"],
  ["invented truth state", () => { const x = clone(); x.truthState = "RUNTIME_PROVEN"; return x; }, "E_TRUTH_STATE"],
  ["self witness", () => { const x = clone(); x.roles.adjudicator.id = x.roles.oracle.id; return x; }, "E_ROLE_SELF_WITNESS"],
  ["shared control", () => { const x = clone(); x.roles.recorder.controlDomain = x.roles.scheduler.controlDomain; return x; }, "E_CONTROL_DOMAIN_COLLISION"],
  ["live under halt", () => { const x = clone(); x.environment = "LIVE_CONTAINED"; return x; }, "E_LIVE_UNDER_HALT"],
  ["no correspondence", () => { const x = clone(); x.model.correspondence = []; return x; }, "E_MODEL_CORRESPONDENCE"],
  ["fault gap", () => { const x = clone(); x.faults.faultIds = x.faults.faultIds.filter((id) => id !== "lost-ack"); return x; }, "E_FAULT_COVERAGE"],
  ["raw after minimization", () => { const x = clone(); x.evidence.committedBeforeMinimization = false; return x; }, "E_RAW_NOT_COMMITTED"],
  ["guest sole witness", () => { const x = clone(); x.evidence.guestSoleWitness = true; return x; }, "E_GUEST_SOLE_WITNESS"],
  ["negative missed", () => { const x = clone(); x.negativeControls[0].observedPredicate = "passed"; return x; }, "E_NEGATIVE_CONTROL_MISSED"],
  ["negative missing", () => { const x = clone(); x.negativeControls = []; return x; }, "E_NEGATIVE_CONTROL_MISSING"],
  ["oracle survivor", () => { const x = clone(); x.oracle.mutationKilled = 3; return x; }, "E_ORACLE_MUTATION_SURVIVED"],
  ["runtime pass from model", () => { const x = clone(); x.resultVector[1].status = "PASS"; x.resultVector[1].evidenceRefs = ["fake"]; return x; }, "E_EVIDENCE_CLASS_PROMOTION"],
  ["pass no evidence", () => { const x = clone(); x.resultVector[0].evidenceRefs = []; return x; }, "E_PASS_WITHOUT_EVIDENCE"],
  ["replay drift", () => { const x = clone(); x.replay.minimizedPredicate = "different"; return x; }, "E_REPLAY_PREDICATE_DRIFT"],
  ["runtime authority", () => { const x = clone(); x.runtimeAuthority = "CANARY"; return x; }, "E_RUNTIME_AUTHORITY"],
  ["truth mint", () => { const x = clone(); x.truthEffect = "CERTIFIED"; return x; }, "E_TRUTH_AUTHORITY"]
];

const failures = [];
for (const [name, make, expected] of cases) {
  const codes = validateEvaluation(make()).map((error) => error.code);
  if (expected === null ? codes.length !== 0 : !codes.includes(expected)) failures.push({ name, expected, codes });
}
console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
