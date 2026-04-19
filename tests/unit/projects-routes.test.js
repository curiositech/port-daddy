import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockLoadFleetConfig = jest.fn();

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  loadFleetConfig: mockLoadFleetConfig,
}));

const { projectsPlugin } = await import('../../routes/projects.js');

describe('projects routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /projects tolerates services deps that only expose find()', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'alpha',
      agents: [{ name: 'spark' }],
      watchers: [{ name: 'git' }],
      channels: {},
    });

    const listKnown = jest.fn(() => [
      {
        id: 'alpha',
        displayName: 'alpha',
        root: '/repo/alpha',
        type: 'fleet',
        services: null,
        config: null,
        tags: [],
        last_scanned: 123,
        created_at: 100,
        metadata: { frameworks: ['Fastify'] },
        signals: ['fleet'],
        sources: ['discovered'],
        exists: true,
      },
    ]);

    const app = Fastify();
    await app.register(projectsPlugin, {
      deps: {
        projects: {
          register: jest.fn(),
          get: jest.fn(),
          list: jest.fn(() => []),
          listKnown,
          remove: jest.fn(),
        },
        services: {
          find: jest.fn(() => ({
            success: true,
            services: [{ cwd: '/repo/alpha/apps/api' }],
          })),
        },
        fleetDaemon: {
          getStatus() {
            return {
              fleets: [],
            };
          },
        },
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
        activityLog: {},
      },
    });

    const res = await app.inject({ method: 'GET', url: '/projects' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      id: 'alpha',
      configuredAgentCount: 1,
      configuredWatcherCount: 1,
    });
    expect(listKnown).toHaveBeenCalledWith(expect.objectContaining({
      serviceRoots: ['/repo/alpha/apps/api'],
    }));

    await app.close();
  });
});
