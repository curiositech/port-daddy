#!/usr/bin/env node

import { readFileSync } from "node:fs";

export function validateContract(data) {
  const errors = [];
  const exact = (value, keys, where) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${where}:object-required`); return; }
    const allowed = new Set(keys);
    for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${where}:unknown:${key}`);
  };
  const positive = (value, where, allowZero = false) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < (allowZero ? 0 : 1)) errors.push(`${where}:positive-finite-required`);
  };
  exact(data, ["schemaVersion", "kind", "contractId", "truthState", "intent", "plan", "topology", "authority", "limits", "nodes", "gathers", "reducers", "reservationPolicy", "leasePolicy", "messagePolicy", "reviewPolicy", "cancellationPolicy", "replayPolicy", "evidence", "terminalStatus"], "contract");
  if (data.schemaVersion !== "2.0.0" || data.kind !== "ControllerOwnedInvocationContract") errors.push("contract:version-or-kind");
  if (!['T0_STATIC','PROPOSED','UNKNOWN','BLOCKED_BY_HALT'].includes(data.truthState)) errors.push("truthState:invalid");
  if (data.terminalStatus === "STATIC_VALID" && !['T0_STATIC','PROPOSED'].includes(data.truthState)) errors.push("status:false-green");
  exact(data.intent, ["intentDigest", "objective", "completionPredicate", "excludedEffects"], "intent");
  exact(data.plan, ["digest", "revision", "limitDigest"], "plan");
  exact(data.topology, ["planning", "runtime", "supportStatus", "acceptanceRef"], "topology");
  if (!["EXACT", "NARROWED", "OMITTED", "BLOCKED"].includes(data.topology?.supportStatus)) errors.push("topology:support-status");
  if (data.topology?.supportStatus !== "EXACT" && !data.topology?.acceptanceRef) errors.push("topology:acceptance-required");
  exact(data.authority, ["admissionController", "capacityOwner", "lifecycleOwner", "effectOwner", "evidenceOwner", "reviewer"], "authority");
  const owners = Object.values(data.authority ?? {});
  if (owners.some((x) => typeof x !== "string" || !x) || new Set(owners).size !== owners.length) errors.push("authority:owners-not-distinct");
  exact(data.limits, ["maxConcurrency", "maxAttempts", "maxReworkRounds", "maxRecursiveBirths", "maxDurationMs", "maxMessageBytes", "resourceCeiling"], "limits");
  for (const key of ["maxConcurrency", "maxAttempts", "maxDurationMs", "maxMessageBytes"]) positive(data.limits?.[key], `limits:${key}`);
  if (data.limits?.maxReworkRounds !== 1) errors.push("limits:rework-must-equal-one");
  if (data.limits?.maxRecursiveBirths !== 0) errors.push("limits:recursive-birth-forbidden");
  exact(data.limits?.resourceCeiling, ["modelTokens", "providerUsd", "operatorAttentionSeconds"], "resourceCeiling");
  for (const key of ["modelTokens", "providerUsd", "operatorAttentionSeconds"]) positive(data.limits?.resourceCeiling?.[key], `resourceCeiling:${key}`, true);
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) errors.push("nodes:non-empty-required");
  const ids = new Set();
  for (const node of data.nodes ?? []) {
    exact(node, ["id", "type", "dependencies", "effectClass", "outputSchemaRef"], "node");
    if (ids.has(node.id)) errors.push(`node:duplicate:${node.id}`); ids.add(node.id);
    if (!["work", "evidence", "review", "gather", "terminal"].includes(node.type)) errors.push(`node:type:${node.id}`);
  }
  for (const node of data.nodes ?? []) for (const dep of node.dependencies ?? []) if (!ids.has(dep)) errors.push(`node:missing-dependency:${node.id}:${dep}`);
  const visiting = new Set(), visited = new Set();
  const byId = new Map((data.nodes ?? []).map((x) => [x.id, x]));
  const visit = (id) => { if (visiting.has(id)) { errors.push(`graph:cycle:${id}`); return; } if (visited.has(id)) return; visiting.add(id); for (const dep of byId.get(id)?.dependencies ?? []) visit(dep); visiting.delete(id); visited.add(id); };
  for (const id of ids) visit(id);
  const reducerIds = new Set((data.reducers ?? []).map((x) => x.id));
  for (const reducer of data.reducers ?? []) { exact(reducer, ["id", "version", "implementationDigest", "deterministic"], "reducer"); if (reducer.deterministic !== true) errors.push(`reducer:nondeterministic:${reducer.id}`); }
  for (const gather of data.gathers ?? []) { exact(gather, ["id", "members", "policy", "reducerId"], "gather"); if (!gather.members?.every((id) => ids.has(id))) errors.push(`gather:unknown-member:${gather.id}`); if (!reducerIds.has(gather.reducerId)) errors.push(`gather:missing-reducer:${gather.id}`); if (!["ALL", "QUORUM", "DEADLINE_PARTIAL"].includes(gather.policy)) errors.push(`gather:policy:${gather.id}`); }
  exact(data.reservationPolicy, ["planGrantIsCeiling", "bindingFields", "terminalDispositions"], "reservationPolicy");
  const bindings = new Set(data.reservationPolicy?.bindingFields ?? []);
  for (const field of ["planDigest", "planRevision", "nodeId", "attempt", "bodyGeneration", "route", "resourceVector", "expiresAt", "idempotencyKey"]) if (!bindings.has(field)) errors.push(`reservation:missing-binding:${field}`);
  if (data.reservationPolicy?.planGrantIsCeiling !== true) errors.push("reservation:plan-grant-not-ceiling");
  exact(data.leasePolicy, ["monotonicGeneration", "externalFence", "renewalRequiresReservation"], "leasePolicy");
  if (!Object.values(data.leasePolicy ?? {}).every((x) => x === true)) errors.push("lease:unsafe-policy");
  exact(data.messagePolicy, ["ephemeralKinds", "durableKinds", "authoritativeEphemeral"], "messagePolicy");
  if (data.messagePolicy?.authoritativeEphemeral !== false) errors.push("message:ephemeral-authority");
  exact(data.reviewPolicy, ["independentReviewer", "maxReworkRounds"], "reviewPolicy");
  if (data.reviewPolicy?.independentReviewer !== true || data.reviewPolicy?.maxReworkRounds !== 1) errors.push("review:independence-or-bound");
  exact(data.cancellationPolicy, ["ackDeadlineRequired", "fenceRequired", "terminationWitnessRequired", "providerReconciliationRequired"], "cancellationPolicy");
  if (!Object.values(data.cancellationPolicy ?? {}).every((x) => x === true)) errors.push("cancellation:incomplete");
  exact(data.replayPolicy, ["effectsDenied", "projections"], "replayPolicy");
  if (data.replayPolicy?.effectsDenied !== true) errors.push("replay:effects-not-denied");
  exact(data.evidence, ["staticLocators", "dynamicEvidence"], "evidence");
  if ((data.evidence?.dynamicEvidence ?? []).length > 0 && data.truthState === "T0_STATIC") errors.push("evidence:dynamic-in-static");
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [file] = process.argv.slice(2);
  if (!file) { console.error("usage: validate-swarm-invocation.mjs <contract.json>"); process.exit(2); }
  const report = validateContract(JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.valid ? 0 : 1;
}
