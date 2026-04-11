import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockAssessSpawnPreflight = jest.fn();

jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { spawnPlugin } = await import('../../routes/spawn.js');

function buildApp() {
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
    register: () => app.register(spawnPlugin, {
      deps: {
        spawner,
        costTracker: {
          budgetStatus: jest.fn(),
        },
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
      },
    }),
  };
}

describe('spawn routes preflight', () => {
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

  test('POST /spawn/preflight returns the structured launch plan', async () => {
    const { app, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/spawn/preflight',
      payload: {
        backend: 'claude-cli',
        identity: 'port-daddy:repo:cli',
        budgetUsd: 0.75,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      launchReady: true,
      projectName: 'port-daddy',
      budget: expect.objectContaining({
        budgetUsdPerDay: 0.75,
      }),
    }));
    expect(mockAssessSpawnPreflight).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      budgetUsd: 0.75,
    }), expect.any(Object));

    await app.close();
  });

  test('POST /spawn blocks launch when preflight fails', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: false,
      blockedReasons: ['A positive budget ceiling is required for every agentic launch.'],
      warnings: [],
      attempts: [],
      projectName: null,
      budget: null,
      localExecutionLikely: false,
    });

    const { app, spawner, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        task: 'review the diff',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      code: 'PRECONDITION_FAILED',
      error: 'A positive budget ceiling is required for every agentic launch.',
    }));
    expect(spawner.spawn).not.toHaveBeenCalled();

    await app.close();
  });

  test('POST /spawn forwards the resolved model from preflight', async () => {
    const { app, spawner, register } = buildApp();
    await register();

    await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
      },
    });

    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      model: 'claude-sonnet-4-5-20250929',
      task: 'review the diff',
    }));

    await app.close();
  });
});
