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

function sameMembers(left, right) {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

const expectedDigest = executionDigest(execution);
requireValue(execution?.schemaVersion === 1, "schemaVersion must be 1");
requireValue(execution?.kind === "DrydockHypertreeExecution", "kind must be DrydockHypertreeExecution");
requireValue(execution?.status === "fixture-static-design", "this bundle may validate only fixture-static-design evidence while the runtime halt is active");
requireValue(execution?.plan?.id === plan?.id, `execution plan id must match ${plan?.id}`);
requireValue(execution?.plan?.digest === plan?.artifactIdentity?.planDigest, "execution plan digest must match the exact hypertree planDigest");
requireValue(execution?.executionDigest === expectedDigest, `executionDigest mismatch; expected ${expectedDigest}`);

const topology = execution?.plan?.topology ?? {};
requireValue(topology.eligibility === "dag", "eligibility topology must be dag");
requireValue(topology.qualityRouting === "bounded-workflow", "quality routing must be bounded-workflow");
requireValue(topology.staffing === "manager-driven-rounds", "staffing must be manager-driven-rounds");
requireValue(topology.observation === "append-only-event-projection", "observation must be append-only-event-projection");

const planNodes = new Map((plan?.nodes ?? []).map((node) => [node.id, node]));
const scopeNodeIds = execution?.scope?.nodeIds ?? [];
for (const nodeId of scopeNodeIds) requireValue(planNodes.has(nodeId), `scope references unknown plan node ${nodeId}`);

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
  requireValue(client.commandPath === "separate-signed-control-api", `client ${client.id} must use the separate signed control API`);
  requireValue(client.projectionSchema === execution?.contracts?.projectionSchema, `client ${client.id} projection schema drift`);
}

const limits = execution?.limits ?? {};
requireValue(limits.maxNodeAttempts <= 3, "maxNodeAttempts may not exceed 3");
requireValue(limits.maxReworkRounds <= 2, "maxReworkRounds may not exceed 2");
requireValue(limits.maxManagerRounds <= 3, "maxManagerRounds may not exceed 3");
requireValue(limits.maxTopologyMutations <= 3, "maxTopologyMutations may not exceed 3");
requireValue(limits.maxWallClockSeconds <= 21600, "maxWallClockSeconds may not exceed 21600");
requireValue(limits.maxReviewUnitsTotal > 0, "maxReviewUnitsTotal must be positive");
requireValue(limits.maxRecursiveBirths === 0, "fixture execution must forbid recursive births");
requireValue(limits.retryOwner === "external-controller", "only the external controller may own retries");
requireValue(limits.retryLayers === 1, "retry authority must exist at exactly one layer");

const policy = execution?.reviewPolicy ?? {};
requireValue(policy.floor?.requiredBeforeReview === true, "deterministic floor checks must finish before review");
requireValue(policy.independentReview?.required === true, "independent review must be required");
requireValue(policy.independentReview?.reviewerMustDifferFromProducer === true, "reviewer must differ from producer");
requireValue(policy.specialistReview?.reservationUnit === "provider-native-units", "specialist review must reserve provider-native-units");
requireValue(policy.managerGate?.mayWaiveChecks === false, "manager may not waive checks");
requireValue(policy.managerGate?.maySelfApprove === false, "manager may not self-approve");

const nodeState = new Map(scopeNodeIds.map((nodeId) => [nodeId, {
  nodeId,
  attempt: 0,
  reworkRounds: 0,
  managerRound: 0,
  latestEventId: null,
  workerByAttempt: new Map(),
  outputByAttempt: new Map(),
  checksByAttempt: new Map(),
  reviewByAttempt: new Map(),
  reviewerIdentitiesByAttempt: new Map(),
  approvedReviewerClassesByAttempt: new Map(),
  checkEventByAttempt: new Map(),
  reviewEventIdsByAttempt: new Map(),
  managerEventByAttempt: new Map(),
  pendingReworkAttempt: null,
  managerDecision: null,
  state: "BLOCKED",
}]));

const events = execution?.events ?? [];
let runState = "OPEN";
let previousEventId = null;
let previousOccurredAt = null;
let runOpened = false;
let runCompleted = false;
const eventIds = new Set();
const findingOccurrences = new Map();
let totalReviewReservedUnits = 0;

for (const [index, event] of events.entries()) {
  const expectedSequence = index + 1;
  requireValue(!eventIds.has(event.eventId), `duplicate event id ${event.eventId}`);
  eventIds.add(event.eventId);
  requireValue(event.sequence === expectedSequence, `event ${event.eventId} sequence must be ${expectedSequence}`);
  requireValue(event.previousEventId === previousEventId, `event ${event.eventId} previousEventId must be ${previousEventId}`);
  const occurredAt = Date.parse(event.occurredAt);
  requireValue(Number.isFinite(occurredAt), `event ${event.eventId} occurredAt must be a valid timestamp`);
  if (previousOccurredAt !== null && Number.isFinite(occurredAt)) {
    requireValue(occurredAt >= previousOccurredAt, `event ${event.eventId} occurredAt moves backward`);
  }
  if (Number.isFinite(occurredAt)) previousOccurredAt = occurredAt;
  requireValue(!runCompleted, `event ${event.eventId} occurs after RUN_COMPLETED`);
  previousEventId = event.eventId;

  if (event.type === "RUN_OPENED") {
    requireValue(index === 0 && !runOpened, "RUN_OPENED must be the first and only opening event");
    requireValue(event.payload?.planDigest === execution?.plan?.digest, "RUN_OPENED planDigest drift");
    requireValue(sameMembers(event.payload?.scopeNodeIds ?? [], scopeNodeIds), "RUN_OPENED scope must match execution scope");
    runOpened = true;
    runState = "RUNNING";
    continue;
  }

  if (event.type === "RUN_COMPLETED") {
    requireValue(runOpened && !runCompleted, "RUN_COMPLETED requires one open run");
    requireValue(sameMembers(event.payload?.terminalNodeIds ?? [], scopeNodeIds), "RUN_COMPLETED terminal nodes must match scope");
    requireValue([...nodeState.values()].every((node) => node.state === "APPROVED"), "RUN_COMPLETED requires every scoped node to be APPROVED");
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
    const requiredState = expectedAttempt === 1 ? "BLOCKED" : "REWORK_REQUIRED";
    requireValue(state.state === requiredState, `${event.nodeId} cannot start attempt ${expectedAttempt} from ${state.state}`);
    requireValue(event.attempt === expectedAttempt, `${event.nodeId} attempt must advance from ${state.attempt} to ${expectedAttempt}`);
    requireValue(event.attempt <= limits.maxNodeAttempts, `${event.nodeId} exceeds maxNodeAttempts`);
    if (event.attempt > 1) {
      requireValue(state.pendingReworkAttempt === event.attempt, `${event.nodeId} attempt ${event.attempt} lacks a matching rework directive`);
    }
    requireValue(event.payload?.managerRound <= limits.maxManagerRounds, `${event.nodeId} exceeds maxManagerRounds`);
    requireValue(event.payload?.managerRound > state.managerRound, `${event.nodeId} managerRound must advance beyond ${state.managerRound}`);
    requireValue(event.payload?.input?.planDigest === execution?.plan?.digest, `${event.nodeId} input planDigest drift`);
    requireValue(event.payload?.input?.nodeContractId === contractByNode.get(event.nodeId)?.id, `${event.nodeId} input uses the wrong node contract`);
    const inputArtifacts = event.payload?.input?.artifacts ?? [];
    const inputArtifactIds = inputArtifacts.map((artifact) => artifact.id);
    const inputArtifactKinds = inputArtifacts.map((artifact) => artifact.kind);
    requireValue(new Set(inputArtifactIds).size === inputArtifactIds.length, `${event.nodeId} input artifact ids must be unique`);
    requireValue(sameMembers(inputArtifactKinds, contractByNode.get(event.nodeId)?.input?.requiredArtifactKinds ?? []), `${event.nodeId} input artifacts do not exactly satisfy its contract`);
    const priorArtifactIds = event.payload?.input?.priorAttemptArtifactIds ?? [];
    if (expectedAttempt === 1) {
      requireValue(priorArtifactIds.length === 0, `${event.nodeId} first attempt may not claim prior-attempt artifacts`);
    } else {
      const priorOutputIds = (state.outputByAttempt.get(expectedAttempt - 1)?.artifacts ?? []).map((artifact) => artifact.id);
      requireValue(sameMembers(priorArtifactIds, priorOutputIds), `${event.nodeId} rework input must bind the exact prior-attempt artifacts`);
    }
    state.attempt = event.attempt;
    state.managerRound = event.payload?.managerRound;
    state.pendingReworkAttempt = null;
    state.workerByAttempt.set(event.attempt, event.payload?.workerIdentity);
    state.state = "RUNNING";
    continue;
  }

  requireValue(event.attempt === state.attempt, `event ${event.eventId} attempt ${event.attempt} does not match active attempt ${state.attempt}`);

  if (event.type === "OUTPUT_PRODUCED") {
    requireValue(state.state === "RUNNING", `${event.nodeId} output requires RUNNING state`);
    requireValue(state.workerByAttempt.has(event.attempt), `${event.nodeId} output has no started worker`);
    requireValue(event.payload?.producerIdentity === state.workerByAttempt.get(event.attempt), `${event.nodeId} output producer differs from assigned worker`);
    const artifactIds = (event.payload?.artifacts ?? []).map((artifact) => artifact.id);
    requireValue(new Set(artifactIds).size === artifactIds.length, `${event.nodeId} output artifact ids must be unique`);
    state.outputByAttempt.set(event.attempt, event.payload);
    state.state = "AWAITING_CHECKS";
    continue;
  }

  if (event.type === "CHECKS_COMPLETED") {
    requireValue(state.state === "AWAITING_CHECKS", `${event.nodeId} checks require AWAITING_CHECKS state`);
    requireValue(state.outputByAttempt.has(event.attempt), `${event.nodeId} checks precede output`);
    const checks = event.payload?.checks ?? [];
    const requiredChecks = policy.floor?.requiredChecks ?? [];
    requireValue(sameMembers(checks.map((check) => check.id), requiredChecks), `${event.nodeId} checks do not exactly cover the deterministic floor`);
    state.checksByAttempt.set(event.attempt, checks);
    state.checkEventByAttempt.set(event.attempt, event.eventId);
    state.state = "AWAITING_REVIEW";
    continue;
  }

  if (event.type === "REVIEW_COMPLETED") {
    requireValue(state.state === "AWAITING_REVIEW", `${event.nodeId} review requires AWAITING_REVIEW state`);
    const checks = state.checksByAttempt.get(event.attempt);
    const output = state.outputByAttempt.get(event.attempt);
    requireValue(Boolean(checks), `${event.nodeId} review precedes deterministic checks`);
    requireValue(Boolean(output), `${event.nodeId} review precedes candidate output`);
    requireValue(event.payload?.reviewerIdentity !== event.payload?.producerIdentity, `${event.nodeId} producer may not review its own output`);
    requireValue(event.payload?.producerIdentity === state.workerByAttempt.get(event.attempt), `${event.nodeId} review names the wrong producer`);
    const requiredReviewerClasses = contractByNode.get(event.nodeId)?.requiredReviewerClasses ?? [];
    requireValue(requiredReviewerClasses.includes(event.payload?.reviewerClass), `${event.nodeId} received undeclared reviewer class ${event.payload?.reviewerClass}`);
    const reviewerIdentities = state.reviewerIdentitiesByAttempt.get(event.attempt) ?? new Set();
    requireValue(!reviewerIdentities.has(event.payload?.reviewerIdentity), `${event.nodeId} reviewer identity may not fill multiple review classes`);
    reviewerIdentities.add(event.payload?.reviewerIdentity);
    state.reviewerIdentitiesByAttempt.set(event.attempt, reviewerIdentities);
    requireValue(event.payload?.usedUnits <= event.payload?.reservedUnits, `${event.nodeId} review exceeds its reserved native units`);
    const classLimit = event.payload?.reviewerClass === "specialist"
      ? policy.specialistReview?.maxUnitsPerReview
      : policy.independentReview?.maxUnitsPerReview;
    requireValue(event.payload?.reservedUnits <= classLimit, `${event.nodeId} review reservation exceeds ${event.payload?.reviewerClass} policy`);
    totalReviewReservedUnits += event.payload?.reservedUnits ?? 0;
    requireValue(totalReviewReservedUnits <= limits.maxReviewUnitsTotal, `review reservations exceed maxReviewUnitsTotal ${limits.maxReviewUnitsTotal}`);
    const findingIds = (event.payload?.findings ?? []).map((finding) => finding.id);
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
    requireValue(review?.verdict === "REWORK", `${event.nodeId} rework requires a REWORK verdict`);
    requireValue(event.payload?.targetNodeId === event.nodeId, `${event.nodeId} rework target must be explicit and local in this fixture`);
    requireValue(event.payload?.targetAttempt === event.attempt + 1, `${event.nodeId} rework target attempt must be ${event.attempt + 1}`);
    requireValue(sameMembers(event.payload?.findingIds ?? [], (review?.findings ?? []).map((finding) => finding.id)), `${event.nodeId} rework finding ids drift from reviewer findings`);
    for (const findingId of event.payload?.findingIds ?? []) {
      const occurrences = (findingOccurrences.get(findingId) ?? 0) + 1;
      findingOccurrences.set(findingId, occurrences);
      requireValue(occurrences <= policy.rework?.sameFindingRepeatLimit, `${event.nodeId} finding ${findingId} exceeds sameFindingRepeatLimit`);
    }
    state.reworkRounds += 1;
    requireValue(state.reworkRounds <= limits.maxReworkRounds, `${event.nodeId} exceeds maxReworkRounds`);
    state.pendingReworkAttempt = event.payload?.targetAttempt;
    state.state = "REWORK_REQUIRED";
    continue;
  }

  if (event.type === "MANAGER_DECIDED") {
    requireValue(state.state === "AWAITING_MANAGER", `${event.nodeId} manager decision requires AWAITING_MANAGER state`);
    const review = state.reviewByAttempt.get(event.attempt);
    const worker = state.workerByAttempt.get(event.attempt);
    requireValue(review?.verdict === "APPROVE", `${event.nodeId} manager approval requires independent APPROVE`);
    requireValue(event.payload?.managerIdentity !== worker, `${event.nodeId} manager may not be the producer`);
    const reviewerIdentities = state.reviewerIdentitiesByAttempt.get(event.attempt) ?? new Set();
    requireValue(!reviewerIdentities.has(event.payload?.managerIdentity), `${event.nodeId} manager may not be a reviewer`);
    const requiredReviewerClasses = contractByNode.get(event.nodeId)?.requiredReviewerClasses ?? [];
    const approvedClasses = state.approvedReviewerClassesByAttempt.get(event.attempt) ?? new Set();
    requireValue(requiredReviewerClasses.every((reviewerClass) => approvedClasses.has(reviewerClass)), `${event.nodeId} manager approval requires every declared reviewer class`);
    requireValue((event.payload?.bypassedGateIds ?? []).length === 0, `${event.nodeId} manager may not bypass gates`);
    state.managerDecision = event.payload?.decision;
    state.managerEventByAttempt.set(event.attempt, event.eventId);
    state.state = event.payload?.decision === "APPROVE_NODE" ? "AWAITING_MANAGER" : "ESCALATED";
    continue;
  }

  if (event.type === "NODE_APPROVED") {
    requireValue(state.state === "AWAITING_MANAGER", `${event.nodeId} NODE_APPROVED requires AWAITING_MANAGER state`);
    requireValue(state.managerDecision === "APPROVE_NODE", `${event.nodeId} NODE_APPROVED requires manager APPROVE_NODE`);
    const expectedEvidenceIds = [
      state.checkEventByAttempt.get(event.attempt),
      ...(state.reviewEventIdsByAttempt.get(event.attempt) ?? []),
      state.managerEventByAttempt.get(event.attempt),
    ].filter(Boolean);
    requireValue(sameMembers(event.payload?.approvalEvidenceIds ?? [], expectedEvidenceIds), `${event.nodeId} approval evidence must bind checks, all reviews, and manager decision`);
    state.state = "APPROVED";
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
  ? new Date(new Date(lastEvent.occurredAt).getTime() + 5 * 60 * 1000).toISOString().replace(".000Z", "Z")
  : null;
const derivedProjection = {
  schema: execution?.contracts?.projectionSchema,
  asOfSequence: lastEvent?.sequence,
  asOfEventId: lastEvent?.eventId,
  runState,
  topology,
  nodes: [...nodeState.values()].map((state) => {
    const output = state.outputByAttempt.get(state.attempt);
    const checks = state.checksByAttempt.get(state.attempt) ?? [];
    const review = state.reviewByAttempt.get(state.attempt);
    return {
      nodeId: state.nodeId,
      state: state.state,
      attempt: state.attempt,
      reworkRounds: state.reworkRounds,
      latestEventId: state.latestEventId,
      checkStatus: checks.every((check) => check.status === "PASS") ? "PASS" : checks.some((check) => check.status === "FAIL") ? "FAIL" : "UNKNOWN",
      reviewVerdict: review?.verdict,
      managerDecision: state.managerDecision,
      artifactIds: (output?.artifacts ?? []).map((artifact) => artifact.id),
    };
  }),
  staleAfter,
  truthState: "FIXTURE",
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
