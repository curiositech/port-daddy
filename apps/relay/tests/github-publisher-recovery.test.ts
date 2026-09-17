import { describe, expect, it } from 'vitest';
import {
  FLEETBOT_RECEIPT_READ_SCHEMA,
  FLEETBOT_RECEIPT_SCHEMA,
  fleetbotReceiptId,
  fleetbotReceiptPreimage,
  fleetbotReceiptReadProofPreimage,
  stableJson,
  type FleetbotReceipt,
  type FleetbotReceiptReadProof,
  type FleetbotReceiptRecoveryBinding,
} from '../../../lib/github-publisher-contract.js';
import { fromHex, hashBytes, hashHex, pubKeyFromPrivKey, signEd25519, toHex } from '../src/crypto.js';
import { __fleetbotPublisherTest, handleFleetbotPublisherReceiptRecovery } from '../src/github-publisher.js';
import type { Env } from '../src/types.js';

const NOW = Math.floor(Date.now() / 1000);
const WORKLOAD_PRIVATE_KEY = '11'.repeat(32);
const RELAY_PRIVATE_KEY = '22'.repeat(32);
const WORKLOAD_PUBLIC_KEY = pubKeyFromPrivKey(WORKLOAD_PRIVATE_KEY);
const FINGERPRINT = toHex(hashBytes(fromHex(WORKLOAD_PUBLIC_KEY)));
const GRANT_ID = `pdg_${'ab'.repeat(16)}`;
const REPOSITORY = 'curiositech/port-daddy';
const REQUEST_HASH = '4'.repeat(64);
const IDEMPOTENCY_KEY = `pd-gh-${REQUEST_HASH}`;

const binding: FleetbotReceiptRecoveryBinding = {
  grantId: GRANT_ID,
  grantEpoch: 1,
  repository: REPOSITORY,
  operation: 'pull-request.comment',
  baseBranch: 'main',
  baseSha: '1'.repeat(40),
  headSha: '2'.repeat(40),
  sessionId: 'session-recovery-test',
  requestHash: REQUEST_HASH,
  idempotencyKey: IDEMPOTENCY_KEY,
};

async function signedProof(overrides: Partial<FleetbotReceiptReadProof> = {}) {
  const proof: FleetbotReceiptReadProof = {
    schema: FLEETBOT_RECEIPT_READ_SCHEMA,
    method: 'POST',
    path: '/v1/fleetbot/publisher-receipts/recover',
    daemonFingerprint: FINGERPRINT,
    signingKeyGeneration: 1,
    issuedAt: NOW,
    nonce: '3'.repeat(64),
    binding,
    ...overrides,
  };
  return {
    proof,
    proofSignature: await signEd25519(
      WORKLOAD_PRIVATE_KEY,
      hashHex(fleetbotReceiptReadProofPreimage(proof)),
    ),
  };
}

async function signedReceipt(): Promise<FleetbotReceipt> {
  const unsigned: Omit<FleetbotReceipt, 'signature'> = {
    schema: FLEETBOT_RECEIPT_SCHEMA,
    receiptId: fleetbotReceiptId(IDEMPOTENCY_KEY),
    authority: 'port-daddy-relay-github-app',
    appSlug: 'port-daddy',
    operation: binding.operation,
    repository: REPOSITORY,
    idempotencyKey: IDEMPOTENCY_KEY,
    accountUserId: 'account-1',
    accountGithubUserId: 7,
    authorizedBy: { grantId: GRANT_ID, grantEpoch: 1, surface: 'publisher' },
    admission: 'standing-publisher-grant',
    actorId: 'actor-recovery-test',
    agentId: 'agent-recovery-test',
    sessionId: binding.sessionId,
    roadmapItem: 'fleetbot-pr-authorship',
    resourceUrl: 'https://github.test/pull/10287#issuecomment-1',
    resourceNumber: 1,
    publishedBranch: null,
    sourceHeadSha: null,
    githubHeadSha: binding.headSha,
    result: 'created',
    verifiedAt: NOW - 2,
    relayPublicKey: pubKeyFromPrivKey(RELAY_PRIVATE_KEY),
    tokenCleanup: 'confirmed',
  };
  return {
    ...unsigned,
    signature: await signEd25519(RELAY_PRIVATE_KEY, hashHex(fleetbotReceiptPreimage(unsigned))),
  };
}

function recoveryEnv(input: {
  state?: 'reserved' | 'running' | 'ambiguous' | 'failed' | 'succeeded';
  bindingJson?: string | null;
  receipt?: FleetbotReceipt | null;
  includeIntent?: boolean;
  writes?: string[];
  grantExpiresAt?: number;
  grantRevokedAt?: number | null;
  identityGeneration?: number;
  identityRevoked?: number;
  relayPrivateKey?: string;
}): Env {
  const writes = input.writes ?? [];
  const statementFor = (sql: string) => {
    const statement = {
      bind() { return statement; },
      async first() {
        if (sql.includes('FROM publisher_grants')) {
          return {
            grant_id: GRANT_ID, epoch: 1, surface: 'publisher', account_user_id: 'account-1',
            subject_fingerprint: FINGERPRINT, subject_class: 'ci', installation_id: 99,
            repositories_json: JSON.stringify([REPOSITORY]),
            operations_json: JSON.stringify([binding.operation]),
            branch_allow_json: JSON.stringify(['pd-agent/']),
            base_allow_json: JSON.stringify(['main']), mutations_per_day: 25,
            expires_at: input.grantExpiresAt ?? NOW + 1_000,
            revoked_at: input.grantRevokedAt ?? null,
          };
        }
        if (sql.includes('FROM identities')) {
          return {
            pub_key: WORKLOAD_PUBLIC_KEY, proof_method: 'oidc', expires_at: NOW + 1_000,
            revoked: input.identityRevoked ?? 0, key_generation: input.identityGeneration ?? 1,
          };
        }
        if (sql.includes('FROM github_publisher_capability_uses_v2')) {
          return {
            daemon_fingerprint: FINGERPRINT, signing_key_generation: 1,
            grant_id: GRANT_ID, grant_epoch: 1, session_id: binding.sessionId,
            request_hash: REQUEST_HASH, idempotency_key: IDEMPOTENCY_KEY, is_mutation: 1,
          };
        }
        if (sql.includes('FROM github_publisher_intents')) {
          if (input.includeIntent === false) return null;
          const receipt = input.receipt === undefined ? await signedReceipt() : input.receipt;
          return {
            account_user_id: 'account-1', account_github_user_id: 7, installation_id: 99,
            repository: REPOSITORY, scope_sha: binding.baseSha, idempotency_key: IDEMPOTENCY_KEY,
            request_hash: REQUEST_HASH, operation: binding.operation, state: input.state ?? 'succeeded',
            actor_id: 'actor-recovery-test', agent_id: 'agent-recovery-test', session_id: binding.sessionId,
            identity_project: 'port-daddy', roadmap_item: 'fleetbot-pr-authorship',
            resource_number: 1, resource_url: 'https://github.test/pull/10287#issuecomment-1',
            published_branch: null, github_head_sha: binding.headSha,
            receipt_json: receipt ? JSON.stringify(receipt) : null, error_code: null,
            updated_at: NOW, lease_fence: 1,
            recovery_binding_json: input.bindingJson === undefined ? stableJson(binding) : input.bindingJson,
          };
        }
        return null;
      },
      async all() { return { results: [] }; },
      async run() { writes.push(sql); throw new Error('receipt recovery attempted a database write'); },
    };
    return statement;
  };
  return {
    DB: { prepare: statementFor } as unknown as D1Database,
    KV: {} as KVNamespace,
    HARBOR_CHANNEL: {} as DurableObjectNamespace,
    RELAY_ED25519_PRIVATE_KEY_HEX: input.relayPrivateKey ?? RELAY_PRIVATE_KEY,
  } as Env;
}

function recoveryRequest(body: unknown): Request {
  return new Request('https://relay.example/v1/fleetbot/publisher-receipts/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Fleetbot publisher receipt recovery', () => {
  it('preserves ordinary exact reuse for a succeeded pre-migration intent', async () => {
    const receipt = await signedReceipt();
    const statementFor = (sql: string) => {
      const statement = {
        bind() { return statement; },
        async run() { return { success: true, meta: { changes: 0 } }; },
        async first() {
          if (!sql.includes('SELECT i.request_hash')) return null;
          return {
            request_hash: REQUEST_HASH,
            state: 'succeeded',
            receipt_json: JSON.stringify(receipt),
            updated_at: NOW,
            lease_fence: 1,
            recovery_binding_json: null,
          };
        },
      };
      return statement;
    };
    const result = await __fleetbotPublisherTest.reserveIntent({
      DB: { prepare: statementFor } as unknown as D1Database,
      RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIVATE_KEY,
    } as never, {
      accountUserId: 'account-1', accountGithubUserId: 7, installationId: 99,
      repository: REPOSITORY, scopeSha: binding.baseSha,
      idempotencyKey: IDEMPOTENCY_KEY, requestHash: REQUEST_HASH,
      operation: binding.operation,
      authorship: {
        actorId: 'actor-recovery-test', agentId: 'agent-recovery-test',
        sessionId: binding.sessionId, purpose: 'legacy exact reuse',
        identityProject: 'port-daddy', roadmapItem: 'fleetbot-pr-authorship',
        sidequestReason: null, worktreeId: null, sourceBranch: null,
      },
      grantId: GRANT_ID, grantEpoch: 1, recoveryBinding: binding,
    }, NOW);
    expect(result).toMatchObject({ reused: { receiptId: receipt.receiptId } });
  });

  it('rejects an oversized envelope before parsing JSON', async () => {
    const request = new Request('https://relay.example/v1/fleetbot/publisher-receipts/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '20000' },
      body: '{',
    });
    const response = await handleFleetbotPublisherReceiptRecovery(request, recoveryEnv({}));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'REQUEST_TOO_LARGE' });
  });

  it('returns the original signed receipt without any GitHub or database write', async () => {
    const originalFetch = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = async () => { throw new Error('receipt recovery must never call GitHub'); };
    try {
      const response = await handleFleetbotPublisherReceiptRecovery(
        recoveryRequest(await signedProof()),
        recoveryEnv({ writes }),
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({
        code: 'OK', recovered: true,
        receipt: { receiptId: fleetbotReceiptId(IDEMPOTENCY_KEY), idempotencyKey: IDEMPOTENCY_KEY },
      });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(writes).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ['reserved', 'INTENT_IN_PROGRESS'],
    ['running', 'INTENT_IN_PROGRESS'],
    ['ambiguous', 'INTENT_AMBIGUOUS'],
    ['failed', 'INTENT_FAILED'],
  ] as const)('fails closed for %s intents', async (state, code) => {
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(await signedProof()),
      recoveryEnv({ state }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code });
  });

  it('does not infer recovery authority for legacy intents', async () => {
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(await signedProof()),
      recoveryEnv({ bindingJson: null }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RECOVERY_BINDING_UNAVAILABLE' });
  });

  it('does not turn a missing intent into a fresh dispatch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('missing recovery intent must not call GitHub'); };
    try {
      const response = await handleFleetbotPublisherReceiptRecovery(
        recoveryRequest(await signedProof()),
        recoveryEnv({ includeIntent: false }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'INTENT_NOT_FOUND' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a corrupt stored receipt instead of trusting intent state', async () => {
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(await signedProof()),
      recoveryEnv({ receipt: null }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'INTENT_CORRUPT' });
  });

  it.each([
    [{ grantExpiresAt: NOW - 1 }, 'PUBLISHER_GRANT_EXPIRED'],
    [{ grantRevokedAt: NOW - 1 }, 'PUBLISHER_GRANT_REVOKED'],
    [{ identityGeneration: 2 }, 'WORKLOAD_PROOF_INVALID'],
    [{ identityRevoked: 1 }, 'PUBLISHER_IDENTITY_INVALID'],
  ] as const)('fails closed when recovery authority has rotated or ended', async (options, code) => {
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(await signedProof()),
      recoveryEnv(options),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toMatchObject({ code });
  });

  it('fails closed when the stored receipt was signed by a prior unconfigured Relay key', async () => {
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(await signedProof()),
      recoveryEnv({ relayPrivateKey: '33'.repeat(32) }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'INTENT_CORRUPT' });
  });

  it('rejects a tampered signed scope before intent lookup', async () => {
    const envelope = await signedProof();
    envelope.proof.binding = { ...binding, repository: 'curiositech/other' };
    const response = await handleFleetbotPublisherReceiptRecovery(
      recoveryRequest(envelope),
      recoveryEnv({}),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PUBLISHER_GRANT_SCOPE_MISMATCH' });
  });
});
