/**
 * The claim race, against a real SQL engine.
 *
 * work-register.test.ts says, in place of a green tick, that this was the one
 * thing it could not honestly cover: the whole product is a single
 * INSERT ... ON CONFLICT ... DO UPDATE whose WHERE clause decides whether a
 * claim is admitted, and a hand-written fake D1 would have to reimplement that
 * clause to answer -- which proves the fake works, not the code. This file is
 * that gap closed. D1 is SQLite, node:sqlite is SQLite, and the schema here is
 * the whole committed migration chain read off disk.
 *
 * THE RULE THAT MAKES IT WORTH ANYTHING: the statement under test is EXTRACTED
 * FROM src/work-register.ts, not retyped here. Retyping it would test the copy
 * and leave the shipped statement unexamined -- the same failure as a fake,
 * wearing a real engine's clothes. If claimSlug's SQL changes and stops
 * behaving, this test changes with it and fails.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAIM_STALE_AFTER_SECONDS } from '../src/work-register.js';
import { applyAllMigrations } from './helpers/d1-sqlite.js';

const SOURCE = fileURLToPath(new URL('../src/work-register.js', import.meta.url).href.replace(/\.js$/, '.ts'));

/** The shipped upsert, lifted out of the module rather than restated. */
function claimStatementFromSource(): string {
  const src = readFileSync(SOURCE, 'utf8');
  const start = src.indexOf('INSERT INTO work_claims');
  expect(start, 'claimSlug INSERT not found in src/work-register.ts').toBeGreaterThan(-1);
  const end = src.indexOf('`', start);
  expect(end, 'unterminated SQL template in src/work-register.ts').toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * The whole committed migration chain, in filename order.
 *
 * This file used to load 2026-09-08-work-register.sql alone and strip its
 * `REFERENCES users(id)` by regex, because `users` is created by an earlier
 * migration. That is the schema-that-never-exists-in-production failure the
 * shared helper was written to close: the test ran against a work_claims with
 * a foreign key the shipped table has and this one did not, and the strip had
 * to be maintained by hand every time the migration grew another reference.
 * applyAllMigrations() loads the chain the same way check-migrations.mjs does,
 * so the schema under test is the schema that ships, users table included.
 */
function schema(): string {
  return applyAllMigrations();
}

const REPO = 'curiositech/port-daddy';
const SLUG = 'some-real-work';

let db: DatabaseSync;
let SQL: string;

/**
 * One claim attempt, binding exactly what claimSlug binds, in its order.
 *
 * These binds are positional against a statement read out of the module, so
 * they move when it moves -- and when `owner` was added to the INSERT, every
 * test here failed on a NOT NULL constraint until they were updated. That is
 * the extraction discipline paying for itself: a retyped copy would have gone
 * on passing against a statement the Worker no longer runs.
 */
function claim(agent: string, at: number, headline = '', owner: string | null = null): number {
  const staleBefore = at - CLAIM_STALE_AFTER_SECONDS;
  const stmt = db.prepare(SQL);
  const res = stmt.run(
    REPO, SLUG, 'registered', agent, 'session', owner, headline,
    null, null, at, at, at, staleBefore,
  );
  return res.changes;
}

const holder = (): { agent: string | null; claimed_at: number | null } =>
  db.prepare('SELECT agent, claimed_at FROM work_claims WHERE slug = ?').get(SLUG) as never;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  // On for the same reason the shared helper turns them on: the migrations
  // declare these keys, and a test that ignored them could let a claim row
  // exist here that production would refuse.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema());
  SQL = claimStatementFromSource();
});

describe('the claim race, on real SQLite', () => {
  it('lifts the statement out of the module rather than restating it', () => {
    // Guards the discipline itself: if someone inlines a copy here, or the
    // source stops containing the upsert, this fails loudly rather than
    // quietly testing something else.
    expect(SQL).toContain('ON CONFLICT');
    expect(SQL).toContain('work_claims.state IN');
    expect(SQL).toContain('heartbeat_at');
  });

  it('admits the first asker', () => {
    expect(claim('agent-a', 1000, 'reading the kernel chapter')).toBe(1);
    expect(holder().agent).toBe('agent-a');
  });

  it('refuses the second asker while the first is alive — the product', () => {
    claim('agent-a', 1000);
    expect(claim('agent-b', 1060)).toBe(0);   // one minute later, still held
    expect(holder().agent).toBe('agent-a');   // and the holder is untouched
  });

  it('two agents racing on one slug: exactly one wins', () => {
    // Neither reads before writing, which is the point: both attempt the
    // upsert and the WHERE clause settles it. Run it as a burst.
    const results = ['a', 'b', 'c', 'd'].map((n) => claim(`agent-${n}`, 2000));
    expect(results.filter((c) => c === 1)).toHaveLength(1);
    expect(results.filter((c) => c === 0)).toHaveLength(3);
  });

  it('a re-claim by the holder is idempotent and keeps the original claimed_at', () => {
    claim('agent-a', 1000, 'first');
    const first = holder().claimed_at;
    expect(claim('agent-a', 1500, 'still me')).toBe(1);  // an agent that lost its reply may ask again
    expect(holder().agent).toBe('agent-a');
    expect(holder().claimed_at).toBe(first);             // not restarted
  });

  it('a claim inside the salvage clock is still refused', () => {
    claim('agent-a', 1000);
    expect(claim('agent-b', 1000 + CLAIM_STALE_AFTER_SECONDS)).toBe(0);
    expect(holder().agent).toBe('agent-a');
  });

  it('a claim one second past the salvage clock succeeds', () => {
    claim('agent-a', 1000);
    expect(claim('agent-b', 1000 + CLAIM_STALE_AFTER_SECONDS + 1)).toBe(1);
    expect(holder().agent).toBe('agent-b');
  });

  it('salvage restarts claimed_at, so the inheritor owns it from now', () => {
    claim('agent-a', 1000);
    const at = 1000 + CLAIM_STALE_AFTER_SECONDS + 1;
    claim('agent-b', at);
    expect(holder().claimed_at).toBe(at);
  });

  it('a released slug is open to anyone', () => {
    claim('agent-a', 1000);
    db.prepare("UPDATE work_claims SET state='open', agent=NULL, heartbeat_at=NULL WHERE slug=?").run(SLUG);
    expect(claim('agent-b', 1060)).toBe(1);
    expect(holder().agent).toBe('agent-b');
  });

  it('a finished slug is NOT re-claimable, which is the current contract', () => {
    // Recorded rather than asserted as desirable: the WHERE clause admits only
    // open/abandoned/same-agent/stale, so 'done' is terminal and there is no
    // un-finish. The master plan carries that as a named gap; if it changes,
    // this test is where the change announces itself.
    claim('agent-a', 1000);
    db.prepare("UPDATE work_claims SET state='done', heartbeat_at=? WHERE slug=?").run(1000, SLUG);
    expect(claim('agent-b', 1060)).toBe(0);
  });

  it('the heartbeat is what defers salvage, not the original claim', () => {
    claim('agent-a', 1000);
    db.prepare('UPDATE work_claims SET heartbeat_at=? WHERE slug=?').run(9000, SLUG);
    expect(claim('agent-b', 9000 + CLAIM_STALE_AFTER_SECONDS - 1)).toBe(0);
    expect(claim('agent-b', 9000 + CLAIM_STALE_AFTER_SECONDS + 1)).toBe(1);
  });

  it('the owner survives a salvage, so orphaned work still has someone to ask', () => {
    // The owner is who ANSWERS for the work; the agent is who is typing. A
    // salvage replaces the second and must not erase the first, which is
    // exactly the moment somebody wants to know whose work this was.
    claim('agent-a', 1000, 'first', 'erich');
    claim('agent-b', 1000 + CLAIM_STALE_AFTER_SECONDS + 1);   // names no owner
    const row = db.prepare('SELECT agent, owner FROM work_claims WHERE slug = ?').get(SLUG) as
      { agent: string; owner: string };
    expect(row.agent).toBe('agent-b');
    expect(row.owner).toBe('erich');
  });

  it('claims on different slugs do not contend', () => {
    claim('agent-a', 1000);
    const stmt = db.prepare(SQL);
    const at = 1000;
    const res = stmt.run(REPO, 'another-slug', 'registered', 'agent-b', 'session', null, '',
      null, null, at, at, at, at - CLAIM_STALE_AFTER_SECONDS);
    expect(res.changes).toBe(1);
  });

  // The S2 decision, checked rather than asserted in a comment: the sharing key
  // is the repository, so a second account's agent contends with the first
  // instead of getting its own private copy of the same slug. Under the
  // previous (user_id, repo, slug) key this test passed with TWO winners --
  // which is the whole product silently absent.
  it('one repository is one board, whichever account an agent belongs to', () => {
    expect(claim('erich-agent', 3000, 'kernel chapter')).toBe(1);
    // A different operator's agent, same repo, same slug, one minute later.
    expect(claim('collaborator-agent', 3060)).toBe(0);
    expect(holder().agent).toBe('erich-agent');
    const boards = db
      .prepare('SELECT COUNT(*) AS n FROM work_claims WHERE slug = ?')
      .get(SLUG) as { n: number };
    expect(boards.n, 'one row per (repo, slug), not one per account').toBe(1);
  });
});
