import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { HandoffScannerUnavailableError } from '../../lib/handoff-capsule.js';
import { memoryPlugin } from '../../routes/memory.js';
import { captureWorkspaceIdentity } from '../../lib/workspace-identity.js';

const SOURCE_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SUCCESSOR_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_IDENTITY = captureWorkspaceIdentity(process.cwd());
if (!WORKSPACE_IDENTITY) throw new Error('test workspace identity unavailable');
const CANONICAL_WORKSPACE = WORKSPACE_IDENTITY.canonicalPath;

function capsule(overrides = {}) {
  return {
    schema: 'pd.agent-harbor.handoff-capsule.v0',
    capsuleId: 'capsule-route-1',
    capturedAt: '2026-07-15T20:00:00.000Z',
    source: {
      adapter: 'claude-code',
      sessionId: SOURCE_SESSION_ID,
      agentId: 'portdaddy-typography-expert',
      workflowId: 'wf-route-1',
      transcriptRef: `/tmp/${SOURCE_SESSION_ID}.jsonl`,
    },
    identity: {
      project: 'port-daddy',
      projectDir: '/repo/port-daddy',
      harbor: 'port-daddy',
    },
    workspace: {
      cwd: '/repo/port-daddy',
      repoRoot: '/repo/port-daddy',
      branch: 'feature/handoff',
      worktreeId: 'wt-route-1',
      gitHead: 'abc123',
      dirtyFiles: ['routes/memory.ts'],
    },
    telos: 'Continue the handoff capsule implementation.',
    operatorTurns: [{ id: 'op-1', at: null, text: 'Preserve this operator turn.' }],
    decisions: [{ id: 'd-1', at: null, text: 'Use fail-closed scanning.', source: 'operator' }],
    coordination: [{ id: 'n-1', at: null, text: 'Scope is memory handoff.', kind: 'scope' }],
    artifacts: [{ path: '/repo/prototype.html', kind: 'html', summary: 'Prototype', sourceBlockId: 'b-1' }],
    tail: [{ id: 't-1', at: null, text: 'Recent assistant context.', role: 'assistant' }],
    ...overrides,
  };
}

async function buildApp(overrides = {}) {
  const db = createTestDb();
  const episodicMemory = createEpisodicMemory(db);
  const app = Fastify();
  const metrics = { errors: 0 };
  const logger = { error: jest.fn() };
  const harvestSessionFn = jest.fn(async () => ({ episodeIds: [41], skipped: 1, promoted: 1 }));
  const gitleaksRunner = jest.fn(() => ({ findings: [] }));
  const captureNativeSessionWitnessFn = jest.fn((_capsule, adapterFamily) => ({
    verified: true,
    witness: {
      schema: 'pd.agent-harbor.native-session-witness.v0',
      adapterFamily,
      method: 'claude-jsonl-session-id',
      sessionIdHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      workspaceHash: 'c'.repeat(64),
      witnessedAt: Date.now(),
    },
    reason: null,
    canonicalWorkspace: CANONICAL_WORKSPACE,
    workspaceIdentity: WORKSPACE_IDENTITY,
  }));
  const verifyNativeSessionWitnessFn = jest.fn((_capsule, _adapterFamily, witness) => ({
    verified: Boolean(witness),
    witness: witness ?? null,
    reason: witness ? null : 'handoff has no valid daemon-witnessed native session evidence',
    canonicalWorkspace: witness ? CANONICAL_WORKSPACE : null,
    workspaceIdentity: witness ? WORKSPACE_IDENTITY : null,
  }));
  const spawner = {
    spawn: jest.fn(async (spec) => ({
      agentId: 'spawned-continuation-1',
      backend: spec.backend,
      model: spec.model ?? 'sonnet',
      requestedBackend: spec.requestedBackend ?? spec.backend,
      effectiveBackend: spec.backend,
      requestedModel: spec.requestedModel ?? spec.model ?? 'sonnet',
      effectiveModel: spec.model ?? 'sonnet',
      status: 'completed',
      output: 'continued',
      error: null,
      telemetry: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      harnessSessionId: spec.nativeResume?.sessionId ?? SUCCESSOR_SESSION_ID,
    })),
  };

  await app.register(memoryPlugin, {
    deps: {
      db,
      episodicMemory,
      metrics,
      logger,
      harvestSessionFn,
      gitleaksRunner,
      spawner,
      captureNativeSessionWitnessFn,
      verifyNativeSessionWitnessFn,
      ...overrides,
    },
  });
  await app.ready();
  return {
    app,
    db,
    episodicMemory,
    metrics,
    logger,
    harvestSessionFn,
    gitleaksRunner,
    spawner,
    captureNativeSessionWitnessFn,
    verifyNativeSessionWitnessFn,
  };
}

describe('POST /memory/handoffs', () => {
  test('redacts, scans, harvests, and stores only the sanitized capsule', async () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const state = await buildApp();
    const input = capsule({
      telos: `Continue without leaking ${secret}`,
      rawTranscript: `raw transcript contains ${secret}`,
    });

    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: input,
        tokenBudget: 4_000,
        coordinationSessionId: 'pd-session-1',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.nativeResume).toEqual(expect.objectContaining({
      verified: true,
      adapterFamily: 'claude-code',
      method: 'claude-jsonl-session-id',
    }));
    expect(body.capsule.telos).toContain('[REDACTED:7890]');
    expect(body.capsule.rawTranscript).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.harvest).toEqual({
      attempted: true,
      success: true,
      episodeIds: [41],
      skipped: 1,
      promoted: 1,
    });
    expect(state.harvestSessionFn).toHaveBeenCalledWith(
      'pd-session-1',
      state.db,
      expect.objectContaining({ episodicMemory: state.episodicMemory }),
    );
    expect(state.gitleaksRunner).toHaveBeenCalledTimes(1);
    expect(state.gitleaksRunner.mock.calls[0][0]).not.toContain(secret);

    const episodes = state.episodicMemory.list({ episodeType: 'handoff' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toEqual(expect.objectContaining({
      project: 'port-daddy',
      agentId: 'portdaddy-typography-expert',
      sourceType: 'handoff-capsule',
      sourceId: `portdaddy-typography-expert:${SOURCE_SESSION_ID}`,
    }));
    expect(JSON.stringify(episodes[0].metadata)).not.toContain(secret);
    expect(episodes[0].metadata.capsule.operatorTurns[0].text).toBe('Preserve this operator turn.');
    expect(episodes[0].metadata.nativeSessionWitness).toEqual(expect.objectContaining({
      schema: 'pd.agent-harbor.native-session-witness.v0',
      adapterFamily: 'claude-code',
    }));

    await state.app.close();
    state.db.close();
  });

  test('persists the sanitized handoff when coordination harvest fails', async () => {
    const state = await buildApp({
      harvestSessionFn: jest.fn(async () => {
        throw new Error('transient harvest failure');
      }),
    });
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: capsule(),
        coordinationSessionId: 'pd-session-transient',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      harvest: {
        attempted: true,
        success: false,
        error: 'session harvest unavailable',
      },
    }));
    expect(state.episodicMemory.list({ episodeType: 'handoff' })).toHaveLength(1);
    expect(state.metrics.errors).toBe(1);
    expect(state.logger.error).toHaveBeenCalledWith(
      'memory_handoff_harvest_failed',
      { errorType: 'Error' },
    );

    await state.app.close();
    state.db.close();
  });

  test('persists the sanitized handoff when the harvest database is unavailable', async () => {
    const state = await buildApp({ db: undefined });
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: capsule(),
        coordinationSessionId: 'pd-session-no-db',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().harvest).toEqual({
      attempted: true,
      success: false,
      error: 'session harvest unavailable',
    });
    expect(state.episodicMemory.list({ episodeType: 'handoff' })).toHaveLength(1);
    expect(state.metrics.errors).toBe(1);

    await state.app.close();
    state.db.close();
  });

  test('upserts the same agent and source session instead of multiplying memories', async () => {
    const state = await buildApp();
    const first = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule() },
    });
    const second = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule({ capsuleId: 'capsule-route-2', telos: 'Updated continuation state.' }) },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().episode.id).toBe(first.json().episode.id);
    expect(state.episodicMemory.list({ episodeType: 'handoff' })).toHaveLength(1);

    await state.app.close();
    state.db.close();
  });

  test('keeps every operator turn in the searchable episode summary', async () => {
    const state = await buildApp();
    const finalMarker = 'operator-final-marker';
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: capsule({
          operatorTurns: [
            { id: 'op-long', at: null, text: `first ${'context '.repeat(2_000)}${finalMarker}` },
          ],
        }),
      },
    });

    expect(response.statusCode).toBe(201);
    const [episode] = state.episodicMemory.list({ episodeType: 'handoff' });
    expect(episode.summary).toContain(finalMarker);

    await state.app.close();
    state.db.close();
  });

  test('quarantines residual findings before any memory write', async () => {
    const state = await buildApp({
      gitleaksRunner: () => ({ findings: [{ ruleId: 'private-key', line: 2 }] }),
    });
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule() },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      success: false,
      error: 'handoff capsule quarantined by secret scanning',
      findingCount: 1,
    });
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('fails closed when gitleaks is unavailable', async () => {
    const state = await buildApp({
      gitleaksRunner: () => {
        throw new HandoffScannerUnavailableError();
      },
    });
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(expect.objectContaining({ success: false, failClosed: true }));
    expect(state.metrics.errors).toBe(1);
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('returns the minimum required budget without dropping operator turns', async () => {
    const state = await buildApp();
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: capsule({
          operatorTurns: [{ id: 'op-long', at: null, text: 'operator truth '.repeat(1_000) }],
          artifacts: [],
          tail: [],
        }),
        tokenBudget: 100,
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      requestedTokens: 100,
      minimumRequiredTokens: expect.any(Number),
    }));
    expect(response.json().minimumRequiredTokens).toBeGreaterThan(100);
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('rejects malformed provenance without invoking scanners or persistence', async () => {
    const state = await buildApp();
    const input = capsule();
    delete input.source.sessionId;
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: input },
    });

    expect(response.statusCode).toBe(400);
    expect(state.gitleaksRunner).not.toHaveBeenCalled();
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('rejects invalid coordination provenance before scanning or persistence', async () => {
    const state = await buildApp();
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule(), coordinationSessionId: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(state.gitleaksRunner).not.toHaveBeenCalled();
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('rejects oversized coordination ids before scanning or persistence', async () => {
    const state = await buildApp();
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule(), coordinationSessionId: 'x'.repeat(1_025) },
    });

    expect(response.statusCode).toBe(400);
    expect(state.gitleaksRunner).not.toHaveBeenCalled();
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });

  test('rejects request bodies above the two MiB boundary before scanning', async () => {
    const state = await buildApp();
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: {
        capsule: capsule({ ignoredProviderPayload: 'x'.repeat(2 * 1024 * 1024) }),
      },
    });

    expect(response.statusCode).toBe(413);
    expect(state.gitleaksRunner).not.toHaveBeenCalled();
    expect(state.episodicMemory.list()).toHaveLength(0);

    await state.app.close();
    state.db.close();
  });
});

describe('handoff continuation routes', () => {
  async function createHandoff(state, overrides = {}) {
    const response = await state.app.inject({
      method: 'POST',
      url: '/memory/handoffs',
      payload: { capsule: capsule(overrides) },
    });
    expect(response.statusCode).toBe(201);
    return response.json().episode;
  }

  test('resumes the exact source session and returns a durable lineage receipt', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        model: 'sonnet',
        prompt: 'Continue the implementation.',
        idempotencyKey: 'route-continuation-1',
        durableAgentId: 'portdaddy-typography-expert',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      replayed: false,
      receipt: expect.objectContaining({
        status: 'completed',
        mode: 'native',
        sourceEpisodeId: episode.id,
        sourceSessionId: SOURCE_SESSION_ID,
        successorSessionId: SOURCE_SESSION_ID,
        successorRunId: 'spawned-continuation-1',
      }),
    }));
    expect(state.spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:claude-code',
      task: 'Continue the implementation.',
      nativeResume: expect.objectContaining({
        adapterFamily: 'claude-code',
        sessionId: SOURCE_SESSION_ID,
        workspaceIdentity: WORKSPACE_IDENTITY,
      }),
      workdir: CANONICAL_WORKSPACE,
    }));

    const receiptId = response.json().receipt.id;
    const read = await state.app.inject({ method: 'GET', url: `/memory/continuations/${receiptId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().receipt.id).toBe(receiptId);
    const listed = await state.app.inject({
      method: 'GET',
      url: `/memory/continuations?sourceEpisodeId=${episode.id}`,
    });
    expect(listed.json()).toEqual(expect.objectContaining({ count: 1 }));

    await state.app.close();
    state.db.close();
  });

  test('replays an identical idempotency request without spawning twice', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const payload = {
      targetBackend: 'claude-cli',
      prompt: 'Continue exactly once.',
      idempotencyKey: 'route-continuation-replay',
    };

    const first = await state.app.inject({ method: 'POST', url: `/memory/handoffs/${episode.id}/continue`, payload });
    const replay = await state.app.inject({ method: 'POST', url: `/memory/handoffs/${episode.id}/continue`, payload });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(expect.objectContaining({ replayed: true }));
    expect(replay.json().receipt.id).toBe(first.json().receipt.id);
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);

    await state.app.close();
    state.db.close();
  });

  test('reports an in-flight idempotent replay as pending, never successful', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const defaultSpawn = state.spawner.spawn.getMockImplementation();
    let releaseSpawn;
    state.spawner.spawn.mockImplementation((spec) => new Promise((resolve) => {
      releaseSpawn = async () => resolve(await defaultSpawn(spec));
    }));
    const payload = {
      targetBackend: 'cli:claude-code',
      prompt: 'Continue while a retry polls.',
      idempotencyKey: 'route-continuation-pending-replay',
    };

    const firstPromise = state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload,
    });
    for (let attempt = 0; attempt < 20 && !releaseSpawn; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(releaseSpawn).toEqual(expect.any(Function));

    const replay = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(expect.objectContaining({
      success: false,
      pending: true,
      replayed: true,
      receipt: expect.objectContaining({ status: 'running' }),
    }));
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);

    await releaseSpawn();
    const first = await firstPromise;
    expect(first.statusCode).toBe(201);
    expect(first.json().success).toBe(true);

    await state.app.close();
    state.db.close();
  });

  test('initializes a cross-family successor from the full sanitized capsule', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:codex',
        prompt: 'Finish the bounded cross-harness slice.',
        idempotencyKey: 'route-continuation-cross-family-handoff',
        durableAgentId: 'portdaddy-cross-runtime-expert',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      receipt: expect.objectContaining({
        mode: 'handoff',
        sourceAdapter: 'claude-code',
        targetAdapter: 'codex-cli',
        durableAgentId: 'portdaddy-cross-runtime-expert',
        predecessorRunId: 'wf-route-1',
        successorRunId: 'spawned-continuation-1',
        successorSessionId: SUCCESSOR_SESSION_ID,
      }),
    }));
    expect(state.spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:codex',
      identity: 'portdaddy-cross-runtime-expert',
      workdir: CANONICAL_WORKSPACE,
      workspaceIdentity: WORKSPACE_IDENTITY,
      task: expect.stringContaining('pd.agent-harbor.handoff-successor-brief.v0'),
    }));
    const [spawnSpec] = state.spawner.spawn.mock.calls[0];
    expect(spawnSpec.nativeResume).toBeUndefined();
    expect(spawnSpec.task).toContain('Finish the bounded cross-harness slice.');
    expect(spawnSpec.task).toContain('"agentId": "portdaddy-cross-runtime-expert"');
    expect(spawnSpec.task).toContain('Preserve this operator turn.');
    expect(spawnSpec.task).toContain('Use fail-closed scanning.');
    expect(spawnSpec.task).toContain('/repo/prototype.html');
    expect(spawnSpec.task).toContain(SOURCE_SESSION_ID);
    expect(state.verifyNativeSessionWitnessFn).toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('allows an explicit handoff successor in the same adapter family', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        mode: 'handoff',
        prompt: 'Fork a compact successor instead of restoring native state.',
        idempotencyKey: 'route-continuation-explicit-handoff',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().receipt).toEqual(expect.objectContaining({
      mode: 'handoff',
      sourceSessionId: SOURCE_SESSION_ID,
      successorSessionId: SUCCESSOR_SESSION_ID,
    }));
    expect(state.spawner.spawn.mock.calls[0][0].nativeResume).toBeUndefined();
    expect(state.verifyNativeSessionWitnessFn).toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('selects handoff mode from the effective backend after an operator override', async () => {
    const previous = process.env.PD_USE_CLI_BACKEND;
    process.env.PD_USE_CLI_BACKEND = 'codex';
    const state = await buildApp();
    try {
      const episode = await createHandoff(state);
      const response = await state.app.inject({
        method: 'POST',
        url: `/memory/handoffs/${episode.id}/continue`,
        payload: {
          targetBackend: 'cli:claude-code',
          prompt: 'Honor the effective runtime, not the requested label.',
          idempotencyKey: 'route-continuation-effective-override',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().receipt).toEqual(expect.objectContaining({
        mode: 'handoff',
        requestedBackend: 'cli:claude-code',
        targetAdapter: 'codex-cli',
      }));
      expect(state.spawner.spawn.mock.calls[0][0].nativeResume).toBeUndefined();
      expect(state.verifyNativeSessionWitnessFn).toHaveBeenCalled();
    } finally {
      await state.app.close();
      state.db.close();
      if (previous === undefined) delete process.env.PD_USE_CLI_BACKEND;
      else process.env.PD_USE_CLI_BACKEND = previous;
    }
  });

  test('uses an explicit current target workspace when the source has no native witness', async () => {
    const verifyNativeSessionWitnessFn = jest.fn(() => ({
      verified: false,
      witness: null,
      reason: 'stateless provider has no native session witness',
      canonicalWorkspace: null,
      workspaceIdentity: null,
    }));
    const state = await buildApp({ verifyNativeSessionWitnessFn });
    const episode = await createHandoff(state, {
      source: {
        ...capsule().source,
        adapter: 'cloudflare',
      },
    });
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:codex',
        targetWorkdir: process.cwd(),
        prompt: 'Continue a stateless provider run in this current workspace.',
        idempotencyKey: 'route-continuation-explicit-target-workspace',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(state.spawner.spawn).toHaveBeenCalledWith(expect.objectContaining({
      workdir: CANONICAL_WORKSPACE,
      workspaceIdentity: WORKSPACE_IDENTITY,
    }));
    expect(state.spawner.spawn.mock.calls[0][0].nativeResume).toBeUndefined();

    await state.app.close();
    state.db.close();
  });

  test('fails closed when neither source evidence nor a current target workspace binds the successor', async () => {
    const state = await buildApp({
      verifyNativeSessionWitnessFn: jest.fn(() => ({
        verified: false,
        witness: null,
        reason: 'source workspace evidence is unavailable',
        canonicalWorkspace: null,
        workspaceIdentity: null,
      })),
    });
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:codex',
        prompt: 'Do not trust the historical capsule path.',
        idempotencyKey: 'route-continuation-unbound-handoff-workspace',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('daemon-witnessed source workspace or explicit targetWorkdir'),
      receipt: expect.objectContaining({ status: 'unsupported' }),
    }));
    expect(state.spawner.spawn).not.toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('rejects an explicit target workspace that conflicts with the source witness', async () => {
    const otherWorkspace = mkdtempSync(join(tmpdir(), 'pd-handoff-other-workspace-'));
    const state = await buildApp();
    try {
      const episode = await createHandoff(state);
      const response = await state.app.inject({
        method: 'POST',
        url: `/memory/handoffs/${episode.id}/continue`,
        payload: {
          targetBackend: 'cli:codex',
          targetWorkdir: otherWorkspace,
          prompt: 'Do not redirect this successor into another checkout.',
          idempotencyKey: 'route-continuation-conflicting-target-workspace',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatch(/does not match the daemon-witnessed source workspace/);
      expect(state.spawner.spawn).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
      state.db.close();
      rmSync(otherWorkspace, { recursive: true, force: true });
    }
  });

  test('fails closed before acceptance when the rendered successor brief cannot be scanned', async () => {
    const gitleaksRunner = jest.fn((content) => {
      if (content.includes('pd.agent-harbor.handoff-successor-brief.v0')) {
        throw new HandoffScannerUnavailableError();
      }
      return { findings: [] };
    });
    const state = await buildApp({ gitleaksRunner });
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:codex',
        prompt: 'Do not accept an unscanned successor brief.',
        idempotencyKey: 'route-continuation-render-scan-down',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(expect.objectContaining({ success: false, failClosed: true }));
    expect(state.spawner.spawn).not.toHaveBeenCalled();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_continuations').get().count).toBe(0);

    await state.app.close();
    state.db.close();
  });

  test('persists explicit unsupported cross-family native attempts without invoking a child', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const payload = {
      targetBackend: 'cli:codex',
      mode: 'native',
      prompt: 'Do not launch this as native resume.',
      idempotencyKey: 'route-continuation-cross-family',
    };
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload,
    });
    const replay = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      receipt: expect.objectContaining({ status: 'unsupported' }),
    }));
    expect(response.json().error).toMatch(/cannot resume through effective adapter codex-cli/);
    expect(replay.statusCode).toBe(422);
    expect(replay.json()).toEqual(expect.objectContaining({
      success: false,
      replayed: true,
      receipt: expect.objectContaining({ id: response.json().receipt.id, status: 'unsupported' }),
    }));
    expect(state.spawner.spawn).not.toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('rejects an invalid continuation mode before accepting a receipt', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:codex',
        mode: 'teleport',
        idempotencyKey: 'route-continuation-invalid-mode',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/mode must be auto, native, or handoff/);
    expect(state.spawner.spawn).not.toHaveBeenCalled();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_continuations').get().count).toBe(0);

    await state.app.close();
    state.db.close();
  });

  test('persists an unsupported receipt when daemon-witnessed source evidence cannot be reverified', async () => {
    const verifyNativeSessionWitnessFn = jest.fn(() => ({
      verified: false,
      witness: null,
      reason: 'daemon-witnessed native session evidence no longer matches the handoff',
    }));
    const state = await buildApp({ verifyNativeSessionWitnessFn });
    const episode = await createHandoff(state);
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'Do not launch an unverified session.',
        idempotencyKey: 'route-continuation-unwitnessed',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      receipt: expect.objectContaining({ status: 'unsupported' }),
    }));
    expect(response.json().error).toMatch(/no longer matches/);
    expect(verifyNativeSessionWitnessFn).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ sessionId: SOURCE_SESSION_ID }) }),
      'claude-code',
      expect.objectContaining({ schema: 'pd.agent-harbor.native-session-witness.v0' }),
    );
    expect(state.spawner.spawn).not.toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('rejects option-shaped native identities before starting a child', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state, {
      source: {
        ...capsule().source,
        sessionId: '--last',
      },
    });
    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'Do not parse this as an option.',
        idempotencyKey: 'route-continuation-option-id',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatch(/canonical UUID/);
    expect(response.json().receipt.status).toBe('unsupported');
    expect(state.spawner.spawn).not.toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('does not spawn when accepted-to-running lease ownership is lost', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    state.db.exec(`
      CREATE TRIGGER orphan_continuation_after_insert
      AFTER INSERT ON agent_continuations
      BEGIN
        UPDATE agent_continuations
        SET status = 'orphaned', completed_at = updated_at
        WHERE id = NEW.id;
      END;
    `);

    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'Do not launch after lease loss.',
        idempotencyKey: 'route-continuation-running-cas',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      receipt: expect.objectContaining({ status: 'orphaned' }),
    }));
    expect(state.spawner.spawn).not.toHaveBeenCalled();

    await state.app.close();
    state.db.close();
  });

  test('never reports success when terminal receipt ownership changes during spawn', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const defaultSpawn = state.spawner.spawn.getMockImplementation();
    state.spawner.spawn.mockImplementation(async (spec) => {
      state.db.prepare(`
        UPDATE agent_continuations
        SET status = 'orphaned', completed_at = updated_at
        WHERE status = 'running'
      `).run();
      return defaultSpawn(spec);
    });

    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'Return only after durable completion.',
        idempotencyKey: 'route-continuation-terminal-cas',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(expect.objectContaining({
      success: false,
      receipt: expect.objectContaining({ status: 'orphaned' }),
    }));

    await state.app.close();
    state.db.close();
  });

  test('rejects idempotency drift and never stores raw prompt text', async () => {
    const state = await buildApp();
    const episode = await createHandoff(state);
    const first = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'private continuation prompt marker',
        idempotencyKey: 'route-continuation-conflict',
      },
    });
    const conflict = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'different prompt',
        idempotencyKey: 'route-continuation-conflict',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    const row = state.db.prepare('SELECT * FROM agent_continuations WHERE id = ?').get(first.json().receipt.id);
    expect(JSON.stringify(row)).not.toContain('private continuation prompt marker');

    await state.app.close();
    state.db.close();
  });

  test('rejects idempotency replay when the daemon-authorized source workspace changes', async () => {
    const firstWorkspace = mkdtempSync(join(tmpdir(), 'pd-continuation-source-a-'));
    const secondWorkspace = mkdtempSync(join(tmpdir(), 'pd-continuation-source-b-'));
    const firstIdentity = captureWorkspaceIdentity(firstWorkspace);
    const secondIdentity = captureWorkspaceIdentity(secondWorkspace);
    if (!firstIdentity || !secondIdentity) throw new Error('workspace identity unavailable');
    const verifyNativeSessionWitnessFn = jest.fn()
      .mockReturnValueOnce({
        verified: true,
        witness: { schema: 'pd.agent-harbor.native-session-witness.v0' },
        reason: null,
        canonicalWorkspace: firstWorkspace,
        workspaceIdentity: firstIdentity,
      })
      .mockReturnValueOnce({
        verified: true,
        witness: { schema: 'pd.agent-harbor.native-session-witness.v0' },
        reason: null,
        canonicalWorkspace: secondWorkspace,
        workspaceIdentity: secondIdentity,
      });
    const state = await buildApp({ verifyNativeSessionWitnessFn });
    try {
      const episode = await createHandoff(state);
      const payload = {
        targetBackend: 'cli:codex',
        prompt: 'Continue in the daemon-authorized source workspace.',
        idempotencyKey: 'route-continuation-source-workspace-drift',
      };
      const first = await state.app.inject({
        method: 'POST',
        url: `/memory/handoffs/${episode.id}/continue`,
        payload,
      });
      const conflict = await state.app.inject({
        method: 'POST',
        url: `/memory/handoffs/${episode.id}/continue`,
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error).toMatch(/idempotency key was already used for a different continuation request/);
      expect(state.spawner.spawn).toHaveBeenCalledTimes(1);
    } finally {
      await state.app.close();
      state.db.close();
      rmSync(firstWorkspace, { recursive: true, force: true });
      rmSync(secondWorkspace, { recursive: true, force: true });
    }
  });

  test('fails closed before acceptance when prompt scanning is unavailable', async () => {
    const gitleaksRunner = jest.fn(() => ({ findings: [] }));
    const state = await buildApp({ gitleaksRunner });
    const episode = await createHandoff(state);
    gitleaksRunner.mockImplementation(() => { throw new HandoffScannerUnavailableError(); });

    const response = await state.app.inject({
      method: 'POST',
      url: `/memory/handoffs/${episode.id}/continue`,
      payload: {
        targetBackend: 'cli:claude-code',
        prompt: 'continue',
        idempotencyKey: 'route-continuation-scanner-down',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(expect.objectContaining({ failClosed: true }));
    expect(state.spawner.spawn).not.toHaveBeenCalled();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_continuations').get().count).toBe(0);

    await state.app.close();
    state.db.close();
  });
});
