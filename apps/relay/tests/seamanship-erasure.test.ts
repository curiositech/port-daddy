/**
 * Erasure coverage for the tables this change adds (ADR-0101 delete control).
 *
 * `eraseUser` grew seven DELETEs in this change — the Snipe chat log and its
 * spend ledger, the suggestion queue and its jobs, unspent build grants, the
 * frontmatter cache, and the public skill listing. Only one of the statements
 * in that function had a test before (shipwright_chats), and a DELETE that
 * names the wrong table or the wrong column fails silently: it deletes zero
 * rows and reports nothing, so erasure "succeeds" while the data stays.
 *
 * Two of these are not merely privacy bookkeeping:
 *
 *   · seamanship_build_grants — an unspent grant is a pull request waiting to
 *     happen. An erased account that keeps one can still author into a repo.
 *   · skill_listings — a public directory of the owner's skills. Leaving it up
 *     means an erased account keeps publishing for the 30 days before the
 *     retention job runs.
 *
 * Real SQLite against the schema of record, so a column that does not exist is
 * an error here rather than a no-op in production.
 */

import { describe, it, expect } from 'vitest';
import { eraseUser } from '../src/db.js';
import { hashHex } from '../src/crypto.js';
import { makeTestD1, seedSession, seedSuggestion, type TestD1 } from './support/d1-sqlite.js';

const COOKIE = 'e'.repeat(64);
const NOW = 1_800_000_000;

/** Every table eraseUser must clear for this user, with a row seeded in each. */
function seedEverything(t: TestD1, userId: string, login: string): void {
  const sugId = `sug_${userId}`;
  seedSuggestion(t, { id: sugId, userId, repo: 'octocat/port-daddy', skillName: 'a-skill', status: 'approved' });
  t.raw
    .prepare(
      'INSERT INTO seamanship_build_grants (suggestion_id, grant_id, user_id, repo_full_name, installation_id, ' +
        'issued_at, issued_by, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    )
    .run(sugId, `grt_${userId}`, userId, 'octocat/port-daddy', 4242, NOW - 60, login);
  t.raw
    .prepare('INSERT INTO seamanship_suggestion_jobs (job_id, user_id, repo_full_name, state, requested_at) VALUES (?, ?, ?, ?, ?)')
    .run(`job_${userId}`, userId, 'octocat/port-daddy', 'queued', NOW - 60);
  t.raw
    .prepare('INSERT INTO seamanship_skill_cache (user_id, repo_full_name, source_path, skill_id, name, description, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, 'octocat/port-daddy', 'skills/a-skill/SKILL.md', 'a-skill', 'A Skill', 'does a thing', NOW - 60);
  t.raw
    .prepare('INSERT INTO agent_chats (agent, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('snipe', userId, 'user', 'what should I build', NOW - 60);
  t.raw
    .prepare('INSERT INTO agent_chat_spend (agent, user_id, window_start, messages, est_tokens) VALUES (?, ?, ?, ?, ?)')
    .run('snipe', userId, NOW - 3600, 3, 900);
  t.raw
    .prepare('INSERT INTO skill_listings (namespace, skill_id, name, description, repo_full_name, source_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(login, 'a-skill', 'A Skill', 'does a thing', 'octocat/port-daddy', 'skills/a-skill/SKILL.md', NOW - 60);
}

const count = (t: TestD1, sql: string, ...binds: unknown[]): number =>
  (t.raw.prepare(sql).get(...(binds as never[])) as { n: number }).n;

describe('eraseUser — every table this change added goes with the account', () => {
  it('clears all seven, and soft-deletes the user row', async () => {
    const t = makeTestD1();
    try {
      const { userId, login } = seedSession(t, { tokenHash: hashHex(COOKIE) });
      seedEverything(t, userId, login);

      // Premise: every row really is there first. Without this the assertions
      // below would pass just as well against a seed that never inserted.
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_suggestions WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_build_grants WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_suggestion_jobs WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_skill_cache WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM agent_chats WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM agent_chat_spend WHERE user_id = ?', userId)).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM skill_listings WHERE namespace = ?', login)).toBe(1);

      const purged = await eraseUser(t.db, userId, NOW);
      expect(purged).toBe(1); // the seeded session

      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_suggestions WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_build_grants WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_suggestion_jobs WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_skill_cache WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM agent_chats WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM agent_chat_spend WHERE user_id = ?', userId)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM skill_listings WHERE namespace = ?', login)).toBe(0);
      expect(count(t, 'SELECT COUNT(*) AS n FROM web_sessions WHERE user_id = ?', userId)).toBe(0);

      const row = t.raw.prepare('SELECT deleted_at, primary_email FROM users WHERE id = ?').get(userId) as
        | { deleted_at: number | null; primary_email: string | null }
        | undefined;
      expect(row?.deleted_at).toBe(NOW);
      expect(row?.primary_email).toBeNull();
    } finally {
      t.close();
    }
  });

  it('erasing one account leaves another account\'s rows alone', async () => {
    // The grants DELETE is scoped by user_id and the listings DELETE by
    // namespace. Both would still pass the test above if the WHERE clause were
    // dropped entirely — this is the one that notices.
    const t = makeTestD1();
    try {
      const { userId, login } = seedSession(t, { tokenHash: hashHex(COOKIE) });
      seedEverything(t, userId, login);

      t.raw
        .prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, ?, ?, ?, 0)')
        .run('u_keep', 777, 'keeper', NOW - 1000);
      seedEverything(t, 'u_keep', 'keeper');

      await eraseUser(t.db, userId, NOW);

      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_suggestions WHERE user_id = ?', 'u_keep')).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM seamanship_build_grants WHERE user_id = ?', 'u_keep')).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM agent_chats WHERE user_id = ?', 'u_keep')).toBe(1);
      expect(count(t, 'SELECT COUNT(*) AS n FROM skill_listings WHERE namespace = ?', 'keeper')).toBe(1);
      expect(
        (t.raw.prepare('SELECT deleted_at FROM users WHERE id = ?').get('u_keep') as { deleted_at: number | null })
          .deleted_at,
      ).toBeNull();
    } finally {
      t.close();
    }
  });
});
