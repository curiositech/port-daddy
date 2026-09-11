import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { readEvents } from '../../lib/agent-harbor/event-ledger.js';

const { dispatchesPlugin } = await import('../../routes/dispatches.js');

function worker() {
  return {
    getStatus: () => ({ running: true, inFlight: 0, maxConcurrency: 1 }),
    poll: jest.fn(async () => 1),
  };
}

async function buildApp(overrides = {}) {
  const app = Fastify();
  const db = createTestDb();
  const dispatchQueue = createDispatchQueue({ db, now: () => 1_820_000_000_000 });
  const workIntentService = createWorkIntentService({
    db,
    now: () => new Date('2026-07-09T02:40:00.000Z'),
  });
  const dispatchWorker = worker();
  await app.register(dispatchesPlugin, {
    deps: { dispatchQueue, dispatchWorker, workIntentService, ...overrides },
  });
  await app.ready();
  return { app, db, dispatchQueue, dispatchWorker };
}

describe('dispatch routes WorkIntent contract', () => {
  test('POST /dispatches appends WorkIntent first and retries idempotently', async () => {
    const { app, db } = await buildApp();
    const payload = {
      goal: 'implement WorkIntent-first dispatch intake',
      requestedBy: 'operator',
      baseBranch: 'main',
      projectDir: '/Users/operator/coding/port-daddy',
      mergePolicy: 'review',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/dispatches',
      headers: { 'idempotency-key': 'dispatch-intake-request-1' },
      payload,
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/dispatches',
      headers: { 'idempotency-key': 'dispatch-intake-request-1' },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().dispatch.id).toBe(first.json().dispatch.id);
    expect(retry.json().workIntent.duplicate).toBe(true);

    const events = readEvents(db, { streamType: 'work-intent' });
    expect(events).toHaveLength(1);
    const intent = JSON.parse(events[0].payload_json);
    expect(intent.source).toEqual(expect.objectContaining({ kind: 'compat', legacyVerb: 'dispatch' }));
    expect(intent.source.worktree).toBe('/Users/operator/coding/port-daddy');
    expect(first.json().dispatch.projectDir).toBe('/Users/operator/coding/port-daddy');
    expect(intent.startPolicy).toBe('queued');

    await app.inject({ method: 'GET', url: '/dispatches' });
    await app.inject({ method: 'GET', url: `/dispatches/${first.json().dispatch.id}` });
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
    await app.close();
  });

  test('POST /dispatches/:id/run imports WorkIntent for legacy rows before worker poll', async () => {
    const { app, db, dispatchQueue, dispatchWorker } = await buildApp();
    const legacy = dispatchQueue.propose({
      goal: 'legacy dispatch row',
      requestedBy: 'operator',
      baseBranch: 'main',
    });
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(0);

    const res = await app.inject({ method: 'POST', url: `/dispatches/${legacy.id}/run` });

    expect(res.statusCode).toBe(200);
    expect(dispatchWorker.poll).toHaveBeenCalledTimes(1);
    const events = readEvents(db, { streamType: 'work-intent' });
    expect(events).toHaveLength(1);
    const intent = JSON.parse(events[0].payload_json);
    expect(intent.compat.dispatchId).toBe(legacy.id);
    expect(intent.attachExisting).toBe(true);
    await app.close();
  });

  test('POST /dispatches maps projection validation failures to HTTP 400', async () => {
    const { app, db, dispatchQueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/dispatches',
      payload: {
        goal: 'invalid projection budget',
        budgetUsd: -1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/budgetUsd must be a non-negative number/);
    expect(dispatchQueue.list({ state: 'all' })).toHaveLength(0);
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
    await app.close();
  });

  test('POST /dispatches rejects a relative source project binding', async () => {
    const { app, db, dispatchQueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/dispatches',
      payload: { goal: 'invalid source binding', projectDir: 'relative/project' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/projectDir must be an absolute path/);
    expect(dispatchQueue.list({ state: 'all' })).toHaveLength(0);
    expect(readEvents(db, { streamType: 'work-intent' })).toHaveLength(1);
    await app.close();
  });

  test('POST /dispatches maps WorkIntent/internal failures to HTTP 500', async () => {
    const failingWorkIntentService = {
      captureDispatch: () => { throw new Error('ledger write failed'); },
      ensureDispatchIntent: () => { throw new Error('unused'); },
    };
    const { app } = await buildApp({ workIntentService: failingWorkIntentService });
    const res = await app.inject({
      method: 'POST',
      url: '/dispatches',
      payload: { goal: 'append should fail internally' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/ledger write failed/);
    await app.close();
  });
});
