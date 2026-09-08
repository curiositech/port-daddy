import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mockSpawn = jest.fn(() => ({
  unref: jest.fn(),
}));
const mockSpawnSync = jest.fn(() => ({
  status: 1,
  stdout: '',
  stderr: '',
}));
const mockExecSync = jest.fn(() => '');
const immediateExecFile = (_cmd, _args, options, callback) => {
  const done = typeof options === 'function' ? options : callback;
  if (typeof done === 'function') done(null, '', '');
};
const mockExecFile = jest.fn(immediateExecFile);

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
  execSync: mockExecSync,
  execFileSync: jest.fn(),
  // lib/fleet/outputs/notify-macos.ts (transitively imported via fleet-engine)
  // uses execFile for macOS notification delivery.
  execFile: mockExecFile,
}));

const { operatorPlugin, __resetGuardCachesForTest } = await import('../../routes/operator.js');

function buildApp(deps = {}) {
  const app = Fastify();
  return {
    app,
    register: () => app.register(operatorPlugin, {
      deps: {
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
        ...deps,
      },
    }),
  };
}

function expectedCommandFor(mode, filePath) {
  if (process.platform === 'darwin') {
    return mode === 'finder'
      ? ['open', ['-R', filePath]]
      : ['open', [filePath]];
  }
  if (process.platform === 'win32') {
    return mode === 'finder'
      ? ['explorer', ['/select,', filePath]]
      : ['cmd', ['/c', 'start', '', filePath]];
  }
  return mode === 'finder'
    ? ['xdg-open', [path.dirname(filePath)]]
    : ['xdg-open', [filePath]];
}

describe('operator routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFile.mockImplementation(immediateExecFile);
    // The /operator/state guard status/check caches are module-level and keyed
    // by project dir (defaults to process.cwd()); reset them so each test's
    // stubbed guard CLI result isn't masked by a prior test's cached value.
    __resetGuardCachesForTest();
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
    });
  });

  test('GET /operator/session-directory returns the daemon-authored cross-berth projection', async () => {
    const directory = {
      schema: 'pd.operator.session-directory.v0',
      generatedAt: 1_777_777_777_777,
      sessions: [{
        id: 'session-shared',
        purpose: 'Continue one conversation across berths',
        status: 'active',
        locations: [
          { id: 'stable', state: 'online' },
          { id: 'profile:feature-a', state: 'online' },
        ],
      }],
      locations: [],
      summary: {
        sessions: 1,
        active: 1,
        onlineLocations: 2,
        offlineLocations: 0,
        unknownProviders: 1,
      },
    };
    const sessionDirectory = jest.fn(async () => directory);
    const { app, register } = buildApp({ sessionDirectory });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/session-directory',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(directory);
    expect(sessionDirectory).toHaveBeenCalledTimes(1);
    await app.close();
  });

  test('POST /operator/open-file opens a relative file in the default editor', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    const res = await app.inject({
      method: 'POST',
      url: '/operator/open-file',
      payload: {
        path: 'package.json',
        projectDir,
        mode: 'editor',
      },
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    const resolvedPath = path.resolve(projectDir, 'package.json');
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      mode: 'editor',
      path: resolvedPath,
    }));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [expectedCommand, expectedArgs] = expectedCommandFor('editor', resolvedPath);
    expect(mockSpawn).toHaveBeenCalledWith(expectedCommand, expectedArgs, expect.objectContaining({
      detached: true,
      stdio: 'ignore',
    }));

    await app.close();
  });

  test('POST /operator/open-file reveals a file in Finder/explorer', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    const res = await app.inject({
      method: 'POST',
      url: '/operator/open-file',
      payload: {
        path: 'package.json',
        projectDir,
        mode: 'finder',
      },
    });

    expect(res.statusCode).toBe(200);
    const resolvedPath = path.resolve(projectDir, 'package.json');
    const [expectedCommand, expectedArgs] = expectedCommandFor('finder', resolvedPath);
    expect(mockSpawn).toHaveBeenCalledWith(expectedCommand, expectedArgs, expect.objectContaining({
      detached: true,
      stdio: 'ignore',
    }));

    await app.close();
  });

  test('POST /operator/open-file rejects empty paths', async () => {
    const { app, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/operator/open-file',
      payload: {
        mode: 'editor',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      error: 'A file path is required.',
    }));
    expect(mockSpawn).not.toHaveBeenCalled();

    await app.close();
  });

  test('POST /operator/file-preview returns a snapshot preview for a real file', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    const res = await app.inject({
      method: 'POST',
      url: '/operator/file-preview',
      payload: {
        path: 'package.json',
        projectDir,
        maxLines: 8,
      },
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    const resolvedPath = path.resolve(projectDir, 'package.json');
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      preview: expect.objectContaining({
        requestedPath: 'package.json',
        resolvedPath,
        source: 'snapshot',
        lines: expect.any(Array),
      }),
    }));
    expect(payload.preview.lines.length).toBeGreaterThan(0);
    expect(payload.preview.lines[0]).toEqual(expect.objectContaining({
      kind: 'context',
    }));
    expect(mockSpawnSync).toHaveBeenCalled();

    await app.close();
  });

  test('POST /operator/files-exist reports per-path existence, false for model ids', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    const res = await app.inject({
      method: 'POST',
      url: '/operator/files-exist',
      payload: {
        paths: ['package.json', 'ollama/qwen2.5-coder'],
        projectDir,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      results: {
        'package.json': true,
        'ollama/qwen2.5-coder': false,
      },
    });

    await app.close();
  });

  test('POST /operator/files-exist rejects empty payloads', async () => {
    const { app, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/operator/files-exist',
      payload: { paths: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      error: 'At least one file path is required.',
    }));

    await app.close();
  });

  test('GET /operator/coordination-guard returns guard status for a project', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        success: true,
        name: 'Coordination Guard',
        enabled: true,
        mode: 'enforce',
        requireSession: true,
        requireClaims: true,
        configPath: path.join(projectDir, '.portdaddy/coordination-guard.json'),
      }),
      stderr: '',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/operator/coordination-guard?projectDir=${encodeURIComponent(projectDir)}`,
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      projectDir,
      status: expect.objectContaining({
        mode: 'enforce',
        projectDir,
      }),
    }));
    // Command may be a bare 'pd'/'port-daddy' or an absolute path ending in
    // either binary name, depending on environment — accept all of them.
    expect(mockSpawnSync).toHaveBeenCalledWith(expect.stringMatching(/(^|\/)(pd|port-daddy)$/), [
      'guard',
      'status',
      '--json',
      '--dir',
      projectDir,
    ], expect.objectContaining({
      cwd: projectDir,
      encoding: 'utf8',
    }));

    await app.close();
  });

  test('POST /operator/coordination-guard returns blocking staged check results without HTTP failure', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    mockSpawnSync
      .mockReturnValueOnce({
        status: 1,
        stdout: JSON.stringify({
          success: false,
          passed: false,
          shouldBlock: true,
          mode: 'enforce',
          enabled: true,
          files: ['routes/operator.ts'],
          agentId: 'agent-1',
          sessionId: 'session-1',
          violations: [{
            code: 'unclaimed-file',
            severity: 'critical',
            file: 'routes/operator.ts',
            message: 'routes/operator.ts is not claimed by the active Port Daddy session.',
          }],
        }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          success: true,
          name: 'Coordination Guard',
          enabled: true,
          mode: 'enforce',
          requireSession: true,
          requireClaims: true,
          configPath: path.join(projectDir, '.portdaddy/coordination-guard.json'),
        }),
        stderr: '',
      });

    const res = await app.inject({
      method: 'POST',
      url: '/operator/coordination-guard',
      payload: {
        action: 'check',
        projectDir,
        mode: 'enforce',
      },
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.check).toEqual(expect.objectContaining({
      shouldBlock: true,
      violations: [expect.objectContaining({ code: 'unclaimed-file' })],
    }));
    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, expect.stringMatching(/(^|\/)(pd|port-daddy)$/), [
      'guard',
      'check',
      '--staged',
      '--mode',
      'enforce',
      '--json',
      '--dir',
      projectDir,
    ], expect.objectContaining({ cwd: projectDir }));

    await app.close();
  });

  test('POST /operator/coordination-guard can install enforce mode and refresh status', async () => {
    const { app, register } = buildApp();
    await register();

    const projectDir = process.cwd();
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: 'Coordination Guard installed\n',
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          success: true,
          name: 'Coordination Guard',
          enabled: true,
          mode: 'enforce',
          requireSession: true,
          requireClaims: true,
          configPath: path.join(projectDir, '.portdaddy/coordination-guard.json'),
        }),
        stderr: '',
      });

    const res = await app.inject({
      method: 'POST',
      url: '/operator/coordination-guard',
      payload: {
        action: 'install',
        projectDir,
        mode: 'enforce',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      action: 'install',
      status: expect.objectContaining({ mode: 'enforce' }),
    }));
    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, expect.stringMatching(/(^|\/)(pd|port-daddy)$/), [
      'guard',
      'install',
      '--mode',
      'enforce',
      '--dir',
      projectDir,
    ], expect.objectContaining({ cwd: projectDir }));

    await app.close();
  });

  test('GET /operator/actors does not call orphaned active sessions running', async () => {
    const now = Date.now();
    const { app, register } = buildApp({
      agents: {
        list: jest.fn(() => ({ agents: [] })),
      },
      sessions: {
        list: jest.fn(() => ({
          sessions: [{
            id: 'session-orphan',
            purpose: 'Fleet agent: spark',
            status: 'active',
            agentId: 'missing-agent',
            updatedAt: now,
            notes: [],
          }],
        })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: {
        list: jest.fn(() => ({ agents: [] })),
      },
      spawner: {
        list: jest.fn(() => []),
      },
      activityLog: {
        getRecent: jest.fn(() => ({ entries: [] })),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/actors?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.actors).toHaveLength(1);
    expect(payload.actors[0]).toEqual(expect.objectContaining({
      id: 'spark',
      actorState: 'orphan_reconciled',
    }));

    await app.close();
  });

  test('GET /operator/actors includes configured actor-only rows and canonical project id', async () => {
    const projectDir = mkdtempSync(path.join(process.cwd(), 'tmp-pd-actor-project-'));
    writeFileSync(path.join(projectDir, 'pd-fleet.yml'), [
      'fleet:',
      '  name: demo',
      '  agents:',
      '    spark:',
      '      backend: custom',
      '      prompt: Runs tests and finds uncovered code paths. Ignore this second sentence.',
      '',
    ].join('\n'));

    const { app, register } = buildApp({
      projects: {
        getByPath: jest.fn(() => ({ id: 'canonical-project', root: projectDir })),
      },
      agents: {
        list: jest.fn(() => ({ agents: [] })),
      },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: {
        list: jest.fn(() => ({ agents: [] })),
      },
      spawner: {
        list: jest.fn(() => []),
      },
      activityLog: {
        getRecent: jest.fn(() => ({ entries: [] })),
      },
    });

    try {
      await register();

      const res = await app.inject({
        method: 'GET',
        url: `/operator/actors?projectDir=${encodeURIComponent(projectDir)}`,
      });

      expect(res.statusCode).toBe(200);
      const payload = res.json();
      expect(payload.project).toBe('canonical-project');
      expect(payload.projectDir).toBe(projectDir);
      expect(payload.actors).toEqual([
        expect.objectContaining({
          id: 'spark',
          inboxTarget: 'spark',
          isConfiguredFleetAgent: true,
          purpose: 'Runs tests and finds uncovered code paths.',
          actorState: 'idle',
        }),
      ]);
    } finally {
      await app.close();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('GET /operator/actors does not prune configured fleet names behind historical sessions', async () => {
    const now = Date.now();
    const projectDir = mkdtempSync(path.join(process.cwd(), 'tmp-pd-actor-priority-'));
    writeFileSync(path.join(projectDir, 'pd-fleet.yml'), [
      'fleet:',
      '  name: demo',
      '  agents:',
      '    spark:',
      '      backend: custom',
      '      prompt: echo spark',
      '    spider:',
      '      backend: custom',
      '      prompt: echo spider',
      '',
    ].join('\n'));

    const { app, register } = buildApp({
      projects: {
        getByPath: jest.fn(() => ({ id: 'demo', root: projectDir })),
      },
      agents: {
        list: jest.fn(() => ({ agents: [] })),
      },
      sessions: {
        list: jest.fn(() => ({
          sessions: Array.from({ length: 12 }, (_, index) => ({
            id: `session-noisy-${index}`,
            purpose: `Historical ad hoc session ${index}`,
            status: 'completed',
            agentId: `agent-noisy-${index}`,
            updatedAt: now - index,
            notes: [],
          })),
        })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: {
        list: jest.fn(() => ({ agents: [] })),
      },
      spawner: {
        list: jest.fn(() => []),
      },
      activityLog: {
        getRecent: jest.fn(() => ({ entries: [] })),
      },
    });

    try {
      await register();

      const res = await app.inject({
        method: 'GET',
        url: `/operator/actors?projectDir=${encodeURIComponent(projectDir)}&limit=3`,
      });

      expect(res.statusCode).toBe(200);
      const payload = res.json();
      expect(payload.actors.map((actor) => actor.label)).toEqual([
        'spark',
        'spider',
        'agent-noisy-0',
      ]);
      expect(payload.actors[0]).toEqual(expect.objectContaining({
        inboxTarget: 'spark',
        isConfiguredFleetAgent: true,
        actorState: 'idle',
      }));
    } finally {
      await app.close();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('GET /operator/actors filters prose slash phrases out of recent files', async () => {
    const now = Date.now();
    const { app, register } = buildApp({
      agents: {
        list: jest.fn(() => ({ agents: [] })),
      },
      sessions: {
        list: jest.fn(() => ({
          sessions: [{
            id: 'session-files',
            purpose: 'Fleet agent: spark',
            status: 'active',
            agentId: 'missing-agent',
            updatedAt: now,
            notes: [{
              createdAt: now,
              content: 'Worked on FleetBar/control-plane and touched routes/operator.ts',
            }],
          }],
        })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: {
        list: jest.fn(() => ({ agents: [] })),
      },
      spawner: {
        list: jest.fn(() => []),
      },
      activityLog: {
        getRecent: jest.fn(() => ({ entries: [] })),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/actors?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.actors[0].recentFiles).toContain('routes/operator.ts');
    expect(payload.actors[0].recentFiles).not.toContain('FleetBar/control-plane');

    await app.close();
  });

  // ── /operator/state tests ────────────────────────────────────────────────────

  test('GET /operator/state returns success with actors and needsYou when all deps absent', async () => {
    // With no optional deps (costTracker, dispatchQueue, roadmapItems, bonds),
    // the route should still return 200 with a minimal but valid shape.
    const { app, register } = buildApp({
      agents: {
        list: jest.fn(() => ({ agents: [] })),
      },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: {
        list: jest.fn(() => ({ agents: [] })),
      },
      spawner: {
        list: jest.fn(() => []),
      },
      activityLog: {
        getRecent: jest.fn(() => ({ entries: [] })),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.success).toBe(true);
    expect(payload.actors).toEqual(expect.objectContaining({
      actors: expect.any(Array),
      summary: expect.objectContaining({ running: expect.any(Number) }),
      count: expect.any(Number),
    }));
    expect(payload.needsYou).toEqual(expect.any(Array));
    expect(payload.guard).toBeTruthy();
    expect(payload.generatedAt).toBeGreaterThan(0);
    // Optional sources omitted when empty
    expect(payload.dispatch).toBeUndefined();
    expect(payload.budget).toBeUndefined();
    expect(payload.cockpitMissions).toBeUndefined();
    expect(payload.roadmap).toBeUndefined();

    await app.close();
  });

  test('GET /operator/state never waits for slow Guard children and refreshes in the background', async () => {
    const pending = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    mockExecFile.mockImplementation((command, args, options, callback) => {
      pending.push({ command, args, options, callback });
      return {};
    });

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
    });
    await register();

    // The child callback remains unresolved, proving the response cannot be
    // waiting on Guard startup, output, timeout, or process exit.
    const cold = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(cold.statusCode).toBe(200);
    expect(cold.json().guard).toEqual(expect.objectContaining({
      available: false,
      refreshing: true,
      stale: false,
    }));
    expect(pending).toHaveLength(1);
    expect(pending[0].args.slice(0, 2)).toEqual(['guard', 'status']);
    expect(mockSpawnSync.mock.calls.filter(([, args]) => args?.[0] === 'guard')).toHaveLength(0);

    // Concurrent polling shares the same in-flight refresh instead of spawning
    // another child for every FleetBar/console request.
    const concurrentCold = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(concurrentCold.statusCode).toBe(200);
    expect(pending).toHaveLength(1);

    pending.shift().callback(null, JSON.stringify({
      success: true,
      name: 'Coordination Guard',
      enabled: true,
      mode: 'enforce',
      requireSession: true,
      requireClaims: true,
      configPath: '/project/.portdaddy/coordination-guard.json',
    }), '');
    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    const statusReady = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(statusReady.statusCode).toBe(200);
    expect(statusReady.json().guard).toEqual(expect.objectContaining({
      available: true,
      mode: 'enforce',
      refreshing: false,
    }));
    expect(pending).toHaveLength(1);
    expect(pending[0].args.slice(0, 3)).toEqual(['guard', 'check', '--staged']);

    pending.shift().callback(Object.assign(new Error('guard violations'), {
      code: 1,
      killed: false,
    }), JSON.stringify({
      success: false,
      passed: false,
      shouldBlock: true,
      mode: 'enforce',
      enabled: true,
      files: ['routes/operator.ts'],
      agentId: 'agent-x',
      sessionId: 'session-x',
      violations: [{
        code: 'unclaimed-file',
        severity: 'critical',
        file: 'routes/operator.ts',
        message: 'routes/operator.ts is unclaimed',
      }],
    }), '');
    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    const checkReady = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(checkReady.statusCode).toBe(200);
    expect(checkReady.json().needsYou).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'guard_violation' }),
    ]));

    // Once the TTL expires, serve the known enforcing state and violation while
    // one status + one check refresh happen in the background. A second poll
    // still shares those same children.
    nowSpy.mockReturnValue(7_001);
    const stale = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().guard).toEqual(expect.objectContaining({
      available: true,
      refreshing: true,
      stale: true,
    }));
    expect(stale.json().needsYou).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'guard_violation' }),
    ]));
    expect(pending).toHaveLength(2);

    const concurrentStale = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(concurrentStale.statusCode).toBe(200);
    expect(pending).toHaveLength(2);

    const statusRefresh = pending.find((entry) => entry.args[1] === 'status');
    const checkRefresh = pending.find((entry) => entry.args[1] === 'check');
    statusRefresh.callback(null, JSON.stringify({
      success: true,
      name: 'Coordination Guard',
      enabled: false,
      mode: 'off',
      requireSession: false,
      requireClaims: false,
      configPath: '/project/.portdaddy/coordination-guard.json',
    }), '');
    checkRefresh.callback(null, '', '');
    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    const converged = await app.inject({ method: 'GET', url: '/operator/state' });
    expect(converged.statusCode).toBe(200);
    expect(converged.json().guard).toEqual(expect.objectContaining({
      available: true,
      mode: 'off',
      refreshing: false,
      stale: false,
    }));
    expect(converged.json().needsYou).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'guard_violation' }),
    ]));

    nowSpy.mockRestore();
    await app.close();
  });

  test('GET /operator/state includes dispatch section when review_pending items exist', async () => {
    const now = Date.now();
    const mockDispatch = {
      id: 'dispatch-1',
      slug: 'add-feature',
      goal: 'Add the feature',
      tags: [],
      state: 'review_pending',
      requestedBy: 'operator',
      targetActorId: null,
      workerActorId: 'agent-1',
      reviewerActorId: 'operator',
      baseBranch: 'main',
      backend: 'cli:claude-code',
      budgetUsd: null,
      timeoutMs: null,
      worktreePath: null,
      branch: 'feat/add-feature',
      sessionId: 'session-1',
      resultArtifact: 'https://github.com/org/repo/pull/42',
      costUsd: null,
      durationMs: null,
      errorMessage: null,
      mergePolicy: 'review',
      rejectReason: null,
      createdAt: now - 3600000,
      claimedAt: now - 1800000,
      startedAt: now - 1800000,
      producedAt: now - 60000,
      reviewedAt: null,
      settledAt: null,
    };

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
      dispatchQueue: {
        list: jest.fn((opts = {}) => {
          if (opts.state === 'awaiting_review' || opts.state === 'review_pending') return [mockDispatch];
          if (opts.state === 'open') return [];
          return [];
        }),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.dispatch).toBeDefined();
    expect(payload.dispatch.reviewPending).toHaveLength(1);
    expect(payload.dispatch.reviewPending[0].id).toBe('dispatch-1');

    await app.close();
  });

  test('GET /operator/state includes budget section when recent cost events exist', async () => {
    const now = Date.now();
    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
      costTracker: {
        recent: jest.fn(() => ([{
          id: 'evt-1',
          ts: now - 1000,
          backend: 'cli:claude-code',
          model: 'claude-sonnet-4-6',
          projectName: 'port-daddy',
          projectDir: null,
          identity: null,
          spawnId: null,
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 50,
          costUsd: 0.001,
          isEstimate: false,
        }])),
        total: jest.fn(() => ({ totalUsd: 0.001, events: 1 })),
        budgetStatus: jest.fn(() => ({
          project: 'port-daddy',
          budgetUsdPerDay: 5.0,
          spentUsd: 0.001,
          remainingUsd: 4.999,
          percentUsed: 0.02,
          overBudget: false,
        })),
      },
      bonds: {
        getBudget: jest.fn(() => 5.0),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.budget).toBeDefined();
    expect(payload.budget.recentEvents).toHaveLength(1);
    expect(payload.budget.total).toBeDefined();

    await app.close();
  });

  test('GET /operator/state needsYou ranks dispatch_review before salvage', async () => {
    const now = Date.now();
    const mockDispatch = {
      id: 'dispatch-1', slug: 'add-feature', goal: 'Add feature', tags: [],
      state: 'review_pending', requestedBy: 'operator', targetActorId: null,
      workerActorId: 'agent-1', reviewerActorId: 'operator', baseBranch: 'main',
      backend: 'cli:claude-code', budgetUsd: null, timeoutMs: null,
      worktreePath: null, branch: 'feat/add', sessionId: 'session-1',
      resultArtifact: null, costUsd: null, durationMs: null, errorMessage: null,
      mergePolicy: 'review', rejectReason: null, createdAt: now - 3600000,
      claimedAt: now - 1800000, startedAt: now - 1800000, producedAt: now - 60000,
      reviewedAt: null, settledAt: null,
    };
    const mockSalvageAgent = {
      id: 'agent-dead-1', name: 'spark', purpose: 'Fleet agent: spark',
      identityProject: 'port-daddy', identityStack: 'fleet', identityContext: 'spark',
      status: 'stale', staleSince: now - 3600000,
    };

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [mockSalvageAgent] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
      dispatchQueue: {
        list: jest.fn((opts = {}) => {
          if (opts.state === 'awaiting_review') return [mockDispatch];
          return [];
        }),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    const needsYou = payload.needsYou;
    expect(needsYou).toBeInstanceOf(Array);
    expect(needsYou.length).toBeGreaterThanOrEqual(2);

    const dispatchIdx = needsYou.findIndex((n) => n.code === 'dispatch_review');
    const salvageIdx = needsYou.findIndex((n) => n.code === 'salvage');
    expect(dispatchIdx).toBeGreaterThanOrEqual(0);
    expect(salvageIdx).toBeGreaterThanOrEqual(0);
    // dispatch_review (priority 0) must appear before salvage (priority 3)
    expect(dispatchIdx).toBeLessThan(salvageIdx);

    // Each item must have the required fields
    for (const item of needsYou) {
      expect(item).toEqual(expect.objectContaining({
        code: expect.any(String),
        label: expect.any(String),
        action: expect.any(String),
        priority: expect.any(Number),
      }));
    }

    await app.close();
  });

  test('GET /operator/state needsYou surfaces budget_ceiling when project is over budget', async () => {
    const now = Date.now();
    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
      costTracker: {
        recent: jest.fn(() => ([{
          id: 'evt-1', ts: now - 100, backend: 'cli:claude-code', model: 'claude-sonnet-4-6',
          projectName: 'port-daddy', projectDir: null, identity: null, spawnId: null,
          inputTokens: 1000000, cachedInputTokens: 0, outputTokens: 500000,
          costUsd: 10.0, isEstimate: false,
        }])),
        total: jest.fn(() => ({ totalUsd: 10.0, events: 1 })),
        budgetStatus: jest.fn(() => ({
          project: 'port-daddy',
          budgetUsdPerDay: 5.0,
          spentUsd: 10.0,
          remainingUsd: 0,
          percentUsed: 200,
          overBudget: true,
        })),
      },
      bonds: {
        getBudget: jest.fn(() => 5.0),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const { needsYou } = res.json();
    const budgetItem = needsYou.find((n) => n.code === 'budget_ceiling');
    expect(budgetItem).toBeDefined();
    expect(budgetItem.label).toMatch(/over budget/);
    expect(budgetItem.meta.overBudget).toBe(true);
    expect(budgetItem.priority).toBe(2);

    await app.close();
  });

  test('GET /operator/state needsYou surfaces stuck_agent when liveness is dead', async () => {
    const now = Date.now();
    const deadAgent = {
      id: 'agent-dead',
      name: 'zombie-agent',
      identity: 'port-daddy:fleet:zombie',
      identityProject: 'port-daddy',
      purpose: 'Does important work',
      status: 'registered',
      isActive: true,
      lastHeartbeat: now - 999999,
      healthAssessment: { liveness: 'dead' },
    };

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [deadAgent] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const { needsYou } = res.json();
    const stuckItem = needsYou.find((n) => n.code === 'stuck_agent');
    expect(stuckItem).toBeDefined();
    expect(stuckItem.meta.count).toBe(1);
    expect(stuckItem.priority).toBe(4);

    await app.close();
  });

  test('GET /operator/state needsYou surfaces roadmap_now items when present', async () => {
    const now = Date.now();
    const roadmapItem = {
      id: 'item-1',
      slug: 'finish-operator-state',
      summaryMd: '# Finish /operator/state\nBuild the suggestibility engine.',
      status: 'now',
      promotedFromFeedbackId: null,
      promotedByAgentId: null,
      promotedAt: null,
      lastTouchedAt: now,
      dependencies: [],
      notes: [],
      harbor: 'port-daddy',
    };

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
      roadmapItems: {
        list: jest.fn((opts = {}) => {
          if (opts.status === 'now') return [roadmapItem];
          if (opts.status === 'backlog') return [];
          // cockpit missions asks for ['now', 'backlog'] — return both
          return [roadmapItem];
        }),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();

    // needsYou item
    const roadmapItem_ = payload.needsYou.find((n) => n.code === 'roadmap_now');
    expect(roadmapItem_).toBeDefined();
    expect(roadmapItem_.meta.count).toBe(1);
    expect(roadmapItem_.priority).toBe(5);

    // roadmap section
    expect(payload.roadmap).toBeDefined();
    expect(payload.roadmap).toHaveLength(1);

    // cockpitMissions section
    expect(payload.cockpitMissions).toBeDefined();
    expect(payload.cockpitMissions.missions.length).toBeGreaterThan(0);

    await app.close();
  });

  test('GET /operator/state guard degrades gracefully when binary unavailable', async () => {
    // Simulate: resolvePdBinary returns null, all bare-name probes return ENOENT
    mockSpawnSync.mockImplementation((cmd, args) => {
      // Absolute-path existsSync checks don't use spawnSync, but the bare fallback does.
      // Return ENOENT error for all guard-related spawnSync calls.
      return {
        pid: 0,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        output: ['', '', ''],
        error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      };
    });

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state',
    });

    // Must not 500 — guard unavailability is graceful
    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.success).toBe(true);
    expect(payload.guard).toEqual(expect.objectContaining({
      available: false,
      enabled: false,
    }));

    await app.close();
  });

  test('GET /operator/state fleetSignal reflects fleet-healthy when agents running and no alerts', async () => {
    const now = Date.now();
    const liveAgent = {
      id: 'agent-live',
      name: 'spark',
      identity: 'port-daddy:fleet:spark',
      identityProject: 'port-daddy',
      purpose: 'Fleet agent: spark',
      status: 'registered',
      isActive: true,
      lastHeartbeat: now - 1000,
      healthAssessment: { liveness: 'alive' },
      progress: null,
    };

    const { app, register } = buildApp({
      agents: { list: jest.fn(() => ({ agents: [liveAgent] })) },
      sessions: {
        list: jest.fn(() => ({ sessions: [] })),
        listAllActiveClaims: jest.fn(() => ({ claims: [] })),
      },
      resurrection: { list: jest.fn(() => ({ agents: [] })) },
      spawner: { list: jest.fn(() => []) },
      activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
    });
    await register();

    // Guard status returns enforce+enabled (spawnSync mock returns status 0 with valid JSON)
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        success: true,
        name: 'Coordination Guard',
        enabled: false,
        mode: 'warn',
        requireSession: false,
        requireClaims: false,
        configPath: '',
      }),
      stderr: '',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.fleetSignal).toBeDefined();
    // With a running actor and no alerts, should be fleet-healthy (P) or idle (M)
    expect(['P', 'M']).toContain(payload.fleetSignal.code);

    await app.close();
  });
});
