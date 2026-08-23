/**
 * Purser adversarial suite for #9638 (relay roadmap command-center mirror) —
 * AUTH + TENANT ISOLATION.
 *
 * What the committed purser artifact contained before this repair: a bare
 * `export default { async fetch(request, env, ctx) { /* route logic *\/ } }`
 * worker stub — five lines, zero `describe`/`it`, so jest reported "Your test
 * suite must contain at least one test" and #9638 could not merge through its
 * own test base (pd-purser defect #9669: the authoring step sees the diff but
 * not the repository, so it emits a fragment instead of a runnable suite).
 *
 * What it asserts now — the obligation the filename encodes, against the real
 * code in #9638's head:
 *   1. `PUT /v1/roadmap/snapshot` and `GET /v1/roadmap/mirror` 401 with NO
 *      credential, and do so without touching storage at all (the fixture DB
 *      throws on `prepare`, so a pass proves the gate, not an empty table).
 *   2. An unknown bearer and a REVOKED bearer are 401 on both verbs — not a
 *      fallback to some other account, and revocation bites the read path too.
 *   3. A second account pushing the SAME repo name lands on its OWN mirror:
 *      two header rows, one per user_id, and the two boards are disjoint in
 *      all four mirror tables.
 *   4. A cross-account read 404s (`NO_MIRROR` / `NO_ITEM`) rather than leaking
 *      the other account's board, header watermark, or item detail.
 *   5. The mirror is keyed off the CREDENTIAL, never off the payload: a body
 *      that names another user still lands under the caller.
 *
 * Fixture idiom (borrowed from apps/relay/tests/roadmap-mirror.test.ts): the
 * D1 binding is a thin adapter over a REAL SQLite database running the REAL
 * 15-file `apps/relay/migrations` chain — real CHECK constraints, real FKs,
 * real transactions. The relay's own vitest suite uses `node:sqlite`; this
 * file runs in the ROOT jest project, whose resolver does not expose
 * `node:sqlite` on Node 22 (it is flag-gated, so it is absent from
 * `module.builtinModules` and jest-resolve rejects it), so the same adapter is
 * built over the root project's own `better-sqlite3`. Same engine, same
 * migrations, same constraints — no mock of the storage layer anywhere.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  handleRoadmapSnapshotPut,
  handleRoadmapMirrorGet,
} from '../../../apps/relay/src/roadmap-mirror.js';
import { hashHex } from '../../../apps/relay/src/crypto.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'relay', 'migrations');

const BASE = 'https://relay.example';
const ALICE_TOKEN = `pdu_${'aa'.repeat(32)}`;
const BOB_TOKEN = `pdu_${'bb'.repeat(32)}`;
const UNKNOWN_TOKEN = `pdu_${'cc'.repeat(32)}`;
const REVOKED_TOKEN = `pdu_${'dd'.repeat(32)}`;

type SqlDb = InstanceType<typeof Database>;
/** The relay's Env, derived from the handler signature (no workers-types needed). */
type RelayEnv = Parameters<typeof handleRoadmapSnapshotPut>[1];

/** D1 adapter over a real SQLite db with the real migration chain applied. */
function makeRealDb(): { d1: unknown; sql: SqlDb } {
  const sql = new Database(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (migrations.length === 0) throw new Error('no relay migrations found — fixture would be vacuous');
  for (const name of migrations) sql.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

  const prepare = (query: string) => {
    // better-sqlite3 binds `?1`-style numbered placeholders by name and plain
    // `?` placeholders positionally; D1's .bind() is positional for both.
    const numbered = /\?\d/.test(query);
    let args: unknown[] = [];
    const params = (): unknown[] =>
      numbered ? [Object.fromEntries(args.map((v, i) => [String(i + 1), v]))] : args;
    const stmt = {
      bind(...v: unknown[]) {
        args = v.map((x) => (x === undefined ? null : x));
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        return (sql.prepare(query).get(...(params() as never[])) as T | undefined) ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: sql.prepare(query).all(...(params() as never[])) as T[] };
      },
      async run(): Promise<{ success: boolean; meta: { changes: number } }> {
        const info = sql.prepare(query).run(...(params() as never[]));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
    return stmt;
  };

  const d1 = {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { d1, sql };
}

function seedUsers(sql: SqlDb): void {
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_alice', 1, 'alice', 100)");
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_bob', 2, 'bob', 100)");
  const ins = sql.prepare(
    'INSERT INTO user_tokens (token_hash, user_id, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
  );
  ins.run(hashHex(ALICE_TOKEN), 'u_alice', 'alice laptop', 100, null);
  ins.run(hashHex(BOB_TOKEN), 'u_bob', 'bob laptop', 100, null);
  // A token that WAS alice's and has been revoked — same account, dead credential.
  ins.run(hashHex(REVOKED_TOKEN), 'u_alice', 'alice old laptop', 100, 150);
}

function makeEnv(): { env: RelayEnv; sql: SqlDb } {
  const { d1, sql } = makeRealDb();
  seedUsers(sql);
  const env = {
    DB: d1,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    PUBLIC_BASE_URL: BASE,
  } as unknown as RelayEnv;
  return { env, sql };
}

/** An Env whose storage explodes if touched — proves the gate, not an empty DB. */
const THROWING_ENV = {
  DB: {
    prepare() {
      throw new Error('storage must not be touched without a credential');
    },
    batch() {
      throw new Error('storage must not be touched without a credential');
    },
  },
  PUBLIC_BASE_URL: BASE,
} as unknown as RelayEnv;

const GENERATED_AT = 1_755_800_000_000;

function snapshotBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repoFullName: 'acme/widgets',
    harbor: 'flotilla',
    generatedAt: GENERATED_AT,
    daemonLabel: 'harbor-1',
    items: [
      {
        slug: 'alice-ships-the-mirror', status: 'now', summaryMd: 'Alice private plan',
        lastTouchedAt: GENERATED_AT - 1000, createdAt: GENERATED_AT - 9000,
      },
      {
        slug: 'alice-board-page', status: 'backlog', summaryMd: 'Alice board page',
        lastTouchedAt: GENERATED_AT - 2000, createdAt: GENERATED_AT - 8000,
      },
    ],
    edges: [
      { scope: 'roadmap', sourceId: 'alice-ships-the-mirror', edgeType: 'parent_of', targetId: 'alice-board-page' },
    ],
    activityTail: [
      { at: GENERATED_AT - 1000, slug: 'alice-ships-the-mirror', kind: 'touch', byId: 'agent:coxswain' },
    ],
    ...overrides,
  };
}

const BOB_BODY = snapshotBody({
  daemonLabel: 'bob-harbor',
  generatedAt: GENERATED_AT + 5_000,
  items: [
    {
      slug: 'bob-only-item', status: 'now', summaryMd: 'Bob private plan',
      lastTouchedAt: GENERATED_AT, createdAt: GENERATED_AT - 100,
    },
  ],
  edges: [],
  activityTail: [{ at: GENERATED_AT, slug: 'bob-only-item', kind: 'touch' }],
});

function putReq(body: unknown, token: string | null): Request {
  return new Request(`${BASE}/v1/roadmap/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function getReq(query: string, token: string | null): Request {
  return new Request(`${BASE}/v1/roadmap/mirror?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

const MIRROR_TABLES = [
  'roadmap_mirrors',
  'roadmap_mirror_items',
  'roadmap_mirror_edges',
  'roadmap_mirror_activity',
] as const;

function countFor(sql: SqlDb, table: string, userId: string): number {
  return (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;
}

describe('#9638 roadmap mirror — no credential, no tenant data', () => {
  it('PUT /v1/roadmap/snapshot 401s with no token and never touches storage', async () => {
    const res = await handleRoadmapSnapshotPut(putReq(snapshotBody(), null), THROWING_ENV);
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('GET /v1/roadmap/mirror 401s with no token and never touches storage', async () => {
    const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', null), THROWING_ENV);
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('the 401 is the FIRST gate: it fires even for a payload that would otherwise 400/413', async () => {
    // An unauthenticated caller must not be able to probe the validator (a
    // distinguishable 400 vs 401 is an oracle for what the relay accepts).
    for (const body of ['{not json', snapshotBody({ repoFullName: 'nope' })]) {
      const res = await handleRoadmapSnapshotPut(putReq(body, null), THROWING_ENV);
      expect(res.status).toBe(401);
    }
  });
});

describe('#9638 roadmap mirror — unknown and revoked bearers', () => {
  let env: RelayEnv;
  let sql: SqlDb;
  beforeEach(() => { ({ env, sql } = makeEnv()); });

  it('an unknown bearer is 401 on both verbs and writes nothing', async () => {
    const put = await handleRoadmapSnapshotPut(putReq(snapshotBody(), UNKNOWN_TOKEN), env);
    expect(put.status).toBe(401);
    const get = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', UNKNOWN_TOKEN), env);
    expect(get.status).toBe(401);
    for (const table of MIRROR_TABLES) {
      expect((sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  it('a REVOKED bearer for a real account is 401 — on the read path too', async () => {
    // Alice pushes with her live token, so there IS data behind the gate.
    expect((await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env)).status).toBe(200);
    expect(countFor(sql, 'roadmap_mirrors', 'u_alice')).toBe(1);

    const read = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', REVOKED_TOKEN), env);
    expect(read.status).toBe(401);
    const write = await handleRoadmapSnapshotPut(
      putReq(snapshotBody({ daemonLabel: 'stolen-daemon' }), REVOKED_TOKEN), env,
    );
    expect(write.status).toBe(401);
    // And the revoked write did not alter alice's mirror.
    const header = sql.prepare("SELECT daemon_label FROM roadmap_mirrors WHERE user_id = 'u_alice'").get() as { daemon_label: string };
    expect(header.daemon_label).toBe('harbor-1');
  });

  it('a malformed Authorization header is 401, not an unauthenticated 200', async () => {
    for (const header of ['Bearer', 'Bearer ', 'Basic ' + ALICE_TOKEN, ALICE_TOKEN]) {
      const req = new Request(`${BASE}/v1/roadmap/mirror?repo=acme/widgets`, { headers: { Authorization: header } });
      expect((await handleRoadmapMirrorGet(req, env)).status).toBe(401);
    }
  });
});

describe('#9638 roadmap mirror — two accounts, one repo name', () => {
  let env: RelayEnv;
  let sql: SqlDb;
  beforeEach(async () => {
    ({ env, sql } = makeEnv());
    expect((await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env)).status).toBe(200);
    expect((await handleRoadmapSnapshotPut(putReq(BOB_BODY, BOB_TOKEN), env)).status).toBe(200);
  });

  it('the same repo_full_name yields two independent mirrors, one per user_id', () => {
    const rows = sql
      .prepare('SELECT user_id, repo_full_name, daemon_label FROM roadmap_mirrors ORDER BY user_id')
      .all() as Array<{ user_id: string; repo_full_name: string; daemon_label: string }>;
    expect(rows).toEqual([
      { user_id: 'u_alice', repo_full_name: 'acme/widgets', daemon_label: 'harbor-1' },
      { user_id: 'u_bob', repo_full_name: 'acme/widgets', daemon_label: 'bob-harbor' },
    ]);
  });

  it('both boards are disjoint — neither account sees the other account’s slugs', async () => {
    const board = async (token: string) => {
      const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', token), env);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        mirror: Record<string, unknown>;
        board: Record<string, Array<{ slug: string }>>;
      };
      return body;
    };
    const alice = await board(ALICE_TOKEN);
    const bob = await board(BOB_TOKEN);

    const slugs = (b: { board: Record<string, Array<{ slug: string }>> }) =>
      Object.values(b.board).flat().map((i) => i.slug).sort();
    expect(slugs(alice)).toEqual(['alice-board-page', 'alice-ships-the-mirror']);
    expect(slugs(bob)).toEqual(['bob-only-item']);
    expect(slugs(alice).filter((s) => slugs(bob).includes(s))).toEqual([]);

    // Even the watermark is per-account — bob's newer push does not age alice's.
    expect(alice.mirror.generatedAt).toBe(GENERATED_AT);
    expect(bob.mirror.generatedAt).toBe(GENERATED_AT + 5_000);
    expect(alice.mirror.daemonLabel).toBe('harbor-1');
  });

  it('every mirror table partitions cleanly by user_id — no row crosses over', () => {
    // Each account owns exactly what it pushed, in all four tables.
    expect(MIRROR_TABLES.map((t) => countFor(sql, t, 'u_alice'))).toEqual([1, 2, 1, 1]);
    expect(MIRROR_TABLES.map((t) => countFor(sql, t, 'u_bob'))).toEqual([1, 1, 0, 1]);
    // …and nothing else exists: totals equal alice + bob exactly.
    for (const table of MIRROR_TABLES) {
      const total = (sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(total).toBe(countFor(sql, table, 'u_alice') + countFor(sql, table, 'u_bob'));
    }
    // Bob's slice contains none of alice's slugs and vice versa.
    const bobSlugs = (sql.prepare("SELECT slug FROM roadmap_mirror_items WHERE user_id = 'u_bob'").all() as Array<{ slug: string }>).map((r) => r.slug);
    expect(bobSlugs).toEqual(['bob-only-item']);
    const aliceEdgeOwners = (sql.prepare("SELECT DISTINCT user_id FROM roadmap_mirror_edges").all() as Array<{ user_id: string }>).map((r) => r.user_id);
    expect(aliceEdgeOwners).toEqual(['u_alice']);
  });

  it('bob’s push did not mutate a single one of alice’s stored rows', () => {
    // Re-push bob a second time with different content; alice's slice is byte-identical.
    const before = sql.prepare("SELECT * FROM roadmap_mirror_items WHERE user_id = 'u_alice' ORDER BY slug").all();
    return handleRoadmapSnapshotPut(
      putReq(snapshotBody({
        daemonLabel: 'bob-harbor-2', generatedAt: GENERATED_AT + 9_000,
        items: [{ slug: 'bob-second-item', status: 'done', summaryMd: 'x', lastTouchedAt: 1, createdAt: 1 }],
        edges: [], activityTail: [],
      }), BOB_TOKEN),
      env,
    ).then((res) => {
      expect(res.status).toBe(200);
      const after = sql.prepare("SELECT * FROM roadmap_mirror_items WHERE user_id = 'u_alice' ORDER BY slug").all();
      expect(after).toEqual(before);
    });
  });
});

describe('#9638 roadmap mirror — a cross-account read 404s, it does not leak', () => {
  it('an account with no mirror for the repo gets 404 NO_MIRROR, never the other account’s board', async () => {
    const { env } = makeEnv();
    expect((await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env)).status).toBe(200);

    const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', BOB_TOKEN), env);
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string; error: string; board?: unknown; mirror?: unknown };
    expect(body.code).toBe('NO_MIRROR');
    // The 404 body carries no board, no watermark, no slug — nothing of alice's.
    expect(body.board).toBeUndefined();
    expect(body.mirror).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('alice-ships-the-mirror');
    expect(JSON.stringify(body)).not.toContain('harbor-1');
  });

  it('a cross-account ITEM read 404s even when the slug exists for the other account', async () => {
    const { env } = makeEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env);
    await handleRoadmapSnapshotPut(putReq(BOB_BODY, BOB_TOKEN), env);

    // Bob HAS a mirror for this repo, so the header lookup succeeds — the item
    // lookup must still be scoped to bob, giving NO_ITEM rather than alice's row.
    const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets&slug=alice-ships-the-mirror', BOB_TOKEN), env);
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string; item?: unknown };
    expect(body.code).toBe('NO_ITEM');
    expect(body.item).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Alice private plan');

    // The same read on alice's own credential succeeds — so the 404 above is
    // isolation, not a broken lookup.
    const ok = await handleRoadmapMirrorGet(getReq('repo=acme/widgets&slug=alice-ships-the-mirror', ALICE_TOKEN), env);
    expect(ok.status).toBe(200);
    expect((await ok.json() as { item: { slug: string } }).item.slug).toBe('alice-ships-the-mirror');
  });
});

describe('#9638 roadmap mirror — the credential decides, never the payload', () => {
  it('a body that names another account still lands under the caller', async () => {
    const { env, sql } = makeEnv();
    const res = await handleRoadmapSnapshotPut(
      putReq(snapshotBody({ userId: 'u_bob', user_id: 'u_bob', account: 'u_bob' }), ALICE_TOKEN),
      env,
    );
    expect(res.status).toBe(200);
    const owners = (sql.prepare('SELECT DISTINCT user_id FROM roadmap_mirrors').all() as Array<{ user_id: string }>)
      .map((r) => r.user_id);
    expect(owners).toEqual(['u_alice']);
    expect(countFor(sql, 'roadmap_mirror_items', 'u_bob')).toBe(0);
    // …and bob still reads 404, not the row alice's payload tried to plant.
    expect((await handleRoadmapMirrorGet(getReq('repo=acme/widgets', BOB_TOKEN), env)).status).toBe(404);
  });
});
