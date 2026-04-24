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

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
  execSync: mockExecSync,
}));

const { operatorPlugin } = await import('../../routes/operator.js');

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
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
    });
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
      '      prompt: echo spark',
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
          actorState: 'idle',
        }),
      ]);
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
});
