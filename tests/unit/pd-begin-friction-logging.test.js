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

process.env.CI = '1'; // force canPrompt() === false so handleBegin takes the non-interactive path

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
