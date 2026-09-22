#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateContract } from "./validate-swarm-invocation.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const base = JSON.parse(readFileSync(join(here, "../examples/valid-static-contract.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(base));
const cases = [
  ["valid", base, true],
  ["unknown field", (() => { const x=clone(); x.surprise=true; return x; })(), false],
  ["missing gathers", (() => { const x=clone(); delete x.gathers; return x; })(), false],
  ["missing reducers", (() => { const x=clone(); delete x.reducers; return x; })(), false],
  ["missing intent field", (() => { const x=clone(); delete x.intent.completionPredicate; return x; })(), false],
  ["missing plan field", (() => { const x=clone(); delete x.plan.limitDigest; return x; })(), false],
  ["recursive birth", (() => { const x=clone(); x.limits.maxRecursiveBirths=1; return x; })(), false],
  ["unbounded rework", (() => { const x=clone(); x.reviewPolicy.maxReworkRounds=2; return x; })(), false],
  ["missing topology acceptance", (() => { const x=clone(); delete x.topology.acceptanceRef; return x; })(), false],
  ["authority collapse", (() => { const x=clone(); x.authority.reviewer=x.authority.admissionController; return x; })(), false],
  ["cycle", (() => { const x=clone(); x.nodes[0].dependencies=["gather"]; return x; })(), false],
  ["unknown gather member", (() => { const x=clone(); x.gathers[0].members.push("ghost"); return x; })(), false],
  ["nondeterministic reducer", (() => { const x=clone(); x.reducers[0].deterministic=false; return x; })(), false],
  ["missing reservation binding", (() => { const x=clone(); x.reservationPolicy.bindingFields=x.reservationPolicy.bindingFields.filter(v=>v!=="idempotencyKey"); return x; })(), false],
  ["ephemeral authority", (() => { const x=clone(); x.messagePolicy.authoritativeEphemeral=true; return x; })(), false],
  ["weak cancellation", (() => { const x=clone(); x.cancellationPolicy.providerReconciliationRequired=false; return x; })(), false],
  ["effectful replay", (() => { const x=clone(); x.replayPolicy.effectsDenied=false; return x; })(), false]
];
const failures=[];
for (const [name,data,expected] of cases) { const report=validateContract(data); if(report.valid!==expected) failures.push({name,expected,report}); }
console.log(JSON.stringify({valid:failures.length===0,cases:cases.length,failures},null,2));
process.exitCode=failures.length===0?0:1;
