/**
 * `pd begin` failures must survive long enough to reach the top-level CLI
 * telemetry recorder, and the daemon must preserve both rejected begin events
 * and ordinary /usage/trace events.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
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

  test('a too-short --sidequest reason throws through the rent gate', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { lifecycle: 'ephemeral', sidequest: 'short' }),
    ).rejects.toThrow(/sidequest needs a real one-line reason/i);
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe('pd begin — exit code 1 is preserved end to end', () => {
  test('the real CLI catch records the failure path and exits 1', () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'bin/port-daddy-cli.js'), 'begin'],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          CI: '1',
          PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
          NO_COLOR: '1',
          PORT_DADDY_URL: 'http://127.0.0.1:1',
        },
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stderr}\n${result.stdout}`).toMatch(/purpose/i);
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
  test('logger.warn includes the failure code when sugar.begin rejects', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');
    const warn = jest.fn();
    const app = Fastify();

    await app.register(sugarPlugin, {
      deps: {
        sugar: {
          begin: jest.fn(() => ({
            success: false,
            code: 'SIDEQUEST_REASON_TOO_SHORT',
            error: 'sidequest reason must be at least 12 characters',
          })),
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
        sidequestReason: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(warn).toHaveBeenCalledWith(
      'sugar_begin_rejected',
      expect.objectContaining({ code: 'SIDEQUEST_REASON_TOO_SHORT' }),
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
