/**
 * lib/spawner/coast-guard-runner.ts — `withCoastGuard()` cleanup-on-throw.
 *
 * `withCoastGuard()` starts a real in-process EgressMeter (binds a loopback
 * port) BEFORE calling `confineCommand()`. `confineCommand()` can throw
 * synchronously — e.g. `SbplInjectionError` from an unsafe workdir root, or
 * any other unexpected failure while building the sandbox wrap — and when it
 * does, no `ConfinementHandle` (and therefore no `dispose()`) is ever handed
 * back to the caller. Without an internal catch, the already-listening meter
 * leaks: nothing left holding a reference to it can ever close that socket.
 *
 * This proves the fix: a `confineCommand()` throw is caught inside
 * `withCoastGuard()` itself, which disposes the meter before rethrowing —
 * fully self-contained cleanup at the authority boundary, no caller
 * involvement required.
 */

import { jest } from '@jest/globals';

const mockConfineCommand = jest.fn();
const mockBuildBrokerRules = jest.fn(() => ({}));
const mockResolveCoastGuardPolicy = jest.fn(() => ({
  enabled: true,
  maxRequests: 10,
  maxBytes: null,
}));

jest.unstable_mockModule('../../lib/coast-guard.js', () => ({
  confineCommand: mockConfineCommand,
  resolveCoastGuardPolicy: mockResolveCoastGuardPolicy,
  buildBrokerRules: mockBuildBrokerRules,
}));

const { EgressMeter } = await import('../../lib/coast-guard/egress-meter.js');
const { withCoastGuard } = await import('../../lib/spawner/coast-guard-runner.js');

beforeEach(() => {
  mockConfineCommand.mockReset();
  mockBuildBrokerRules.mockReset().mockReturnValue({});
  mockResolveCoastGuardPolicy.mockReset().mockReturnValue({
    enabled: true,
    maxRequests: 10,
    maxBytes: null,
  });
});

describe('withCoastGuard — egress-meter cleanup when confineCommand throws', () => {
  test('disposes the already-listening meter before rethrowing, so nothing is leaked for the caller to clean up', async () => {
    const disposeSpy = jest.spyOn(EgressMeter.prototype, 'dispose');
    mockConfineCommand.mockImplementation(() => {
      throw new Error('confineCommand exploded (e.g. SbplInjectionError)');
    });

    await expect(
      withCoastGuard({
        agentId: 'test-agent',
        backend: 'cli:test',
        cmd: 'echo',
        args: ['hi'],
        env: {},
      }),
    ).rejects.toThrow('confineCommand exploded');

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });

  test('does NOT dispose twice on the happy path (regression guard against double-cleanup)', async () => {
    const disposeSpy = jest.spyOn(EgressMeter.prototype, 'dispose');
    mockConfineCommand.mockImplementation((params) => ({
      cmd: params.cmd,
      args: params.args,
      env: params.env,
      confined: true,
      mechanism: 'seatbelt',
      receipt: () => ({ tool: 'pd-coast-guard' }),
      dispose: () => params.deps.disposeProxy(),
    }));

    const run = await withCoastGuard({
      agentId: 'test-agent',
      backend: 'cli:test',
      cmd: 'echo',
      args: ['hi'],
      env: {},
    });
    run.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });

  test('a disabled policy (per-spec opt-out) runs raw: no meter bound, confineCommand never called, receipt honestly confined:false', async () => {
    // The opt-out is a policy decision, never a silent skip: the run must come
    // back with the ORIGINAL command (no wrapper), zero side effects (no
    // loopback listener to leak, no sandbox build), and a receipt that states
    // plainly that nothing protected this spawn.
    const listenSpy = jest.spyOn(EgressMeter.prototype, 'listen');
    mockResolveCoastGuardPolicy.mockReturnValue({
      enabled: false,
      maxRequests: 10,
      maxBytes: null,
    });

    const run = await withCoastGuard({
      agentId: 'test-agent',
      backend: 'cli:test',
      cmd: 'echo',
      args: ['hi'],
      env: { KEEP: '1' },
    });

    expect(listenSpy).not.toHaveBeenCalled();
    expect(mockConfineCommand).not.toHaveBeenCalled();
    expect(run.cmd).toBe('echo');
    expect(run.args).toEqual(['hi']);
    expect(run.env).toEqual({ KEEP: '1' });
    expect(run.confined).toBe(false);
    expect(run.mechanism).toBe('none');

    const receipt = run.receipt();
    expect(receipt.confined).toBe(false);
    expect(receipt.mechanism).toBe('none');
    expect(receipt.egress).toBeNull();
    expect(receipt.honestLimits).toMatch(/Coast Guard disabled/);

    // dispose() on the opt-out path is a no-op — nothing was ever started.
    expect(() => run.dispose()).not.toThrow();
    listenSpy.mockRestore();
  });
});
