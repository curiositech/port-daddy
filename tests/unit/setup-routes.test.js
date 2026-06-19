import { jest, describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let nextSpawnResult;

const mockSpawn = jest.fn(() => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn(() => child.emit('close', null));

  setImmediate(() => {
    const result = nextSpawnResult ?? { exitCode: 0, stdout: 'ok\n', stderr: '' };
    if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
    if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
    child.emit('close', result.exitCode);
  });

  return child;
});

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
}));

const { setupPlugin } = await import('../../routes/setup.js');

function buildApp(repoRoot) {
  const app = Fastify();
  return app.register(setupPlugin, {
    deps: {
      repoRoot,
      VERSION: '9.9.9-test',
      CODE_HASH: 'setup-test',
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      },
    },
  });
}

async function setupTestApp() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pd-setup-route-'));
  const app = await buildApp(repoRoot);
  return { app, repoRoot };
}

describe('setup routes', () => {
  let app;
  let repoRoot;
  const tempDirs = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    nextSpawnResult = { exitCode: 0, stdout: 'setup ok\n', stderr: '' };
    const built = await setupTestApp();
    app = built.app;
    repoRoot = built.repoRoot;
    tempDirs.push(repoRoot);
  });

  afterEach(async () => {
    await app?.close();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('GET /setup/overview returns local setup posture and a capability token', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/overview' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      version: '9.9.9-test',
      codeHash: 'setup-test',
      installDir: repoRoot,
      setupToken: expect.any(String),
    }));
    expect(body.setupToken.length).toBeGreaterThan(20);
    expect(body.setupCommand).toEqual(expect.objectContaining({
      command: 'pd',
      baseArgs: ['setup'],
    }));
    expect(body.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'status', mutates: false }),
      expect.objectContaining({ id: 'full', mutates: true }),
    ]));
  });

  test('GET /setup/overview refuses non-loopback callers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/setup/overview',
      remoteAddress: '10.0.0.42',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('local machine'),
    }));
  });

  test('POST /setup/run allows read-only status without GUI confirmation or token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: { action: 'status' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      action: 'status',
      args: ['setup', '--status'],
      cwd: repoRoot,
      stdout: 'setup ok\n',
    }));
    expect(mockSpawn).toHaveBeenCalledWith('pd', ['setup', '--status'], expect.objectContaining({
      cwd: repoRoot,
    }));
  });

  test('POST /setup/run refuses non-loopback callers before executing commands', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/setup/run',
      remoteAddress: '10.0.0.42',
      payload: { action: 'status' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(expect.objectContaining({ success: false }));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('POST /setup/run requires both GUI confirmation and setup token for mutating actions', async () => {
    const missingConfirmation = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: { action: 'fleetbar' },
    });
    expect(missingConfirmation.statusCode).toBe(400);

    const missingToken = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: { action: 'fleetbar', confirmed: true },
    });
    expect(missingToken.statusCode).toBe(403);

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('POST /setup/run executes mutating actions only with the current setup token', async () => {
    const overview = await app.inject({ method: 'GET', url: '/setup/overview' });
    const { setupToken } = overview.json();

    const res = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: { action: 'mcp-skills', confirmed: true, setupToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      action: 'mcp-skills',
      args: ['setup', '--no-daemon', '--no-fleetbar', '--no-init'],
    }));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  test('POST /setup/run rejects project-init without a valid project directory', async () => {
    const overview = await app.inject({ method: 'GET', url: '/setup/overview' });
    const { setupToken } = overview.json();

    const res = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: {
        action: 'project-init',
        confirmed: true,
        setupToken,
        projectDir: join(repoRoot, 'missing-project'),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('valid project directory'),
    }));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('POST /setup/run scopes project-init to the provided project directory', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-setup-project-'));
    tempDirs.push(projectDir);
    const overview = await app.inject({ method: 'GET', url: '/setup/overview' });
    const { setupToken } = overview.json();

    const res = await app.inject({
      method: 'POST',
      url: '/setup/run',
      payload: { action: 'project-init', confirmed: true, setupToken, projectDir },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      action: 'project-init',
      args: ['setup', '--no-daemon', '--no-mcp', '--no-fleetbar', '--project', projectDir],
      cwd: projectDir,
    }));
    expect(mockSpawn).toHaveBeenCalledWith('pd', expect.arrayContaining(['--project', projectDir]), expect.objectContaining({
      cwd: projectDir,
    }));
  });
});
