import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eraseUser } from '../src/db.js';
import { runRetentionSweep } from '../src/retention-sweep.js';
import type { Env } from '../src/types.js';
import { applyAllMigrations, makeDb } from './helpers/d1-sqlite.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../migrations/2026-09-14-publisher-grants-v2.sql', import.meta.url),
  'utf8',
);

function tableInfo(db: ReturnType<typeof makeDb>, table: string): unknown[] {
  return db.raw.prepare(`PRAGMA table_info(${table})`).all();
}

function foreignKeys(db: ReturnType<typeof makeDb>, table: string): unknown[] {
  return db.raw.prepare(`PRAGMA foreign_key_list(${table})`).all();
}

function normalizeSql(sql: string | null): string | null {
  return sql === null ? null : sql
    .toLowerCase()
    .replace(/if\s+not\s+exists/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>])\s*/g, '$1')
    .trim();
}

function schemaObjects(db: ReturnType<typeof makeDb>, table: string, type: 'index' | 'trigger'): unknown[] {
  return (db.raw.prepare(
    `SELECT name, sql FROM sqlite_schema
      WHERE type = ? AND tbl_name = ? AND sql IS NOT NULL ORDER BY name`,
  ).all(type, table) as { name: string; sql: string | null }[])
    .map((row) => ({ name: row.name, sql: normalizeSql(row.sql) }));
}

function tableSql(db: ReturnType<typeof makeDb>, table: string): string | null {
  const row = db.raw.prepare(
    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
  ).get(table) as { sql: string | null } | undefined;
  return normalizeSql(row?.sql ?? null);
}

function seedPublisherAccount(db: ReturnType<typeof makeDb>, userId: string, deletedAt: number | null = null): void {
  const fingerprint = 'a'.repeat(64);
  const grantId = `pdg_${'ab'.repeat(16)}`;
  db.raw.prepare('INSERT INTO users (id, github_user_id, login, created_at, deleted_at) VALUES (?, 9, ?, 1, ?)')
    .run(userId, `login-${userId}`, deletedAt);
  db.raw.prepare(`INSERT INTO identities
    (daemon_fingerprint, pub_key, proof_method, proof_metadata, revoked, key_generation)
    VALUES (?, ?, 'oidc', '{}', 0, 1)`).run(fingerprint, 'b'.repeat(64));
  db.raw.prepare(`INSERT INTO github_publisher_credentials
    (account_user_id, generation, credential_enc, credential_iv, credential_key_version, updated_at)
    VALUES (?, 1, 'ciphertext', 'iv', 1, 1)`).run(userId);
  db.raw.prepare(`INSERT INTO publisher_grants
    (grant_id, epoch, surface, account_user_id, subject_fingerprint, subject_class,
     installation_id, repositories_json, operations_json, branch_allow_json,
     base_allow_json, mutations_per_day, expires_at, created_at, created_via)
    VALUES (?, 1, 'publisher', ?, ?, 'ci', 9, '["curiositech/port-daddy"]',
      '["pull-request.inspect"]', '["pd-agent/"]', '["main"]', 1, 2000000000, 1, 'account-ui')`)
    .run(grantId, userId, fingerprint);
  db.raw.prepare(`INSERT INTO github_publisher_session_bindings
    (session_id, subject_fingerprint, first_grant_id, bound_at) VALUES ('session-1', ?, ?, 1)`)
    .run(fingerprint, grantId);
  db.raw.prepare(`INSERT INTO github_publisher_capability_uses_v2
    (daemon_fingerprint, signing_key_generation, nonce, grant_id, grant_epoch,
     session_id, request_hash, idempotency_key, is_mutation, consumed_at)
    VALUES (?, 1, ?, ?, 1, 'session-1', ?, 'idem-v2', 0, 1)`)
    .run(fingerprint, 'c'.repeat(64), grantId, 'd'.repeat(64));
  db.raw.prepare(`INSERT INTO github_publisher_capability_uses
    (daemon_fingerprint, signing_key_generation, nonce, account_user_id,
     account_token_hash, request_hash, idempotency_key, consumed_at)
    VALUES (?, 1, ?, ?, ?, ?, 'idem-v1', 1)`)
    .run(fingerprint, 'e'.repeat(64), userId, 'f'.repeat(64), '1'.repeat(64));
  db.raw.prepare(`INSERT INTO github_publisher_intents
    (account_user_id, account_github_user_id, installation_id, repository,
     scope_sha, idempotency_key, request_hash, operation, state, actor_id,
     agent_id, session_id, identity_project, created_at, updated_at)
    VALUES (?, 9, 9, 'curiositech/port-daddy', ?, 'intent-1', ?,
      'pull-request.inspect', 'reserved', 'actor', 'agent', 'session-1', 'project', 1, 1)`)
    .run(userId, '2'.repeat(40), '3'.repeat(64));
}

function seedSecondTenantOnSharedSession(db: ReturnType<typeof makeDb>): string {
  const grantId = `pdg_${'cd'.repeat(16)}`;
  db.raw.prepare('INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, 10, ?, 1)')
    .run('u_second', 'login-u_second');
  db.raw.prepare(`INSERT INTO publisher_grants
    (grant_id, epoch, surface, account_user_id, subject_fingerprint, subject_class,
     installation_id, repositories_json, operations_json, branch_allow_json,
     base_allow_json, mutations_per_day, expires_at, created_at, created_via)
    VALUES (?, 1, 'publisher', 'u_second', ?, 'ci', 10, '["curiositech/other"]',
      '["pull-request.inspect"]', '["pd-agent/"]', '["main"]', 1, 2000000000, 1, 'account-ui')`)
    .run(grantId, 'a'.repeat(64));
  db.raw.prepare(`INSERT INTO github_publisher_capability_uses_v2
    (daemon_fingerprint, signing_key_generation, nonce, grant_id, grant_epoch,
     session_id, request_hash, idempotency_key, is_mutation, consumed_at)
    VALUES (?, 1, ?, ?, 1, 'session-1', ?, 'idem-second', 0, 2)`)
    .run('a'.repeat(64), '9'.repeat(64), grantId, '8'.repeat(64));
  return grantId;
}

function publisherCounts(db: ReturnType<typeof makeDb>): Record<string, number> {
  return Object.fromEntries([
    'github_publisher_credentials',
    'github_publisher_intents',
    'publisher_grants',
    'github_publisher_session_bindings',
    'github_publisher_capability_uses',
    'github_publisher_capability_uses_v2',
  ].map((table) => [
    table,
    Number((db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n),
  ]));
}

describe('publisher storage migration and schema parity', () => {
  it('is replay-safe and leaves the v1 capability table usable for rollback', () => {
    const db = makeDb(applyAllMigrations());
    db.raw.prepare('INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, ?, ?, ?)')
      .run('u_rollback', 9, 'rollback', 1);
    db.raw.prepare(`INSERT INTO github_publisher_capability_uses
      (daemon_fingerprint, signing_key_generation, nonce, account_user_id,
       account_token_hash, request_hash, idempotency_key, consumed_at)
      VALUES (?, 1, ?, 'u_rollback', ?, ?, 'old-worker', 1)`)
      .run('1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64));

    expect(() => db.raw.exec(migration)).not.toThrow();
    expect(db.raw.prepare('SELECT count(*) AS n FROM github_publisher_capability_uses').get())
      .toMatchObject({ n: 1 });
    expect(tableInfo(db, 'github_publisher_capability_uses')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'account_token_hash' }),
    ]));
    expect(tableInfo(db, 'github_publisher_capability_uses_v2')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'grant_id' }),
    ]));
  });

  it('keeps publisher schema, constraints, indexes, and triggers aligned with schema.sql', () => {
    const chain = makeDb(applyAllMigrations());
    const declared = makeDb(schema);
    const tables = [
      'identities',
      'user_tokens',
      'github_publisher_credentials',
      'github_publisher_intents',
      'publisher_grants',
      'github_publisher_session_bindings',
      'github_publisher_capability_uses',
      'github_publisher_capability_uses_v2',
    ];
    for (const table of tables) {
      expect(tableInfo(declared, table), `${table} columns`).toEqual(tableInfo(chain, table));
      expect(foreignKeys(declared, table), `${table} foreign keys`).toEqual(foreignKeys(chain, table));
      expect(schemaObjects(declared, table, 'index'), `${table} indexes`)
        .toEqual(schemaObjects(chain, table, 'index'));
      expect(schemaObjects(declared, table, 'trigger'), `${table} triggers`)
        .toEqual(schemaObjects(chain, table, 'trigger'));
    }
    for (const table of tables.filter((name) => !['identities', 'user_tokens'].includes(name))) {
      expect(tableSql(declared, table), `${table} table constraints`).toEqual(tableSql(chain, table));
    }

    for (const db of [chain, declared]) {
      seedPublisherAccount(db, `u_constraint_${db === chain ? 'chain' : 'declared'}`);
      expect(() => db.raw.prepare(
        "UPDATE publisher_grants SET branch_allow_json = '[\"unreviewed/\"]' WHERE grant_id = ?",
      ).run(`pdg_${'ab'.repeat(16)}`)).toThrow(/authority is immutable/);
    }
  });

  it('account erasure removes the complete publisher authority chain immediately', async () => {
    const db = makeDb(applyAllMigrations());
    seedPublisherAccount(db, 'u_erase');
    await eraseUser(db.DB as D1Database, 'u_erase', 100);
    expect(publisherCounts(db)).toEqual({
      github_publisher_credentials: 0,
      github_publisher_intents: 0,
      publisher_grants: 0,
      github_publisher_session_bindings: 1,
      github_publisher_capability_uses: 0,
      github_publisher_capability_uses_v2: 0,
    });
    expect(db.raw.prepare('SELECT deleted_at FROM users WHERE id = ?').get('u_erase'))
      .toMatchObject({ deleted_at: 100 });
  });

  it('retention completes a crashed erasure child-first under foreign keys', async () => {
    const db = makeDb(applyAllMigrations());
    const now = 1_800_000_000;
    seedPublisherAccount(db, 'u_sweep', now - 31 * 86_400);
    const result = await runRetentionSweep({ DB: db.DB, EVENT_RETENTION_DAYS: '30' } as Env, now);
    expect(result.errors).toEqual([]);
    expect(result.usersHardDeleted).toBe(1);
    expect(publisherCounts(db)).toEqual({
      github_publisher_credentials: 0,
      github_publisher_intents: 0,
      publisher_grants: 0,
      github_publisher_session_bindings: 1,
      github_publisher_capability_uses: 0,
      github_publisher_capability_uses_v2: 0,
    });
    expect(db.raw.prepare('SELECT id FROM users WHERE id = ?').get('u_sweep')).toBeUndefined();
  });

  it('erasing one tenant preserves another tenant\'s shared-session replay evidence', async () => {
    const db = makeDb(applyAllMigrations());
    seedPublisherAccount(db, 'u_first');
    const grant2 = seedSecondTenantOnSharedSession(db);

    await eraseUser(db.DB as D1Database, 'u_first', 100);

    expect(db.raw.prepare('SELECT grant_id FROM publisher_grants').all()).toEqual([{ grant_id: grant2 }]);
    expect(db.raw.prepare('SELECT grant_id FROM github_publisher_capability_uses_v2').all())
      .toEqual([{ grant_id: grant2 }]);
    expect(db.raw.prepare(
      'SELECT session_id, subject_fingerprint, first_grant_id FROM github_publisher_session_bindings',
    ).get()).toEqual({
      session_id: 'session-1',
      subject_fingerprint: 'a'.repeat(64),
      first_grant_id: null,
    });
    expect(() => db.raw.prepare(`INSERT INTO github_publisher_capability_uses_v2
      (daemon_fingerprint, signing_key_generation, nonce, grant_id, grant_epoch,
       session_id, request_hash, idempotency_key, is_mutation, consumed_at)
      VALUES (?, 1, ?, ?, 1, 'session-1', ?, 'idem-second', 0, 3)`)
      .run('a'.repeat(64), '7'.repeat(64), grant2, '6'.repeat(64)))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('retention preserves another tenant\'s shared-session replay evidence', async () => {
    const db = makeDb(applyAllMigrations());
    const now = 1_800_000_000;
    seedPublisherAccount(db, 'u_sweep_shared', now - 31 * 86_400);
    const grant2 = seedSecondTenantOnSharedSession(db);

    const result = await runRetentionSweep({ DB: db.DB, EVENT_RETENTION_DAYS: '30' } as Env, now);

    expect(result.errors).toEqual([]);
    expect(db.raw.prepare('SELECT id FROM users WHERE id = ?').get('u_sweep_shared')).toBeUndefined();
    expect(db.raw.prepare('SELECT grant_id FROM publisher_grants').all()).toEqual([{ grant_id: grant2 }]);
    expect(db.raw.prepare('SELECT grant_id FROM github_publisher_capability_uses_v2').all())
      .toEqual([{ grant_id: grant2 }]);
    expect(db.raw.prepare(
      'SELECT subject_fingerprint, first_grant_id FROM github_publisher_session_bindings',
    ).get()).toEqual({ subject_fingerprint: 'a'.repeat(64), first_grant_id: null });
  });
});
