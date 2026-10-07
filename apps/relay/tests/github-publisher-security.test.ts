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

function reviewerAction(reviewers: string[], teamReviewers: string[]): FleetbotActionRequest {
  const request = action();
  request.operation = 'pull-request.request-reviewers';
  request.payload = {
    baseBranch: 'main',
    baseSha: '1'.repeat(40),
    pullRequestNumber: 10129,
    expectedGithubHeadSha: '2'.repeat(40),
    reviewers,
    teamReviewers,
  };
  request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
  return request;
}

function enqueueAction(): FleetbotActionRequest {
  const request = action();
  request.operation = 'pull-request.enqueue';
  request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
  return request;
}

const fleetbotPull = {
  number: 10129,
  node_id: 'PR_node',
  html_url: 'https://github.test/pull/10129',
  state: 'open',
  draft: false,
  title: 'Publisher',
  body: '',
  user: { login: 'port-daddy[bot]' },
  head: {
    ref: 'pd-agent/security-test',
    sha: '2'.repeat(40),
    repo: { full_name: 'curiositech/port-daddy' },
  },
  base: {
    ref: 'main',
    sha: '1'.repeat(40),
    repo: { full_name: 'curiositech/port-daddy' },
  },
};

function reviewRequestsResponse(
  nodes: Array<{ requestedReviewer: { __typename: 'User'; login: string } | { __typename: 'Team'; slug: string } }>,
  hasNextPage: boolean,
  endCursor: string | null,
): Response {
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          reviewRequests: { nodes, pageInfo: { hasNextPage, endCursor } },
        },
      },
    },
  });
}

function reviewThreadsResponse(
  isResolved: boolean[],
  hasNextPage: boolean,
  endCursor: string | null,
): Response {
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: isResolved.map((resolved) => ({ isResolved: resolved })),
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    },
  });
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
    recovery_binding_json: string;
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
            intent = {
              request_hash: args[6] as string,
              state: 'reserved',
              receipt_json: null,
              updated_at: args[14] as number,
              lease_fence: 0,
              recovery_binding_json: args[13] as string,
            };
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
  it('requests Workflows write only when a committed change touches a workflow file', () => {
    const payload = (path: string, deleting = false) => ({
      baseBranch: 'main',
      baseSha: '1'.repeat(40),
      sourceHeadSha: '2'.repeat(40),
      sourceTreeSha: '3'.repeat(40),
      sourceCommittedAt: NOW,
      commitMessage: 'Publish reviewed work',
      changes: [deleting ? { path, delete: true } : { path, mode: '100644', contentBase64: 'YQ==' }],
      title: 'Publish reviewed work',
      body: 'Reviewed work',
      draft: false,
    }) as unknown as Parameters<typeof subject.permissionsFor>[1];

    expect(subject.permissionsFor('pull-request.publish', payload('src/index.ts')))
      .toEqual({ contents: 'write', pull_requests: 'write' });
    expect(subject.permissionsFor('pull-request.publish', payload('.github/workflows/ci.yml')))
      .toEqual({ contents: 'write', pull_requests: 'write', workflows: 'write' });
    expect(subject.permissionsFor('pull-request.update', payload('.github/workflows/old.yml', true)))
      .toEqual({ contents: 'write', pull_requests: 'write', workflows: 'write' });
    expect(subject.permissionsFor('pull-request.publish', payload('.github/workflows-notes/README.md')))
      .toEqual({ contents: 'write', pull_requests: 'write' });
    expect(subject.permissionsFor('pull-request.inspect', payload('src/index.ts')))
      .toEqual({ pull_requests: 'read' });
  });

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

  it('paginates more than 100 combined requested users and teams by GraphQL cursor', async () => {
    const originalFetch = globalThis.fetch;
    const cursors: Array<string | null> = [];
    globalThis.fetch = async (_input, init) => {
      const after = JSON.parse(String(init?.body)).variables.after as string | null;
      cursors.push(after);
      if (after === null) {
        return reviewRequestsResponse([
          ...Array.from({ length: 50 }, (_, index) => ({ requestedReviewer: { __typename: 'User' as const, login: `user-${index}` } })),
          ...Array.from({ length: 50 }, (_, index) => ({ requestedReviewer: { __typename: 'Team' as const, slug: `team-${index}` } })),
        ], true, 'cursor-100');
      }
      return reviewRequestsResponse([
        { requestedReviewer: { __typename: 'User', login: 'late-user' } },
        { requestedReviewer: { __typename: 'Team', slug: 'late-team' } },
      ], false, 'cursor-102');
    };
    try {
      const rows = await subject.listRequestedReviewers('curiositech', 'port-daddy', 10129, 'token');
      expect(rows.users).toHaveLength(51);
      expect(rows.teams).toHaveLength(51);
      expect(rows.users.at(-1)?.login).toBe('late-user');
      expect(rows.teams.at(-1)?.slug).toBe('late-team');
      expect(cursors).toEqual([null, 'cursor-100']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reuses reviewer requests found only after the first page', async () => {
    const originalFetch = globalThis.fetch;
    const request = reviewerAction(['late-user'], ['late-team']);
    let posts = 0;
    const cursors: Array<string | null> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls/10129')) return Response.json(fleetbotPull);
      if (url.pathname.endsWith('/requested_reviewers') && init?.method === 'POST') {
        posts += 1;
        return Response.json({});
      }
      if (url.pathname.endsWith('/graphql')) {
        const after = JSON.parse(String(init?.body)).variables.after as string | null;
        cursors.push(after);
        if (after === null) {
          return reviewRequestsResponse([
            ...Array.from({ length: 50 }, (_, index) => ({ requestedReviewer: { __typename: 'User' as const, login: `user-${index}` } })),
            ...Array.from({ length: 50 }, (_, index) => ({ requestedReviewer: { __typename: 'Team' as const, slug: `team-${index}` } })),
          ], true, 'cursor-100');
        }
        return reviewRequestsResponse([
          { requestedReviewer: { __typename: 'User', login: 'late-user' } },
          { requestedReviewer: { __typename: 'Team', slug: 'late-team' } },
        ], false, 'cursor-102');
      }
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await expect(subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      )).resolves.toMatchObject({ result: 'reused' });
      expect(posts).toBe(0);
      expect(cursors).toEqual([null, 'cursor-100']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails ambiguous when a reviewer write does not appear in complete readback', async () => {
    const originalFetch = globalThis.fetch;
    const request = reviewerAction(['missing-user'], ['missing-team']);
    let postAccepted = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls/10129')) return Response.json(fleetbotPull);
      if (url.pathname.endsWith('/requested_reviewers') && init?.method === 'POST') {
        postAccepted = true;
        return Response.json({});
      }
      if (url.pathname.endsWith('/graphql')) return reviewRequestsResponse([], false, null);
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await expect(subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      )).rejects.toMatchObject({ code: 'REVIEWER_REQUEST_AMBIGUOUS', status: 409, ambiguous: true });
      expect(postAccepted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects reviewer success when the pull-request head moves after the write', async () => {
    const originalFetch = globalThis.fetch;
    const request = reviewerAction(['new-reviewer'], []);
    let pullReads = 0;
    let requested = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls/10129')) {
        pullReads += 1;
        return Response.json(pullReads === 1 ? fleetbotPull : {
          ...fleetbotPull,
          head: { ...fleetbotPull.head, sha: '3'.repeat(40) },
        });
      }
      if (url.pathname.endsWith('/requested_reviewers') && init?.method === 'POST') {
        requested = true;
        return Response.json({});
      }
      if (url.pathname.endsWith('/graphql')) {
        return requested
          ? reviewRequestsResponse([{ requestedReviewer: { __typename: 'User', login: 'new-reviewer' } }], false, null)
          : reviewRequestsResponse([], false, null);
      }
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await expect(subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      )).rejects.toMatchObject({ code: 'PULL_REQUEST_SCOPE_CHANGED', status: 409 });
      expect(requested).toBe(true);
      expect(pullReads).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(['pull-request.comment', 'pull-request.review-reply'] as const)(
    'rejects %s success when the pull-request head moves after the write',
    async (operation) => {
      const originalFetch = globalThis.fetch;
      const request = action();
      request.operation = operation;
      request.payload = {
        baseBranch: 'main', baseSha: '1'.repeat(40), pullRequestNumber: 10129,
        expectedGithubHeadSha: '2'.repeat(40), body: 'Scoped Fleetbot response.',
        ...(operation === 'pull-request.review-reply' ? { commentId: 7001 } : {}),
      };
      request.idempotencyKey = `pd-gh-${hashHex(fleetbotIdempotencyPreimage(request))}`;
      const ordinaryPull = {
        ...fleetbotPull,
        user: { login: 'ordinary-contributor' },
        head: { ...fleetbotPull.head, ref: 'feature/contributor-change' },
      };
      let pullReads = 0;
      let createdBody = '';
      let created = false;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/pulls/10129')) {
          pullReads += 1;
          return Response.json(pullReads === 1 ? ordinaryPull : {
            ...ordinaryPull,
            head: { ...ordinaryPull.head, sha: '3'.repeat(40) },
          });
        }
        const isReplyPost = url.pathname.endsWith('/pulls/10129/comments/7001/replies') && init?.method === 'POST';
        const isCommentPost = url.pathname.endsWith('/issues/10129/comments') && init?.method === 'POST';
        if (isReplyPost || isCommentPost) {
          createdBody = JSON.parse(String(init?.body)).body;
          created = true;
          return Response.json({ id: 9001 });
        }
        if (url.pathname.endsWith('/pulls/10129/comments')) {
          return Response.json(created ? [{
            id: 9001, html_url: 'https://github.test/pull/10129#discussion_r9001', body: createdBody,
            in_reply_to_id: 7001, user: { login: 'port-daddy[bot]' },
          }] : []);
        }
        if (url.pathname.endsWith('/issues/10129/comments')) {
          return Response.json(created ? [{
            id: 9001, html_url: 'https://github.test/pull/10129#issuecomment-9001', body: createdBody,
            user: { login: 'port-daddy[bot]' },
          }] : []);
        }
        throw new Error(`unexpected GitHub request: ${url}`);
      };
      try {
        await expect(subject.executeExisting(
          request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
          { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
          () => {},
        )).rejects.toMatchObject({ code: 'PULL_REQUEST_SCOPE_CHANGED', status: 409 });
        expect(created).toBe(true);
        expect(pullReads).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('rejects malformed requested-reviewer union members', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      data: {
        repository: {
          pullRequest: {
            reviewRequests: {
              nodes: [{ requestedReviewer: { __typename: 'User' } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
    try {
      await expect(subject.listRequestedReviewers('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_INVALID', status: 502 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a non-advancing requested-reviewer cursor', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return reviewRequestsResponse([], true, 'stuck-cursor');
    };
    try {
      await expect(subject.listRequestedReviewers('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_INVALID', status: 502 });
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('bounds a continuously advancing requested-reviewer connection', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return reviewRequestsResponse([], true, `cursor-${calls}`);
    };
    try {
      await expect(subject.listRequestedReviewers('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_TOO_LARGE', status: 409 });
      expect(calls).toBe(100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('finds an unresolved review thread after more than 100 resolved threads', async () => {
    const originalFetch = globalThis.fetch;
    const cursors: Array<string | null> = [];
    globalThis.fetch = async (_input, init) => {
      const after = JSON.parse(String(init?.body)).variables.after as string | null;
      cursors.push(after);
      return after === null
        ? reviewThreadsResponse(Array.from({ length: 100 }, () => true), true, 'threads-100')
        : reviewThreadsResponse([false], false, 'threads-101');
    };
    try {
      await expect(subject.assertNoUnresolvedReviewThreads('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'PULL_REQUEST_REVIEWS_UNRESOLVED', status: 409 });
      expect(cursors).toEqual([null, 'threads-100']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects malformed and non-advancing review-thread connections', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: 'yes' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
    try {
      await expect(subject.assertNoUnresolvedReviewThreads('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_INVALID', status: 502 });
    } finally {
      globalThis.fetch = originalFetch;
    }

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return reviewThreadsResponse([], true, 'stuck-thread-cursor');
    };
    try {
      await expect(subject.assertNoUnresolvedReviewThreads('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_INVALID', status: 502 });
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('bounds a continuously advancing review-thread connection', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return reviewThreadsResponse([], true, `thread-cursor-${calls}`);
    };
    try {
      await expect(subject.assertNoUnresolvedReviewThreads('curiositech', 'port-daddy', 10129, 'token'))
        .rejects.toMatchObject({ code: 'GITHUB_LIST_TOO_LARGE', status: 409 });
      expect(calls).toBe(100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('enqueues only after all review threads resolve and exact PR scope reads back', async () => {
    const originalFetch = globalThis.fetch;
    const request = enqueueAction();
    let enqueued = false;
    let threadScans = 0;
    let pullReads = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls/10129')) {
        pullReads += 1;
        return Response.json(fleetbotPull);
      }
      if (url.pathname.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes('reviewThreads(')) {
          threadScans += 1;
          return reviewThreadsResponse([true, true], false, null);
        }
        if (body.query.includes('enqueuePullRequest')) {
          enqueued = true;
          return Response.json({ data: { enqueuePullRequest: { mergeQueueEntry: { id: 'MQ_1' } } } });
        }
        if (body.query.includes('mergeQueueEntry')) {
          return Response.json({ data: { repository: { pullRequest: {
            id: fleetbotPull.node_id,
            headRefOid: fleetbotPull.head.sha,
            mergeQueueEntry: enqueued ? { id: 'MQ_1' } : null,
          } } } });
        }
      }
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await expect(subject.executeExisting(
        request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
        { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
        () => {},
      )).resolves.toMatchObject({ result: 'updated', githubHeadSha: '2'.repeat(40) });
      expect(enqueued).toBe(true);
      expect(threadScans).toBe(2);
      expect(pullReads).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(['head', 'base'] as const)(
    'rejects enqueue success when the pull-request %s moves after queue admission',
    async (moved) => {
      const originalFetch = globalThis.fetch;
      const request = enqueueAction();
      let enqueued = false;
      let pullReads = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/pulls/10129')) {
          pullReads += 1;
          if (pullReads === 1) return Response.json(fleetbotPull);
          return Response.json(moved === 'head'
            ? { ...fleetbotPull, head: { ...fleetbotPull.head, sha: '3'.repeat(40) } }
            : { ...fleetbotPull, base: { ...fleetbotPull.base, sha: '3'.repeat(40) } });
        }
        if (url.pathname.endsWith('/graphql')) {
          const body = JSON.parse(String(init?.body)) as { query: string };
          if (body.query.includes('reviewThreads(')) return reviewThreadsResponse([true], false, null);
          if (body.query.includes('enqueuePullRequest')) {
            enqueued = true;
            return Response.json({ data: { enqueuePullRequest: { mergeQueueEntry: { id: 'MQ_1' } } } });
          }
          if (body.query.includes('mergeQueueEntry')) {
            return Response.json({ data: { repository: { pullRequest: {
              id: fleetbotPull.node_id,
              headRefOid: fleetbotPull.head.sha,
              mergeQueueEntry: enqueued ? { id: 'MQ_1' } : null,
            } } } });
          }
        }
        throw new Error(`unexpected GitHub request: ${url}`);
      };
      try {
        await expect(subject.executeExisting(
          request, request.payload as never, 'curiositech', 'port-daddy', 'installation-token',
          { id: 1, slug: 'port-daddy', botName: 'port-daddy[bot]', botEmail: 'bot@example.test' },
          () => {},
        )).rejects.toMatchObject({ code: 'PULL_REQUEST_SCOPE_CHANGED', status: 409 });
        expect(enqueued).toBe(true);
        expect(pullReads).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('prevents a stale lease holder from finalizing after takeover', async () => {
    const key = {
      accountUserId: 'account-1', accountGithubUserId: 1, installationId: 2,
      repository: 'curiositech/port-daddy', scopeSha: '1'.repeat(40),
      idempotencyKey: `pd-gh-${'4'.repeat(64)}`, requestHash: '4'.repeat(64),
      operation: 'pull-request.inspect', authorship: action().authorship!,
      grantId: `pdg_${'ab'.repeat(16)}`, grantEpoch: 1,
      recoveryBinding: {
        grantId: `pdg_${'ab'.repeat(16)}`, grantEpoch: 1,
        repository: 'curiositech/port-daddy', operation: 'pull-request.inspect',
        baseBranch: 'main', baseSha: '1'.repeat(40), headSha: '2'.repeat(40),
        sessionId: action().authorship!.sessionId,
        requestHash: '4'.repeat(64), idempotencyKey: `pd-gh-${'4'.repeat(64)}`,
      },
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
          ? [{ id: 9001, html_url: 'https://github.test/pull/10129#issuecomment-9001', body: createdBody, user: { login: 'port-daddy[bot]' } }]
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
      expect(result.resourceUrl).toBe('https://github.test/pull/10129#issuecomment-9001');
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
          ? [{ id: 9002, html_url: 'https://github.test/pull/10129#discussion_r9002', body: createdBody, in_reply_to_id: 7001, user: { login: 'port-daddy[bot]' } }]
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
        resourceUrl: 'https://github.test/pull/10129#discussion_r9002',
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
