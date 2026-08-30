import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const { handleActors } = await import('../../cli/commands/actors.js');

describe('pd actor admission grant', () => {
  let exitSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    pdFetch.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('fails closed when a nominal success omits the durable issued receipt', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        grant: {
          grantId: 'oadm_missing_receipt',
          identity: 'port-daddy:worker',
          worktreeRoot: '/Users/tester/coding/tmp/worker',
          branch: 'codex/worker',
          remote: 'github.com/curiositech/port-daddy',
          head: 'a'.repeat(40),
          base: 'b'.repeat(40),
          roadmapSlug: 'workintent-dispatch-isolation',
          operatorIdentity: 'local:test:uid:501',
          expiresAt: 2_000,
          status: 'active',
        },
      }),
    });

    await expect(handleActors(['admission', 'grant'], {
      identity: 'port-daddy:worker',
      roadmap: 'workintent-dispatch-isolation',
      worktree: '/Users/tester/coding/tmp/worker',
      confirm: true,
      json: true,
    })).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/durable issued receipt/i));
  });

  test('prints a nominal success only when the durable issued receipt is present', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        grant: {
          grantId: 'oadm_with_receipt',
          identity: 'port-daddy:worker',
          worktreeRoot: '/Users/tester/coding/tmp/worker',
          branch: 'codex/worker',
          remote: 'github.com/curiositech/port-daddy',
          head: 'a'.repeat(40),
          base: 'b'.repeat(40),
          roadmapSlug: 'workintent-dispatch-isolation',
          operatorIdentity: 'local:test:uid:501',
          expiresAt: 2_000,
          status: 'active',
        },
        receipt: { receiptId: 'oar_issued_receipt', kind: 'issued' },
      }),
    });

    await handleActors(['admission', 'grant'], {
      identity: 'port-daddy:worker',
      roadmap: 'workintent-dispatch-isolation',
      worktree: '/Users/tester/coding/tmp/worker',
      confirm: true,
      json: true,
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('oar_issued_receipt'));
  });

  test.each([
    [403, 'operator Unix socket authority required'],
    [404, 'operator admission route unavailable'],
  ])('surfaces daemon refusal status %s without printing a grant', async (status, error) => {
    pdFetch.mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ success: false, error, code: 'DAEMON_REFUSAL' }),
    });

    await expect(handleActors(['admission', 'grant'], {
      identity: 'port-daddy:worker',
      roadmap: 'workintent-dispatch-isolation',
      worktree: '/Users/tester/coding/tmp/worker',
      confirm: true,
      json: true,
    })).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenLastCalledWith(expect.stringContaining(error));
    expect(logSpy).not.toHaveBeenCalled();
  });
});
