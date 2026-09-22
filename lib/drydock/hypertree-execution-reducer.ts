import { createHash } from 'node:crypto';

import { canonicalJson } from '../merkle-chain.js';
import {
  HYPERTREE_INPUT_SCHEMA,
  HYPERTREE_OUTPUT_SCHEMA,
  HYPERTREE_PROJECTION_SCHEMA,
  HYPERTREE_PROJECTION_UPDATE_SCHEMA,
  HYPERTREE_REDUCER_VERSION,
  type ArtifactRef,
  type CapacityBudget,
  type CapacityReservationRef,
  type CapacitySettlementRef,
  type CheckResult,
  type Digest,
  type HypertreeExecutionDefinition,
  type HypertreeExecutionEvent,
  type HypertreeExecutionProjectionV1,
  type HypertreeProjectionUpdateV1,
  type ManagerDecision,
  type NodeContract,
  type ProjectedHypertreeNode,
  type ProjectedNodeState,
  type ReworkDirective,
  type ReworkFindingRef,
  type ReviewCompletedEvent,
  type ReviewFinding,
  type ReviewerClass,
  type ReviewVerdict,
  type RunState,
} from './hypertree-execution-types.js';

export type HypertreeReductionErrorCode =
  | 'INVALID_DEFINITION'
  | 'INVALID_EVENT'
  | 'EVENT_ID_CONFLICT'
  | 'CURSOR_MISMATCH'
  | 'TIMESTAMP_REGRESSION'
  | 'TERMINAL_RUN'
  | 'INVALID_TRANSITION'
  | 'CONTRACT_VIOLATION'
  | 'AUTHORITY_COLLISION'
  | 'BUDGET_EXCEEDED';

export class HypertreeReductionError extends Error {
  constructor(
    readonly code: HypertreeReductionErrorCode,
    message: string,
    readonly eventId: string | null = null,
  ) {
    super(message);
    this.name = 'HypertreeReductionError';
  }
}

interface InternalNodeState {
  nodeId: string;
  dependsOnNodeIds: string[];
  state: ProjectedNodeState;
  attempt: number;
  reworkRounds: number;
  managerRound: number;
  latestEventId: string | null;
  workerByAttempt: Map<number, string>;
  assignmentManagerByAttempt: Map<number, string>;
  producerIdentities: Set<string>;
  reviewerIdentities: Set<string>;
  managerIdentities: Set<string>;
  outputByAttempt: Map<number, { artifacts: ArtifactRef[] }>;
  outputEventByAttempt: Map<number, string>;
  checksByAttempt: Map<number, CheckResult[]>;
  latestReviewByAttempt: Map<number, ReviewCompletedEvent['payload']>;
  reviewerIdentitiesByAttempt: Map<number, Set<string>>;
  reviewedClassesByAttempt: Map<number, Set<ReviewerClass>>;
  approvedReviewerClassesByAttempt: Map<number, Set<ReviewerClass>>;
  checkEventByAttempt: Map<number, string>;
  reviewEventIdsByAttempt: Map<number, string[]>;
  managerEventByAttempt: Map<number, string>;
  workReservationIdsByAttempt: Map<number, string[]>;
  reworkDirectiveByAttempt: Map<number, ReworkDirective>;
  pendingReworkAttempt: number | null;
  pendingReworkDirective: ReworkDirective | null;
  managerDecision: ManagerDecision | null;
}

interface InternalRunState {
  runState: RunState;
  runOpened: boolean;
  runCompleted: boolean;
  asOfSequence: number;
  asOfEventId: string | null;
  previousOccurredAtMs: number | null;
  openedAtMs: number | null;
  nodes: Map<string, InternalNodeState>;
  findingOccurrences: Map<string, number>;
  topologyMutations: number;
  nodeStartsTotal: number;
  reservationsById: Map<string, CapacityReservationRef>;
  reservationIdByIdempotencyKey: Map<string, string>;
  settledReservationIds: Set<string>;
  capacityUsageByBudget: Map<string, {
    budget: CapacityBudget;
    reservedUnits: number;
    heldUnits: number;
    usedUnits: number;
    reservationCount: number;
  }>;
  eventCanonicalById: Map<string, string>;
  acceptedEventCanonicals: string[];
  terminalEvidenceRoot: Digest | null;
}

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_URI_RE = /^evidence:\/\/.+/;
const EVENT_ID_RE = /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/;
const NODE_ID_RE = /^DD-[0-9]{3}[A-Z]?$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTITY_RE = /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/;
const CANONICAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_SCOPE_NODES = 500;
const MAX_CAPACITY_BUDGETS = 64;
const MAX_EVENTS = 10_000;
const MAX_NODE_STARTS = 1_500;
const MAX_CAPACITY_RESERVATIONS = 5_000;
const MAX_ARTIFACTS_PER_OUTPUT = 64;
const MAX_ARTIFACTS_PER_INPUT = 512;
const MAX_CHECKS_PER_ATTEMPT = 128;
const MAX_FINDINGS_PER_REVIEW = 64;
const MAX_MANAGER_ASSIGNMENTS = 500;
const MAX_OUTPUT_BYTES_PER_ATTEMPT = 104_857_600;
const MAX_CAPACITY_UNITS_PER_BUDGET = 1_000_000_000;
const MAX_DEFINITION_ENVELOPE_BYTES = 4_194_304;
const MAX_EVENT_ENVELOPE_BYTES = 1_048_576;
const WITNESS_CLASSES = new Set([
  'HOST_OBSERVED',
  'BROKER_OBSERVED',
  'GUEST_ASSERTED',
  'MODEL_CHECKED',
  'OPERATOR_OBSERVED',
]);
const EVENT_TYPES = new Set([
  'RUN_OPENED',
  'NODE_STARTED',
  'OUTPUT_PRODUCED',
  'CHECKS_COMPLETED',
  'REVIEW_COMPLETED',
  'REWORK_REQUESTED',
  'MANAGER_DECIDED',
  'NODE_APPROVED',
  'RUN_COMPLETED',
]);
const EVENT_WITNESS_CLASS: Record<HypertreeExecutionEvent['type'], HypertreeExecutionEvent['witnessClass']> = {
  RUN_OPENED: 'HOST_OBSERVED',
  NODE_STARTED: 'HOST_OBSERVED',
  OUTPUT_PRODUCED: 'GUEST_ASSERTED',
  CHECKS_COMPLETED: 'HOST_OBSERVED',
  REVIEW_COMPLETED: 'MODEL_CHECKED',
  REWORK_REQUESTED: 'HOST_OBSERVED',
  MANAGER_DECIDED: 'MODEL_CHECKED',
  NODE_APPROVED: 'HOST_OBSERVED',
  RUN_COMPLETED: 'HOST_OBSERVED',
};
const MANAGER_GATE_EVIDENCE = [
  'schema-valid-output',
  'all-deterministic-checks-pass',
  'all-required-reviews-approve',
  'no-unresolved-blocking-findings',
] as const;

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(
  code: HypertreeReductionErrorCode,
  message: string,
  eventId: string | null = null,
): never {
  throw new HypertreeReductionError(code, message, eventId);
}

function requireCondition(
  condition: unknown,
  code: HypertreeReductionErrorCode,
  message: string,
  eventId: string | null = null,
): asserts condition {
  if (!condition) fail(code, message, eventId);
}

function requireNonemptyString(
  value: unknown,
  label: string,
  eventId: string | null = null,
): asserts value is string {
  requireCondition(
    typeof value === 'string' && value.trim().length > 0,
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be a non-empty string`,
    eventId,
  );
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  eventId: string | null = null,
): asserts value is number {
  requireCondition(
    Number.isInteger(value) && (value as number) >= minimum,
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be an integer >= ${minimum}`,
    eventId,
  );
}

function requireExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  eventId: string | null = null,
): asserts value is Record<string, unknown> {
  requireCondition(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be an object`,
    eventId,
  );
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  requireCondition(
    canonicalJson(actual) === canonicalJson(expected),
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} keys must be exactly ${expected.join(', ')}`,
    eventId,
  );
}

function requireUniqueStrings(
  values: unknown,
  label: string,
  options: { allowEmpty?: boolean; eventId?: string | null } = {},
): asserts values is string[] {
  const eventId = options.eventId ?? null;
  requireCondition(
    Array.isArray(values) && (options.allowEmpty || values.length > 0),
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be ${options.allowEmpty ? 'an' : 'a non-empty'} array`,
    eventId,
  );
  for (const [index, value] of values.entries()) {
    requireNonemptyString(value, `${label}[${index}]`, eventId);
  }
  requireCondition(
    new Set(values).size === values.length,
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must not contain duplicates`,
    eventId,
  );
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function sameFindingRefs(left: readonly ReworkFindingRef[], right: readonly ReworkFindingRef[]): boolean {
  const sorted = (values: readonly ReworkFindingRef[]) => [...values]
    .sort((a, b) => compareCodePoint(a.id, b.id));
  return canonicalJson(sorted(left)) === canonicalJson(sorted(right));
}

function validateDependencyGraph(definition: HypertreeExecutionDefinition): void {
  requireCondition(Array.isArray(definition.nodeDependencies), 'INVALID_DEFINITION', 'nodeDependencies must be an array');
  requireCondition(
    definition.nodeDependencies.length === definition.scopeNodeIds.length,
    'INVALID_DEFINITION',
    'node dependencies must cover scope exactly',
  );
  const dependencyNodeIds = definition.nodeDependencies.map((entry) => entry.nodeId);
  requireCondition(
    new Set(dependencyNodeIds).size === dependencyNodeIds.length
      && sameMembers(dependencyNodeIds, definition.scopeNodeIds),
    'INVALID_DEFINITION',
    'node dependencies must name every scoped node exactly once',
  );
  const scope = new Set(definition.scopeNodeIds);
  const graph = new Map<string, string[]>();
  for (const [index, entry] of definition.nodeDependencies.entries()) {
    requireExactKeys(entry, ['nodeId', 'dependsOnNodeIds'], `nodeDependencies[${index}]`);
    requireNonemptyString(entry.nodeId, `nodeDependencies[${index}].nodeId`);
    requireCondition(NODE_ID_RE.test(entry.nodeId), 'INVALID_DEFINITION', `${entry.nodeId} is not a valid dependency node id`);
    requireUniqueStrings(entry.dependsOnNodeIds, `${entry.nodeId}.dependsOnNodeIds`, { allowEmpty: true });
    requireCondition(
      entry.dependsOnNodeIds.every((nodeId) => scope.has(nodeId) && NODE_ID_RE.test(nodeId)),
      'INVALID_DEFINITION',
      `${entry.nodeId} has a dependency outside execution scope`,
    );
    requireCondition(!entry.dependsOnNodeIds.includes(entry.nodeId), 'INVALID_DEFINITION', `${entry.nodeId} cannot depend on itself`);
    graph.set(entry.nodeId, [...entry.dependsOnNodeIds]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    requireCondition(!visiting.has(nodeId), 'INVALID_DEFINITION', `node dependency graph contains a cycle at ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependencyId of graph.get(nodeId) ?? []) visit(dependencyId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of definition.scopeNodeIds) visit(nodeId);
}

function validateDigest(value: unknown, label: string, eventId: string | null): asserts value is Digest {
  requireCondition(
    typeof value === 'string' && DIGEST_RE.test(value),
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be a lowercase sha256 digest`,
    eventId,
  );
}

function validateEvidenceUri(value: unknown, label: string, eventId: string | null): void {
  requireCondition(
    typeof value === 'string' && EVIDENCE_URI_RE.test(value),
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must use evidence://`,
    eventId,
  );
}

function validateCanonicalTimestamp(value: unknown, label: string, eventId: string | null): number {
  requireCondition(
    typeof value === 'string'
      && CANONICAL_TIMESTAMP_RE.test(value)
      && Number.isFinite(Date.parse(value))
      && new Date(Date.parse(value)).toISOString().replace('.000Z', 'Z') === value,
    eventId ? 'INVALID_EVENT' : 'INVALID_DEFINITION',
    `${label} must be canonical UTC ISO-8601`,
    eventId,
  );
  return Date.parse(value);
}

function validateArtifact(artifact: unknown, label: string, eventId: string): asserts artifact is ArtifactRef {
  requireExactKeys(artifact, ['id', 'kind', 'mediaType', 'byteLength', 'digest', 'evidenceUri'], label, eventId);
  const item = artifact as unknown as ArtifactRef;
  requireNonemptyString(item.id, `${label}.id`, eventId);
  requireCondition(SLUG_RE.test(item.id), 'INVALID_EVENT', `${label}.id must be a slug`, eventId);
  requireNonemptyString(item.kind, `${label}.kind`, eventId);
  requireNonemptyString(item.mediaType, `${label}.mediaType`, eventId);
  requireInteger(item.byteLength, `${label}.byteLength`, 0, eventId);
  validateDigest(item.digest, `${label}.digest`, eventId);
  validateEvidenceUri(item.evidenceUri, `${label}.evidenceUri`, eventId);
}

function validateArtifacts(artifacts: unknown, label: string, eventId: string): asserts artifacts is ArtifactRef[] {
  requireCondition(Array.isArray(artifacts), 'INVALID_EVENT', `${label} must be an array`, eventId);
  artifacts.forEach((artifact, index) => validateArtifact(artifact, `${label}[${index}]`, eventId));
  const ids = artifacts.map((artifact) => artifact.id);
  requireCondition(new Set(ids).size === ids.length, 'CONTRACT_VIOLATION', `${label} ids must be unique`, eventId);
}

function validateChecks(checks: unknown, eventId: string): asserts checks is CheckResult[] {
  requireCondition(Array.isArray(checks), 'INVALID_EVENT', 'checks must be an array', eventId);
  requireCondition(checks.length <= MAX_CHECKS_PER_ATTEMPT, 'BUDGET_EXCEEDED', `checks may not exceed ${MAX_CHECKS_PER_ATTEMPT}`, eventId);
  checks.forEach((check, index) => {
    requireExactKeys(check, ['id', 'status', 'evidenceUri'], `checks[${index}]`, eventId);
    const item = check as unknown as CheckResult;
    requireNonemptyString(item.id, `checks[${index}].id`, eventId);
    requireCondition(SLUG_RE.test(item.id), 'INVALID_EVENT', `checks[${index}].id must be a slug`, eventId);
    requireCondition(
      item.status === 'PASS' || item.status === 'FAIL' || item.status === 'UNKNOWN',
      'INVALID_EVENT',
      `checks[${index}].status is invalid`,
      eventId,
    );
    requireCondition(
      typeof item.evidenceUri === 'string' && EVIDENCE_URI_RE.test(item.evidenceUri),
      'INVALID_EVENT',
      `checks[${index}].evidenceUri must use evidence://`,
      eventId,
    );
  });
  const ids = checks.map((check) => check.id);
  requireCondition(new Set(ids).size === ids.length, 'CONTRACT_VIOLATION', 'check ids must be unique', eventId);
}

function validateFindings(findings: unknown, eventId: string): asserts findings is ReviewFinding[] {
  requireCondition(Array.isArray(findings), 'INVALID_EVENT', 'findings must be an array', eventId);
  requireCondition(findings.length <= MAX_FINDINGS_PER_REVIEW, 'BUDGET_EXCEEDED', `findings may not exceed ${MAX_FINDINGS_PER_REVIEW}`, eventId);
  findings.forEach((finding, index) => {
    requireExactKeys(finding, ['id', 'severity', 'summary', 'evidenceUri'], `findings[${index}]`, eventId);
    const item = finding as unknown as ReviewFinding;
    requireNonemptyString(item.id, `findings[${index}].id`, eventId);
    requireCondition(SLUG_RE.test(item.id), 'INVALID_EVENT', `findings[${index}].id must be a slug`, eventId);
    requireCondition(
      item.severity === 'blocking' || item.severity === 'major' || item.severity === 'minor',
      'INVALID_EVENT',
      `findings[${index}].severity is invalid`,
      eventId,
    );
    requireNonemptyString(item.summary, `findings[${index}].summary`, eventId);
    requireCondition(
      typeof item.evidenceUri === 'string' && EVIDENCE_URI_RE.test(item.evidenceUri),
      'INVALID_EVENT',
      `findings[${index}].evidenceUri must use evidence://`,
      eventId,
    );
  });
  const ids = findings.map((finding) => finding.id);
  requireCondition(new Set(ids).size === ids.length, 'CONTRACT_VIOLATION', 'finding ids must be unique', eventId);
}

function validateContract(contract: NodeContract, definition: HypertreeExecutionDefinition): void {
  requireExactKeys(
    contract,
    ['id', 'nodeId', 'input', 'output', 'riskClasses', 'requiredReviewerClasses', 'reviewPolicyId'],
    'nodeContract',
  );
  requireNonemptyString(contract.id, 'nodeContract.id');
  requireCondition(SLUG_RE.test(contract.id), 'INVALID_DEFINITION', 'nodeContract.id must be a slug');
  requireNonemptyString(contract.nodeId, `nodeContract ${contract.id}.nodeId`);
  requireCondition(NODE_ID_RE.test(contract.nodeId), 'INVALID_DEFINITION', `${contract.id} nodeId is invalid`);
  requireExactKeys(contract.input, ['schema', 'requiredArtifactKinds', 'undeclaredInputs'], `${contract.id}.input`);
  requireCondition(contract.input.schema === HYPERTREE_INPUT_SCHEMA, 'INVALID_DEFINITION', `${contract.id} input schema drift`);
  requireCondition(contract.input.undeclaredInputs === 'deny', 'INVALID_DEFINITION', `${contract.id} must deny undeclared inputs`);
  requireUniqueStrings(contract.input.requiredArtifactKinds, `${contract.id} required input kinds`);
  requireExactKeys(contract.output, ['schema', 'requiredArtifactKinds', 'undeclaredOutputs'], `${contract.id}.output`);
  requireCondition(contract.output.schema === HYPERTREE_OUTPUT_SCHEMA, 'INVALID_DEFINITION', `${contract.id} output schema drift`);
  requireCondition(contract.output.undeclaredOutputs === 'quarantine', 'INVALID_DEFINITION', `${contract.id} must quarantine undeclared outputs`);
  requireUniqueStrings(contract.output.requiredArtifactKinds, `${contract.id} required output kinds`);
  requireUniqueStrings(contract.riskClasses, `${contract.id} risk classes`, { allowEmpty: true });
  requireCondition(
    contract.riskClasses.every((risk) => [
      'identity', 'authority', 'money', 'security', 'lifecycle', 'release', 'destructive-effect',
    ].includes(risk)),
    'INVALID_DEFINITION',
    `${contract.id} contains an unknown risk class`,
  );
  requireUniqueStrings(contract.requiredReviewerClasses, `${contract.id} required reviewer classes`);
  requireCondition(
    contract.requiredReviewerClasses.every((reviewerClass) => reviewerClass === 'low-cost-independent' || reviewerClass === 'specialist'),
    'INVALID_DEFINITION',
    `${contract.id} contains an unknown reviewer class`,
  );
  requireCondition(contract.reviewPolicyId === definition.reviewPolicy.id, 'INVALID_DEFINITION', `${contract.id} review policy drift`);
  requireCondition(
    !definition.reviewPolicy.independentReview.required || contract.requiredReviewerClasses.includes('low-cost-independent'),
    'INVALID_DEFINITION',
    `${contract.id} must require low-cost independent review`,
  );
  const requiresSpecialist = contract.riskClasses.some((risk) =>
    definition.reviewPolicy.specialistReview.mandatoryRiskClasses.includes(risk),
  );
  requireCondition(
    !requiresSpecialist || contract.requiredReviewerClasses.includes('specialist'),
    'INVALID_DEFINITION',
    `${contract.id} risk classes require specialist review`,
  );
}

function validateCapacityBudgets(definition: HypertreeExecutionDefinition): void {
  requireCondition(
    Array.isArray(definition.capacityBudgets) && definition.capacityBudgets.length > 0,
    'INVALID_DEFINITION',
    'capacityBudgets must be a non-empty array',
  );
  requireCondition(
    definition.capacityBudgets.length <= MAX_CAPACITY_BUDGETS,
    'INVALID_DEFINITION',
    `capacityBudgets may not exceed ${MAX_CAPACITY_BUDGETS} entries`,
  );
  const budgetIds = new Set<string>();
  const authorityTuples = new Set<string>();
  for (const [index, budget] of definition.capacityBudgets.entries()) {
    requireExactKeys(
      budget,
      ['id', 'providerId', 'accountRef', 'unit', 'maxReservedUnits'],
      `capacityBudgets[${index}]`,
    );
    requireNonemptyString(budget.id, `capacityBudgets[${index}].id`);
    requireCondition(SLUG_RE.test(budget.id), 'INVALID_DEFINITION', `capacityBudgets[${index}].id must be a slug`);
    requireNonemptyString(budget.providerId, `capacityBudgets[${index}].providerId`);
    requireCondition(SLUG_RE.test(budget.providerId), 'INVALID_DEFINITION', `capacityBudgets[${index}].providerId must be a slug`);
    requireNonemptyString(budget.accountRef, `capacityBudgets[${index}].accountRef`);
    requireCondition(EVENT_ID_RE.test(budget.accountRef), 'INVALID_DEFINITION', `capacityBudgets[${index}].accountRef is invalid`);
    requireNonemptyString(budget.unit, `capacityBudgets[${index}].unit`);
    requireCondition(SLUG_RE.test(budget.unit), 'INVALID_DEFINITION', `capacityBudgets[${index}].unit must be a slug`);
    requireInteger(budget.maxReservedUnits, `capacityBudgets[${index}].maxReservedUnits`, 1);
    requireCondition(
      budget.maxReservedUnits <= MAX_CAPACITY_UNITS_PER_BUDGET,
      'INVALID_DEFINITION',
      `capacityBudgets[${index}].maxReservedUnits exceeds the hard ceiling`,
    );
    requireCondition(!budgetIds.has(budget.id), 'INVALID_DEFINITION', `duplicate capacity budget ${budget.id}`);
    budgetIds.add(budget.id);
    const authorityTuple = canonicalJson([budget.providerId, budget.accountRef, budget.unit]);
    requireCondition(
      !authorityTuples.has(authorityTuple),
      'INVALID_DEFINITION',
      `capacity budget ${budget.id} aliases an existing provider/account/unit authority`,
    );
    authorityTuples.add(authorityTuple);
  }
}

export function validateHypertreeExecutionDefinition(definition: HypertreeExecutionDefinition): void {
  requireExactKeys(
    definition,
    [
      'executionId', 'definitionDigest', 'plan', 'authorityModel', 'scopeNodeIds', 'nodeDependencies',
      'capacityBudgets', 'projectionSchema', 'nodeContracts', 'reviewPolicy', 'limits', 'truthState',
      'staleAfterSeconds',
    ],
    'definition',
  );
  requireCondition(
    Buffer.byteLength(canonicalJson(definition), 'utf8') <= MAX_DEFINITION_ENVELOPE_BYTES,
    'INVALID_DEFINITION',
    `definition may not exceed ${MAX_DEFINITION_ENVELOPE_BYTES} canonical UTF-8 bytes`,
  );
  requireNonemptyString(definition.executionId, 'executionId');
  requireCondition(EVENT_ID_RE.test(definition.executionId), 'INVALID_DEFINITION', 'executionId must be a slug');
  validateDigest(definition.definitionDigest, 'definitionDigest', null);
  requireExactKeys(definition.plan, ['id', 'digest', 'topology'], 'plan');
  requireNonemptyString(definition.plan.id, 'plan.id');
  requireCondition(EVENT_ID_RE.test(definition.plan.id), 'INVALID_DEFINITION', 'plan.id must be a slug');
  validateDigest(definition.plan.digest, 'plan.digest', null);
  requireCondition(
    canonicalJson(definition.plan.topology) === canonicalJson({
      eligibility: 'dag',
      qualityRouting: 'bounded-workflow',
      staffing: 'manager-driven-rounds',
      observation: 'append-only-event-projection',
    }),
    'INVALID_DEFINITION',
    'plan topology must keep DAG eligibility, bounded quality routing, manager staffing, and append-only observation distinct',
  );
  requireCondition(
    canonicalJson(definition.authorityModel) === canonicalJson({
      eventAdmission: 'controller-only',
      projectionReducer: 'controller-typescript',
      clientAuthority: 'projection-only',
    }),
    'INVALID_DEFINITION',
    'authority model must keep event admission in the controller and clients projection-only',
  );
  requireCondition(definition.projectionSchema === HYPERTREE_PROJECTION_SCHEMA, 'INVALID_DEFINITION', 'projection schema drift');
  requireUniqueStrings(definition.scopeNodeIds, 'scopeNodeIds');
  requireCondition(definition.scopeNodeIds.length <= MAX_SCOPE_NODES, 'INVALID_DEFINITION', `scope may not exceed ${MAX_SCOPE_NODES} nodes`);
  requireCondition(definition.scopeNodeIds.every((nodeId) => NODE_ID_RE.test(nodeId)), 'INVALID_DEFINITION', 'scopeNodeIds contains an invalid node id');
  validateDependencyGraph(definition);
  validateCapacityBudgets(definition);
  requireCondition(Array.isArray(definition.nodeContracts), 'INVALID_DEFINITION', 'nodeContracts must be an array');
  requireCondition(definition.nodeContracts.length === definition.scopeNodeIds.length, 'INVALID_DEFINITION', 'node contracts must cover scope exactly');
  const contractNodeIds = definition.nodeContracts.map((contract) => contract.nodeId);
  const contractIds = definition.nodeContracts.map((contract) => contract.id);
  requireCondition(new Set(contractNodeIds).size === contractNodeIds.length, 'INVALID_DEFINITION', 'node contract node ids must be unique');
  requireCondition(new Set(contractIds).size === contractIds.length, 'INVALID_DEFINITION', 'node contract ids must be unique');
  requireCondition(sameMembers(contractNodeIds, definition.scopeNodeIds), 'INVALID_DEFINITION', 'node contracts must cover exactly the execution scope');
  definition.nodeContracts.forEach((contract) => validateContract(contract, definition));

  const policy = definition.reviewPolicy;
  requireExactKeys(
    policy,
    ['id', 'floor', 'independentReview', 'specialistReview', 'managerGate', 'rework'],
    'reviewPolicy',
  );
  requireCondition(policy.id === 'drydock-bounded-review-v1', 'INVALID_DEFINITION', 'review policy id drift');
  requireExactKeys(policy.floor, ['kind', 'requiredBeforeReview', 'requiredChecks'], 'reviewPolicy.floor');
  requireCondition(policy.floor.kind === 'deterministic' && policy.floor.requiredBeforeReview, 'INVALID_DEFINITION', 'deterministic checks must precede review');
  requireUniqueStrings(policy.floor.requiredChecks, 'reviewPolicy.floor.requiredChecks');
  requireExactKeys(
    policy.independentReview,
    ['required', 'routing', 'reviewerMustDifferFromProducer', 'reservationUnit', 'maxUnitsPerReview'],
    'reviewPolicy.independentReview',
  );
  requireCondition(policy.independentReview.required, 'INVALID_DEFINITION', 'independent review is mandatory');
  requireCondition(policy.independentReview.routing === 'lowest-capable-reviewed-tier', 'INVALID_DEFINITION', 'independent review routing drift');
  requireCondition(policy.independentReview.reviewerMustDifferFromProducer, 'INVALID_DEFINITION', 'producer/reviewer separation is mandatory');
  requireCondition(policy.independentReview.reservationUnit === 'provider-native-units', 'INVALID_DEFINITION', 'independent review must reserve provider-native units');
  requireExactKeys(
    policy.specialistReview,
    ['trigger', 'mandatoryRiskClasses', 'uncertainMeans', 'reservationUnit', 'maxUnitsPerReview'],
    'reviewPolicy.specialistReview',
  );
  requireCondition(policy.specialistReview.trigger === 'failureProbability*downstreamWaste>reviewCost', 'INVALID_DEFINITION', 'specialist review trigger drift');
  requireUniqueStrings(policy.specialistReview.mandatoryRiskClasses, 'reviewPolicy.specialistReview.mandatoryRiskClasses');
  requireCondition(
    policy.specialistReview.mandatoryRiskClasses.every((risk) => [
      'identity', 'authority', 'money', 'security', 'lifecycle', 'release', 'destructive-effect',
    ].includes(risk)),
    'INVALID_DEFINITION',
    'specialist review contains an unknown mandatory risk class',
  );
  requireCondition(policy.specialistReview.uncertainMeans === 'escalate', 'INVALID_DEFINITION', 'specialist uncertainty must escalate');
  requireCondition(policy.specialistReview.reservationUnit === 'provider-native-units', 'INVALID_DEFINITION', 'specialist review must reserve provider-native units');
  requireInteger(policy.independentReview.maxUnitsPerReview, 'reviewPolicy.independentReview.maxUnitsPerReview', 1);
  requireInteger(policy.specialistReview.maxUnitsPerReview, 'reviewPolicy.specialistReview.maxUnitsPerReview', 1);
  requireExactKeys(
    policy.managerGate,
    [
      'mode', 'managerMustDifferFromProducerAndReviewer', 'mayWaiveChecks', 'maySelfApprove',
      'reservationUnit', 'maxUnitsPerDecision', 'requiredEvidence',
    ],
    'reviewPolicy.managerGate',
  );
  requireCondition(policy.managerGate.mode === 'risk-triggered-and-terminal', 'INVALID_DEFINITION', 'manager gate mode drift');
  requireCondition(policy.managerGate.managerMustDifferFromProducerAndReviewer, 'INVALID_DEFINITION', 'manager role separation is mandatory');
  requireCondition(!policy.managerGate.mayWaiveChecks && !policy.managerGate.maySelfApprove, 'INVALID_DEFINITION', 'manager may not bypass checks or self-approve');
  requireCondition(policy.managerGate.reservationUnit === 'provider-native-units', 'INVALID_DEFINITION', 'manager decisions must reserve provider-native units');
  requireInteger(policy.managerGate.maxUnitsPerDecision, 'reviewPolicy.managerGate.maxUnitsPerDecision', 1);
  requireUniqueStrings(policy.managerGate.requiredEvidence, 'reviewPolicy.managerGate.requiredEvidence');
  requireCondition(
    sameMembers(policy.managerGate.requiredEvidence, MANAGER_GATE_EVIDENCE),
    'INVALID_DEFINITION',
    'manager gate evidence policy must bind output, checks, reviews, and blocking-finding truth',
  );
  requireExactKeys(
    policy.rework,
    ['verdicts', 'targetMustBeNamed', 'findingIdsRequired', 'sameFindingRepeatLimit'],
    'reviewPolicy.rework',
  );
  requireCondition(
    sameMembers(policy.rework.verdicts, ['APPROVE', 'REWORK', 'ESCALATE']),
    'INVALID_DEFINITION',
    'rework verdict vocabulary drift',
  );
  requireCondition(policy.rework.targetMustBeNamed && policy.rework.findingIdsRequired, 'INVALID_DEFINITION', 'rework must name its target and findings');
  requireInteger(policy.rework.sameFindingRepeatLimit, 'reviewPolicy.rework.sameFindingRepeatLimit', 1);

  const limits = definition.limits;
  requireExactKeys(
    limits,
    [
      'maxScopeNodes', 'maxEvents', 'maxNodeStartsTotal', 'maxCapacityReservationsTotal',
      'maxArtifactsPerOutput', 'maxOutputBytesPerAttempt', 'maxNodeAttempts', 'maxReworkRounds',
      'maxManagerRounds', 'maxTopologyMutations', 'maxWallClockSeconds', 'maxRecursiveBirths',
      'retryOwner', 'retryLayers',
    ],
    'limits',
  );
  requireInteger(limits.maxScopeNodes, 'limits.maxScopeNodes', 1);
  requireCondition(limits.maxScopeNodes <= MAX_SCOPE_NODES, 'INVALID_DEFINITION', `maxScopeNodes may not exceed ${MAX_SCOPE_NODES}`);
  requireCondition(definition.scopeNodeIds.length <= limits.maxScopeNodes, 'INVALID_DEFINITION', 'scope exceeds maxScopeNodes');
  requireInteger(limits.maxEvents, 'limits.maxEvents', 1);
  requireCondition(limits.maxEvents <= MAX_EVENTS, 'INVALID_DEFINITION', `maxEvents may not exceed ${MAX_EVENTS}`);
  requireInteger(limits.maxNodeStartsTotal, 'limits.maxNodeStartsTotal', 1);
  requireCondition(limits.maxNodeStartsTotal <= MAX_NODE_STARTS, 'INVALID_DEFINITION', `maxNodeStartsTotal may not exceed ${MAX_NODE_STARTS}`);
  requireInteger(limits.maxCapacityReservationsTotal, 'limits.maxCapacityReservationsTotal', 1);
  requireCondition(limits.maxCapacityReservationsTotal <= MAX_CAPACITY_RESERVATIONS, 'INVALID_DEFINITION', `maxCapacityReservationsTotal may not exceed ${MAX_CAPACITY_RESERVATIONS}`);
  requireInteger(limits.maxArtifactsPerOutput, 'limits.maxArtifactsPerOutput', 1);
  requireCondition(limits.maxArtifactsPerOutput <= MAX_ARTIFACTS_PER_OUTPUT, 'INVALID_DEFINITION', `maxArtifactsPerOutput may not exceed ${MAX_ARTIFACTS_PER_OUTPUT}`);
  requireInteger(limits.maxOutputBytesPerAttempt, 'limits.maxOutputBytesPerAttempt', 1);
  requireCondition(limits.maxOutputBytesPerAttempt <= MAX_OUTPUT_BYTES_PER_ATTEMPT, 'INVALID_DEFINITION', `maxOutputBytesPerAttempt may not exceed ${MAX_OUTPUT_BYTES_PER_ATTEMPT}`);
  requireInteger(limits.maxNodeAttempts, 'limits.maxNodeAttempts', 1);
  requireCondition(limits.maxNodeAttempts <= 3, 'INVALID_DEFINITION', 'maxNodeAttempts may not exceed 3');
  requireInteger(limits.maxReworkRounds, 'limits.maxReworkRounds', 0);
  requireCondition(limits.maxReworkRounds <= 2, 'INVALID_DEFINITION', 'maxReworkRounds may not exceed 2');
  requireInteger(limits.maxManagerRounds, 'limits.maxManagerRounds', 1);
  requireCondition(limits.maxManagerRounds <= 3, 'INVALID_DEFINITION', 'maxManagerRounds may not exceed 3');
  requireInteger(limits.maxTopologyMutations, 'limits.maxTopologyMutations', 0);
  requireCondition(limits.maxTopologyMutations <= 3, 'INVALID_DEFINITION', 'maxTopologyMutations may not exceed 3');
  requireInteger(limits.maxWallClockSeconds, 'limits.maxWallClockSeconds', 1);
  requireCondition(limits.maxWallClockSeconds <= 21_600, 'INVALID_DEFINITION', 'maxWallClockSeconds may not exceed 21600');
  requireCondition(limits.maxRecursiveBirths === 0, 'INVALID_DEFINITION', 'recursive births are forbidden');
  requireCondition(limits.retryOwner === 'external-controller' && limits.retryLayers === 1, 'INVALID_DEFINITION', 'one external retry owner is mandatory');
  requireCondition(
    policy.floor.requiredChecks.length <= MAX_CHECKS_PER_ATTEMPT,
    'INVALID_DEFINITION',
    `required deterministic checks may not exceed ${MAX_CHECKS_PER_ATTEMPT}`,
  );
  for (const contract of definition.nodeContracts) {
    requireCondition(
      contract.input.requiredArtifactKinds.length <= MAX_ARTIFACTS_PER_INPUT,
      'INVALID_DEFINITION',
      `${contract.id} input kinds may not exceed ${MAX_ARTIFACTS_PER_INPUT}`,
    );
    requireCondition(
      contract.output.requiredArtifactKinds.length <= limits.maxArtifactsPerOutput,
      'INVALID_DEFINITION',
      `${contract.id} requires more output kinds than maxArtifactsPerOutput permits`,
    );
  }
  requireInteger(definition.staleAfterSeconds, 'staleAfterSeconds', 1);
  requireCondition(definition.staleAfterSeconds <= 3_600, 'INVALID_DEFINITION', 'staleAfterSeconds may not exceed 3600');
  requireCondition(definition.truthState === 'FIXTURE' || definition.truthState === 'LIVE', 'INVALID_DEFINITION', 'reducer truthState must be FIXTURE or LIVE');
  requireCondition(
    definition.definitionDigest === digestHypertreeExecutionDefinition(definition),
    'INVALID_DEFINITION',
    'definitionDigest does not bind the exact execution scope, contracts, policy, and limits',
  );
}

export function digestHypertreeExecutionDefinition(
  definition: HypertreeExecutionDefinition,
): Digest {
  const sealed = structuredClone(definition) as unknown as Record<string, unknown>;
  delete sealed.definitionDigest;
  return `sha256:${createHash('sha256').update(canonicalJson(sealed)).digest('hex')}`;
}

function digestEvidenceCanonicals(eventCanonicals: readonly string[]): Digest {
  let tip = '0'.repeat(64);
  for (const canonical of eventCanonicals) {
    tip = createHash('sha256').update(tip).update(canonical).digest('hex');
  }
  return `sha256:${tip}`;
}

export function digestHypertreeEvidencePrefix(
  events: readonly HypertreeExecutionEvent[],
): Digest {
  return digestEvidenceCanonicals(events.map((event) => canonicalJson(event)));
}

function initialNodeState(nodeId: string, dependsOnNodeIds: string[]): InternalNodeState {
  return {
    nodeId,
    dependsOnNodeIds: [...dependsOnNodeIds].sort(compareCodePoint),
    state: 'BLOCKED',
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
    checksByAttempt: new Map(),
    latestReviewByAttempt: new Map(),
    reviewerIdentitiesByAttempt: new Map(),
    reviewedClassesByAttempt: new Map(),
    approvedReviewerClassesByAttempt: new Map(),
    checkEventByAttempt: new Map(),
    reviewEventIdsByAttempt: new Map(),
    managerEventByAttempt: new Map(),
    workReservationIdsByAttempt: new Map(),
    reworkDirectiveByAttempt: new Map(),
    pendingReworkAttempt: null,
    pendingReworkDirective: null,
    managerDecision: null,
  };
}

function initialRunState(definition: HypertreeExecutionDefinition): InternalRunState {
  const dependencies = new Map(
    definition.nodeDependencies.map((entry) => [entry.nodeId, entry.dependsOnNodeIds] as const),
  );
  return {
    runState: 'OPEN',
    runOpened: false,
    runCompleted: false,
    asOfSequence: 0,
    asOfEventId: null,
    previousOccurredAtMs: null,
    openedAtMs: null,
    nodes: new Map(
      definition.scopeNodeIds.map((nodeId) => [nodeId, initialNodeState(nodeId, dependencies.get(nodeId) ?? [])]),
    ),
    findingOccurrences: new Map(),
    topologyMutations: 0,
    nodeStartsTotal: 0,
    reservationsById: new Map(),
    reservationIdByIdempotencyKey: new Map(),
    settledReservationIds: new Set(),
    capacityUsageByBudget: new Map(
      definition.capacityBudgets.map((budget) => [budget.id, {
        budget: structuredClone(budget),
        reservedUnits: 0,
        heldUnits: 0,
        usedUnits: 0,
        reservationCount: 0,
      }]),
    ),
    eventCanonicalById: new Map(),
    acceptedEventCanonicals: [],
    terminalEvidenceRoot: null,
  };
}

function refreshEligibility(state: InternalRunState): void {
  for (const node of state.nodes.values()) {
    if (node.state !== 'BLOCKED' || node.attempt !== 0) continue;
    if (node.dependsOnNodeIds.every((dependencyId) => state.nodes.get(dependencyId)?.state === 'APPROVED')) {
      node.state = 'ELIGIBLE';
    }
  }
}

function aggregateCheckStatus(checks: CheckResult[] | undefined): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (!checks || checks.length === 0) return 'UNKNOWN';
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.every((check) => check.status === 'PASS')) return 'PASS';
  return 'UNKNOWN';
}

function projectionFor(
  definition: HypertreeExecutionDefinition,
  state: InternalRunState,
): HypertreeExecutionProjectionV1 {
  const nodes: ProjectedHypertreeNode[] = [...state.nodes.values()]
    .sort((left, right) => compareCodePoint(left.nodeId, right.nodeId))
    .map((node) => {
      const output = node.outputByAttempt.get(node.attempt);
      const review = node.latestReviewByAttempt.get(node.attempt);
      return {
        nodeId: node.nodeId,
        dependsOnNodeIds: [...node.dependsOnNodeIds],
        state: node.state,
        attempt: node.attempt,
        reworkRounds: node.reworkRounds,
        latestEventId: node.latestEventId,
        checkStatus: aggregateCheckStatus(node.checksByAttempt.get(node.attempt)),
        reviewVerdict: review?.verdict ?? null,
        managerDecision: node.managerDecision,
        artifactIds: (output?.artifacts ?? []).map((artifact) => artifact.id),
      };
    });
  const staleAfter = state.previousOccurredAtMs === null
    ? null
    : new Date(state.previousOccurredAtMs + definition.staleAfterSeconds * 1_000)
      .toISOString()
      .replace('.000Z', 'Z');
  const capacity = [...state.capacityUsageByBudget.values()]
    .sort((left, right) => compareCodePoint(left.budget.id, right.budget.id))
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
    }));
  return {
    schema: HYPERTREE_PROJECTION_SCHEMA,
    reducerVersion: HYPERTREE_REDUCER_VERSION,
    executionId: definition.executionId,
    planId: definition.plan.id,
    planDigest: definition.plan.digest,
    definitionDigest: definition.definitionDigest,
    asOfSequence: state.asOfSequence,
    asOfEventId: state.asOfEventId,
    runState: state.runState,
    topology: structuredClone(definition.plan.topology),
    nodes,
    capacity,
    staleAfter,
    truthState: definition.truthState,
    terminalEvidenceRoot: state.terminalEvidenceRoot,
  };
}

export function digestHypertreeProjection(projection: HypertreeExecutionProjectionV1): Digest {
  return `sha256:${createHash('sha256').update(canonicalJson(projection)).digest('hex')}`;
}

function contractFor(definition: HypertreeExecutionDefinition, nodeId: string): NodeContract {
  const contract = definition.nodeContracts.find((candidate) => candidate.nodeId === nodeId);
  if (!contract) fail('CONTRACT_VIOLATION', `node ${nodeId} has no contract`);
  return contract;
}

function validateEventEnvelope(event: HypertreeExecutionEvent): void {
  const eventId = typeof event?.eventId === 'string' && event.eventId.length > 0
    ? event.eventId
    : '<unidentified-event>';
  requireExactKeys(
    event,
    ['sequence', 'eventId', 'previousEventId', 'type', 'occurredAt', 'witnessClass', 'nodeId', 'attempt', 'payload'],
    'event',
    eventId,
  );
  requireNonemptyString(event.eventId, 'event.eventId', eventId);
  requireCondition(EVENT_ID_RE.test(event.eventId), 'INVALID_EVENT', 'event.eventId is invalid', eventId);
  requireInteger(event.sequence, 'event.sequence', 1, eventId);
  requireCondition(
    event.previousEventId === null || (typeof event.previousEventId === 'string' && EVENT_ID_RE.test(event.previousEventId)),
    'INVALID_EVENT',
    'event.previousEventId must be null or a non-empty string',
    eventId,
  );
  requireCondition(EVENT_TYPES.has(event.type), 'INVALID_EVENT', `unknown event type ${String(event.type)}`, eventId);
  requireCondition(WITNESS_CLASSES.has(event.witnessClass), 'INVALID_EVENT', `unknown witness class ${String(event.witnessClass)}`, eventId);
  requireCondition(
    event.witnessClass === EVENT_WITNESS_CLASS[event.type],
    'CONTRACT_VIOLATION',
    `${event.type} must be witnessed as ${EVENT_WITNESS_CLASS[event.type]}`,
    eventId,
  );
  const occurredAtMs = Date.parse(event.occurredAt);
  requireCondition(Number.isFinite(occurredAtMs), 'INVALID_EVENT', 'event.occurredAt must be an ISO timestamp', eventId);
  requireCondition(new Date(occurredAtMs).toISOString().replace('.000Z', 'Z') === event.occurredAt, 'INVALID_EVENT', 'event.occurredAt must be canonical UTC ISO-8601', eventId);
  if (event.type === 'RUN_OPENED' || event.type === 'RUN_COMPLETED') {
    requireCondition(event.nodeId === null && event.attempt === null, 'INVALID_EVENT', `${event.type} must be run-scoped`, eventId);
  } else {
    requireNonemptyString(event.nodeId, 'event.nodeId', eventId);
    requireCondition(NODE_ID_RE.test(event.nodeId), 'INVALID_EVENT', 'event.nodeId is invalid', eventId);
    requireInteger(event.attempt, 'event.attempt', 1, eventId);
  }
}

function validateCursor(state: InternalRunState, event: HypertreeExecutionEvent, canonical: string): boolean {
  const priorCanonical = state.eventCanonicalById.get(event.eventId);
  if (priorCanonical !== undefined) {
    requireCondition(priorCanonical === canonical, 'EVENT_ID_CONFLICT', `event id ${event.eventId} was replayed with different bytes`, event.eventId);
    return true;
  }
  requireCondition(
    event.sequence === state.asOfSequence + 1,
    'CURSOR_MISMATCH',
    `event ${event.eventId} sequence ${event.sequence} must follow ${state.asOfSequence}`,
    event.eventId,
  );
  requireCondition(
    event.previousEventId === state.asOfEventId,
    'CURSOR_MISMATCH',
    `event ${event.eventId} previousEventId must be ${state.asOfEventId}`,
    event.eventId,
  );
  return false;
}

function requireNodeState(
  state: InternalRunState,
  event: HypertreeExecutionEvent,
): InternalNodeState {
  requireCondition(state.runOpened, 'INVALID_TRANSITION', `${event.type} requires RUN_OPENED`, event.eventId);
  requireCondition(event.nodeId !== null, 'INVALID_EVENT', `${event.type} requires nodeId`, event.eventId);
  const node = state.nodes.get(event.nodeId);
  requireCondition(node, 'CONTRACT_VIOLATION', `event references node outside scope: ${event.nodeId}`, event.eventId);
  node.latestEventId = event.eventId;
  return node;
}

function validateCapacityReservation(
  definition: HypertreeExecutionDefinition,
  state: InternalRunState,
  reservation: unknown,
  expected: { purpose: CapacityReservationRef['purpose']; nodeId: string; attempt: number },
  occurredAtMs: number,
  label: string,
  eventId: string,
): asserts reservation is CapacityReservationRef {
  requireExactKeys(
    reservation,
    [
      'id', 'idempotencyKey', 'budgetId', 'purpose', 'executionId', 'nodeId', 'attempt',
      'reservedUnits', 'expiresAt', 'receiptDigest', 'evidenceUri',
    ],
    label,
    eventId,
  );
  const item = reservation as unknown as CapacityReservationRef;
  requireNonemptyString(item.id, `${label}.id`, eventId);
  requireCondition(EVENT_ID_RE.test(item.id), 'INVALID_EVENT', `${label}.id is invalid`, eventId);
  requireNonemptyString(item.idempotencyKey, `${label}.idempotencyKey`, eventId);
  requireCondition(EVENT_ID_RE.test(item.idempotencyKey), 'INVALID_EVENT', `${label}.idempotencyKey is invalid`, eventId);
  requireNonemptyString(item.budgetId, `${label}.budgetId`, eventId);
  requireCondition(SLUG_RE.test(item.budgetId), 'INVALID_EVENT', `${label}.budgetId is invalid`, eventId);
  requireCondition(item.purpose === expected.purpose, 'CONTRACT_VIOLATION', `${label}.purpose must be ${expected.purpose}`, eventId);
  requireCondition(item.executionId === definition.executionId, 'CONTRACT_VIOLATION', `${label}.executionId drift`, eventId);
  requireCondition(item.nodeId === expected.nodeId, 'CONTRACT_VIOLATION', `${label}.nodeId drift`, eventId);
  requireCondition(item.attempt === expected.attempt, 'CONTRACT_VIOLATION', `${label}.attempt drift`, eventId);
  requireInteger(item.reservedUnits, `${label}.reservedUnits`, 1, eventId);
  const expiresAtMs = validateCanonicalTimestamp(item.expiresAt, `${label}.expiresAt`, eventId);
  requireCondition(expiresAtMs > occurredAtMs, 'BUDGET_EXCEEDED', `${label} is already expired`, eventId);
  if (state.openedAtMs !== null) {
    requireCondition(
      expiresAtMs <= state.openedAtMs + definition.limits.maxWallClockSeconds * 1_000,
      'BUDGET_EXCEEDED',
      `${label} expiry exceeds the sealed run wall-clock`,
      eventId,
    );
  }
  validateDigest(item.receiptDigest, `${label}.receiptDigest`, eventId);
  validateEvidenceUri(item.evidenceUri, `${label}.evidenceUri`, eventId);
  requireCondition(!state.reservationsById.has(item.id), 'BUDGET_EXCEEDED', `${label}.id was already consumed`, eventId);
  requireCondition(
    !state.reservationIdByIdempotencyKey.has(item.idempotencyKey),
    'BUDGET_EXCEEDED',
    `${label}.idempotencyKey was already consumed`,
    eventId,
  );
  requireCondition(
    state.reservationsById.size + 1 <= definition.limits.maxCapacityReservationsTotal,
    'BUDGET_EXCEEDED',
    'execution exceeds maxCapacityReservationsTotal',
    eventId,
  );
  const usage = state.capacityUsageByBudget.get(item.budgetId);
  requireCondition(usage, 'CONTRACT_VIOLATION', `${label} references an undeclared capacity budget`, eventId);
  requireCondition(
    usage.reservedUnits + item.reservedUnits <= usage.budget.maxReservedUnits,
    'BUDGET_EXCEEDED',
    `${label} exceeds budget ${item.budgetId}`,
    eventId,
  );
  usage.reservedUnits += item.reservedUnits;
  usage.heldUnits += item.reservedUnits;
  usage.reservationCount += 1;
  state.reservationsById.set(item.id, structuredClone(item));
  state.reservationIdByIdempotencyKey.set(item.idempotencyKey, item.id);
}

function settleCapacityReservation(
  state: InternalRunState,
  settlement: unknown,
  expected: { reservationId: string; nodeId: string; attempt: number },
  label: string,
  eventId: string,
): asserts settlement is CapacitySettlementRef {
  requireExactKeys(
    settlement,
    ['reservationId', 'outcome', 'usedUnits', 'receiptDigest', 'evidenceUri'],
    label,
    eventId,
  );
  const item = settlement as unknown as CapacitySettlementRef;
  requireNonemptyString(item.reservationId, `${label}.reservationId`, eventId);
  requireCondition(item.reservationId === expected.reservationId, 'CONTRACT_VIOLATION', `${label}.reservationId drift`, eventId);
  requireCondition(
    item.outcome === 'CONSUMED' || item.outcome === 'RELEASED' || item.outcome === 'UNKNOWN',
    'INVALID_EVENT',
    `${label}.outcome is invalid`,
    eventId,
  );
  requireInteger(item.usedUnits, `${label}.usedUnits`, 0, eventId);
  validateDigest(item.receiptDigest, `${label}.receiptDigest`, eventId);
  validateEvidenceUri(item.evidenceUri, `${label}.evidenceUri`, eventId);
  const reservation = state.reservationsById.get(item.reservationId);
  requireCondition(reservation, 'CONTRACT_VIOLATION', `${label} references an unknown reservation`, eventId);
  requireCondition(
    reservation.nodeId === expected.nodeId && reservation.attempt === expected.attempt,
    'CONTRACT_VIOLATION',
    `${label} crosses a node or attempt boundary`,
    eventId,
  );
  requireCondition(
    !state.settledReservationIds.has(item.reservationId),
    'BUDGET_EXCEEDED',
    `${label} attempts to settle a reservation twice`,
    eventId,
  );
  if (item.outcome === 'RELEASED') {
    requireCondition(item.usedUnits === 0, 'CONTRACT_VIOLATION', `${label} RELEASED must use zero units`, eventId);
  } else if (item.outcome === 'UNKNOWN') {
    requireCondition(
      item.usedUnits === reservation.reservedUnits,
      'BUDGET_EXCEEDED',
      `${label} UNKNOWN must conservatively charge the full reservation`,
      eventId,
    );
  } else {
    requireCondition(
      item.usedUnits <= reservation.reservedUnits,
      'BUDGET_EXCEEDED',
      `${label} used more than reserved`,
      eventId,
    );
  }
  const usage = state.capacityUsageByBudget.get(reservation.budgetId);
  requireCondition(usage, 'CONTRACT_VIOLATION', `${label} budget disappeared`, eventId);
  usage.heldUnits -= reservation.reservedUnits;
  usage.usedUnits += item.usedUnits;
  state.settledReservationIds.add(item.reservationId);
}

function validateReworkFindingRefs(
  value: unknown,
  label: string,
  eventId: string,
): asserts value is ReworkFindingRef[] {
  requireCondition(Array.isArray(value) && value.length > 0, 'INVALID_EVENT', `${label} must be a non-empty array`, eventId);
  requireCondition(value.length <= MAX_FINDINGS_PER_REVIEW, 'BUDGET_EXCEEDED', `${label} may not exceed ${MAX_FINDINGS_PER_REVIEW}`, eventId);
  for (const [index, finding] of value.entries()) {
    requireExactKeys(finding, ['id', 'sourceEventId', 'evidenceUri'], `${label}[${index}]`, eventId);
    const item = finding as unknown as ReworkFindingRef;
    requireNonemptyString(item.id, `${label}[${index}].id`, eventId);
    requireCondition(SLUG_RE.test(item.id), 'INVALID_EVENT', `${label}[${index}].id must be a slug`, eventId);
    requireNonemptyString(item.sourceEventId, `${label}[${index}].sourceEventId`, eventId);
    requireCondition(EVENT_ID_RE.test(item.sourceEventId), 'INVALID_EVENT', `${label}[${index}].sourceEventId is invalid`, eventId);
    validateEvidenceUri(item.evidenceUri, `${label}[${index}].evidenceUri`, eventId);
  }
  const ids = value.map((finding) => finding.id);
  requireCondition(new Set(ids).size === ids.length, 'CONTRACT_VIOLATION', `${label} ids must be unique`, eventId);
}

function validateReworkDirective(
  value: unknown,
  label: string,
  eventId: string,
): asserts value is ReworkDirective {
  requireExactKeys(value, ['eventId', 'findings', 'requiredArtifactKinds'], label, eventId);
  const directive = value as unknown as ReworkDirective;
  requireNonemptyString(directive.eventId, `${label}.eventId`, eventId);
  requireCondition(EVENT_ID_RE.test(directive.eventId), 'INVALID_EVENT', `${label}.eventId is invalid`, eventId);
  validateReworkFindingRefs(directive.findings, `${label}.findings`, eventId);
  requireUniqueStrings(directive.requiredArtifactKinds, `${label}.requiredArtifactKinds`, { eventId });
}

function registerRework(
  definition: HypertreeExecutionDefinition,
  state: InternalRunState,
  node: InternalNodeState,
  contract: NodeContract,
  eventId: string,
  findings: ReworkFindingRef[],
  requiredArtifactKinds: string[],
  targetAttempt: number,
): void {
  requireCondition(targetAttempt === node.attempt + 1, 'CONTRACT_VIOLATION', `${node.nodeId} rework target attempt must be ${node.attempt + 1}`, eventId);
  requireCondition(node.reworkRounds + 1 <= definition.limits.maxReworkRounds, 'BUDGET_EXCEEDED', `${node.nodeId} exceeds maxReworkRounds`, eventId);
  requireCondition(targetAttempt <= definition.limits.maxNodeAttempts, 'BUDGET_EXCEEDED', `${node.nodeId} exceeds maxNodeAttempts`, eventId);
  requireCondition(
    requiredArtifactKinds.every((kind) => contract.output.requiredArtifactKinds.includes(kind)),
    'CONTRACT_VIOLATION',
    `${node.nodeId} rework requires an artifact kind outside its output contract`,
    eventId,
  );
  for (const findingId of findings.map((finding) => finding.id)) {
    const occurrences = (state.findingOccurrences.get(findingId) ?? 0) + 1;
    requireCondition(occurrences <= definition.reviewPolicy.rework.sameFindingRepeatLimit, 'BUDGET_EXCEEDED', `${node.nodeId} finding ${findingId} exceeds repeat limit`, eventId);
    state.findingOccurrences.set(findingId, occurrences);
  }
  node.reworkRounds += 1;
  node.pendingReworkAttempt = targetAttempt;
  node.pendingReworkDirective = {
    eventId,
    findings: structuredClone(findings),
    requiredArtifactKinds: [...requiredArtifactKinds],
  };
  node.state = 'REWORK_REQUIRED';
}

function expectedManagerEvidenceIds(node: InternalNodeState, attempt: number): string[] {
  return [
    node.outputEventByAttempt.get(attempt),
    node.checkEventByAttempt.get(attempt),
    ...(node.reviewEventIdsByAttempt.get(attempt) ?? []),
  ].filter((value): value is string => Boolean(value));
}

function applyNewEvent(
  definition: HypertreeExecutionDefinition,
  state: InternalRunState,
  event: HypertreeExecutionEvent,
): void {
  const occurredAtMs = Date.parse(event.occurredAt);
  requireCondition(
    event.sequence <= definition.limits.maxEvents,
    'BUDGET_EXCEEDED',
    `event ${event.eventId} exceeds maxEvents`,
    event.eventId,
  );
  requireCondition(!state.runCompleted, 'TERMINAL_RUN', `event ${event.eventId} occurs after RUN_COMPLETED`, event.eventId);
  requireCondition(state.runState !== 'HALTED', 'TERMINAL_RUN', `event ${event.eventId} occurs after the run halted`, event.eventId);
  if (state.previousOccurredAtMs !== null) {
    requireCondition(occurredAtMs >= state.previousOccurredAtMs, 'TIMESTAMP_REGRESSION', `event ${event.eventId} moves backward in time`, event.eventId);
  }
  if (state.openedAtMs !== null) {
    requireCondition(
      occurredAtMs - state.openedAtMs <= definition.limits.maxWallClockSeconds * 1_000,
      'BUDGET_EXCEEDED',
      `event ${event.eventId} exceeds maxWallClockSeconds`,
      event.eventId,
    );
  }

  if (event.type === 'RUN_OPENED') {
    requireExactKeys(event.payload, ['planDigest', 'definitionDigest', 'scopeNodeIds'], 'RUN_OPENED.payload', event.eventId);
    validateDigest(event.payload.planDigest, 'RUN_OPENED.payload.planDigest', event.eventId);
    validateDigest(event.payload.definitionDigest, 'RUN_OPENED.payload.definitionDigest', event.eventId);
    requireUniqueStrings(event.payload.scopeNodeIds, 'RUN_OPENED.payload.scopeNodeIds', { eventId: event.eventId });
    requireCondition(!state.runOpened && event.sequence === 1, 'INVALID_TRANSITION', 'RUN_OPENED must be the first and only opening event', event.eventId);
    requireCondition(event.payload.planDigest === definition.plan.digest, 'CONTRACT_VIOLATION', 'RUN_OPENED plan digest drift', event.eventId);
    requireCondition(event.payload.definitionDigest === definition.definitionDigest, 'CONTRACT_VIOLATION', 'RUN_OPENED definition digest drift', event.eventId);
    requireCondition(sameMembers(event.payload.scopeNodeIds, definition.scopeNodeIds), 'CONTRACT_VIOLATION', 'RUN_OPENED scope drift', event.eventId);
    state.runOpened = true;
    state.openedAtMs = occurredAtMs;
    state.runState = 'RUNNING';
    refreshEligibility(state);
  } else if (event.type === 'RUN_COMPLETED') {
    requireExactKeys(event.payload, ['terminalNodeIds', 'evidenceRoot'], 'RUN_COMPLETED.payload', event.eventId);
    requireUniqueStrings(event.payload.terminalNodeIds, 'RUN_COMPLETED.payload.terminalNodeIds', { eventId: event.eventId });
    validateDigest(event.payload.evidenceRoot, 'RUN_COMPLETED.payload.evidenceRoot', event.eventId);
    requireCondition(state.runOpened, 'INVALID_TRANSITION', 'RUN_COMPLETED requires an open run', event.eventId);
    requireCondition(sameMembers(event.payload.terminalNodeIds, definition.scopeNodeIds), 'CONTRACT_VIOLATION', 'terminal node set must equal scope', event.eventId);
    requireCondition([...state.nodes.values()].every((node) => node.state === 'APPROVED'), 'INVALID_TRANSITION', 'RUN_COMPLETED requires every scoped node to be APPROVED', event.eventId);
    requireCondition(
      [...state.capacityUsageByBudget.values()].every((usage) => usage.heldUnits === 0),
      'INVALID_TRANSITION',
      'RUN_COMPLETED requires every capacity reservation to be settled',
      event.eventId,
    );
    requireCondition(
      event.payload.evidenceRoot === digestEvidenceCanonicals(state.acceptedEventCanonicals),
      'CONTRACT_VIOLATION',
      'RUN_COMPLETED evidenceRoot must bind the exact admitted event prefix',
      event.eventId,
    );
    state.runCompleted = true;
    state.runState = 'COMPLETED';
    state.terminalEvidenceRoot = event.payload.evidenceRoot;
  } else {
    const node = requireNodeState(state, event);
    const contract = contractFor(definition, node.nodeId);

    if (event.type === 'NODE_STARTED') {
      requireExactKeys(event.payload, ['workerIdentity', 'assignment', 'input'], 'NODE_STARTED.payload', event.eventId);
      requireNonemptyString(event.payload.workerIdentity, 'NODE_STARTED.payload.workerIdentity', event.eventId);
      requireCondition(IDENTITY_RE.test(event.payload.workerIdentity), 'INVALID_EVENT', 'workerIdentity is invalid', event.eventId);
      requireExactKeys(
        event.payload.assignment,
        ['round', 'managerIdentity', 'roleId', 'receiptDigest', 'evidenceUri'],
        'NODE_STARTED.payload.assignment',
        event.eventId,
      );
      requireInteger(event.payload.assignment.round, 'NODE_STARTED.payload.assignment.round', 1, event.eventId);
      requireNonemptyString(event.payload.assignment.managerIdentity, 'NODE_STARTED.payload.assignment.managerIdentity', event.eventId);
      requireCondition(IDENTITY_RE.test(event.payload.assignment.managerIdentity), 'INVALID_EVENT', 'assignment managerIdentity is invalid', event.eventId);
      requireNonemptyString(event.payload.assignment.roleId, 'NODE_STARTED.payload.assignment.roleId', event.eventId);
      requireCondition(SLUG_RE.test(event.payload.assignment.roleId), 'INVALID_EVENT', 'assignment roleId must be a slug', event.eventId);
      validateDigest(event.payload.assignment.receiptDigest, 'NODE_STARTED.payload.assignment.receiptDigest', event.eventId);
      validateEvidenceUri(event.payload.assignment.evidenceUri, 'NODE_STARTED.payload.assignment.evidenceUri', event.eventId);
      requireCondition(
        event.payload.assignment.managerIdentity !== event.payload.workerIdentity,
        'AUTHORITY_COLLISION',
        `${node.nodeId} assignment manager cannot be the worker`,
        event.eventId,
      );
      requireCondition(
        !node.producerIdentities.has(event.payload.assignment.managerIdentity)
          && !node.reviewerIdentities.has(event.payload.assignment.managerIdentity),
        'AUTHORITY_COLLISION',
        `${node.nodeId} assignment manager previously held a producer or reviewer role`,
        event.eventId,
      );
      requireExactKeys(event.payload.input, ['schema', 'nodeContractId', 'planDigest', 'definitionDigest', 'artifacts', 'priorAttemptArtifactIds', 'reworkDirective', 'capabilitySetDigest', 'capacityReservations'], 'NODE_STARTED.payload.input', event.eventId);
      requireCondition(event.payload.input.schema === HYPERTREE_INPUT_SCHEMA, 'CONTRACT_VIOLATION', 'node input schema drift', event.eventId);
      requireNonemptyString(event.payload.input.nodeContractId, 'input.nodeContractId', event.eventId);
      validateDigest(event.payload.input.planDigest, 'input.planDigest', event.eventId);
      validateDigest(event.payload.input.definitionDigest, 'input.definitionDigest', event.eventId);
      validateDigest(event.payload.input.capabilitySetDigest, 'input.capabilitySetDigest', event.eventId);
      validateArtifacts(event.payload.input.artifacts, 'input.artifacts', event.eventId);
      requireCondition(
        event.payload.input.artifacts.length <= MAX_ARTIFACTS_PER_INPUT,
        'BUDGET_EXCEEDED',
        `${node.nodeId} input exceeds ${MAX_ARTIFACTS_PER_INPUT} artifacts`,
        event.eventId,
      );
      requireUniqueStrings(event.payload.input.priorAttemptArtifactIds, 'input.priorAttemptArtifactIds', { allowEmpty: true, eventId: event.eventId });
      requireCondition(
        Array.isArray(event.payload.input.capacityReservations) && event.payload.input.capacityReservations.length > 0,
        'INVALID_EVENT',
        'capacityReservations must be a non-empty array',
        event.eventId,
      );
      requireCondition(
        event.payload.input.capacityReservations.length <= MAX_CAPACITY_BUDGETS,
        'BUDGET_EXCEEDED',
        `${node.nodeId} work reservations exceed the capacity-budget ceiling`,
        event.eventId,
      );
      requireCondition(
        new Set(event.payload.input.capacityReservations.map((reservation) => reservation.budgetId)).size
          === event.payload.input.capacityReservations.length,
        'CONTRACT_VIOLATION',
        `${node.nodeId} may reserve a capacity budget only once per attempt`,
        event.eventId,
      );
      const expectedAttempt = node.attempt + 1;
      const requiredState = expectedAttempt === 1 ? 'ELIGIBLE' : 'REWORK_REQUIRED';
      requireCondition(node.state === requiredState, 'INVALID_TRANSITION', `${node.nodeId} cannot start attempt ${expectedAttempt} from ${node.state}`, event.eventId);
      requireCondition(event.attempt === expectedAttempt, 'INVALID_TRANSITION', `${node.nodeId} attempt must advance to ${expectedAttempt}`, event.eventId);
      requireCondition(event.attempt <= definition.limits.maxNodeAttempts, 'BUDGET_EXCEEDED', `${node.nodeId} exceeds maxNodeAttempts`, event.eventId);
      requireCondition(
        event.payload.assignment.round === node.managerRound + 1,
        'INVALID_TRANSITION',
        `${node.nodeId} assignment round must advance exactly once`,
        event.eventId,
      );
      requireCondition(event.payload.assignment.round <= definition.limits.maxManagerRounds, 'BUDGET_EXCEEDED', `${node.nodeId} exceeds maxManagerRounds`, event.eventId);
      requireCondition(state.nodeStartsTotal + 1 <= definition.limits.maxNodeStartsTotal, 'BUDGET_EXCEEDED', 'execution exceeds maxNodeStartsTotal', event.eventId);
      requireCondition(expectedAttempt === 1 || node.pendingReworkAttempt === expectedAttempt, 'INVALID_TRANSITION', `${node.nodeId} attempt ${expectedAttempt} lacks a rework directive`, event.eventId);
      requireCondition(expectedAttempt === 1 || node.pendingReworkDirective !== null, 'INVALID_TRANSITION', `${node.nodeId} attempt ${expectedAttempt} lacks rework evidence`, event.eventId);
      requireCondition(event.payload.input.nodeContractId === contract.id, 'CONTRACT_VIOLATION', `${node.nodeId} input contract drift`, event.eventId);
      requireCondition(event.payload.input.planDigest === definition.plan.digest, 'CONTRACT_VIOLATION', `${node.nodeId} input plan digest drift`, event.eventId);
      requireCondition(event.payload.input.definitionDigest === definition.definitionDigest, 'CONTRACT_VIOLATION', `${node.nodeId} input definition digest drift`, event.eventId);
      requireCondition(sameMembers(event.payload.input.artifacts.map((artifact) => artifact.kind), contract.input.requiredArtifactKinds), 'CONTRACT_VIOLATION', `${node.nodeId} input kinds must exactly satisfy the contract`, event.eventId);
      if (expectedAttempt === 1) {
        requireCondition(event.payload.input.priorAttemptArtifactIds.length === 0, 'CONTRACT_VIOLATION', `${node.nodeId} first attempt cannot cite prior outputs`, event.eventId);
        requireCondition(event.payload.input.reworkDirective === null, 'CONTRACT_VIOLATION', `${node.nodeId} first attempt cannot carry a rework directive`, event.eventId);
      } else {
        const priorIds = (node.outputByAttempt.get(expectedAttempt - 1)?.artifacts ?? []).map((artifact) => artifact.id);
        requireCondition(sameMembers(event.payload.input.priorAttemptArtifactIds, priorIds), 'CONTRACT_VIOLATION', `${node.nodeId} rework must bind exact prior outputs`, event.eventId);
        validateReworkDirective(event.payload.input.reworkDirective, 'input.reworkDirective', event.eventId);
        requireCondition(
          canonicalJson(event.payload.input.reworkDirective) === canonicalJson(node.pendingReworkDirective),
          'CONTRACT_VIOLATION',
          `${node.nodeId} input must bind the exact pending rework directive`,
          event.eventId,
        );
      }
      requireCondition(
        !node.reviewerIdentities.has(event.payload.workerIdentity) && !node.managerIdentities.has(event.payload.workerIdentity),
        'AUTHORITY_COLLISION',
        `${node.nodeId} worker identity previously held a review or manager role`,
        event.eventId,
      );
      for (const [index, reservation] of event.payload.input.capacityReservations.entries()) {
        validateCapacityReservation(
          definition,
          state,
          reservation,
          { purpose: 'work', nodeId: node.nodeId, attempt: event.attempt },
          occurredAtMs,
          `input.capacityReservations[${index}]`,
          event.eventId,
        );
      }
      const activeDirective = node.pendingReworkDirective ? structuredClone(node.pendingReworkDirective) : null;
      node.attempt = event.attempt;
      node.managerRound = event.payload.assignment.round;
      node.pendingReworkAttempt = null;
      node.pendingReworkDirective = null;
      node.managerDecision = null;
      node.workerByAttempt.set(event.attempt, event.payload.workerIdentity);
      node.assignmentManagerByAttempt.set(event.attempt, event.payload.assignment.managerIdentity);
      node.producerIdentities.add(event.payload.workerIdentity);
      node.managerIdentities.add(event.payload.assignment.managerIdentity);
      if (activeDirective) node.reworkDirectiveByAttempt.set(event.attempt, activeDirective);
      node.workReservationIdsByAttempt.set(
        event.attempt,
        event.payload.input.capacityReservations.map((reservation) => reservation.id),
      );
      state.nodeStartsTotal += 1;
      node.state = 'RUNNING';
    } else {
      requireCondition(event.attempt === node.attempt, 'INVALID_TRANSITION', `${event.eventId} attempt does not match active attempt ${node.attempt}`, event.eventId);

      if (event.type === 'OUTPUT_PRODUCED') {
        requireExactKeys(event.payload, ['schema', 'producerIdentity', 'result', 'artifacts', 'capacitySettlements'], 'OUTPUT_PRODUCED.payload', event.eventId);
        requireCondition(event.payload.schema === HYPERTREE_OUTPUT_SCHEMA, 'CONTRACT_VIOLATION', 'node output schema drift', event.eventId);
        requireNonemptyString(event.payload.producerIdentity, 'OUTPUT_PRODUCED.payload.producerIdentity', event.eventId);
        requireCondition(IDENTITY_RE.test(event.payload.producerIdentity), 'INVALID_EVENT', 'producerIdentity is invalid', event.eventId);
        requireCondition(event.payload.result === 'CANDIDATE', 'INVALID_EVENT', 'output result must be CANDIDATE', event.eventId);
        validateArtifacts(event.payload.artifacts, 'output.artifacts', event.eventId);
        requireCondition(
          event.payload.artifacts.length <= definition.limits.maxArtifactsPerOutput,
          'BUDGET_EXCEEDED',
          `${node.nodeId} output exceeds maxArtifactsPerOutput`,
          event.eventId,
        );
        requireCondition(
          event.payload.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0)
            <= definition.limits.maxOutputBytesPerAttempt,
          'BUDGET_EXCEEDED',
          `${node.nodeId} output exceeds maxOutputBytesPerAttempt`,
          event.eventId,
        );
        requireCondition(node.state === 'RUNNING', 'INVALID_TRANSITION', `${node.nodeId} output requires RUNNING`, event.eventId);
        requireCondition(event.payload.producerIdentity === node.workerByAttempt.get(event.attempt), 'AUTHORITY_COLLISION', `${node.nodeId} output producer is not the assigned worker`, event.eventId);
        const producedKinds = event.payload.artifacts.map((artifact) => artifact.kind);
        const undeclared = producedKinds.filter((kind) => !contract.output.requiredArtifactKinds.includes(kind));
        requireCondition(undeclared.length === 0, 'CONTRACT_VIOLATION', `${node.nodeId} undeclared output kinds are quarantined: ${undeclared.join(', ')}`, event.eventId);
        requireCondition(
          sameMembers(producedKinds, contract.output.requiredArtifactKinds),
          'CONTRACT_VIOLATION',
          `${node.nodeId} candidate output must exactly satisfy the declared artifact kinds before checks or review`,
          event.eventId,
        );
        const reworkDirective = node.reworkDirectiveByAttempt.get(event.attempt);
        requireCondition(
          !reworkDirective || reworkDirective.requiredArtifactKinds.every((kind) => producedKinds.includes(kind)),
          'CONTRACT_VIOLATION',
          `${node.nodeId} output does not satisfy its rework evidence contract`,
          event.eventId,
        );
        requireCondition(Array.isArray(event.payload.capacitySettlements), 'INVALID_EVENT', 'output.capacitySettlements must be an array', event.eventId);
        const workReservationIds = node.workReservationIdsByAttempt.get(event.attempt) ?? [];
        requireCondition(
          event.payload.capacitySettlements.length === workReservationIds.length,
          'CONTRACT_VIOLATION',
          `${node.nodeId} output must settle every work reservation exactly once`,
          event.eventId,
        );
        requireCondition(
          sameMembers(
            event.payload.capacitySettlements.map((settlement) => settlement.reservationId),
            workReservationIds,
          ),
          'CONTRACT_VIOLATION',
          `${node.nodeId} output settlements drift from its work reservations`,
          event.eventId,
        );
        for (const [index, settlement] of event.payload.capacitySettlements.entries()) {
          settleCapacityReservation(
            state,
            settlement,
            { reservationId: settlement.reservationId, nodeId: node.nodeId, attempt: event.attempt },
            `output.capacitySettlements[${index}]`,
            event.eventId,
          );
        }
        node.outputByAttempt.set(event.attempt, structuredClone(event.payload));
        node.outputEventByAttempt.set(event.attempt, event.eventId);
        node.state = 'AWAITING_CHECKS';
      } else if (event.type === 'CHECKS_COMPLETED') {
        requireExactKeys(event.payload, ['checks'], 'CHECKS_COMPLETED.payload', event.eventId);
        validateChecks(event.payload.checks, event.eventId);
        requireCondition(node.state === 'AWAITING_CHECKS', 'INVALID_TRANSITION', `${node.nodeId} checks require AWAITING_CHECKS`, event.eventId);
        requireCondition(sameMembers(event.payload.checks.map((check) => check.id), definition.reviewPolicy.floor.requiredChecks), 'CONTRACT_VIOLATION', `${node.nodeId} checks must exactly cover the deterministic floor`, event.eventId);
        node.checksByAttempt.set(event.attempt, structuredClone(event.payload.checks));
        node.checkEventByAttempt.set(event.attempt, event.eventId);
        node.state = event.payload.checks.every((check) => check.status === 'PASS')
          ? 'AWAITING_REVIEW'
          : 'REWORK_REQUIRED';
      } else if (event.type === 'REVIEW_COMPLETED') {
        requireExactKeys(
          event.payload,
          [
            'reviewerIdentity', 'reviewerClass', 'producerIdentity', 'verdict',
            'capacityReservation', 'capacitySettlement', 'findings',
          ],
          'REVIEW_COMPLETED.payload',
          event.eventId,
        );
        requireNonemptyString(event.payload.reviewerIdentity, 'reviewerIdentity', event.eventId);
        requireNonemptyString(event.payload.producerIdentity, 'producerIdentity', event.eventId);
        requireCondition(IDENTITY_RE.test(event.payload.reviewerIdentity), 'INVALID_EVENT', 'reviewerIdentity is invalid', event.eventId);
        requireCondition(IDENTITY_RE.test(event.payload.producerIdentity), 'INVALID_EVENT', 'producerIdentity is invalid', event.eventId);
        requireCondition(event.payload.reviewerClass === 'low-cost-independent' || event.payload.reviewerClass === 'specialist', 'INVALID_EVENT', 'unknown reviewer class', event.eventId);
        requireCondition(event.payload.verdict === 'APPROVE' || event.payload.verdict === 'REWORK' || event.payload.verdict === 'ESCALATE', 'INVALID_EVENT', 'unknown review verdict', event.eventId);
        validateFindings(event.payload.findings, event.eventId);
        requireCondition(node.state === 'AWAITING_REVIEW', 'INVALID_TRANSITION', `${node.nodeId} review requires AWAITING_REVIEW`, event.eventId);
        requireCondition(node.outputByAttempt.has(event.attempt) && node.checksByAttempt.has(event.attempt), 'INVALID_TRANSITION', `${node.nodeId} review requires output and checks`, event.eventId);
        requireCondition(event.payload.producerIdentity === node.workerByAttempt.get(event.attempt), 'AUTHORITY_COLLISION', `${node.nodeId} review names the wrong producer`, event.eventId);
        requireCondition(event.payload.reviewerIdentity !== event.payload.producerIdentity, 'AUTHORITY_COLLISION', `${node.nodeId} producer cannot self-review`, event.eventId);
        requireCondition(
          !node.producerIdentities.has(event.payload.reviewerIdentity)
            && !node.managerIdentities.has(event.payload.reviewerIdentity),
          'AUTHORITY_COLLISION',
          `${node.nodeId} reviewer identity previously held a producer or manager role`,
          event.eventId,
        );
        requireCondition(contract.requiredReviewerClasses.includes(event.payload.reviewerClass), 'CONTRACT_VIOLATION', `${node.nodeId} received undeclared reviewer class`, event.eventId);
        const identities = node.reviewerIdentitiesByAttempt.get(event.attempt) ?? new Set<string>();
        requireCondition(!identities.has(event.payload.reviewerIdentity), 'AUTHORITY_COLLISION', `${node.nodeId} reviewer identity cannot fill multiple roles`, event.eventId);
        const reviewedClasses = node.reviewedClassesByAttempt.get(event.attempt) ?? new Set<ReviewerClass>();
        requireCondition(!reviewedClasses.has(event.payload.reviewerClass), 'AUTHORITY_COLLISION', `${node.nodeId} reviewer class ${event.payload.reviewerClass} is already filled`, event.eventId);
        const classLimit = event.payload.reviewerClass === 'specialist'
          ? definition.reviewPolicy.specialistReview.maxUnitsPerReview
          : definition.reviewPolicy.independentReview.maxUnitsPerReview;
        const purpose = event.payload.reviewerClass === 'specialist'
          ? 'review:specialist' as const
          : 'review:low-cost-independent' as const;
        validateCapacityReservation(
          definition,
          state,
          event.payload.capacityReservation,
          { purpose, nodeId: node.nodeId, attempt: event.attempt },
          occurredAtMs,
          'REVIEW_COMPLETED.payload.capacityReservation',
          event.eventId,
        );
        requireCondition(
          event.payload.capacityReservation.reservedUnits <= classLimit,
          'BUDGET_EXCEEDED',
          `${node.nodeId} review reservation exceeds class limit`,
          event.eventId,
        );
        settleCapacityReservation(
          state,
          event.payload.capacitySettlement,
          {
            reservationId: event.payload.capacityReservation.id,
            nodeId: node.nodeId,
            attempt: event.attempt,
          },
          'REVIEW_COMPLETED.payload.capacitySettlement',
          event.eventId,
        );

        if (event.payload.verdict === 'APPROVE') {
          const checks = node.checksByAttempt.get(event.attempt)!;
          requireCondition(checks.every((check) => check.status === 'PASS'), 'CONTRACT_VIOLATION', `${node.nodeId} approval requires every check PASS`, event.eventId);
          const producedKinds = node.outputByAttempt.get(event.attempt)!.artifacts.map((artifact) => artifact.kind);
          requireCondition(sameMembers(producedKinds, contract.output.requiredArtifactKinds), 'CONTRACT_VIOLATION', `${node.nodeId} approval requires all declared outputs exactly once`, event.eventId);
          requireCondition(event.payload.findings.every((finding) => finding.severity !== 'blocking'), 'CONTRACT_VIOLATION', `${node.nodeId} approval retains a blocking finding`, event.eventId);
        } else if (event.payload.verdict === 'REWORK') {
          requireCondition(event.payload.findings.length > 0, 'CONTRACT_VIOLATION', `${node.nodeId} REWORK requires findings`, event.eventId);
        }

        identities.add(event.payload.reviewerIdentity);
        reviewedClasses.add(event.payload.reviewerClass);
        node.reviewerIdentitiesByAttempt.set(event.attempt, identities);
        node.reviewerIdentities.add(event.payload.reviewerIdentity);
        node.reviewedClassesByAttempt.set(event.attempt, reviewedClasses);
        node.latestReviewByAttempt.set(event.attempt, structuredClone(event.payload));
        const reviewEventIds = node.reviewEventIdsByAttempt.get(event.attempt) ?? [];
        reviewEventIds.push(event.eventId);
        node.reviewEventIdsByAttempt.set(event.attempt, reviewEventIds);
        if (event.payload.verdict === 'APPROVE') {
          const approvals = node.approvedReviewerClassesByAttempt.get(event.attempt) ?? new Set<ReviewerClass>();
          approvals.add(event.payload.reviewerClass);
          node.approvedReviewerClassesByAttempt.set(event.attempt, approvals);
          node.state = contract.requiredReviewerClasses.every((reviewerClass) => approvals.has(reviewerClass))
            ? 'AWAITING_MANAGER'
            : 'AWAITING_REVIEW';
        } else {
          node.state = event.payload.verdict === 'REWORK' ? 'REWORK_REQUIRED' : 'ESCALATED';
          if (event.payload.verdict === 'ESCALATE') state.runState = 'HALTED';
        }
      } else if (event.type === 'REWORK_REQUESTED') {
        requireExactKeys(event.payload, ['targetNodeId', 'targetAttempt', 'findings', 'requiredArtifactKinds'], 'REWORK_REQUESTED.payload', event.eventId);
        requireNonemptyString(event.payload.targetNodeId, 'targetNodeId', event.eventId);
        requireInteger(event.payload.targetAttempt, 'targetAttempt', 1, event.eventId);
        validateReworkFindingRefs(event.payload.findings, 'findings', event.eventId);
        requireUniqueStrings(event.payload.requiredArtifactKinds, 'requiredArtifactKinds', { eventId: event.eventId });
        const review = node.latestReviewByAttempt.get(event.attempt);
        const latestReviewEventId = (node.reviewEventIdsByAttempt.get(event.attempt) ?? []).at(-1);
        const checkEventId = node.checkEventByAttempt.get(event.attempt);
        const failedChecks = (node.checksByAttempt.get(event.attempt) ?? [])
          .filter((check) => check.status !== 'PASS');
        requireCondition(node.state === 'REWORK_REQUIRED', 'INVALID_TRANSITION', `${node.nodeId} rework request requires REWORK_REQUIRED`, event.eventId);
        requireCondition(event.payload.targetNodeId === node.nodeId, 'CONTRACT_VIOLATION', `${node.nodeId} rework target must be explicit and local`, event.eventId);
        const expectedFindings: ReworkFindingRef[] = review?.verdict === 'REWORK' && latestReviewEventId
          ? review.findings.map((finding) => ({
            id: finding.id,
            sourceEventId: latestReviewEventId,
            evidenceUri: finding.evidenceUri,
          }))
          : checkEventId
            ? failedChecks.map((check) => ({
              id: check.id,
              sourceEventId: checkEventId,
              evidenceUri: check.evidenceUri,
            }))
            : [];
        requireCondition(expectedFindings.length > 0, 'INVALID_TRANSITION', `${node.nodeId} rework lacks a failed check or REWORK verdict`, event.eventId);
        requireCondition(sameFindingRefs(event.payload.findings, expectedFindings), 'CONTRACT_VIOLATION', `${node.nodeId} rework findings drift from their source evidence`, event.eventId);
        registerRework(
          definition,
          state,
          node,
          contract,
          event.eventId,
          event.payload.findings,
          event.payload.requiredArtifactKinds,
          event.payload.targetAttempt,
        );
      } else if (event.type === 'MANAGER_DECIDED') {
        requireExactKeys(
          event.payload,
          [
            'managerIdentity', 'capacityReservation', 'capacitySettlement', 'decision',
            'reasoningEvidenceIds', 'bypassedGateIds', 'assignments', 'rework',
          ],
          'MANAGER_DECIDED.payload',
          event.eventId,
        );
        requireNonemptyString(event.payload.managerIdentity, 'managerIdentity', event.eventId);
        requireCondition(IDENTITY_RE.test(event.payload.managerIdentity), 'INVALID_EVENT', 'managerIdentity is invalid', event.eventId);
        requireUniqueStrings(event.payload.reasoningEvidenceIds, 'reasoningEvidenceIds', { eventId: event.eventId });
        requireCondition(Array.isArray(event.payload.bypassedGateIds) && event.payload.bypassedGateIds.length === 0, 'CONTRACT_VIOLATION', 'manager may not bypass gates', event.eventId);
        requireCondition(Array.isArray(event.payload.assignments), 'INVALID_EVENT', 'assignments must be an array', event.eventId);
        requireCondition(event.payload.assignments.length <= MAX_MANAGER_ASSIGNMENTS, 'BUDGET_EXCEEDED', `manager assignments may not exceed ${MAX_MANAGER_ASSIGNMENTS}`, event.eventId);
        event.payload.assignments.forEach((assignment, index) => {
          requireExactKeys(assignment, ['nodeId', 'roleId', 'reason'], `assignments[${index}]`, event.eventId);
          requireNonemptyString(assignment.nodeId, `assignments[${index}].nodeId`, event.eventId);
          requireNonemptyString(assignment.roleId, `assignments[${index}].roleId`, event.eventId);
          requireNonemptyString(assignment.reason, `assignments[${index}].reason`, event.eventId);
          requireCondition(state.nodes.has(assignment.nodeId), 'CONTRACT_VIOLATION', `assignments[${index}].nodeId is outside execution scope`, event.eventId);
          requireCondition(SLUG_RE.test(assignment.roleId), 'INVALID_EVENT', `assignments[${index}].roleId must be a slug`, event.eventId);
        });
        requireCondition(
          new Set(event.payload.assignments.map((assignment) => `${assignment.nodeId}\u0000${assignment.roleId}`)).size
            === event.payload.assignments.length,
          'CONTRACT_VIOLATION',
          'manager assignments must be unique by node and role',
          event.eventId,
        );
        requireCondition(['APPROVE_NODE', 'CONTINUE', 'ADD_ROLE', 'ESCALATE', 'HALT'].includes(event.payload.decision), 'INVALID_EVENT', 'unknown manager decision', event.eventId);
        requireCondition(node.state === 'AWAITING_MANAGER', 'INVALID_TRANSITION', `${node.nodeId} manager decision requires AWAITING_MANAGER`, event.eventId);
        requireCondition(
          !node.producerIdentities.has(event.payload.managerIdentity)
            && !node.reviewerIdentities.has(event.payload.managerIdentity),
          'AUTHORITY_COLLISION',
          `${node.nodeId} manager must differ from every producer and reviewer in node history`,
          event.eventId,
        );
        requireCondition(
          event.payload.managerIdentity === node.assignmentManagerByAttempt.get(event.attempt),
          'AUTHORITY_COLLISION',
          `${node.nodeId} manager decision must come from the manager named by the attempt assignment receipt`,
          event.eventId,
        );
        requireCondition(
          !node.managerEventByAttempt.has(event.attempt),
          'INVALID_TRANSITION',
          `${node.nodeId} attempt ${event.attempt} already has a manager decision`,
          event.eventId,
        );
        const approvals = node.approvedReviewerClassesByAttempt.get(event.attempt) ?? new Set<ReviewerClass>();
        requireCondition(contract.requiredReviewerClasses.every((reviewerClass) => approvals.has(reviewerClass)), 'CONTRACT_VIOLATION', `${node.nodeId} manager requires all declared reviewer approvals`, event.eventId);
        requireCondition(
          sameMembers(event.payload.reasoningEvidenceIds, expectedManagerEvidenceIds(node, event.attempt)),
          'CONTRACT_VIOLATION',
          `${node.nodeId} manager reasoning must bind output, checks, and every required review`,
          event.eventId,
        );
        requireCondition(
          event.payload.decision === 'ADD_ROLE' ? event.payload.assignments.length > 0 : event.payload.assignments.length === 0,
          'CONTRACT_VIOLATION',
          'only ADD_ROLE may carry assignments, and ADD_ROLE requires at least one',
          event.eventId,
        );
        requireCondition(
          event.payload.decision === 'CONTINUE' ? event.payload.rework !== null : event.payload.rework === null,
          'CONTRACT_VIOLATION',
          'only CONTINUE may carry a rework directive, and CONTINUE requires one',
          event.eventId,
        );
        if (event.payload.rework !== null) {
          requireExactKeys(event.payload.rework, ['findings', 'requiredArtifactKinds'], 'MANAGER_DECIDED.payload.rework', event.eventId);
          validateFindings(event.payload.rework.findings, event.eventId);
          requireCondition(
            event.payload.rework.findings.length > 0,
            'CONTRACT_VIOLATION',
            'manager CONTINUE requires at least one evidence-bearing finding',
            event.eventId,
          );
          requireUniqueStrings(event.payload.rework.requiredArtifactKinds, 'MANAGER_DECIDED.payload.rework.requiredArtifactKinds', { eventId: event.eventId });
        }
        validateCapacityReservation(
          definition,
          state,
          event.payload.capacityReservation,
          { purpose: 'manager', nodeId: node.nodeId, attempt: event.attempt },
          occurredAtMs,
          'MANAGER_DECIDED.payload.capacityReservation',
          event.eventId,
        );
        requireCondition(
          event.payload.capacityReservation.reservedUnits <= definition.reviewPolicy.managerGate.maxUnitsPerDecision,
          'BUDGET_EXCEEDED',
          `${node.nodeId} manager reservation exceeds decision limit`,
          event.eventId,
        );
        settleCapacityReservation(
          state,
          event.payload.capacitySettlement,
          {
            reservationId: event.payload.capacityReservation.id,
            nodeId: node.nodeId,
            attempt: event.attempt,
          },
          'MANAGER_DECIDED.payload.capacitySettlement',
          event.eventId,
        );
        if (event.payload.decision === 'ADD_ROLE') {
          requireCondition(state.topologyMutations + 1 <= definition.limits.maxTopologyMutations, 'BUDGET_EXCEEDED', 'manager exceeds maxTopologyMutations', event.eventId);
          state.topologyMutations += 1;
        }
        node.managerDecision = event.payload.decision;
        node.managerEventByAttempt.set(event.attempt, event.eventId);
        node.managerIdentities.add(event.payload.managerIdentity);
        if (event.payload.decision === 'APPROVE_NODE') {
          node.state = 'AWAITING_MANAGER';
        } else if (event.payload.decision === 'CONTINUE' && event.payload.rework !== null) {
          registerRework(
            definition,
            state,
            node,
            contract,
            event.eventId,
            event.payload.rework.findings.map((finding) => ({
              id: finding.id,
              sourceEventId: event.eventId,
              evidenceUri: finding.evidenceUri,
            })),
            event.payload.rework.requiredArtifactKinds,
            event.attempt + 1,
          );
        } else {
          node.state = 'ESCALATED';
          state.runState = 'HALTED';
        }
      } else if (event.type === 'NODE_APPROVED') {
        requireExactKeys(event.payload, ['approvalEvidenceIds'], 'NODE_APPROVED.payload', event.eventId);
        requireUniqueStrings(event.payload.approvalEvidenceIds, 'approvalEvidenceIds', { eventId: event.eventId });
        requireCondition(node.state === 'AWAITING_MANAGER' && node.managerDecision === 'APPROVE_NODE', 'INVALID_TRANSITION', `${node.nodeId} approval requires manager APPROVE_NODE`, event.eventId);
        const expectedEvidence = [
          node.outputEventByAttempt.get(event.attempt),
          node.checkEventByAttempt.get(event.attempt),
          ...(node.reviewEventIdsByAttempt.get(event.attempt) ?? []),
          node.managerEventByAttempt.get(event.attempt),
        ].filter((value): value is string => Boolean(value));
        requireCondition(sameMembers(event.payload.approvalEvidenceIds, expectedEvidence), 'CONTRACT_VIOLATION', `${node.nodeId} approval evidence must bind output, checks, reviews, and manager decision`, event.eventId);
        node.state = 'APPROVED';
        refreshEligibility(state);
      }
    }
  }

  state.previousOccurredAtMs = occurredAtMs;
  state.asOfSequence = event.sequence;
  state.asOfEventId = event.eventId;
}

export class HypertreeExecutionReducer {
  readonly definition: HypertreeExecutionDefinition;
  private state: InternalRunState;

  constructor(definition: HypertreeExecutionDefinition) {
    validateHypertreeExecutionDefinition(definition);
    this.definition = structuredClone(definition);
    this.state = initialRunState(this.definition);
  }

  get projection(): HypertreeExecutionProjectionV1 {
    return structuredClone(projectionFor(this.definition, this.state));
  }

  apply(event: HypertreeExecutionEvent): HypertreeProjectionUpdateV1 | null {
    const canonical = canonicalJson(event);
    requireCondition(
      Buffer.byteLength(canonical, 'utf8') <= MAX_EVENT_ENVELOPE_BYTES,
      'INVALID_EVENT',
      `event may not exceed ${MAX_EVENT_ENVELOPE_BYTES} canonical UTF-8 bytes`,
      typeof event?.eventId === 'string' ? event.eventId : null,
    );
    validateEventEnvelope(event);
    if (validateCursor(this.state, event, canonical)) return null;

    const candidate = structuredClone(this.state);
    applyNewEvent(this.definition, candidate, structuredClone(event));
    const projection = projectionFor(this.definition, candidate);
    const update: HypertreeProjectionUpdateV1 = {
      schema: HYPERTREE_PROJECTION_UPDATE_SCHEMA,
      reducerVersion: HYPERTREE_REDUCER_VERSION,
      executionId: this.definition.executionId,
      planId: this.definition.plan.id,
      planDigest: this.definition.plan.digest,
      definitionDigest: this.definition.definitionDigest,
      sequence: event.sequence,
      eventId: event.eventId,
      previousSequence: this.state.asOfSequence,
      previousEventId: this.state.asOfEventId,
      projectionDigest: digestHypertreeProjection(projection),
      projection,
    };
    candidate.eventCanonicalById.set(event.eventId, canonical);
    candidate.acceptedEventCanonicals.push(canonical);
    this.state = candidate;
    return structuredClone(update);
  }

  replay(events: readonly HypertreeExecutionEvent[]): HypertreeExecutionProjectionV1 {
    for (const event of events) this.apply(event);
    return this.projection;
  }
}

export function reduceHypertreeExecution(
  definition: HypertreeExecutionDefinition,
  events: readonly HypertreeExecutionEvent[],
): HypertreeExecutionProjectionV1 {
  return new HypertreeExecutionReducer(definition).replay(events);
}
