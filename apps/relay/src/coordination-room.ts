/**
 * One ADR-0092 coordination room per project.
 *
 * The Durable Object is a cloud replica, not an authority. Pushes are CRDT
 * operations, so the object never arbitrates a local write or requires a local
 * daemon to be online. The hot path buffers operations and arms one alarm;
 * alarm() appends the whole buffer with ONE multi-key storage.put(). A sender
 * retains its local outbox until a later sync reports the op id as durable, so
 * eviction before the alarm loses no coordination fact: the source retries.
 */

import {
  CoordinationLedger,
  type CoordinationOperation,
  type CoordinationSyncRequest,
  type CoordinationSyncResponse,
  type CursorOperation,
  validateCoordinationClockSkew,
  validateCoordinationOperation,
} from '../../../lib/coordination-ledger.js';
import type { Env } from './types.js';

export const COORDINATION_FLUSH_MS = 5_000;
export const COORDINATION_MAX_PUSH = 256;
export const COORDINATION_MAX_PULL = 1_000;
/** Leave ample headroom below the SQLite-backed DO 2 MiB key+value ceiling. */
export const COORDINATION_STORAGE_CHUNK_BYTES = 1024 * 1024;
/** storage.put(entries) accepts 128 pairs; reserve one for the cursor meta row. */
export const COORDINATION_MAX_BATCH_KEYS = 127;

const BATCH_PREFIX = 'batch:';
const META_KEY = 'meta';

interface CoordinationMeta {
  cursor: number;
}

function batchKey(first: number, last: number): string {
  return `${BATCH_PREFIX}${String(first).padStart(16, '0')}-${String(last).padStart(16, '0')}`;
}

function isSyncRequest(value: unknown): value is CoordinationSyncRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return typeof request.replicaId === 'string'
    && typeof request.actorId === 'string'
    && Number.isSafeInteger(request.since)
    && Number(request.since) >= 0
    && Array.isArray(request.operations);
}

export class CoordinationRoom implements DurableObject {
  private readonly state: DurableObjectState;
  // Kept for the standard Durable Object constructor contract and future
  // per-room settings. Authentication remains at the Worker route boundary.
  private readonly env: Env;
  private loaded = false;
  private durableCursor = 0;
  private readonly ledger = new CoordinationLedger();
  private durable: CursorOperation[] = [];
  private readonly pending = new Map<string, CoordinationOperation>();
  private alarmArmed = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.searchParams.get('action') !== 'sync') {
      return Response.json({ error: 'Unknown coordination-room action', code: 'NOT_FOUND' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Malformed JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!isSyncRequest(body)) {
      return Response.json({ error: 'Malformed sync request', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.operations.length > COORDINATION_MAX_PUSH) {
      return Response.json(
        { error: `At most ${COORDINATION_MAX_PUSH} operations may be pushed at once`, code: 'BATCH_TOO_LARGE' },
        { status: 413 },
      );
    }
    for (const operation of body.operations) {
      const reason = validateCoordinationOperation(operation);
      if (reason) {
        return Response.json({ error: reason, code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const skewReason = validateCoordinationClockSkew(operation);
      if (skewReason) {
        return Response.json({ error: skewReason, code: 'CLOCK_SKEW' }, { status: 409 });
      }
      if (operation.replicaId !== body.replicaId || operation.actorId !== body.actorId) {
        return Response.json(
          { error: 'Operation actor/replica does not match the sync envelope', code: 'SCOPE_MISMATCH' },
          { status: 403 },
        );
      }
    }

    await this.ensureLoaded();
    const accepted: string[] = [];
    const pending: string[] = [];
    for (const operation of body.operations) {
      if (this.ledger.has(operation.opId)) {
        accepted.push(operation.opId);
      } else {
        this.pending.set(operation.opId, operation);
        pending.push(operation.opId);
      }
    }
    if (this.pending.size > 0) await this.armFlush();

    const available = this.durable.filter((entry) => entry.cursor > body.since);
    const operations = available.slice(0, COORDINATION_MAX_PULL);
    const cursor = operations.at(-1)?.cursor ?? body.since;
    const response: CoordinationSyncResponse = {
      cursor,
      operations,
      hasMore: available.length > operations.length,
      accepted,
      pending,
    };
    return Response.json(response);
  }

  /** Flush one pending batch. Local outboxes make a pre-flush eviction retry-safe. */
  async alarm(): Promise<void> {
    this.alarmArmed = false;
    await this.ensureLoaded();
    if (this.pending.size === 0) return;

    const candidates = [...this.pending.values()].filter((operation) => !this.ledger.has(operation.opId));
    const chunks: CursorOperation[][] = [];
    let current: CursorOperation[] = [];
    let currentBytes = 2;
    let nextCursor = this.durableCursor + 1;
    for (const operation of candidates) {
      const entry = { cursor: nextCursor, operation };
      const entryBytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
      if (current.length > 0 && currentBytes + entryBytes > COORDINATION_STORAGE_CHUNK_BYTES) {
        chunks.push(current);
        if (chunks.length >= COORDINATION_MAX_BATCH_KEYS) break;
        current = [];
        currentBytes = 2;
      }
      current.push(entry);
      currentBytes += entryBytes;
      nextCursor += 1;
    }
    if (current.length > 0 && chunks.length < COORDINATION_MAX_BATCH_KEYS) chunks.push(current);
    const cursorOperations = chunks.flat();
    const batch = cursorOperations.map((entry) => entry.operation);
    if (batch.length === 0) {
      this.pending.clear();
      return;
    }

    const durableThrough = cursorOperations.at(-1)?.cursor ?? this.durableCursor;

    const storageEntries: Record<string, CursorOperation[] | CoordinationMeta> = {
      [META_KEY]: { cursor: durableThrough },
    };
    for (const chunk of chunks) {
      storageEntries[batchKey(chunk[0]!.cursor, chunk.at(-1)!.cursor)] = chunk;
    }

    // The only coordination-ledger storage write: one multi-key put per alarm,
    // regardless of how many operations arrived during the batching window.
    await this.state.storage.put(storageEntries);

    this.ledger.merge(batch);
    this.durable.push(...cursorOperations);
    this.durableCursor = durableThrough;
    for (const operation of batch) this.pending.delete(operation.opId);
    if (this.pending.size > 0) await this.armFlush();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const [meta, rows] = await Promise.all([
      this.state.storage.get<CoordinationMeta>(META_KEY),
      this.state.storage.list<CursorOperation[]>({ prefix: BATCH_PREFIX }),
    ]);
    const durable = [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, operations]) => Array.isArray(operations) ? operations : [])
      .filter((entry) => Number.isSafeInteger(entry?.cursor) && validateCoordinationOperation(entry?.operation) === null)
      .sort((a, b) => a.cursor - b.cursor);
    this.durable = durable;
    this.ledger.merge(durable.map((entry) => entry.operation));
    this.durableCursor = Math.max(meta?.cursor ?? 0, durable.at(-1)?.cursor ?? 0);
    this.loaded = true;
  }

  private async armFlush(): Promise<void> {
    if (this.alarmArmed) return;
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(Date.now() + COORDINATION_FLUSH_MS);
    }
    this.alarmArmed = true;
  }
}
