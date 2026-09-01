/**
 * Hostile tests for the Chartroom authority kernel (ADR-0137).
 *
 * The fixture applies the real migration chain to node:sqlite and wraps it in
 * a transactional D1 facade. Coverage pins full-scope isolation, repository
 * capability minting, signed/expiring/non-replayable intents, version/epoch
 * CAS, idempotent ambiguous-timeout recovery, hash-chain verification,
 * tombstone/supersession projections, bounded export, and the absence of the
 * abandoned `/v1/oracle/*` namespace.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import {
  applyChartroomCommand,
  chartroomCommandHash,
  handleChartroomCapabilityPost,
  handleChartroomEventPost,
  handleChartroomExportGet,
  handleChartroomProjectionGet,
  validateChartroomCommand,
  type ChartroomCommand,
  type ChartroomEventInput,
  type ChartroomRepositoryIdentity,
  type ChartroomScope,
} from '../src/chartroom.js';
import { hashHex, pubKeyFromPrivKey, signEd25519 } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(APP_ROOT, 'migrations');
const BASE = 'https://relay.example';
const ACCOUNT_TOKEN = `pdu_${'1'.repeat(64)}`;
const CAPABILITY = `chr_${'2'.repeat(64)}`;
const HARBOR_PRIVATE = '3'.repeat(64);
const RELAY_PRIVATE = '4'.repeat(64);
const ACCOUNT_ID = 'u_chartroom';
const HARBOR_ID = 'h_chartroom';
const NOW = 1_800_000_000;
const SCOPE: ChartroomScope = {
  accountId: ACCOUNT_ID,
  teamId: 'team_101',
  repositoryId: 'repo_202',
  repository: 'acme/widgets',
  harborId: HARBOR_ID,
  resourceId: 'grand-harbor-program',
};

type TestStatement = {
  readonly sqlText: string;
  bind(...values: unknown[]): TestStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
};

function makeRealD1(): { db: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }
  const prepare = (query: string): TestStatement => {
    let args: unknown[] = [];
    const statement: TestStatement = {
      sqlText: query,
      bind(...values: unknown[]) {
        args = values.map((value) => value === undefined ? null : value);
        return statement;
      },
      async first<T>() {
        return (sql.prepare(query).get(...(args as never[])) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: sql.prepare(query).all(...(args as never[])) as T[], success: true };
      },
      async run() {
        const result = sql.prepare(query).run(...(args as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: TestStatement[]) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(/^\s*SELECT\b/i.test(statement.sqlText)
            ? await statement.all()
            : await statement.run());
        }
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sql };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIVATE,
    RELAY_OPERATOR_TOKEN: 'operator-test-token',
    RELAY_VERSION: 'test',
    EVENT_RETENTION_DAYS: '30',
  } as unknown as Env;
}

function seedAccountAndHarbor(sql: DatabaseSync, now = NOW): void {
  sql.prepare(
    'INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, ?, ?, ?)',
  ).run(ACCOUNT_ID, 101, 'admiral', now - 100);
  sql.prepare(
    'INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)',
  ).run(hashHex(ACCOUNT_TOKEN), ACCOUNT_ID, 'chartroom test', now - 100);
  sql.prepare(
    'INSERT INTO harbors (id, namespace, name, pubkey, created_by, created_at, authority_epoch) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(HARBOR_ID, 'admiral', 'chartroom', pubKeyFromPrivKey(HARBOR_PRIVATE), ACCOUNT_ID, now - 100, 1);
  sql.prepare(
    `INSERT INTO harbor_memberships
      (harbor_id, member_kind, member_id, role, added_at, added_by)
     VALUES (?, 'user', ?, 'owner', ?, ?)`,
  ).run(HARBOR_ID, ACCOUNT_ID, now - 100, ACCOUNT_ID);
  sql.prepare(
    `INSERT INTO repo_settings
      (user_id, repo_full_name, sitrep_end_of_turn, settings_json, created_at, updated_at)
     VALUES (?, ?, 'off', '{}', ?, ?)`,
  ).run(ACCOUNT_ID, SCOPE.repository, now - 10, now - 10);
}

function seedCapability(sql: DatabaseSync, scope = SCOPE, now = NOW, raw = CAPABILITY): void {
  sql.prepare(
    `INSERT INTO chartroom_capabilities
      (account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id,
       token_hash, permission, installation_id, minted_by, created_at, expires_at,
       revoked_at, event_count, max_events)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'write', 'inst_303', ?, ?, ?, NULL, 0, 1000)`,
  ).run(
    scope.accountId, scope.teamId, scope.repositoryId, scope.repository,
    scope.harborId, scope.resourceId, hashHex(raw), ACCOUNT_ID, now - 10, now + 600,
  );
}

function makeFixture(): { env: Env; sql: DatabaseSync } {
  const { db, sql } = makeRealD1();
  seedAccountAndHarbor(sql);
  seedCapability(sql);
  return { env: makeEnv(db), sql };
}

async function signedCommand(
  event: ChartroomEventInput,
  expectedPlanVersion: number,
  options: {
    scope?: ChartroomScope;
    idempotencyKey?: string;
    intentNonce?: string;
    issuedAt?: number;
    expiresAt?: number;
    authorityEpoch?: number;
  } = {},
): Promise<ChartroomCommand> {
  const issuedAt = options.issuedAt ?? NOW - 5;
  const command = validateChartroomCommand({
    scope: options.scope ?? SCOPE,
    expectedPlanVersion,
    idempotencyKey: options.idempotencyKey ?? `idem-${expectedPlanVersion}-12345678`,
    intentNonce: options.intentNonce ?? `nonce-${expectedPlanVersion}-1234567890123456`,
    issuedAt,
    expiresAt: options.expiresAt ?? issuedAt + 120,
    actor: {
      kind: 'agent',
      actorId: 'agent-chartroom-authority-kernel',
      sessionId: 'session-chartroom-authority-kernel',
      agentNodeId: 'agent-node-chartroom-01',
    },
    issuer: {
      harborId: (options.scope ?? SCOPE).harborId,
      authorityEpoch: options.authorityEpoch ?? 1,
      signature: '0'.repeat(128),
    },
    event,
  });
  command.issuer.signature = await signEd25519(HARBOR_PRIVATE, chartroomCommandHash(command));
  return command;
}

function capabilityHeaders(raw = CAPABILITY): HeadersInit {
  return { Authorization: `Chartroom ${raw}` };
}

function scopeQuery(scope = SCOPE): string {
  return new URLSearchParams({
    accountId: scope.accountId,
    teamId: scope.teamId,
    repositoryId: scope.repositoryId,
    repository: scope.repository,
    harborId: scope.harborId,
    resourceId: scope.resourceId,
  }).toString();
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

describe('Chartroom repository capabilities', () => {
  it('derives numeric repository/team identity from the verifier and stores only a token hash', async () => {
    const { db, sql } = makeRealD1();
    seedAccountAndHarbor(sql, Math.floor(Date.now() / 1_000));
    const env = makeEnv(db);
    const verified: ChartroomRepositoryIdentity = {
      teamId: 'gh-team-777',
      repositoryId: 'gh-repo-888',
      repository: SCOPE.repository,
      installationId: 'gh-installation-999',
    };
    const response = await handleChartroomCapabilityPost(
      new Request(`${BASE}/v1/chartroom/capabilities`, {
        method: 'POST',
        headers: {
          Origin: BASE,
          Authorization: `Bearer ${ACCOUNT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repository: SCOPE.repository,
          repositoryId: 'attacker-value',
          teamId: 'attacker-value',
          harborId: HARBOR_ID,
          resourceId: SCOPE.resourceId,
          permission: 'write',
          ttlSeconds: 300,
          maxEvents: 12,
        }),
      }),
      env,
      async () => verified,
    );
    expect(response.status).toBe(201);
    const body = await responseJson(response);
    expect(body.scope.repositoryId).toBe(verified.repositoryId);
    expect(body.scope.teamId).toBe(verified.teamId);
    expect(body.capability).toMatch(/^chr_[0-9a-f]{64}$/);
    const row = sql.prepare(
      'SELECT token_hash, repository_id, team_id, max_events FROM chartroom_capabilities',
    ).get() as Record<string, unknown>;
    expect(row.token_hash).toBe(hashHex(body.capability));
    expect(JSON.stringify(row)).not.toContain(body.capability);
    expect(row.repository_id).toBe(verified.repositoryId);
    expect(row.team_id).toBe(verified.teamId);
    expect(row.max_events).toBe(12);
  });

  it('fails closed without same-origin recent repository step-up', async () => {
    const { db, sql } = makeRealD1();
    seedAccountAndHarbor(sql, Math.floor(Date.now() / 1_000));
    sql.exec('DELETE FROM repo_settings');
    const env = makeEnv(db);
    const response = await handleChartroomCapabilityPost(
      new Request(`${BASE}/v1/chartroom/capabilities`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', Authorization: `Bearer ${ACCOUNT_TOKEN}` },
        body: JSON.stringify({ repository: SCOPE.repository, harborId: HARBOR_ID, resourceId: 'x', permission: 'read' }),
      }),
      env,
      async () => { throw new Error('must not reach verifier'); },
    );
    expect(response.status).toBe(403);
    expect((await responseJson(response)).code).toBe('CROSS_ORIGIN');
  });

  it('allows harbor members to read but only harbor owners to mint write authority', async () => {
    const { db, sql } = makeRealD1();
    seedAccountAndHarbor(sql, Math.floor(Date.now() / 1_000));
    sql.exec(`UPDATE harbor_memberships SET role = 'member' WHERE harbor_id = '${HARBOR_ID}'`);
    const env = makeEnv(db);
    const verifier = async (): Promise<ChartroomRepositoryIdentity> => ({
      teamId: 'gh-team-777', repositoryId: 'gh-repo-888',
      repository: SCOPE.repository, installationId: 'gh-installation-999',
    });
    const request = (permission: 'read' | 'write') => new Request(`${BASE}/v1/chartroom/capabilities`, {
      method: 'POST',
      headers: { Origin: BASE, Authorization: `Bearer ${ACCOUNT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repository: SCOPE.repository, harborId: HARBOR_ID,
        resourceId: SCOPE.resourceId, permission,
      }),
    });
    const write = await handleChartroomCapabilityPost(request('write'), env, verifier);
    expect(write.status).toBe(403);
    expect((await responseJson(write)).code).toBe('HARBOR_OWNER_REQUIRED');
    const read = await handleChartroomCapabilityPost(request('read'), env, verifier);
    expect(read.status).toBe(201);
  });
});

describe('Chartroom signed event kernel', () => {
  it('atomically appends, projects, and returns an exact receipt on ambiguous retry', async () => {
    const { env, sql } = makeFixture();
    const command = await signedCommand({
      type: 'node.upsert',
      nodeId: 'grand-harbor-plan',
      nodeKind: 'program',
      title: 'Grand Harbor Plan',
      summary: 'The canonical product program.',
      status: 'active',
      ownerActorId: 'agent-chartroom-authority-kernel',
      payload: { source: 'GRAND-HARBOR-PLAN.md' },
    }, 0);
    const first = await applyChartroomCommand(env, command, hashHex(CAPABILITY), NOW);
    const retry = await applyChartroomCommand(env, command, hashHex(CAPABILITY), NOW + 1);
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);
    expect(first.receipt.planVersion).toBe(1);
    expect(first.receipt.scope).toEqual(SCOPE);
    expect(first.receipt.projectionAcceptanceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM chartroom_events').get().n).toBe(1);
    expect(sql.prepare('SELECT title FROM chartroom_nodes WHERE node_id = ?').get('grand-harbor-plan').title).toBe('Grand Harbor Plan');
    expect(sql.prepare('SELECT plan_version, event_count FROM chartroom_streams').get()).toMatchObject({ plan_version: 1, event_count: 1 });
  });

  it('refuses forged, expired, replayed, stale-version, and stale-epoch intents', async () => {
    const { env, sql } = makeFixture();
    const valid = await signedCommand({
      type: 'node.upsert', nodeId: 'n1', nodeKind: 'roadmap-item', title: 'One',
      summary: '', status: 'proposed', payload: {},
    }, 0);
    await applyChartroomCommand(env, valid, hashHex(CAPABILITY), NOW);

    const forged = await signedCommand({
      type: 'node.upsert', nodeId: 'n2', nodeKind: 'roadmap-item', title: 'Two',
      summary: '', status: 'proposed', payload: {},
    }, 1, { idempotencyKey: 'forged-12345678', intentNonce: 'forged-nonce-1234567890' });
    forged.issuer.signature = 'f'.repeat(128);
    await expect(applyChartroomCommand(env, forged, hashHex(CAPABILITY), NOW)).rejects.toMatchObject({ code: 'FORGED_INTENT' });

    const expired = await signedCommand({
      type: 'node.upsert', nodeId: 'n2', nodeKind: 'roadmap-item', title: 'Two',
      summary: '', status: 'proposed', payload: {},
    }, 1, {
      idempotencyKey: 'expired-12345678', intentNonce: 'expired-nonce-1234567890',
      issuedAt: NOW - 250, expiresAt: NOW - 10,
    });
    await expect(applyChartroomCommand(env, expired, hashHex(CAPABILITY), NOW)).rejects.toMatchObject({ code: 'INTENT_EXPIRED' });

    const replay = await signedCommand({
      type: 'node.upsert', nodeId: 'n2', nodeKind: 'roadmap-item', title: 'Two',
      summary: '', status: 'proposed', payload: {},
    }, 1, { idempotencyKey: 'replay-new-key-1234', intentNonce: valid.intentNonce });
    await expect(applyChartroomCommand(env, replay, hashHex(CAPABILITY), NOW)).rejects.toMatchObject({ code: 'INTENT_REPLAYED' });

    const stale = await signedCommand({
      type: 'node.upsert', nodeId: 'n3', nodeKind: 'roadmap-item', title: 'Three',
      summary: '', status: 'proposed', payload: {},
    }, 0, { idempotencyKey: 'stale-version-1234', intentNonce: 'stale-version-nonce-12345' });
    await expect(applyChartroomCommand(env, stale, hashHex(CAPABILITY), NOW)).rejects.toMatchObject({ code: 'STALE_PLAN_VERSION' });

    sql.exec(`UPDATE harbors SET authority_epoch = 2 WHERE id = '${HARBOR_ID}'`);
    const staleEpoch = await signedCommand({
      type: 'node.upsert', nodeId: 'n4', nodeKind: 'roadmap-item', title: 'Four',
      summary: '', status: 'proposed', payload: {},
    }, 1, { idempotencyKey: 'stale-epoch-12345', intentNonce: 'stale-epoch-nonce-123456' });
    await expect(applyChartroomCommand(env, staleEpoch, hashHex(CAPABILITY), NOW)).rejects.toMatchObject({ code: 'STALE_AUTHORITY_EPOCH' });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM chartroom_events').get().n).toBe(1);
  });

  it('keeps account/repository/harbor/resource isolation in capability reads', async () => {
    const { env } = makeFixture();
    const variants: ChartroomScope[] = [
      { ...SCOPE, accountId: 'u_other' },
      { ...SCOPE, repositoryId: 'repo_other' },
      { ...SCOPE, harborId: 'h_other' },
      { ...SCOPE, resourceId: 'other-program' },
    ];
    for (const scope of variants) {
      const response = await handleChartroomProjectionGet(
        new Request(`${BASE}/v1/chartroom/projection?${scopeQuery(scope)}`, { headers: capabilityHeaders() }),
        env,
      );
      expect(response.status).toBe(403);
      expect((await responseJson(response)).code).toBe('CAPABILITY_REJECTED');
    }
  });

  it('refuses structured secret fields and credential-bearing artifact URIs before D1', () => {
    const base = {
      scope: SCOPE,
      expectedPlanVersion: 0,
      idempotencyKey: 'privacy-12345678',
      intentNonce: 'privacy-nonce-1234567890',
      issuedAt: NOW - 5,
      expiresAt: NOW + 120,
      actor: { kind: 'agent', actorId: 'a1', sessionId: 's1', agentNodeId: 'n1' },
      issuer: { harborId: HARBOR_ID, authorityEpoch: 1, signature: '0'.repeat(128) },
    };
    expect(() => validateChartroomCommand({
      ...base,
      event: {
        type: 'node.upsert', nodeId: 'n1', nodeKind: 'plan', title: 'Secret',
        summary: '', status: 'proposed', payload: { accessToken: 'must-not-land' },
      },
    })).toThrowError(expect.objectContaining({ code: 'BAD_EVENT' }));
    expect(() => validateChartroomCommand({
      ...base,
      event: {
        type: 'artifact.link', linkId: 'l1', artifactKind: 'url',
        uri: 'https://user:password@example.com/proof?token=secret', title: 'Proof', payload: {},
      },
    })).toThrowError(expect.objectContaining({ code: 'SECRET_BEARING_URI' }));
    expect(() => validateChartroomCommand({
      ...base,
      event: {
        type: 'node.upsert', nodeId: 'n1', nodeKind: 'plan', title: 'Secret',
        summary: `Bearer ${'x'.repeat(32)}`, status: 'proposed', payload: {},
      },
    })).toThrowError(expect.objectContaining({ code: 'SECRET_BEARING_TEXT' }));
  });

  it('records tombstones and supersession instead of deleting projection history', async () => {
    const { env, sql } = makeFixture();
    const events: ChartroomEventInput[] = [
      { type: 'node.upsert', nodeId: 'old-plan', nodeKind: 'plan', title: 'Old plan', summary: '', status: 'active', payload: {} },
      { type: 'node.tombstone', nodeId: 'old-plan', reason: 'superseded by Grand Harbor', payload: {} },
      { type: 'decision.record', decisionId: 'd-old', title: 'Old decision', rationale: 'Historical choice', status: 'accepted', affectedIds: ['old-plan'], payload: {} },
      { type: 'decision.record', decisionId: 'd-new', title: 'New decision', rationale: 'Reconciled choice', status: 'accepted', affectedIds: ['old-plan'], supersedesId: 'd-old', payload: {} },
      { type: 'decision.supersede', decisionId: 'd-old', supersededById: 'd-new', rationale: 'Recorded reconciliation', payload: {} },
      { type: 'source.ingest', sourceId: 'grand-harbor-doc', revisionId: 'rev-1', sourceKind: 'document', uri: 'repo://acme/widgets/old.md', digest: 'a'.repeat(64), title: 'Old plan doc', summary: '', payload: {} },
      { type: 'source.ingest', sourceId: 'grand-harbor-doc', revisionId: 'rev-2', sourceKind: 'document', uri: 'repo://acme/widgets/new.md', digest: 'b'.repeat(64), title: 'Grand Harbor Plan', summary: '', supersedesRevisionId: 'rev-1', payload: {} },
      { type: 'source.supersede', sourceId: 'grand-harbor-doc', revisionId: 'rev-1', supersededByRevisionId: 'rev-2', payload: {} },
    ];
    for (let index = 0; index < events.length; index += 1) {
      const command = await signedCommand(events[index], index, {
        idempotencyKey: `projection-${index}-12345678`,
        intentNonce: `projection-nonce-${index}-123456789`,
      });
      await applyChartroomCommand(env, command, hashHex(CAPABILITY), NOW);
    }
    const node = sql.prepare('SELECT tombstoned_at FROM chartroom_nodes WHERE node_id = ?').get('old-plan');
    expect(Number(node.tombstoned_at)).toBe(NOW);
    const oldDecision = sql.prepare('SELECT status, superseded_by_id FROM chartroom_decisions WHERE decision_id = ?').get('d-old');
    expect(oldDecision).toMatchObject({ status: 'superseded', superseded_by_id: 'd-new' });
    const sources = sql.prepare('SELECT revision_id, status, superseded_by_revision_id FROM chartroom_sources ORDER BY revision_id').all();
    expect(sources).toEqual([
      { revision_id: 'rev-1', status: 'superseded', superseded_by_revision_id: 'rev-2' },
      { revision_id: 'rev-2', status: 'active', superseded_by_revision_id: null },
    ]);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM chartroom_events').get().n).toBe(events.length);
  });

  it('materializes the complete node, owner, edge, dependency, and artifact vocabulary', async () => {
    const { env, sql } = makeFixture();
    const events: ChartroomEventInput[] = [
      { type: 'node.upsert', nodeId: 'a', nodeKind: 'work', title: 'A', summary: '', status: 'proposed', payload: {} },
      { type: 'node.upsert', nodeId: 'b', nodeKind: 'work', title: 'B', summary: '', status: 'proposed', payload: {} },
      { type: 'status.set', nodeId: 'a', status: 'active', payload: {} },
      { type: 'owner.assign', nodeId: 'a', ownerActorId: 'agent-a', payload: {} },
      { type: 'owner.unassign', nodeId: 'a', payload: {} },
      { type: 'edge.upsert', edgeId: 'e-general', edgeType: 'supports', sourceId: 'a', targetId: 'b', payload: {} },
      { type: 'edge.tombstone', edgeId: 'e-general', payload: {} },
      { type: 'dependency.add', edgeId: 'e-dependency', sourceId: 'a', targetId: 'b', payload: {} },
      { type: 'dependency.remove', edgeId: 'e-dependency', payload: {} },
      { type: 'artifact.link', linkId: 'proof-1', nodeId: 'a', artifactKind: 'recording', uri: 'https://example.com/proof.mp4', digest: 'c'.repeat(64), title: 'Porthole proof', payload: {} },
      { type: 'artifact.unlink', linkId: 'proof-1', payload: {} },
    ];
    for (let index = 0; index < events.length; index += 1) {
      const command = await signedCommand(events[index], index, {
        idempotencyKey: `vocabulary-${index}-12345678`,
        intentNonce: `vocabulary-nonce-${index}-123456789`,
      });
      await applyChartroomCommand(env, command, hashHex(CAPABILITY), NOW);
    }
    expect(sql.prepare("SELECT status, owner_actor_id FROM chartroom_nodes WHERE node_id = 'a'").get()).toEqual({
      status: 'active', owner_actor_id: null,
    });
    expect(sql.prepare("SELECT edge_type, tombstoned_at FROM chartroom_edges WHERE edge_id = 'e-general'").get()).toEqual({
      edge_type: 'supports', tombstoned_at: NOW,
    });
    expect(sql.prepare("SELECT edge_type, tombstoned_at FROM chartroom_edges WHERE edge_id = 'e-dependency'").get()).toEqual({
      edge_type: 'depends-on', tombstoned_at: NOW,
    });
    expect(sql.prepare("SELECT artifact_kind, tombstoned_at FROM chartroom_artifact_links WHERE link_id = 'proof-1'").get()).toEqual({
      artifact_kind: 'recording', tombstoned_at: NOW,
    });
  });
});

describe('Chartroom HTTP readback and export', () => {
  it('clamps export cost, signs exact readback, and detects a broken stored chain', async () => {
    const { env, sql } = makeFixture();
    for (let index = 0; index < 3; index += 1) {
      const command = await signedCommand({
        type: 'node.upsert', nodeId: `n-${index}`, nodeKind: 'roadmap-item',
        title: `Node ${index}`, summary: '', status: 'proposed', payload: {},
      }, index, {
        idempotencyKey: `export-${index}-12345678`,
        intentNonce: `export-nonce-${index}-123456789012`,
      });
      await applyChartroomCommand(env, command, hashHex(CAPABILITY), NOW);
    }
    const response = await handleChartroomExportGet(
      new Request(`${BASE}/v1/chartroom/export?${scopeQuery()}&limit=9999`, { headers: capabilityHeaders() }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.events).toHaveLength(3);
    expect(body.cost.rowLimit).toBe(250);
    expect(body.chain.valid).toBe(true);
    expect(body.receipt.signature).toMatch(/^[0-9a-f]{128}$/);

    sql.exec("UPDATE chartroom_events SET payload_json = '{\"tampered\":true}' WHERE plan_version = 2");
    const broken = await handleChartroomExportGet(
      new Request(`${BASE}/v1/chartroom/export?${scopeQuery()}`, { headers: capabilityHeaders() }),
      env,
    );
    expect(broken.status).toBe(409);
    const brokenBody = await responseJson(broken);
    expect(brokenBody.code).toBe('HASH_CHAIN_BREAK');
    expect(brokenBody.chain.brokenAt).toBe(2);
  });

  it('routes Chartroom and leaves every /v1/oracle path absent', async () => {
    const { env } = makeFixture();
    const context = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const response = await worker.fetch(new Request(`${BASE}/v1/oracle/events`, { method: 'POST' }), env, context);
    expect(response.status).toBe(404);
    const body = await responseJson(response);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('uses the HTTP event handler and rejects an exact token at a wrong resource scope', async () => {
    const { env } = makeFixture();
    const command = await signedCommand({
      type: 'node.upsert', nodeId: 'http-node', nodeKind: 'roadmap-item',
      title: 'HTTP node', summary: '', status: 'proposed', payload: {},
    }, 0, { issuedAt: Math.floor(Date.now() / 1_000) - 5, expiresAt: Math.floor(Date.now() / 1_000) + 120 });
    const ok = await handleChartroomEventPost(new Request(`${BASE}/v1/chartroom/events`, {
      method: 'POST',
      headers: { ...capabilityHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    }), env);
    expect(ok.status).toBe(201);

    const wrong = { ...command, scope: { ...command.scope, resourceId: 'other-program' } };
    const refused = await handleChartroomEventPost(new Request(`${BASE}/v1/chartroom/events`, {
      method: 'POST',
      headers: { ...capabilityHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(wrong),
    }), env);
    expect(refused.status).toBe(403);
    expect((await responseJson(refused)).code).toBe('CAPABILITY_REJECTED');
  });
});
