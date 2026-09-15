#!/usr/bin/env node

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const executionPath = process.argv[2];
if (!executionPath) {
  console.error("usage: node skills/drydock-program-architecture/scripts/validate-hypertree-execution.mjs <execution.json|-> [hypertree.json]");
  process.exit(2);
}

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const planPath = process.argv[3] ?? resolve(skillRoot, "examples/drydock-resurrection-hypertree.json");

function parseJson(path) {
  return JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"));
}

let execution;
let plan;
try {
  execution = parseJson(executionPath);
  plan = parseJson(planPath);
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [`invalid JSON: ${error.message}`] }, null, 2));
  process.exit(1);
}

const errors = [];
function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function executionDigest(document) {
  const sealed = structuredClone(document);
  delete sealed.executionDigest;
  return `sha256:${createHash("sha256").update(canonicalJson(sealed)).digest("hex")}`;
}

function runtimeDefinition(document) {
  return {
    executionId: document.executionId,
    definitionDigest: document.definitionDigest,
    plan: document.plan,
    authorityModel: document.authorityModel,
    scopeNodeIds: document.scope?.nodeIds,
    nodeDependencies: document.scope?.dependencies,
    capacityBudgets: document.capacityBudgets,
    projectionSchema: document.contracts?.projectionSchema,
    nodeContracts: document.contracts?.nodeContracts,
    reviewPolicy: document.reviewPolicy,
    limits: document.limits,
    truthState: "FIXTURE",
    staleAfterSeconds: 300,
  };
}

function definitionDigest(document) {
  const sealed = runtimeDefinition(document);
  delete sealed.definitionDigest;
  return `sha256:${createHash("sha256").update(canonicalJson(sealed)).digest("hex")}`;
}

function evidencePrefixDigest(events) {
  let tip = "0".repeat(64);
  for (const event of events) {
    tip = createHash("sha256").update(tip).update(canonicalJson(event)).digest("hex");
  }
  return `sha256:${tip}`;
}

function sameMembers(left, right) {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function sameFindingRefs(left, right) {
  const sorted = (values) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return canonicalJson(sorted(left)) === canonicalJson(sorted(right));
}

function isDigest(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isEvidenceUri(value) {
  return typeof value === "string" && /^evidence:\/\/.+/.test(value);
}

function canonicalTimestampMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().replace(".000Z", "Z") === value ? parsed : null;
}

const expectedDigest = executionDigest(execution);
const expectedDefinitionDigest = definitionDigest(execution);
requireValue(execution?.schemaVersion === 1, "schemaVersion must be 1");
requireValue(execution?.kind === "DrydockHypertreeExecution", "kind must be DrydockHypertreeExecution");
requireValue(execution?.status === "fixture-static-design", "this validator accepts only the sealed fixture-static-design corpus");
requireValue(execution?.plan?.id === plan?.id, `execution plan id must match ${plan?.id}`);
requireValue(execution?.plan?.digest === plan?.artifactIdentity?.planDigest, "execution plan digest must match the exact hypertree planDigest");
requireValue(execution?.executionDigest === expectedDigest, `executionDigest mismatch; expected ${expectedDigest}`);
requireValue(
  execution?.definitionDigest === expectedDefinitionDigest,
  `definitionDigest mismatch; expected ${expectedDefinitionDigest}`,
);

const topology = execution?.plan?.topology ?? {};
requireValue(topology.eligibility === "dag", "eligibility topology must be dag");
requireValue(topology.qualityRouting === "bounded-workflow", "quality routing must be bounded-workflow");
requireValue(topology.staffing === "manager-driven-rounds", "staffing must be manager-driven-rounds");
requireValue(topology.observation === "append-only-event-projection", "observation must be append-only-event-projection");

requireValue(execution?.authorityModel?.eventAdmission === "controller-only", "only the controller may admit raw execution events");
requireValue(execution?.authorityModel?.projectionReducer === "controller-typescript", "the canonical reducer must remain controller-local TypeScript");
requireValue(execution?.authorityModel?.clientAuthority === "projection-only", "operator clients must remain projection-only");
requireValue(execution?.contracts?.reducerVersion === "drydock-hypertree-reducer.v1", "reducerVersion drift");
requireValue(
  execution?.contracts?.projectionUpdateSchema === "https://portdaddy.dev/schemas/hypertree-execution-projection-update.v1.json",
  "projection update schema drift",
);

const planNodes = new Map((plan?.nodes ?? []).map((node) => [node.id, node]));
const scopeNodeIds = execution?.scope?.nodeIds ?? [];
for (const nodeId of scopeNodeIds) requireValue(planNodes.has(nodeId), `scope references unknown plan node ${nodeId}`);
const dependencyEntries = execution?.scope?.dependencies ?? [];
const dependenciesByNode = new Map();
for (const entry of dependencyEntries) {
  requireValue(!dependenciesByNode.has(entry.nodeId), `duplicate dependency entry for ${entry.nodeId}`);
  dependenciesByNode.set(entry.nodeId, entry.dependsOnNodeIds ?? []);
  requireValue((entry.dependsOnNodeIds ?? []).every((nodeId) => scopeNodeIds.includes(nodeId)), `${entry.nodeId} has a dependency outside execution scope`);
  requireValue(!(entry.dependsOnNodeIds ?? []).includes(entry.nodeId), `${entry.nodeId} cannot depend on itself`);
  const plannedInternalDependencies = (planNodes.get(entry.nodeId)?.dependencies ?? [])
    .filter((nodeId) => scopeNodeIds.includes(nodeId));
  requireValue(sameMembers(entry.dependsOnNodeIds ?? [], plannedInternalDependencies), `${entry.nodeId} execution dependencies drift from the scoped plan frontier`);
}
requireValue(sameMembers(dependenciesByNode.keys(), scopeNodeIds), "dependency entries must cover exactly the execution scope");
const visitingDependencies = new Set();
const visitedDependencies = new Set();
function visitDependency(nodeId) {
  requireValue(!visitingDependencies.has(nodeId), `dependency graph contains a cycle at ${nodeId}`);
  if (visitingDependencies.has(nodeId) || visitedDependencies.has(nodeId)) return;
  visitingDependencies.add(nodeId);
  for (const dependencyId of dependenciesByNode.get(nodeId) ?? []) visitDependency(dependencyId);
  visitingDependencies.delete(nodeId);
  visitedDependencies.add(nodeId);
}
for (const nodeId of scopeNodeIds) visitDependency(nodeId);

const contracts = execution?.contracts?.nodeContracts ?? [];
const contractByNode = new Map();
for (const contract of contracts) {
  requireValue(!contractByNode.has(contract.nodeId), `duplicate node contract for ${contract.nodeId}`);
  contractByNode.set(contract.nodeId, contract);
  const node = planNodes.get(contract.nodeId);
  requireValue(Boolean(node), `contract references unknown plan node ${contract.nodeId}`);
  if (node) {
    requireValue(canonicalJson(contract.input?.requiredArtifactKinds) === canonicalJson(node.inputs), `contract ${contract.id} input kinds drift from ${contract.nodeId}`);
    requireValue(canonicalJson(contract.output?.requiredArtifactKinds) === canonicalJson(node.outputs), `contract ${contract.id} output kinds drift from ${contract.nodeId}`);
  }
}
requireValue(sameMembers(contractByNode.keys(), scopeNodeIds), "nodeContracts must cover exactly the execution scope");

const clients = execution?.clientBindings ?? [];
const clientKinds = clients.map((client) => client.implementation);
requireValue(sameMembers(clientKinds, ["html", "swift", "rust"]), "clientBindings must contain exactly one html, swift, and rust projection");
requireValue(new Set(clients.map((client) => client.id)).size === clients.length, "client binding ids must be unique");
for (const client of clients) {
  requireValue(client.authority === "projection-only", `client ${client.id} must remain projection-only`);
  requireValue(client.rawEventInput === "denied", `client ${client.id} may not consume raw lifecycle events`);
  requireValue(client.commandPath === "separate-signed-control-api", `client ${client.id} must use the separate signed control API`);
  requireValue(client.projectionSchema === execution?.contracts?.projectionSchema, `client ${client.id} projection schema drift`);
  requireValue(client.projectionUpdateSchema === execution?.contracts?.projectionUpdateSchema, `client ${client.id} projection update schema drift`);
}

const limits = execution?.limits ?? {};
requireValue(Number.isInteger(limits.maxScopeNodes) && limits.maxScopeNodes > 0 && limits.maxScopeNodes <= 500, "maxScopeNodes must be between 1 and 500");
requireValue(scopeNodeIds.length <= limits.maxScopeNodes, `scope exceeds maxScopeNodes ${limits.maxScopeNodes}`);
requireValue(Number.isInteger(limits.maxEvents) && limits.maxEvents > 0 && limits.maxEvents <= 10000, "maxEvents must be between 1 and 10000");
requireValue(Number.isInteger(limits.maxNodeStartsTotal) && limits.maxNodeStartsTotal > 0 && limits.maxNodeStartsTotal <= 1500, "maxNodeStartsTotal must be between 1 and 1500");
requireValue(Number.isInteger(limits.maxCapacityReservationsTotal) && limits.maxCapacityReservationsTotal > 0 && limits.maxCapacityReservationsTotal <= 5000, "maxCapacityReservationsTotal must be between 1 and 5000");
requireValue(Number.isInteger(limits.maxArtifactsPerOutput) && limits.maxArtifactsPerOutput > 0 && limits.maxArtifactsPerOutput <= 64, "maxArtifactsPerOutput must be between 1 and 64");
requireValue(Number.isInteger(limits.maxOutputBytesPerAttempt) && limits.maxOutputBytesPerAttempt > 0 && limits.maxOutputBytesPerAttempt <= 104857600, "maxOutputBytesPerAttempt must be between 1 and 104857600");
requireValue(limits.maxNodeAttempts <= 3, "maxNodeAttempts may not exceed 3");
requireValue(limits.maxReworkRounds <= 2, "maxReworkRounds may not exceed 2");
requireValue(limits.maxManagerRounds <= 3, "maxManagerRounds may not exceed 3");
requireValue(limits.maxTopologyMutations <= 3, "maxTopologyMutations may not exceed 3");
requireValue(limits.maxWallClockSeconds <= 21600, "maxWallClockSeconds may not exceed 21600");
requireValue(limits.maxRecursiveBirths === 0, "fixture execution must forbid recursive births");
requireValue(limits.retryOwner === "external-controller", "only the external controller may own retries");
requireValue(limits.retryLayers === 1, "retry authority must exist at exactly one layer");
requireValue((execution?.reviewPolicy?.floor?.requiredChecks ?? []).length <= 128, "required deterministic checks may not exceed 128");
for (const contract of contracts) {
  requireValue((contract.input?.requiredArtifactKinds ?? []).length <= 512, `${contract.id} input kinds may not exceed 512`);
  requireValue((contract.output?.requiredArtifactKinds ?? []).length <= limits.maxArtifactsPerOutput, `${contract.id} requires more output kinds than maxArtifactsPerOutput permits`);
}

const policy = execution?.reviewPolicy ?? {};
requireValue(policy.floor?.requiredBeforeReview === true, "deterministic floor checks must finish before review");
requireValue(policy.independentReview?.required === true, "independent review must be required");
requireValue(policy.independentReview?.reviewerMustDifferFromProducer === true, "reviewer must differ from producer");
requireValue(policy.specialistReview?.reservationUnit === "provider-native-units", "specialist review must reserve provider-native-units");
requireValue(policy.managerGate?.mayWaiveChecks === false, "manager may not waive checks");
requireValue(policy.managerGate?.maySelfApprove === false, "manager may not self-approve");
requireValue(policy.managerGate?.reservationUnit === "provider-native-units", "manager decisions must reserve provider-native-units");
requireValue(Number.isInteger(policy.managerGate?.maxUnitsPerDecision) && policy.managerGate.maxUnitsPerDecision > 0, "manager maxUnitsPerDecision must be positive");
requireValue(sameMembers(policy.managerGate?.requiredEvidence ?? [], [
  "schema-valid-output",
  "all-deterministic-checks-pass",
  "all-required-reviews-approve",
  "no-unresolved-blocking-findings",
]), "manager evidence policy must bind output, checks, reviews, and blocking-finding truth");

const nodeState = new Map(scopeNodeIds.map((nodeId) => [nodeId, {
  nodeId,
  dependsOnNodeIds: [...(dependenciesByNode.get(nodeId) ?? [])].sort(),
  attempt: 0,
  reworkRounds: 0,
  managerRound: 0,
  latestEventId: null,
  workerByAttempt: new Map(),
  assignmentManagerByAttempt: new Map(),
  producerIdentities: new Set(),
  reviewerIdentities: new Set(),
  managerIdentities: new Set(),
  outputByAttempt: new Map(),
  outputEventByAttempt: new Map(),
  workReservationIdsByAttempt: new Map(),
  checksByAttempt: new Map(),
  reviewByAttempt: new Map(),
  reviewerIdentitiesByAttempt: new Map(),
  reviewedClassesByAttempt: new Map(),
  approvedReviewerClassesByAttempt: new Map(),
  checkEventByAttempt: new Map(),
  reviewEventIdsByAttempt: new Map(),
  managerEventByAttempt: new Map(),
  reworkDirectiveByAttempt: new Map(),
  pendingReworkAttempt: null,
  pendingReworkDirective: null,
  managerDecision: null,
  state: "BLOCKED",
}]));

const events = execution?.events ?? [];
let runState = "OPEN";
let previousEventId = null;
let previousOccurredAt = null;
let runOpened = false;
let runCompleted = false;
let runOpenedAt = null;
const eventIds = new Set();
const findingOccurrences = new Map();
let topologyMutations = 0;
let nodeStartsTotal = 0;
const reservationsById = new Map();
const reservationIdByIdempotencyKey = new Map();
const settledReservationIds = new Set();
const capacityUsageByBudget = new Map();
const capacityAuthorityTuples = new Set();
requireValue((execution?.capacityBudgets ?? []).length <= 64, "capacityBudgets may not exceed 64 entries");
for (const budget of execution?.capacityBudgets ?? []) {
  requireValue(typeof budget?.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(budget.id), "capacity budget id must be a slug");
  requireValue(typeof budget?.providerId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(budget.providerId), `${budget?.id ?? "capacity budget"} providerId must be a slug`);
  requireValue(typeof budget?.accountRef === "string" && /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/.test(budget.accountRef), `${budget?.id ?? "capacity budget"} accountRef is invalid`);
  requireValue(typeof budget?.unit === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(budget.unit), `${budget?.id ?? "capacity budget"} unit must be a slug`);
  requireValue(Number.isInteger(budget?.maxReservedUnits) && budget.maxReservedUnits > 0 && budget.maxReservedUnits <= 1000000000, `${budget?.id ?? "capacity budget"} maxReservedUnits is invalid`);
  requireValue(!capacityUsageByBudget.has(budget?.id), `duplicate capacity budget ${budget?.id}`);
  const authorityTuple = canonicalJson([budget?.providerId, budget?.accountRef, budget?.unit]);
  requireValue(!capacityAuthorityTuples.has(authorityTuple), `${budget?.id ?? "capacity budget"} aliases an existing provider/account/unit authority`);
  capacityAuthorityTuples.add(authorityTuple);
  if (budget?.id) {
    capacityUsageByBudget.set(budget.id, {
      budget,
      reservedUnits: 0,
      heldUnits: 0,
      usedUnits: 0,
      reservationCount: 0,
    });
  }
}
requireValue(capacityUsageByBudget.size > 0, "capacityBudgets must be non-empty");

function admitReservation(reservation, expected, occurredAt, label) {
  requireValue(reservation && typeof reservation === "object" && !Array.isArray(reservation), `${label} must be an object`);
  if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) return;
  requireValue(typeof reservation.id === "string" && /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/.test(reservation.id), `${label}.id is invalid`);
  requireValue(typeof reservation.idempotencyKey === "string" && /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/.test(reservation.idempotencyKey), `${label}.idempotencyKey is invalid`);
  requireValue(reservation.purpose === expected.purpose, `${label}.purpose must be ${expected.purpose}`);
  requireValue(reservation.executionId === execution.executionId, `${label}.executionId drift`);
  requireValue(reservation.nodeId === expected.nodeId, `${label}.nodeId drift`);
  requireValue(reservation.attempt === expected.attempt, `${label}.attempt drift`);
  requireValue(Number.isInteger(reservation.reservedUnits) && reservation.reservedUnits > 0, `${label}.reservedUnits must be positive`);
  requireValue(isDigest(reservation.receiptDigest), `${label}.receiptDigest must be sha256`);
  requireValue(isEvidenceUri(reservation.evidenceUri), `${label}.evidenceUri must use evidence://`);
  const expiresAt = canonicalTimestampMs(reservation.expiresAt);
  requireValue(expiresAt !== null, `${label}.expiresAt must be canonical UTC`);
  requireValue(expiresAt !== null && occurredAt !== null && expiresAt > occurredAt, `${label} is expired`);
  requireValue(
    expiresAt !== null && runOpenedAt !== null && expiresAt <= runOpenedAt + limits.maxWallClockSeconds * 1000,
    `${label} expiry exceeds the sealed run wall-clock`,
  );
  requireValue(!reservationsById.has(reservation.id), `${label}.id was already consumed`);
  requireValue(!reservationIdByIdempotencyKey.has(reservation.idempotencyKey), `${label}.idempotencyKey was already consumed`);
  requireValue(reservationsById.size + 1 <= limits.maxCapacityReservationsTotal, "execution exceeds maxCapacityReservationsTotal");
  const usage = capacityUsageByBudget.get(reservation.budgetId);
  requireValue(Boolean(usage), `${label} references undeclared capacity budget ${reservation.budgetId}`);
  if (!usage || reservationsById.has(reservation.id) || reservationIdByIdempotencyKey.has(reservation.idempotencyKey)) return;
  requireValue(usage.reservedUnits + reservation.reservedUnits <= usage.budget.maxReservedUnits, `${label} exceeds budget ${reservation.budgetId}`);
  usage.reservedUnits += reservation.reservedUnits;
  usage.heldUnits += reservation.reservedUnits;
  usage.reservationCount += 1;
  reservationsById.set(reservation.id, structuredClone(reservation));
  reservationIdByIdempotencyKey.set(reservation.idempotencyKey, reservation.id);
}

function settleReservation(settlement, expected, label) {
  requireValue(settlement && typeof settlement === "object" && !Array.isArray(settlement), `${label} must be an object`);
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) return;
  requireValue(settlement.reservationId === expected.reservationId, `${label}.reservationId drift`);
  requireValue(["CONSUMED", "RELEASED", "UNKNOWN"].includes(settlement.outcome), `${label}.outcome is invalid`);
  requireValue(Number.isInteger(settlement.usedUnits) && settlement.usedUnits >= 0, `${label}.usedUnits must be non-negative`);
  requireValue(isDigest(settlement.receiptDigest), `${label}.receiptDigest must be sha256`);
  requireValue(isEvidenceUri(settlement.evidenceUri), `${label}.evidenceUri must use evidence://`);
  const reservation = reservationsById.get(settlement.reservationId);
  requireValue(Boolean(reservation), `${label} references an unknown reservation`);
  if (!reservation) return;
  requireValue(reservation.nodeId === expected.nodeId && reservation.attempt === expected.attempt, `${label} crosses a node or attempt boundary`);
  requireValue(!settledReservationIds.has(settlement.reservationId), `${label} settles a reservation twice`);
  if (settlement.outcome === "RELEASED") requireValue(settlement.usedUnits === 0, `${label} RELEASED must use zero units`);
  if (settlement.outcome === "UNKNOWN") requireValue(settlement.usedUnits === reservation.reservedUnits, `${label} UNKNOWN must charge the full reservation`);
  if (settlement.outcome === "CONSUMED") requireValue(settlement.usedUnits <= reservation.reservedUnits, `${label} used more than reserved`);
  if (settledReservationIds.has(settlement.reservationId)) return;
  const usage = capacityUsageByBudget.get(reservation.budgetId);
  requireValue(Boolean(usage), `${label} budget disappeared`);
  if (!usage) return;
  usage.heldUnits -= reservation.reservedUnits;
  usage.usedUnits += settlement.usedUnits;
  settledReservationIds.add(settlement.reservationId);
}

function registerRework(state, contract, eventId, findings, requiredArtifactKinds, targetAttempt) {
  requireValue(targetAttempt === state.attempt + 1, `${state.nodeId} rework target attempt must be ${state.attempt + 1}`);
  requireValue(targetAttempt <= limits.maxNodeAttempts, `${state.nodeId} exceeds maxNodeAttempts`);
  requireValue(state.reworkRounds + 1 <= limits.maxReworkRounds, `${state.nodeId} exceeds maxReworkRounds`);
  requireValue(requiredArtifactKinds.every((kind) => contract?.output?.requiredArtifactKinds?.includes(kind)), `${state.nodeId} rework requires an artifact kind outside its output contract`);
  for (const findingId of findings.map((finding) => finding.id)) {
    const occurrences = (findingOccurrences.get(findingId) ?? 0) + 1;
    findingOccurrences.set(findingId, occurrences);
    requireValue(occurrences <= policy.rework?.sameFindingRepeatLimit, `${state.nodeId} finding ${findingId} exceeds sameFindingRepeatLimit`);
  }
  state.reworkRounds += 1;
  state.pendingReworkAttempt = targetAttempt;
  state.pendingReworkDirective = {
    eventId,
    findings: structuredClone(findings),
    requiredArtifactKinds: [...requiredArtifactKinds],
  };
  state.state = "REWORK_REQUIRED";
}

function refreshEligibility() {
  for (const state of nodeState.values()) {
    if (state.state !== "BLOCKED" || state.attempt !== 0) continue;
    if (state.dependsOnNodeIds.every((dependencyId) => nodeState.get(dependencyId)?.state === "APPROVED")) {
      state.state = "ELIGIBLE";
    }
  }
}

const witnessClassByType = {
  RUN_OPENED: "HOST_OBSERVED",
  NODE_STARTED: "HOST_OBSERVED",
  OUTPUT_PRODUCED: "GUEST_ASSERTED",
  CHECKS_COMPLETED: "HOST_OBSERVED",
  REVIEW_COMPLETED: "MODEL_CHECKED",
  REWORK_REQUESTED: "HOST_OBSERVED",
  MANAGER_DECIDED: "MODEL_CHECKED",
  NODE_APPROVED: "HOST_OBSERVED",
  RUN_COMPLETED: "HOST_OBSERVED",
};

for (const [index, event] of events.entries()) {
  const expectedSequence = index + 1;
  requireValue(Buffer.byteLength(canonicalJson(event), "utf8") <= 1048576, `event ${event.eventId} exceeds the 1 MiB canonical envelope ceiling`);
  requireValue(event.sequence <= limits.maxEvents, `event ${event.eventId} exceeds maxEvents ${limits.maxEvents}`);
  requireValue(!eventIds.has(event.eventId), `duplicate event id ${event.eventId}`);
  eventIds.add(event.eventId);
  requireValue(event.sequence === expectedSequence, `event ${event.eventId} sequence must be ${expectedSequence}`);
  requireValue(event.previousEventId === previousEventId, `event ${event.eventId} previousEventId must be ${previousEventId}`);
  const occurredAt = canonicalTimestampMs(event.occurredAt);
  requireValue(occurredAt !== null, `event ${event.eventId} occurredAt must be canonical UTC`);
  if (previousOccurredAt !== null && occurredAt !== null) {
    requireValue(occurredAt >= previousOccurredAt, `event ${event.eventId} occurredAt moves backward`);
  }
  if (occurredAt !== null) previousOccurredAt = occurredAt;
  requireValue(!runCompleted, `event ${event.eventId} occurs after RUN_COMPLETED`);
  requireValue(runState !== "HALTED", `event ${event.eventId} occurs after the run halted`);
  requireValue(event.witnessClass === witnessClassByType[event.type], `${event.eventId} has the wrong witness class for ${event.type}`);
  previousEventId = event.eventId;

  if (event.type === "RUN_OPENED") {
    requireValue(index === 0 && !runOpened, "RUN_OPENED must be the first and only opening event");
    requireValue(event.payload?.planDigest === execution?.plan?.digest, "RUN_OPENED planDigest drift");
    requireValue(event.payload?.definitionDigest === execution?.definitionDigest, "RUN_OPENED definitionDigest drift");
    requireValue(sameMembers(event.payload?.scopeNodeIds ?? [], scopeNodeIds), "RUN_OPENED scope must match execution scope");
    runOpened = true;
    runOpenedAt = occurredAt;
    runState = "RUNNING";
    refreshEligibility();
    continue;
  }

  if (event.type === "RUN_COMPLETED") {
    requireValue(runOpened && !runCompleted, "RUN_COMPLETED requires one open run");
    requireValue(sameMembers(event.payload?.terminalNodeIds ?? [], scopeNodeIds), "RUN_COMPLETED terminal nodes must match scope");
    requireValue([...nodeState.values()].every((node) => node.state === "APPROVED"), "RUN_COMPLETED requires every scoped node to be APPROVED");
    requireValue([...capacityUsageByBudget.values()].every((usage) => usage.heldUnits === 0), "RUN_COMPLETED requires every capacity reservation to be settled");
    requireValue(
      event.payload?.evidenceRoot === evidencePrefixDigest(events.slice(0, index)),
      "RUN_COMPLETED evidenceRoot must bind the exact admitted event prefix",
    );
    runCompleted = true;
    runState = "COMPLETED";
    continue;
  }

  requireValue(runOpened, `event ${event.eventId} requires RUN_OPENED`);

  const state = nodeState.get(event.nodeId);
  requireValue(Boolean(state), `event ${event.eventId} references node outside execution scope: ${event.nodeId}`);
  if (!state) continue;
  state.latestEventId = event.eventId;

  if (event.type === "NODE_STARTED") {
    const expectedAttempt = state.attempt + 1;
    const requiredState = expectedAttempt === 1 ? "ELIGIBLE" : "REWORK_REQUIRED";
    requireValue(state.state === requiredState, `${event.nodeId} cannot start attempt ${expectedAttempt} from ${state.state}`);
    requireValue(event.attempt === expectedAttempt, `${event.nodeId} attempt must advance from ${state.attempt} to ${expectedAttempt}`);
    requireValue(event.attempt <= limits.maxNodeAttempts, `${event.nodeId} exceeds maxNodeAttempts`);
    if (event.attempt > 1) {
      requireValue(state.pendingReworkAttempt === event.attempt, `${event.nodeId} attempt ${event.attempt} lacks a matching rework directive`);
      requireValue(Boolean(state.pendingReworkDirective), `${event.nodeId} attempt ${event.attempt} lacks rework evidence`);
    }
    requireValue(event.payload?.assignment?.round === state.managerRound + 1, `${event.nodeId} assignment round must advance exactly once`);
    requireValue(event.payload?.assignment?.round <= limits.maxManagerRounds, `${event.nodeId} exceeds maxManagerRounds`);
    requireValue(typeof event.payload?.assignment?.managerIdentity === "string" && event.payload.assignment.managerIdentity !== event.payload?.workerIdentity, `${event.nodeId} assignment manager must differ from worker`);
    requireValue(!state.producerIdentities.has(event.payload?.assignment?.managerIdentity) && !state.reviewerIdentities.has(event.payload?.assignment?.managerIdentity), `${event.nodeId} assignment manager previously held producer or reviewer authority`);
    requireValue(typeof event.payload?.assignment?.roleId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.payload.assignment.roleId), `${event.nodeId} assignment roleId must be a slug`);
    requireValue(isDigest(event.payload?.assignment?.receiptDigest), `${event.nodeId} assignment receiptDigest must be sha256`);
    requireValue(isEvidenceUri(event.payload?.assignment?.evidenceUri), `${event.nodeId} assignment evidenceUri must use evidence://`);
    nodeStartsTotal += 1;
    requireValue(nodeStartsTotal <= limits.maxNodeStartsTotal, `execution exceeds maxNodeStartsTotal ${limits.maxNodeStartsTotal}`);
    requireValue(event.payload?.input?.planDigest === execution?.plan?.digest, `${event.nodeId} input planDigest drift`);
    requireValue(event.payload?.input?.definitionDigest === execution?.definitionDigest, `${event.nodeId} input definitionDigest drift`);
    requireValue(event.payload?.input?.nodeContractId === contractByNode.get(event.nodeId)?.id, `${event.nodeId} input uses the wrong node contract`);
    const inputArtifacts = event.payload?.input?.artifacts ?? [];
    requireValue(inputArtifacts.length <= 512, `${event.nodeId} input exceeds 512 artifacts`);
    const inputArtifactIds = inputArtifacts.map((artifact) => artifact.id);
    const inputArtifactKinds = inputArtifacts.map((artifact) => artifact.kind);
    requireValue(new Set(inputArtifactIds).size === inputArtifactIds.length, `${event.nodeId} input artifact ids must be unique`);
    requireValue(sameMembers(inputArtifactKinds, contractByNode.get(event.nodeId)?.input?.requiredArtifactKinds ?? []), `${event.nodeId} input artifacts do not exactly satisfy its contract`);
    const priorArtifactIds = event.payload?.input?.priorAttemptArtifactIds ?? [];
    if (expectedAttempt === 1) {
      requireValue(priorArtifactIds.length === 0, `${event.nodeId} first attempt may not claim prior-attempt artifacts`);
      requireValue(event.payload?.input?.reworkDirective === null, `${event.nodeId} first attempt may not carry a rework directive`);
    } else {
      const priorOutputIds = (state.outputByAttempt.get(expectedAttempt - 1)?.artifacts ?? []).map((artifact) => artifact.id);
      requireValue(sameMembers(priorArtifactIds, priorOutputIds), `${event.nodeId} rework input must bind the exact prior-attempt artifacts`);
      requireValue(canonicalJson(event.payload?.input?.reworkDirective) === canonicalJson(state.pendingReworkDirective), `${event.nodeId} rework input must bind the exact directive`);
    }
    const capacityReservations = event.payload?.input?.capacityReservations ?? [];
    requireValue(capacityReservations.length > 0, `${event.nodeId} must carry at least one work capacity reservation`);
    requireValue(capacityReservations.length <= 64, `${event.nodeId} work reservations exceed the capacity-budget ceiling`);
    requireValue(new Set(capacityReservations.map((reservation) => reservation.budgetId)).size === capacityReservations.length, `${event.nodeId} may reserve a capacity budget only once per attempt`);
    for (const [reservationIndex, reservation] of capacityReservations.entries()) {
      admitReservation(
        reservation,
        { purpose: "work", nodeId: event.nodeId, attempt: event.attempt },
        occurredAt,
        `${event.nodeId} work reservation ${reservationIndex}`,
      );
    }
    requireValue(!state.reviewerIdentities.has(event.payload?.workerIdentity) && !state.managerIdentities.has(event.payload?.workerIdentity), `${event.nodeId} worker previously held review or manager authority`);
    const activeDirective = state.pendingReworkDirective ? structuredClone(state.pendingReworkDirective) : null;
    state.attempt = event.attempt;
    state.managerRound = event.payload?.assignment?.round;
    state.pendingReworkAttempt = null;
    state.pendingReworkDirective = null;
    state.workerByAttempt.set(event.attempt, event.payload?.workerIdentity);
    state.assignmentManagerByAttempt.set(event.attempt, event.payload?.assignment?.managerIdentity);
    state.producerIdentities.add(event.payload?.workerIdentity);
    state.managerIdentities.add(event.payload?.assignment?.managerIdentity);
    if (activeDirective) state.reworkDirectiveByAttempt.set(event.attempt, activeDirective);
    state.workReservationIdsByAttempt.set(event.attempt, capacityReservations.map((reservation) => reservation.id));
    state.state = "RUNNING";
    continue;
  }

  requireValue(event.attempt === state.attempt, `event ${event.eventId} attempt ${event.attempt} does not match active attempt ${state.attempt}`);

  if (event.type === "OUTPUT_PRODUCED") {
    requireValue(state.state === "RUNNING", `${event.nodeId} output requires RUNNING state`);
    requireValue(state.workerByAttempt.has(event.attempt), `${event.nodeId} output has no started worker`);
    requireValue(event.payload?.producerIdentity === state.workerByAttempt.get(event.attempt), `${event.nodeId} output producer differs from assigned worker`);
    const artifacts = event.payload?.artifacts ?? [];
    const artifactIds = artifacts.map((artifact) => artifact.id);
    requireValue(new Set(artifactIds).size === artifactIds.length, `${event.nodeId} output artifact ids must be unique`);
    for (const [artifactIndex, artifact] of artifacts.entries()) {
      requireValue(typeof artifact?.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifact.id), `${event.nodeId} artifact ${artifactIndex} id must be a slug`);
      requireValue(Number.isInteger(artifact?.byteLength) && artifact.byteLength >= 0, `${event.nodeId} artifact ${artifactIndex} byteLength must be non-negative`);
      requireValue(isDigest(artifact?.digest), `${event.nodeId} artifact ${artifactIndex} digest must be sha256`);
      requireValue(isEvidenceUri(artifact?.evidenceUri), `${event.nodeId} artifact ${artifactIndex} evidenceUri must use evidence://`);
    }
    requireValue(artifacts.length <= limits.maxArtifactsPerOutput, `${event.nodeId} output exceeds maxArtifactsPerOutput`);
    requireValue(artifacts.reduce((sum, artifact) => sum + (artifact?.byteLength ?? 0), 0) <= limits.maxOutputBytesPerAttempt, `${event.nodeId} output exceeds maxOutputBytesPerAttempt`);
    const producedKinds = artifacts.map((artifact) => artifact.kind);
    const requiredKinds = contractByNode.get(event.nodeId)?.output?.requiredArtifactKinds ?? [];
    requireValue(
      sameMembers(producedKinds, requiredKinds),
      `${event.nodeId} candidate output must exactly satisfy the declared artifact kinds before checks or review`,
    );
    const reworkDirective = state.reworkDirectiveByAttempt.get(event.attempt);
    requireValue(!reworkDirective || reworkDirective.requiredArtifactKinds.every((kind) => producedKinds.includes(kind)), `${event.nodeId} output does not satisfy its rework evidence contract`);
    const workReservationIds = state.workReservationIdsByAttempt.get(event.attempt) ?? [];
    const capacitySettlements = event.payload?.capacitySettlements ?? [];
    requireValue(capacitySettlements.length === workReservationIds.length, `${event.nodeId} output must settle every work reservation exactly once`);
    requireValue(sameMembers(capacitySettlements.map((settlement) => settlement.reservationId), workReservationIds), `${event.nodeId} output settlements drift from its work reservations`);
    for (const [settlementIndex, settlement] of capacitySettlements.entries()) {
      settleReservation(
        settlement,
        { reservationId: settlement.reservationId, nodeId: event.nodeId, attempt: event.attempt },
        `${event.nodeId} work settlement ${settlementIndex}`,
      );
    }
    state.outputByAttempt.set(event.attempt, event.payload);
    state.outputEventByAttempt.set(event.attempt, event.eventId);
    state.state = "AWAITING_CHECKS";
    continue;
  }

  if (event.type === "CHECKS_COMPLETED") {
    requireValue(state.state === "AWAITING_CHECKS", `${event.nodeId} checks require AWAITING_CHECKS state`);
    requireValue(state.outputByAttempt.has(event.attempt), `${event.nodeId} checks precede output`);
    const checks = event.payload?.checks ?? [];
    requireValue(checks.length <= 128, `${event.nodeId} checks exceed 128`);
    const requiredChecks = policy.floor?.requiredChecks ?? [];
    requireValue(sameMembers(checks.map((check) => check.id), requiredChecks), `${event.nodeId} checks do not exactly cover the deterministic floor`);
    state.checksByAttempt.set(event.attempt, checks);
    state.checkEventByAttempt.set(event.attempt, event.eventId);
    state.state = checks.every((check) => check.status === "PASS") ? "AWAITING_REVIEW" : "REWORK_REQUIRED";
    continue;
  }

  if (event.type === "REVIEW_COMPLETED") {
    requireValue(state.state === "AWAITING_REVIEW", `${event.nodeId} review requires AWAITING_REVIEW state`);
    const checks = state.checksByAttempt.get(event.attempt);
    const output = state.outputByAttempt.get(event.attempt);
    requireValue(Boolean(checks), `${event.nodeId} review precedes deterministic checks`);
    requireValue(Boolean(output), `${event.nodeId} review precedes candidate output`);
    requireValue(event.payload?.reviewerIdentity !== event.payload?.producerIdentity, `${event.nodeId} producer may not review its own output`);
    requireValue(!state.producerIdentities.has(event.payload?.reviewerIdentity) && !state.managerIdentities.has(event.payload?.reviewerIdentity), `${event.nodeId} reviewer previously held producer or manager authority`);
    requireValue(event.payload?.producerIdentity === state.workerByAttempt.get(event.attempt), `${event.nodeId} review names the wrong producer`);
    const requiredReviewerClasses = contractByNode.get(event.nodeId)?.requiredReviewerClasses ?? [];
    requireValue(requiredReviewerClasses.includes(event.payload?.reviewerClass), `${event.nodeId} received undeclared reviewer class ${event.payload?.reviewerClass}`);
    const reviewerIdentities = state.reviewerIdentitiesByAttempt.get(event.attempt) ?? new Set();
    requireValue(!reviewerIdentities.has(event.payload?.reviewerIdentity), `${event.nodeId} reviewer identity may not fill multiple review classes`);
    const reviewedClasses = state.reviewedClassesByAttempt.get(event.attempt) ?? new Set();
    requireValue(!reviewedClasses.has(event.payload?.reviewerClass), `${event.nodeId} reviewer class ${event.payload?.reviewerClass} is already filled`);
    reviewerIdentities.add(event.payload?.reviewerIdentity);
    reviewedClasses.add(event.payload?.reviewerClass);
    state.reviewerIdentitiesByAttempt.set(event.attempt, reviewerIdentities);
    state.reviewedClassesByAttempt.set(event.attempt, reviewedClasses);
    state.reviewerIdentities.add(event.payload?.reviewerIdentity);
    const classLimit = event.payload?.reviewerClass === "specialist"
      ? policy.specialistReview?.maxUnitsPerReview
      : policy.independentReview?.maxUnitsPerReview;
    const purpose = event.payload?.reviewerClass === "specialist"
      ? "review:specialist"
      : "review:low-cost-independent";
    admitReservation(
      event.payload?.capacityReservation,
      { purpose, nodeId: event.nodeId, attempt: event.attempt },
      occurredAt,
      `${event.nodeId} ${event.payload?.reviewerClass} reservation`,
    );
    requireValue(event.payload?.capacityReservation?.reservedUnits <= classLimit, `${event.nodeId} review reservation exceeds ${event.payload?.reviewerClass} policy`);
    settleReservation(
      event.payload?.capacitySettlement,
      { reservationId: event.payload?.capacityReservation?.id, nodeId: event.nodeId, attempt: event.attempt },
      `${event.nodeId} ${event.payload?.reviewerClass} settlement`,
    );
    const findingIds = (event.payload?.findings ?? []).map((finding) => finding.id);
    requireValue(findingIds.length <= 64, `${event.nodeId} review findings exceed 64`);
    requireValue(new Set(findingIds).size === findingIds.length, `${event.nodeId} review finding ids must be unique`);
    if (event.payload?.verdict === "APPROVE") {
      requireValue((checks ?? []).every((check) => check.status === "PASS"), `${event.nodeId} approval requires every deterministic check PASS`);
      const requiredKinds = contractByNode.get(event.nodeId)?.output?.requiredArtifactKinds ?? [];
      const producedKinds = (output?.artifacts ?? []).map((artifact) => artifact.kind);
      requireValue(sameMembers(producedKinds, requiredKinds), `${event.nodeId} approval requires exactly the declared output artifact kinds`);
      requireValue((event.payload?.findings ?? []).every((finding) => finding.severity !== "blocking"), `${event.nodeId} approval retains a blocking finding`);
      const approvedClasses = state.approvedReviewerClassesByAttempt.get(event.attempt) ?? new Set();
      approvedClasses.add(event.payload?.reviewerClass);
      state.approvedReviewerClassesByAttempt.set(event.attempt, approvedClasses);
      state.state = requiredReviewerClasses.every((reviewerClass) => approvedClasses.has(reviewerClass))
        ? "AWAITING_MANAGER"
        : "AWAITING_REVIEW";
    } else if (event.payload?.verdict === "REWORK") {
      requireValue((event.payload?.findings ?? []).length > 0, `${event.nodeId} REWORK requires findings`);
      state.state = "REWORK_REQUIRED";
    } else {
      state.state = "ESCALATED";
    }
    state.reviewByAttempt.set(event.attempt, event.payload);
    const reviewEventIds = state.reviewEventIdsByAttempt.get(event.attempt) ?? [];
    reviewEventIds.push(event.eventId);
    state.reviewEventIdsByAttempt.set(event.attempt, reviewEventIds);
    continue;
  }

  if (event.type === "REWORK_REQUESTED") {
    requireValue(state.state === "REWORK_REQUIRED", `${event.nodeId} rework request requires REWORK_REQUIRED state`);
    const review = state.reviewByAttempt.get(event.attempt);
    const failedCheckIds = (state.checksByAttempt.get(event.attempt) ?? [])
      .filter((check) => check.status !== "PASS")
      .map((check) => check.id);
    requireValue(event.payload?.targetNodeId === event.nodeId, `${event.nodeId} rework target must be explicit and local in this fixture`);
    const latestReviewEventId = (state.reviewEventIdsByAttempt.get(event.attempt) ?? []).at(-1);
    const checkEventId = state.checkEventByAttempt.get(event.attempt);
    const expectedFindings = review?.verdict === "REWORK" && latestReviewEventId
      ? (review.findings ?? []).map((finding) => ({ id: finding.id, sourceEventId: latestReviewEventId, evidenceUri: finding.evidenceUri }))
      : checkEventId
        ? (state.checksByAttempt.get(event.attempt) ?? [])
          .filter((check) => check.status !== "PASS")
          .map((check) => ({ id: check.id, sourceEventId: checkEventId, evidenceUri: check.evidenceUri }))
        : [];
    requireValue(expectedFindings.length > 0, `${event.nodeId} rework lacks a failed check or REWORK verdict`);
    requireValue(sameFindingRefs(event.payload?.findings ?? [], expectedFindings), `${event.nodeId} rework findings drift from their source evidence`);
    registerRework(
      state,
      contractByNode.get(event.nodeId),
      event.eventId,
      event.payload?.findings ?? [],
      event.payload?.requiredArtifactKinds ?? [],
      event.payload?.targetAttempt,
    );
    continue;
  }

  if (event.type === "MANAGER_DECIDED") {
    requireValue(state.state === "AWAITING_MANAGER", `${event.nodeId} manager decision requires AWAITING_MANAGER state`);
    requireValue(!state.producerIdentities.has(event.payload?.managerIdentity) && !state.reviewerIdentities.has(event.payload?.managerIdentity), `${event.nodeId} manager may not have produced or reviewed any attempt`);
    requireValue(event.payload?.managerIdentity === state.assignmentManagerByAttempt.get(event.attempt), `${event.nodeId} manager decision must come from the manager named by the attempt assignment receipt`);
    requireValue(!state.managerEventByAttempt.has(event.attempt), `${event.nodeId} attempt ${event.attempt} already has a manager decision`);
    const requiredReviewerClasses = contractByNode.get(event.nodeId)?.requiredReviewerClasses ?? [];
    const approvedClasses = state.approvedReviewerClassesByAttempt.get(event.attempt) ?? new Set();
    requireValue(requiredReviewerClasses.every((reviewerClass) => approvedClasses.has(reviewerClass)), `${event.nodeId} manager approval requires every declared reviewer class`);
    requireValue((event.payload?.bypassedGateIds ?? []).length === 0, `${event.nodeId} manager may not bypass gates`);
    const expectedReasoningEvidenceIds = [
      state.outputEventByAttempt.get(event.attempt),
      state.checkEventByAttempt.get(event.attempt),
      ...(state.reviewEventIdsByAttempt.get(event.attempt) ?? []),
    ].filter(Boolean);
    requireValue(sameMembers(event.payload?.reasoningEvidenceIds ?? [], expectedReasoningEvidenceIds), `${event.nodeId} manager reasoning must bind output, checks, and all reviews`);
    const assignments = event.payload?.assignments ?? [];
    requireValue(assignments.length <= 500, `${event.nodeId} manager assignments may not exceed 500`);
    requireValue(event.payload?.decision === "ADD_ROLE" ? assignments.length > 0 : assignments.length === 0, `${event.nodeId} only ADD_ROLE may carry assignments`);
    requireValue(assignments.every((assignment) => scopeNodeIds.includes(assignment.nodeId) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignment.roleId)), `${event.nodeId} manager assignment escapes scope or uses an invalid role`);
    requireValue(new Set(assignments.map((assignment) => `${assignment.nodeId}\u0000${assignment.roleId}`)).size === assignments.length, `${event.nodeId} manager assignments must be unique`);
    requireValue(event.payload?.decision === "CONTINUE" ? event.payload?.rework !== null : event.payload?.rework === null, `${event.nodeId} only CONTINUE may carry rework`);
    admitReservation(
      event.payload?.capacityReservation,
      { purpose: "manager", nodeId: event.nodeId, attempt: event.attempt },
      occurredAt,
      `${event.nodeId} manager reservation`,
    );
    requireValue(event.payload?.capacityReservation?.reservedUnits <= policy.managerGate?.maxUnitsPerDecision, `${event.nodeId} manager reservation exceeds decision policy`);
    settleReservation(
      event.payload?.capacitySettlement,
      { reservationId: event.payload?.capacityReservation?.id, nodeId: event.nodeId, attempt: event.attempt },
      `${event.nodeId} manager settlement`,
    );
    state.managerDecision = event.payload?.decision;
    state.managerEventByAttempt.set(event.attempt, event.eventId);
    state.managerIdentities.add(event.payload?.managerIdentity);
    if (event.payload?.decision === "APPROVE_NODE") {
      state.state = "AWAITING_MANAGER";
    } else if (event.payload?.decision === "CONTINUE") {
      const managerFindings = event.payload?.rework?.findings ?? [];
      requireValue(managerFindings.length > 0, `${event.nodeId} CONTINUE requires evidence-bearing findings`);
      registerRework(
        state,
        contractByNode.get(event.nodeId),
        event.eventId,
        managerFindings.map((finding) => ({
          id: finding.id,
          sourceEventId: event.eventId,
          evidenceUri: finding.evidenceUri,
        })),
        event.payload?.rework?.requiredArtifactKinds ?? [],
        event.attempt + 1,
      );
    } else {
      if (event.payload?.decision === "ADD_ROLE") {
        topologyMutations += 1;
        requireValue(topologyMutations <= limits.maxTopologyMutations, `${event.nodeId} exceeds maxTopologyMutations`);
      }
      state.state = "ESCALATED";
      runState = "HALTED";
    }
    continue;
  }

  if (event.type === "NODE_APPROVED") {
    requireValue(state.state === "AWAITING_MANAGER", `${event.nodeId} NODE_APPROVED requires AWAITING_MANAGER state`);
    requireValue(state.managerDecision === "APPROVE_NODE", `${event.nodeId} NODE_APPROVED requires manager APPROVE_NODE`);
    const expectedEvidenceIds = [
      state.outputEventByAttempt.get(event.attempt),
      state.checkEventByAttempt.get(event.attempt),
      ...(state.reviewEventIdsByAttempt.get(event.attempt) ?? []),
      state.managerEventByAttempt.get(event.attempt),
    ].filter(Boolean);
    requireValue(sameMembers(event.payload?.approvalEvidenceIds ?? [], expectedEvidenceIds), `${event.nodeId} approval evidence must bind output, checks, all reviews, and manager decision`);
    state.state = "APPROVED";
    refreshEligibility();
  }
}

requireValue(runOpened, "execution trace omits RUN_OPENED");
requireValue(runCompleted, "fixture trace must terminate with RUN_COMPLETED");
requireValue(events.at(-1)?.type === "RUN_COMPLETED", "RUN_COMPLETED must be the final event");
const runDurationSeconds = events.length > 1
  ? (Date.parse(events.at(-1)?.occurredAt) - Date.parse(events[0]?.occurredAt)) / 1000
  : 0;
requireValue(runDurationSeconds <= limits.maxWallClockSeconds, `execution exceeds maxWallClockSeconds ${limits.maxWallClockSeconds}`);

const lastEvent = events.at(-1);
const staleAfter = lastEvent?.occurredAt
  ? new Date(new Date(lastEvent.occurredAt).getTime() + (execution?.staleAfterSeconds ?? 300) * 1000).toISOString().replace(".000Z", "Z")
  : null;
const derivedProjection = {
  schema: execution?.contracts?.projectionSchema,
  reducerVersion: execution?.contracts?.reducerVersion,
  executionId: execution?.executionId,
  planId: execution?.plan?.id,
  planDigest: execution?.plan?.digest,
  definitionDigest: execution?.definitionDigest,
  asOfSequence: lastEvent?.sequence,
  asOfEventId: lastEvent?.eventId,
  runState,
  topology,
  capacity: [...capacityUsageByBudget.values()]
    .sort((left, right) => left.budget.id < right.budget.id ? -1 : left.budget.id > right.budget.id ? 1 : 0)
    .map((usage) => ({
      budgetId: usage.budget.id,
      providerId: usage.budget.providerId,
      accountRef: usage.budget.accountRef,
      unit: usage.budget.unit,
      maxReservedUnits: usage.budget.maxReservedUnits,
      reservedUnits: usage.reservedUnits,
      heldUnits: usage.heldUnits,
      usedUnits: usage.usedUnits,
      reservationCount: usage.reservationCount,
    })),
  nodes: [...nodeState.values()].map((state) => {
    const output = state.outputByAttempt.get(state.attempt);
    const checks = state.checksByAttempt.get(state.attempt) ?? [];
    const review = state.reviewByAttempt.get(state.attempt);
    return {
      nodeId: state.nodeId,
      dependsOnNodeIds: state.dependsOnNodeIds,
      state: state.state,
      attempt: state.attempt,
      reworkRounds: state.reworkRounds,
      latestEventId: state.latestEventId,
      checkStatus: checks.every((check) => check.status === "PASS") ? "PASS" : checks.some((check) => check.status === "FAIL") ? "FAIL" : "UNKNOWN",
      reviewVerdict: review?.verdict ?? null,
      managerDecision: state.managerDecision,
      artifactIds: (output?.artifacts ?? []).map((artifact) => artifact.id),
    };
  }),
  staleAfter,
  truthState: "FIXTURE",
  terminalEvidenceRoot: events.at(-1)?.payload?.evidenceRoot ?? null,
};
requireValue(canonicalJson(execution?.expectedProjection) === canonicalJson(derivedProjection), "expectedProjection does not match deterministic event reduction");

console.log(JSON.stringify({
  valid: errors.length === 0,
  errors,
  counts: {
    scopedNodes: scopeNodeIds.length,
    contracts: contracts.length,
    clients: clients.length,
    events: events.length,
    reworkRounds: [...nodeState.values()].reduce((sum, state) => sum + state.reworkRounds, 0),
  },
  executionDigest: expectedDigest,
  projection: derivedProjection,
}, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
