import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { basename } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createSorties } from '../../lib/sorties.js';

const mockAssessSpawnPreflight = jest.fn();

jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { sortiesPlugin } = await import('../../routes/sorties.js');

function buildApp() {
  const app = Fastify();
  const db = createTestDb();
  const sorties = createSorties(db);
  const spawner = {
    spawn: jest.fn(async () => ({
      success: true,
      agentId: 'spawned-sortie-123',
      backend: 'codex',
      model: 'gpt-5.4-mini',
      status: 'completed',
      output: 'mission done',
      error: null,
      startedAt: 1,
      completedAt: 2,
    })),
  };

  return {
    app,
    db,
    sorties,
    spawner,
    register: () => app.register(sortiesPlugin, {
      deps: {
        spawner,
        sorties,
        costTracker: { budgetStatus: jest.fn() },
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
      },
    }),
  };
}

describe('sortie routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssessSpawnPreflight.mockResolvedValue({
      launchReady: true,
      blockedReasons: [],
      warnings: [],
      attempts: [{
        attempt: 1,
        backend: 'codex',
        model: 'gpt-5.4-mini',
        modelTier: 'low',
        backendSource: 'request',
        modelSource: 'tier',
        warnings: [],
        readinessStatus: 'ready',
        readinessSummary: 'Codex available',
      }],
      projectName: 'port-daddy',
      budget: {
        project: 'port-daddy',
        budgetUsdPerDay: 0.75,
        spentUsd: 0,
        remainingUsd: 0.75,
        percentUsed: 0,
        overBudget: false,
      },
      localExecutionLikely: true,
    });
  });

  test('POST /sorties persists a tracked mission and exposes status/logs', async () => {
    const { app, db, spawner, register } = buildApp();
    await register();
    const project = basename(process.cwd());

    const createRes = await app.inject({
      method: 'POST',
      url: '/sorties',
      payload: {
        goal: 'Investigate flaky auth tests',
        backend: 'codex',
        modelTier: 'low',
        budgetUsd: 0.75,
        projectDir: process.cwd(),
        recipe: 'investigate',
        expectedOutput: 'Root-cause memo',
      },
    });

    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.success).toBe(true);
    expect(created.sortie.id).toMatch(/^sortie-/);
    expect(created.sortie.harbor).toBe(`${project}:sortie:${created.sortie.id}`);
    expect(created.sortie.status).toBe('completed');
    expect(created.sortie.startedAt).toBeGreaterThan(0);
    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      modelTier: 'low',
      identity: `${project}:sortie:${created.sortie.id}:coordinator`,
    }));

    const listRes = await app.inject({
      method: 'GET',
      url: `/sorties?projectDir=${encodeURIComponent(process.cwd())}`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().count).toBe(1);

    const statusRes = await app.inject({
      method: 'GET',
      url: `/sorties/${created.sortie.id}`,
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().sortie.resultOutput).toBe('mission done');

    const logsRes = await app.inject({
      method: 'GET',
      url: `/sorties/${created.sortie.id}/logs`,
    });
    expect(logsRes.statusCode).toBe(200);
    expect(logsRes.json().events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'sortie:created',
      'sortie:planned',
      'sortie:started',
      'sortie:completed',
    ]));

    await app.close();
    db.close();
  });

  test('POST /sorties forwards structured telos to the spawned coordinator', async () => {
    const { app, db, spawner, register } = buildApp();
    await register();

    const telos = {
      headline: 'Keep sortie purpose explicit',
      facets: ['coordinate bounded work', 'report evidence'],
      hierarchy: ['Port Daddy operator trust', 'Sorties'],
      currentIntent: 'Investigate flaky auth tests',
      source: 'creator',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/sorties',
      payload: {
        goal: 'Investigate flaky auth tests',
        backend: 'codex',
        modelTier: 'low',
        budgetUsd: 0.75,
        projectDir: process.cwd(),
        telos,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sortie.metadata.telos).toEqual(telos);
    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({ telos }));

    await app.close();
    db.close();
  });

  test('POST /sorties blocks the mission before launch when preflight fails', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: false,
      blockedReasons: ['budget exceeded'],
      warnings: [],
      attempts: [],
      projectName: 'port-daddy',
      budget: null,
      localExecutionLikely: false,
    });

    const { app, db, spawner, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/sorties',
      payload: {
        goal: 'Review the branch',
        backend: 'codex',
        budgetUsd: 0.5,
        projectDir: process.cwd(),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('budget exceeded');
    expect(body.sortie.status).toBe('blocked');
    expect(spawner.spawn).not.toHaveBeenCalled();

    await app.close();
    db.close();
  });
});
