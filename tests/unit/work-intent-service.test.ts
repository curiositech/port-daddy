import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { readEvents } from '../../lib/agent-harbor/event-ledger.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';

describe('WorkIntentService', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('captures dispatch intake once and materializes one retry-safe dispatch projection', () => {
    const service = createWorkIntentService({
      db,
      now: () => new Date('2026-07-09T02:30:00.000Z'),
    });
    const queue = createDispatchQueue({ db });

    const first = service.captureDispatch({
      goal: 'ship the WorkIntent dispatch intake',
      requestedBy: 'operator',
      baseBranch: 'main',
      mergePolicy: 'review',
      idempotencyKey: 'request-123',
    }, queue);
    const retry = service.captureDispatch({
      goal: 'ship the WorkIntent dispatch intake',
      requestedBy: 'operator',
      baseBranch: 'main',
      mergePolicy: 'review',
      idempotencyKey: 'request-123',
    }, queue);

    expect(first.append.duplicate).toBe(false);
    expect(retry.append.duplicate).toBe(true);
    expect(retry.intent.intentId).toBe(first.intent.intentId);
    expect(retry.dispatch.id).toBe(first.dispatch.id);
    expect(queue.list({ state: 'all' })).toHaveLength(1);

    const events = readEvents(db, { streamType: 'work-intent' });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.source).toEqual(expect.objectContaining({ kind: 'compat', legacyVerb: 'dispatch' }));
    expect(payload.startPolicy).toBe('queued');
    expect(payload.compat.dispatchId).toBe(first.dispatch.id);
  });

  it('imports exactly one WorkIntent for a legacy dispatch before side effects', () => {
    const service = createWorkIntentService({
      db,
      now: () => new Date('2026-07-09T02:31:00.000Z'),
    });
    const queue = createDispatchQueue({ db, now: () => 1_820_000_000_000 });
    const legacy = queue.propose({
      goal: 'legacy row without WorkIntent',
      requestedBy: 'operator',
      baseBranch: 'main',
    });

    const first = service.ensureDispatchIntent(legacy);
    const retry = service.ensureDispatchIntent(legacy);

    expect(first.imported).toBe(true);
    expect(first.append?.duplicate).toBe(false);
    expect(retry.imported).toBe(false);
    expect(retry.append).toBeNull();
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
    expect(retry.intent.compat?.dispatchId).toBe(legacy.id);
  });
});
