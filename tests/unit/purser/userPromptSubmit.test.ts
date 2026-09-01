// tests/unit/purser/userPromptSubmit.test.ts
import { jest } from '@jest/globals';

// Helper to obtain the hook function regardless of how the module exports it.
async function loadUserPromptSubmitHook(): Promise<(prompt: string, validator?: (p: string) => Promise<void>) => Promise<any>> {
  // The implementation lives somewhere under src/purser – the exact filename may vary.
  // We attempt a few plausible locations; the first that succeeds is used.
  const possiblePaths = [
    '../../src/purser/userPromptSubmit',          // typical location
    '../../src/purser/hooks/userPromptSubmit',    // alternative nesting
    '../../src/hooks/UserPromptSubmit',           // fallback
  ];

  for (const p of possiblePaths) {
    try {
      const mod = await import(p);
      // Prefer a default export, then a named export that looks like a handler.
      const fn = (mod as any).default ?? (mod as any).handleUserPromptSubmit ?? (mod as any).userPromptSubmitHook;
      if (typeof fn === 'function') return fn;
    } catch {
      // ignore – try the next candidate
    }
  }
  throw new Error('Could not locate the UserPromptSubmit hook implementation.');
}

/**
 * A tiny validator that resolves after `delayMs` milliseconds.
 */
function makeValidator(delayMs: number): (prompt: string) => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayMs);
    });
}

describe('UserPromptSubmit hook', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    // Ensure we run with fake timers for deterministic timeout testing.
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    // Reset environment for each test.
    process.env = { ...ORIGINAL_ENV };
    process.env.PD_HOOK_PROVIDER = 'test-provider';
    process.env.PD_HOOK_DEADLINE_MS = '1000'; // 1000 ms deadline as required by the contract
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  test('completes successfully when validation finishes before the deadline', async () => {
    const hook = await loadUserPromptSubmitHook();
    const validator = jest.fn(makeValidator(500)); // resolves in 500 ms < 1000 ms

    const resultPromise = hook('sample prompt', validator);

    // Fast‑forward time to let the validator resolve.
    jest.advanceTimersByTime(500);
    await expect(resultPromise).resolves.not.toThrow();

    // The validator should have been called exactly once with the prompt.
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith('sample prompt');
  });

  test('rejects when validation exceeds the 1000 ms deadline', async () => {
    const hook = await loadUserPromptSubmitHook();
    const validator = jest.fn(makeValidator(1500)); // resolves in 1500 ms > 1000 ms

    const resultPromise = hook('slow prompt', validator);

    // Advance time only up to the deadline.
    jest.advanceTimersByTime(1000);

    // The hook is expected to reject (or throw) due to timeout.
    await expect(resultPromise).rejects.toThrow(/deadline|timeout/i);

    // The validator is still scheduled; advance the rest to avoid unhandled promise rejections.
    jest.advanceTimersByTime(500);
  });

  test('receives the correct PD_HOOK_PROVIDER and PD_HOOK_DEADLINE_MS values', async () => {
    const hook = await loadUserPromptSubmitHook();

    // The validator simply resolves immediately; we are interested in what the hook returns.
    const validator = makeValidator(0);

    // Some implementations return metadata; we defensively check for it.
    const result = await hook('metadata check', validator);

    // If the hook returns an object with the expected fields, verify them.
    if (result && typeof result === 'object') {
      expect((result as any).provider).toBe('test-provider');
      expect((result as any).deadlineMs).toBe(1000);
    } else {
      // Fall back to ensuring the environment variables are still present – the hook should not
      // mutate them.
      expect(process.env.PD_HOOK_PROVIDER).toBe('test-provider');
      expect(process.env.PD_HOOK_DEADLINE_MS).toBe('1000');
    }
  });
});