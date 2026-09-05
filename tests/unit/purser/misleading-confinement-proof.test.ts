// tests/unit/purser/misleading-confinement-proof.test.ts
import { runConfinedChild } from '../../../lib/spawner.ts';
import type { ChildProcess } from 'child_process';

describe('runConfinedChild – external confinement enforcement', () => {
  /**
   * Helper to build a minimal stub child process.
   * The real implementation of `runConfinedChild` checks the
   * confinement receipt before it ever interacts with the child,
   * so a simple object satisfying the type is sufficient.
   */
  const makeDummyChild = (): ChildProcess => ({
    // Minimal fields required for type compatibility.
    pid: 12345,
    kill: jest.fn(),
    // The spawner may read stdio streams; provide no‑ops.
    stdout: null as any,
    stderr: null as any,
    stdin: null as any,
    // EventEmitter methods – stubbed as no‑ops.
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as ChildProcess;

  test('throws when externalConfinement is true but receipt is not confined', async () => {
    const dummyChild = makeDummyChild();

    // Options mimicking a launch request with external confinement enabled.
    const opts = {
      externalConfinement: true,
      // The receipt that the Coast Guard would have produced.
      coastGuard: { confined: false },
    } as any; // Cast to any to avoid pulling in the full internal type shape.

    // The contract requires an explicit rejection (throw) in this situation.
    await expect(
      (async () => await runConfinedChild(dummyChild, opts))()
    ).rejects.toThrow(/external confinement|did not establish external confinement/i);
  });

  test('does not reject when receipt is confined (sanity check)', async () => {
    const dummyChild = makeDummyChild();

    const opts = {
      externalConfinement: true,
      coastGuard: { confined: true },
    } as any;

    // The function should resolve – we don't care about the exact shape,
    // only that it does not throw.
    await expect(
      (async () => await runConfinedChild(dummyChild, opts))()
    ).resolves.not.toThrow();
  });
});