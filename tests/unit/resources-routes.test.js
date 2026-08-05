import { describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { resourcesPlugin } from '../../routes/resources.js';

describe('resources routes', () => {
  test('GET /resources/overview passes live counts and user cap into the monitor', async () => {
    const calls = [];
    const app = Fastify();
    await app.register(resourcesPlugin, {
      deps: {
        resourceGovernance: {
          overview(input) {
            calls.push(input);
            return {
              success: true,
              generatedAt: 123,
              policy: {
                mode: 'observe',
                userCap: input.userCap,
                suggestedConcurrentSpawns: 3,
                safeToAskForMore: false,
                escalation: {
                  recommended: false,
                  title: 'Stay within the current cap.',
                  body: 'Measured activity does not justify asking for a higher cap right now.',
                  suggestedCap: 3,
                },
              },
            };
          },
        },
        agents: {
          list: jest.fn(() => ({ agents: [{ isActive: true }, { isActive: true }] })),
        },
        services: {
          find: jest.fn(() => ({ services: [{ port: 43121 }, { port: 4567 }, { status: 'running' }] })),
        },
        fleetDaemon: {
          getStatus: jest.fn(() => ({
            totalAgents: 8,
            totalLaunchableAgents: 3,
            fleets: [{ running: true, agents: [] }],
          })),
        },
        costTracker: {
          total: jest.fn(() => ({ totalUsd: 1.2, spawnCount: 4, estimatedCount: 1 })),
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/resources/overview?maxConcurrentSpawns=2&projectDir=%2Ftmp%2Fproject',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      generatedAt: 123,
      policy: expect.objectContaining({ userCap: 2 }),
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      userCap: 2,
      activeAgents: 2,
      activePorts: 2,
      dailySpendUsd: 1.2,
      dailySpawnCount: 4,
      estimatedCostEvents: 1,
    }));

    await app.close();
  });

  test('GET /resources/overview returns 500 when the monitor fails', async () => {
    const app = Fastify();
    await app.register(resourcesPlugin, {
      deps: {
        logger: { error: jest.fn() },
        resourceGovernance: {
          overview() {
            throw new Error('boom');
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/resources/overview' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      success: false,
      error: 'resource overview unavailable',
    });

    await app.close();
  });
});
