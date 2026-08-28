// tests/unit/purser/cache-key-generation.test.ts
import { userCanReadRepo } from '../../../apps/relay/src/auth-github.ts';

describe('GitHub repo‑access cache key generation', () => {
  const OWNER = 'octocat';
  const REPO = 'hello-world';

  /** Simple in‑memory KV mock that records get/put calls */
  let mockKV: {
    store: Map<string, unknown>;
    get: jest.Mock<Promise<unknown | null>, [string]>;
    put: jest.Mock<Promise<void>, [string, unknown]>;
    delete: jest.Mock<Promise<void>, [string]>;
  };

  /** Minimal env shape required by `userCanReadRepo` */
  let env: Record<string, unknown>;

  beforeEach(() => {
    mockKV = {
      store: new Map(),
      get: jest.fn(async (key: string) => mockKV.store.get(key) ?? null),
      put: jest.fn(async (key: string, value: unknown) => {
        mockKV.store.set(key, value);
      }),
      delete: jest.fn(async (key: string) => {
        mockKV.store.delete(key);
      }),
    };

    // Stub the GitHub API – always say the user can pull the repo
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        permissions: { pull: true },
      }),
    })) as unknown as typeof fetch;

    env = {
      KV: mockKV,
      // The auth‑github module reads these, but their concrete values are irrelevant for the cache test
      GITHUB_CLIENT_ID: 'dummy-id',
      GITHUB_CLIENT_SECRET: 'dummy-secret',
    };
  });

  afterEach(() => {
    jest.resetAllMocks();
    mockKV.store.clear();
  });

  test('cache key incorporates session.cacheNamespace and changes when the session does', async () => {
    // Two distinct sessions for the same logical user
    const sessionA = {
      userId: 'user‑123',
      cacheNamespace: 'ns‑A',
      accessToken: 'token‑A',
    };
    const sessionB = {
      userId: 'user‑123',
      cacheNamespace: 'ns‑B',
      accessToken: 'token‑B',
    };

    // First request – should write a cache entry whose key contains ns‑A
    const canReadA = await userCanReadRepo(env, sessionA, OWNER, REPO);
    expect(canReadA).toBe(true);
    expect(mockKV.put).toHaveBeenCalledTimes(1);
    const firstKey = mockKV.put.mock.calls[0][0] as string;
    expect(firstKey).toContain(sessionA.cacheNamespace);
    expect(firstKey).toContain(`${OWNER}/${REPO}`);

    // Reset call history so we can observe the second round cleanly
    mockKV.get.mockClear();
    mockKV.put.mockClear();

    // Second request with a different session – must not hit the previous cache entry
    const canReadB = await userCanReadRepo(env, sessionB, OWNER, REPO);
    expect(canReadB).toBe(true);
    expect(mockKV.put).toHaveBeenCalledTimes(1);
    const secondKey = mockKV.put.mock.calls[0][0] as string;
    expect(secondKey).toContain(sessionB.cacheNamespace);
    expect(secondKey).toContain(`${OWNER}/${REPO}`);

    // Verify that the KV lookup for the second request never used the first key
    const getCalls = mockKV.get.mock.calls.map(call => call[0] as string);
    expect(getCalls).not.toContain(firstKey);
    // The second key should have been queried (or at least written) during the second request
    expect(getCalls).toContain(secondKey);
  });
});