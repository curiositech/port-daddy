import { describe, expect, it } from 'vitest';
import {
  FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
  fleetbotPublisherCapabilityPreimage,
  stableJson,
  type FleetbotOperation,
  type FleetbotPublisherCapability,
} from '../../../lib/github-publisher-contract.js';
import { hashBytes, hashHex, pubKeyFromPrivKey, signEd25519, toHex } from '../src/crypto.js';
import { eraseUser } from '../src/db.js';
import {
  authorizePublisherGrant,
  handlePublisherGrantSnapshot,
  readPublisherGrant,
} from '../src/publisher-grants.js';
import { applyAllMigrations, makeDb, type TestDb } from './helpers/d1-sqlite.js';

const PRIVATE_KEY = '29'.repeat(32);
const PUBLIC_KEY = pubKeyFromPrivKey(PRIVATE_KEY);
const FINGERPRINT = toHex(hashBytes(Uint8Array.from(PUBLIC_KEY.match(/../g)!.map((byte) => parseInt(byte, 16)))));
const GRANT_ID = `pdg_${'a1'.repeat(16)}`;
const NOW = 2_000_000_000;

function fixture(overrides: Partial<{
  epoch: number;
  repositories: string[];
  operations: FleetbotOperation[];
  branches: string[];
  bases: string[];
  mutations: number;
  installation: number;
  revokedAt: number | null;
  subject: string;
  createdAt: number;
  expiresAt: number;
}> = {}): TestDb {
  const db = makeDb(applyAllMigrations());
  db.raw.prepare(`INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, ?, ?, ?)`).run('u_grant', 42, 'operator', NOW - 100);
  db.raw.prepare(`INSERT INTO identities
    (daemon_fingerprint, pub_key, proof_method, proof_metadata, expires_at, revoked, key_generation)
    VALUES (?, ?, 'oidc', '{}', ?, 0, 4)`).run(FINGERPRINT, PUBLIC_KEY, NOW + 10_000);
  const revokedAt = overrides.revokedAt ?? null;
  db.raw.prepare(`INSERT INTO publisher_grants
    (grant_id, epoch, surface, account_user_id, subject_fingerprint, subject_class,
     installation_id, repositories_json, operations_json, branch_allow_json,
     base_allow_json, mutations_per_day, expires_at, created_at, created_via,
     revoked_at, revoked_reason)
    VALUES (?, ?, 'publisher', 'u_grant', ?, 'ci', ?, ?, ?, ?, ?, ?, ?, ?, 'account-ui', ?, ?)`)
    .run(
      GRANT_ID,
      overrides.epoch ?? 3,
      overrides.subject ?? FINGERPRINT,
      overrides.installation ?? 77,
      JSON.stringify(overrides.repositories ?? ['curiositech/port-daddy']),
      JSON.stringify(overrides.operations ?? ['pull-request.publish', 'pull-request.comment', 'pull-request.inspect']),
      JSON.stringify(overrides.branches ?? ['pd-agent/']),
      JSON.stringify(overrides.bases ?? ['main']),
      overrides.mutations ?? 2,
      overrides.expiresAt ?? NOW + 3_600,
      overrides.createdAt ?? NOW - 100,
      revokedAt,
      revokedAt === null ? null : 'operator revoked',
    );
  return db;
}

async function signedCapability(overrides: Partial<FleetbotPublisherCapability> = {}): Promise<FleetbotPublisherCapability> {
  return {
    schema: FLEETBOT_PUBLISHER_CAPABILITY_SCHEMA,
    grantId: GRANT_ID,
    grantEpoch: 3,
    daemonFingerprint: FINGERPRINT,
    signingKeyGeneration: 4,
    sessionId: 'session-grant-test',
    repository: 'curiositech/port-daddy',
    operation: 'pull-request.publish',
    baseBranch: 'main',
    baseSha: '1'.repeat(40),
    headSha: '2'.repeat(40),
    requestHash: '3'.repeat(64),
    issuedAt: NOW - 1,
    expiresAt: NOW + 60,
    nonce: '4'.repeat(64),
    ...overrides,
  };
}

async function authorize(
  db: TestDb,
  capability: FleetbotPublisherCapability,
  overrides: Partial<Parameters<typeof authorizePublisherGrant>[1]> = {},
) {
  const signature = await signEd25519(PRIVATE_KEY, hashHex(fleetbotPublisherCapabilityPreimage(capability)));
  return authorizePublisherGrant(db.DB as D1Database, {
    capability,
    capabilitySignature: signature,
    requestHash: capability.requestHash,
    idempotencyKey: `pd-gh-${capability.requestHash}`,
    repository: capability.repository,
    operation: capability.operation,
    baseBranch: capability.baseBranch,
    headBranch: 'pd-agent/test-123',
    sessionId: capability.sessionId,
    installationId: 77,
    isMutation: capability.operation !== 'pull-request.inspect',
    now: NOW,
    ...overrides,
  });
}

describe('standing publisher grants', () => {
  it('enforces grant shape and makes every authority field immutable', () => {
    const db = fixture();
    expect(() => db.raw.prepare("UPDATE publisher_grants SET operations_json = '[\"pull-request.inspect\"]' WHERE grant_id = ?")
      .run(GRANT_ID)).toThrow(/authority is immutable/);
    expect(() => db.raw.prepare("UPDATE publisher_grants SET account_user_id = 'someone-else' WHERE grant_id = ?")
      .run(GRANT_ID)).toThrow(/authority is immutable/);
    expect(() => db.raw.prepare('UPDATE publisher_grants SET epoch = epoch + 1 WHERE grant_id = ?')
      .run(GRANT_ID)).toThrow(/authority is immutable/);
    expect(() => db.raw.prepare('UPDATE publisher_grants SET grant_id = ? WHERE grant_id = ?')
      .run(`pdg_${'b2'.repeat(16)}`, GRANT_ID)).toThrow(/authority is immutable/);
  });

  it('allows exactly one irreversible revocation transition', () => {
    const db = fixture();
    db.raw.prepare('UPDATE publisher_grants SET revoked_at = ?, revoked_reason = ? WHERE grant_id = ?')
      .run(NOW, 'operator stop', GRANT_ID);
    expect(() => db.raw.prepare('UPDATE publisher_grants SET revoked_at = NULL, revoked_reason = NULL WHERE grant_id = ?')
      .run(GRANT_ID)).toThrow(/revocation is irreversible/);
    expect(() => db.raw.prepare('UPDATE publisher_grants SET revoked_at = ?, revoked_reason = ? WHERE grant_id = ?')
      .run(NOW + 1, 'rewritten', GRANT_ID)).toThrow(/revocation is irreversible/);
  });

  it('authorizes exact v2 scope, binds the session, and makes an exact retry idempotent', async () => {
    const db = fixture();
    const capability = await signedCapability();
    await expect(authorize(db, capability)).resolves.toMatchObject({ grantId: GRANT_ID, epoch: 3 });
    await expect(authorize(db, capability)).resolves.toMatchObject({ grantId: GRANT_ID, epoch: 3 });
    expect(db.raw.prepare('SELECT subject_fingerprint FROM github_publisher_session_bindings').get())
      .toMatchObject({ subject_fingerprint: FINGERPRINT });
    expect(db.raw.prepare('SELECT count(*) AS n FROM github_publisher_capability_uses_v2').get()).toMatchObject({ n: 1 });
  });

  it.each([
    ['epoch', { grantEpoch: 2 }, {}, 'PUBLISHER_GRANT_STALE'],
    ['subject', { daemonFingerprint: '9'.repeat(64) }, {}, 'PUBLISHER_GRANT_STALE'],
    ['repository', { repository: 'curiositech/other' }, {}, 'PUBLISHER_GRANT_SCOPE_MISMATCH'],
    ['operation', { operation: 'pull-request.enqueue' as const }, {}, 'PUBLISHER_GRANT_SCOPE_MISMATCH'],
    ['base', { baseBranch: 'release' }, {}, 'PUBLISHER_GRANT_SCOPE_MISMATCH'],
    ['branch', {}, { headBranch: 'attacker/head' }, 'PUBLISHER_GRANT_SCOPE_MISMATCH'],
    ['installation', {}, { installationId: 78 }, 'PUBLISHER_GRANT_SCOPE_MISMATCH'],
  ])('rejects an out-of-scope %s', async (_name, capabilityPatch, inputPatch, code) => {
    const db = fixture();
    const capability = await signedCapability(capabilityPatch);
    await expect(authorize(db, capability, inputPatch)).rejects.toMatchObject({ code, status: 403 });
  });

  it('re-reads revocation on every request and rejects stale grants', async () => {
    const db = fixture();
    const capability = await signedCapability();
    await authorize(db, capability);
    db.raw.prepare('UPDATE publisher_grants SET revoked_at = ?, revoked_reason = ? WHERE grant_id = ?')
      .run(NOW, 'stop now', GRANT_ID);
    await expect(authorize(db, { ...capability, nonce: '5'.repeat(64) }))
      .rejects.toMatchObject({ code: 'PUBLISHER_GRANT_REVOKED' });
  });

  it('rejects a signature from a key other than the enrolled grant subject', async () => {
    const db = fixture();
    const capability = await signedCapability();
    const wrongSignature = await signEd25519('39'.repeat(32), hashHex(fleetbotPublisherCapabilityPreimage(capability)));
    await expect(authorizePublisherGrant(db.DB as D1Database, {
      capability,
      capabilitySignature: wrongSignature,
      requestHash: capability.requestHash,
      idempotencyKey: `pd-gh-${capability.requestHash}`,
      repository: capability.repository,
      operation: capability.operation,
      baseBranch: capability.baseBranch,
      headBranch: 'pd-agent/test',
      sessionId: capability.sessionId,
      installationId: 77,
      isMutation: true,
      now: NOW,
    })).rejects.toMatchObject({ code: 'CAPABILITY_SIGNATURE_INVALID', status: 401 });
  });

  it('prevents cross-workload session rebinding and nonce replay', async () => {
    const db = fixture();
    const first = await signedCapability();
    await authorize(db, first);
    db.raw.prepare(`INSERT INTO identities
      (daemon_fingerprint, pub_key, proof_method, proof_metadata, expires_at, revoked, key_generation)
      VALUES (?, ?, 'oidc', '{}', ?, 0, 1)`).run('8'.repeat(64), '8'.repeat(64), NOW + 100);
    db.raw.prepare('UPDATE github_publisher_session_bindings SET subject_fingerprint = ? WHERE session_id = ?')
      .run('8'.repeat(64), first.sessionId);
    await expect(authorize(db, { ...first, nonce: '5'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CAPABILITY_SESSION_REBOUND' });

    db.raw.prepare('UPDATE github_publisher_session_bindings SET subject_fingerprint = ? WHERE session_id = ?')
      .run(FINGERPRINT, first.sessionId);
    const changed = { ...first, requestHash: '6'.repeat(64) };
    await expect(authorize(db, changed)).rejects.toMatchObject({ code: 'CAPABILITY_REPLAY' });
  });

  it('enforces the daily mutation ceiling but does not count inspect', async () => {
    const db = fixture({ mutations: 1 });
    await authorize(db, await signedCapability());
    await expect(authorize(db, await signedCapability({ nonce: '5'.repeat(64), requestHash: '5'.repeat(64) })))
      .rejects.toMatchObject({ code: 'PUBLISHER_DAILY_MUTATION_CEILING', status: 429 });
    const inspect = await signedCapability({
      operation: 'pull-request.inspect',
      nonce: '6'.repeat(64),
      requestHash: '6'.repeat(64),
    });
    await expect(authorize(db, inspect, { headBranch: null, isMutation: false })).resolves.toBeTruthy();
  });

  it('counts one logical idempotency key once and rejects a fresh-nonce alias', async () => {
    const db = fixture({ mutations: 1 });
    const first = await signedCapability();
    await authorize(db, first);
    await expect(authorize(db, first)).resolves.toBeTruthy();
    expect(db.raw.prepare(
      'SELECT count(*) AS rows, count(DISTINCT idempotency_key) AS logical FROM github_publisher_capability_uses_v2',
    ).get()).toMatchObject({ rows: 1, logical: 1 });
    await expect(authorize(db, { ...first, nonce: '5'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CAPABILITY_REPLAY' });
    await expect(authorize(db, await signedCapability({ nonce: '6'.repeat(64), requestHash: '6'.repeat(64) })))
      .rejects.toMatchObject({ code: 'PUBLISHER_DAILY_MUTATION_CEILING' });
  });

  it('fails final admission after the owning account is erased', async () => {
    const db = fixture();
    db.raw.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(NOW, 'u_grant');
    await expect(authorize(db, await signedCapability()))
      .rejects.toMatchObject({ code: 'PUBLISHER_ACCOUNT_ERASED', status: 403 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM github_publisher_capability_uses_v2').get())
      .toMatchObject({ n: 0 });
  });

  it('fails closed after an interrupted erasure marks the owner deleted', async () => {
    const db = fixture();
    const failingDb = {
      prepare(sql: string) {
        if (sql.includes('DELETE FROM github_publisher_capability_uses_v2')) {
          throw new Error('injected cleanup failure');
        }
        return (db.DB as D1Database).prepare(sql);
      },
    } as D1Database;

    await expect(eraseUser(failingDb, 'u_grant', NOW)).rejects.toThrow('injected cleanup failure');
    expect(db.raw.prepare('SELECT deleted_at FROM users WHERE id = ?').get('u_grant'))
      .toEqual({ deleted_at: NOW });
    await expect(authorize(db, await signedCapability()))
      .rejects.toMatchObject({ code: 'PUBLISHER_ACCOUNT_ERASED', status: 403 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM github_publisher_capability_uses_v2').get())
      .toMatchObject({ n: 0 });
  });

  it('returns a signed-workload-only current snapshot with live key generation', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = fixture({ createdAt: now - 100, expiresAt: now + 3_600 });
    db.raw.prepare('UPDATE identities SET expires_at = ? WHERE daemon_fingerprint = ?').run(now + 3_600, FINGERPRINT);
    const path = `/v1/fleetbot/publisher-grants/${GRANT_ID}`;
    const nonce = '7'.repeat(64);
    const preimage = stableJson({
      schema: 'port-daddy.publisher-grant-read.v1',
      method: 'GET', path, fingerprint: FINGERPRINT, issuedAt: now, nonce,
    });
    const signature = await signEd25519(PRIVATE_KEY, hashHex(preimage));
    const response = await handlePublisherGrantSnapshot(new Request(`https://relay.test${path}`, {
      headers: {
        'X-PD-Workload-Fingerprint': FINGERPRINT,
        'X-PD-Workload-Issued-At': String(now),
        'X-PD-Workload-Nonce': nonce,
        'X-PD-Workload-Signature': signature,
      },
    }), db.DB as D1Database, GRANT_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      grantId: GRANT_ID,
      grantEpoch: 3,
      signingKeyGeneration: 4,
      surface: 'publisher',
      repositories: ['curiositech/port-daddy'],
    });
  });

  it('never returns revoked grant scope to a workload snapshot', async () => {
    const db = fixture({ revokedAt: Math.floor(Date.now() / 1000) - 1 });
    const response = await handlePublisherGrantSnapshot(
      new Request(`https://relay.test/v1/fleetbot/publisher-grants/${GRANT_ID}`),
      db.DB as D1Database,
      GRANT_ID,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'WORKLOAD_PROOF_INVALID' });
  });

  it('reads exact scope without widening repositories or operations', async () => {
    const db = fixture();
    await expect(readPublisherGrant(db.DB as D1Database, GRANT_ID, NOW)).resolves.toMatchObject({
      repositories: ['curiositech/port-daddy'],
      operations: ['pull-request.publish', 'pull-request.comment', 'pull-request.inspect'],
    });
  });
});
