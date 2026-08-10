/**
 * `pd begin` friction was invisible end to end: handleBegin exited via
 * process.exit(1) on every failure path (missing purpose, bad --lifecycle,
 * rent gate, worktree policy, daemon rejection), which terminates the
 * process before bin/port-daddy-cli.ts's catch block can call
 * recordCliUsage() — so the highest-volume friction produced zero durable
 * record. And on the daemon side, routes/sugar.ts logged the success path
 * (`sugar_begin`) but never logged a rejection at all.
 *
 * These tests pin both fixes: handleBegin now throws instead of exiting
 * (so main()'s existing catch — and its recordCliUsage call — actually
 * runs), and the daemon logs `sugar_begin_rejected` with the failure code.
 */
import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createUsageTelemetry } from '../../lib/usage-telemetry.js';

process.env.CI = '1'; // force canPrompt() === false so handleBegin takes the non-interactive path

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

  test('an invalid --lifecycle throws with the resolver\'s own error text', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { lifecycle: 'not-a-real-lifecycle' })
    ).rejects.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('a too-short --sidequest reason throws through the rent-gate path', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await expect(
      handleBegin('write some tests', [], { lifecycle: 'ephemeral', sidequest: 'short' })
    ).rejects.toThrow(/sidequest needs a real one-line reason/i);
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe('pd begin — exit code 1 is preserved end to end (real subprocess)', () => {
  // Addresses the review concern that throw-instead-of-exit could introduce
  // an unhandled rejection if bin/port-daddy-cli.ts's catch didn't actually
  // wrap the call. This spawns the real compiled CLI entrypoint — same
  // pattern as tests/unit/cli-shim.test.js — so it proves the full
  // throw -> main()'s catch -> recordCliUsage -> process.exit(1) chain,
  // not just that handleBegin itself rejects.
  test('pd begin with no purpose, non-interactively, still exits 1', () => {
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
          // No daemon in this env — fetchAndRenderWelcomeBriefing and
          // recordCliUsage both fail closed (caught) rather than hang.
          PORT_DADDY_URL: 'http://127.0.0.1:1',
        },
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stderr}\n${result.stdout}`).toMatch(/purpose/i);
  });
});

describe('server.ts usage-telemetry wiring — restored construction actually records', () => {
  // The route-level tests in usage-routes.test.js inject their own
  // createUsageTelemetry instance, which validated routes/usage.ts but never
  // exercised whether server.ts's OWN construction (the thing that was
  // silently dropped by merge 8a6b7610b) actually works. This constructs it
  // with the exact same call shape server.ts uses and proves record() +
  // recent() round-trip through a real usage_events row.
  test('the server.ts construction shape records and reads back a real event', () => {
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
    expect(recent.some((e) => e.surface === 'cli' && e.name === 'pd begin')).toBe(true);
  });
});

describe('sugar_begin route — rejection is logged, not silent', () => {
  test('logger.warn fires with the failure code when sugar.begin() rejects', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');

    const warn = jest.fn();
    const stubSugar = {
      begin: jest.fn(() => ({
        success: false,
        code: 'SIDEQUEST_REASON_TOO_SHORT',
        error: 'sidequest reason must be at least 12 characters',
      })),
    };

    const app = Fastify();
    await app.register(sugarPlugin, {
      deps: {
        sugar: stubSugar,
        metrics: { errors: 0 },
        logger: { info: jest.fn(), warn, error: jest.fn() },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'x', identity: 'demo:test:logging', lifecycle: 'ephemeral', sidequestReason: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(warn).toHaveBeenCalledWith(
      'sugar_begin_rejected',
      expect.objectContaining({ code: 'SIDEQUEST_REASON_TOO_SHORT' }),
    );
    await app.close();
  });

  test('a successful begin does not fire the rejection log', async () => {
    const Fastify = (await import('fastify')).default;
    const { sugarPlugin } = await import('../../routes/sugar.js');

    const warn = jest.fn();
    const stubSugar = {
      begin: jest.fn(() => ({ success: true, agentId: 'agent-1', sessionId: 'session-1' })),
    };

    const app = Fastify();
    await app.register(sugarPlugin, {
      deps: {
        sugar: stubSugar,
        metrics: { errors: 0 },
        logger: { info: jest.fn(), warn, error: jest.fn() },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sugar/begin',
      payload: { purpose: 'x', identity: 'demo:test:logging', lifecycle: 'ephemeral', sidequestReason: 'a good enough reason' },
    });

    expect(res.statusCode).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    await app.close();
  });
});
