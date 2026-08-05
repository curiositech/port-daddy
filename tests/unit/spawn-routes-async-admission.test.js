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

describe('spawn route asynchronous admission smoke', () => {
  let app;
  let db;
  let finishSpawn;
  let spawner;

  beforeEach(async () => {
    db = createTestDb();
    spawner = {
      spawn: jest.fn(() => new Promise((resolve) => {
        finishSpawn = resolve;
      })),
      list: jest.fn(() => []),
      kill: jest.fn(),
    };
    const transcripts = {
      listTranscripts: jest.fn(() => [{ id: 'tx-route-smoke' }]),
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

  test('admits once, replays as accepted, and collects the terminal receipt', async () => {
    const request = {
      method: 'POST',
      url: '/spawn',
      headers: {
        prefer: 'respond-async',
        'idempotency-key': 'route-smoke-key',
      },
      payload: {
        backend: 'cli:codex',
        task: 'prove durable async admission',
        identity: 'port-daddy:test:route-async',
        budgetUsd: 0.75,
      },
    };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(first.headers['retry-after']).toBe('1');
    const admitted = first.json();
    expect(admitted).toEqual(expect.objectContaining({
      accepted: true,
      replayed: false,
      status: 'accepted',
    }));
    expect(first.headers.location).toBe(`/spawn/${admitted.receiptId}`);

    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(expect.objectContaining({
      accepted: true,
      replayed: true,
      receiptId: admitted.receiptId,
      status: 'accepted',
    }));
    expect(spawner.spawn).toHaveBeenCalledTimes(1);

    finishSpawn({
      agentId: 'agent-route-smoke',
      harnessSessionId: 'session-route-smoke',
      backend: 'cli:codex',
      status: 'completed',
      error: null,
      telemetry: null,
    });
    const terminal = await waitForTerminal(app, admitted.receiptId);
    expect(terminal).toEqual(expect.objectContaining({
      status: 'completed',
      terminal: true,
      success: true,
      live: false,
      transcriptId: 'tx-route-smoke',
    }));
  });
});
