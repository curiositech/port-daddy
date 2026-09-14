import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createShipwrightThread,
  insertScopedShipwrightMessage,
  insertShipwrightProposal,
  listScopedShipwrightMessages,
  shipwrightProposalExists,
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

  it('leaves the previous schema usable after the new tables arrive', () => {
    const t = makeTestD1([MIGRATION]);
    seedUser(t.raw);
    t.raw.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8'));
    t.raw.prepare(
      'INSERT INTO shipwright_chats (user_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    ).run('u_1', 'user', 'legacy release still writes', 2);
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_chats').get()).toEqual({ n: 1 });
    t.close();
  });
});

describe('Shipwright proposal provenance', () => {
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
      userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a', yaml, now: 2,
    });
    expect(await shipwrightProposalExists(t.db, {
      threadId: `swt_${'a'.repeat(48)}`,
      userId: 'u_1', installationId: 11, repoFullName: 'octo/repo-a', yaml,
    })).toBe(true);
    expect(await shipwrightProposalExists(t.db, {
      threadId: `swt_${'b'.repeat(48)}`,
      userId: 'u_1', installationId: 12, repoFullName: 'octo/repo-b', yaml,
    })).toBe(false);
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
      repoFullName: 'octo/repo-a', yaml: 'fleet:\n  agents: {}', now: 1,
    });
    const now = (SHIPWRIGHT_RETENTION_DAYS + 1) * 24 * 60 * 60;
    await runRetentionSweep({ DB: t.db } as Env, now);
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_thread_messages').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('SELECT COUNT(*) AS n FROM shipwright_proposals').get()).toEqual({ n: 1 });
    t.close();
  });
});
