import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { spawnPlugin } from '../../routes/spawn.js';
import { createTestDb } from '../setup-unit.js';

describe('spawn cancellation reason', () => {
  test('validates and forwards the exact operator reason', async () => {
    const db = createTestDb();
    const cancel = jest.fn();
    const logger = { info: jest.fn(), error: jest.fn() };
    const app = Fastify();
    await app.register(spawnPlugin, {
      deps: {
        db,
        spawner: { cancel },
        metrics: { errors: 0 },
        logger,
      },
    });

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/spawn/spawned-123',
        payload: { reason: '  Superseded by operator review  ' },
      });

      expect(response.statusCode).toBe(200);
      expect(cancel).toHaveBeenCalledWith('spawned-123', 'Superseded by operator review');
      expect(response.json()).toEqual(expect.objectContaining({
        success: true,
        agentId: 'spawned-123',
        reason: 'Superseded by operator review',
      }));
      expect(logger.info).toHaveBeenCalledWith('spawn_cancel', {
        agentId: 'spawned-123',
        reason: 'Superseded by operator review',
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  test.each([null, '', '   ', 'x'.repeat(501)])('rejects invalid reason %p', async (reason) => {
    const db = createTestDb();
    const cancel = jest.fn();
    const app = Fastify();
    await app.register(spawnPlugin, {
      deps: {
        db,
        spawner: { cancel },
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
      },
    });

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/spawn/spawned-123',
        payload: { reason },
      });

      expect(response.statusCode).toBe(400);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      await app.close();
      db.close();
    }
  });
});
