import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { createTupleSpace } from '../../lib/tuples.js';
import { createFleetRunner } from '../../lib/fleet-engine.js';

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('fleet trigger_tuple runtime', () => {
  let db;
  let tupleSpace;
  let originalFetch;

  beforeEach(() => {
    db = new Database(':memory:');
    tupleSpace = createTupleSpace(db);
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/spawn')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'completed' }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    tupleSpace.destroy?.();
    db.close();
  });

  test('arms trigger_tuple agents, routes tuple context through the mailbox, and dedupes duplicate tuple deliveries', async () => {
    let triggerTupleCallback = null;
    const tuples = {
      out: tupleSpace.out,
      take: tupleSpace.take,
      count: tupleSpace.count,
      poll: tupleSpace.poll,
      subscribe(pattern, options, callback) {
        triggerTupleCallback = callback;
        return () => {
          if (triggerTupleCallback === callback) triggerTupleCallback = null;
        };
      },
    };

    const runner = createFleetRunner({
      name: 'tuple-fleet',
      harbor: 'tuple-fleet:harbor',
      limits: { budgetUsdPerDay: 5 },
      agents: [{
        name: 'qa',
        backend: 'claude-cli',
        prompt: 'Review tuple-triggered work items.',
        triggerTuple: ['job', 'qa'],
        dedupeWindowMs: 60_000,
      }],
      watchers: [],
      channels: {},
    }, '/tmp/tuple-fleet', {
      tuples,
      messaging: {
        subscribe() {
          return null;
        },
      },
    });

    try {
      runner.startAll();
      await flushAsyncWork();

      expect(typeof triggerTupleCallback).toBe('function');
      expect(runner.getStatus()).toEqual([
        expect.objectContaining({
          name: 'qa',
          type: 'triggered',
          status: 'armed',
        }),
      ]);

      const sourceTuple = {
        id: 42,
        harbor: 'tuple-fleet:harbor',
        fields: ['job', 'qa', { ticket: 'PD-42' }],
        writtenBy: 'planner',
        createdAt: Date.now(),
        expiresAt: null,
      };

      await triggerTupleCallback(sourceTuple);
      await flushAsyncWork();

      const firstSpawnCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/spawn'));
      expect(firstSpawnCalls).toHaveLength(1);

      const firstBody = JSON.parse(firstSpawnCalls[0][1].body);
      expect(firstBody.task).toContain('- source: tuple');
      expect(firstBody.task).toContain('- tuple id: 42');
      expect(firstBody.task).toContain('- tuple harbor: tuple-fleet:harbor');
      expect(firstBody.task).toContain('- tuple pattern: ["job","qa"]');

      await triggerTupleCallback(sourceTuple);
      await flushAsyncWork();

      const finalSpawnCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/spawn'));
      expect(finalSpawnCalls).toHaveLength(1);
    } finally {
      runner.stopAll();
    }
  });
});
