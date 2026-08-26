/**
 * Purser adversarial suite for #9638 (relay roadmap command-center mirror) —
 * EDGE / CONCURRENCY behaviour of the ingest path.
 *
 * What the committed purser artifact contained before this repair: a single
 * hand-written `replaceSnapshot(db, userId, repo, items, edges, activity)`
 * helper that re-implemented the relay's batch by hand — 34 lines, zero
 * `describe`/`it`, so jest reported "Your test suite must contain at least one
 * test". Worse than empty: even had it been wrapped in a test, it asserted a
 * COPY of the SQL rather than the shipped `replaceRoadmapMirror`, and its
 * column list already disagreed with the real schema (no `harbor` on items, a
 * `roadmap_mirrors` DELETE ordered first). pd-purser defect #9669: the
 * authoring step gets the diff but no repository access.
 *
 * Steel-manning "edge concurrency" for THIS diff. The mirror has no locks, no
 * queue, no optimistic-concurrency token and no per-request fan-out; a
 * "concurrent writers" test would be theatre. What the design actually
 * promises (2026-08-22-roadmap-mirror.sql: "Every ingest is a FULL REPLACE per
 * (user_id, repo_full_name) in one D1 batch (transactional), so a mirror is
 * always exactly one daemon snapshot — never an interleaving of two pushes")
 * is ATOMICITY and TOTAL SUPERSESSION. That is the contract with teeth, and it
 * is what this file now pins:
 *
 *   1. One ingest issues exactly ONE `env.DB.batch()`, with zero writes
 *      outside it, and that batch opens with a DELETE against each of the four
 *      mirror tables — the replace is whole-slice, not per-row reconciliation.
 *   2. A poisoned snapshot that trips a CHECK mid-batch rolls the ENTIRE
 *      replace back, DELETE half included: the previous snapshot survives
 *      byte-for-byte in all four tables. (A non-transactional implementation
 *      would leave the tables EMPTY here — the DELETEs run first.)
 *   3. The rollback holds no matter WHICH of the four tables the poison lands
 *      in (items CHECK, edges CHECK, activity CHECK), so it is the
 *      transaction doing the work, not statement ordering luck.
 *   4. A second push fully supersedes the first across all four tables — no
 *      stragglers, no union of two snapshots, watermark advanced.
 *   5. Interleaving is impossible per (user, repo) BECAUSE of 1+2: the stored
 *      state after any sequence of pushes is exactly one snapshot, and a
 *      failed push is a no-op rather than a half-applied one. Two ACCOUNTS
 *      pushing the same repo name proceed independently.
 *
 * Not asserted, deliberately: simultaneous in-flight batches. D1 serializes a
 * batch on one connection and the fixture holds a single SQLite handle, so a
 * `Promise.all` of two ingests would only exercise the fixture's own
 * transaction nesting, not the relay's.
 *
 * Fixture idiom (borrowed from apps/relay/tests/roadmap-mirror.test.ts): the
 * D1 binding is a thin adapter over a REAL SQLite database running the REAL
 * 15-file `apps/relay/migrations` chain — real CHECK constraints, real FKs,
 * real BEGIN/ROLLBACK. Rollback is only meaningful because the constraints and
 * the transaction are real. The relay's own vitest suite uses `node:sqlite`;
 * this file runs in the ROOT jest project, whose resolver does not expose
 * `node:sqlite` on Node 22 (flag-gated, so absent from
 * `module.builtinModules`), so the same adapter is built over the root
 * project's own `better-sqlite3`.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  validateSnapshotPayload,
  replaceRoadmapMirror,
  readMirrorHeader,
  readBoard,
  handleRoadmapSnapshotPut,
  handleRoadmapMirrorGet,
} from '../../../apps/relay/src/roadmap-mirror.js';
import { hashHex } from '../../../apps/relay/src/crypto.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'relay', 'migrations');

const BASE = 'https://relay.example';
const ALICE_TOKEN = `pdu_${'aa'.repeat(32)}`;
const BOB_TOKEN = `pdu_${'bb'.repeat(32)}`;
const REPO = 'acme/widgets';

type SqlDb = InstanceType<typeof Database>;
type RelayEnv = Parameters<typeof replaceRoadmapMirror>[0];

interface Trace {
  batches: number;
  /** Every write, in order, tagged with whether it ran inside a batch. */
  runs: Array<{ query: string; inBatch: boolean }>;
}

/**
 * Translate a better-sqlite3 failure into an Error THIS module realm owns.
 *
 * Why this exists (do not "simplify" it away): better-sqlite3's `SqliteError`
 * is a hand-rolled constructor — `Error.call(this, msg)` plus
 * `Object.setPrototypeOf(SqliteError.prototype, Error.prototype)` — so the
 * instances carry no [[ErrorData]] slot and `Object.prototype.toString` reports
 * '[object Object]'. jest's `isError()` therefore falls through to
 * `value instanceof Error`. The native addon is dlopen-cached once per PROCESS,
 * so the `SqliteError` class every suite sees belongs to whichever jest module
 * realm loaded better-sqlite3 FIRST; in any other realm `instanceof Error` is
 * false, `isError()` returns false, and `expect(p).rejects.toThrow()` reports
 * "Received function did not throw" for a promise that really did reject. Run
 * this file alone and it is the first loader and everything passes; run it
 * after any of the ~30 suites that also import better-sqlite3 (with
 * maxWorkers: 1 they share one process) and six rollback assertions go red
 * while the rollback itself is working perfectly. That is order-dependent
 * nonsense, and it is a fixture defect, not a contract defect.
 *
 * Real D1 never hands a Worker a better-sqlite3 error either, so the adapter
 * translates at its boundary and the tests below assert the SQLite message
 * verbatim — a stronger assertion than a bare toThrow(), and one a silent
 * no-op can never satisfy.
 */
function d1Error(e: unknown): Error {
  const message = String((e as { message?: unknown } | null)?.message ?? e);
  const err = new Error(message);
  (err as { cause?: unknown }).cause = e;
  (err as { code?: unknown }).code = (e as { code?: unknown } | null)?.code;
  return err;
}

/** D1 adapter over a real SQLite db with the real migration chain applied. */
function makeRealDb(): { d1: unknown; sql: SqlDb; trace: Trace } {
  const sql = new Database(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (migrations.length === 0) throw new Error('no relay migrations found — fixture would be vacuous');
  for (const name of migrations) sql.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

  const trace: Trace = { batches: 0, runs: [] };
  let inBatch = false;

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
        try {
          return (sql.prepare(query).get(...(params() as never[])) as T | undefined) ?? null;
        } catch (e) { throw d1Error(e); }
      },
      async all<T>(): Promise<{ results: T[] }> {
        try {
          return { results: sql.prepare(query).all(...(params() as never[])) as T[] };
        } catch (e) { throw d1Error(e); }
      },
      async run(): Promise<{ success: boolean; meta: { changes: number } }> {
        trace.runs.push({ query, inBatch });
        try {
          const info = sql.prepare(query).run(...(params() as never[]));
          return { success: true, meta: { changes: Number(info.changes) } };
        } catch (e) { throw d1Error(e); }
      },
    };
    return stmt;
  };

  const d1 = {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      trace.batches += 1;
      inBatch = true;
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw d1Error(e);
      } finally {
        inBatch = false;
      }
    },
  };
  return { d1, sql, trace };
}

function seedUsers(sql: SqlDb): void {
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_alice', 1, 'alice', 100)");
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_bob', 2, 'bob', 100)");
  const ins = sql.prepare('INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)');
  ins.run(hashHex(ALICE_TOKEN), 'u_alice', 'alice laptop', 100);
  ins.run(hashHex(BOB_TOKEN), 'u_bob', 'bob laptop', 100);
}

function makeEnv(): { env: RelayEnv; sql: SqlDb; trace: Trace } {
  const { d1, sql, trace } = makeRealDb();
  seedUsers(sql);
  const env = {
    DB: d1,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    PUBLIC_BASE_URL: BASE,
  } as unknown as RelayEnv;
  return { env, sql, trace };
}

const GENERATED_AT = 1_755_800_000_000;
const RECEIVED_AT = 1_755_800_100;

function snapshotBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repoFullName: REPO,
    harbor: 'flotilla',
    generatedAt: GENERATED_AT,
    daemonLabel: 'harbor-1',
    items: [
      {
        slug: 'v1-ship-the-mirror', status: 'now', summaryMd: 'v1 first',
        lastTouchedAt: GENERATED_AT - 1000, createdAt: GENERATED_AT - 9000,
        dependencies: ['relay-baseline'], notes: [{ at: 1, text: 'started' }],
      },
      {
        slug: 'v1-board-page', status: 'backlog', summaryMd: 'v1 second',
        lastTouchedAt: GENERATED_AT - 2000, createdAt: GENERATED_AT - 8000,
      },
      {
        slug: 'v1-old-idea', status: 'done', summaryMd: 'v1 tombstone',
        lastTouchedAt: GENERATED_AT - 500, createdAt: GENERATED_AT - 9999,
        deletedAt: GENERATED_AT - 400,
      },
    ],
    edges: [
      { scope: 'roadmap', sourceId: 'v1-ship-the-mirror', edgeType: 'parent_of', targetId: 'v1-board-page' },
      { scope: 'roadmap', sourceId: 'v1-board-page', edgeType: 'depends_on', targetId: 'v1-ship-the-mirror' },
    ],
    activityTail: [
      { at: GENERATED_AT - 1000, slug: 'v1-ship-the-mirror', kind: 'touch', byId: 'agent:coxswain' },
      { at: GENERATED_AT - 2000, slug: 'v1-board-page', kind: 'promote' },
    ],
    ...overrides,
  };
}

function putReq(body: unknown, token: string): Request {
  return new Request(`${BASE}/v1/roadmap/snapshot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Validate a body and hand back the normalized snapshot the storage layer takes. */
function normalize(body: Record<string, unknown>) {
  const v = validateSnapshotPayload(body);
  if (!v.ok) throw new Error(`fixture must validate, got ${v.invalid.code}`);
  return v.snapshot;
}

const MIRROR_TABLES = [
  'roadmap_mirrors',
  'roadmap_mirror_items',
  'roadmap_mirror_edges',
  'roadmap_mirror_activity',
] as const;

/** Every row of the caller's whole mirror slice — the rollback comparison unit. */
function sliceOf(sql: SqlDb, userId: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of MIRROR_TABLES) {
    out[table] = sql.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`).all(userId);
  }
  return out;
}

describe('#9638 ingest — one atomic batch, whole-slice replace', () => {
  it('issues exactly one env.DB.batch() and zero writes outside it', async () => {
    const { env, trace } = makeEnv();
    await replaceRoadmapMirror(env, 'u_alice', normalize(snapshotBody()), RECEIVED_AT);
    expect(trace.batches).toBe(1);
    expect(trace.runs.filter((r) => !r.inBatch)).toEqual([]);
    expect(trace.runs.length).toBeGreaterThan(4);
  });

  it('the batch opens by DELETEing the caller’s slice from all four tables', async () => {
    const { env, trace } = makeEnv();
    await replaceRoadmapMirror(env, 'u_alice', normalize(snapshotBody()), RECEIVED_AT);
    const deletes = trace.runs.filter((r) => r.query.trimStart().toUpperCase().startsWith('DELETE'));
    expect(deletes).toHaveLength(4);
    // Every DELETE is scoped to (user_id, repo_full_name) — never a table wipe.
    for (const d of deletes) {
      expect(d.query).toContain('WHERE user_id = ? AND repo_full_name = ?');
      expect(d.inBatch).toBe(true);
    }
    const deletedTables = deletes
      .map((d) => /DELETE FROM (\w+)/.exec(d.query)?.[1])
      .sort();
    expect(deletedTables).toEqual([...MIRROR_TABLES].sort());
    // …and they come before any INSERT: this is a replace, not a merge.
    const firstInsert = trace.runs.findIndex((r) => r.query.trimStart().toUpperCase().startsWith('INSERT'));
    const lastDelete = trace.runs.map((r) => r.query.trimStart().toUpperCase().startsWith('DELETE')).lastIndexOf(true);
    expect(lastDelete).toBeLessThan(firstInsert);
  });
});

describe('#9638 ingest — a poisoned snapshot rolls the whole replace back', () => {
  let env: RelayEnv;
  let sql: SqlDb;
  let before: Record<string, unknown[]>;

  beforeEach(async () => {
    ({ env, sql } = makeEnv());
    await replaceRoadmapMirror(env, 'u_alice', normalize(snapshotBody()), RECEIVED_AT);
    before = sliceOf(sql, 'u_alice');
    // The fixture is not vacuous: v1 really is on disk in all four tables.
    expect(MIRROR_TABLES.map((t) => before[t]!.length)).toEqual([1, 3, 2, 2]);
  });

  it('an item-level CHECK violation leaves the previous snapshot byte-for-byte intact', async () => {
    const poisoned = normalize(snapshotBody({ generatedAt: GENERATED_AT + 60_000, daemonLabel: 'harbor-2' }));
    // Bypass the validator to reach the storage CHECK inside the batch.
    (poisoned.items[0] as unknown as { status: string }).status = 'someday';
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/CHECK constraint failed: status/);

    // The DELETEs ran FIRST inside that batch. Without a real transaction these
    // tables would now be empty; with one, v1 is untouched.
    expect(sliceOf(sql, 'u_alice')).toEqual(before);
    const header = await readMirrorHeader(env, 'u_alice', REPO);
    expect(header).not.toBeNull();
    expect(header!.generated_at).toBe(GENERATED_AT);
    expect(header!.daemon_label).toBe('harbor-1');
    const board = await readBoard(env, 'u_alice', REPO);
    expect(board.now!.map((i) => i.slug)).toEqual(['v1-ship-the-mirror']);
  });

  it('the rollback holds for a poison in the EDGES table', async () => {
    const poisoned = normalize(snapshotBody());
    (poisoned.edges[0] as unknown as { edgeType: string }).edgeType = 'blocks';
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/CHECK constraint failed/);
    expect(sliceOf(sql, 'u_alice')).toEqual(before);
  });

  it('the rollback holds for a poison in the ACTIVITY table', async () => {
    const poisoned = normalize(snapshotBody());
    (poisoned.activity[0] as unknown as { at: number }).at = -1;
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/CHECK constraint failed/);
    expect(sliceOf(sql, 'u_alice')).toEqual(before);
  });

  it('the rollback holds for a poison in the HEADER row (unknown harbor FK)', async () => {
    const poisoned = normalize(snapshotBody());
    // roadmap_mirrors.user_id REFERENCES users(id): a ghost owner must not be
    // able to leave the caller's slice deleted-but-not-replaced.
    await expect(replaceRoadmapMirror(env, 'u_ghost', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect(sliceOf(sql, 'u_alice')).toEqual(before);
    expect(sliceOf(sql, 'u_ghost')).toEqual({
      roadmap_mirrors: [], roadmap_mirror_items: [], roadmap_mirror_edges: [], roadmap_mirror_activity: [],
    });
  });

  it('a rolled-back replace is invisible to the reader — GET still serves v1', async () => {
    const poisoned = normalize(snapshotBody({ generatedAt: GENERATED_AT + 60_000 }));
    (poisoned.items[0] as unknown as { status: string }).status = 'someday';
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/CHECK constraint failed: status/);

    const res = await handleRoadmapMirrorGet(
      new Request(`${BASE}/v1/roadmap/mirror?repo=${REPO}`, { headers: { Authorization: `Bearer ${ALICE_TOKEN}` } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      mirror: { generatedAt: number; itemCount: number; edgeCount: number };
      board: Record<string, Array<{ slug: string }>>;
      activity: Array<{ slug: string }>;
    };
    expect(body.mirror.generatedAt).toBe(GENERATED_AT);
    expect(body.mirror.itemCount).toBe(3);
    expect(body.mirror.edgeCount).toBe(2);
    expect(body.board.now!.map((i) => i.slug)).toEqual(['v1-ship-the-mirror']);
    expect(body.activity).toHaveLength(2);
  });

  it('another account’s mirror is untouched by the failed replace', async () => {
    await replaceRoadmapMirror(env, 'u_bob', normalize(snapshotBody({ daemonLabel: 'bob-harbor' })), RECEIVED_AT);
    const bobBefore = sliceOf(sql, 'u_bob');
    const poisoned = normalize(snapshotBody());
    (poisoned.items[0] as unknown as { status: string }).status = 'someday';
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60))
      .rejects.toThrow(/CHECK constraint failed: status/);
    expect(sliceOf(sql, 'u_bob')).toEqual(bobBefore);
  });
});

describe('#9638 ingest — a second push fully supersedes the first', () => {
  it('replaces all four tables with no stragglers from v1', async () => {
    const { env, sql, trace } = makeEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env);
    expect(MIRROR_TABLES.map((t) => sliceOf(sql, 'u_alice')[t]!.length)).toEqual([1, 3, 2, 2]);

    const v2 = snapshotBody({
      generatedAt: GENERATED_AT + 60_000,
      daemonLabel: 'harbor-2',
      items: [{ slug: 'v2-fresh-item', status: 'merge', summaryMd: 'new world', lastTouchedAt: 1, createdAt: 1 }],
      edges: [],
      activityTail: [{ at: GENERATED_AT + 60_000, slug: 'v2-fresh-item', kind: 'status' }],
    });
    expect((await handleRoadmapSnapshotPut(putReq(v2, ALICE_TOKEN), env)).status).toBe(200);

    // Exactly v2, in every table — never a union of the two snapshots.
    expect(MIRROR_TABLES.map((t) => sliceOf(sql, 'u_alice')[t]!.length)).toEqual([1, 1, 0, 1]);
    const slugs = (sql.prepare("SELECT slug FROM roadmap_mirror_items WHERE user_id = 'u_alice'").all() as Array<{ slug: string }>)
      .map((r) => r.slug);
    expect(slugs).toEqual(['v2-fresh-item']);
    expect(slugs.filter((s) => s.startsWith('v1-'))).toEqual([]);
    const activitySlugs = (sql.prepare("SELECT slug FROM roadmap_mirror_activity WHERE user_id = 'u_alice'").all() as Array<{ slug: string }>)
      .map((r) => r.slug);
    expect(activitySlugs).toEqual(['v2-fresh-item']);

    // Watermark advanced, counts re-derived from v2, and still one batch per push.
    const header = await readMirrorHeader(env, 'u_alice', REPO);
    expect(header!.generated_at).toBe(GENERATED_AT + 60_000);
    expect(header!.daemon_label).toBe('harbor-2');
    expect(header!.item_count).toBe(1);
    expect(header!.edge_count).toBe(0);
    expect(trace.batches).toBe(2);
  });

  it('a repeat push of the SAME snapshot is idempotent, not a duplicate-key crash', async () => {
    const { env, sql } = makeEnv();
    for (let i = 0; i < 3; i++) {
      expect((await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env)).status).toBe(200);
    }
    expect(MIRROR_TABLES.map((t) => sliceOf(sql, 'u_alice')[t]!.length)).toEqual([1, 3, 2, 2]);
  });

  it('a push for a DIFFERENT repo does not disturb the first repo’s slice', async () => {
    const { env, sql } = makeEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env);
    const before = sql.prepare("SELECT * FROM roadmap_mirror_items WHERE repo_full_name = ? ORDER BY rowid").all(REPO);
    await handleRoadmapSnapshotPut(
      putReq(snapshotBody({
        repoFullName: 'acme/other',
        items: [{ slug: 'other-item', status: 'now', summaryMd: 'x', lastTouchedAt: 1, createdAt: 1 }],
        edges: [], activityTail: [],
      }), ALICE_TOKEN),
      env,
    );
    expect(sql.prepare("SELECT * FROM roadmap_mirror_items WHERE repo_full_name = ? ORDER BY rowid").all(REPO)).toEqual(before);
    expect((sql.prepare("SELECT COUNT(*) AS n FROM roadmap_mirrors WHERE user_id = 'u_alice'").get() as { n: number }).n).toBe(2);
  });

  it('two accounts pushing the same repo name replace only their own slice', async () => {
    const { env, sql } = makeEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env);
    const aliceBefore = sliceOf(sql, 'u_alice');
    await handleRoadmapSnapshotPut(
      putReq(snapshotBody({
        daemonLabel: 'bob-harbor',
        items: [{ slug: 'bob-item', status: 'now', summaryMd: 'bob', lastTouchedAt: 1, createdAt: 1 }],
        edges: [], activityTail: [],
      }), BOB_TOKEN),
      env,
    );
    expect(sliceOf(sql, 'u_alice')).toEqual(aliceBefore);
    expect(MIRROR_TABLES.map((t) => sliceOf(sql, 'u_bob')[t]!.length)).toEqual([1, 1, 0, 0]);
  });
});

describe('#9638 ingest — a refused push never reaches storage at all', () => {
  it('a validator refusal after a good push leaves v1 whole and issues no batch', async () => {
    const { env, sql, trace } = makeEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody(), ALICE_TOKEN), env);
    const before = sliceOf(sql, 'u_alice');
    const batchesAfterGoodPush = trace.batches;

    const refusals: Array<[Record<string, unknown> | string, number]> = [
      [snapshotBody({ items: [{ slug: 's', status: 'someday' }] }), 400],
      [snapshotBody({ edges: [{ scope: 'r', sourceId: 'a', edgeType: 'blocks', targetId: 'b' }] }), 400],
      [snapshotBody({ activityTail: [{ at: -1, slug: 'x', kind: 'touch' }] }), 400],
      [snapshotBody({ generatedAt: 'yesterday' }), 400],
      [snapshotBody({ repoFullName: 'nope' }), 400],
    ];
    for (const [body, want] of refusals) {
      const res = await handleRoadmapSnapshotPut(putReq(body, ALICE_TOKEN), env);
      expect(res.status).toBe(want);
    }
    expect(sliceOf(sql, 'u_alice')).toEqual(before);
    expect(trace.batches).toBe(batchesAfterGoodPush);
  });
});

// ── fixture integrity: the constraints and the rejection path are real ───────
//
// Every rollback assertion above is worthless if (a) the migrated schema never
// had the constraint, or (b) a constraint fires but the failure never surfaces
// as something jest can see as a throw. Both have bitten this file, so both are
// pinned here rather than assumed.

describe('#9638 fixture integrity', () => {
  it('the migrated schema really enforces the item lane CHECK and the owner FK', () => {
    const { sql } = makeEnv();
    expect(() =>
      sql.exec(
        "INSERT INTO roadmap_mirror_items (user_id, repo_full_name, harbor, slug, status, summary_md, last_touched_at, created_at) VALUES ('u_alice','a/b','h','s','someday','x',1,1)",
      ),
    ).toThrow();
    expect(() =>
      sql.exec(
        "INSERT INTO roadmap_mirror_edges (user_id, repo_full_name, scope, source_id, edge_type, target_id) VALUES ('u_alice','a/b','r','s1','blocks','s2')",
      ),
    ).toThrow();
    expect(() =>
      sql.exec(
        "INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice','a/b',-1,'s','touch')",
      ),
    ).toThrow();
    expect(() =>
      sql.exec(
        "INSERT INTO roadmap_mirrors (user_id, repo_full_name, harbor, generated_at, received_at, item_count, edge_count) VALUES ('u_ghost','a/b','h',1,1,0,0)",
      ),
    ).toThrow();
    // The lane CHECK is in the DDL the migration chain produced, not inherited
    // from some other CREATE TABLE that ran first.
    const ddl = (sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'roadmap_mirror_items'").get() as { sql: string }).sql;
    expect(ddl).toContain("CHECK (status IN ('now','backlog','parked','merge','done'))");
  });

  it('a constraint failure reaches the caller as an Error THIS realm recognises', async () => {
    // Regression guard for the order-dependent false failure described on
    // d1Error(): better-sqlite3's SqliteError is realm-bound and process-cached,
    // so without translation `expect(...).rejects.toThrow()` reports "did not
    // throw" for a promise that rejected. If the translation is ever removed,
    // this fails immediately instead of six rollback tests failing whenever
    // another better-sqlite3 suite happens to be scheduled first.
    const { env } = makeEnv();
    await replaceRoadmapMirror(env, 'u_alice', normalize(snapshotBody()), RECEIVED_AT);
    const poisoned = normalize(snapshotBody());
    (poisoned.items[0] as unknown as { status: string }).status = 'someday';
    const reason: unknown = await replaceRoadmapMirror(env, 'u_alice', poisoned, RECEIVED_AT + 60)
      .then(() => null, (e: unknown) => e);
    expect(reason).not.toBeNull();
    expect(reason instanceof Error).toBe(true);
    expect((reason as Error).message).toMatch(/CHECK constraint failed: status/);
    // …and the original SQLite error is preserved, not discarded.
    expect(((reason as { cause?: { code?: string } }).cause)?.code).toBe('SQLITE_CONSTRAINT_CHECK');
  });
});
