/**
 * Closed wire and reducer types for Drydock hypertree execution.
 *
 * This module contains no I/O and grants no authority. Event admission belongs
 * to the controller-side reducer; operator clients consume only the resulting
 * projection snapshots and projection-update envelopes.
 */

export const HYPERTREE_INPUT_SCHEMA =
  'https://portdaddy.dev/schemas/hypertree-node-input.v1.json' as const;
export const HYPERTREE_OUTPUT_SCHEMA =
  'https://portdaddy.dev/schemas/hypertree-node-output.v1.json' as const;
export const HYPERTREE_PROJECTION_SCHEMA =
  'https://portdaddy.dev/schemas/hypertree-execution-projection.v1.json' as const;
export const HYPERTREE_PROJECTION_UPDATE_SCHEMA =
  'https://portdaddy.dev/schemas/hypertree-execution-projection-update.v1.json' as const;
export const HYPERTREE_REDUCER_VERSION = 'drydock-hypertree-reducer.v1' as const;

export type Digest = `sha256:${string}`;
export type EvidenceUri = `evidence://${string}`;

export interface HypertreeTopology {
  eligibility: 'dag';
  qualityRouting: 'bounded-workflow';
  staffing: 'manager-driven-rounds';
  observation: 'append-only-event-projection';
}

export interface ArtifactRef {
  id: string;
  kind: string;
  mediaType: string;
  byteLength: number;
  digest: Digest;
  evidenceUri: EvidenceUri;
}

export interface CapacityBudget {
  id: string;
  providerId: string;
  accountRef: string;
  unit: string;
  maxReservedUnits: number;
}

export type CapacityPurpose =
  | 'work'
  | 'review:low-cost-independent'
  | 'review:specialist'
  | 'manager';

export interface CapacityReservationRef {
  id: string;
  idempotencyKey: string;
  budgetId: string;
  purpose: CapacityPurpose;
  executionId: string;
  nodeId: string;
  attempt: number;
  reservedUnits: number;
  expiresAt: string;
  receiptDigest: Digest;
  evidenceUri: EvidenceUri;
}

export interface CapacitySettlementRef {
  reservationId: string;
  outcome: 'CONSUMED' | 'RELEASED' | 'UNKNOWN';
  usedUnits: number;
  receiptDigest: Digest;
  evidenceUri: EvidenceUri;
}

export interface AssignmentRef {
  round: number;
  managerIdentity: string;
  roleId: string;
  receiptDigest: Digest;
  evidenceUri: EvidenceUri;
}

export interface HypertreeNodeDependency {
  nodeId: string;
  dependsOnNodeIds: string[];
}

export interface ReworkFindingRef {
  id: string;
  sourceEventId: string;
  evidenceUri: EvidenceUri;
}

export interface ReworkDirective {
  eventId: string;
  findings: ReworkFindingRef[];
  requiredArtifactKinds: string[];
}

export type CheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  evidenceUri: EvidenceUri;
}

export type FindingSeverity = 'blocking' | 'major' | 'minor';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  summary: string;
  evidenceUri: EvidenceUri;
}

export type ReviewerClass = 'low-cost-independent' | 'specialist';
export type ReviewVerdict = 'APPROVE' | 'REWORK' | 'ESCALATE';
export type ManagerDecision = 'APPROVE_NODE' | 'CONTINUE' | 'ADD_ROLE' | 'ESCALATE' | 'HALT';
export type WitnessClass =
  | 'HOST_OBSERVED'
  | 'BROKER_OBSERVED'
  | 'GUEST_ASSERTED'
  | 'MODEL_CHECKED'
  | 'OPERATOR_OBSERVED';

export interface NodeInput {
  schema: typeof HYPERTREE_INPUT_SCHEMA;
  nodeContractId: string;
  planDigest: Digest;
  definitionDigest: Digest;
  artifacts: ArtifactRef[];
  priorAttemptArtifactIds: string[];
  reworkDirective: ReworkDirective | null;
  capabilitySetDigest: Digest;
  capacityReservations: CapacityReservationRef[];
}

export interface NodeContract {
  id: string;
  nodeId: string;
  input: {
    schema: typeof HYPERTREE_INPUT_SCHEMA;
    requiredArtifactKinds: string[];
    undeclaredInputs: 'deny';
  };
  output: {
    schema: typeof HYPERTREE_OUTPUT_SCHEMA;
    requiredArtifactKinds: string[];
    undeclaredOutputs: 'quarantine';
  };
  riskClasses: Array<
    'identity' | 'authority' | 'money' | 'security' | 'lifecycle' | 'release' | 'destructive-effect'
  >;
  requiredReviewerClasses: ReviewerClass[];
  reviewPolicyId: 'drydock-bounded-review-v1';
}

export interface ReviewPolicy {
  id: 'drydock-bounded-review-v1';
  floor: {
    kind: 'deterministic';
    requiredBeforeReview: true;
    requiredChecks: string[];
  };
  independentReview: {
    required: true;
    routing: 'lowest-capable-reviewed-tier';
    reviewerMustDifferFromProducer: true;
    reservationUnit: 'provider-native-units';
    maxUnitsPerReview: number;
  };
  specialistReview: {
    trigger: 'failureProbability*downstreamWaste>reviewCost';
    mandatoryRiskClasses: NodeContract['riskClasses'];
    uncertainMeans: 'escalate';
    reservationUnit: 'provider-native-units';
    maxUnitsPerReview: number;
  };
  managerGate: {
    mode: 'risk-triggered-and-terminal';
    managerMustDifferFromProducerAndReviewer: true;
    mayWaiveChecks: false;
    maySelfApprove: false;
    reservationUnit: 'provider-native-units';
    maxUnitsPerDecision: number;
    requiredEvidence: string[];
  };
  rework: {
    verdicts: ['APPROVE', 'REWORK', 'ESCALATE'];
    targetMustBeNamed: true;
    findingIdsRequired: true;
    sameFindingRepeatLimit: number;
  };
}

export interface ExecutionLimits {
  maxScopeNodes: number;
  maxEvents: number;
  maxNodeStartsTotal: number;
  maxCapacityReservationsTotal: number;
  maxArtifactsPerOutput: number;
  maxOutputBytesPerAttempt: number;
  maxNodeAttempts: number;
  maxReworkRounds: number;
  maxManagerRounds: number;
  maxTopologyMutations: number;
  maxWallClockSeconds: number;
  maxRecursiveBirths: 0;
  retryOwner: 'external-controller';
  retryLayers: 1;
}

export interface HypertreeExecutionDefinition {
  executionId: string;
  definitionDigest: Digest;
  plan: {
    id: string;
    digest: Digest;
    topology: HypertreeTopology;
  };
  authorityModel: {
    eventAdmission: 'controller-only';
    projectionReducer: 'controller-typescript';
    clientAuthority: 'projection-only';
  };
  scopeNodeIds: string[];
  nodeDependencies: HypertreeNodeDependency[];
  capacityBudgets: CapacityBudget[];
  projectionSchema: typeof HYPERTREE_PROJECTION_SCHEMA;
  nodeContracts: NodeContract[];
  reviewPolicy: ReviewPolicy;
  limits: ExecutionLimits;
  truthState: ProjectionTruthState;
  staleAfterSeconds: number;
}

interface EventBase<TType extends string, TPayload> {
  sequence: number;
  eventId: string;
  previousEventId: string | null;
  type: TType;
  occurredAt: string;
  witnessClass: WitnessClass;
  nodeId: string | null;
  attempt: number | null;
  payload: TPayload;
}

export type RunOpenedEvent = EventBase<'RUN_OPENED', {
  planDigest: Digest;
  definitionDigest: Digest;
  scopeNodeIds: string[];
}> & { nodeId: null; attempt: null };

export type NodeStartedEvent = EventBase<'NODE_STARTED', {
  workerIdentity: string;
  assignment: AssignmentRef;
  input: NodeInput;
}> & { nodeId: string; attempt: number };

export type OutputProducedEvent = EventBase<'OUTPUT_PRODUCED', {
  schema: typeof HYPERTREE_OUTPUT_SCHEMA;
  producerIdentity: string;
  result: 'CANDIDATE';
  artifacts: ArtifactRef[];
  capacitySettlements: CapacitySettlementRef[];
}> & { nodeId: string; attempt: number };

export type ChecksCompletedEvent = EventBase<'CHECKS_COMPLETED', {
  checks: CheckResult[];
}> & { nodeId: string; attempt: number };

export type ReviewCompletedEvent = EventBase<'REVIEW_COMPLETED', {
  reviewerIdentity: string;
  reviewerClass: ReviewerClass;
  producerIdentity: string;
  verdict: ReviewVerdict;
  capacityReservation: CapacityReservationRef;
  capacitySettlement: CapacitySettlementRef;
  findings: ReviewFinding[];
}> & { nodeId: string; attempt: number };

export type ReworkRequestedEvent = EventBase<'REWORK_REQUESTED', {
  targetNodeId: string;
  targetAttempt: number;
  findings: ReworkFindingRef[];
  requiredArtifactKinds: string[];
}> & { nodeId: string; attempt: number };

interface ManagerDecisionBase {
  managerIdentity: string;
  capacityReservation: CapacityReservationRef;
  capacitySettlement: CapacitySettlementRef;
  reasoningEvidenceIds: string[];
  bypassedGateIds: [];
}

export type ManagerDecidedEvent = EventBase<'MANAGER_DECIDED',
  | (ManagerDecisionBase & {
      decision: 'APPROVE_NODE' | 'ESCALATE' | 'HALT';
      assignments: [];
      rework: null;
    })
  | (ManagerDecisionBase & {
      decision: 'CONTINUE';
      assignments: [];
      rework: {
        findings: ReviewFinding[];
        requiredArtifactKinds: string[];
      };
    })
  | (ManagerDecisionBase & {
      decision: 'ADD_ROLE';
      assignments: Array<{ nodeId: string; roleId: string; reason: string }>;
      rework: null;
    })
> & { nodeId: string; attempt: number };

export type NodeApprovedEvent = EventBase<'NODE_APPROVED', {
  approvalEvidenceIds: string[];
}> & { nodeId: string; attempt: number };

export type RunCompletedEvent = EventBase<'RUN_COMPLETED', {
  terminalNodeIds: string[];
  evidenceRoot: Digest;
}> & { nodeId: null; attempt: null };

export type HypertreeExecutionEvent =
  | RunOpenedEvent
  | NodeStartedEvent
  | OutputProducedEvent
  | ChecksCompletedEvent
  | ReviewCompletedEvent
  | ReworkRequestedEvent
  | ManagerDecidedEvent
  | NodeApprovedEvent
  | RunCompletedEvent;

export type RunState = 'OPEN' | 'RUNNING' | 'COMPLETED' | 'HALTED' | 'FAILED' | 'UNKNOWN';
export type ProjectedNodeState =
  | 'BLOCKED'
  | 'ELIGIBLE'
  | 'RUNNING'
  | 'AWAITING_CHECKS'
  | 'AWAITING_REVIEW'
  | 'REWORK_REQUIRED'
  | 'AWAITING_MANAGER'
  | 'APPROVED'
  | 'FAILED'
  | 'ESCALATED'
  | 'CANCELLED'
  | 'QUARANTINED';
export type ProjectionTruthState = 'FIXTURE' | 'LIVE' | 'STALE' | 'OFFLINE' | 'UNKNOWN';

export interface ProjectedHypertreeNode {
  nodeId: string;
  dependsOnNodeIds: string[];
  state: ProjectedNodeState;
  attempt: number;
  reworkRounds: number;
  latestEventId: string | null;
  checkStatus: CheckStatus;
  reviewVerdict: ReviewVerdict | null;
  managerDecision: ManagerDecision | null;
  artifactIds: string[];
}

export interface ProjectedCapacityUsage {
  budgetId: string;
  providerId: string;
  accountRef: string;
  unit: string;
  maxReservedUnits: number;
  reservedUnits: number;
  heldUnits: number;
  usedUnits: number;
  reservationCount: number;
}

export interface HypertreeExecutionProjectionV1 {
  schema: typeof HYPERTREE_PROJECTION_SCHEMA;
  reducerVersion: typeof HYPERTREE_REDUCER_VERSION;
  executionId: string;
  planId: string;
  planDigest: Digest;
  definitionDigest: Digest;
  asOfSequence: number;
  asOfEventId: string | null;
  runState: RunState;
  topology: HypertreeTopology;
  nodes: ProjectedHypertreeNode[];
  capacity: ProjectedCapacityUsage[];
  staleAfter: string | null;
  truthState: ProjectionTruthState;
  terminalEvidenceRoot: Digest | null;
}

export interface HypertreeProjectionUpdateV1 {
  schema: typeof HYPERTREE_PROJECTION_UPDATE_SCHEMA;
  reducerVersion: typeof HYPERTREE_REDUCER_VERSION;
  executionId: string;
  planId: string;
  planDigest: Digest;
  definitionDigest: Digest;
  sequence: number;
  eventId: string;
  previousSequence: number;
  previousEventId: string | null;
  projectionDigest: Digest;
  projection: HypertreeExecutionProjectionV1;
}
