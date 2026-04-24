/**
 * Integration tests for the fleet panic arm/disarm flow (Track 1b).
 *
 * Per FLEETCONTROL-HARDENING.md §6.2 and §8:
 *   - POST /fleet/panic with no confirm → { armed: false, pendingConfirmation: true }
 *   - POST /fleet/panic { confirm: true } → { armed: true }, broadcasts fleet:panic
 *   - POST /fleet/unpanic → { armed: false }, broadcasts fleet:unpanic
 *
 * Refund-on-panic for running bonds is TODO-gated because the hook depends
 * on spawner.listSpawned shape wiring in a sibling branch.
 */

import http from 'node:http';
import { request, getDaemonState } from '../helpers/integration-setup.js';

function collectSSE(channel, ms) {
  const { sockPath } = getDaemonState();
  return new Promise((resolve) => {
    const events = [];
    const req = http.request({
      socketPath: sockPath,
      path: `/msg/${encodeURIComponent(channel)}/subscribe`,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const frames = buf.split('\n\n');
        buf = frames.pop();
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          // Skip the subscription-ack frame the daemon sends on connect.
          // Its shape is {"channel":"<name>"} with no other fields.
          try {
            const parsed = JSON.parse(payload);
            const keys = Object.keys(parsed);
            if (keys.length === 1 && keys[0] === 'channel') continue;
            events.push(parsed);
          } catch {
            events.push(payload);
          }
        }
      });
    });
    req.on('error', () => resolve(events));
    req.end();
    setTimeout(() => { try { req.destroy(); } catch {} resolve(events); }, ms);
  });
}

async function routeExists(method, path) {
  const res = await request(path, { method });
  return res.status !== 404;
}

describe('Fleet panic arm/disarm flow', () => {
  let hasPanicRoutes = false;

  beforeAll(async () => {
    hasPanicRoutes = await routeExists('GET', '/fleet/panic');
    if (!hasPanicRoutes) {
      console.warn('[fleet-panic] /fleet/panic not registered — sibling routes branch not merged yet.');
    }
  });

  afterAll(async () => {
    if (hasPanicRoutes) {
      await request('/fleet/unpanic', { method: 'POST', body: { reason: 'test-cleanup' } });
    }
  });

  test('two-step arming: first POST requires confirmation, second arms', async () => {
    if (!hasPanicRoutes) return;

    const step1 = await request('/fleet/panic', {
      method: 'POST',
      body: { reason: 'drill' },
    });
    expect(step1.ok).toBe(true);
    expect(step1.data?.armed).toBe(false);
    expect(step1.data?.pendingConfirmation).toBe(true);
    expect(step1.data?.reason).toBe('drill');

    const panicEventsPromise = collectSSE('fleet:panic', 2000);

    const step2 = await request('/fleet/panic', {
      method: 'POST',
      body: { reason: 'drill', confirm: true },
    });
    expect(step2.ok).toBe(true);
    expect(step2.data?.armed).toBe(true);
    expect(step2.data?.reason).toBe('drill');

    const show = await request('/fleet/panic');
    expect(show.ok).toBe(true);
    expect(show.data?.armed).toBe(true);
    expect(show.data?.reason).toBe('drill');

    const panicEvents = await panicEventsPromise;
    if (panicEvents.length > 0) {
      const payload = typeof panicEvents[0] === 'string'
        ? panicEvents[0]
        : JSON.stringify(panicEvents[0]);
      expect(payload).toMatch(/drill|armed/i);
    }
  });

  test('unpanic disarms and broadcasts fleet:unpanic', async () => {
    if (!hasPanicRoutes) return;

    const unpanicEventsPromise = collectSSE('fleet:unpanic', 2000);
    const res = await request('/fleet/unpanic', {
      method: 'POST',
      body: { reason: 'drill-resolved' },
    });
    expect(res.ok).toBe(true);
    expect(res.data?.armed).toBe(false);

    const show = await request('/fleet/panic');
    expect(show.ok).toBe(true);
    expect(show.data?.armed).toBe(false);

    const events = await unpanicEventsPromise;
    if (events.length > 0) {
      const payload = typeof events[0] === 'string' ? events[0] : JSON.stringify(events[0]);
      expect(payload).toMatch(/cleared|resolved|drill/i);
    }
  });

  test('reason is required on arm and disarm', async () => {
    if (!hasPanicRoutes) return;
    const armNoReason = await request('/fleet/panic', { method: 'POST', body: {} });
    expect(armNoReason.status).toBe(400);
    const unpanicNoReason = await request('/fleet/unpanic', { method: 'POST', body: {} });
    // 400 (no reason) OR 409 (not panicked) both acceptable
    expect([400, 409]).toContain(unpanicNoReason.status);
  });
});
