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

const mockFsWatch = jest.fn(() => ({ close: jest.fn() }));

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
  watch: mockFsWatch,
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
}));

// ─── Import after mocks ────────────────────────────────────────────────────

const { createFleetDaemon } = await import('../../lib/fleet-daemon.js');
const { projectScopedGitChannel } = await import('../../lib/fleet-channels.js');
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

async function flushMicrotasks(count = 5) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
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

  test('start() discovers registered project fleets', () => {
    const deps = makeDeps({
      projects: {
        list: jest.fn(() => [
          { id: 'bosun', root: '/test/bosun', tags: null },
          { id: 'jbuds', root: '/test/jbuds', tags: ['web'] },
        ]),
      },
    });

    const bosunConfig = makeConfig('bosun');
    const jbudsConfig = makeConfig('jbuds');

    mockExistsSync.mockImplementation((path) => {
      return path === join('/test/bosun', 'pd-fleet.yml') ||
             path === join('/test/jbuds', 'pd-fleet.yml');
    });

    mockLoadFleetConfig.mockImplementation((dir) => {
      if (dir === '/test/bosun') return bosunConfig;
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

  test('startProject() refreshes symbols from project-scoped git commit payloads', async () => {
    jest.useFakeTimers();
    try {
      const symbolIndex = {
        parseFile: jest.fn(() => ({ filePath: '', symbols: 1, dependencies: 0, skipped: false })),
      };
      const deps = makeDeps({ symbolIndex });
      const config = makeConfig('symbols-project');
      mockLoadFleetConfig.mockReturnValue(config);
      mockGetStatus.mockReturnValue([]);

      const daemon = makeDaemon(deps);
      expect(daemon.startProject('/test/symbols')).toEqual({ success: true });

      const hookChannel = projectScopedGitChannel('/test/symbols');
      const fleetChannel = projectScopedGitChannel('/test/symbols', 'symbols-project');
      const subscription = deps.messaging.subscribe.mock.calls.find((call) => call[0] === hookChannel);
      expect(deps.messaging.subscribe).toHaveBeenCalledWith(fleetChannel, expect.any(Function));
      expect(subscription).toBeDefined();

      subscription[1]({
        id: 1,
        channel: hookChannel,
        payload: {
          files: 'src/a.ts, README.md, lib/b.py, node_modules/pkg/index.ts, ../outside.ts',
        },
        contentType: 'json',
      });

      await jest.advanceTimersByTimeAsync(500);
      await flushMicrotasks();

      expect(symbolIndex.parseFile).toHaveBeenCalledWith(join('/test/symbols', 'src/a.ts'));
      expect(symbolIndex.parseFile).toHaveBeenCalledWith(join('/test/symbols', 'lib/b.py'));
      expect(symbolIndex.parseFile).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('startProject() refreshes symbols from source file watcher events', async () => {
    jest.useFakeTimers();
    try {
      const symbolIndex = {
        parseFile: jest.fn(() => ({ filePath: '', symbols: 1, dependencies: 0, skipped: false })),
      };
      const deps = makeDeps({ symbolIndex });
      mockLoadFleetConfig.mockReturnValue(makeConfig('watch-project'));
      mockGetStatus.mockReturnValue([]);

      const daemon = makeDaemon(deps);
      expect(daemon.startProject('/test/watch')).toEqual({ success: true });

      const sourceWatch = mockFsWatch.mock.calls.find((call) => call[0] === '/test/watch');
      expect(sourceWatch).toBeDefined();

      sourceWatch[2]('change', 'src/changed.ts');
      sourceWatch[2]('change', 'dist/generated.ts');

      await jest.advanceTimersByTimeAsync(500);
      await flushMicrotasks();

      expect(symbolIndex.parseFile).toHaveBeenCalledWith(join('/test/watch', 'src/changed.ts'));
      expect(symbolIndex.parseFile).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
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
