import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getGitHubAppIdentity,
  getRepoInstallationId,
  mintRepositoryInstallationToken,
  revokeInstallationToken,
} from '../src/github-app.js';
import { __fleetbotPublisherTest as publisher, handleFleetbotPublisher } from '../src/github-publisher.js';
import { FLEETBOT_ACTION_SCHEMA, FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA, fleetbotIdempotencyPreimage, type FleetbotActionRequest } from '../../../lib/github-publisher-contract.js';
import { hashHex } from '../src/crypto.js';

vi.mock('../src/auth-github.js', async (importActual) => ({
  ...await importActual<typeof import('../src/auth-github.js')>(),
  resolveAccountPublisherCredential: vi.fn(async () => ({
    accessToken: 'ghu_account-fixture', user: { id: 'account-1', github_user_id: 7 },
  })),
}));
vi.mock('../src/publisher-grants.js', async (importActual) => ({
  ...await importActual<typeof import('../src/publisher-grants.js')>(),
  readPublisherGrant: vi.fn(async () => ({ accountUserId: 'account-1' })),
  authorizePublisherGrant: vi.fn(async () => ({ grantId: `pdg_${'ab'.repeat(16)}`, epoch: 1 })),
}));
import { parseGitHubUserCredential, refreshGitHubUserCredential } from '../src/github-user-token.js';

const API = 'https://api.github.com';
const REDIRECT_TARGET = 'https://credential-sink.example/redirected';
const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }) as string;
const NOW = 2_000_000_000;
const credential = parseGitHubUserCredential({
  access_token: 'ghu_fixture', expires_in: 28_800,
  refresh_token: 'ghr_fixture', refresh_token_expires_in: 15_897_600,
  scope: '', token_type: 'bearer',
}, 'device', NOW);

function kv() {
  return { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as unknown as KVNamespace;
}

function tokenResponse(broader = false) {
  return Response.json({
    token: 'installation-fixture', expires_at: new Date(Date.now() + 60_000).toISOString(),
    repositories: [{ name: 'port-daddy', full_name: 'curiositech/port-daddy' }],
    permissions: { metadata: 'read', contents: 'write', ...(broader ? { issues: 'write' } : {}) },
  });
}

/** Model Workers rejecting unsupported modes before I/O and following only in follow mode. */
function workersFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (init.redirect === 'error') throw new TypeError('runtime_rejected_redirect_mode');
    const url = String(input);
    calls.push({ url, init });
    const response = respond(url, init);
    const location = response.headers.get('Location');
    if (response.status >= 300 && response.status < 400 && location && init.redirect !== 'manual') {
      // Make accidental following observable, including headers and request bodies.
      calls.push({ url: location, init });
      return Response.json({});
    }
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

const mint = () => mintRepositoryInstallationToken(
  '3810450', KEY, 123, 'curiositech', 'port-daddy', { contents: 'write' },
);
const refresh = () => refreshGitHubUserCredential(credential, { clientId: 'Iv23.fixture', now: NOW });

afterEach(() => vi.unstubAllGlobals());

describe('Fleetbot GitHub transport on Workers', () => {
  it('completes every bounded credential path when the runtime rejects redirect:error', async () => {
    const calls = workersFetch((url, init) => {
      if (url === `${API}/app`) return Response.json({ slug: 'port-daddy' });
      if (url.includes('/users/')) return Response.json({ id: 286963017, login: 'port-daddy[bot]', type: 'Bot' });
      if (url.endsWith('/installation')) return Response.json({ id: 123 });
      if (url.endsWith('/access_tokens')) return tokenResponse();
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({
        access_token: 'ghu_rotated', expires_in: 28_800,
        refresh_token: 'ghr_rotated', refresh_token_expires_in: 15_897_600,
        scope: '', token_type: 'bearer',
      });
      return Response.json([]);
    });

    await expect(getGitHubAppIdentity('3810450', KEY, kv(), 'installation-fixture')).resolves.toMatchObject({ botName: 'port-daddy[bot]' });
    await expect(getRepoInstallationId('3810450', KEY, 'curiositech', 'port-daddy', kv(), true)).resolves.toBe(123);
    await expect(mint()).resolves.toMatchObject({ token: 'installation-fixture' });
    await expect(revokeInstallationToken('installation-fixture')).resolves.toBe(true);
    await expect(publisher.listAllPages(`${API}/repos/curiositech/port-daddy/comments`, 'installation-fixture')).resolves.toEqual([]);
    await expect(refresh()).resolves.toMatchObject({ accessToken: 'ghu_rotated', refreshToken: 'ghr_rotated' });
    expect(calls).toHaveLength(7);
    expect(calls.every(({ init }) => init.signal instanceof AbortSignal)).toBe(true);
  });

  for (const status of [302, 307]) {
    const redirect = () => new Response(null, { status, headers: { Location: REDIRECT_TARGET } });
    const cases = [
      { name: 'App identity', run: () => getGitHubAppIdentity('3810450', KEY, kv(), 'installation-fixture'), message: `identity lookup failed ${status}` },
      { name: 'bot identity', run: () => getGitHubAppIdentity('3810450', KEY, kv(), 'installation-fixture'), message: `bot identity lookup failed ${status}`, bot: true },
      { name: 'installation lookup', run: () => getRepoInstallationId('3810450', KEY, 'curiositech', 'port-daddy', kv(), true), message: `installation lookup failed ${status}` },
      { name: 'scoped token mint', run: mint, message: `token mint failed ${status}` },
      { name: 'user-token refresh', run: refresh, message: `user-token refresh failed ${status}` },
    ];
    for (const test of cases) {
      it(`refuses ${status} at ${test.name} without forwarding credentials`, async () => {
        const calls = workersFetch((url) => test.bot && url === `${API}/app`
          ? Response.json({ slug: 'port-daddy' }) : redirect());
        await expect(test.run()).rejects.toThrow(test.message);
        expect(calls).toHaveLength(test.bot ? 2 : 1);
        expect(calls.some(({ url }) => url === REDIRECT_TARGET)).toBe(false);
      });
    }

    it(`does not confirm token cleanup after a ${status} revocation`, async () => {
      const calls = workersFetch(redirect);
      await expect(revokeInstallationToken('installation-fixture')).resolves.toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${API}/installation/token`);
    });

    it(`refuses a publisher GET ${status} without following or retrying`, async () => {
      const calls = workersFetch(redirect);
      await expect(publisher.listAllPages(`${API}/repos/curiositech/port-daddy/comments`, 'installation-fixture'))
        .rejects.toMatchObject({ code: 'GITHUB_OPERATION_FAILED', status: 409, ambiguous: false });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain('api.github.com/repos/curiositech/port-daddy/comments');
    });

    it(`keeps publisher POST ${status} ambiguous without following or retrying`, async () => {
      const calls = workersFetch(redirect);
      await expect(publisher.listRequestedReviewers('curiositech', 'port-daddy', 123, 'installation-fixture'))
        .rejects.toMatchObject({ code: 'GITHUB_OPERATION_FAILED', status: 409, ambiguous: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: `${API}/graphql`, init: { method: 'POST' } });
    });
  }

  it('still revokes an issued token rejected for broader authority on Workers', async () => {
    const calls = workersFetch((_url, init) => init.method === 'DELETE'
      ? new Response(null, { status: 204 }) : tokenResponse(true));
    await expect(mint()).rejects.toThrow('exact requested permissions; issued token revocation confirmed');
    expect(calls.map(({ url }) => url)).toEqual([
      `${API}/app/installations/123/access_tokens`, `${API}/installation/token`,
    ]);
  });
});


it.each([401, 302])('revokes the minted publisher token if bot identity lookup fails with %s', async (status) => {
  const now = Math.floor(Date.now() / 1000);
  const action = {
    schema: FLEETBOT_ACTION_SCHEMA, operation: 'pull-request.inspect',
    repository: 'curiositech/port-daddy', sessionId: 'session-auth-test',
    authorship: {
      actorId: 'actor-auth-test', agentId: 'agent-auth-test', sessionId: 'session-auth-test',
      purpose: 'Inspect reviewed work', identityProject: 'port-daddy',
      roadmapItem: 'fleetbot-publisher', sidequestReason: null,
      worktreeId: 'worktree-auth-test', sourceBranch: 'codex/auth-test',
    },
    payload: { baseBranch: 'main', baseSha: '1'.repeat(40), pullRequestNumber: 123, expectedGithubHeadSha: '2'.repeat(40) },
  } as FleetbotActionRequest;
  const requestHash = hashHex(fleetbotIdempotencyPreimage(action));
  action.idempotencyKey = `pd-gh-${requestHash}`;
  action.capability = {
    schema: FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA, grantId: `pdg_${'ab'.repeat(16)}`, grantEpoch: 1,
    daemonFingerprint: '3'.repeat(64), signingKeyGeneration: 1, sessionId: action.sessionId,
    repository: action.repository, operation: action.operation, baseBranch: 'main',
    baseSha: '1'.repeat(40), headSha: '2'.repeat(40), requestHash,
    issuedAt: now - 5, expiresAt: now + 60, nonce: '4'.repeat(64),
  };
  action.capabilitySignature = '5'.repeat(128);
  let intent: Record<string, unknown> | null = null;
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const db = { prepare(sql: string) {
    let args: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { args = values; return statement; },
      async first() {
        if (sql.includes('RETURNING lease_fence')) return { lease_fence: 1 };
        if (sql.includes('SELECT i.request_hash')) return intent;
        return null;
      },
      async run() {
        writes.push({ sql, args });
        if (sql.includes('INSERT OR IGNORE INTO github_publisher_intents')) {
          intent = { request_hash: args[6], state: 'reserved', receipt_json: null, updated_at: now, lease_fence: 0, recovery_binding_json: args[13] };
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return statement;
  } };
  const cache = kv();
  const calls = workersFetch((url, init) => {
    if (url.endsWith('/installation')) return Response.json({ id: 123 });
    if (url.includes('/user/installations/')) return Response.json({
      total_count: 1, repositories: [{ full_name: action.repository, permissions: { pull: true } }],
    });
    if (url.endsWith('/access_tokens')) {
      expect(JSON.parse(String(init.body)).permissions).toEqual({ metadata: 'read', pull_requests: 'read' });
      return Response.json({
        token: 'installation-fixture', expires_at: new Date(Date.now() + 60_000).toISOString(),
        repositories: [{ name: 'port-daddy', full_name: action.repository }],
        permissions: { metadata: 'read', pull_requests: 'read' },
      });
    }
    if (url.endsWith('/app')) return Response.json({ slug: 'port-daddy' });
    if (url.includes('/users/')) {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer installation-fixture');
      return new Response(null, { status, headers: { Location: REDIRECT_TARGET } });
    }
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${url}`);
  });
  const response = await handleFleetbotPublisher(new Request('https://relay.example/v1/fleetbot/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  }), { DB: db, KV: cache, GITHUB_APP_ID: '3810450', GITHUB_APP_PRIVATE_KEY: KEY, RELAY_ED25519_PRIVATE_KEY_HEX: '6'.repeat(64) } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: 'PUBLISHER_FAILED', error: 'publisher failed without exposing credential or transport details' });
  expect(calls.map(({ url }) => url)).toEqual([
    `${API}/repos/curiositech/port-daddy/installation`,
    `${API}/user/installations/123/repositories?per_page=100&page=1`,
    `${API}/app/installations/123/access_tokens`,
    `${API}/app`, `${API}/users/port-daddy%5Bbot%5D`, `${API}/installation/token`,
  ]);
  expect(new Headers(calls.at(-1)!.init.headers).get('Authorization')).toBe('Bearer installation-fixture');
  expect(writes.at(-1)?.args[0]).toBe('failed');
});
