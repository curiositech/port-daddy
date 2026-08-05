import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';

const { spawnPlugin } = await import('../../routes/spawn.js');
const { createTestDb } = await import('../setup-unit.js');

async function waitForTerminal(app, receiptId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/spawn/${receiptId}` });
    if (response.statusCode === 200 && response.json().terminal) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`receipt ${receiptId} did not become terminal`);
}

describe('spawn async admission adversarial tests', () => {
  let app;
  let db;
  let spawner;
  let transcripts;

  beforeEach(async () => {
    db = createTestDb();
    spawner = {
      spawn: jest.fn(() => new Promise((resolve) => {
        // Simulate async spawn
      })),
      list: jest.fn(() => []),
      kill: jest.fn(),
    };
    transcripts = {
      listTranscripts: jest.fn(() => [{ id: 'tx-adv-test' }]),
    };

    app = Fastify();
    await app.register(spawnPlugin, {
      deps: {
        spawner,
        costTracker: {},
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
        db,
        transcripts,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('fails without idempotency-key when prefer-async is present', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async' },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Idempotency-Key');
  });

  test('handles duplicate idempotency keys with 409', async () => {
    const key = 'duplicate-key';
    const first = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': key },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': key },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().receiptId).toBe(first.json().receiptId);
  });

  test('replays terminal state without re-executing backend', async () => {
    const key = 'replay-key';
    const first = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': key },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(first.statusCode).toBe(202);

    const receiptId = first.json().receiptId;
    const replay = await app.inject({
      method: 'GET',
      url: `/spawn/${receiptId}`
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().terminal).toBe(true);
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test('handles spawner errors without marking as completed', async () => {
    const key = 'error-key';
    const response = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': key },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(response.statusCode).toBe(202);

    // Simulate spawner error
    spawner.spawn.mockImplementationOnce(() => {
      throw new Error('Spawner failed');
    });

    const receiptId = response.json().receiptId;
    await waitForTerminal(app, receiptId);
    const final = await app.inject({
      method: 'GET',
      url: `/spawn/${receiptId}`
    });
    expect(final.json().status).toBe('no_runtime');
    expect(final.json().error).toContain('Spawner failed');
  });

  test('falls back to synchronous mode when async components are missing', async () => {
    const appNoAsync = Fastify();
    await appNoAsync.register(spawnPlugin, {
      deps: {
        spawner,
        costTracker: {},
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
        db: undefined,
        transcripts: undefined,
      },
    });
    await appNoAsync.ready();

    const response = await appNoAsync.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'test' },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(false);
  });

  test('correctly handles concurrent idempotency key requests', async () => {
    const key = 'concurrent-key';
    const promises = Array.from({ length: 2 }, () =>
      app.inject({
        method: 'POST',
        url: '/spawn',
        headers: { prefer: 'respond-async', 'idempotency-key': key },
        payload: { backend: 'cli:codex', task: 'test' }
      })
    );

    const results = await Promise.all(promises);
    expect(results[0].statusCode).toBe(202);
    expect(results[1].statusCode).toBe(409);
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test('returns correct retry-after header for non-terminal states', async () => {
    const key = 'retry-key';
    const response = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': key },
      payload: { backend: 'cli:codex', task: 'test' }
    });
    expect(response.headers['retry-after']).toBe('1');
  });
});