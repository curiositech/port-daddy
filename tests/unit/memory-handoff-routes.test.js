import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { HandoffScannerUnavailableError } from '../../lib/handoff-capsule.js';
import { memoryPlugin } from '../../routes/memory.js';

function capsule(overrides = {}) {
  return {
    schema: 'pd.agent-harbor.handoff-capsule.v0',
    capsuleId: 'capsule-route-1',
    capturedAt: '2026-07-15T20:00:00.000Z',
    source: {
      adapter: 'claude-code',
      sessionId: 'claude-session-route-1',
      agentId: 'portdaddy-typography-expert',
      workflowId: 'wf-route-1',
      transcriptRef: '/tmp/claude-session-route-1.jsonl',
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

  await app.register(memoryPlugin, {
    deps: {
      db,
      episodicMemory,
      metrics,
      logger,
      harvestSessionFn,
      gitleaksRunner,
      ...overrides,
    },
  });
  await app.ready();
  return { app, db, episodicMemory, metrics, logger, harvestSessionFn, gitleaksRunner };
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
      sourceId: 'portdaddy-typography-expert:claude-session-route-1',
    }));
    expect(JSON.stringify(episodes[0].metadata)).not.toContain(secret);
    expect(episodes[0].metadata.capsule.operatorTurns[0].text).toBe('Preserve this operator turn.');

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
