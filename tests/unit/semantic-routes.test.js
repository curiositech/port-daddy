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
