import { canonicalJson } from '../merkle-chain.js';
import {
  HYPERTREE_PROJECTION_SCHEMA,
  HYPERTREE_PROJECTION_UPDATE_SCHEMA,
  HYPERTREE_REDUCER_VERSION,
  type Digest,
  type HypertreeExecutionProjectionV1,
  type HypertreeProjectionUpdateV1,
  type ProjectionTruthState,
} from './hypertree-execution-types.js';
import { digestHypertreeProjection } from './hypertree-execution-reducer.js';

export type ProjectionStreamErrorCode =
  | 'INVALID_UPDATE'
  | 'SCHEMA_MISMATCH'
  | 'AUTHORITY_DRIFT'
  | 'CURSOR_GAP'
  | 'CURSOR_CONFLICT'
  | 'DIGEST_MISMATCH';

export class ProjectionStreamError extends Error {
  constructor(
    readonly code: ProjectionStreamErrorCode,
    message: string,
    readonly requiresRefetch: boolean,
  ) {
    super(message);
    this.name = 'ProjectionStreamError';
  }
}

export interface HypertreeProjectionStreamBinding {
  executionId: string;
  planId: string;
  planDigest: Digest;
  definitionDigest: Digest;
  reducerVersion: typeof HYPERTREE_REDUCER_VERSION;
}

export interface ProjectionStreamApplyResult {
  accepted: true;
  duplicate: boolean;
  projection: HypertreeExecutionProjectionV1;
}

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const EVENT_ID_RE = /^[a-z0-9]+(?:[-:/][a-z0-9]+)*$/;
const NODE_ID_RE = /^DD-[0-9]{3}[A-Z]?$/;
const NODE_STATES = new Set([
  'BLOCKED', 'ELIGIBLE', 'RUNNING', 'AWAITING_CHECKS', 'AWAITING_REVIEW',
  'REWORK_REQUIRED', 'AWAITING_MANAGER', 'APPROVED', 'FAILED', 'ESCALATED',
  'CANCELLED', 'QUARANTINED',
]);
const RUN_STATES = new Set(['OPEN', 'RUNNING', 'COMPLETED', 'HALTED', 'FAILED', 'UNKNOWN']);
const CHECK_STATES = new Set(['PASS', 'FAIL', 'UNKNOWN']);
const REVIEW_VERDICTS = new Set(['APPROVE', 'REWORK', 'ESCALATE']);
const MANAGER_DECISIONS = new Set(['APPROVE_NODE', 'CONTINUE', 'ADD_ROLE', 'ESCALATE', 'HALT']);
const TRUTH_STATES = new Set(['FIXTURE', 'LIVE', 'STALE', 'OFFLINE', 'UNKNOWN']);
const CANONICAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_PROJECTION_NODES = 500;
const MAX_PROJECTION_CAPACITY_BUDGETS = 64;
const MAX_PROJECTION_ENVELOPE_BYTES = 4_194_304;

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function streamFail(
  code: ProjectionStreamErrorCode,
  message: string,
  requiresRefetch: boolean,
): never {
  throw new ProjectionStreamError(code, message, requiresRefetch);
}

function requireUpdate(condition: unknown, message: string): asserts condition {
  if (!condition) streamFail('INVALID_UPDATE', message, true);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): void {
  requireUpdate(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  requireUpdate(canonicalJson(actual) === canonicalJson(expected), `${label} keys must be exactly ${expected.join(', ')}`);
}

function validateProjectionShape(projection: HypertreeExecutionProjectionV1): void {
  exactKeys(
    projection,
    [
      'schema',
      'reducerVersion',
      'executionId',
      'planId',
      'planDigest',
      'definitionDigest',
      'asOfSequence',
      'asOfEventId',
      'runState',
      'topology',
      'nodes',
      'capacity',
      'staleAfter',
      'truthState',
      'terminalEvidenceRoot',
    ],
    'projection',
  );
  requireUpdate(projection.schema === HYPERTREE_PROJECTION_SCHEMA, 'projection schema drift');
  requireUpdate(projection.reducerVersion === HYPERTREE_REDUCER_VERSION, 'projection reducer version drift');
  requireUpdate(typeof projection.executionId === 'string' && EVENT_ID_RE.test(projection.executionId), 'projection executionId is invalid');
  requireUpdate(typeof projection.planId === 'string' && EVENT_ID_RE.test(projection.planId), 'projection planId is invalid');
  requireUpdate(DIGEST_RE.test(projection.planDigest), 'projection planDigest is invalid');
  requireUpdate(DIGEST_RE.test(projection.definitionDigest), 'projection definitionDigest is invalid');
  requireUpdate(Number.isInteger(projection.asOfSequence) && projection.asOfSequence >= 0, 'projection asOfSequence is invalid');
  requireUpdate(
    projection.asOfEventId === null || (typeof projection.asOfEventId === 'string' && EVENT_ID_RE.test(projection.asOfEventId)),
    'projection asOfEventId is invalid',
  );
  requireUpdate(RUN_STATES.has(projection.runState), 'projection runState is invalid');
  requireUpdate(
    canonicalJson(projection.topology) === canonicalJson({
      eligibility: 'dag',
      qualityRouting: 'bounded-workflow',
      staffing: 'manager-driven-rounds',
      observation: 'append-only-event-projection',
    }),
    'projection topology is invalid',
  );
  requireUpdate(
    (projection.asOfSequence === 0 && projection.asOfEventId === null)
      || (projection.asOfSequence > 0 && projection.asOfEventId !== null),
    'projection cursor fields disagree',
  );
  requireUpdate(
    Array.isArray(projection.nodes)
      && projection.nodes.length > 0
      && projection.nodes.length <= MAX_PROJECTION_NODES,
    `projection nodes must contain between 1 and ${MAX_PROJECTION_NODES} entries`,
  );
  const nodeIds = projection.nodes.map((node) => node.nodeId);
  requireUpdate(new Set(nodeIds).size === nodeIds.length, 'projection node ids must be unique');
  requireUpdate(canonicalJson(nodeIds) === canonicalJson([...nodeIds].sort(compareCodePoint)), 'projection nodes must be sorted by nodeId');
  for (const [index, node] of projection.nodes.entries()) {
    exactKeys(
      node,
      [
        'nodeId',
        'dependsOnNodeIds',
        'state',
        'attempt',
        'reworkRounds',
        'latestEventId',
        'checkStatus',
        'reviewVerdict',
        'managerDecision',
        'artifactIds',
      ],
      `projection.nodes[${index}]`,
    );
    requireUpdate(typeof node.nodeId === 'string' && NODE_ID_RE.test(node.nodeId), `projection.nodes[${index}].nodeId is invalid`);
    requireUpdate(Array.isArray(node.dependsOnNodeIds), `projection.nodes[${index}].dependsOnNodeIds must be an array`);
    requireUpdate(node.dependsOnNodeIds.length <= 499, `projection.nodes[${index}].dependsOnNodeIds exceeds 499`);
    requireUpdate(new Set(node.dependsOnNodeIds).size === node.dependsOnNodeIds.length, `projection.nodes[${index}].dependsOnNodeIds must be unique`);
    requireUpdate(
      canonicalJson(node.dependsOnNodeIds) === canonicalJson([...node.dependsOnNodeIds].sort(compareCodePoint)),
      `projection.nodes[${index}].dependsOnNodeIds must be sorted`,
    );
    requireUpdate(
      node.dependsOnNodeIds.every((id) => typeof id === 'string' && NODE_ID_RE.test(id) && nodeIds.includes(id) && id !== node.nodeId),
      `projection.nodes[${index}].dependsOnNodeIds are invalid`,
    );
    requireUpdate(NODE_STATES.has(node.state), `projection.nodes[${index}].state is invalid`);
    requireUpdate(Number.isInteger(node.attempt) && node.attempt >= 0, `projection.nodes[${index}].attempt is invalid`);
    requireUpdate(Number.isInteger(node.reworkRounds) && node.reworkRounds >= 0, `projection.nodes[${index}].reworkRounds is invalid`);
    requireUpdate(
      node.latestEventId === null || (typeof node.latestEventId === 'string' && EVENT_ID_RE.test(node.latestEventId)),
      `projection.nodes[${index}].latestEventId is invalid`,
    );
    requireUpdate(CHECK_STATES.has(node.checkStatus), `projection.nodes[${index}].checkStatus is invalid`);
    requireUpdate(node.reviewVerdict === null || REVIEW_VERDICTS.has(node.reviewVerdict), `projection.nodes[${index}].reviewVerdict is invalid`);
    requireUpdate(node.managerDecision === null || MANAGER_DECISIONS.has(node.managerDecision), `projection.nodes[${index}].managerDecision is invalid`);
    requireUpdate(Array.isArray(node.artifactIds), `projection.nodes[${index}].artifactIds must be an array`);
    requireUpdate(node.artifactIds.length <= 64, `projection.nodes[${index}].artifactIds exceeds 64`);
    requireUpdate(new Set(node.artifactIds).size === node.artifactIds.length, `projection.nodes[${index}].artifactIds must be unique`);
    requireUpdate(node.artifactIds.every((id) => typeof id === 'string' && EVENT_ID_RE.test(id)), `projection.nodes[${index}].artifactIds are invalid`);
  }
  const dependencies = new Map(projection.nodes.map((node) => [node.nodeId, node.dependsOnNodeIds] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    requireUpdate(!visiting.has(nodeId), `projection dependency graph contains a cycle at ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependencyId of dependencies.get(nodeId) ?? []) visit(dependencyId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodeIds) visit(nodeId);
  requireUpdate(
    Array.isArray(projection.capacity)
      && projection.capacity.length > 0
      && projection.capacity.length <= MAX_PROJECTION_CAPACITY_BUDGETS,
    `projection capacity must contain between 1 and ${MAX_PROJECTION_CAPACITY_BUDGETS} entries`,
  );
  const budgetIds = projection.capacity.map((usage) => usage.budgetId);
  requireUpdate(new Set(budgetIds).size === budgetIds.length, 'projection capacity budget ids must be unique');
  requireUpdate(
    canonicalJson(budgetIds) === canonicalJson([...budgetIds].sort(compareCodePoint)),
    'projection capacity must be sorted by budgetId',
  );
  for (const [index, usage] of projection.capacity.entries()) {
    exactKeys(
      usage,
      [
        'budgetId', 'providerId', 'accountRef', 'unit', 'maxReservedUnits',
        'reservedUnits', 'heldUnits', 'usedUnits', 'reservationCount',
      ],
      `projection.capacity[${index}]`,
    );
    requireUpdate(typeof usage.budgetId === 'string' && EVENT_ID_RE.test(usage.budgetId), `projection.capacity[${index}].budgetId is invalid`);
    requireUpdate(typeof usage.providerId === 'string' && EVENT_ID_RE.test(usage.providerId), `projection.capacity[${index}].providerId is invalid`);
    requireUpdate(typeof usage.accountRef === 'string' && EVENT_ID_RE.test(usage.accountRef), `projection.capacity[${index}].accountRef is invalid`);
    requireUpdate(typeof usage.unit === 'string' && EVENT_ID_RE.test(usage.unit), `projection.capacity[${index}].unit is invalid`);
    requireUpdate(Number.isInteger(usage.maxReservedUnits) && usage.maxReservedUnits > 0, `projection.capacity[${index}].maxReservedUnits is invalid`);
    requireUpdate(Number.isInteger(usage.reservedUnits) && usage.reservedUnits >= 0, `projection.capacity[${index}].reservedUnits is invalid`);
    requireUpdate(Number.isInteger(usage.heldUnits) && usage.heldUnits >= 0, `projection.capacity[${index}].heldUnits is invalid`);
    requireUpdate(Number.isInteger(usage.usedUnits) && usage.usedUnits >= 0, `projection.capacity[${index}].usedUnits is invalid`);
    requireUpdate(Number.isInteger(usage.reservationCount) && usage.reservationCount >= 0, `projection.capacity[${index}].reservationCount is invalid`);
    requireUpdate(usage.reservedUnits <= usage.maxReservedUnits, `projection.capacity[${index}] exceeds its reservation budget`);
    requireUpdate(usage.heldUnits + usage.usedUnits <= usage.reservedUnits, `projection.capacity[${index}] accounting is not conservative`);
  }
  requireUpdate(
    projection.staleAfter === null
      || isCanonicalTimestamp(projection.staleAfter),
    'projection staleAfter is invalid',
  );
  requireUpdate(
    projection.asOfSequence === 0 ? projection.staleAfter === null : projection.staleAfter !== null,
    'projection freshness deadline disagrees with its cursor',
  );
  requireUpdate(TRUTH_STATES.has(projection.truthState), 'projection truthState is invalid');
  requireUpdate(
    projection.terminalEvidenceRoot === null || DIGEST_RE.test(projection.terminalEvidenceRoot),
    'projection terminalEvidenceRoot is invalid',
  );
  requireUpdate(
    projection.runState === 'COMPLETED'
      ? projection.terminalEvidenceRoot !== null
      : projection.terminalEvidenceRoot === null,
    'projection terminal evidence disagrees with run state',
  );
  requireUpdate(
    projection.runState !== 'COMPLETED' || projection.capacity.every((usage) => usage.heldUnits === 0),
    'completed projection retains held capacity',
  );
}

function validateUpdateShape(update: HypertreeProjectionUpdateV1): void {
  exactKeys(
    update,
    [
      'schema',
      'reducerVersion',
      'executionId',
      'planId',
      'planDigest',
      'definitionDigest',
      'sequence',
      'eventId',
      'previousSequence',
      'previousEventId',
      'projectionDigest',
      'projection',
    ],
    'projection update',
  );
  requireUpdate(update.schema === HYPERTREE_PROJECTION_UPDATE_SCHEMA, 'projection update schema drift');
  requireUpdate(update.reducerVersion === HYPERTREE_REDUCER_VERSION, 'projection update reducer version drift');
  requireUpdate(typeof update.executionId === 'string' && update.executionId.length > 0, 'projection update executionId is required');
  requireUpdate(typeof update.planId === 'string' && EVENT_ID_RE.test(update.planId), 'projection update planId is invalid');
  requireUpdate(DIGEST_RE.test(update.planDigest), 'projection update planDigest is invalid');
  requireUpdate(DIGEST_RE.test(update.definitionDigest), 'projection update definitionDigest is invalid');
  requireUpdate(Number.isInteger(update.sequence) && update.sequence >= 1, 'projection update sequence is invalid');
  requireUpdate(Number.isInteger(update.previousSequence) && update.previousSequence >= 0, 'projection update previousSequence is invalid');
  requireUpdate(typeof update.eventId === 'string' && EVENT_ID_RE.test(update.eventId), 'projection update eventId is invalid');
  requireUpdate(
    update.previousEventId === null || (typeof update.previousEventId === 'string' && EVENT_ID_RE.test(update.previousEventId)),
    'projection update previousEventId is invalid',
  );
  requireUpdate(DIGEST_RE.test(update.projectionDigest), 'projection update projectionDigest is invalid');
  validateProjectionShape(update.projection);
}

/**
 * Projection-only consumer used by HTML, Swift, and Rust clients.
 *
 * It deliberately has no API for raw execution events. When a cursor is
 * missing, contradictory, or bound to another plan/reducer, callers must
 * refetch a controller-produced snapshot rather than reconstructing authority.
 */
export class HypertreeProjectionStream {
  readonly binding: HypertreeProjectionStreamBinding;
  private currentProjection: HypertreeExecutionProjectionV1 | null = null;
  private currentUpdateCanonical: string | null = null;

  constructor(binding: HypertreeProjectionStreamBinding) {
    if (
      !EVENT_ID_RE.test(binding.executionId)
      || !EVENT_ID_RE.test(binding.planId)
      || !DIGEST_RE.test(binding.planDigest)
      || !DIGEST_RE.test(binding.definitionDigest)
      || binding.reducerVersion !== HYPERTREE_REDUCER_VERSION
    ) {
      streamFail('AUTHORITY_DRIFT', 'projection stream binding is invalid', true);
    }
    this.binding = structuredClone(binding);
  }

  get projection(): HypertreeExecutionProjectionV1 | null {
    return this.currentProjection ? structuredClone(this.currentProjection) : null;
  }

  replaceFromSnapshot(
    projection: HypertreeExecutionProjectionV1,
    projectionDigest: Digest,
  ): HypertreeExecutionProjectionV1 {
    const canonicalProjection = canonicalJson(projection);
    requireUpdate(
      Buffer.byteLength(canonicalProjection, 'utf8') <= MAX_PROJECTION_ENVELOPE_BYTES,
      `projection snapshot may not exceed ${MAX_PROJECTION_ENVELOPE_BYTES} canonical UTF-8 bytes`,
    );
    validateProjectionShape(projection);
    if (
      projection.executionId !== this.binding.executionId
      || projection.planId !== this.binding.planId
      || projection.planDigest !== this.binding.planDigest
      || projection.definitionDigest !== this.binding.definitionDigest
      || projection.reducerVersion !== this.binding.reducerVersion
    ) {
      streamFail('AUTHORITY_DRIFT', 'projection snapshot is bound to a different execution, plan, or reducer', true);
    }
    if (!DIGEST_RE.test(projectionDigest) || digestHypertreeProjection(projection) !== projectionDigest) {
      streamFail('DIGEST_MISMATCH', 'projection snapshot digest does not match canonical projection bytes', true);
    }
    if (this.currentProjection !== null) {
      if (projection.asOfSequence < this.currentProjection.asOfSequence) {
        streamFail('CURSOR_CONFLICT', 'projection snapshot would roll the accepted cursor backward', true);
      }
      if (projection.asOfSequence === this.currentProjection.asOfSequence) {
        if (canonicalProjection !== canonicalJson(this.currentProjection)) {
          streamFail('CURSOR_CONFLICT', 'projection snapshot conflicts at the accepted cursor', true);
        }
        return structuredClone(this.currentProjection);
      }
    }
    this.currentProjection = structuredClone(projection);
    this.currentUpdateCanonical = null;
    return structuredClone(projection);
  }

  accept(update: HypertreeProjectionUpdateV1): ProjectionStreamApplyResult {
    const canonical = canonicalJson(update);
    requireUpdate(
      Buffer.byteLength(canonical, 'utf8') <= MAX_PROJECTION_ENVELOPE_BYTES,
      `projection update may not exceed ${MAX_PROJECTION_ENVELOPE_BYTES} canonical UTF-8 bytes`,
    );
    validateUpdateShape(update);
    if (
      update.executionId !== this.binding.executionId
      || update.planId !== this.binding.planId
      || update.planDigest !== this.binding.planDigest
      || update.definitionDigest !== this.binding.definitionDigest
      || update.reducerVersion !== this.binding.reducerVersion
      || update.projection.executionId !== this.binding.executionId
      || update.projection.planId !== this.binding.planId
      || update.projection.planDigest !== this.binding.planDigest
      || update.projection.definitionDigest !== this.binding.definitionDigest
      || update.projection.reducerVersion !== this.binding.reducerVersion
    ) {
      streamFail('AUTHORITY_DRIFT', 'projection update is bound to a different execution, plan, or reducer', true);
    }
    if (update.projection.asOfSequence !== update.sequence || update.projection.asOfEventId !== update.eventId) {
      streamFail('CURSOR_CONFLICT', 'projection cursor does not match its update envelope', true);
    }
    if (digestHypertreeProjection(update.projection) !== update.projectionDigest) {
      streamFail('DIGEST_MISMATCH', 'projection digest does not match canonical projection bytes', true);
    }

    if (this.currentProjection === null) {
      if (update.previousSequence !== 0 || update.previousEventId !== null || update.sequence !== 1) {
        streamFail('CURSOR_GAP', 'first projection update must begin at the zero cursor', true);
      }
    } else {
      if (
        update.sequence === this.currentProjection.asOfSequence
        && update.eventId === this.currentProjection.asOfEventId
      ) {
        if (this.currentUpdateCanonical === null) {
          streamFail('CURSOR_CONFLICT', 'snapshot hydration cannot authenticate a replayed update envelope', true);
        }
        const matchesAcceptedUpdate = canonical === this.currentUpdateCanonical;
        if (!matchesAcceptedUpdate) {
          streamFail('CURSOR_CONFLICT', 'current projection cursor was replayed with different bytes', true);
        }
        return { accepted: true, duplicate: true, projection: structuredClone(this.currentProjection) };
      }
      if (update.sequence !== this.currentProjection.asOfSequence + 1) {
        streamFail('CURSOR_GAP', `projection update ${update.sequence} does not follow ${this.currentProjection.asOfSequence}`, true);
      }
      if (
        update.previousSequence !== this.currentProjection.asOfSequence
        || update.previousEventId !== this.currentProjection.asOfEventId
      ) {
        streamFail('CURSOR_CONFLICT', 'projection update previous cursor does not match the accepted cursor', true);
      }
    }

    this.currentProjection = structuredClone(update.projection);
    this.currentUpdateCanonical = canonical;
    return { accepted: true, duplicate: false, projection: structuredClone(update.projection) };
  }
}

export function projectionTruthAt(
  projection: HypertreeExecutionProjectionV1 | null,
  nowMs: number,
  connected: boolean,
): ProjectionTruthState {
  if (!projection) return connected ? 'UNKNOWN' : 'OFFLINE';
  if (!connected) return 'OFFLINE';
  if (projection.truthState === 'UNKNOWN' || projection.truthState === 'OFFLINE') return projection.truthState;
  if (projection.staleAfter !== null && nowMs >= Date.parse(projection.staleAfter)) return 'STALE';
  return projection.truthState;
}
