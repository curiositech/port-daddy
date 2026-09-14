import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FLEETBOT_ACTION_SCHEMA,
  FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
  fleetbotIdempotencyPreimage,
  fleetbotPublisherCapabilityPreimage,
  type FleetbotActionRequest,
  type FleetbotPublisherCapability,
} from '../../../lib/github-publisher-contract.js';
import { hashBytes, hashHex, pubKeyFromPrivKey, signEd25519, toHex } from '../src/crypto.js';
import { __fleetbotPublisherTest as subject } from '../src/github-publisher.js';

const PRIVATE_KEY = '19'.repeat(32);
const PUBLIC_KEY = pubKeyFromPrivKey(PRIVATE_KEY);
const FINGERPRINT = toHex(hashBytes(Uint8Array.from(PUBLIC_KEY.match(/../g)!.map((byte) => parseInt(byte, 16)))));
const ACCOUNT_TOKEN = `pdu_${'ab'.repeat(32)}`;
const NOW = 2_000_000_000;

function action(purpose = 'Publish reviewed work'): FleetbotActionRequest {
  const request = {
    schema: FLEETBOT_ACTION_SCHEMA,
    operation: 'pull-request.inspect',
    repository: 'curiositech/port-daddy',
    sessionId: 'session-security-test',
    authorship: {
      actorId: 'actor-security-test',
      agentId: 'fleetbot-security-test',
      sessionId: 'session-security-test',
      purpose,
      identityProject: 'port-daddy',
      roadmapItem: 'fleetbot-publisher',
      sidequestReason: null,
      worktreeId: 'worktree-security-test',
      sourceBranch: 'codex/security-test',
    },
    payload: {
      baseBranch: 'main',
      baseSha: '1'.repeat(40),
      pullRequestNumber: 10129,
      expectedGithubHeadSha: '2'.repeat(40),
    },
  } as FleetbotActionRequest;
  request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
  return request;
}

async function signedEnvelope(request = action(), nonce = '3'.repeat(64), generation = 1) {
  const requestHash = hashHex(fleetbotIdempotencyPreimage(request));
  const capability: FleetbotPublisherCapability = {
    schema: FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
    accountTokenHash: hashHex(ACCOUNT_TOKEN),
    daemonFingerprint: FINGERPRINT,
    signingKeyGeneration: generation,
    sessionId: request.sessionId,
    repository: request.repository,
    operation: request.operation,
    baseBranch: 'main',
    baseSha: '1'.repeat(40),
    headSha: '2'.repeat(40),
    requestHash,
    issuedAt: NOW - 5,
    expiresAt: NOW + 60,
    nonce,
  };
  request.capability = capability;
  request.capabilitySignature = await signEd25519(PRIVATE_KEY, hashHex(fleetbotPublisherCapabilityPreimage(capability)));
  return { request, capability, signature: request.capabilitySignature, requestHash };
}

function authorityDb(generation = 1) {
  let use: Record<string, unknown> | null = null;
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first() {
          if (sql.includes('FROM identities')) {
            return { pub_key: PUBLIC_KEY, expires_at: NOW + 1_000, revoked: 0, key_generation: generation };
          }
          if (sql.includes('FROM github_publisher_capability_uses')) return use;
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO github_publisher_capability_uses') && !use) {
            use = {
              account_user_id: args[3], account_token_hash: args[4],
              request_hash: args[5], idempotency_key: args[6],
            };
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function intentDb() {
  let intent: {
    request_hash: string;
    state: string;
    receipt_json: null;
    updated_at: number;
    lease_fence: number;
  } | null = null;
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first() {
          if (sql.includes('SELECT request_hash')) return intent;
          if (sql.includes('RETURNING lease_fence')) {
            const now = args[0] as number;
            const staleBefore = args.at(-1) as number;
            if (!intent || !(intent.state === 'reserved' || intent.state === 'ambiguous'
                || intent.state === 'failed' || (intent.state === 'running' && intent.updated_at < staleBefore))) return null;
            intent.state = 'running';
            intent.updated_at = now;
            intent.lease_fence += 1;
            return { lease_fence: intent.lease_fence };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO github_publisher_intents') && !intent) {
            intent = { request_hash: args[6] as string, state: 'reserved', receipt_json: null, updated_at: args[15] as number, lease_fence: 0 };
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('AND state = \'running\' AND lease_fence = ?')) {
            const fence = args.at(-1);
            const changes = intent?.state === 'running' && intent.lease_fence === fence ? 1 : 0;
            if (changes) intent!.state = args[0] as string;
            return { success: true, meta: { changes } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('Fleetbot publisher authority hardening', () => {
  it('derives exact Git object addresses for ambiguity readback', () => {
    expect(subject.gitObjectSha('blob', new TextEncoder().encode('hello\n')))
      .toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    const app = { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' };
    const message = 'Governed commit\n\nRoadmap-Item: publisher';
    const tree = '1'.repeat(40);
    const parent = '2'.repeat(40);
    const timestamp = 2_000_000_000;
    const actor = `${app.botName} <${app.botEmail}> ${timestamp} +0000`;
    const content = [`tree ${tree}`, `parent ${parent}`, `author ${actor}`, `committer ${actor}`, '', message].join('\n');
    const bytes = Buffer.from(content);
    const independentlyHashed = createHash('sha1')
      .update(Buffer.concat([Buffer.from(`commit ${bytes.length}\0`), bytes]))
      .digest('hex');
    expect(subject.expectedCommitSha(tree, parent, message, app, timestamp)).toBe(independentlyHashed);
  });

  it('bounds the complete request before JSON parsing', async () => {
    const request = new Request('https://relay.example/v1/fleetbot/publish', {
      method: 'POST',
      headers: { 'Content-Length': String(subject.maxOuterRequestBytes + 1) },
      body: '{}',
    });
    await expect(subject.readBoundedJson(request)).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', status: 413 });
  });

  it('rejects forged provenance even when the attacker recomputes idempotency', async () => {
    const original = await signedEnvelope();
    const forged = action('Forged replacement purpose');
    forged.capability = original.capability;
    forged.capabilitySignature = original.signature;
    const parsed = subject.parseRequest(forged);
    const env = { DB: authorityDb() } as never;
    await expect(subject.verifyAndConsumeCapability(
      env, parsed.capability, parsed.capabilitySignature, parsed.request, parsed.payload,
      parsed.requestHash, hashHex(ACCOUNT_TOKEN), 'account-1', NOW,
    )).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_MISMATCH', status: 403 });
  });

  it('rejects nonce replay for different exact content', async () => {
    const db = authorityDb();
    const first = await signedEnvelope();
    const parsedFirst = subject.parseRequest(first.request);
    const env = { DB: db } as never;
    await subject.verifyAndConsumeCapability(
      env, parsedFirst.capability, parsedFirst.capabilitySignature, parsedFirst.request,
      parsedFirst.payload, parsedFirst.requestHash, hashHex(ACCOUNT_TOKEN), 'account-1', NOW,
    );

    const second = await signedEnvelope(action('A different authorized action'), first.capability.nonce);
    const parsedSecond = subject.parseRequest(second.request);
    await expect(subject.verifyAndConsumeCapability(
      env, parsedSecond.capability, parsedSecond.capabilitySignature, parsedSecond.request,
      parsedSecond.payload, parsedSecond.requestHash, hashHex(ACCOUNT_TOKEN), 'account-1', NOW,
    )).rejects.toMatchObject({ code: 'CAPABILITY_REPLAY', status: 409 });
  });

  it('rejects expired capabilities and signing-key rotation', async () => {
    const expired = await signedEnvelope();
    expired.capability.expiresAt = NOW;
    expired.request.capabilitySignature = await signEd25519(
      PRIVATE_KEY, hashHex(fleetbotPublisherCapabilityPreimage(expired.capability)),
    );
    const parsedExpired = subject.parseRequest(expired.request);
    await expect(subject.verifyAndConsumeCapability(
      { DB: authorityDb() } as never, parsedExpired.capability, parsedExpired.capabilitySignature,
      parsedExpired.request, parsedExpired.payload, parsedExpired.requestHash,
      hashHex(ACCOUNT_TOKEN), 'account-1', NOW,
    )).rejects.toMatchObject({ code: 'CAPABILITY_EXPIRED', status: 401 });

    const rotated = await signedEnvelope();
    const parsedRotated = subject.parseRequest(rotated.request);
    await expect(subject.verifyAndConsumeCapability(
      { DB: authorityDb(2) } as never, parsedRotated.capability, parsedRotated.capabilitySignature,
      parsedRotated.request, parsedRotated.payload, parsedRotated.requestHash,
      hashHex(ACCOUNT_TOKEN), 'account-1', NOW,
    )).rejects.toMatchObject({ code: 'CAPABILITY_SIGNATURE_INVALID', status: 401 });
  });

  it('paginates past 100 GitHub records before deciding a marker is absent', async () => {
    const originalFetch = globalThis.fetch;
    const pages: number[] = [];
    globalThis.fetch = async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      pages.push(page);
      return Response.json(page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
        : [{ id: 101 }]);
    };
    try {
      const rows = await subject.listAllPages<{ id: number }>('https://api.github.test/comments', 'token');
      expect(rows).toHaveLength(101);
      expect(pages).toEqual([1, 2]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('prevents a stale lease holder from finalizing after takeover', async () => {
    const key = {
      accountUserId: 'account-1', accountGithubUserId: 1, installationId: 2,
      repository: 'curiositech/port-daddy', scopeSha: '1'.repeat(40),
      idempotencyKey: `pd-gh-${'4'.repeat(64)}`, requestHash: '4'.repeat(64),
      operation: 'pull-request.inspect', authorship: action().authorship!,
    };
    const env = { DB: intentDb() } as never;
    const first = await subject.reserveIntent(env, key, NOW);
    const second = await subject.reserveIntent(env, key, NOW + 601);
    expect(first).toEqual({ fence: 1 });
    expect(second).toEqual({ fence: 2 });
    await expect(subject.finishIntent(env, key, 1, 'failed', NOW + 602, { errorCode: 'STALE' }))
      .rejects.toMatchObject({ code: 'INTENT_FINALIZE_FAILED' });
  });

  it('reads back an exact stable marker after GitHub loses a successful response', async () => {
    const originalFetch = globalThis.fetch;
    let createdBody = '';
    let created = false;
    const request = action();
    request.operation = 'pull-request.comment';
    request.payload = {
      baseBranch: 'main', baseSha: '1'.repeat(40), pullRequestNumber: 10129,
      expectedGithubHeadSha: '2'.repeat(40), body: 'The requested security changes are incorporated.',
    };
    request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
    const pull = {
      number: 10129, node_id: 'PR_node', html_url: 'https://github.test/pull/10129',
      state: 'open', draft: false, title: 'Publisher', body: '',
      user: { login: 'port-daddy[bot]' },
      head: { ref: 'pd-agent/security', sha: '2'.repeat(40), repo: { full_name: request.repository } },
      base: { ref: 'main', sha: '1'.repeat(40), repo: { full_name: request.repository } },
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/pulls/10129')) return Response.json(pull);
      if (url.includes('/issues/10129/comments') && init?.method === 'POST') {
        createdBody = JSON.parse(String(init.body)).body;
        created = true;
        throw new Error('response lost after GitHub accepted the write');
      }
      if (url.includes('/issues/10129/comments')) {
        return Response.json(created
          ? [{ id: 9001, body: createdBody, user: { login: 'port-daddy[bot]' } }]
          : []);
      }
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      const result = await subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      );
      expect(result.result).toBe('created');
      expect(createdBody).toContain('<!-- port-daddy:fleetbot-mutation:github_receipt_');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
