import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createShipwrightThread,
  getOrCreateShipwrightThread,
  insertScopedShipwrightMessage,
  insertShipwrightProposal,
  listScopedShipwrightMessages,
  getShipwrightProposalOrigin,
  exportScopedShipwrightContext,
} from '../src/db.js';
import { MIGRATIONS_DIR, SCHEMA_SQL, makeTestD1 } from './support/d1-sqlite.js';
import { runRetentionSweep, SHIPWRIGHT_RETENTION_DAYS } from '../src/retention-sweep.js';
import type { Env } from '../src/types.js';

const MIGRATION = '2026-09-14-shipwright-scoped-context.sql';

function seedUser(raw: ReturnType<typeof makeTestD1>['raw']): void {
  raw.prepare(
    'INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, ?, ?, ?, 0)',
  ).run('u_1', 1, 'octo', 1);
}

describe('Shipwright scoped-context migration', () => {
  it('is additive and mirrored by schema.sql', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8');
    const schema = readFileSync(SCHEMA_SQL, 'utf8');
    expect(sql).not.toMatch(/\b(?:DROP|ALTER|RENAME)\b/i);
    for (const table of [
      'shipwright_threads',
      'shipwright_thread_messages',
      'shipwright_repo_memory',
      'shipwright_proposals',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('adds a constrained proposal origin and mirrors it in the fresh schema', () => {
    const originMigration = '2026-09-14-zz-shipwright-proposal-origin.sql';
    const sql = readFileSync(join(MIGRATIONS_DIR, originMigration), 'utf8');
    const schema = readFileSync(SCHEMA_SQL, 'utf8');
    expect(sql).toContain("DEFAULT 'assistant_conversation'");
    expect(sql).toContain("'deterministic_onboarding'");
    expect(schema).toContain('origin TEXT NOT NULL');
    const t = makeTestD1();
    seedUser(t.raw);
    t.raw.prepare(
      'INSERT INTO shipwright_threads (id,user_id,installation_id,repo_full_name,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).run(`swt_${'9'.repeat(48)}`, 'u_1', 11, 'octo/repo', 1, 1);
    expect(() => t.raw.prepare(
      'INSERT INTO shipwright_proposals (id,thread_id,user_id,installation_id,repo_full_name,yaml,origin,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run('bad', `swt_${'9'.repeat(48)}`, 'u_1', 11, 'octo/repo', 'fleet: {}', 'invented', 1)).toThrow();
    t.close();
  });

  it('leaves the previous schema usable after the new tables arrive', () => {
    const quotaMigration = '2026-09-14-z-shipwright-thread-quota.sql';
    const originMigration = '2026-09-14-zz-shipwright-proposal-origin.sql';
    const t = makeTestD1([MIGRATION, quotaMigration, originMigration]);
    seedUser(t.raw);
    t.raw.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8'));
    t.raw.exec(readFileSync(join(MIGRATIONS_DIR, quotaMigration), 'utf8'));
    t.raw.prepare(
      'INSERT INTO shipwright_chats (user_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    ).run('u_1', 'user', 'legacy release still writes', 2);
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_chats').get()).toEqual({ n: 1 });
    t.close();
  });
});

describe('Shipwright proposal provenance', () => {
  it('idempotently reuses one thread per repo and enforces the 100-repo quota', async () => {
    const t = makeTestD1();
    seedUser(t.raw);
    const first = await getOrCreateShipwrightThread(t.db, {
      id: `swt_${'1'.repeat(48)}`, user_id: 'u_1', installation_id: 11,
      repo_full_name: 'octo/repo-0', created_at: 1, updated_at: 1,
    });
    const reused = await getOrCreateShipwrightThread(t.db, {
      id: `swt_${'2'.repeat(48)}`, user_id: 'u_1', installation_id: 11,
      repo_full_name: 'octo/repo-0', created_at: 2, updated_at: 2,
    });
    expect(reused.id).toBe(first.id);
    for (let i = 1; i < 100; i += 1) {
      t.raw.prepare(
        'INSERT INTO shipwright_threads (id,user_id,installation_id,repo_full_name,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ).run(`swt_${i.toString(16).padStart(48, '0')}`, 'u_1', 11, `octo/repo-${i}`, 1, 1);
    }
    const stillReusedAtQuota = await getOrCreateShipwrightThread(t.db, {
      id: `swt_${'3'.repeat(48)}`, user_id: 'u_1', installation_id: 11,
      repo_full_name: 'octo/repo-0', created_at: 3, updated_at: 3,
    });
    expect(stillReusedAtQuota.id).toBe(first.id);
    expect(() => t.raw.prepare(
      'INSERT INTO shipwright_threads (id,user_id,installation_id,repo_full_name,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).run(`swt_${'f'.repeat(48)}`, 'u_1', 11, 'octo/repo-over-quota', 1, 1)).toThrow(/quota exceeded/);
    t.close();
  });

  it('binds identical YAML to its exact user + installation + repo + thread', async () => {
    const t = makeTestD1();
    seedUser(t.raw);
    const common = { user_id: 'u_1', created_at: 1, updated_at: 1 };
    await createShipwrightThread(t.db, {
      id: `swt_${'a'.repeat(48)}`, installation_id: 11, repo_full_name: 'octo/repo-a', ...common,
    });
    await createShipwrightThread(t.db, {
      id: `swt_${'b'.repeat(48)}`, installation_id: 12, repo_full_name: 'octo/repo-b', ...common,
    });
    const yaml = 'fleet:\n  agents: {}';
    await insertShipwrightProposal(t.db, {
      id: `swp_${'c'.repeat(48)}`,
      threadId: `swt_${'a'.repeat(48)}`,
      userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a', yaml,
      origin: 'assistant_conversation', now: 2,
    });
    expect(await getShipwrightProposalOrigin(t.db, {
      threadId: `swt_${'a'.repeat(48)}`,
      userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a', yaml,
    })).toBe('assistant_conversation');
    expect(await getShipwrightProposalOrigin(t.db, {
      threadId: `swt_${'b'.repeat(48)}`,
      userId: 'u_1', installationId: 12, repoFullName: 'octo/repo-b', yaml,
    })).toBeNull();
    t.close();
  });

  it('never mixes the legacy user-only transcript into scoped history', async () => {
    const t = makeTestD1();
    seedUser(t.raw);
    const threadId = `swt_${'d'.repeat(48)}`;
    await createShipwrightThread(t.db, {
      id: threadId, user_id: 'u_1', installation_id: 11,
      repo_full_name: 'octo/repo-a', created_at: 1, updated_at: 1,
    });
    t.raw.prepare(
      'INSERT INTO shipwright_chats (user_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    ).run('u_1', 'assistant', 'legacy secret', 1);
    await insertScopedShipwrightMessage(t.db, {
      threadId, userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a',
      role: 'user', content: 'scoped hello', now: 2,
    });
    const rows = await listScopedShipwrightMessages(t.db, {
      threadId, userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a',
    });
    expect(rows.map((r) => r.content)).toEqual(['scoped hello']);
    t.close();
  });

  it('prunes raw messages after 30 days but retains structured proposal provenance', async () => {
    const t = makeTestD1();
    seedUser(t.raw);
    const threadId = `swt_${'e'.repeat(48)}`;
    await createShipwrightThread(t.db, {
      id: threadId, user_id: 'u_1', installation_id: 11,
      repo_full_name: 'octo/repo-a', created_at: 1, updated_at: 1,
    });
    await insertScopedShipwrightMessage(t.db, {
      threadId, userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a',
      role: 'assistant', content: 'old raw transcript', now: 1,
    });
    await insertShipwrightProposal(t.db, {
      id: `swp_${'f'.repeat(48)}`, threadId, userId: 'u_1', installationId: 11,
      repoFullName: 'octo/repo-a', yaml: 'fleet:\n  agents: {}', origin: 'assistant_conversation', now: 1,
    });
    const now = (SHIPWRIGHT_RETENTION_DAYS + 1) * 24 * 60 * 60;
    await runRetentionSweep({ DB: t.db } as Env, now);
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_thread_messages').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_proposals').get()).toEqual({ n: 1 });
    const exported = await exportScopedShipwrightContext(t.db, 'u_1');
    expect(exported.threads).toHaveLength(1);
    expect(exported.messages).toHaveLength(0);
    expect(exported.proposals.map((row) => row.repo_full_name)).toEqual(['octo/repo-a']);
    t.close();
  });
});
