import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { semanticPlugin } from '../../routes/semantic.js';

function buildApp(overrides = {}) {
  const review = jest.fn(() => ({
    id: 42,
    decision: 'accepted',
    reviewAction: 'accept',
    reviewedBy: 'operator',
  }));
  const app = Fastify();
  const deps = {
    semanticResolver: {
      stats: jest.fn(() => ({ reviewBacklog: 0 })),
      listResolutions: jest.fn(() => []),
      review,
      search: jest.fn(async () => []),
      ...overrides.semanticResolver,
    },
    tuples: overrides.tuples,
    episodicMemory: overrides.episodicMemory,
    mergeQueue: overrides.mergeQueue,
    metrics: { errors: 0, ...overrides.metrics },
    logger: {
      error: jest.fn(),
      ...overrides.logger,
    },
  };
  return {
    app,
    deps,
    register: () => app.register(semanticPlugin, { deps }),
  };
}

describe('semantic routes', () => {
  test('GET /semantic/resolve joins phrase canonicalization to live tuple, memory, merge, and resolver evidence', async () => {
    const tupleRows = [
      {
        id: 1,
        harbor: 'port-daddy:fleet',
        fields: [
          'semantic:alias',
          'merge',
          'Writing the CSS for Port Daddy website design system',
          'css design-system port-daddy site',
          {
            entryId: 7,
            tokens: ['css', 'design-system', 'port-daddy', 'site'],
          },
        ],
        writtenBy: 'agent-merge',
        createdAt: 100,
        expiresAt: null,
      },
      {
        id: 2,
        harbor: 'port-daddy:fleet',
        fields: [
          'semantic:alias',
          'memory',
          'Port Daddy CSS token handoff',
          'css design-system port-daddy site',
          {
            sourceId: 'session-css-1',
            tokens: ['css', 'design-system', 'port-daddy', 'site'],
          },
        ],
        writtenBy: 'agent-memory',
        createdAt: 101,
        expiresAt: null,
      },
      {
        id: 3,
        harbor: 'port-daddy:fleet',
        fields: [
          'semantic:resolution',
          'auto',
          'css design-system port-daddy site',
          'css design-system port-daddy docs',
          0.91,
          {
            sourceType: 'merge',
            sourceId: 'entry:7',
          },
        ],
        writtenBy: 'agent-merge',
        createdAt: 102,
        expiresAt: null,
      },
    ];
    const { app, deps, register } = buildApp({
      semanticResolver: {
        listResolutions: jest.fn(() => [
          {
            id: 4,
            rawTerm: 'Writing the CSS for Port Daddy website design system',
            canonicalTerm: 'css design-system port-daddy site',
            candidateTerm: 'css design-system port-daddy docs',
            metadata: {
              tokens: ['css', 'design-system', 'port-daddy', 'site'],
            },
          },
        ]),
        search: jest.fn(async () => [
          {
            term: 'css design-system port-daddy site',
            similarity: 0.94,
            fingerprint: 'site-1',
            tokens: ['css', 'design-system', 'port-daddy', 'site'],
          },
        ]),
      },
      tuples: {
        rd: jest.fn((pattern) => tupleRows.filter((tuple) => tuple.fields[0] === pattern[0])),
      },
      episodicMemory: {
        list: jest.fn(() => [
          {
            id: 12,
            projectDir: '/tmp/port-daddy',
            project: 'port-daddy',
            harbor: 'port-daddy:fleet',
            agentId: 'agent-memory',
            episodeType: 'handoff',
            title: 'Port Daddy design system CSS handoff',
            summary: 'Aligned site tokens and design-system CSS naming.',
            sourceType: 'session',
            sourceId: 'session-css-1',
            metadata: null,
            createdAt: 100,
            updatedAt: 100,
          },
        ]),
        stats: jest.fn(),
      },
      mergeQueue: {
        list: jest.fn(() => [
          {
            id: 7,
            agentId: 'agent-merge',
            sessionId: 'session-css-1',
            branch: 'feature/design-system-css',
            repository: '/tmp/port-daddy',
            baseBranch: 'main',
            claims: [
              {
                path: 'website-v2/src/styles/tokens.css',
              },
            ],
            conflictSurface: 0,
            status: 'approved',
            priority: 0,
            submittedAt: 100,
            mergedAt: null,
            mergeCommit: null,
            failureReason: null,
            metadata: {
              task: 'Writing the CSS for Port Daddy website design system',
            },
          },
        ]),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/semantic/resolve?q=design-system%20CSS%20tasks&projectDir=/tmp/port-daddy&project=port-daddy&harbor=port-daddy:fleet',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      query: 'design-system CSS tasks',
      count: 1,
    }));
    expect(body.aliases[0]).toEqual(expect.objectContaining({
      canonicalTerm: 'css design-system',
      tokens: ['css', 'design-system'],
      counts: expect.objectContaining({
        tupleAliases: 2,
        resolutionTuples: 1,
        memoryEpisodes: 1,
        mergeEntries: 1,
        resolutions: 1,
        knownTerms: 1,
      }),
    }));
    expect(body.aliases[0].knownTerms[0]).toEqual(expect.objectContaining({
      term: 'css design-system port-daddy site',
    }));
    expect(body.aliases[0].evidence.tupleAliases.map((entry) => entry.sourceType)).toEqual(['merge', 'memory']);
    expect(deps.semanticResolver.search).toHaveBeenCalledWith('css design-system', { limit: 10 });
    expect(deps.tuples.rd).toHaveBeenCalledWith(['semantic:alias'], { harbor: 'port-daddy:fleet', limit: 50 });
    expect(deps.tuples.rd).toHaveBeenCalledWith(['semantic:resolution'], { harbor: 'port-daddy:fleet', limit: 50 });
    expect(deps.episodicMemory.list).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      harbor: 'port-daddy:fleet',
    }));
    expect(deps.mergeQueue.list).toHaveBeenCalledWith(expect.objectContaining({
      repository: '/tmp/port-daddy',
    }));

    await app.close();
  });

  test('GET /semantic/resolve requires a query', async () => {
    const { app, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/semantic/resolve',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      success: false,
      error: 'query is required',
    });

    await app.close();
  });

  test('POST /semantic/resolutions/:id/review persists operator review decisions', async () => {
    const { app, deps, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/semantic/resolutions/42/review',
      payload: {
        action: 'accept',
        reviewer: 'operator',
        note: 'same concept',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      resolution: expect.objectContaining({
        id: 42,
        decision: 'accepted',
        reviewAction: 'accept',
      }),
    });
    expect(deps.semanticResolver.review).toHaveBeenCalledWith(42, {
      action: 'accept',
      reviewer: 'operator',
      note: 'same concept',
    });

    await app.close();
  });

  test('POST /semantic/resolutions/:id/review rejects invalid actions before persistence', async () => {
    const { app, deps, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/semantic/resolutions/42/review',
      payload: {
        action: 'maybe',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      success: false,
      error: 'action must be accept or reject',
    });
    expect(deps.semanticResolver.review).not.toHaveBeenCalled();

    await app.close();
  });
});
