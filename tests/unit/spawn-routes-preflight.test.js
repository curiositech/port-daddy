import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockAssessSpawnPreflight = jest.fn();

jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { resolveModel } = await import('../../lib/model-registry.js');
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
      budgetUsd: 0.75,
    }));

    await app.close();
  });

  test('POST /spawn parses numeric string budgetUsd before forwarding the cap', async () => {
    const { app, spawner, register } = buildApp();
    await register();

    await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: '0.75',
      },
    });

    expect(mockAssessSpawnPreflight.mock.calls.at(-1)[0].budgetUsd).toBe(0.75);
    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      budgetUsd: 0.75,
    }));

    await app.close();
  });

  test.each(['Infinity', 'abc'])('POST /spawn drops invalid parsed budgetUsd %s instead of forwarding a cap', async (budgetUsd) => {
    const { app, spawner, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockAssessSpawnPreflight).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
    }), expect.any(Object));
    expect(mockAssessSpawnPreflight.mock.calls.at(-1)[0].budgetUsd).toBeUndefined();
    expect(spawner.spawn).toHaveBeenCalledWith(expect.not.objectContaining({
      budgetUsd: expect.anything(),
    }));

    await app.close();
  });

  test.each([
    ['null', null],
    ['explicit undefined', undefined],
  ])('POST /spawn treats budgetUsd %s as omitted', async (_label, budgetUsd) => {
    const { app, spawner, register } = buildApp();
    await register();

    const payload = {
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      task: 'review the diff',
      budgetUsd,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockAssessSpawnPreflight.mock.calls.at(-1)[0]).not.toHaveProperty('budgetUsd');
    expect(spawner.spawn.mock.calls.at(-1)[0]).not.toHaveProperty('budgetUsd');

    await app.close();
  });

  test('POST /spawn accepts cli:agy and does not synthesize a model', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: true,
      blockedReasons: [],
      warnings: [],
      attempts: [{
        attempt: 1,
        backend: 'cli:agy',
        model: null,
        modelTier: null,
        backendSource: 'agent',
        modelSource: 'unset',
        warnings: [],
        readinessStatus: 'manual_check',
        readinessLaunchableUnverified: true,
        readinessSummary: 'Antigravity agy CLI binary found',
        readinessNextStep: 'Run `agy --print "hello"` once.',
      }],
      projectName: 'port-daddy',
      budget: null,
      localExecutionLikely: true,
      localExecutionNote: 'Local CLI backends may need unsandboxed approval.',
    });
    const { app, spawner, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'cli:agy',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:agy',
      identity: 'port-daddy:repo:cli',
      task: 'review the diff',
      budgetUsd: 0.75,
    }));
    expect(spawner.spawn.mock.calls[0][0].model).toBeUndefined();

    await app.close();
  });

  test('POST /spawn launches the effective backend selected by preflight', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: true,
      blockedReasons: [],
      warnings: ['PD_USE_CLI_BACKEND forces cli:claude-code'],
      attempts: [{
        attempt: 1,
        backend: 'cli:claude-code',
        model: 'sonnet',
        modelTier: null,
        backendSource: 'env',
        modelSource: 'unset',
        warnings: ['PD_USE_CLI_BACKEND forces cli:claude-code'],
        readinessStatus: 'manual_check',
        readinessLaunchableUnverified: true,
        readinessSummary: 'Claude Code CLI binary found',
        readinessNextStep: 'Run claude once interactively.',
      }],
      projectName: 'port-daddy',
      budget: null,
      localExecutionLikely: true,
      localExecutionNote: 'Local CLI backends may need unsandboxed approval.',
    });
    const { app, spawner, register } = buildApp();
    await register();

    await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'openai',
        model: 'gpt-5-mini',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
      },
    });

    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:claude-code',
      model: 'sonnet',
      requestedBackend: 'openai',
      requestedModel: 'gpt-5-mini',
      backendOverrideSource: 'env',
      identity: 'port-daddy:repo:cli',
      task: 'review the diff',
      budgetUsd: 0.75,
    }));

    await app.close();
  });

  test('POST /spawn preserves requested modelTier provenance when backend is forced', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: true,
      blockedReasons: [],
      warnings: ['PD_USE_CLI_BACKEND forces cli:codex'],
      attempts: [{
        attempt: 1,
        backend: 'cli:codex',
        model: 'codex-cli',
        modelTier: null,
        backendSource: 'env',
        modelSource: 'unset',
        warnings: ['PD_USE_CLI_BACKEND forces cli:codex'],
        readinessStatus: 'manual_check',
        readinessLaunchableUnverified: true,
        readinessSummary: 'Codex CLI binary found',
        readinessNextStep: 'Run codex once interactively.',
      }],
      projectName: 'port-daddy',
      budget: null,
      localExecutionLikely: true,
      localExecutionNote: 'Local CLI backends may need unsandboxed approval.',
    });
    const { app, spawner, register } = buildApp();
    await register();

    await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude',
        modelTier: 'high',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
      },
    });

    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      requestedBackend: 'claude',
      requestedModel: resolveModel({ backend: 'claude', tier: 'high' }),
      backendOverrideSource: 'env',
    }));

    await app.close();
  });

  test('POST /spawn preserves persisted forced-backend provenance from preflight', async () => {
    mockAssessSpawnPreflight.mockResolvedValueOnce({
      launchReady: true,
      blockedReasons: [],
      warnings: ['Persisted CLI backend selection forces cli:codex'],
      attempts: [{
        attempt: 1,
        backend: 'cli:codex',
        model: 'codex-cli',
        modelTier: null,
        backendSource: 'persisted',
        modelSource: 'unset',
        warnings: ['Persisted CLI backend selection forces cli:codex'],
        readinessStatus: 'manual_check',
        readinessLaunchableUnverified: true,
        readinessSummary: 'Codex CLI binary found',
      }],
      projectName: 'port-daddy',
      budget: null,
      localExecutionLikely: true,
      localExecutionNote: 'Local CLI backends may need unsandboxed approval.',
    });
    const { app, spawner, register } = buildApp();
    await register();

    await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'openai',
        model: 'gpt-5-mini',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
      },
    });

    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      requestedBackend: 'openai',
      requestedModel: 'gpt-5-mini',
      backendOverrideSource: 'persisted',
    }));

    await app.close();
  });

  // Giant Squid Harness (ADR-0091): the conjure-dispatch posture. The console's
  // ConjureDispatch arm sends `injectSquidHooks: true`, which the route must
  // plumb onto the spawner spec so runClaudeCli injects the pd-hook tentacles —
  // running the vendor CLI under PD coordination (lock-gating + pheromones).
  test('POST /spawn plumbs injectSquidHooks=true into the spawner spec', async () => {
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
        injectSquidHooks: true,
        tubeChannel: 'harness:repo:pilot',
      },
    });

    expect(spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      injectSquidHooks: true,
      tubeChannel: 'harness:repo:pilot',
    }));

    await app.close();
  });

  test('POST /spawn rejects an invalid tube channel before launching', async () => {
    const { app, spawner, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        identity: 'port-daddy:repo:cli',
        task: 'review the diff',
        budgetUsd: 0.75,
        tubeChannel: 'harness room',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'tubeChannel channel contains invalid characters',
    }));
    expect(spawner.spawn).not.toHaveBeenCalled();

    await app.close();
  });

  // Backward-compatible default: a body WITHOUT the flag (the manual Spawn) must
  // leave injectSquidHooks unset on the spec, so the spawn is byte-for-byte the
  // historical behaviour (no tentacles injected).
  test('POST /spawn leaves injectSquidHooks unset when the body omits it', async () => {
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

    const spec = spawner.spawn.mock.calls[0][0];
    expect(spec.injectSquidHooks).toBeUndefined();

    await app.close();
  });
});
