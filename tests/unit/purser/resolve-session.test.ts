// tests/unit/purser/resolve-session.test.ts
/**
 * Validate that the session‑derived cache namespace is correctly scoped
 * to the browser session cookie and that repository‑access checks are
 * re‑evaluated after a session renewal.
 *
 * The test exercises the public API of `apps/relay/src/auth-github.ts`
 * without relying on any internal implementation details other than the
 * existence of `resolveSession` (which extracts a cache namespace from
 * the request’s `session` cookie) and `userCanReadRepo` (which performs a
 * GitHub API request and caches the result keyed by that namespace).
 *
 * Strategy:
 *   1. Mock a minimal D1Database that returns deterministic session rows.
 *   2. Mock the global `fetch` used by `userCanReadRepo` to count GitHub calls.
 *   3. Stub `caches.default` with an in‑memory map that mimics the Workers cache.
 *   4. Create two distinct HTTP requests that differ only in their `session` cookie.
 *   5. Resolve each request to a session object and assert that the derived
 *      `cacheNamespace` values differ.
 *   6. Call `userCanReadRepo` twice with the same session – the second call
 *      must hit the cache (no extra fetch).
 *   7. Call `userCanReadRepo` with the second session – a fresh fetch must
 *      occur because the cache key now includes a new namespace.
 */

import * as auth from '../../../apps/relay/src/auth-github';

// -----------------------------------------------------------------------------
// Minimal in‑memory D1Database mock
// -----------------------------------------------------------------------------
type SessionRow = {
  user_id: string;
  session_hash: string;
  access_token: string;
};

function createMockD1Database() {
  const rows: Record<string, SessionRow> = {};

  return {
    // Helper used by the tests to preload a session row.
    __store(sessionHash: string, userId: string, token: string) {
      rows[sessionHash] = {
        user_id: userId,
        session_hash: sessionHash,
        access_token: token,
      };
    },

    // Mimic the subset of the Cloudflare D1 API used by `resolveSession`.
    prepare(_sql: string) {
      return {
        bind(sessionHash: string) {
          return {
            async first() {
              // The real API returns `null` when nothing matches.
              return rows[sessionHash] ?? null;
            },
          };
        },
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Helpers to build Request objects with a `session` cookie
// -----------------------------------------------------------------------------
function requestWithSessionCookie(sessionCookie: string): Request {
  return new Request('https://example.test/', {
    method: 'GET',
    headers: {
      Cookie: `session=${sessionCookie}`,
    },
  });
}

// -----------------------------------------------------------------------------
// Simple mock of a Fetch Response used by `userCanReadRepo`
// -----------------------------------------------------------------------------
class MockGitHubResponse {
  ok = true;
  // The shape mirrors what the production code checks (permissions object)
  private readonly body = {
    permissions: {
      admin: false,
      push: true,
      pull: true,
    },
  };

  async json() {
    return this.body;
  }

  // Workers’ Response objects expose `clone`; we provide a no‑op clone.
  clone() {
    return this;
  }
}

// -----------------------------------------------------------------------------
// In‑memory stub for the Workers cache (`caches.default`)
// -----------------------------------------------------------------------------
function createMockCache() {
  const map = new Map<string, any>();

  return {
    async match(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, response: any) {
      // Workers cache stores a clone of the response; we just keep the reference.
      map.set(key, response);
    },
    // Utility for test cleanup
    reset() {
      map.clear();
    },
  };
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------
describe('resolveSession & cacheNamespace isolation', () => {
  // Shared mocks
  const mockDb = createMockD1Database();
  const env = { DB: mockDb } as any; // `resolveSession` expects an `env` with a `DB`

  // Preserve originals so we can restore them after the suite.
  const realFetch = global.fetch;
  const realCaches = (global as any).caches;

  // Mocked cache instance that will be swapped into `global.caches.default`.
  const mockCache = createMockCache();

  beforeAll(() => {
    // -----------------------------------------------------------------------
    // Global fetch mock – counts GitHub API calls.
    // -----------------------------------------------------------------------
    (global as any).fetch = jest.fn().mockResolvedValue(new MockGitHubResponse());

    // -----------------------------------------------------------------------
    // Global caches stub.
    // -----------------------------------------------------------------------
    (global as any).caches = {
      default: mockCache,
    };
  });

  afterAll(() => {
    // Restore the real globals.
    (global as any).fetch = realFetch;
    (global as any).caches = realCaches;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.reset();
  });

  test('different session cookies yield distinct cacheNamespace values', async () => {
    // Arrange – store two distinct session rows.
    mockDb.__store('abc123', 'user-1', 'token-abc');
    mockDb.__store('def456', 'user-1', 'token-def');

    const req1 = requestWithSessionCookie('abc123');
    const req2 = requestWithSessionCookie('def456');

    // Act
    const session1 = await auth.resolveSession(req1, env);
    const session2 = await auth.resolveSession(req2, env);

    // Assert – both sessions resolved and namespaces differ.
    expect(session1).toBeTruthy();
    expect(session2).toBeTruthy();
    expect(session1.cacheNamespace).toBeDefined();
    expect(session2.cacheNamespace).toBeDefined();
    expect(session1.cacheNamespace).not.toEqual(session2.cacheNamespace);
  });

  test('repo‑access cache is scoped to cacheNamespace and refreshed after session renewal', async () => {
    // Arrange – reuse the same two sessions as above.
    mockDb.__store('abc123', 'user-1', 'token-abc');
    mockDb.__store('def456', 'user-1', 'token-def');

    const reqA = requestWithSessionCookie('abc123');
    const reqB = requestWithSessionCookie('def456');

    const sessionA = await auth.resolveSession(reqA, env);
    const sessionB = await auth.resolveSession(reqB, env);

    const owner = 'octocat';
    const repo = 'hello-world';

    // ---- First call with session A (cache miss) ----
    const canReadA1 = await auth.userCanReadRepo(owner, repo, sessionA);
    expect(canReadA1).toBe(true);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const firstCallUrl = (global as any).fetch.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain(`${owner}/${repo}`);

    // ---- Second call with the same session A (cache hit) ----
    jest.clearAllMocks(); // reset fetch call count
    const canReadA2 = await auth.userCanReadRepo(owner, repo, sessionA);
    expect(canReadA2).toBe(true);
    expect((global as any).fetch).not.toHaveBeenCalled();

    // ---- Call with a different session B (should be a cache miss) ----
    const canReadB1 = await auth.userCanReadRepo(owner, repo, sessionB);
    expect(canReadB1).toBe(true);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const secondCallUrl = (global as any).fetch.mock.calls[0][0] as string;
    expect(secondCallUrl).toContain(`${owner}/${repo}`);
  });
});