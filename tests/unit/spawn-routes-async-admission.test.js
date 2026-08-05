import { jest } from '@jest/globals';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.js';

const mockAssessSpawnPreflight = jest.fn();
jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { spawnPlugin } = await import('../../routes/spawn.js');

function buildApp(receiptStore = null) {
  const app = Fastify();
  const spawner = {
    spawn: jest.fn(async () => ({
      agentId: 'spawned-123',
      backend: 'claude-cli',
      model: 'claude-sonnet-4-5-20250929',
      status: 'completed',
      output: 'done',
      error: null,
      startedAt: 1,
      completedAt: 2,
    })),
    list: jest.fn(() => []),
    kill: jest.fn(),
  };

  return {
    app,
    spawner,
    receiptStore,
    register: () => app.register(spawnPlugin, {
      deps: {
        spawner,
        costTracker: {
          budgetStatus: jest.fn(),
        },
        receiptStore,
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
      },
    }),
  };
}

describe('spawn routes async admission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssessSpawnPreflight.mockResolvedValue({
      launchReady: true,
      blockedReasons: [],
      warnings: [],
      attempts: [{
        attempt: 1,
        backend: 'claude-cli',
        model: 'claude-sonnet-4-5-20250929',
        modelTier: null,
        backendSource: 'agent',
        modelSource: 'env',
        warnings: [],
        readinessStatus: 'manual_check',
        readinessSummary: 'Claude CLI binary found',
        readinessNextStep: 'Run claude once interactively.',
      }],
      projectName: 'port-daddy',
      budget: {
        project: 'port-daddy',
        budgetUsdPerDay: 0.75,
        spentUsd: 0.2,
        remainingUsd: 0.55,
        percentUsed: 26.7,
        overBudget: false,
      },
      localExecutionLikely: true,
      localExecutionNote: 'Local CLI backends may need unsandboxed approval.',
    });
  });

  describe('POST /spawn with async mode', () => {
    test('returns 202 with receipt location when Prefer: respond-async + Idempotency-Key present', async () => {
      const db = new Database(':memory:');
      const receiptStore = createAgentRunReceiptStore(db);
      const { app, register } = buildApp(receiptStore);
      await register();

      const res = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': 'test-key-1',
        },
        payload: {
          backend: 'claude-cli',
          task: 'test task',
          identity: 'port-daddy:repo:cli',
          budgetUsd: 0.75,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual(expect.objectContaining({
        success: true,
        receipt: expect.objectContaining({
          status: 'accepted',
          kind: 'spawn',
        }),
        replayed: false,
      }));
      expect(res.headers['content-location']).toMatch(/^\/spawn\/receipts\/run-/);
      expect(res.headers['retry-after']).toBe('60');
    });

    test('idempotent replay returns same receipt without launching backend twice', async () => {
      const db = new Database(':memory:');
      const receiptStore = createAgentRunReceiptStore(db);
      const { app, spawner, register } = buildApp(receiptStore);
      await register();

      const idempotencyKey = 'replay-key-1';
      const payload = {
        backend: 'claude-cli',
        task: 'test task',
        identity: 'port-daddy:repo:cli',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res1.statusCode).toBe(202);
      const receipt1 = res1.json().receipt;

      const res2 = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': idempotencyKey,
        },
        payload,
      });

      expect(res2.statusCode).toBe(202);
      const receipt2 = res2.json().receipt;

      // Same receipt ID, no duplicate backend spawns
      expect(receipt2.id).toBe(receipt1.id);
      expect(receipt2.replayed).toBe(true);
      expect(spawner.spawn).not.toHaveBeenCalled();
    });

    test('rejects replay with different request body as idempotency conflict', async () => {
      const db = new Database(':memory:');
      const receiptStore = createAgentRunReceiptStore(db);
      const { app, register } = buildApp(receiptStore);
      await register();

      const idempotencyKey = 'conflict-key-1';

      const res1 = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': idempotencyKey,
        },
        payload: {
          backend: 'claude-cli',
          task: 'task A',
        },
      });

      expect(res1.statusCode).toBe(202);

      const res2 = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': idempotencyKey,
        },
        payload: {
          backend: 'claude-cli',
          task: 'task B',
        },
      });

      expect(res2.statusCode).toBe(409);
      expect(res2.json()).toEqual(expect.objectContaining({
        error: expect.stringContaining('idempotency key conflict'),
      }));
    });
  });

  describe('GET /spawn/receipts/:id', () => {
    test('retrieves accepted receipt with atomic accounting', async () => {
      const db = new Database(':memory:');
      const receiptStore = createAgentRunReceiptStore(db);
      const { app, register } = buildApp(receiptStore);
      await register();

      const res1 = await app.inject({
        method: 'POST',
        url: '/spawn',
        headers: {
          'prefer': 'respond-async',
          'idempotency-key': 'get-test-1',
        },
        payload: {
          backend: 'claude-cli',
          task: 'test task',
          budgetUsd: 0.5,
        },
      });

      const receipt = res1.json().receipt;
      const receiptId = receipt.id;

      const res2 = await app.inject({
        method: 'GET',
        url: `/spawn/receipts/${receiptId}`,
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual(expect.objectContaining({
        success: true,
        receipt: expect.objectContaining({
          id: receiptId,
          status: 'accepted',
          kind: 'spawn',
          budgetUsd: 0.5,
        }),
      }));
    });

    test('returns 404 for nonexistent receipt', async () => {
      const db = new Database(':memory:');
      const receiptStore = createAgentRunReceiptStore(db);
      const { app, register } = buildApp(receiptStore);
      await register();

      const res = await app.inject({
        method: 'GET',
        url: '/spawn/receipts/run-nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(expect.objectContaining({
        error: expect.stringContaining('not found'),
      }));
    });
  });

  describe('legacy synchronous POST /spawn', () => {
    test('still works when no async headers present', async () => {
      const { app, spawner, register } = buildApp(null);
      await register();

      const res = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: {
          backend: 'claude-cli',
          task: 'test task',
          identity: 'port-daddy:repo:cli',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expect.objectContaining({
        success: true,
        agentId: 'spawned-123',
      }));
      expect(spawner.spawn).toHaveBeenCalled();
    });

    test('returns 200 on sync spawn completion', async () => {
      const { app, register } = buildApp(null);
      await register();

      const res = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: {
          backend: 'claude-cli',
          task: 'test task',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
