import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockExistsSync = jest.fn();
const mockStatSync = jest.fn();
const mockLoadFleetConfig = jest.fn();
const mockFindFleetConfigPath = jest.fn();
const mockValidateTopology = jest.fn(() => ({ valid: true, cycles: [], warnings: [] }));

jest.unstable_mockModule('node:fs', () => ({
  chmodSync: jest.fn(),
  existsSync: mockExistsSync,
  mkdirSync: jest.fn(),
  readFileSync: mockReadFileSync,
  statSync: mockStatSync,
  unlinkSync: jest.fn(),
  writeFileSync: mockWriteFileSync,
  // routes/fleet.ts now imports the I/O registry (GET /fleet/sources), whose
  // file trigger references fs.watch at module-link time; email/notify sinks
  // pull appendFileSync via the consent gate.
  watch: jest.fn(() => ({ close: jest.fn() })),
  appendFileSync: jest.fn(),
}));

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(() => ''),
  execFileSync: jest.fn(),
  // notify-macos sink + EventKit bridge, transitively imported by the
  // I/O registry the routes now reference.
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  BUILTIN_MODEL_TIERS: {
    codex: { low: 'gpt-5.4-mini', mid: 'gpt-5.3-codex', high: 'gpt-5.4' },
  },
  findFleetConfigPath: mockFindFleetConfigPath,
  loadFleetConfig: mockLoadFleetConfig,
  validateTopology: mockValidateTopology,
  // routes/fleet.js transitively imports these via lib/spawn-forecast.ts for
  // GET /fleet/forecast. This suite doesn't exercise that route, so
  // passthrough stubs are enough to satisfy the ESM module link.
  parseCronInterval: (cron) => {
    const match = /^\*\/(\d+) \* \* \* \*$/.exec(cron ?? '');
    return match ? Number(match[1]) * 60_000 : 10 * 60_000;
  },
  isIntervalCronSchedule: (cron) => /^\*\/[1-9]\d* \* \* \* \*$/.test(cron ?? ''),
  isAbsoluteCronSchedule: (cron) => /^\d+ (?:\d+|\*) \* \* \*$/.test(cron ?? ''),
  resolveFleetAgentRuntime: (agent) => ({
    backend: agent?.backend ?? null,
    model: agent?.model ?? null,
    modelTier: agent?.modelTier,
  }),
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: jest.fn(async () => ({
    status: 'ready',
    summary: 'ready',
  })),
}));

const { fleetPlugin } = await import('../../routes/fleet.js');

describe('fleet routes project resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ isDirectory: () => false });
  });

  test('GET /fleet/forecast is not shadowed by GET /fleet/:project', async () => {
    const getProject = jest.fn(() => null);
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return {
              running: true,
              startedAt: Date.now(),
              fleets: [],
              totalAgents: 0,
              totalWatchers: 0,
            };
          },
        },
        projects: {
          get: getProject,
          getByPath() {
            return null;
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet/forecast' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.observed).toBeNull();
    expect(getProject).not.toHaveBeenCalledWith('forecast');

    await app.close();
  });

  test('GET /fleet/config/:project resolves a registered stopped project by id', async () => {
    mockFindFleetConfigPath.mockReturnValue('/repo/stopped/pd-fleet.yml');
    mockReadFileSync.mockReturnValue('name: stopped\nagents: []\nwatchers: []\nchannels: {}\n');
    mockLoadFleetConfig.mockReturnValue({
      name: 'stopped',
      agents: [],
      watchers: [],
      channels: {},
    });

    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return {
              running: true,
              startedAt: Date.now(),
              fleets: [],
              totalAgents: 0,
              totalWatchers: 0,
            };
          },
        },
        projects: {
          get(id) {
            return id === 'stopped-project' ? { id: 'stopped-project', root: '/repo/stopped' } : null;
          },
          getByPath(root) {
            return root === '/repo/stopped' ? { id: 'stopped-project', root } : null;
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet/config/stopped-project' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.project).toBe('stopped-project');
    expect(body.projectDir).toBe('/repo/stopped');
    expect(body.path).toBe('/repo/stopped/pd-fleet.yml');
    expect(mockFindFleetConfigPath).toHaveBeenCalledWith('/repo/stopped');
    expect(mockLoadFleetConfig).toHaveBeenCalledWith('/repo/stopped');

    await app.close();
  });

  test('GET /fleet/config/:project resolves an unregistered project directory when pd-fleet.yml exists there', async () => {
    mockExistsSync.mockImplementation((path) => path === '/repo/discovered');
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockFindFleetConfigPath.mockReturnValue('/repo/discovered/pd-fleet.yml');
    mockReadFileSync.mockReturnValue('name: discovered\nagents: []\nwatchers: []\nchannels: {}\n');
    mockLoadFleetConfig.mockImplementation((path) => (
      path === '/repo/discovered'
        ? { name: 'discovered', agents: [], watchers: [], channels: {} }
        : null
    ));

    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return {
              running: true,
              startedAt: Date.now(),
              fleets: [],
              totalAgents: 0,
              totalWatchers: 0,
            };
          },
        },
        projects: {
          get() {
            return null;
          },
          getByPath() {
            return null;
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet/config/%2Frepo%2Fdiscovered' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.project).toBe('discovered');
    expect(body.projectDir).toBe('/repo/discovered');
    expect(body.path).toBe('/repo/discovered/pd-fleet.yml');

    await app.close();
  });

  test('POST /fleet/config/:project/budget writes limits.budget_usd_per_day into stopped project YAML', async () => {
    mockFindFleetConfigPath.mockReturnValue('/repo/stopped/pd-fleet.yml');
    mockReadFileSync.mockReturnValue('fleet:\n  name: stopped\n  limits:\n    max_concurrent_spawns: 2\n  agents: []\n  watchers: []\n  channels: {}\n');
    mockLoadFleetConfig.mockReturnValue({
      name: 'stopped',
      limits: { budgetUsdPerDay: 5 },
      agents: [],
      watchers: [],
      channels: {},
    });

    const reload = jest.fn();
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          reload,
          getStatus() {
            return {
              running: true,
              startedAt: Date.now(),
              fleets: [],
              totalAgents: 0,
              totalWatchers: 0,
            };
          },
        },
        projects: {
          get(id) {
            return id === 'stopped-project' ? { id: 'stopped-project', root: '/repo/stopped' } : null;
          },
          getByPath() {
            return null;
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/config/stopped-project/budget',
      payload: { usdPerDay: 5 },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ success: true, budgetUsdPerDay: 5 });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/repo/stopped/pd-fleet.yml',
      expect.stringContaining('budget_usd_per_day: 5'),
      'utf-8',
    );
    expect(reload).toHaveBeenCalled();

    await app.close();
  });
});
