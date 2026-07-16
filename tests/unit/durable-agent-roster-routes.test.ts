import { afterEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import { createDurableAgentRoster } from '../../lib/durable-agent-roster.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { durableAgentRosterPlugin } from '../../routes/durable-agent-roster.js';

const SOURCE_SESSION_ID = 'session-source-typography';

function profile() {
  return {
    slug: 'portdaddy-typography-expert',
    scope: { kind: 'system' },
    remit: 'Own typography systems and information density.',
    instructions: 'Inspect the established paper-like visual language before editing.',
    skills: ['swiss-modern-website-design'],
    tools: ['read', 'apply_patch'],
  };
}

async function buildApp() {
  const db = initDatabase({ inMemory: true });
  const episodicMemory = createEpisodicMemory(db);
  const durableAgentRoster = createDurableAgentRoster(db, {
    resolver: {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      embed: async (text: string) => [text.toLowerCase().includes('typography') ? 1 : 0.1, 0.1],
    },
    gitleaksRunner: () => ({ findings: [] }),
  });
  const metrics = { errors: 0 };
  const logger = { info: jest.fn(), error: jest.fn() };
  const app = Fastify();
  await app.register(durableAgentRosterPlugin, {
    deps: { durableAgentRoster, episodicMemory, metrics, logger },
  });
  await app.ready();
  return { app, db, episodicMemory, durableAgentRoster, metrics, logger };
}

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  while (openApps.length > 0) {
    const state = openApps.pop();
    if (!state) continue;
    await state.app.close();
    closeDatabase(state.db);
  }
});

describe('durable agent roster routes', () => {
  test('creates, lists, reads, searches, updates, and retires daemon-minted agents', async () => {
    const state = await buildApp();
    openApps.push(state);
    const created = await state.app.inject({ method: 'POST', url: '/durable-agents', payload: profile() });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    const id = body.agent.agentNodeId as string;

    expect((await state.app.inject({ method: 'GET', url: '/durable-agents' })).json().count).toBe(1);
    expect((await state.app.inject({ method: 'GET', url: `/durable-agents/${id}` })).json().revisions).toHaveLength(1);
    expect((await state.app.inject({ method: 'GET', url: '/durable-agents/search?q=typography' })).json().hits[0].agent.agentNodeId).toBe(id);

    const updated = await state.app.inject({
      method: 'PATCH',
      url: `/durable-agents/${id}`,
      payload: { lifecycle: 'ready', remit: 'Own typography systems, density, and accessibility.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().agent.profile.revision).toBe(2);

    const retired = await state.app.inject({ method: 'POST', url: `/durable-agents/${id}/retire` });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().agent.profile.lifecycle).toBe('retired');
  });

  test('promotes a native harness session when sanitized capsule lineage agrees', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Typography handoff',
      summary: 'Sanitized operator context and typography decisions.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: 'claude-session-agent', adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
        },
      },
    });

    const promoted = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: { ...profile(), sourceSessionId: SOURCE_SESSION_ID, handoffEpisodeId: episode.id },
    });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().agent.profile.origin).toMatchObject({
      kind: 'session-promotion',
      sourceSessionId: SOURCE_SESSION_ID,
      handoffEpisodeId: episode.id,
      sourceAdapter: 'claude-code',
    });
    expect(promoted.json().agent.continuation.endpoint).toBe(`/memory/handoffs/${episode.id}/continue`);

    const mismatch = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: { ...profile(), slug: 'portdaddy-spacing-expert', sourceSessionId: 'session-other', handoffEpisodeId: episode.id },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('PROMOTION_LINEAGE_MISMATCH');

    const repoScopedWithoutProvenance = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: {
        ...profile(),
        slug: 'portdaddy-repo-typography-expert',
        scope: { kind: 'repo', repoRoot: process.cwd() },
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: episode.id,
      },
    });
    expect(repoScopedWithoutProvenance.statusCode).toBe(409);
    expect(repoScopedWithoutProvenance.json().code).toBe('PROMOTION_SCOPE_MISMATCH');
  });

  test('allows repo-scoped promotion only when handoff repository provenance matches', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Repository typography handoff',
      summary: 'Sanitized repository-specific expertise.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: 'claude-session-agent', adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
          workspace: { repoRoot: process.cwd() },
        },
      },
    });

    const promoted = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: {
        ...profile(),
        slug: 'portdaddy-repository-typography-expert',
        scope: { kind: 'repo', repoRoot: process.cwd() },
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: episode.id,
      },
    });

    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().agent.profile.scope).toMatchObject({ kind: 'repo' });
  });

  test('does not let direct creation forge session-promotion lineage', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/durable-agents',
      payload: {
        ...profile(),
        origin: {
          kind: 'session-promotion',
          sourceSessionId: SOURCE_SESSION_ID,
          handoffEpisodeId: 41,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'UNVERIFIED_PROMOTION_ORIGIN' });
    expect(state.durableAgentRoster.list()).toHaveLength(0);
  });

  test('rejects partially numeric episode identifiers', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: {
        ...profile(),
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: '41junk',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(state.durableAgentRoster.list()).toHaveLength(0);
  });

  test('rejects non-loopback mutations while leaving roster reads available', async () => {
    const state = await buildApp();
    openApps.push(state);
    const blocked = await state.app.inject({
      method: 'POST',
      url: '/durable-agents',
      remoteAddress: '203.0.113.9',
      payload: profile(),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('LOOPBACK_ONLY');

    const read = await state.app.inject({ method: 'GET', url: '/durable-agents', remoteAddress: '203.0.113.9' });
    expect(read.statusCode).toBe(200);
  });
});
