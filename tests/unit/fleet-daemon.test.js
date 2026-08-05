// Fleet Daemon Tests — lib/fleet-daemon.ts
//
// Tests the always-on fleet subsystem that runs inside the daemon process.
// Verifies: multi-project loading, start/stop lifecycle, event publishing,
// project registration, graceful stop on shutdown.

import { jest } from '@jest/globals';
import { join } from 'node:path';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockRealpathSyncNative = jest.fn((path) => path);
const mockRealpathSync = Object.assign(jest.fn((path) => path), {
  native: mockRealpathSyncNative,
});

const mockFsWatch = jest.fn(() => ({ close: jest.fn() }));

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  realpathSync: mockRealpathSync,
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
  watch: mockFsWatch,
  // Transitive imports of the push notifier (lib/fleet/push-notifications.ts)
  // and the EventKit bridge need these at module-link time.
  chmodSync: jest.fn(),
  statSync: jest.fn(() => ({ mtimeMs: 0 })),
  appendFileSync: jest.fn(),
  // squid/matrix.ts (Ink Cloud steering alerts) — atomic write + lock file.
  renameSync: jest.fn(),
  openSync: jest.fn(() => 3),
  closeSync: jest.fn(),
  rmSync: jest.fn(),
  rmdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
  utimesSync: jest.fn(),
}));

// Mock fleet-engine to avoid real process spawning
const mockStartAll = jest.fn();
const mockStopAll = jest.fn();
const mockGetStatus = jest.fn(() => []);
const mockHailAgent = jest.fn(async () => ({ success: true }));
const mockPauseAgent = jest.fn(() => ({ success: true }));
const mockResumeAgent = jest.fn(() => ({ success: true }));
const mockSetEnabledAgents = jest.fn(() => ({ success: true }));
const mockLoadFleetConfig = jest.fn();
const mockCreateFleetRunner = jest.fn(() => ({
  startAll: mockStartAll,
  stopAll: mockStopAll,
  getStatus: mockGetStatus,
  startAgent: jest.fn(),
  hailAgent: mockHailAgent,
  pauseAgent: mockPauseAgent,
  resumeAgent: mockResumeAgent,
  setEnabledAgents: mockSetEnabledAgents,
  config: { agents: [], watchers: [], channels: {}, name: 'test' },
}));
const mockValidateTopology = jest.fn(() => ({ valid: true, cycles: [], warnings: [] }));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  loadFleetConfig: mockLoadFleetConfig,
  createFleetRunner: mockCreateFleetRunner,
  validateTopology: mockValidateTopology,
  findFleetConfigPath: jest.fn((dir) => `${dir}/pd-fleet.yml`),
}));

// Mock child_process (fleet-engine imports it)
jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(() => 'main'),
  // notify-macos (osascript) + the EventKit bridge, imported transitively
  // by the daemon's approval-notification wiring.
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
  execFileSync: jest.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────────────

const { createFleetDaemon } = await import('../../lib/fleet-daemon.js');
const createdDaemons = [];

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  const lockState = new Map();

  return {
    projects: {
      list: jest.fn(() => []),
    },
    messaging: {
      publish: jest.fn(),
      subscribe: jest.fn(() => jest.fn()),
    },
    tuples: {
      out: jest.fn(() => ({ id: 1, fields: [], harbor: null })),
    },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    locks: {
      acquire: jest.fn((name, options = {}) => {
        const now = Date.now();
        const existing = lockState.get(name);
        if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
          return {
            success: false,
            error: 'lock is held',
            holder: existing.owner,
            expiresAt: existing.expiresAt,
          };
        }
        const ttl = typeof options.ttl === 'number' ? options.ttl : 300000;
        lockState.set(name, {
          owner: options.owner || 'test-owner',
          expiresAt: now + ttl,
          metadata: options.metadata || null,
        });
        return { success: true };
      }),
      release: jest.fn((name, options = {}) => {
        const existing = lockState.get(name);
        if (!existing) return { success: true };
        if (options.owner && existing.owner !== options.owner) {
          return { success: false, error: 'lock held by another owner', holder: existing.owner };
        }
        lockState.delete(name);
        return { success: true };
      }),
      extend: jest.fn((name, options = {}) => {
        const existing = lockState.get(name);
        if (!existing) return { success: false, error: 'lock not held' };
        if (options.owner && existing.owner !== options.owner) {
          return { success: false, error: 'lock held by another owner' };
        }
        const ttl = typeof options.ttl === 'number' ? options.ttl : 300000;
        existing.expiresAt = Date.now() + ttl;
        lockState.set(name, existing);
        return { success: true, expiresAt: existing.expiresAt };
      }),
      check: jest.fn((name) => {
        const existing = lockState.get(name);
        if (!existing) return { success: true, held: false };
        return {
          success: true,
          held: true,
          owner: existing.owner,
          expiresAt: existing.expiresAt,
          metadata: existing.metadata,
        };
      }),
    },
    daemonDir: '/test/daemon',
    ...overrides,
  };
}

function makeDaemon(deps) {
  const daemon = createFleetDaemon(deps);
  createdDaemons.push(daemon);
  return daemon;
}

function makeConfig(name = 'test-project') {
  return {
    name,
    agents: [
      { name: 'qa', backend: 'claude-cli', prompt: 'Review code', trigger: 'git:committed' },
      { name: 'spark', backend: 'claude-cli', prompt: 'Generate ideas', schedule: '*/30 * * * *' },
    ],
    watchers: [{ name: 'notify', trigger: 'qa:findings', exec: 'echo findings' }],
    channels: { 'git:committed': { description: 'Post-commit' } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no fleet configs found
  mockExistsSync.mockReturnValue(false);
  mockLoadFleetConfig.mockReturnValue(null);
  mockHailAgent.mockResolvedValue({ success: true });
  mockPauseAgent.mockReturnValue({ success: true });
  mockResumeAgent.mockReturnValue({ success: true });
  mockSetEnabledAgents.mockReturnValue({ success: true });
  mockRealpathSync.mockImplementation((path) => path);
  mockRealpathSyncNative.mockImplementation((path) => path);
});

afterEach(() => {
  while (createdDaemons.length > 0) {
    createdDaemons.pop()?.stop();
  }
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createFleetDaemon', () => {
  test('start() with no fleet configs does nothing gracefully', () => {
    const deps = makeDeps();
    const daemon = makeDaemon(deps);

    daemon.start();

    const status = daemon.getStatus();
    expect(status.running).toBe(true);
    expect(status.fleets).toHaveLength(0);
    expect(status.totalAgents).toBe(0);
  });

  test('start() discovers and starts daemon dir fleet', () => {
    const semanticResolver = { observeAliases: jest.fn() };
    const deps = makeDeps({ semanticResolver });
    const config = makeConfig('port-daddy');

    // pd-fleet.yml exists in daemon dir
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([
      { name: 'qa', type: 'triggered', running: true, uptime: 0 },
      { name: 'spark', type: 'scheduled', running: true, uptime: 0 },
    ]);

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(mockLoadFleetConfig).toHaveBeenCalledWith('/test/daemon');
    expect(mockCreateFleetRunner).toHaveBeenCalledWith(
      config,
      '/test/daemon',
      expect.objectContaining({
        onEvent: expect.any(Function),
        semanticResolver,
      })
    );
    expect(mockStartAll).toHaveBeenCalledTimes(1);

    const status = daemon.getStatus();
    expect(status.running).toBe(true);
    expect(status.fleets).toHaveLength(1);
    expect(status.fleets[0].project).toBe('port-daddy');
    expect(status.totalAgents).toBe(2);
  });

  test('start() skips stable install dir fleet by default', () => {
    const deps = makeDeps({ daemonDir: '/Users/test/port-daddy-stable' });

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(mockLoadFleetConfig).not.toHaveBeenCalled();
    expect(mockStartAll).not.toHaveBeenCalled();
    expect(daemon.getStatus().fleets).toHaveLength(0);
    expect(daemon.getStatus().skipped).toEqual([
      expect.objectContaining({
        project: 'port-daddy-stable',
        projectDir: '/Users/test/port-daddy-stable',
        reason: expect.stringContaining('protected from fleet writes'),
      }),
    ]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'fleet_stable_install_skipped',
      expect.objectContaining({
        project: 'port-daddy-stable',
        projectDir: '/Users/test/port-daddy-stable',
        source: 'daemon',
      })
    );
  });

  test('start() skips symlinked stable install dir fleet by default', () => {
    const deps = makeDeps({ daemonDir: '/usr/local/bin/port-daddy' });
    mockRealpathSyncNative.mockImplementation((path) => {
      if (path === '/usr/local/bin/port-daddy') return '/Users/test/port-daddy-stable';
      return path;
    });

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(mockLoadFleetConfig).not.toHaveBeenCalled();
    expect(mockStartAll).not.toHaveBeenCalled();
    expect(daemon.getStatus().fleets).toHaveLength(0);
    expect(daemon.getStatus().skipped).toEqual([
      expect.objectContaining({
        project: 'port-daddy',
        projectDir: '/usr/local/bin/port-daddy',
        reason: expect.stringContaining('protected from fleet writes'),
      }),
    ]);
  });

  test('start() can opt into stable install dir fleet explicitly', () => {
    const deps = makeDeps({
      daemonDir: '/Users/test/port-daddy-stable',
      allowStableInstallFleet: true,
    });
    const config = makeConfig('port-daddy');

    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(mockLoadFleetConfig).toHaveBeenCalledWith('/Users/test/port-daddy-stable');
    expect(mockStartAll).toHaveBeenCalledTimes(1);
    expect(daemon.getStatus().fleets).toHaveLength(1);
    expect(daemon.getStatus().skipped).toHaveLength(0);
  });

  test('start() discovers registered project fleets', () => {
    const deps = makeDeps({
      projects: {
        list: jest.fn(() => [
          { id: 'sextant', root: '/test/sextant', tags: null },
          { id: 'jbuds', root: '/test/jbuds', tags: ['web'] },
        ]),
      },
    });

    const sextantConfig = makeConfig('sextant');
    const jbudsConfig = makeConfig('jbuds');

    mockExistsSync.mockImplementation((path) => {
      return path === join('/test/sextant', 'pd-fleet.yml') ||
             path === join('/test/jbuds', 'pd-fleet.yml');
    });

    mockLoadFleetConfig.mockImplementation((dir) => {
      if (dir === '/test/sextant') return sextantConfig;
      if (dir === '/test/jbuds') return jbudsConfig;
      return null;
    });
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(mockStartAll).toHaveBeenCalledTimes(2);
    expect(daemon.getStatus().fleets).toHaveLength(2);
  });

  test('startProject() skips a project fleet already owned by another daemon', () => {
    const sharedLocks = makeDeps().locks;
    const depsA = makeDeps({ locks: sharedLocks });
    const depsB = makeDeps({ locks: sharedLocks });

    mockLoadFleetConfig.mockReturnValue(makeConfig('shared-project'));
    mockGetStatus.mockReturnValue([]);

    const daemonA = makeDaemon(depsA);
    expect(daemonA.startProject('/test/shared').success).toBe(true);

    const daemonB = makeDaemon(depsB);
    const result = daemonB.startProject('/test/shared');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already held/);
    expect(daemonB.getStatus().fleets).toHaveLength(0);
    expect(daemonB.getStatus().skipped).toEqual([
      expect.objectContaining({
        projectDir: '/test/shared',
        reason: expect.stringContaining('already held'),
      }),
    ]);
  });

  test('startProject() reclaims a stale fleet lease held by a dead daemon pid', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 424242 && signal === 0) {
        const error = new Error('no such process');
        error.code = 'ESRCH';
        throw error;
      }
      return true;
    });
    const acquire = jest.fn()
      .mockReturnValueOnce({
        success: false,
        error: 'lock is held',
        holder: 'fleetd:port-daddy-stable:unknown:424242',
      })
      .mockReturnValueOnce({ success: true });
    const release = jest.fn(() => ({ success: true }));
    const deps = makeDeps({
      locks: {
        acquire,
        release,
        extend: jest.fn(() => ({ success: true, expiresAt: Date.now() + 30000 })),
        check: jest.fn(() => ({
          success: true,
          held: true,
          owner: 'fleetd:port-daddy-stable:unknown:424242',
        })),
      },
    });

    try {
      mockLoadFleetConfig.mockReturnValue(makeConfig('reclaimed-project'));
      mockGetStatus.mockReturnValue([]);

      const daemon = makeDaemon(deps);
      expect(daemon.startProject('/test/reclaimed')).toEqual({ success: true });

      expect(release).toHaveBeenCalledWith(expect.stringMatching(/^fleet:project:/), { force: true });
      expect(acquire).toHaveBeenCalledTimes(2);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'fleet_project_stale_lease_reclaimed',
        expect.objectContaining({
          project: 'reclaimed',
          projectDir: '/test/reclaimed',
          holder: 'fleetd:port-daddy-stable:unknown:424242',
        })
      );
      expect(daemon.getStatus().fleets).toHaveLength(1);
      expect(daemon.getStatus().skipped).toHaveLength(0);
    } finally {
      killSpy.mockRestore();
    }
  });

  test('startProject() reclaims a fleet lease held by a live noncanonical daemon pid', () => {
    const originalPidFile = process.env.PORT_DADDY_PID_FILE;
    const noncanonicalPid = process.pid + 1000;
    process.env.PORT_DADDY_PID_FILE = '/runtime/daemon.pid';
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/runtime/daemon.pid') return String(process.pid);
      return '';
    });
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === noncanonicalPid && signal === 0) return true;
      return true;
    });
    const acquire = jest.fn()
      .mockReturnValueOnce({
        success: false,
        error: 'lock is held',
        holder: `fleetd:port-daddy-stable:unknown:${noncanonicalPid}`,
      })
      .mockReturnValueOnce({ success: true });
    const release = jest.fn(() => ({ success: true }));
    const deps = makeDeps({
      locks: {
        acquire,
        release,
        extend: jest.fn(() => ({ success: true, expiresAt: Date.now() + 30000 })),
        check: jest.fn(() => ({
          success: true,
          held: true,
          owner: `fleetd:port-daddy-stable:unknown:${noncanonicalPid}`,
        })),
      },
    });

    try {
      mockLoadFleetConfig.mockReturnValue(makeConfig('canonical-project'));
      mockGetStatus.mockReturnValue([]);

      const daemon = makeDaemon(deps);
      expect(daemon.startProject('/test/canonical')).toEqual({ success: true });

      expect(release).toHaveBeenCalledWith(expect.stringMatching(/^fleet:project:/), { force: true });
      expect(acquire).toHaveBeenCalledTimes(2);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'fleet_project_stale_lease_reclaimed',
        expect.objectContaining({
          project: 'canonical',
          projectDir: '/test/canonical',
          holder: `fleetd:port-daddy-stable:unknown:${noncanonicalPid}`,
          reason: 'noncanonical_daemon_pid',
          holderPid: noncanonicalPid,
          canonicalPid: process.pid,
        })
      );
      expect(daemon.getStatus().fleets).toHaveLength(1);
      expect(daemon.getStatus().skipped).toHaveLength(0);
    } finally {
      killSpy.mockRestore();
      mockReadFileSync.mockReset();
      if (originalPidFile === undefined) {
        delete process.env.PORT_DADDY_PID_FILE;
      } else {
        process.env.PORT_DADDY_PID_FILE = originalPidFile;
      }
    }
  });

  test('renewal reacquires a project lease if the lock row disappears without a new owner', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    let held = false;
    let owner = null;
    let dropOnExtend = false;
    const deps = makeDeps({
      locks: {
        acquire: jest.fn((name, options = {}) => {
          held = true;
          owner = options.owner || 'test-owner';
          return { success: true, name, owner };
        }),
        release: jest.fn(() => {
          held = false;
          return { success: true };
        }),
        extend: jest.fn(() => {
          if (dropOnExtend) {
            held = false;
            dropOnExtend = false;
            return { success: false, error: 'lock not held' };
          }
          return { success: true, expiresAt: Date.now() + 30000 };
        }),
        check: jest.fn(() => (
          held
            ? { success: true, held: true, owner }
            : { success: true, held: false }
        )),
      },
    });
    mockLoadFleetConfig.mockReturnValue(makeConfig('reacquire-project'));
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    expect(daemon.startProject('/test/reacquire')).toEqual({ success: true });

    dropOnExtend = true;
    const renewLease = setIntervalSpy.mock.calls[0]?.[0];
    expect(typeof renewLease).toBe('function');
    renewLease();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'fleet_project_lease_reacquired',
      expect.objectContaining({
        project: 'reacquire-project',
        projectDir: '/test/reacquire',
      })
    );
    expect(daemon.getStatus().fleets).toHaveLength(1);
    expect(daemon.getStatus().skipped).toHaveLength(0);
  });

  test('stop() stops all runners and clears state', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();
    expect(daemon.getStatus().running).toBe(true);

    daemon.stop();
    expect(mockStopAll).toHaveBeenCalledTimes(1);
    expect(daemon.getStatus().running).toBe(false);
    expect(daemon.getStatus().fleets).toHaveLength(0);
    expect(daemon.getStatus().skipped).toHaveLength(0);
  });

  test('stop() is idempotent', () => {
    const daemon = makeDaemon(makeDeps());
    daemon.stop(); // not started
    daemon.stop(); // double stop
    expect(mockStopAll).not.toHaveBeenCalled();
  });

  test('start() is idempotent', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();
    daemon.start(); // double start
    expect(mockStartAll).toHaveBeenCalledTimes(1);
  });

  test('reload() stops then starts', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    jest.clearAllMocks();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    daemon.reload();
    expect(mockStopAll).toHaveBeenCalledTimes(1);
    expect(mockStartAll).toHaveBeenCalledTimes(1);
  });

  test('startProject() adds a new project fleet', () => {
    const deps = makeDeps();
    const config = makeConfig('new-project');
    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    const result = daemon.startProject('/test/new-project');

    expect(result.success).toBe(true);
    expect(mockStartAll).toHaveBeenCalledTimes(1);
    expect(daemon.getStatus().fleets).toHaveLength(1);
  });

  test('startProject() rejects stable install dir fleets by default', () => {
    const deps = makeDeps();
    const daemon = makeDaemon(deps);
    const result = daemon.startProject('/Users/test/port-daddy-stable');

    expect(result.success).toBe(false);
    expect(result.error).toContain('protected from fleet writes');
    expect(mockLoadFleetConfig).not.toHaveBeenCalled();
    expect(mockStartAll).not.toHaveBeenCalled();
    expect(daemon.getStatus().skipped).toEqual([
      expect.objectContaining({
        projectDir: '/Users/test/port-daddy-stable',
        reason: expect.stringContaining('protected from fleet writes'),
      }),
    ]);
  });

  test('startProject() rejects symlinked stable install dir fleets by default', () => {
    const deps = makeDeps();
    mockRealpathSyncNative.mockImplementation((path) => {
      if (path === '/usr/local/share/port-daddy') return '/Users/test/port-daddy-stable';
      return path;
    });
    const daemon = makeDaemon(deps);
    const result = daemon.startProject('/usr/local/share/port-daddy');

    expect(result.success).toBe(false);
    expect(result.error).toContain('protected from fleet writes');
    expect(mockLoadFleetConfig).not.toHaveBeenCalled();
    expect(mockStartAll).not.toHaveBeenCalled();
    expect(daemon.getStatus().skipped).toEqual([
      expect.objectContaining({
        projectDir: '/usr/local/share/port-daddy',
        reason: expect.stringContaining('protected from fleet writes'),
      }),
    ]);
  });

  test('startProject() can persist an enabled-agent subset for a project', () => {
    const deps = makeDeps();
    const config = makeConfig('subset-project');
    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([
      { name: 'qa', type: 'triggered', status: 'armed', running: false, paused: false, uptime: 0 },
      { name: 'spark', type: 'scheduled', status: 'paused', running: false, paused: true, uptime: 0 },
    ]);

    const daemon = makeDaemon(deps);
    const result = daemon.startProject('/test/subset', { enabledAgents: ['qa'] });

    expect(result.success).toBe(true);
    expect(mockCreateFleetRunner).toHaveBeenCalledWith(
      config,
      '/test/subset',
      expect.objectContaining({ initiallyPausedAgents: ['spark'] })
    );
  });

  test('getStatus() exposes launchability and warns when a fleet has blocked backends', () => {
    const deps = makeDeps();
    const config = {
      name: 'launch-project',
      agents: [
        {
          name: 'cartographer',
          backend: 'claude',
          model: 'claude-haiku-4-5-20251001',
          prompt: 'Map the repo',
          trigger: 'git:committed',
        },
        {
          // Use a model with no exact rate so the policy still blocks it,
          // exercising the partial-launchable code path. Known ollama
          // family models (qwen, llama, etc.) are now policy-allowed.
          name: 'local-dreamer',
          backend: 'ollama',
          model: 'unobtanium-7b',
          prompt: 'Generate local ideas',
          schedule: '*/30 * * * *',
        },
      ],
      watchers: [],
      channels: {},
    };

    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([
      { name: 'cartographer', type: 'triggered', status: 'armed', running: false, paused: false, uptime: 0 },
      { name: 'local-dreamer', type: 'scheduled', status: 'armed', running: false, paused: false, uptime: 0 },
    ]);

    const daemon = makeDaemon(deps);
    expect(daemon.startProject('/test/launch-project')).toEqual({ success: true });

    const status = daemon.getStatus();
    expect(status.totalAgents).toBe(2);
    expect(status.totalLaunchableAgents).toBe(1);
    expect(status.fleets[0]).toEqual(expect.objectContaining({
      launchableAgents: 1,
      blockedAgents: [
        expect.objectContaining({
          agent: 'local-dreamer',
          backend: 'ollama',
          reason: expect.stringContaining('no exact cost rate entry'),
        }),
      ],
    }));
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'fleet_partial_launchable',
      expect.objectContaining({
        project: 'launch-project',
        launchable: 1,
        total: 2,
      }),
    );
  });

  test('startProject() rejects if already running', () => {
    const deps = makeDeps();
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.startProject('/test/project');
    const result = daemon.startProject('/test/project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');
  });

  test('hailAgent() resolves a fleet agent by project and forwards context', async () => {
    const deps = makeDeps();
    const config = makeConfig('port-daddy-dev');
    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.startProject('/test/project');

    const result = await daemon.hailAgent('qa', {
      project: 'port-daddy-dev',
      source: 'inbox',
      from: 'fleet-ui',
      messageContent: 'wake up',
    });

    expect(result.success).toBe(true);
    expect(mockHailAgent).toHaveBeenCalledWith('qa', expect.objectContaining({
      source: 'inbox',
      from: 'fleet-ui',
      messageContent: 'wake up',
    }));
  });

  test('hailAgent() rejects ambiguous names across fleets', async () => {
    const deps = makeDeps();
    mockLoadFleetConfig
      .mockReturnValueOnce(makeConfig('alpha'))
      .mockReturnValueOnce(makeConfig('beta'));
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.startProject('/test/alpha');
    daemon.startProject('/test/beta');

    const result = await daemon.hailAgent('qa', { source: 'inbox', messageContent: 'wake up' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ambiguous/);
  });

  test('pauseAgent() and resumeAgent() forward through the managed fleet runner', () => {
    const deps = makeDeps();
    mockLoadFleetConfig.mockReturnValue(makeConfig('port-daddy-dev'));
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.startProject('/test/project');

    expect(daemon.pauseAgent('qa', 'port-daddy-dev')).toEqual({
      success: true,
      project: 'port-daddy-dev',
      agent: 'qa',
    });
    expect(mockPauseAgent).toHaveBeenCalledWith('qa');

    expect(daemon.resumeAgent('qa', 'port-daddy-dev')).toEqual({
      success: true,
      project: 'port-daddy-dev',
      agent: 'qa',
    });
    expect(mockResumeAgent).toHaveBeenCalledWith('qa');
  });

  test('startProject() rejects if no pd-fleet.yml', () => {
    const deps = makeDeps();
    mockLoadFleetConfig.mockReturnValue(null);

    const daemon = makeDaemon(deps);
    const result = daemon.startProject('/test/empty');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No pd-fleet.yml');
  });

  test('stopProject() removes a specific project fleet', () => {
    const deps = makeDeps();
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.startProject('/test/project');
    expect(daemon.getStatus().fleets).toHaveLength(1);

    const result = daemon.stopProject('/test/project');
    expect(result.success).toBe(true);
    expect(mockStopAll).toHaveBeenCalledTimes(1);
    expect(daemon.getStatus().fleets).toHaveLength(0);
  });

  test('stopProject() rejects if not running', () => {
    const daemon = makeDaemon(makeDeps());
    const result = daemon.stopProject('/test/nonexistent');
    expect(result.success).toBe(false);
  });

  test('listProjects() returns managed project dirs', () => {
    const deps = makeDeps();
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    mockLoadFleetConfig.mockReturnValue(makeConfig('project-a'));
    daemon.startProject('/test/a');
    mockLoadFleetConfig.mockReturnValue(makeConfig('project-b'));
    daemon.startProject('/test/b');

    expect(daemon.listProjects()).toEqual(['/test/a', '/test/b']);
  });
});

describe('event publishing', () => {
  test('onEvent callback publishes to identity channel and fleet:events', () => {
    const deps = makeDeps();
    const config = makeConfig();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(config);
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    // Extract the onEvent callback that was passed to createFleetRunner
    const onEvent = mockCreateFleetRunner.mock.calls[0][2]?.onEvent;
    expect(onEvent).toBeDefined();

    // Simulate an agent_started event
    onEvent({
      type: 'agent_started',
      agent: 'qa',
      identity: 'port-daddy:fleet:qa',
      project: 'port-daddy',
      timestamp: 1000,
      details: { backend: 'claude-cli' },
    });

    // Should publish to identity channel
    expect(deps.messaging.publish).toHaveBeenCalledWith(
      'port-daddy:fleet:qa',
      expect.objectContaining({
        type: 'agent_started',
        agent: 'qa',
        project: 'port-daddy',
      })
    );

    // Should also publish to fleet:events channel
    expect(deps.messaging.publish).toHaveBeenCalledWith(
      'fleet:events',
      expect.objectContaining({
        type: 'agent_started',
        identity: 'port-daddy:fleet:qa',
      })
    );

    expect(deps.tuples.out).toHaveBeenCalledWith(
      expect.arrayContaining([
        'fleet:event',
        'agent_started',
        'port-daddy',
        'qa',
      ]),
      expect.objectContaining({
        harbor: 'port-daddy:fleet',
      }),
    );
  });

  test('agent_failed events are logged at warn level', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    const onEvent = mockCreateFleetRunner.mock.calls[0][2]?.onEvent;
    onEvent({
      type: 'agent_failed',
      agent: 'qa',
      identity: 'port-daddy:fleet:qa',
      project: 'port-daddy',
      timestamp: 1000,
      details: { error: 'spawn failed' },
    });

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'fleet_agent_failed',
      expect.objectContaining({ agent: 'qa', error: 'spawn failed' })
    );
  });
});

describe('topology validation', () => {
  test('logs warning for invalid topology but still starts', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockValidateTopology.mockReturnValue({
      valid: false,
      cycles: [['a', 'b', 'a']],
      warnings: ['orphan channel: stale'],
    });
    mockGetStatus.mockReturnValue([]);

    const daemon = makeDaemon(deps);
    daemon.start();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'fleet_topology_invalid',
      expect.objectContaining({ cycles: [['a', 'b', 'a']] })
    );
    // Still starts despite invalid topology
    expect(mockStartAll).toHaveBeenCalledTimes(1);
  });
});

describe('env loading', () => {
  test('does not overwrite existing env vars', () => {
    const deps = makeDeps();
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'existing-key';

    // Simulate .env.local with a different key
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('.env.local')) {
        return 'ANTHROPIC_API_KEY=should-not-overwrite\nNEW_VAR=new-value';
      }
      return '';
    });
    mockLoadFleetConfig.mockReturnValue(null);

    const daemon = makeDaemon(deps);
    daemon.start();

    // Existing key preserved
    expect(process.env.ANTHROPIC_API_KEY).toBe('existing-key');
    // New key loaded
    expect(process.env.NEW_VAR).toBe('new-value');

    // Cleanup
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    delete process.env.NEW_VAR;
  });
});

describe('error resilience', () => {
  test('handles project scan failure gracefully', () => {
    const deps = makeDeps({
      projects: {
        list: jest.fn(() => { throw new Error('DB locked'); }),
      },
    });
    mockExistsSync.mockReturnValue(false);

    const daemon = makeDaemon(deps);
    daemon.start(); // should not throw

    expect(deps.logger.error).toHaveBeenCalledWith(
      'fleet_project_scan_failed',
      expect.objectContaining({ error: 'DB locked' })
    );
    expect(daemon.getStatus().running).toBe(true);
  });

  test('handles fleet runner stopAll failure gracefully', () => {
    const deps = makeDeps();
    mockExistsSync.mockImplementation((path) =>
      path === join('/test/daemon', 'pd-fleet.yml')
    );
    mockLoadFleetConfig.mockReturnValue(makeConfig());
    mockGetStatus.mockReturnValue([]);
    mockStopAll.mockImplementation(() => { throw new Error('kill ESRCH'); });

    const daemon = makeDaemon(deps);
    daemon.start();
    daemon.stop(); // should not throw despite stopAll failure

    expect(deps.logger.error).toHaveBeenCalledWith(
      'fleet_stop_failed',
      expect.objectContaining({ error: 'kill ESRCH' })
    );
  });
});
