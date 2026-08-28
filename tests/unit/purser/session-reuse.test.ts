// tests/unit/purser/session-reuse.test.ts

import { userCanReadRepo } from '../../../apps/relay/src/auth-github';

// Simple in‑memory mock for the KV binding used by the code under test.
class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    const value = this.store.get(key);
    return value ?? null;
  }

  async put(
    key: string,
    value: string,
    _options?: { expirationTtl?: number }
  ): Promise<void> {
    this.store.set(key, value);
  }
}

// Helper to create a fetch‑like response object.
function mockFetchResponse(status: number) {
  return {
    status,
    // The production code may call json(); provide a stub.
    json: async () => ({}),
  };
}

// ---------------------------------------------------------------------------
// Test suite: ensure that a negative cache entry created under one
// `cacheNamespace` does **not** affect a later session that has a
// different namespace (i.e. after OAuth re‑login).
// ---------------------------------------------------------------------------
describe('GitHub repo access cache respects session cacheNamespace', () => {
  // Shared mock environment for all tests.
  const env = { KV: new MockKV() } as const;

  // Fixed repo identifiers used throughout the suite.
  const owner = 'octocat';
  const repo = 'hello-world';

  beforeEach(() => {
    // Reset the mock KV store.
    (env.KV as any).store?.clear?.();

    // Reset fetch mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn();
  });

  test('stale negative cache from a previous session is not reused after session renewal', async () => {
    // -----------------------------------------------------------------------
    // First session – simulate a 404 response, causing a negative cache entry.
    // -----------------------------------------------------------------------
    const session1 = {
      user: { id: 'user123' },
      ghToken: 'token‑old',
      cacheNamespace: 'ns‑old',
    };

    // Mock fetch to resolve with a 404 for the first call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch.mockResolvedValueOnce(mockFetchResponse(404));

    const canRead1 = await userCanReadRepo(env, session1, owner, repo);
    expect(canRead1).toBe(false);

    // Verify that the negative cache entry was written under the correct key.
    const cacheKey1 = `repo_access:${session1.user.id}:${session1.cacheNamespace}:${owner}/${repo}`;
    const cachedValue1 = await env.KV.get(cacheKey1);
    expect(cachedValue1).toBe('0');

    // -----------------------------------------------------------------------
    // Second session – a fresh OAuth login yields a new cacheNamespace.
    // The repo now exists (200), and the code must *not* hit the stale cache.
    // -----------------------------------------------------------------------
    const session2 = {
      user: { id: 'user123' },
      ghToken: 'token‑new',
      cacheNamespace: 'ns‑new',
    };

    // Mock fetch to resolve with a 200 for the second call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch.mockResolvedValueOnce(mockFetchResponse(200));

    const canRead2 = await userCanReadRepo(env, session2, owner, repo);
    expect(canRead2).toBe(true);

    // Verify that a positive cache entry was written under the *new* namespace.
    const cacheKey2 = `repo_access:${session2.user.id}:${session2.cacheNamespace}:${owner}/${repo}`;
    const cachedValue2 = await env.KV.get(cacheKey2);
    expect(cachedValue2).toBe('1');

    // Ensure that fetch was invoked for each session (i.e., the second call
    // did not short‑circuit on the stale negative entry).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });
});