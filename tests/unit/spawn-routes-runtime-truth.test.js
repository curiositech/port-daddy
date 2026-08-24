import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSpawnViaCliTube = jest.fn();

await jest.unstable_mockModule('../../lib/spawner/backends/cli-tube.js', () => ({
  spawnViaCliTube: mockSpawnViaCliTube,
}));

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { spawnPlugin } = await import('../../routes/spawn.js');
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

function installFakeCli(dir, name) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '#!/usr/bin/env sh\necho fake\n', 'utf8');
  chmodSync(path, 0o755);
  return path;
}

async function buildApp({ transcripts, costTracker }) {
  const app = Fastify();
  const spawner = createSpawner({
    transcripts,
    costTracker,
    enforceTelemetryPolicy: true,
    enforceTranscriptPolicy: true,
  });

  await app.register(spawnPlugin, {
    deps: {
      spawner,
      costTracker,
      metrics: { errors: 0 },
      logger: {
        info: jest.fn(),
        error: jest.fn(),
      },
    },
  });
  await app.ready();
  return app;
}

describe('spawn route effective runtime truth with real preflight', () => {
  let db;
  let transcripts;
  let tmp;
  let originalFetch;
  let originalUseCliBackend;
  let originalCliBinDirs;
  let originalIsolationOff;

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    tmp = mkdtempSync(join(tmpdir(), 'pd-route-runtime-truth-'));
    originalFetch = global.fetch;
    originalUseCliBackend = process.env.PD_USE_CLI_BACKEND;
    originalCliBinDirs = process.env.PD_CLI_BIN_DIRS;
    originalIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
    global.fetch = mockCoordinationFetch();
    process.env.PD_USE_CLI_BACKEND = 'codex';
    process.env.PD_CLI_BIN_DIRS = tmp;
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    installFakeCli(tmp, 'codex');
    mockSpawnViaCliTube.mockReset();
    mockSpawnViaCliTube.mockResolvedValue({
      output: 'codex actually ran',
      error: null,
      rawStdout: '',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUseCliBackend === undefined) delete process.env.PD_USE_CLI_BACKEND;
    else process.env.PD_USE_CLI_BACKEND = originalUseCliBackend;
    if (originalCliBinDirs === undefined) delete process.env.PD_CLI_BIN_DIRS;
    else process.env.PD_CLI_BIN_DIRS = originalCliBinDirs;
    if (originalIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalIsolationOff;
    if (db) db.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('forced cli:codex route keeps requested high-tier model and effective codex sentinel', async () => {
    const requestedHighModel = resolveModel({ backend: 'claude', tier: 'high' });
    const costTracker = makeCostTracker();
    const app = await buildApp({ transcripts, costTracker });

    try {
      const spawnRes = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: {
          backend: 'claude',
          modelTier: 'high',
          task: 'route says hello',
          identity: 'port-daddy:test:route-runtime-tier',
          budgetUsd: 0.75,
        },
      });

      expect(spawnRes.statusCode).toBe(200);
      expect(spawnRes.json()).toEqual(expect.objectContaining({
        success: true,
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
    } finally {
      await app.close();
    }
  });

  test('cli-tube receipt survives completion in the FleetBar /spawn API, and is absent when unavailable', async () => {
    const costTracker = makeCostTracker();
    const app = await buildApp({ transcripts, costTracker });
    const receipt = {
      tool: 'pd-coast-guard',
      agentId: 'will-be-replaced-by-the-spawner',
      backend: 'cli:codex',
      confined: true,
      mechanism: 'seatbelt',
      confinedPaths: ['/Users/operator/.ssh'],
      scrubbedSecrets: ['OPENAI_API_KEY'],
      egressCap: { maxRequests: 5000, maxBytes: 1000000 },
      egress: { requests: 4, bytes: 1280, blocked: 1, injected: 0 },
      writePolicy: 'unrestricted',
      writeDeniedPaths: [],
      startedAt: 1,
      endedAt: 2,
      honestLimits: 'Cooperative-case defense only.',
    };

    try {
      mockSpawnViaCliTube.mockResolvedValueOnce({
        output: 'guarded cli tube completion',
        error: null,
        rawStdout: '',
        coastGuardReceipt: receipt,
      });
      const guarded = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: { backend: 'claude', task: 'guarded completion', identity: 'port-daddy:test:cli-tube-receipt', budgetUsd: 0.75 },
      });
      expect(guarded.statusCode).toBe(200);

      const guardedHistory = await app.inject({ method: 'GET', url: '/spawn' });
      const guardedAgent = guardedHistory.json().agents.find((agent) => agent.agentId === guarded.json().agentId);
      expect(guardedAgent).toEqual(expect.objectContaining({
        status: 'completed',
        coastGuard: expect.objectContaining({
          mechanism: 'seatbelt',
          egress: { requests: 4, bytes: 1280, blocked: 1, injected: 0 },
        }),
      }));

      mockSpawnViaCliTube.mockResolvedValueOnce({ output: 'no receipt', error: null, rawStdout: '' });
      const unguarded = await app.inject({
        method: 'POST',
        url: '/spawn',
        payload: { backend: 'claude', task: 'receipt unavailable', identity: 'port-daddy:test:cli-tube-no-receipt', budgetUsd: 0.75 },
      });
      expect(unguarded.statusCode).toBe(200);

      const unguardedHistory = await app.inject({ method: 'GET', url: '/spawn' });
      const unguardedAgent = unguardedHistory.json().agents.find((agent) => agent.agentId === unguarded.json().agentId);
      expect(unguardedAgent).not.toHaveProperty('coastGuard');
    } finally {
      await app.close();
    }
  });
});
