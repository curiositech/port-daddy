/**
 * ADR-0092 cloud coordination ledger.
 *
 * The ledger is deliberately authority-free: every daemon owns a local
 * replica, can append while disconnected, and later unions its operations with
 * every other replica.  The cloud Durable Object is one more replica and never
 * decides whether a local mutation is allowed.
 *
 * Notes are immutable G-set entries. Sessions, claims, and logical lock leases
 * are LWW registers ordered by a hybrid logical clock (HLC).  A deterministic
 * replica/op-id tie-breaker makes the fold commutative even when two peers emit
 * at the same wall-clock instant.
 */

export const COORDINATION_WIRE_VERSION = 1 as const;
/**
 * Remote clocks may lead the receiver slightly, but not far enough to make
 * later honest LWW updates lose indefinitely. Rejected outbox entries remain
 * retryable, so a skewed peer can recover once wall time catches up.
 */
export const COORDINATION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
/** Prevent a same-millisecond logical counter from exhausting safe integers. */
export const COORDINATION_MAX_HLC_COUNTER = 1_000_000;

export type CoordinationKind = 'session' | 'note' | 'claim' | 'lock';
export type CoordinationMutation = 'upsert' | 'remove';

export interface HybridLogicalClock {
  wallTime: number;
  counter: number;
  replicaId: string;
}

export interface CoordinationSessionValue {
  purpose: string;
  status: string;
  phase: string;
  agentId: string | null;
  worktreeId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown> | null;
  durable: boolean;
}

export interface CoordinationNoteValue {
  sessionId: string;
  content: string;
  type: string;
  createdAt: number;
}

export interface CoordinationClaimValue {
  sessionId: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  claimedAt: number;
}

/**
 * Logical coordination locks are replicated as expiring facts. They are not
 * process/port locks and cannot promise global mutual exclusion during a
 * partition. The deterministic fold only decides which lease is displayed
 * after peers reconnect.
 */
export interface CoordinationLockValue {
  name: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown> | null;
}

export type CoordinationValue =
  | CoordinationSessionValue
  | CoordinationNoteValue
  | CoordinationClaimValue
  | CoordinationLockValue;

export interface CoordinationOperation {
  version: typeof COORDINATION_WIRE_VERSION;
  opId: string;
  project: string;
  actorId: string;
  replicaId: string;
  kind: CoordinationKind;
  entityId: string;
  mutation: CoordinationMutation;
  clock: HybridLogicalClock;
  value: CoordinationValue | null;
}

export interface CursorOperation {
  cursor: number;
  operation: CoordinationOperation;
}

export interface CoordinationSyncRequest {
  replicaId: string;
  actorId: string;
  since: number;
  operations: CoordinationOperation[];
}

export interface CoordinationSyncResponse {
  cursor: number;
  operations: CursorOperation[];
  hasMore: boolean;
  /** Operations from this request already present in durable DO storage. */
  accepted: string[];
  /** Operations buffered for the next alarm flush; clients retain them. */
  pending: string[];
}

export interface MergeResult {
  added: CoordinationOperation[];
  duplicateIds: string[];
  rejected: Array<{ opId: string | null; reason: string }>;
}

const ID_MAX = 256;
const OP_ID_MAX = 1024;
const PROJECT_MAX = 200;
const VALUE_MAX_BYTES = 128 * 1024;
const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+#=-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCoordinationScopeId(value: unknown, max = ID_MAX): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && SIMPLE_ID.test(value);
}

function validClock(value: unknown): value is HybridLogicalClock {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.wallTime) && Number(value.wallTime) >= 0
    && Number.isSafeInteger(value.counter) && Number(value.counter) >= 0
    && Number(value.counter) <= COORDINATION_MAX_HLC_COUNTER
    && isCoordinationScopeId(value.replicaId);
}

function validString(value: unknown, max = 16 * 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validNullableString(value: unknown, max = ID_MAX): value is string | null {
  return value === null || validString(value, max);
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validNullableTimestamp(value: unknown): value is number | null {
  return value === null || validTimestamp(value);
}

function validMetadata(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function validateOperationValue(
  kind: CoordinationKind,
  value: Record<string, unknown>,
): string | null {
  switch (kind) {
    case 'session':
      if (!validString(value.purpose)) return 'invalid session purpose';
      if (!validString(value.status, 64)) return 'invalid session status';
      if (!validString(value.phase, 64)) return 'invalid session phase';
      if (!validNullableString(value.agentId)) return 'invalid session agentId';
      if (!validNullableString(value.worktreeId)) return 'invalid session worktreeId';
      if (!validTimestamp(value.createdAt)) return 'invalid session createdAt';
      if (!validTimestamp(value.updatedAt)) return 'invalid session updatedAt';
      if (!validNullableTimestamp(value.completedAt)) return 'invalid session completedAt';
      if (!validMetadata(value.metadata)) return 'invalid session metadata';
      if (typeof value.durable !== 'boolean') return 'invalid session durable flag';
      return null;
    case 'note':
      if (!isCoordinationScopeId(value.sessionId)) return 'invalid note sessionId';
      if (!validString(value.content, VALUE_MAX_BYTES)) return 'invalid note content';
      if (!validString(value.type, 64)) return 'invalid note type';
      if (!validTimestamp(value.createdAt)) return 'invalid note createdAt';
      return null;
    case 'claim': {
      if (!isCoordinationScopeId(value.sessionId)) return 'invalid claim sessionId';
      if (!validString(value.filePath, 16 * 1024)) return 'invalid claim filePath';
      if (!validNullableTimestamp(value.startLine)) return 'invalid claim startLine';
      if (!validNullableTimestamp(value.endLine)) return 'invalid claim endLine';
      if (value.startLine !== null && value.endLine !== null && Number(value.endLine) < Number(value.startLine)) {
        return 'claim endLine precedes startLine';
      }
      if (!validNullableString(value.symbol, 1024)) return 'invalid claim symbol';
      if (!validNullableString(value.symbolPath, 4096)) return 'invalid claim symbolPath';
      if (!validTimestamp(value.claimedAt)) return 'invalid claim claimedAt';
      return null;
    }
    case 'lock':
      if (!validString(value.name, 1024)) return 'invalid lock name';
      if (!validString(value.owner, 1024)) return 'invalid lock owner';
      if (!validTimestamp(value.acquiredAt)) return 'invalid lock acquiredAt';
      if (!validNullableTimestamp(value.expiresAt)) return 'invalid lock expiresAt';
      if (value.expiresAt !== null && Number(value.expiresAt) < Number(value.acquiredAt)) {
        return 'lock expiresAt precedes acquiredAt';
      }
      if (!validMetadata(value.metadata)) return 'invalid lock metadata';
      return null;
  }
}

/** Fail-closed wire validation shared by the daemon and Durable Object. */
export function validateCoordinationOperation(value: unknown): string | null {
  if (!isRecord(value)) return 'operation must be an object';
  if (value.version !== COORDINATION_WIRE_VERSION) return 'unsupported operation version';
  if (!isCoordinationScopeId(value.opId, OP_ID_MAX)) return 'invalid opId';
  if (!isCoordinationScopeId(value.project, PROJECT_MAX)) return 'invalid project';
  if (!isCoordinationScopeId(value.actorId)) return 'invalid actorId';
  if (!isCoordinationScopeId(value.replicaId)) return 'invalid replicaId';
  if (!(['session', 'note', 'claim', 'lock'] as unknown[]).includes(value.kind)) return 'invalid kind';
  if (!isCoordinationScopeId(value.entityId)) return 'invalid entityId';
  if (value.mutation !== 'upsert' && value.mutation !== 'remove') return 'invalid mutation';
  if (!validClock(value.clock)) return 'invalid clock';
  if (value.clock.replicaId !== value.replicaId) return 'clock replica does not match operation replica';
  if (value.opId !== coordinationOpId(
    value.replicaId as string,
    value.kind as CoordinationKind,
    value.entityId as string,
    value.clock as HybridLogicalClock,
  )) return 'opId does not match operation identity';
  if (value.mutation === 'upsert' && !isRecord(value.value)) return 'upsert requires an object value';
  if (value.mutation === 'remove' && value.value !== null) return 'remove requires a null value';
  if (value.mutation === 'upsert') {
    const valueReason = validateOperationValue(
      value.kind as CoordinationKind,
      value.value as Record<string, unknown>,
    );
    if (valueReason) return valueReason;
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value.value)).byteLength > VALUE_MAX_BYTES) {
      return 'operation value is too large';
    }
  } catch {
    return 'operation value is not serializable';
  }
  return null;
}

/** Runtime ingress check kept separate from deterministic historical replay. */
export function validateCoordinationClockSkew(
  operation: CoordinationOperation,
  nowMs = Date.now(),
): string | null {
  if (operation.clock.wallTime > Math.floor(nowMs) + COORDINATION_MAX_CLOCK_SKEW_MS) {
    return 'operation clock is too far in the future';
  }
  return null;
}

export function compareClocks(a: HybridLogicalClock, b: HybridLogicalClock): number {
  if (a.wallTime !== b.wallTime) return a.wallTime < b.wallTime ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.replicaId.localeCompare(b.replicaId);
}

export function compareOperations(a: CoordinationOperation, b: CoordinationOperation): number {
  const clock = compareClocks(a.clock, b.clock);
  if (clock !== 0) return clock;
  return a.opId.localeCompare(b.opId);
}

export function entityKey(operation: Pick<CoordinationOperation, 'kind' | 'entityId'>): string {
  return `${operation.kind}:${operation.entityId}`;
}

/**
 * Deterministic, side-effect-free CRDT fold. Merge order does not matter and
 * replaying the same operation is a no-op.
 */
export class CoordinationLedger {
  readonly #operations = new Map<string, CoordinationOperation>();
  readonly #heads = new Map<string, CoordinationOperation>();

  constructor(seed: Iterable<CoordinationOperation> = []) {
    this.merge(seed);
  }

  merge(input: Iterable<CoordinationOperation>): MergeResult {
    const added: CoordinationOperation[] = [];
    const duplicateIds: string[] = [];
    const rejected: Array<{ opId: string | null; reason: string }> = [];

    for (const operation of input) {
      const reason = validateCoordinationOperation(operation);
      if (reason) {
        rejected.push({
          opId: isRecord(operation) && typeof operation.opId === 'string' ? operation.opId : null,
          reason,
        });
        continue;
      }
      if (this.#operations.has(operation.opId)) {
        duplicateIds.push(operation.opId);
        continue;
      }

      this.#operations.set(operation.opId, operation);
      added.push(operation);
      const key = entityKey(operation);
      const current = this.#heads.get(key);
      if (!current || compareOperations(current, operation) < 0) {
        this.#heads.set(key, operation);
      }
    }

    return { added, duplicateIds, rejected };
  }

  has(opId: string): boolean {
    return this.#operations.has(opId);
  }

  operation(opId: string): CoordinationOperation | undefined {
    return this.#operations.get(opId);
  }

  head(kind: CoordinationKind, entityId: string): CoordinationOperation | undefined {
    return this.#heads.get(`${kind}:${entityId}`);
  }

  operations(): CoordinationOperation[] {
    return [...this.#operations.values()].sort(compareOperations);
  }

  /** Current non-tombstoned projection, ordered for stable tests/transcripts. */
  projection(): CoordinationOperation[] {
    return [...this.#heads.values()]
      .filter((operation) => operation.mutation === 'upsert')
      .sort((a, b) => entityKey(a).localeCompare(entityKey(b)));
  }
}

/** Per-replica HLC. `observe` preserves monotonicity across clock skew. */
export class HybridLogicalClockSource {
  #lastWallTime = 0;
  #counter = 0;

  constructor(readonly replicaId: string, private readonly now: () => number = Date.now) {
    if (!isCoordinationScopeId(replicaId)) throw new Error('invalid replicaId');
  }

  #normalizeCounter(): void {
    if (this.#counter <= COORDINATION_MAX_HLC_COUNTER) return;
    // Carry logical overflow into the wall component. This keeps locally
    // generated operations structurally valid even after observing a remote
    // clock at the counter ceiling, without depending on wall time advancing.
    this.#lastWallTime += 1;
    this.#counter = 0;
  }

  next(): HybridLogicalClock {
    const wallTime = Math.max(0, Math.floor(this.now()));
    if (wallTime > this.#lastWallTime) {
      this.#lastWallTime = wallTime;
      this.#counter = 0;
    } else {
      this.#counter += 1;
    }
    this.#normalizeCounter();
    return { wallTime: this.#lastWallTime, counter: this.#counter, replicaId: this.replicaId };
  }

  observe(remote: HybridLogicalClock): HybridLogicalClock {
    const localNow = Math.max(0, Math.floor(this.now()));
    const maxWall = Math.max(localNow, this.#lastWallTime, remote.wallTime);
    if (maxWall === this.#lastWallTime && maxWall === remote.wallTime) {
      this.#counter = Math.max(this.#counter, remote.counter) + 1;
    } else if (maxWall === this.#lastWallTime) {
      this.#counter += 1;
    } else if (maxWall === remote.wallTime) {
      this.#counter = remote.counter + 1;
    } else {
      this.#counter = 0;
    }
    this.#lastWallTime = maxWall;
    this.#normalizeCounter();
    return { wallTime: this.#lastWallTime, counter: this.#counter, replicaId: this.replicaId };
  }
}

export function coordinationOpId(
  replicaId: string,
  kind: CoordinationKind,
  entityId: string,
  clock: HybridLogicalClock,
): string {
  return `${replicaId}:${kind}:${entityId}:${clock.wallTime}:${clock.counter}`;
}
