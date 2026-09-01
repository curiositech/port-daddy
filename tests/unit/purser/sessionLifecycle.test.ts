// tests/unit/purser/sessionLifecycle.test.ts
/**
 * Unit‑tests for the SessionLifecycleManager implementation.
 *
 * The contract for this PR requires that the **PreCompact** and **Stop**
 * lifecycle hooks:
 *   • fire without throwing,
 *   • return an audit payload that contains entropy and state information,
 *   • never expose secret‑like fields (e.g. keys, tokens, passwords).
 *
 * Because the exact location of the SessionLifecycleManager class can vary
 * across revisions, the test attempts a handful of plausible import paths
 * (all relative to the repository root). The first successful import is used.
 *
 * The test purposefully avoids any external side‑effects – it only invokes
 * the public hook methods and inspects their return values.
 */

import { describe, beforeAll, test, expect, jest } from '@jest/globals';

// Increase timeout because the hooks may perform async I/O (entropy sampling, etc.).
jest.setTimeout(10_000);

type HookResult = Record<string, unknown>;

let manager: {
  runPreCompact: () => Promise<HookResult>;
  runStop: () => Promise<HookResult>;
} | null = null;

/**
 * Attempt to load the SessionLifecycleManager from a set of likely
 * locations.  The repository’s layout has changed over time, so we try a
 * few candidates and stop at the first that resolves.
 */
async function loadManager(): Promise<any> {
  const candidates = [
    // Typical source‑tree locations
    '../../src/purser/SessionLifecycleManager',
    '../../src/SessionLifecycleManager',
    '../../core/SessionLifecycleManager',
    '../../lib/purser/SessionLifecycleManager',
    '../../SessionLifecycleManager',
  ];

  for (const rel of candidates) {
    try {
      const mod = await import(rel);
      // The class may be a named export or the default export.
      const Cls = mod.SessionLifecycleManager ?? mod.default;
      if (typeof Cls === 'function') {
        // Construct with minimal, valid options – the concrete implementation
        // validates the shape but does not require real binaries for the test.
        return new Cls({
          provider: 'claude',
          deadlineMs: 1000,
          binDir: process.cwd(),
          hookName: 'precompact',
        });
      }
    } catch {
      // Silently ignore missing modules – try the next candidate.
    }
  }
  throw new Error('SessionLifecycleManager could not be imported from any known path.');
}

/**
 * Helper to assert that a hook result contains the required audit fields
 * and does not leak secret‑like keys.
 */
function assertAuditShape(result: HookResult, hookName: string) {
  // Required top‑level fields
  expect(result).toHaveProperty('entropy');
  expect(result).toHaveProperty('state');

  // Ensure no property looks like a secret.
  const secretLike = Object.keys(result).filter((k) =>
    /secret|token|key|password|credential/i.test(k),
  );
  expect(secretLike).toHaveLength(
    0,
    `${hookName} returned secret‑like fields: ${secretLike.join(', ')}`,
  );
}

/* -------------------------------------------------------------------------- */
/*                               Test Suite                                   */
/* -------------------------------------------------------------------------- */
describe('SessionLifecycleManager lifecycle hooks', () => {
  beforeAll(async () => {
    manager = await loadManager();
  });

  test('runPreCompact exists and resolves without error', async () => {
    if (!manager) {
      throw new Error('Manager not loaded');
    }
    expect(typeof manager.runPreCompact).toBe('function');

    // The hook should resolve to an object; any rejection is a test failure.
    await expect(manager.runPreCompact()).resolves.not.toThrow();

    const result = await manager.runPreCompact();
    expect(result).toBeInstanceOf(Object);
    assertAuditShape(result, 'runPreCompact');
  });

  test('runStop exists and resolves without error', async () => {
    if (!manager) {
      throw new Error('Manager not loaded');
    }
    expect(typeof manager.runStop).toBe('function');

    await expect(manager.runStop()).resolves.not.toThrow();

    const result = await manager.runStop();
    expect(result).toBeInstanceOf(Object);
    assertAuditShape(result, 'runStop');
  });
});