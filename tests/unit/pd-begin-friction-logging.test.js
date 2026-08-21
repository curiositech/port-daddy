/**
 * `pd begin` failures must survive long enough to reach the top-level CLI
 * telemetry recorder, and the daemon must preserve both rejected begin events
 * and ordinary /usage/trace events.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createActivityLog } from '../../lib/activity.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { createUsageTelemetry } from '../../lib/usage-telemetry.js';

process.env.CI = '1';

const ROOT = join(import.meta.dirname, '..', '..');

describe('pd begin — friction surfaces instead of exiting silently', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    jest.resetModules();
    process.exit = jest.fn((code) => {
      throw new Error(`process.exit(${code}) called — should have thrown instead`);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  test('missing purpose in non-interactive mode throws rather than exiting', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(handleBegin(undefined, [], {})).rejects.toThrow(/purpose/i);
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('an invalid --lifecycle throws with the resolver error', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { lifecycle: 'not-a-real-lifecycle' }),
    ).rejects.toThrow(/lifecycle/i);
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('an empty --files value throws instead of terminating before telemetry', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { files: [] }),
    ).rejects.toThrow(/files requires at least one path/i);
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('a bare --files flag throws instead of terminating before telemetry', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { files: true }),
    ).rejects.toThrow(/files requires at least one path/i);
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('a too-short --sidequest reason throws through the rent gate', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { lifecycle: 'ephemeral', sidequest: 'short' }),
    ).rejects.toThrow(/sidequest needs a real one-line reason/i);
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe('pd begin — exit code 1 is preserved end to end', () => {
  test('the real CLI catch records the failure payload and exits 1', async () => {
    let traceBody = '';
    const server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk) => { traceBody += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"success":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test telemetry listener did not bind');

    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [join(ROOT, 'bin/port-daddy-cli.js'), 'begin'],
          {
            env: {
              ...process.env,
              CI: '1',
              PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
              NO_COLOR: '1',
              PORT_DADDY_URL: `http://127.0.0.1:${address.port}`,
            },
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });

      expect(result.status).toBe(1);
      expect(`${result.stderr}\n${result.stdout}`).toMatch(/purpose/i);
      expect(JSON.parse(traceBody)).toMatchObject({
        surface: 'cli',
        kind: 'command',
        name: 'pd begin',
        status: 'error',
        metadata: { command: 'begin' },
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('production usage telemetry wiring', () => {
  test('server.ts constructs and passes the real telemetry dependency', () => {
    const source = readFileSync(join(ROOT, 'server.ts'), 'utf8');
    expect(source).toContain("import { createUsageTelemetry } from './lib/usage-telemetry.js'");
    expect(source).toMatch(/const usageTelemetry = createUsageTelemetry\(\s*db,/);
    expect(source).toMatch(/metricsRegistry, usageTelemetry,/);
  });

  test('the server construction shape records and reads back a real event', () => {
    const db = createTestDb();
    const startedAt = Date.now();
    const usageTelemetry = createUsageTelemetry(
      db,
      { version: '9.9.9-test', codeHash: 'deadbeef', buildDate: new Date(startedAt).toISOString() },
    );

    const result = usageTelemetry.record({ surface: 'cli', kind: 'command', name: 'pd begin' });
    expect(result.success).toBe(true);
    expect(typeof result.id).toBe('number');

    const recent = usageTelemetry.recent(10, startedAt - 1000);
    expect(recent.some((event) => event.surface === 'cli' && event.name === 'pd begin')).toBe(true);
  });
});

describe('sugar_begin route rejection logging', () => {
  function createRealSugar() {
    const db = createTestDb();
    const agents = createAgents(db);
    const sessions = createSessions(db);
    const activityLog = createActivityLog(db);
    sessions.setActivityLog(activityLog);
    return createSugar({
      agents,
      sessions,
      activityLog,
      gitOriginChecker: {
        checkBranchOnOrigin: () => ({
          ok: true,
          branch: 'feat/test',
          upstream: 'origin/feat/test',
          ahead: 0,
        }),
      },
    });
  }

  test('the real sugar service rejection is logged with safe context', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');
    const warn = jest.fn();
    const app = Fastify();

    await app.register(sugarPlugin, {
      deps: {
        sugar: createRealSugar(),
        metrics: { errors: 0 },
        logger: { info: jest.fn(), warn, error: jest.fn() },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: {
        purpose: 'x',
        identity: 'demo:test:logging',
        lifecycle: 'ephemeral',
        sidequestReason: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(warn).toHaveBeenCalledWith(
      'sugar_begin_rejected',
      expect.objectContaining({
        code: 'SIDEQUEST_REASON_TOO_SHORT',
        fileCount: 0,
        hasSidequestReason: true,
      }),
    );
    expect(warn.mock.calls[0][1]).not.toHaveProperty('sidequestReason');
    expect(warn.mock.calls[0][1]).not.toHaveProperty('files');
    await app.close();
  });

  test('route-level purpose and lifecycle validation failures are logged', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');
    const warn = jest.fn();
    const app = Fastify();

    await app.register(sugarPlugin, {
      deps: {
        sugar: createRealSugar(),
        metrics: { errors: 0 },
        logger: { info: jest.fn(), warn, error: jest.fn() },
      },
    });

    const missingPurpose = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { lifecycle: 'ephemeral', files: [] },
    });
    const invalidLifecycle = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'route validation', lifecycle: 'not-real', files: ['one.ts'] },
    });

    expect(missingPurpose.statusCode).toBe(400);
    expect(invalidLifecycle.statusCode).toBe(400);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      'sugar_begin_rejected',
      expect.objectContaining({ code: 'VALIDATION_ERROR', fileCount: 0 }),
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      'sugar_begin_rejected',
      expect.objectContaining({ code: 'SESSION_LIFECYCLE_REQUIRED', fileCount: 1 }),
    );
    await app.close();
  });

  test('a successful begin does not log a rejection', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');
    const warn = jest.fn();
    const app = Fastify();

    await app.register(sugarPlugin, {
      deps: {
        sugar: {
          begin: jest.fn(() => ({ success: true, agentId: 'agent-1', sessionId: 'session-1' })),
        },
        metrics: { errors: 0 },
        logger: { info: jest.fn(), warn, error: jest.fn() },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: {
        purpose: 'x',
        identity: 'demo:test:logging',
        lifecycle: 'ephemeral',
        sidequestReason: 'a good enough reason',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    await app.close();
  });
});
