import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';

const mockSpawnViaCliTube = jest.fn();
const mockAssessSpawnPreflight = jest.fn();

await jest.unstable_mockModule('../../lib/spawner/backends/cli-tube.js', () => ({
  spawnViaCliTube: mockSpawnViaCliTube,
}));

await jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { spawnPlugin } = await import('../../routes/spawn.js');
const { transcriptsPlugin } = await import('../../routes/transcripts.js');
const { resolveModel } = await import('../../lib/model-registry.js');
const { createTestDb } = await import('../setup-unit.js');

function makeCostTracker() {
  return {
    computeCost: jest.fn(() => ({ costUsd: 0.001, isEstimate: false })),
    record: jest.fn((opts) => ({
      id: 'cost-test',
      ts: Date.now(),
      backend: opts.backend,
      model: opts.model,
      projectName: opts.projectName ?? null,
      projectDir: opts.projectDir ?? null,
      identity: opts.identity ?? null,
      spawnId: opts.spawnId ?? null,
      inputTokens: opts.inputTokens ?? null,
      cachedInputTokens: opts.cachedInputTokens ?? null,
      outputTokens: opts.outputTokens ?? null,
      costUsd: 0.001,
      isEstimate: false,
    })),
    budgetStatus: jest.fn(() => ({
      project: 'port-daddy',
      budgetUsdPerDay: 1,
      spentUsd: 0,
      remainingUsd: 1,
      percentUsed: 0,
      overBudget: false,
    })),
  };
}

function mockCoordinationFetch() {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'OK',
  });
}

async function buildRouteApp({ transcripts, spawner, costTracker }) {
  const app = Fastify();
  const deps = {
    metrics: { errors: 0 },
    logger: { info: jest.fn(), error: jest.fn() },
  };

  await app.register(spawnPlugin, {
    deps: {
      ...deps,
      spawner,
      costTracker,
    },
  });
  await app.register(transcriptsPlugin, {
    deps: {
      ...deps,
      transcripts,
    },
  });
  await app.ready();
  return app;
}

describe('spawner effective runtime truth', () => {
  let db;
  let transcripts;
  let originalFetch;
  let originalUseCliBackend;
  let originalIsolationOff;

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    originalFetch = global.fetch;
    originalUseCliBackend = process.env.PD_USE_CLI_BACKEND;
    originalIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    global.fetch = mockCoordinationFetch();
    mockSpawnViaCliTube.mockReset();
    mockSpawnViaCliTube.mockResolvedValue({
      output: 'codex actually ran',
      error: null,
      rawStdout: '',
    });
    mockAssessSpawnPreflight.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUseCliBackend === undefined) delete process.env.PD_USE_CLI_BACKEND;
    else process.env.PD_USE_CLI_BACKEND = originalUseCliBackend;
    if (originalIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalIsolationOff;
    if (db) db.close();
  });

  test('forced CLI backend records the effective runtime while preserving requested provenance', async () => {
    process.env.PD_USE_CLI_BACKEND = 'codex';
    const costTracker = makeCostTracker();
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
    });

    const result = await spawner.spawn({
      backend: 'openai',
      model: 'gpt-5-mini',
      task: 'say exactly hello',
      identity: 'port-daddy:test:runtime-truth',
    });

    expect(mockSpawnViaCliTube).toHaveBeenCalledWith(expect.objectContaining({
      cli: 'codex',
      model: 'codex-cli',
    }));
    expect(result).toEqual(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      requestedBackend: 'openai',
      effectiveBackend: 'cli:codex',
      requestedModel: 'gpt-5-mini',
      effectiveModel: 'codex-cli',
      backendOverrideSource: 'env',
    }));
    expect(costTracker.computeCost).toHaveBeenCalledWith(
      'cli:codex',
      'codex-cli',
      expect.any(Number),
      expect.any(Number),
    );
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      identity: 'port-daddy:test:runtime-truth',
    }));

    const rows = transcripts.listTranscripts();
    expect(rows).toHaveLength(1);
    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx).toEqual(expect.objectContaining({
      ship: 'spawn:cli:codex',
      backend: 'cli:codex',
      model: 'codex-cli',
      requested_backend: 'openai',
      effective_backend: 'cli:codex',
      requested_model: 'gpt-5-mini',
      effective_model: 'codex-cli',
      backend_override_source: 'env',
    }));
    expect(tx.outputs[0].summary).toContain('cli:codex');
    expect(tx.outputs[0].summary).not.toContain('openai');
  });

  test('forced CLI backend preserves requested modelTier as the requested model', async () => {
    process.env.PD_USE_CLI_BACKEND = 'codex';
    const costTracker = makeCostTracker();
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
    });
    const requestedHighModel = resolveModel({ backend: 'claude', tier: 'high' });

    const result = await spawner.spawn({
      backend: 'claude',
      modelTier: 'high',
      task: 'say exactly hello',
      identity: 'port-daddy:test:runtime-truth-tier',
    });

    expect(mockSpawnViaCliTube).toHaveBeenCalledWith(expect.objectContaining({
      cli: 'codex',
      model: 'codex-cli',
    }));
    expect(result).toEqual(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      requestedBackend: 'claude',
      effectiveBackend: 'cli:codex',
      requestedModel: requestedHighModel,
      effectiveModel: 'codex-cli',
      backendOverrideSource: 'env',
    }));

    const tx = transcripts.getTranscript(transcripts.listTranscripts()[0].id);
    expect(tx).toEqual(expect.objectContaining({
      backend: 'cli:codex',
      model: 'codex-cli',
      requested_backend: 'claude',
      effective_backend: 'cli:codex',
      requested_model: requestedHighModel,
      effective_model: 'codex-cli',
      backend_override_source: 'env',
    }));
  });

  test('no forced override keeps requested and effective runtime identical without bogus provenance noise', async () => {
    process.env.PD_USE_CLI_BACKEND = 'none';
    const costTracker = makeCostTracker();
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
      runnerOverrides: {
        openai: async () => ({
          output: 'openai actually ran',
          error: null,
          inputTokens: 12,
          outputTokens: 4,
        }),
      },
    });

    const result = await spawner.spawn({
      backend: 'openai',
      model: 'gpt-5-mini',
      task: 'say exactly hello',
      identity: 'port-daddy:test:runtime-truth',
    });

    expect(mockSpawnViaCliTube).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      backend: 'openai',
      model: 'gpt-5-mini',
      requestedBackend: 'openai',
      effectiveBackend: 'openai',
      requestedModel: 'gpt-5-mini',
      effectiveModel: 'gpt-5-mini',
      backendOverrideSource: 'none',
    }));
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'openai',
      model: 'gpt-5-mini',
    }));

    const tx = transcripts.getTranscript(transcripts.listTranscripts()[0].id);
    expect(tx).toEqual(expect.objectContaining({
      ship: 'spawn:openai',
      backend: 'openai',
      model: 'gpt-5-mini',
      requested_backend: 'openai',
      effective_backend: 'openai',
      requested_model: 'gpt-5-mini',
      effective_model: 'gpt-5-mini',
      backend_override_source: 'none',
    }));
  });

  test('POST /spawn persists effective runtime truth readable through transcript routes', async () => {
    process.env.PD_USE_CLI_BACKEND = 'codex';
    mockAssessSpawnPreflight.mockResolvedValue({
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

    const costTracker = makeCostTracker();
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
    });
    const app = await buildRouteApp({ transcripts, spawner, costTracker });

    try {
      const spawnRes = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: {
          backend: 'openai',
          model: 'gpt-5-mini',
          task: 'route says hello',
          identity: 'port-daddy:test:route-runtime-truth',
          budgetUsd: 0.75,
        },
      });
      expect(spawnRes.statusCode).toBe(200);
      expect(spawnRes.json()).toEqual(expect.objectContaining({
        success: true,
        backend: 'cli:codex',
        requestedBackend: 'openai',
        effectiveBackend: 'cli:codex',
        requestedModel: 'gpt-5-mini',
        effectiveModel: 'codex-cli',
        backendOverrideSource: 'env',
      }));

      const listRes = await app.inject({ method: 'GET', url: '/transcripts' });
      expect(listRes.statusCode).toBe(200);
      const listBody = listRes.json();
      expect(listBody.transcripts).toHaveLength(1);

      const txRes = await app.inject({
        method: 'GET',
        url: `/transcripts/${listBody.transcripts[0].id}`,
      });
      expect(txRes.statusCode).toBe(200);
      expect(txRes.json().transcript).toEqual(expect.objectContaining({
        backend: 'cli:codex',
        model: 'codex-cli',
        requested_backend: 'openai',
        effective_backend: 'cli:codex',
        requested_model: 'gpt-5-mini',
        effective_model: 'codex-cli',
        backend_override_source: 'env',
      }));
    } finally {
      await app.close();
    }
  });
});
