import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from '../src/deadline';
import { AI_RUN_TIMEOUT_MS } from '../src/execute';

// Copilot findings on #654: (1) the inline Promise.race left an orphaned timer
// per ship when ai.run resolved first; (2) the deadline — the load-bearing fix
// for the 2026-07-03 stuck-check-run outage — had no test. withDeadline is the
// extracted, testable core; runShip routes every ai.run through it.
describe('withDeadline', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with the work result and CLEARS the timer (no orphans)', async () => {
    const p = withDeadline(Promise.resolve('ok'), 90_000, 'ai.run(test)');
    await expect(p).resolves.toBe('ok');
    // The failure mode being pinned: a leftover armed timer after the race.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates work rejection and clears the timer', async () => {
    const p = withDeadline(Promise.reject(new Error('boom')), 90_000, 'ai.run(test)');
    await expect(p).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a labeled timeout when work hangs past the deadline', async () => {
    const never = new Promise<never>(() => {});
    const p = withDeadline(never, AI_RUN_TIMEOUT_MS, 'ai.run(@cf/fake/model)');
    const assertion = expect(p).rejects.toThrow(
      'ai.run(@cf/fake/model) timed out after 90s',
    );
    await vi.advanceTimersByTimeAsync(AI_RUN_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not time out work that finishes just under the deadline', async () => {
    let done: (v: string) => void;
    const work = new Promise<string>(res => { done = res; });
    const p = withDeadline(work, AI_RUN_TIMEOUT_MS, 'ai.run(test)');
    await vi.advanceTimersByTimeAsync(AI_RUN_TIMEOUT_MS - 1);
    done!('made it');
    await expect(p).resolves.toBe('made it');
    expect(vi.getTimerCount()).toBe(0);
  });
});
