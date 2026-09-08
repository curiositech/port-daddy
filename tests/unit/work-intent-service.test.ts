import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { readEvents } from '../../lib/agent-harbor/event-ledger.js';
import {
  WorkIntentMaterializationError,
  createWorkIntentService,
  dispatchIdForWorkIntent,
} from '../../lib/agent-harbor/work-intent-service.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { deriveWorktreePath } from '../../lib/dispatch/runner.js';

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
      projectDir: '/Users/operator/coding/port-daddy',
      mergePolicy: 'review',
      idempotencyKey: 'request-123',
    }, queue);
    const retry = service.captureDispatch({
      goal: 'ship the WorkIntent dispatch intake',
      requestedBy: 'operator',
      baseBranch: 'main',
      projectDir: '/Users/operator/coding/port-daddy',
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
    expect(payload.source.worktree).toBe('/Users/operator/coding/port-daddy');
    expect(payload.constraints.workdir).toBe('/Users/operator/coding/port-daddy');
    expect(payload.compat.dispatchProjection.projectDir).toBe('/Users/operator/coding/port-daddy');
    expect(first.dispatch.projectDir).toBe('/Users/operator/coding/port-daddy');
    expect(payload.startPolicy).toBe('queued');
    expect(payload.compat.dispatchId).toBe(first.dispatch.id);
  });

  it('starts a console WorkIntent through one deterministic compatibility projection', () => {
    const service = createWorkIntentService({
      db,
      now: () => new Date('2026-07-09T02:30:00.000Z'),
      uuid: () => 'console-start',
    });
    const queue = createDispatchQueue({ db });
    const captured = service.captureWithInitialPlan({
      intentId: 'work_intent_console_start',
      idempotencyKey: 'pd-console:work:console-start',
      source: {
        kind: 'console',
        surface: 'pd-console',
        actorId: 'operator:local',
        worktree: '/Users/operator/coding/port-daddy',
      },
      goalText: 'Take the next roadmap slice',
      constraints: { maxCostUsd: 10, reviewRequired: true },
      startPolicy: 'queued',
      operator: 'operator:local',
    });

    const first = service.start(captured.intent.intentId, queue);
    const retry = service.start(captured.intent.intentId, queue);

    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.dispatch.id).toBe(first.dispatch.id);
    expect(retry.dispatch).toMatchObject({
      goal: 'Take the next roadmap slice',
      state: 'proposed',
      budgetUsd: 10,
      mergePolicy: 'review',
      requestedBy: 'operator:local',
      backend: null,
      projectDir: '/Users/operator/coding/port-daddy',
    });
    expect(retry.dispatch.tags).toEqual(expect.arrayContaining([
      'work-intent:work_intent_console_start',
      'surface:pd-console',
    ]));
    expect(queue.list({ state: 'all' })).toHaveLength(1);
  });

  it('puts deterministic entropy before the legacy worktree truncation point', () => {
    const first = dispatchIdForWorkIntent('work_intent_console_alpha');
    const retry = dispatchIdForWorkIntent('work_intent_console_alpha');
    const second = dispatchIdForWorkIntent('work_intent_console_beta');

    expect(retry).toBe(first);
    expect(second).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9-]{27}$/);
    expect(deriveWorktreePath(second)).not.toBe(deriveWorktreePath(first));
  });

  it('gives compatibility dispatches distinct worktrees while preserving fast intent lookup', () => {
    const noScanDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          if (sql.includes("WHERE stream_type = 'work-intent' ORDER BY ledger_seq ASC")) {
            throw new Error('full scan forbidden in this regression');
          }
          return target.prepare.call(target, sql);
        };
      },
    }) as DatabaseInstance;
    const service = createWorkIntentService({ db: noScanDb });
    const queue = createDispatchQueue({ db });

    const first = service.captureDispatch({
      goal: 'reskin FleetBar',
      idempotencyKey: 'operator:story-linework:fleetbar',
    }, queue);
    const second = service.captureDispatch({
      goal: 'reskin the CLI',
      idempotencyKey: 'operator:story-linework:cli',
    }, queue);
    const unkeyed = service.captureDispatch({
      goal: 'reskin the Harbor editor',
    }, queue);

    expect(first.dispatch.id).toMatch(/^[a-f0-9]{8}-[a-f0-9-]{27}$/);
    expect(deriveWorktreePath(second.dispatch.id)).not.toBe(deriveWorktreePath(first.dispatch.id));
    expect(service.ensureDispatchIntent(first.dispatch).intent.intentId).toBe(first.intent.intentId);
    expect(service.ensureDispatchIntent(second.dispatch).intent.intentId).toBe(second.intent.intentId);
    expect(unkeyed.intent.intentId).toMatch(/^work_intent_dispatch_[a-f0-9]{32}$/);
    expect(service.ensureDispatchIntent(unkeyed.dispatch).intent.intentId).toBe(unkeyed.intent.intentId);
  });

  it('falls back to a stable UUID-shaped dispatch id for malformed compatibility ids', () => {
    const malformed = dispatchIdForWorkIntent('work_intent_dispatch_not-a-token');

    expect(malformed).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(dispatchIdForWorkIntent('work_intent_dispatch_not-a-token')).toBe(malformed);
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

  it('retries failed materialization from the persisted WorkIntent payload, not retry parameters', () => {
    const service = createWorkIntentService({
      db,
      now: () => new Date('2026-07-09T02:32:00.000Z'),
    });
    const queue = createDispatchQueue({ db });

    expect(() => service.captureDispatch({
      goal: 'persisted failing projection',
      requestedBy: 'operator',
      budgetUsd: -1,
      idempotencyKey: 'bad-projection',
    }, queue)).toThrow(WorkIntentMaterializationError);
    expect(queue.list({ state: 'all' })).toHaveLength(0);

    expect(() => service.captureDispatch({
      goal: 'retry tries to change the ledger fact',
      requestedBy: 'operator',
      budgetUsd: 10,
      idempotencyKey: 'bad-projection',
    }, queue)).toThrow(/budgetUsd must be a non-negative number/);
    expect(queue.list({ state: 'all' })).toHaveLength(0);

    const events = readEvents(db, { streamType: 'work-intent' });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.goal.text).toBe('persisted failing projection');
    expect(payload.compat.dispatchProjection.budgetUsd).toBe(-1);
  });

  it('uses the deterministic event-id fast path before falling back to a ledger scan', () => {
    const noScanDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          if (sql.includes("WHERE stream_type = 'work-intent' ORDER BY ledger_seq ASC")) {
            throw new Error('full scan forbidden in this regression');
          }
          return target.prepare.call(target, sql);
        };
      },
    }) as DatabaseInstance;
    const service = createWorkIntentService({
      db: noScanDb,
      now: () => new Date('2026-07-09T02:33:00.000Z'),
    });
    const queue = createDispatchQueue({ db });

    const captured = service.captureDispatch({
      goal: 'fast lookup dispatch',
      requestedBy: 'operator',
      idempotencyKey: 'fast-path',
    }, queue);
    const ensured = service.ensureDispatchIntent(captured.dispatch);

    expect(ensured.imported).toBe(false);
    expect(ensured.intent.intentId).toBe(captured.intent.intentId);
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
  });
});
