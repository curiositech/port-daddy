/**
 * Routes ported from #454 when dispatch folded into the Conductor: the worker
 * OBSERVABILITY surface that the fold-in initially dropped.
 *   - GET  /dispatches/worker/status — is the daemon worker draining the queue?
 *   - POST /dispatches/:id/run       — enqueue-and-return (nudge an immediate poll)
 *
 * The worker lives in the daemon, so without these the autonomous worker is
 * unobservable/uncontrollable from outside. We also guard the route-ordering bug
 * they're prone to: the literal `/dispatches/worker/status` MUST NOT be swallowed
 * by the `/dispatches/:id` param matcher.
 */
import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';

const { dispatchesPlugin } = await import('../../routes/dispatches.js');

function fakeWorker(over = {}) {
  return {
    getStatus: () => ({
      running: true,
      inFlight: 0,
      maxConcurrency: 2,
      pollIntervalMs: 5000,
      startedAt: 1,
      totalClaimed: 3,
      totalSettled: 2,
      totalFailed: 1,
      ...over,
    }),
    poll: jest.fn(async () => 1),
  };
}

async function buildApp({ withWorker = true } = {}) {
  const app = Fastify();
  const db = createTestDb();
  const dispatchQueue = createDispatchQueue({ db });
  const workIntentService = createWorkIntentService({ db });
  const worker = withWorker ? fakeWorker() : undefined;
  await app.register(dispatchesPlugin, { deps: { dispatchQueue, dispatchWorker: worker, workIntentService } });
  await app.ready();
  return { app, dispatchQueue, worker };
}

describe('dispatch worker observability routes', () => {
  test('GET /dispatches/worker/status reports the worker when one is wired', async () => {
    const { app, worker } = await buildApp({ withWorker: true });
    const res = await app.inject({ method: 'GET', url: '/dispatches/worker/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.worker.enabled).toBe(true);
    expect(body.worker.running).toBe(true);
    expect(body.worker.maxConcurrency).toBe(2);
    await app.close();
  });

  test('GET /dispatches/worker/status degrades honestly when no worker is wired', async () => {
    const { app } = await buildApp({ withWorker: false });
    const res = await app.inject({ method: 'GET', url: '/dispatches/worker/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.worker).toEqual({ running: false, enabled: false });
    await app.close();
  });

  test('worker/status is NOT shadowed by /dispatches/:id (route-ordering guard)', async () => {
    // If `/:id` were registered first, this would 404 with "dispatch worker not
    // found". It must instead resolve the literal worker/status route.
    const { app } = await buildApp({ withWorker: true });
    const res = await app.inject({ method: 'GET', url: '/dispatches/worker/status' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty('worker');
    expect(body).not.toHaveProperty('error');
    await app.close();
  });

  test('POST /dispatches/:id/run nudges the worker for a proposed dispatch', async () => {
    const { app, dispatchQueue, worker } = await buildApp({ withWorker: true });
    const d = dispatchQueue.propose({ goal: 'do a thing', requestedBy: 'operator', baseBranch: 'main' });
    const res = await app.inject({ method: 'POST', url: `/dispatches/${d.id}/run` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.queued).toBe(true);
    expect(body.launchedThisTick).toBe(1);
    expect(worker.poll).toHaveBeenCalledTimes(1);
    await app.close();
  });

  test('POST /dispatches/:id/run is 503 when the worker is disabled', async () => {
    const { app, dispatchQueue } = await buildApp({ withWorker: false });
    const d = dispatchQueue.propose({ goal: 'g', requestedBy: 'operator', baseBranch: 'main' });
    const res = await app.inject({ method: 'POST', url: `/dispatches/${d.id}/run` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/worker is disabled/i);
    await app.close();
  });

  test('POST /dispatches/:id/run is 409 when the dispatch is not proposed', async () => {
    const { app, dispatchQueue, worker } = await buildApp({ withWorker: true });
    const d = dispatchQueue.propose({ goal: 'g', requestedBy: 'operator', baseBranch: 'main' });
    dispatchQueue.cancel(d.id, 'operator changed their mind');
    const res = await app.inject({ method: 'POST', url: `/dispatches/${d.id}/run` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/only 'proposed'/);
    expect(worker.poll).not.toHaveBeenCalled();
    await app.close();
  });

  test('POST /dispatches/:id/run is 404 for an unknown dispatch', async () => {
    const { app } = await buildApp({ withWorker: true });
    const res = await app.inject({ method: 'POST', url: '/dispatches/does-not-exist/run' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
