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
    grantId: `pdg_${'ab'.repeat(16)}`,
    grantEpoch: 1,
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
          if (sql.includes('SELECT i.request_hash')) return intent;
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
            intent = { request_hash: args[6] as string, state: 'reserved', receipt_json: null, updated_at: args[14] as number, lease_fence: 0 };
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
  it('requires write authority for every mutation but only read for inspection', () => {
    expect(subject.repositoryAccessFor('pull-request.inspect')).toBe('read');
    for (const operation of [
      'pull-request.publish', 'pull-request.update', 'pull-request.ready',
      'pull-request.request-reviewers', 'pull-request.comment',
      'pull-request.review-reply', 'pull-request.enqueue',
    ] as const) {
      expect(subject.repositoryAccessFor(operation)).toBe('write');
    }
  });

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
    expect(() => subject.validateCapabilityScope(
      parsed.capability, parsed.request, parsed.payload, parsed.requestHash, NOW,
    )).toThrow(expect.objectContaining({ code: 'CAPABILITY_SCOPE_MISMATCH', status: 403 }));
  });

  it('rejects expired capabilities', async () => {
    const expired = await signedEnvelope();
    expired.capability.expiresAt = NOW;
    expired.request.capabilitySignature = await signEd25519(
      PRIVATE_KEY, hashHex(fleetbotPublisherCapabilityPreimage(expired.capability)),
    );
    const parsedExpired = subject.parseRequest(expired.request);
    expect(() => subject.validateCapabilityScope(
      parsedExpired.capability, parsedExpired.request, parsedExpired.payload, parsedExpired.requestHash, NOW,
    )).toThrow(expect.objectContaining({ code: 'CAPABILITY_EXPIRED', status: 401 }));
  });

  it('allows inspect and conversational writes without an owned PR but keeps state changes ownership-gated', async () => {
    const inspect = action();
    const parsedInspect = subject.parseRequest((await signedEnvelope(inspect)).request);
    const rejectingDb = {
      prepare() {
        const statement = {
          bind() { return statement; },
          async all() { return { results: [] }; },
        };
        return statement;
      },
    };
    await expect(subject.publisherHeadBranch(
      { DB: rejectingDb } as never, parsedInspect.request, parsedInspect.payload, 'account-1',
    )).resolves.toBeNull();

    for (const operation of ['pull-request.comment', 'pull-request.review-reply'] as const) {
      const conversation = action();
      conversation.operation = operation;
      conversation.payload = {
        ...conversation.payload,
        body: 'governed conversation',
        ...(operation === 'pull-request.review-reply' ? { commentId: 42 } : {}),
      };
      conversation.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(conversation))}`;
      const parsed = subject.parseRequest((await signedEnvelope(conversation)).request);
      await expect(subject.publisherHeadBranch(
        { DB: rejectingDb } as never, parsed.request, parsed.payload, 'account-1',
      )).resolves.toBeNull();
    }

    for (const operation of [
      'pull-request.ready', 'pull-request.request-reviewers', 'pull-request.enqueue',
    ] as const) {
      const mutation = action();
      mutation.operation = operation;
      if (operation === 'pull-request.request-reviewers') {
        mutation.payload = { ...mutation.payload, reviewers: ['reviewer'], teamReviewers: [] };
      }
      mutation.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(mutation))}`;
      const parsedMutation = subject.parseRequest((await signedEnvelope(mutation)).request);
      await expect(subject.publisherHeadBranch(
        { DB: rejectingDb } as never, parsedMutation.request, parsedMutation.payload, 'account-1',
      )).rejects.toMatchObject({ code: 'PULL_REQUEST_NOT_OWNED', status: 403 });
    }
  });

  it('inspects an exact ordinary pull request without requiring App authorship or a pd-agent branch', async () => {
    const originalFetch = globalThis.fetch;
    const request = action();
    globalThis.fetch = async (input) => {
      expect(String(input)).toContain('/repos/curiositech/port-daddy/pulls/10129');
      return Response.json({
        number: 10129,
        node_id: 'PR_ordinary',
        html_url: 'https://github.test/pull/10129',
        state: 'open',
        draft: false,
        title: 'Contributor change',
        body: '',
        user: { login: 'ordinary-contributor' },
        head: {
          ref: 'feature/contributor-change',
          sha: '2'.repeat(40),
          repo: { full_name: request.repository },
        },
        base: {
          ref: 'main',
          sha: '1'.repeat(40),
          repo: { full_name: request.repository },
        },
      });
    };
    try {
      await expect(subject.executeExisting(
        request,
        request.payload as never,
        'curiositech',
        'port-daddy',
        'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => { throw new Error('inspect must never mutate'); },
      )).resolves.toMatchObject({
        resourceNumber: 10129,
        publishedBranch: 'feature/contributor-change',
        githubHeadSha: '2'.repeat(40),
        result: 'observed',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
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
      user: { login: 'ordinary-contributor' },
      head: { ref: 'feature/security', sha: '2'.repeat(40), repo: { full_name: request.repository } },
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

  it('replies to an exact review comment on an ordinary contributor pull request', async () => {
    const originalFetch = globalThis.fetch;
    let createdBody = '';
    let created = false;
    const request = action();
    request.operation = 'pull-request.review-reply';
    request.payload = {
      baseBranch: 'main', baseSha: '1'.repeat(40), pullRequestNumber: 10129,
      expectedGithubHeadSha: '2'.repeat(40), commentId: 7001,
      body: 'The agent incorporated this review finding.',
    };
    request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
    const pull = {
      number: 10129, node_id: 'PR_node', html_url: 'https://github.test/pull/10129',
      state: 'open', draft: false, title: 'Contributor change', body: '',
      user: { login: 'ordinary-contributor' },
      head: { ref: 'feature/contributor-change', sha: '2'.repeat(40), repo: { full_name: request.repository } },
      base: { ref: 'main', sha: '1'.repeat(40), repo: { full_name: request.repository } },
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/pulls/10129')) return Response.json(pull);
      if (url.endsWith('/pulls/10129/comments/7001/replies') && init?.method === 'POST') {
        createdBody = JSON.parse(String(init.body)).body;
        created = true;
        return Response.json({ id: 9002 });
      }
      if (url.includes('/pulls/10129/comments')) {
        return Response.json(created
          ? [{ id: 9002, body: createdBody, in_reply_to_id: 7001, user: { login: 'port-daddy[bot]' } }]
          : []);
      }
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await expect(subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      )).resolves.toMatchObject({
        resourceNumber: 10129,
        publishedBranch: 'feature/contributor-change',
        githubHeadSha: '2'.repeat(40),
        result: 'created',
      });
      expect(createdBody).toContain('<!-- port-daddy:fleetbot-mutation:github_receipt_');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
