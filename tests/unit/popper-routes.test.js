import { jest } from '@jest/globals';
import Fastify from 'fastify';

const { popperPlugin } = await import('../../routes/popper.js');

describe('popper routes', () => {
  test('GET /popper/status self-degrades when popper is not configured', async () => {
    const app = Fastify();
    await app.register(popperPlugin, { deps: {} });

    const res = await app.inject({ method: 'GET', url: '/popper/status' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      available: false,
      eligibleCount: 0,
      poppedCount: 0,
      nextCandidate: null,
      pausedByFlag: true,
    });

    await app.close();
  });

  test('GET /popper/next returns 503 when popper is not configured', async () => {
    const app = Fastify();
    await app.register(popperPlugin, { deps: {} });

    const res = await app.inject({ method: 'GET', url: '/popper/next' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      ok: false,
      error: 'roadmap popper is not configured in this daemon mode',
    });

    await app.close();
  });

  test('GET /popper/status returns the configured popper status', async () => {
    const status = jest.fn(() => ({
      eligibleCount: 1,
      poppedCount: 2,
      nextCandidate: { slug: 'ship-it' },
      pausedByFlag: false,
    }));
    const app = Fastify();
    await app.register(popperPlugin, {
      deps: {
        popper: {
          status,
          nextCandidate: jest.fn(),
          popNext: jest.fn(),
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/popper/status?harbor=port-daddy' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      eligibleCount: 1,
      poppedCount: 2,
      nextCandidate: { slug: 'ship-it' },
      pausedByFlag: false,
    });
    expect(status).toHaveBeenCalledWith('port-daddy');

    await app.close();
  });
});
