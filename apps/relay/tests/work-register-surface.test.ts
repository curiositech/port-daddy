/**
 * The register's HTTP surface, against a real engine.
 *
 * The two sibling files split the register between them: work-register.test.ts
 * checks the pure decisions and the guards that return before any query, and
 * work-register-race.test.ts checks the one SQL statement the whole product
 * rests on. Neither could reach the paths in between — anything that reads a
 * row before deciding — because a hand-written fake D1 would have had to
 * reimplement the query to answer.
 *
 * This file closes that with tests/helpers/d1-sqlite.ts: a D1-shaped adapter
 * over node:sqlite running the COMMITTED migrations, so `handleRegisterApi`
 * executes its real statements and the assertions are about the register's
 * behaviour rather than about a stand-in's.
 *
 * The boundary it exists for first is the cold start. An agent's `pdu_` token
 * carries no GitHub credential, so the register admits it only where its
 * account has already passed a live repo-ACL check in a browser. That refusal
 * had no test at all — the one place where being wrong means either every
 * agent locked out of a working board, or a device token reading boards its
 * operator never opened.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb, migration, type TestDb } from './helpers/d1-sqlite.js';
import { handleRegisterApi } from '../src/work-register.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const REPO = 'curiositech/port-daddy';
// Shaped as the minter shapes them: `pdu_` and 64 hex. readBearerToken rejects
// anything else before the database is touched, so a readable placeholder here
// would have tested the 401 path in every case and looked like a passing suite.
const TOKEN = `pdu_${'a1b2c3d4'.repeat(8)}`;

/** Only what the register's paths touch, so the fixture stays readable. */
const IDENTITY_SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, login TEXT, display_name TEXT, primary_email TEXT,
  email_verified INTEGER DEFAULT 0, deleted_at INTEGER
);
CREATE TABLE user_tokens (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER
);`;

let db: TestDb;
let env: Env;

const asAgent = (path: string, init: RequestInit = {}) =>
  new Request(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

beforeEach(() => {
  db = makeDb(
    IDENTITY_SCHEMA,
    migration('2026-09-08-work-register.sql', { dropForeignKeys: true }),
  );
  db.raw
    .prepare('INSERT INTO users (id, login) VALUES (?, ?)')
    .run('u_erich', 'erich-owens');
  db.raw
    .prepare('INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(hashHex(TOKEN), 'u_erich', 'agent under test', 1);
  env = { DB: db.DB } as unknown as Env;
});

describe('the cold start: an agent on a board nobody has opened', () => {
  it('refuses, because a device token has no repo ACL to check against', async () => {
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    expect(res.status).toBe(403);
  });

  it('names the step that fixes it, rather than refusing into silence', async () => {
    // The refusal is the product here as much as the claim is. An agent that
    // reads this can write the answer into its own note and stop; one that
    // reads a bare 403 retries a wall.
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    const body = (await res.json()) as Record<string, string>;
    expect(body.detail).toMatch(/operator/i);
    expect(body.operator_step).toContain('signed in with GitHub');
    expect(body.operator_step).toContain(encodeURIComponent(REPO));
    expect(body.repo).toBe(REPO);
  });

  it('refuses the write paths too, not only the read', async () => {
    const res = await handleRegisterApi(
      asAgent(`/v1/register/claim?repo=${REPO}`, {
        method: 'POST',
        body: JSON.stringify({ slug: 'some-work', agent: 'agent-a' }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe('once an operator has opened the board', () => {
  // What a browser visit records. Written directly rather than through a faked
  // GitHub session, because the ACL check itself belongs to auth-github and is
  // not what these tests are about; what IS being tested is that the register
  // reads this row and nothing else to admit an agent.
  const open = (userId = 'u_erich') =>
    db.raw
      .prepare(
        `INSERT INTO work_board_members (repo_full_name, user_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(REPO, userId, 1, 1);

  it('admits the agent', async () => {
    open();
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    expect(res.status).toBe(200);
  });

  it('a membership on ANOTHER repository does not open this one', async () => {
    db.raw
      .prepare(
        `INSERT INTO work_board_members (repo_full_name, user_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run('curiositech/somewhere-else', 'u_erich', 1, 1);
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    expect(res.status, 'membership is per repository, not per account').toBe(403);
  });

  it("another account's membership does not admit this account's token", async () => {
    open('u_someone_else');
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    expect(res.status).toBe(403);
  });

  it('a revoked token is refused before membership is even consulted', async () => {
    open();
    db.raw.prepare('UPDATE user_tokens SET revoked_at = ? WHERE token_hash = ?').run(2, hashHex(TOKEN));
    const res = await handleRegisterApi(asAgent(`/v1/register/board?repo=${REPO}`), env);
    expect(res.status).toBe(401);
  });

  it('says the registry has never been read, so a slug is unknown rather than absent', async () => {
    open();
    const res = await handleRegisterApi(asAgent(`/v1/register/available?repo=${REPO}`), env);
    const body = (await res.json()) as { registry: unknown; warning: string };
    expect(body.registry).toBeNull();
    expect(body.warning).toMatch(/no registry projection/i);
    expect(body.warning).toMatch(/proposed queue/i);
  });
});

describe('an agent claims, and the next one is told who has it', () => {
  beforeEach(() => {
    db.raw
      .prepare(
        `INSERT INTO work_board_members (repo_full_name, user_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(REPO, 'u_erich', 1, 1);
  });

  const claim = (agent: string, slug = 'kernel-figures') =>
    handleRegisterApi(
      asAgent(`/v1/register/claim?repo=${REPO}`, {
        method: 'POST',
        body: JSON.stringify({ slug, agent, headline: 'redrawing figure 1.3' }),
      }),
      env,
    );

  it('admits the first and refuses the second, through the real HTTP path', async () => {
    expect((await claim('agent-a')).status).toBe(200);
    const second = await claim('agent-b');
    expect(second.status).toBe(409);
    const body = (await second.json()) as {
      held_by?: string; headline?: string; hint?: string;
    };
    // A refusal that does not say who holds it just tells the asker to retry.
    // Naming the holder and what they are doing is what turns the refusal into
    // the coordination.
    expect(body.held_by).toBe('agent-a');
    expect(body.headline).toBe('redrawing figure 1.3');
    expect(body.hint).toBeTruthy();
  });

  it('a slug the registry never admitted is stored as proposed, not scheduled', async () => {
    await claim('agent-a', 'something-nobody-registered');
    const row = db.raw
      .prepare('SELECT provenance FROM work_claims WHERE slug = ?')
      .get('something-nobody-registered') as { provenance: string };
    expect(row.provenance).toBe('proposed');
  });

  it('the claim is recorded on the repository, not on the claiming account', async () => {
    await claim('agent-a');
    const cols = db.raw.prepare('SELECT * FROM work_claims LIMIT 1').get() as Record<string, unknown>;
    expect(Object.keys(cols)).not.toContain('user_id');
    expect(cols.repo_full_name).toBe(REPO);
  });
});

describe('owners and links: who answers for it, and what else is about it', () => {
  beforeEach(() => {
    db.raw
      .prepare(
        `INSERT INTO work_board_members (repo_full_name, user_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(REPO, 'u_erich', 1, 1);
  });

  const post = (action: string, body: Record<string, unknown>) =>
    handleRegisterApi(
      asAgent(`/v1/register/${action}?repo=${REPO}`, { method: 'POST', body: JSON.stringify(body) }),
      env,
    );

  it('an owner outlives the agent that held the slug', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a', owner: 'erich' });
    await post('release', { slug: 'kernel-figures', agent: 'agent-a', body: 'ran out of turn' });
    const row = db.raw
      .prepare('SELECT agent, owner, state FROM work_claims WHERE slug = ?')
      .get('kernel-figures') as { agent: string | null; owner: string; state: string };
    expect(row.state).toBe('open');
    expect(row.agent, 'the holder is gone').toBeNull();
    expect(row.owner, 'but the work still belongs to someone').toBe('erich');
  });

  it('a later claim that names no owner keeps the one already recorded', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a', owner: 'erich' });
    await post('release', { slug: 'kernel-figures', agent: 'agent-a' });
    await post('claim', { slug: 'kernel-figures', agent: 'agent-b' });
    const row = db.raw
      .prepare('SELECT agent, owner FROM work_claims WHERE slug = ?')
      .get('kernel-figures') as { agent: string; owner: string };
    expect(row.agent).toBe('agent-b');
    expect(row.owner).toBe('erich');
  });

  it('links attach, and the same link twice is one link', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a' });
    await post('link', { slug: 'kernel-figures', kind: 'pr', ref: '10097', agent: 'agent-a' });
    await post('link', { slug: 'kernel-figures', kind: 'pr', ref: '10097', title: 'The register', agent: 'agent-a' });
    await post('link', { slug: 'kernel-figures', kind: 'adr', ref: 'docs/adr/0119.md', agent: 'agent-a' });
    const res = await handleRegisterApi(
      asAgent(`/v1/register/item?repo=${REPO}&slug=kernel-figures`), env,
    );
    const body = (await res.json()) as { links: Array<{ kind: string; ref: string; title: string }> };
    expect(body.links).toHaveLength(2);
    const pr = body.links.find((l) => l.kind === 'pr');
    expect(pr?.title, 'a repeat carries the better title').toBe('The register');
  });

  it('refuses a link kind the board could not render', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a' });
    const res = await post('link', { slug: 'kernel-figures', kind: 'vibes', ref: 'x', agent: 'agent-a' });
    expect(res.status).toBe(400);
  });

  it('a link survives the claim being finished, because it is the answer to "where did this go"', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a' });
    await post('link', { slug: 'kernel-figures', kind: 'pr', ref: '10097', agent: 'agent-a' });
    await post('finish', { slug: 'kernel-figures', agent: 'agent-a', body: 'merged' });
    const res = await handleRegisterApi(
      asAgent(`/v1/register/item?repo=${REPO}&slug=kernel-figures`), env,
    );
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links).toHaveLength(1);
  });

  it('the board carries links and pages without losing the total', async () => {
    await post('claim', { slug: 'kernel-figures', agent: 'agent-a', owner: 'erich' });
    await post('link', { slug: 'kernel-figures', kind: 'pr', ref: '10097', agent: 'agent-a' });
    await post('claim', { slug: 'other-work', agent: 'agent-b' });
    const res = await handleRegisterApi(
      asAgent(`/v1/register/board?repo=${REPO}&order=slug&limit=1`), env,
    );
    const body = (await res.json()) as {
      count: number; total: number; next_cursor: string | null; order: string;
      items: Array<{ slug: string; links?: unknown[] }>;
    };
    expect(body.order).toBe('slug');
    expect(body.count).toBe(1);
    expect(body.total).toBe(2);
    expect(body.next_cursor).toBe('kernel-figures');
    expect(body.items[0].links).toHaveLength(1);
  });

  it('refuses a query it cannot mean, rather than serving the whole board', async () => {
    const res = await handleRegisterApi(
      asAgent(`/v1/register/board?repo=${REPO}&order=whenever`), env,
    );
    expect(res.status).toBe(400);
  });
});
