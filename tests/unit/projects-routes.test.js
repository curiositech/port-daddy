import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockLoadFleetConfig = jest.fn();
const mockValidateTopology = jest.fn(() => ({ valid: true, cycles: [], warnings: [] }));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  loadFleetConfig: mockLoadFleetConfig,
  validateTopology: mockValidateTopology,
}));

const { projectsPlugin } = await import('../../routes/projects.js');

describe('projects routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateTopology.mockReturnValue({ valid: true, cycles: [], warnings: [] });
  });

  test('GET /projects tolerates services deps that only expose find()', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'alpha',
      limits: { budgetUsdPerDay: 5 },
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
        worktree: {
          id: 'wt-alpha',
          name: 'alpha',
          branch: 'main',
          isMain: true,
          repoKey: '/repo/alpha/.git',
          repoRoot: '/repo/alpha',
          siblingCount: 3,
        },
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
      fleetConfigStatus: 'ready',
      budgetUsdPerDay: 5,
      operatorState: 'ready',
      worktree: {
        id: 'wt-alpha',
        branch: 'main',
        isMain: true,
        siblingCount: 3,
      },
    });
    expect(listKnown).toHaveBeenCalledWith(expect.objectContaining({
      serviceRoots: ['/repo/alpha/apps/api'],
    }));

    await app.close();
  });

  test('GET /projects surfaces missing fleet budget as a remediable blocked state', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'expunge-my-arrest',
      agents: [{ name: 'qa' }, { name: 'upl-guardian' }],
      watchers: [{ name: 'notify' }],
      channels: {},
    });
    mockValidateTopology.mockReturnValue({
      valid: true,
      cycles: [],
      warnings: ['Fleet limits.budgetUsdPerDay is required for every agentic launch.'],
    });

    const listKnown = jest.fn(() => [
      {
        id: 'expungement-guide',
        displayName: 'expungement-guide',
        root: '/repo/expungement-guide',
        type: 'fleet',
        services: null,
        config: null,
        tags: [],
        last_scanned: 0,
        created_at: 0,
        metadata: null,
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
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
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
    expect(body.projects[0]).toMatchObject({
      id: 'expungement-guide',
      operatorState: 'blocked',
      fleetConfigStatus: 'missing_budget',
      budgetUsdPerDay: null,
      remediation: {
        action: 'set_budget',
        suggestedBudgetUsdPerDay: 5,
      },
    });
    expect(body.projects[0].operatorSummary).toContain('launches fail closed');

    await app.close();
  });

  test('GET /projects marks .portdaddyrc-only projects as service config, not fleet ready', async () => {
    mockLoadFleetConfig.mockReturnValue(null);

    const app = Fastify();
    await app.register(projectsPlugin, {
      deps: {
        projects: {
          register: jest.fn(),
          get: jest.fn(),
          list: jest.fn(() => []),
          listKnown: jest.fn(() => [
            {
              id: 'service-only',
              displayName: 'service-only',
              root: '/repo/service-only',
              type: 'single',
              services: null,
              config: null,
              tags: [],
              last_scanned: 0,
              created_at: 0,
              metadata: null,
              signals: ['config'],
              sources: ['discovered'],
              exists: true,
            },
          ]),
          remove: jest.fn(),
        },
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
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
    expect(body.projects[0]).toMatchObject({
      id: 'service-only',
      fleetConfigStatus: 'missing',
      operatorState: 'service_only',
      remediation: {
        action: 'create_fleet',
      },
    });
    expect(body.projects[0].operatorSummary).toContain('pd up service config');

    await app.close();
  });

  test('GET /projects reuses a short-lived operator payload during poll bursts', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'cached',
      limits: { budgetUsdPerDay: 5 },
      agents: [{ name: 'qa' }],
      watchers: [],
      channels: {},
    });

    const listKnown = jest.fn(() => [
      {
        id: 'cached',
        displayName: 'cached',
        root: '/repo/cached',
        type: 'fleet',
        services: null,
        config: null,
        tags: [],
        last_scanned: 0,
        created_at: 0,
        metadata: null,
        signals: ['fleet'],
        sources: ['discovered'],
        exists: true,
      },
    ]);
    const getStatus = jest.fn(() => ({ fleets: [] }));
    const find = jest.fn(() => ({ success: true, services: [] }));

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
        services: { find },
        fleetDaemon: { getStatus },
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
        activityLog: {},
      },
    });

    const first = await app.inject({ method: 'GET', url: '/projects' });
    const second = await app.inject({ method: 'GET', url: '/projects' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(listKnown).toHaveBeenCalledTimes(1);
    expect(mockLoadFleetConfig).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
