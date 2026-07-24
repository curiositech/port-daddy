import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDetailsUrl, runPageToken } from '../src/run-page.js';
import { executeFleet } from '../src/execute.js';
import { freshState, installGitHubFetch, memoryKV, makeEnv, makeJob, type GitHubState } from './harness.js';

const SECRET = 's'.repeat(48);
const BASE = 'https://relay.example.workers.dev';

describe('runDetailsUrl', () => {
  it('returns null when unconfigured (either half missing)', async () => {
    expect(await runDetailsUrl({}, 'run:d1')).toBeNull();
    expect(await runDetailsUrl({ RUN_DETAILS_BASE_URL: BASE }, 'run:d1')).toBeNull();
    expect(await runDetailsUrl({ RUN_PAGE_SECRET: SECRET }, 'run:d1')).toBeNull();
  });

  it('rejects a short secret (misconfiguration is fail-safe, not fail-open)', async () => {
    expect(await runDetailsUrl({ RUN_DETAILS_BASE_URL: BASE, RUN_PAGE_SECRET: 'short' }, 'run:d1')).toBeNull();
  });

  it('builds <base>/fleet/runs/<id>?t=v1.<hmac> with the id URL-encoded and base trimmed', async () => {
    const url = await runDetailsUrl(
      { RUN_DETAILS_BASE_URL: BASE + '/', RUN_PAGE_SECRET: SECRET },
      'run:d/1',
    );
    const token = await runPageToken(SECRET, 'run:d/1');
    // ADR-0101 Z1: the token carries a `v1.` version prefix so the relay can
    // rotate its signing secret without invalidating already-stamped links.
    expect(url).toBe(`${BASE}/fleet/runs/run%3Ad%2F1?t=v1.${token}`);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives a stable, id-bound token (same inputs → same token; different id → different)', async () => {
    const a1 = await runPageToken(SECRET, 'run:a');
    const a2 = await runPageToken(SECRET, 'run:a');
    const b = await runPageToken(SECRET, 'run:b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});

describe('details_url on check runs', () => {
  let state: GitHubState;

  beforeEach(() => {
    state = freshState();
    installGitHubFetch(state);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seededEnv(over: Record<string, unknown> = {}) {
    const kv = memoryKV();
    void kv.put(
      'github_inst_42',
      JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
    );
    return makeEnv({ FLEET_TOKENS: kv, ...over });
  }

  it('stamps details_url on create AND complete when configured', async () => {
    const env = seededEnv({ RUN_DETAILS_BASE_URL: BASE, RUN_PAGE_SECRET: SECRET });
    await executeFleet(makeJob(), env);

    const expected = await runDetailsUrl(env, 'run:delivery-abc');
    expect(expected).not.toBeNull();
    expect(state.createdDetailsUrls).toEqual([expected]);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].detailsUrl).toBe(expected);
  });

  it('omits details_url entirely when unconfigured (prior behavior)', async () => {
    await executeFleet(makeJob(), seededEnv());

    expect(state.createdDetailsUrls).toEqual([undefined]);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].detailsUrl).toBeUndefined();
  });
});
