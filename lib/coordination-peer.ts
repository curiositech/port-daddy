/**
 * ADR-0092 local coordination replica.
 *
 * Local SQLite remains fully usable while the network is absent. This service
 * observes the existing session/note/claim/lock APIs, appends CRDT operations
 * to a durable local outbox, and exchanges batches with the per-project cloud
 * room. No local write waits on the cloud and no cloud response can start or
 * supervise a local process.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  COORDINATION_MAX_HLC_COUNTER,
  COORDINATION_WIRE_VERSION,
  compareOperations,
  coordinationOpId,
  isCoordinationScopeId,
  type CoordinationClaimValue,
  type CoordinationKind,
  type CoordinationLockValue,
  type CoordinationMutation,
  type CoordinationNoteValue,
  type CoordinationOperation,
  type CoordinationSessionValue,
  type CoordinationSyncResponse,
  type CoordinationValue,
  type HybridLogicalClock,
  validateCoordinationClockSkew,
  validateCoordinationOperation,
} from './coordination-ledger.js';

const DEFAULT_SYNC_INTERVAL_MS = 2_000;
const MIN_SYNC_INTERVAL_MS = 500;
const MAX_SYNC_INTERVAL_MS = 60_000;
const OUTBOX_BATCH_SIZE = 256;
const MAX_SYNC_PAGES = 20;
const MAX_SYNC_BODY_BYTES = 1024 * 1024;
const MAX_INCOMING_OPERATIONS = 1000;
// Existing rooms return up to 1000 values, each serialized at <=128 KiB.
// Reserve 8 KiB per operation for bounded IDs/clock/cursor/envelope fields,
// plus 1 MiB for acknowledgments. This is not the outgoing 1 MiB/256 budget.
const MAX_INCOMING_BODY_BYTES = MAX_INCOMING_OPERATIONS * (128 + 8) * 1024 + 1024 * 1024;
const SYNC_RESPONSE_TIMEOUT_MS = 30_000;

async function readBoundedSyncResponse(response: Response, signal: AbortSignal): Promise<CoordinationSyncResponse> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`coordination sync HTTP ${response.status}`);
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_INCOMING_BODY_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw new Error('coordination response exceeds incoming byte budget');
  }
  if (!response.body) throw new Error('coordination response has no readable body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { void reader.cancel().catch(() => {}); reject(new Error('coordination response deadline exceeded')); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_INCOMING_BODY_BYTES) throw new Error('coordination response exceeds incoming byte budget');
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))) as CoordinationSyncResponse;
  } catch {
    void reader.cancel().catch(() => {});
    throw new Error('coordination response is invalid, oversized or incomplete');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

interface SessionsReplicaApi {
  list(options?: Record<string, unknown>): Record<string, unknown>;
  get(sessionId: string): Record<string, unknown>;
  getNotes(sessionId?: string | null, options?: Record<string, unknown>): Record<string, unknown>;
  applyReplicatedPage(project: string, apply: (append: (operation: CoordinationOperation) => number) => unknown): { warnings: string[] };
  claimFiles(sessionId: string, files: string[], options?: {
    regions?: Array<{ path: string; startLine?: number; endLine?: number; symbol?: string; symbolPath?: string }>;
    agentId?: string | null;
  }): Record<string, unknown>;
  releaseFiles(sessionId: string, files: string[], options?: {
    regions?: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }>;
    agentId?: string | null;
  }): Record<string, unknown>;
}

interface LocksReplicaApi {
  list(options?: Record<string, unknown>): Record<string, unknown>;
}

export interface CoordinationPeerConfig {
  url: string;
  project: string;
  actorId: string;
  /** Unique daemon replica. Generated once and persisted with the local outbox when omitted. */
  replicaId?: string;
  macaroon: string;
  intervalMs?: number;
}

export interface CoordinationPeerStatus {
  enabled: boolean;
  connected: boolean;
  project: string | null;
  actorId: string | null;
  replicaId: string | null;
  cursor: number;
  outbox: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface CoordinationPeerDeps {
  db: DatabaseInstance;
  sessions: SessionsReplicaApi;
  locks: LocksReplicaApi;
  config: CoordinationPeerConfig;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  logger?: {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
  };
}

interface VersionRow {
  op_id: string;
  clock_wall: number;
  clock_counter: number;
  clock_replica: string;
  mutation: CoordinationMutation;
  value_json: string | null;
}

interface SnapshotEntity {
  kind: CoordinationKind;
  localKey: string;
  entityId: string;
  value: CoordinationValue;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function entityFingerprint(kind: CoordinationKind, value: CoordinationValue): string {
  const record = { ...(value as unknown as Record<string, unknown>) };
  // Importing through the canonical local APIs may assign a different local
  // timestamp. These fields are provenance, not the semantic identity/state.
  if (kind === 'note') delete record.createdAt;
  if (kind === 'claim') delete record.claimedAt;
  return digest(stableJson(record));
}

function claimLocalKey(value: CoordinationClaimValue): string {
  return [
    value.sessionId,
    value.filePath,
    value.startLine ?? '',
    value.endLine ?? '',
    value.symbol ?? '',
    value.symbolPath ?? '',
  ].join('\u0000');
}

function claimEntityId(value: CoordinationClaimValue): string {
  return `claim-${digest(claimLocalKey(value)).slice(0, 40)}`;
}

function lockEntityId(name: string): string {
  return `lock-${digest(name).slice(0, 40)}`;
}

function replicatedLockLocalKey(project: string, name: string): string {
  return `coordination:${digest(project).slice(0, 16)}:${name}`;
}

function isReplicatedLockProjection(
  metadata: Record<string, unknown> | null,
  project: string,
  name: string,
  entityId: string,
): boolean {
  return metadata?.replicated === true &&
    metadata.identityProject === project &&
    metadata.coordinationLockName === name &&
    metadata.coordinationEntityId === entityId;
}

function safeMetadata(value: unknown): Record<string, unknown> | null {
  return asRecord(value);
}

function parseStoredMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return safeMetadata(JSON.parse(value));
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function compareVersion(row: VersionRow, operation: CoordinationOperation): number {
  const current: CoordinationOperation = {
    ...operation,
    opId: row.op_id,
    mutation: row.mutation,
    clock: {
      wallTime: row.clock_wall,
      counter: row.clock_counter,
      replicaId: row.clock_replica,
    },
  };
  return compareOperations(current, operation);
}

export function coordinationPeerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  secret: (key: string) => string | undefined = (key) => env[key],
): CoordinationPeerConfig | null {
  const url = env.PORT_DADDY_COORDINATION_URL?.trim();
  const project = env.PORT_DADDY_COORDINATION_PROJECT?.trim();
  const actorId = env.PORT_DADDY_COORDINATION_ACTOR?.trim();
  const replicaId = env.PORT_DADDY_COORDINATION_REPLICA?.trim();
  const macaroon = secret('PORT_DADDY_COORDINATION_MACAROON')?.trim();
  if (!url && !project && !actorId && !replicaId && !macaroon) return null;
  if (!url || !project || !actorId || !macaroon) {
    throw new Error(
      'coordination peer requires PORT_DADDY_COORDINATION_URL, _PROJECT, _ACTOR, and _MACAROON together',
    );
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PORT_DADDY_COORDINATION_URL must use http or https');
  }
  if (
    !isCoordinationScopeId(project, 200)
    || !isCoordinationScopeId(actorId)
    || (replicaId !== undefined && !isCoordinationScopeId(replicaId))
  ) {
    throw new Error('coordination project/actor contains unsupported characters');
  }
  const rawInterval = Number(env.PORT_DADDY_COORDINATION_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS);
  const intervalMs = Math.max(
    MIN_SYNC_INTERVAL_MS,
    Math.min(MAX_SYNC_INTERVAL_MS, Number.isFinite(rawInterval) ? Math.floor(rawInterval) : DEFAULT_SYNC_INTERVAL_MS),
  );
  return {
    url: parsed.toString().replace(/\/$/, ''),
    project,
    actorId,
    ...(replicaId ? { replicaId } : {}),
    macaroon,
    intervalMs,
  };
}

export class CoordinationPeer {
  private readonly db: DatabaseInstance;
  private readonly sessions: SessionsReplicaApi;
  private readonly locks: LocksReplicaApi;
  private readonly config: Required<CoordinationPeerConfig>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly logger: NonNullable<CoordinationPeerDeps['logger']>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private connected = false;
  private lastSyncAt: number | null = null;
  private lastError: string | null = null;

  constructor(deps: CoordinationPeerDeps) {
    this.db = deps.db;
    this.sessions = deps.sessions;
    this.locks = deps.locks;
    this.config = {
      ...deps.config,
      replicaId: deps.config.replicaId ?? '',
      intervalMs: deps.config.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    };
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? { info() {}, warn() {} };
    this.initializeSchema();
  }

  start(): void {
    if (this.timer) return;
    void this.syncOnce();
    this.timer = setInterval(() => void this.syncOnce(), this.config.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): CoordinationPeerStatus {
    const state = this.state();
    const outbox = this.db.prepare(
      'SELECT COUNT(*) AS count FROM coordination_peer_outbox WHERE project = ?',
    ).get(this.config.project) as { count: number };
    return {
      enabled: true,
      connected: this.connected,
      project: this.config.project,
      actorId: this.config.actorId,
      replicaId: this.config.replicaId,
      cursor: state.cursor,
      outbox: outbox.count,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  async syncOnce(): Promise<CoordinationPeerStatus> {
    if (this.syncing) return this.status();
    this.syncing = true;
    try {
      this.captureLocalOperations();
      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        const state = this.state();
        const outboxRows = this.db.prepare(`
          SELECT operation_json FROM coordination_peer_outbox
          WHERE project = ? ORDER BY created_at ASC, op_id ASC LIMIT ?
        `).all(this.config.project, OUTBOX_BATCH_SIZE) as Array<{ operation_json: string }>;
        // HLC order carries capture causality (session before its notes/claims),
        // including rows created in the same millisecond. SQL's op-id tie-break
        // is deterministic but not causal (`note` sorts before `session`).
        const candidates = outboxRows
          .map((row) => JSON.parse(row.operation_json) as CoordinationOperation)
          .sort(compareOperations);
        const envelopeReplicaId = candidates[0]?.replicaId ?? this.config.replicaId;
        const envelopeActorId = candidates[0]?.actorId ?? this.config.actorId;
        if (envelopeActorId !== this.config.actorId) {
          throw new Error('persisted coordination outbox belongs to another authorized actor');
        }
        const operations: CoordinationOperation[] = [];
        let requestBody = JSON.stringify({
          replicaId: envelopeReplicaId,
          actorId: envelopeActorId,
          since: state.cursor,
          operations,
        });
        for (const operation of candidates) {
          // A legacy outbox may contain a prior replica envelope. Drain each
          // contiguous replica independently instead of making the room reject
          // the whole persisted batch after a restart/configuration repair.
          if (operation.replicaId !== envelopeReplicaId || operation.actorId !== envelopeActorId) break;
          const next = [...operations, operation];
          const serialized = JSON.stringify({
            replicaId: envelopeReplicaId,
            actorId: envelopeActorId,
            since: state.cursor,
            operations: next,
          });
          if (new TextEncoder().encode(serialized).byteLength > MAX_SYNC_BODY_BYTES) break;
          operations.push(operation);
          requestBody = serialized;
        }
        if (candidates.length > 0 && operations.length === 0) {
          throw new Error('oldest coordination operation cannot fit in the 1 MiB sync envelope');
        }
        const endpoint = `${this.config.url}/v1/coordination/${encodeURIComponent(this.config.project)}/sync`;
        const signal = AbortSignal.timeout(SYNC_RESPONSE_TIMEOUT_MS);
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Macaroon ${this.config.macaroon}`,
            'Content-Type': 'application/json',
          },
          body: requestBody,
          signal,
        });
        const result = await readBoundedSyncResponse(response, signal);
        this.applySyncResponse(
          result,
          new Set(operations.map((operation) => operation.opId)),
        );
        if (result.pending.length > 0 || (!result.hasMore && operations.length === 0)) break;
      }
      this.connected = true;
      this.lastSyncAt = this.now();
      this.lastError = null;
    } catch (cause) {
      this.connected = false;
      this.lastError = (cause as Error).message;
      this.logger.warn('coordination_peer_sync_failed', {
        project: this.config.project,
        error: this.lastError,
        outbox: this.status().outbox,
      });
    } finally {
      this.syncing = false;
    }
    return this.status();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS coordination_peer_state (
        project TEXT PRIMARY KEY,
        replica_id TEXT,
        cursor INTEGER NOT NULL DEFAULT 0,
        hlc_wall INTEGER NOT NULL DEFAULT 0,
        hlc_counter INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordination_peer_outbox (
        op_id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        operation_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_coordination_outbox_project
        ON coordination_peer_outbox(project, created_at, op_id);
      CREATE TABLE IF NOT EXISTS coordination_peer_versions (
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        clock_wall INTEGER NOT NULL,
        clock_counter INTEGER NOT NULL,
        clock_replica TEXT NOT NULL,
        mutation TEXT NOT NULL,
        value_json TEXT,
        PRIMARY KEY (project, kind, entity_id)
      );
      CREATE TABLE IF NOT EXISTS coordination_peer_bindings (
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        local_key TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        PRIMARY KEY (project, kind, local_key),
        UNIQUE (project, kind, entity_id)
      );
    `);
    const stateColumns = this.db.prepare('PRAGMA table_info(coordination_peer_state)').all() as Array<{ name: string }>;
    if (!stateColumns.some((column) => column.name === 'replica_id')) {
      this.db.exec('ALTER TABLE coordination_peer_state ADD COLUMN replica_id TEXT');
    }
    let persistedReplica = this.db.prepare(`
      SELECT replica_id FROM coordination_peer_state WHERE project = ?
    `).get(this.config.project) as { replica_id: string | null } | undefined;
    let replicaId = persistedReplica?.replica_id ?? null;
    if (!replicaId) {
      const legacy = this.db.prepare(`
        SELECT operation_json FROM coordination_peer_outbox
        WHERE project = ? ORDER BY created_at ASC, op_id ASC LIMIT 1
      `).get(this.config.project) as { operation_json: string } | undefined;
      try {
        const operation = legacy ? JSON.parse(legacy.operation_json) as CoordinationOperation : null;
        if (operation && isCoordinationScopeId(operation.replicaId)) replicaId = operation.replicaId;
      } catch {
        // A malformed legacy row is handled by sync; it must not make schema
        // initialization invent a second identity for otherwise valid rows.
      }
    }
    replicaId ??= this.config.replicaId || `peer-${randomBytes(12).toString('hex')}`;
    this.db.prepare(`
      INSERT OR IGNORE INTO coordination_peer_state
        (project, replica_id, cursor, hlc_wall, hlc_counter, updated_at)
      VALUES (?, ?, 0, 0, 0, ?)
    `).run(this.config.project, replicaId, this.now());
    this.db.prepare(`
      UPDATE coordination_peer_state SET replica_id = ?, updated_at = ?
      WHERE project = ? AND replica_id IS NULL
    `).run(replicaId, this.now(), this.config.project);
    persistedReplica = this.db.prepare(`
      SELECT replica_id FROM coordination_peer_state WHERE project = ?
    `).get(this.config.project) as { replica_id: string | null };
    if (!persistedReplica.replica_id || !isCoordinationScopeId(persistedReplica.replica_id)) {
      throw new Error('coordination peer has an invalid persisted replica identity');
    }
    this.config.replicaId = persistedReplica.replica_id;
  }

  private state(): { cursor: number; hlc_wall: number; hlc_counter: number } {
    return this.db.prepare(`
      SELECT cursor, hlc_wall, hlc_counter FROM coordination_peer_state WHERE project = ?
    `).get(this.config.project) as { cursor: number; hlc_wall: number; hlc_counter: number };
  }

  private nextClock(): HybridLogicalClock {
    const state = this.state();
    let wallTime = Math.max(Math.floor(this.now()), state.hlc_wall);
    let counter = wallTime === state.hlc_wall ? state.hlc_counter + 1 : 0;
    if (counter > COORDINATION_MAX_HLC_COUNTER) {
      wallTime += 1;
      counter = 0;
    }
    this.db.prepare(`
      UPDATE coordination_peer_state SET hlc_wall = ?, hlc_counter = ?, updated_at = ? WHERE project = ?
    `).run(wallTime, counter, this.now(), this.config.project);
    return { wallTime, counter, replicaId: this.config.replicaId };
  }

  private observeClock(clock: HybridLogicalClock): void {
    const state = this.state();
    const wallTime = Math.max(state.hlc_wall, clock.wallTime);
    const counter = wallTime === state.hlc_wall && wallTime === clock.wallTime
      ? Math.max(state.hlc_counter, clock.counter)
      : wallTime === clock.wallTime
        ? clock.counter
        : state.hlc_counter;
    const written = this.db.prepare(`
      UPDATE coordination_peer_state SET hlc_wall = ?, hlc_counter = ?, updated_at = ? WHERE project = ?
    `).run(wallTime, counter, this.now(), this.config.project);
    const persisted = this.state();
    if (written.changes !== 1 || persisted.hlc_wall !== wallTime || persisted.hlc_counter !== counter || persisted.cursor !== state.cursor) {
      throw new Error('coordination clock was not persisted');
    }
  }

  private captureLocalOperations(): void {
    const entities = this.snapshotEntities();
    const seen = new Map<CoordinationKind, Set<string>>();
    for (const entity of entities) {
      let keys = seen.get(entity.kind);
      if (!keys) { keys = new Set(); seen.set(entity.kind, keys); }
      keys.add(entity.localKey);
      this.captureEntity(entity);
    }
    for (const kind of ['claim', 'lock'] as const) {
      const rows = this.db.prepare(`
        SELECT local_key, entity_id FROM coordination_peer_bindings WHERE project = ? AND kind = ?
      `).all(this.config.project, kind) as Array<{ local_key: string; entity_id: string }>;
      for (const row of rows) {
        if (seen.get(kind)?.has(row.local_key)) continue;
        if (kind === 'lock') {
          const projected = this.db.prepare('SELECT metadata FROM locks WHERE name = ?').get(row.local_key) as
            | { metadata: string | null }
            | undefined;
          if (parseStoredMetadata(projected?.metadata ?? null)?.replicated === true) continue;
        }
        const current = this.version(kind, row.entity_id);
        if (!current || current.mutation === 'remove') continue;
        this.appendLocalOperation(kind, row.entity_id, 'remove', null);
        this.db.prepare(`
          DELETE FROM coordination_peer_bindings WHERE project = ? AND kind = ? AND local_key = ?
        `).run(this.config.project, kind, row.local_key);
      }
    }
  }

  private snapshotEntities(): SnapshotEntity[] {
    const entities: SnapshotEntity[] = [];
    const listed = this.sessions.list({
      project: this.config.project,
      allWorktrees: true,
      includeNotes: false,
      limit: 10_000,
    });
    if (listed.success !== true || !Array.isArray(listed.sessions)) {
      throw new Error('coordination session snapshot is unavailable');
    }
    const sessions = listed.sessions;
    const notes: Array<Record<string, unknown>> = [];
    for (const raw of sessions) {
      const session = asRecord(raw);
      if (!session || typeof session.id !== 'string' || typeof session.purpose !== 'string') {
        throw new Error('coordination session snapshot is malformed');
      }
      const value: CoordinationSessionValue = {
        purpose: session.purpose,
        status: typeof session.status === 'string' ? session.status : 'active',
        phase: typeof session.phase === 'string' ? session.phase : 'in_progress',
        agentId: stringOrNull(session.agentId),
        worktreeId: stringOrNull(session.worktreeId),
        createdAt: numberOrNull(session.createdAt) ?? this.now(),
        updatedAt: numberOrNull(session.updatedAt) ?? this.now(),
        completedAt: numberOrNull(session.completedAt),
        metadata: safeMetadata(session.metadata),
        durable: session.durable === true,
      };
      const entityId = isCoordinationScopeId(session.id) ? session.id : `session-${digest(session.id).slice(0, 40)}`;
      entities.push({ kind: 'session', localKey: session.id, entityId, value });

      const detail = this.sessions.get(session.id);
      const detailSession = asRecord(detail.session);
      if (detail.success !== true || detailSession?.id !== session.id
        || detailSession.identityProject !== this.config.project
        || !Array.isArray(detail.files) || !Array.isArray(detail.notes)
        || detailSession.noteCount !== detail.notes.length) {
        throw new Error('coordination session detail snapshot is incomplete');
      }
      // Full detail already reads and decrypts every retained note for these
      // exact sessions. Do not turn a bounded getNotes page (or its refusal)
      // into a supposedly complete replication snapshot.
      for (const rawNote of detail.notes) {
        const note = asRecord(rawNote);
        if (!note || !Number.isSafeInteger(note.id) || (note.id as number) < 1
          || note.sessionId !== session.id || typeof note.content !== 'string') {
          throw new Error('coordination session note snapshot is malformed');
        }
        notes.push(note);
      }
      const files = detail.files;
      if (value.status !== 'active') continue;
      for (const rawFile of files) {
        const file = asRecord(rawFile);
        if (!file || file.releasedAt !== null || typeof file.filePath !== 'string') continue;
        const claim: CoordinationClaimValue = {
          sessionId: session.id,
          filePath: file.filePath,
          startLine: numberOrNull(file.startLine),
          endLine: numberOrNull(file.endLine),
          symbol: stringOrNull(file.symbol),
          symbolPath: stringOrNull(file.symbolPath),
          claimedAt: numberOrNull(file.claimedAt) ?? this.now(),
        };
        entities.push({ kind: 'claim', localKey: claimLocalKey(claim), entityId: claimEntityId(claim), value: claim });
      }
    }

    for (const note of notes) {
      const localKey = String(note.id);
      const mapped = this.binding('note', localKey);
      const value: CoordinationNoteValue = {
        sessionId: note.sessionId as string,
        content: note.content as string,
        type: typeof note.type === 'string' ? note.type : 'note',
        createdAt: numberOrNull(note.createdAt) ?? this.now(),
      };
      entities.push({
        kind: 'note',
        localKey,
        entityId: mapped?.entity_id ?? `note-${digest(`${this.config.replicaId}:${note.sessionId}:${localKey}`).slice(0, 40)}`,
        value,
      });
    }

    const lockResult = this.locks.list();
    const locks = Array.isArray(lockResult.locks) ? lockResult.locks : [];
    for (const raw of locks) {
      const lock = asRecord(raw);
      if (!lock || typeof lock.name !== 'string' || typeof lock.owner !== 'string') continue;
      const metadata = safeMetadata(lock.metadata);
      if (metadata?.replicated === true) continue;
      const expiresAt = numberOrNull(lock.expiresAt);
      if (expiresAt === null) continue;
      let lockProject = typeof metadata?.identityProject === 'string' ? metadata.identityProject : null;
      if (!lockProject) {
        const agent = this.db.prepare('SELECT identity_project FROM agents WHERE id = ?').get(lock.owner) as
          | { identity_project: string | null }
          | undefined;
        lockProject = agent?.identity_project ?? null;
      }
      if (lockProject !== this.config.project) continue;
      const value: CoordinationLockValue = {
        name: lock.name,
        owner: lock.owner,
        acquiredAt: numberOrNull(lock.acquiredAt) ?? this.now(),
        expiresAt,
        metadata,
      };
      entities.push({ kind: 'lock', localKey: lock.name, entityId: lockEntityId(lock.name), value });
    }
    return entities;
  }

  private binding(kind: CoordinationKind, localKey: string): { entity_id: string; snapshot_hash: string } | undefined {
    return this.db.prepare(`
      SELECT entity_id, snapshot_hash FROM coordination_peer_bindings
      WHERE project = ? AND kind = ? AND local_key = ?
    `).get(this.config.project, kind, localKey) as { entity_id: string; snapshot_hash: string } | undefined;
  }

  private captureEntity(entity: SnapshotEntity): void {
    const fingerprint = entityFingerprint(entity.kind, entity.value);
    const binding = this.binding(entity.kind, entity.localKey);
    const entityId = binding?.entity_id ?? entity.entityId;
    if (!binding || binding.snapshot_hash !== fingerprint) {
      this.appendLocalOperation(entity.kind, entityId, 'upsert', entity.value);
    }
    this.bind(entity.kind, entity.localKey, entityId, fingerprint);
  }

  private appendLocalOperation(
    kind: CoordinationKind,
    entityId: string,
    mutation: CoordinationMutation,
    value: CoordinationValue | null,
  ): void {
    const clock = this.nextClock();
    const operation: CoordinationOperation = {
      version: COORDINATION_WIRE_VERSION,
      opId: coordinationOpId(this.config.replicaId, kind, entityId, clock),
      project: this.config.project,
      actorId: this.config.actorId,
      replicaId: this.config.replicaId,
      kind,
      entityId,
      mutation,
      clock,
      value,
    };
    this.db.prepare(`
      INSERT OR IGNORE INTO coordination_peer_outbox (op_id, project, operation_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(operation.opId, this.config.project, JSON.stringify(operation), this.now());
    this.writeVersion(operation);
  }

  private version(kind: CoordinationKind, entityId: string): VersionRow | undefined {
    return this.db.prepare(`
      SELECT op_id, clock_wall, clock_counter, clock_replica, mutation, value_json
      FROM coordination_peer_versions WHERE project = ? AND kind = ? AND entity_id = ?
    `).get(this.config.project, kind, entityId) as VersionRow | undefined;
  }

  private writeVersion(operation: CoordinationOperation): void {
    const written = this.db.prepare(`
      INSERT INTO coordination_peer_versions
        (project, kind, entity_id, op_id, clock_wall, clock_counter, clock_replica, mutation, value_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, kind, entity_id) DO UPDATE SET
        op_id = excluded.op_id,
        clock_wall = excluded.clock_wall,
        clock_counter = excluded.clock_counter,
        clock_replica = excluded.clock_replica,
        mutation = excluded.mutation,
        value_json = excluded.value_json
    `).run(
      operation.project,
      operation.kind,
      operation.entityId,
      operation.opId,
      operation.clock.wallTime,
      operation.clock.counter,
      operation.clock.replicaId,
      operation.mutation,
      operation.value === null ? null : JSON.stringify(operation.value),
    );
    const persisted = this.version(operation.kind, operation.entityId);
    if (written.changes !== 1 || !persisted || persisted.op_id !== operation.opId
      || persisted.clock_wall !== operation.clock.wallTime || persisted.clock_counter !== operation.clock.counter
      || persisted.clock_replica !== operation.clock.replicaId || persisted.mutation !== operation.mutation
      || persisted.value_json !== (operation.value === null ? null : JSON.stringify(operation.value))) {
      throw new Error('coordination version was not persisted');
    }
  }

  private bind(kind: CoordinationKind, localKey: string, entityId: string, snapshotHash: string): void {
    const written = this.db.prepare(`
      INSERT INTO coordination_peer_bindings (project, kind, local_key, entity_id, snapshot_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project, kind, local_key) DO UPDATE SET
        entity_id = excluded.entity_id,
        snapshot_hash = excluded.snapshot_hash
    `).run(this.config.project, kind, localKey, entityId, snapshotHash);
    const persisted = this.db.prepare('SELECT entity_id, snapshot_hash FROM coordination_peer_bindings WHERE project = ? AND kind = ? AND local_key = ?')
      .get(this.config.project, kind, localKey) as { entity_id: string; snapshot_hash: string } | undefined;
    if (written.changes !== 1 || persisted?.entity_id !== entityId || persisted.snapshot_hash !== snapshotHash) {
      throw new Error('coordination binding was not persisted');
    }
  }

  private applySyncResponse(
    result: CoordinationSyncResponse,
    submittedOperationIds: ReadonlySet<string>,
  ): void {
    if (
      !Number.isSafeInteger(result?.cursor)
      || result.cursor < 0
      || !Array.isArray(result.operations)
      || result.operations.length > MAX_INCOMING_OPERATIONS
      || !Array.isArray(result.accepted)
      || !Array.isArray(result.pending)
      || result.accepted.length > OUTBOX_BATCH_SIZE
      || result.pending.length > OUTBOX_BATCH_SIZE
      || typeof result.hasMore !== 'boolean'
      || result.accepted.some((opId) => typeof opId !== 'string')
      || result.pending.some((opId) => typeof opId !== 'string')
    ) {
      throw new Error('malformed coordination sync response');
    }
    if (
      result.accepted.some((opId) => !submittedOperationIds.has(opId))
      || result.pending.some((opId) => !submittedOperationIds.has(opId))
      || new Set(result.accepted).size !== result.accepted.length
      || new Set(result.pending).size !== result.pending.length
      || result.accepted.some((opId) => result.pending.includes(opId))
    ) {
      throw new Error('coordination sync acknowledged an operation outside the submitted batch');
    }
    const ordered = [...result.operations].sort((a, b) => a.cursor - b.cursor);
    const currentCursor = this.state().cursor;
    let expectedCursor = currentCursor;
    for (const entry of ordered) {
      if (!Number.isSafeInteger(entry?.cursor) || entry.cursor !== expectedCursor + 1) {
        throw new Error('non-contiguous coordination cursor');
      }
      const reason = validateCoordinationOperation(entry.operation);
      const skewReason = reason ? null : validateCoordinationClockSkew(entry.operation, this.now());
      if (
        reason
        || skewReason
        || entry.operation.project !== this.config.project
      ) {
        throw new Error(`invalid coordination operation: ${reason ?? skewReason ?? 'scope mismatch'}`);
      }
      expectedCursor = entry.cursor;
    }
    if (ordered.length > 0 && result.cursor !== expectedCursor) {
      throw new Error('coordination response cursor does not match operation page');
    }
    if (ordered.length === 0 && result.cursor !== currentCursor) {
      throw new Error('coordination response advanced cursor without operations');
    }
    const applied = this.sessions.applyReplicatedPage(this.config.project, (append) => {
      for (const entry of ordered) {
        this.applyOperation(entry.operation, append);
        this.observeClock(entry.operation.clock);
      }
      if (result.accepted.length > 0) {
        const remove = this.db.prepare('DELETE FROM coordination_peer_outbox WHERE project = ? AND op_id = ?');
        for (const opId of result.accepted) {
          if (remove.run(this.config.project, opId).changes !== 1) throw new Error('coordination acknowledgment was not persisted');
        }
      }
      const written = this.db.prepare(`
        UPDATE coordination_peer_state SET cursor = ?, updated_at = ? WHERE project = ?
      `).run(result.cursor, this.now(), this.config.project);
      if (written.changes !== 1 || this.state().cursor !== result.cursor) throw new Error('coordination cursor was not persisted');
    });
    if (applied.warnings.length) this.logger.warn('coordination_peer_projection_incomplete', { warnings: applied.warnings });
  }

  private applyOperation(operation: CoordinationOperation, append: (operation: CoordinationOperation) => number): void {
    const current = this.version(operation.kind, operation.entityId);
    if (current && compareVersion(current, operation) >= 0) return;
    const previous = current?.value_json ? JSON.parse(current.value_json) as CoordinationValue : null;

    switch (operation.kind) {
      case 'session':
        this.applySession(operation, operation.value as CoordinationSessionValue | null);
        break;
      case 'note':
        this.applyNote(operation, operation.value as CoordinationNoteValue | null, append);
        break;
      case 'claim':
        this.applyClaim(operation, operation.value as CoordinationClaimValue | null, previous as CoordinationClaimValue | null);
        break;
      case 'lock':
        this.applyLock(operation, operation.value as CoordinationLockValue | null, previous as CoordinationLockValue | null);
        break;
    }
    this.writeVersion(operation);
  }

  private applySession(operation: CoordinationOperation, value: CoordinationSessionValue | null): void {
    if (operation.mutation === 'remove' || !value) return;
    const existing = this.db.prepare('SELECT identity_project, wrapped_session_key FROM sessions WHERE id = ?').get(operation.entityId) as
      | { identity_project: string | null; wrapped_session_key: string | null }
      | undefined;
    if (existing && existing.identity_project !== this.config.project) {
      throw new Error(`replicated session ${operation.entityId} collides with another project`);
    }
    const written = this.db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, worktree_id, identity_project,
        created_at, updated_at, completed_at, metadata, is_durable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        purpose = excluded.purpose,
        status = excluded.status,
        phase = excluded.phase,
        agent_id = excluded.agent_id,
        worktree_id = excluded.worktree_id,
        identity_project = excluded.identity_project,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        metadata = excluded.metadata,
        is_durable = excluded.is_durable
    `).run(
      operation.entityId,
      value.purpose,
      value.status,
      value.phase,
      value.agentId,
      value.worktreeId,
      this.config.project,
      value.createdAt,
      value.updatedAt,
      value.completedAt,
      value.metadata ? JSON.stringify(value.metadata) : null,
      value.durable ? 1 : 0,
    );
    const persisted = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(operation.entityId) as Record<string, unknown> | undefined;
    if (written.changes !== 1 || !persisted || persisted.identity_project !== this.config.project
      || persisted.purpose !== value.purpose || persisted.status !== value.status || persisted.phase !== value.phase
      || persisted.agent_id !== value.agentId || persisted.worktree_id !== value.worktreeId
      || persisted.updated_at !== value.updatedAt || persisted.completed_at !== value.completedAt
      || persisted.metadata !== (value.metadata ? JSON.stringify(value.metadata) : null)
      || persisted.is_durable !== (value.durable ? 1 : 0)
      || persisted.wrapped_session_key !== (existing?.wrapped_session_key ?? null)
      || (!existing && persisted.created_at !== value.createdAt)) {
      throw new Error('replicated session was not persisted');
    }
    this.bind('session', operation.entityId, operation.entityId, entityFingerprint('session', value));
  }

  private applyNote(operation: CoordinationOperation, value: CoordinationNoteValue | null, append: (operation: CoordinationOperation) => number): void {
    if (operation.mutation === 'remove' || !value) return;
    const existing = this.db.prepare(`
      SELECT local_key FROM coordination_peer_bindings WHERE project = ? AND kind = 'note' AND entity_id = ?
    `).get(this.config.project, operation.entityId) as { local_key: string } | undefined;
    if (existing) return;
    const session = this.db.prepare('SELECT identity_project FROM sessions WHERE id = ?').get(value.sessionId) as
      | { identity_project: string | null }
      | undefined;
    if (!session || session.identity_project !== this.config.project) {
      throw new Error(`replicated note references missing session ${value.sessionId}`);
    }
    const noteId = append(operation);
    this.bind('note', String(noteId), operation.entityId, entityFingerprint('note', value));
  }

  private applyClaim(
    operation: CoordinationOperation,
    value: CoordinationClaimValue | null,
    previous: CoordinationClaimValue | null,
  ): void {
    const claim = value ?? previous;
    if (!claim) return;
    const session = this.db.prepare('SELECT agent_id, status, identity_project FROM sessions WHERE id = ?').get(claim.sessionId) as
      | { agent_id: string | null; status: string; identity_project: string | null }
      | undefined;
    if (!session || session.identity_project !== this.config.project) {
      throw new Error(`replicated claim references missing session ${claim.sessionId}`);
    }
    if (operation.mutation === 'remove') {
      const options = claim.symbolPath || (claim.startLine !== null && claim.endLine !== null)
        ? {
            regions: [{
              path: claim.filePath,
              ...(claim.symbolPath ? { symbolPath: claim.symbolPath } : {}),
              ...(claim.startLine !== null ? { startLine: claim.startLine } : {}),
              ...(claim.endLine !== null ? { endLine: claim.endLine } : {}),
            }],
            agentId: session.agent_id,
          }
        : { agentId: session.agent_id };
      const result = this.sessions.releaseFiles(
        claim.sessionId,
        options.regions ? [] : [claim.filePath],
        options,
      );
      if (result.success !== true && result.code !== 'SESSION_NOT_ACTIVE') {
        throw new Error(`failed to release replicated claim ${operation.entityId}`);
      }
      this.db.prepare(`
        DELETE FROM coordination_peer_bindings WHERE project = ? AND kind = 'claim' AND entity_id = ?
      `).run(this.config.project, operation.entityId);
      return;
    }
    // A session completion and an earlier claim can legally cross during a
    // partition. The completed session is authoritative for local visibility;
    // retain the CRDT version and advance the cursor so the later tombstone is
    // still reachable instead of poisoning this page forever.
    if (session.status !== 'active') return;
    const result = claim.symbolPath || (claim.startLine !== null && claim.endLine !== null)
      ? this.sessions.claimFiles(claim.sessionId, [], {
          regions: [{
            path: claim.filePath,
            ...(claim.startLine !== null ? { startLine: claim.startLine } : {}),
            ...(claim.endLine !== null ? { endLine: claim.endLine } : {}),
            ...(claim.symbol ? { symbol: claim.symbol } : {}),
            ...(claim.symbolPath ? { symbolPath: claim.symbolPath } : {}),
          }],
          agentId: session.agent_id,
        })
      : this.sessions.claimFiles(claim.sessionId, [claim.filePath], { agentId: session.agent_id });
    if (result.success !== true) {
      throw new Error(`failed to apply replicated claim ${operation.entityId}: ${String(result.error ?? 'unknown error')}`);
    }
    this.bind('claim', claimLocalKey(claim), operation.entityId, entityFingerprint('claim', claim));
  }

  private applyLock(
    operation: CoordinationOperation,
    value: CoordinationLockValue | null,
    previous: CoordinationLockValue | null,
  ): void {
    const lock = value ?? previous;
    if (!lock) return;
    const storedBinding = this.db.prepare(`
      SELECT local_key FROM coordination_peer_bindings
      WHERE project = ? AND kind = 'lock' AND entity_id = ?
    `).get(this.config.project, operation.entityId) as { local_key: string } | undefined;
    const projectedKey = replicatedLockLocalKey(this.config.project, lock.name);
    // Old prerelease builds bound replicated leases directly to their human
    // lock names. Never trust that legacy mapping for mutation: it may now
    // point at an unrelated machine-local exclusion row.
    let binding = storedBinding &&
      (storedBinding.local_key === projectedKey || storedBinding.local_key.startsWith(`${projectedKey}:`))
      ? storedBinding
      : undefined;
    if (binding) {
      const existing = this.db.prepare('SELECT metadata FROM locks WHERE name = ?').get(binding.local_key) as
        | { metadata: string | null }
        | undefined;
      if (existing && !isReplicatedLockProjection(
        parseStoredMetadata(existing.metadata),
        this.config.project,
        lock.name,
        operation.entityId,
      )) {
        // A machine-local lock can deliberately or accidentally occupy a
        // projection-shaped name. A stale binding is never proof of ownership.
        binding = undefined;
      }
    }
    if (storedBinding && !binding) {
      this.db.prepare(`
        DELETE FROM coordination_peer_bindings
        WHERE project = ? AND kind = 'lock' AND entity_id = ?
      `).run(this.config.project, operation.entityId);
    }
    if (operation.mutation === 'remove' || lock.expiresAt <= this.now()) {
      if (binding) this.db.prepare('DELETE FROM locks WHERE name = ?').run(binding.local_key);
      this.db.prepare(`
        DELETE FROM coordination_peer_bindings WHERE project = ? AND kind = 'lock' AND entity_id = ?
      `).run(this.config.project, operation.entityId);
      return;
    }
    let localKey = binding?.local_key;
    if (!localKey) {
      const entitySuffix = digest(operation.entityId).slice(0, 12);
      for (let attempt = 0; attempt < 64; attempt += 1) {
        const candidate = attempt === 0
          ? projectedKey
          : `${projectedKey}:${entitySuffix}${attempt === 1 ? '' : `:${attempt}`}`;
        const existing = this.db.prepare('SELECT metadata FROM locks WHERE name = ?').get(candidate) as
          | { metadata: string | null }
          | undefined;
        if (!existing || isReplicatedLockProjection(
          parseStoredMetadata(existing.metadata),
          this.config.project,
          lock.name,
          operation.entityId,
        )) {
          localKey = candidate;
          break;
        }
      }
      if (!localKey) throw new Error(`no safe local projection slot for replicated lock ${operation.entityId}`);
    }
    const metadata = {
      ...(lock.metadata ?? {}),
      identityProject: this.config.project,
      replicated: true,
      coordinationLockName: lock.name,
      coordinationEntityId: operation.entityId,
    };
    this.db.prepare(`
      INSERT INTO locks (name, owner, pid, acquired_at, expires_at, metadata)
      VALUES (?, ?, NULL, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        owner = excluded.owner,
        pid = NULL,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        metadata = excluded.metadata
    `).run(localKey, lock.owner, lock.acquiredAt, lock.expiresAt, JSON.stringify(metadata));
    const localValue = { ...lock, metadata };
    this.bind('lock', localKey, operation.entityId, entityFingerprint('lock', localValue));
  }
}

export function createCoordinationPeer(deps: CoordinationPeerDeps): CoordinationPeer {
  return new CoordinationPeer(deps);
}
