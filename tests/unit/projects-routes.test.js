import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockLoadFleetConfig = jest.fn();
const mockValidateTopology = jest.fn(() => ({ valid: true, cycles: [], warnings: [] }));
const mockScanProject = jest.fn();
const mockBuildConfigFromScan = jest.fn();
const mockSaveConfig = jest.fn();

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  loadFleetConfig: mockLoadFleetConfig,
  validateTopology: mockValidateTopology,
}));

jest.unstable_mockModule('../../lib/scan.js', () => ({
  scanProject: mockScanProject,
  buildConfigFromScan: mockBuildConfigFromScan,
}));

jest.unstable_mockModule('../../lib/config.js', () => ({
  saveConfig: mockSaveConfig,
}));

const { projectsPlugin } = await import('../../routes/projects.js');

describe('projects routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScanProject.mockReset();
    mockBuildConfigFromScan.mockReset();
    mockSaveConfig.mockReset();
    mockValidateTopology.mockReturnValue({ valid: true, cycles: [], warnings: [] });
    mockLoadFleetConfig.mockReset();
  });

  function createDeps(overrides = {}) {
    const projects = {
      register: jest.fn(),
      get: jest.fn(),
      list: jest.fn(() => []),
      listKnown: jest.fn(() => []),
      remove: jest.fn(),
      ...(overrides.projects ?? {}),
    };
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      ...(overrides.logger ?? {}),
    };
    const activityLog = {
      log: jest.fn(),
      ...(overrides.activityLog ?? {}),
    };

    return {
      projects,
      services: overrides.services,
      fleetDaemon: overrides.fleetDaemon ?? {
        getStatus() {
          return { fleets: [] };
        },
      },
      metrics: overrides.metrics ?? { errors: 0 },
      logger,
      activityLog,
    };
  }

  async function createApp(overrides = {}) {
    const app = Fastify();
    const deps = createDeps(overrides);

    await app.register(projectsPlugin, { deps });

    return { app, deps };
  }

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
    });
    expect(listKnown).toHaveBeenCalledWith(expect.objectContaining({
      serviceRoots: ['/repo/alpha/apps/api'],
    }));

    await app.close();
  });

  test('GET /projects uses services.list roots when present and marks context-only projects', async () => {
    mockLoadFleetConfig.mockReturnValue(null);

    const listKnown = jest.fn(() => [
      {
        id: 'context-only',
        displayName: 'context-only',
        root: '/repo/context-only',
        type: 'single',
        services: null,
        config: null,
        tags: [],
        last_scanned: 0,
        created_at: 0,
        metadata: null,
        signals: ['context'],
        sources: ['discovered'],
        exists: true,
      },
    ]);

    const { app } = await createApp({
      projects: {
        listKnown,
      },
      services: {
        list: jest.fn(() => ({
          services: [
            { cwd: '/repo/context-only/apps/api' },
            { cwd: '' },
            { cwd: null },
          ],
        })),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/projects' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      id: 'context-only',
      operatorState: 'context_only',
      fleetConfigStatus: 'missing',
      remediation: {
        action: 'run_scan',
      },
    });
    expect(listKnown).toHaveBeenCalledWith(expect.objectContaining({
      serviceRoots: ['/repo/context-only/apps/api'],
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

  test('POST /scan persists scan results, logs them, and returns saved config details', async () => {
    const scanResult = {
      project: 'alpha',
      root: '/repo/alpha',
      type: 'monorepo',
      workspaceType: 'monorepo',
      serviceCount: 2,
      services: {
        api: {
          relativePath: 'apps/api',
          stack: { name: 'Fastify' },
          dev: true,
          health: 'ok',
          preferredPort: 3001,
        },
        web: {
          dir: 'apps/web',
          stack: { name: 'React' },
          dev: false,
          health: 'warn',
          preferredPort: 4173,
        },
      },
      suggestions: ['use pd fleet init'],
      guidance: ['run pd scan'],
      existingConfig: {
        _path: '/repo/alpha/.portdaddyrc',
        services: {
          api: {},
          web: {},
        },
      },
    };
    const config = {
      project: 'alpha',
      services: { api: {}, web: {} },
      limits: { budgetUsdPerDay: 5 },
    };

    mockScanProject.mockReturnValue(scanResult);
    mockBuildConfigFromScan.mockReturnValue(config);
    mockSaveConfig.mockReturnValue('/repo/alpha/.portdaddyrc');

    const { app, deps } = await createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/scan',
      payload: {
        dir: '/repo/alpha',
        save: true,
        dryRun: false,
        useBranch: true,
      },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(mockScanProject).toHaveBeenCalledWith('/repo/alpha', { useBranch: true });
    expect(mockBuildConfigFromScan).toHaveBeenCalledWith(scanResult);
    expect(mockSaveConfig).toHaveBeenCalledWith(config, '/repo/alpha');
    expect(deps.projects.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'alpha',
      root: '/repo/alpha',
      type: 'monorepo',
      config,
      services: scanResult.services,
      metadata: {
        workspaceType: 'monorepo',
        serviceCount: 2,
        frameworks: ['Fastify', 'React'],
      },
    }));
    expect(deps.logger.info).toHaveBeenCalledWith('project_scanned', {
      project: 'alpha',
      type: 'monorepo',
      serviceCount: 2,
      saved: true,
    });
    expect(deps.activityLog.log).toHaveBeenCalledWith('project_scan', {
      details: 'Scanned alpha: 2 services found',
      metadata: { project: 'alpha', type: 'monorepo' },
    });
    expect(body).toMatchObject({
      success: true,
      project: 'alpha',
      root: '/repo/alpha',
      type: 'monorepo',
      serviceCount: 2,
      saved: true,
      savedPath: '/repo/alpha/.portdaddyrc',
      dryRun: false,
      existingConfig: {
        path: '/repo/alpha/.portdaddyrc',
        serviceCount: 2,
      },
    });
    expect(body.services.api).toEqual({
      dir: 'apps/api',
      framework: 'Fastify',
      dev: true,
      health: 'ok',
      preferredPort: 3001,
    });
    expect(body.services.web).toEqual({
      dir: 'apps/web',
      framework: 'React',
      dev: false,
      health: 'warn',
      preferredPort: 4173,
    });

    await app.close();
  });

  test('POST /scan skips persistence when dryRun is enabled', async () => {
    const scanResult = {
      project: 'dry-run',
      root: '/repo/dry-run',
      type: 'single',
      workspaceType: 'single',
      serviceCount: 0,
      services: {},
      suggestions: [],
      guidance: [],
      existingConfig: null,
    };

    mockScanProject.mockReturnValue(scanResult);
    mockBuildConfigFromScan.mockReturnValue({
      project: 'dry-run',
      services: {},
      limits: { budgetUsdPerDay: 5 },
    });

    const { app, deps } = await createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/scan',
      payload: {
        dir: '/repo/dry-run',
        save: true,
        dryRun: true,
      },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(mockScanProject).toHaveBeenCalledWith('/repo/dry-run', { useBranch: false });
    expect(mockBuildConfigFromScan).toHaveBeenCalledWith(scanResult);
    expect(deps.projects.register).not.toHaveBeenCalled();
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(body.saved).toBe(false);
    expect(body.savedPath).toBeNull();
    expect(body.dryRun).toBe(true);
    expect(body.serviceCount).toBe(0);

    await app.close();
  });

  test('POST /scan returns a 500 and increments metrics when scanning throws', async () => {
    const metrics = { errors: 0 };
    mockScanProject.mockImplementation(() => {
      throw new Error('scan exploded');
    });

    const { app, deps } = await createApp({ metrics });

    const res = await app.inject({
      method: 'POST',
      url: '/scan',
      payload: {
        dir: '/repo/failing',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal server error' });
    expect(metrics.errors).toBe(1);
    expect(deps.logger.error).toHaveBeenCalledWith('scan_error', {
      error: 'scan exploded',
    });
    expect(deps.projects.register).not.toHaveBeenCalled();
    expect(mockSaveConfig).not.toHaveBeenCalled();

    await app.close();
  });

  test('GET /projects/:id returns details and 404s with the suggestion when missing', async () => {
    const project = {
      id: 'alpha',
      root: '/repo/alpha',
      type: 'monorepo',
      config: { project: 'alpha' },
      services: { api: { stack: 'Fastify' } },
      last_scanned: 123,
      created_at: 100,
      metadata: { frameworks: ['Fastify'] },
    };

    const get = jest.fn((id) => (id === 'alpha' ? project : null));
    const { app } = await createApp({
      projects: {
        get,
      },
    });

    const found = await app.inject({ method: 'GET', url: '/projects/alpha' });
    const missing = await app.inject({ method: 'GET', url: '/projects/missing' });

    expect(get).toHaveBeenNthCalledWith(1, 'alpha');
    expect(get).toHaveBeenNthCalledWith(2, 'missing');
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({
      success: true,
      project: {
        id: 'alpha',
        root: '/repo/alpha',
        type: 'monorepo',
        config: { project: 'alpha' },
        services: { api: { stack: 'Fastify' } },
        lastScanned: 123,
        createdAt: 100,
        metadata: { frameworks: ['Fastify'] },
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      error: 'Project not found',
      suggestion: 'Run port-daddy scan from the project directory',
    });

    await app.close();
  });

  test('DELETE /projects/:id removes projects and returns a 404 when the project is already gone', async () => {
    const remove = jest.fn((id) => id === 'alpha');
    const { app, deps } = await createApp({
      projects: {
        remove,
      },
    });

    const removed = await app.inject({ method: 'DELETE', url: '/projects/alpha' });
    const missing = await app.inject({ method: 'DELETE', url: '/projects/missing' });

    expect(remove).toHaveBeenNthCalledWith(1, 'alpha');
    expect(remove).toHaveBeenNthCalledWith(2, 'missing');
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({
      success: true,
      message: 'Project "alpha" removed',
    });
    expect(deps.logger.info).toHaveBeenCalledWith('project_removed', { id: 'alpha' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      error: 'Project not found',
    });

    await app.close();
  });
});
