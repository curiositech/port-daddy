import { jest } from '@jest/globals';
import Fastify from 'fastify';
import path from 'node:path';

const mockSpawn = jest.fn(() => ({
  unref: jest.fn(),
}));
const mockSpawnSync = jest.fn(() => ({
  status: 1,
  stdout: '',
  stderr: '',
}));

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

const { operatorPlugin } = await import('../../routes/operator.js');

function buildApp() {
  const app = Fastify();
  return {
    app,
    register: () => app.register(operatorPlugin, {
      deps: {
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
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
});
