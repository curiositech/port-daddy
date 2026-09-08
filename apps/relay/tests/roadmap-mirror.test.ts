/**
 * Tests for the roadmap command-center mirror (src/roadmap-mirror.ts) —
 * PR 1 of the operator-mandated (2026-08-22) relay roadmap program.
 *
 * Coverage (per the mirror design):
 *   - auth rejection: no token → 401; one account's token can neither write
 *     nor read another account's mirror (tenant isolation, MT1);
 *   - payload caps: >2 MB body and >5000 items are refused with explicit
 *     JSON errors before any storage work; malformed JSON → 400;
 *   - tombstone round-trip: a deleted item is ingested, excluded from the
 *     board, and queryable-as-deleted via the item-detail read;
 *   - replace atomicity: a second push fully supersedes the first, and a
 *     mid-batch failure rolls back to the previous snapshot (real SQLite
 *     transaction, not a mock's promise);
 *   - activity cap: ingest keeps only the newest 200; the retention sweep
 *     re-enforces the cap on rows that bypassed ingest;
 *   - ADR-0101 lifecycle: /account/export carries all four tables;
 *     eraseUser purges them for exactly the erased account;
 *   - negative CHECK probes: the storage layer itself rejects a bad status,
 *     invalid JSON bags, and an unknown edge_type.
 *
 * Fixture note (the stateful-fake-D1 idiom, upgraded): instead of a
 * SQL-substring-dispatch fake (runs-page.test.ts style), the fake D1 here is
 * a thin adapter over node:sqlite running the REAL migration chain — the
 * same statements, real CHECK constraints, real transactions, real
 * json_each/window functions. A pass proves the SQL, not a mock's
 * sympathies; the negative CHECK probes below are only meaningful because
 * the constraints are real.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  normalizeRepoFullName,
  validateSnapshotPayload,
  replaceRoadmapMirror,
  readMirrorHeader,
  readBoard,
  readActivityTail,
  exportRoadmapMirrors,
  handleRoadmapSnapshotPut,
  handleRoadmapMirrorGet,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ITEMS,
  ROADMAP_ACTIVITY_CAP,
} from '../src/roadmap-mirror.js';
import { runRetentionSweep } from '../src/retention-sweep.js';
import { handleAccountExport } from '../src/auth-github.js';
import { eraseUser } from '../src/db.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const MIGRATIONS_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations');

const ALICE_TOKEN = `pdu_${'aa'.repeat(32)}`;
const BOB_TOKEN = `pdu_${'bb'.repeat(32)}`;
const COOKIE_VALUE = 'sess-alice';

/** D1 adapter over node:sqlite with the REAL migration chain applied. */
function makeRealDb(): { d1: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const name of migrations) {
    sql.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }
  type Stmt = {
    bind(...v: unknown[]): Stmt;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ success: boolean; meta: { changes: number } }>;
  };
  const prepare = (query: string): Stmt => {
    let args: unknown[] = [];
    const stmt: Stmt = {
      bind(...v: unknown[]) {
        args = v.map((x) => (x === undefined ? null : x));
        return stmt;
      },
      async first<T>() {
        return ((sql.prepare(query).get(...(args as never[])) as T | undefined) ?? null);
      },
      async all<T>() {
        return { results: sql.prepare(query).all(...(args as never[])) as T[] };
      },
      async run() {
        const info = sql.prepare(query).run(...(args as never[]));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
    return stmt;
  };
  const d1 = {
    prepare,
    async batch(stmts: Stmt[]) {
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
  } as unknown as D1Database;
  return { d1, sql };
}

/** Seed two accounts + their pdu_ device tokens + one browser session for alice. */
function seedUsers(sql: DatabaseSync): void {
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_alice', 1, 'alice', 100)");
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_bob', 2, 'bob', 100)");
  const ins = sql.prepare(
    'INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)',
  );
  ins.run(hashHex(ALICE_TOKEN), 'u_alice', 'alice laptop', 100);
  ins.run(hashHex(BOB_TOKEN), 'u_bob', 'bob laptop', 100);
  sql.prepare(
    'INSERT INTO web_sessions (token_hash, user_id, gh_token_enc, gh_token_iv, created_at, expires_at) VALUES (?, ?, NULL, NULL, ?, ?)',
  ).run(hashHex(COOKIE_VALUE), 'u_alice', 100, 4_000_000_000);
}

function makeEnv(d1: D1Database): Env {
  return {
    DB: d1,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    EVENT_RETENTION_DAYS: '30',
  } as unknown as Env;
}

function makeMirrorEnv(): { env: Env; sql: DatabaseSync } {
  const { d1, sql } = makeRealDb();
  seedUsers(sql);
  return { env: makeEnv(d1), sql };
}

const GENERATED_AT = 1_755_800_000_000; // daemon clock, unix ms

function snapshotBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repoFullName: 'acme/widgets',
    harbor: 'flotilla',
    generatedAt: GENERATED_AT,
    daemonLabel: 'harbor-1',
    items: [
      {
        slug: 'ship-the-mirror', status: 'now', kind: 'story', priority: 1,
        summaryMd: 'Ship the roadmap mirror', descriptionMd: 'PR 1 of 4',
        assigneeId: 'agent:coxswain', lastTouchedAt: GENERATED_AT - 1000,
        createdAt: GENERATED_AT - 9000, dependencies: ['relay-baseline'], notes: [{ at: 1, text: 'started' }],
      },
      {
        slug: 'board-page', status: 'backlog',
        summaryMd: 'Board page', lastTouchedAt: GENERATED_AT - 2000, createdAt: GENERATED_AT - 8000,
      },
      {
        slug: 'old-idea', status: 'done', summaryMd: 'Superseded idea',
        lastTouchedAt: GENERATED_AT - 500, createdAt: GENERATED_AT - 9999, deletedAt: GENERATED_AT - 400,
      },
    ],
    edges: [
      { scope: 'roadmap', sourceId: 'ship-the-mirror', edgeType: 'parent_of', targetId: 'board-page' },
      { scope: 'roadmap', sourceId: 'board-page', edgeType: 'depends_on', targetId: 'ship-the-mirror' },
    ],
    activityTail: [
      { at: GENERATED_AT - 1000, slug: 'ship-the-mirror', kind: 'touch', byId: 'agent:coxswain', detail: { note: 'ingest landed' } },
      { at: GENERATED_AT - 2000, slug: 'board-page', kind: 'promote' },
    ],
    ...overrides,
  };
}

function putReq(body: unknown, token: string | null = ALICE_TOKEN): Request {
  return new Request(`${BASE}/v1/roadmap/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function getReq(query: string, token: string | null = ALICE_TOKEN): Request {
  return new Request(`${BASE}/v1/roadmap/mirror?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// ── pure validation ───────────────────────────────────────────────────────────

describe('normalizeRepoFullName (repo-settings contract, same logic)', () => {
  it('accepts owner/name and pasted GitHub URLs; rejects probe shapes', () => {
    expect(normalizeRepoFullName('acme/widgets')).toBe('acme/widgets');
    expect(normalizeRepoFullName('https://github.com/acme/widgets.git')).toBe('acme/widgets');
    expect(normalizeRepoFullName('HTTP://GitHub.Com/acme/widgets')).toBe('acme/widgets');
    for (const bad of ['no-slash', 'a/b/c', 'owner/.dot', 'owner/name?x=1', 'owner_x/name', '', 42, null]) {
      expect(normalizeRepoFullName(bad)).toBeNull();
    }
  });
});

describe('validateSnapshotPayload', () => {
  it('normalizes defaults (kind, priority, clocks) and keeps tombstones', () => {
    const v = validateSnapshotPayload(snapshotBody());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const board = v.snapshot.items.find((i) => i.slug === 'board-page')!;
    expect(board.kind).toBe('task');
    expect(board.priority).toBe(3);
    const dead = v.snapshot.items.find((i) => i.slug === 'old-idea')!;
    expect(dead.deletedAt).not.toBeNull();
  });

  it('refuses explicitly: bad repo, bad harbor, bad clock, bad lane, duplicate slug, bad edge type', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [snapshotBody({ repoFullName: 'nope' }), 'BAD_REPO'],
      [snapshotBody({ harbor: '  ' }), 'BAD_HARBOR'],
      [snapshotBody({ generatedAt: 'yesterday' }), 'BAD_GENERATED_AT'],
      [snapshotBody({ items: [{ slug: 's', status: 'someday' }] }), 'BAD_STATUS'],
      [snapshotBody({ items: [{ slug: 's', status: 'now' }, { slug: 's', status: 'done' }] }), 'DUPLICATE_SLUG'],
      [snapshotBody({ edges: [{ scope: 'r', sourceId: 'a', edgeType: 'blocks', targetId: 'b' }] }), 'BAD_EDGE_TYPE'],
      [snapshotBody({ activityTail: [{ slug: 'x', kind: 'touch' }] }), 'BAD_ACTIVITY'],
      // `at` is the PK component and the tail/cap sort key — a non-positive or
      // non-integer timestamp is refused at the door, not left to the CHECK.
      [snapshotBody({ activityTail: [{ at: -1, slug: 'x', kind: 'touch' }] }), 'BAD_ACTIVITY'],
      [snapshotBody({ activityTail: [{ at: 0, slug: 'x', kind: 'touch' }] }), 'BAD_ACTIVITY'],
      [snapshotBody({ activityTail: [{ at: 1.5, slug: 'x', kind: 'touch' }] }), 'BAD_ACTIVITY'],
      [snapshotBody({ activityTail: [{ at: 'yesterday', slug: 'x', kind: 'touch' }] }), 'BAD_ACTIVITY'],
    ];
    for (const [body, code] of cases) {
      const v = validateSnapshotPayload(body);
      expect(v.ok, code).toBe(false);
      if (!v.ok) expect(v.invalid.code).toBe(code);
    }
  });

  it('caps the item count with an explicit refusal', () => {
    const items = Array.from({ length: MAX_SNAPSHOT_ITEMS + 1 }, (_, i) => ({ slug: `s${i}`, status: 'backlog' }));
    const v = validateSnapshotPayload(snapshotBody({ items }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.invalid.code).toBe('TOO_MANY_ITEMS');
      expect(v.invalid.status).toBe(413);
    }
  });

  it('dedupes edges silently (a set) and dedupes+caps the activity tail', () => {
    const edge = { scope: 'r', sourceId: 'a', edgeType: 'depends_on', targetId: 'b' };
    const activity = Array.from({ length: ROADMAP_ACTIVITY_CAP + 30 }, (_, i) => ({
      at: 1000 + i, slug: 'a', kind: 'touch',
    }));
    const v = validateSnapshotPayload(snapshotBody({ edges: [edge, { ...edge }], activityTail: activity }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.snapshot.edges).toHaveLength(1);
    expect(v.snapshot.activity).toHaveLength(ROADMAP_ACTIVITY_CAP);
    // newest kept: the max `at` survives, the oldest 30 do not
    expect(Math.max(...v.snapshot.activity.map((a) => a.at))).toBe(1000 + ROADMAP_ACTIVITY_CAP + 29);
    expect(Math.min(...v.snapshot.activity.map((a) => a.at))).toBe(1000 + 30);
  });
});

// ── auth gates (storage never touched without a credential) ──────────────────

describe('auth gates', () => {
  const throwingEnv = {
    DB: { prepare() { throw new Error('DB must not be touched without a credential'); } },
  } as unknown as Env;

  it('PUT /v1/roadmap/snapshot 401s with no token and no cookie', async () => {
    const res = await handleRoadmapSnapshotPut(putReq(snapshotBody(), null), throwingEnv);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('GET /v1/roadmap/mirror 401s with no token and no cookie', async () => {
    const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets', null), throwingEnv);
    expect(res.status).toBe(401);
  });

  it('an unknown/revoked bearer token is 401, not another account', async () => {
    const { env } = makeMirrorEnv();
    const res = await handleRoadmapSnapshotPut(putReq(snapshotBody(), `pdu_${'cc'.repeat(32)}`), env);
    expect(res.status).toBe(401);
  });
});

// ── ingest round-trip + tenant isolation ─────────────────────────────────────

describe('PUT /v1/roadmap/snapshot → GET /v1/roadmap/mirror round-trip', () => {
  it('stores the snapshot under the CREDENTIAL user and reads it back with an honest watermark', async () => {
    const { env, sql } = makeMirrorEnv();
    const before = Math.floor(Date.now() / 1000);
    const put = await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as Record<string, unknown>;
    expect(putBody.itemCount).toBe(3); // tombstone INCLUDED in the stored count
    expect(putBody.edgeCount).toBe(2);
    expect(putBody.generatedAt).toBe(GENERATED_AT); // daemon ms, verbatim
    expect(putBody.receivedAt as number).toBeGreaterThanOrEqual(before); // relay seconds

    const rows = sql.prepare('SELECT user_id FROM roadmap_mirrors').all() as Array<{ user_id: string }>;
    expect(rows).toEqual([{ user_id: 'u_alice' }]); // credential decides, not the payload

    const get = await handleRoadmapMirrorGet(getReq('repo=acme/widgets'), env);
    expect(get.status).toBe(200);
    const body = (await get.json()) as {
      mirror: Record<string, unknown>;
      board: Record<string, Array<Record<string, unknown>>>;
      activity: Array<Record<string, unknown>>;
    };
    expect(body.mirror.generatedAt).toBe(GENERATED_AT);
    expect(body.mirror.daemonLabel).toBe('harbor-1');
    expect(body.board.now!.map((i) => i.slug)).toEqual(['ship-the-mirror']);
    expect(body.board.backlog!.map((i) => i.slug)).toEqual(['board-page']);
    expect(body.board.done).toEqual([]); // tombstone is OFF the board
    expect(body.board.now![0]!.dependencies).toEqual(['relay-baseline']); // JSON bag round-trips
    expect(body.activity[0]).toMatchObject({ slug: 'ship-the-mirror', kind: 'touch', detail: { note: 'ingest landed' } });
  });

  it('normalizes a pasted-URL repoFullName at the door (one stored shape)', async () => {
    const { env } = makeMirrorEnv();
    const put = await handleRoadmapSnapshotPut(
      putReq(snapshotBody({ repoFullName: 'https://github.com/acme/widgets.git' })), env,
    );
    expect(put.status).toBe(200);
    const get = await handleRoadmapMirrorGet(getReq('repo=acme/widgets'), env);
    expect(get.status).toBe(200);
  });

  it("one account's token can never write or read another's mirror", async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env); // alice
    // Bob pushes the SAME repo name — it lands on bob's mirror, not alice's.
    const bobPut = await handleRoadmapSnapshotPut(
      putReq(snapshotBody({ items: [{ slug: 'bobs-item', status: 'now', summaryMd: 'bob' }], edges: [], activityTail: [] }), BOB_TOKEN),
      env,
    );
    expect(bobPut.status).toBe(200);
    const alice = (await (await handleRoadmapMirrorGet(getReq('repo=acme/widgets'), env)).json()) as {
      board: Record<string, Array<{ slug: string }>>;
    };
    expect(alice.board.now!.map((i) => i.slug)).toEqual(['ship-the-mirror']); // untouched by bob
    const bob = (await (await handleRoadmapMirrorGet(getReq('repo=acme/widgets', BOB_TOKEN), env)).json()) as {
      board: Record<string, Array<{ slug: string }>>;
    };
    expect(bob.board.now!.map((i) => i.slug)).toEqual(['bobs-item']); // and vice versa
  });

  it('links harbor_id when a membership-visible remote harbor matches the label', async () => {
    const { env, sql } = makeMirrorEnv();
    sql.exec("INSERT INTO harbors (id, namespace, name, pubkey, created_by, created_at) VALUES ('h_1', 'alice', 'flotilla', '" + 'ab'.repeat(32) + "', 'u_alice', 100)");
    sql.exec("INSERT INTO harbor_memberships (harbor_id, member_kind, member_id, role, added_at, added_by) VALUES ('h_1', 'user', 'u_alice', 'owner', 100, 'u_alice')");
    const put = await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    expect(((await put.json()) as { harborId: string }).harborId).toBe('h_1');
    // Bob has no membership → his mirror does not link alice's harbor.
    const bobPut = await handleRoadmapSnapshotPut(putReq(snapshotBody(), BOB_TOKEN), env);
    expect(((await bobPut.json()) as { harborId: string | null }).harborId).toBeNull();
  });
});

// ── payload caps at the handler door ─────────────────────────────────────────

describe('payload guards', () => {
  it('refuses a >2MB body with an explicit 413 before touching validation', async () => {
    const { env } = makeMirrorEnv();
    const big = snapshotBody({
      items: [{ slug: 'huge', status: 'now', summaryMd: 'x'.repeat(MAX_SNAPSHOT_BYTES + 16) }],
    });
    const res = await handleRoadmapSnapshotPut(putReq(big), env);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses >5000 items with an explicit 413 through the handler too', async () => {
    const { env } = makeMirrorEnv();
    const items = Array.from({ length: MAX_SNAPSHOT_ITEMS + 1 }, (_, i) => ({ slug: `s${i}`, status: 'backlog' }));
    const res = await handleRoadmapSnapshotPut(putReq(snapshotBody({ items })), env);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('TOO_MANY_ITEMS');
  });

  it('refuses malformed JSON with a 400, never a throw', async () => {
    const { env } = makeMirrorEnv();
    const res = await handleRoadmapSnapshotPut(putReq('{not json'), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_JSON');
  });
});

// ── tombstones + item detail with edges both directions ──────────────────────

describe('tombstone round-trip + item detail', () => {
  it('a deleted item is off the board but queryable-as-deleted with its edges', async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    const res = await handleRoadmapMirrorGet(getReq('repo=acme/widgets&slug=old-idea'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(body.item.deleted).toBe(true);
    expect(body.item.deletedAt).toBe(GENERATED_AT - 400);

    // Edges serve BOTH directions on the live item.
    const detail = (await (await handleRoadmapMirrorGet(getReq('repo=acme/widgets&slug=ship-the-mirror'), env)).json()) as {
      item: { deleted: boolean };
      edgesOut: Array<Record<string, unknown>>;
      edgesIn: Array<Record<string, unknown>>;
    };
    expect(detail.item.deleted).toBe(false);
    expect(detail.edgesOut).toEqual([
      { scope: 'roadmap', sourceId: 'ship-the-mirror', edgeType: 'parent_of', targetId: 'board-page' },
    ]);
    expect(detail.edgesIn).toEqual([
      { scope: 'roadmap', sourceId: 'board-page', edgeType: 'depends_on', targetId: 'ship-the-mirror' },
    ]);
  });

  it('404s an unknown slug and an unpushed repo; 400s a malformed repo filter', async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    expect((await handleRoadmapMirrorGet(getReq('repo=acme/widgets&slug=ghost'), env)).status).toBe(404);
    expect((await handleRoadmapMirrorGet(getReq('repo=acme/other'), env)).status).toBe(404);
    expect((await handleRoadmapMirrorGet(getReq('repo=a//b'), env)).status).toBe(400);
  });
});

// ── replace atomicity ────────────────────────────────────────────────────────

describe('full-replace atomicity', () => {
  it('a second push fully supersedes the first across all four tables', async () => {
    const { env, sql } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    const second = snapshotBody({
      generatedAt: GENERATED_AT + 60_000,
      daemonLabel: 'harbor-2',
      items: [{ slug: 'fresh-item', status: 'merge', summaryMd: 'New world' }],
      edges: [],
      activityTail: [{ at: GENERATED_AT + 60_000, slug: 'fresh-item', kind: 'status' }],
    });
    await handleRoadmapSnapshotPut(putReq(second), env);
    const body = (await (await handleRoadmapMirrorGet(getReq('repo=acme/widgets'), env)).json()) as {
      mirror: Record<string, unknown>;
      board: Record<string, Array<{ slug: string }>>;
      activity: Array<{ slug: string }>;
    };
    expect(body.mirror.generatedAt).toBe(GENERATED_AT + 60_000);
    expect(body.mirror.daemonLabel).toBe('harbor-2');
    expect(body.board.merge!.map((i) => i.slug)).toEqual(['fresh-item']);
    expect(body.board.now).toEqual([]); // first push's items are gone
    expect(body.activity.map((a) => a.slug)).toEqual(['fresh-item']);
    // No stragglers anywhere: exactly one item row, zero edges.
    expect((sql.prepare('SELECT COUNT(*) AS n FROM roadmap_mirror_items').get() as { n: number }).n).toBe(1);
    expect((sql.prepare('SELECT COUNT(*) AS n FROM roadmap_mirror_edges').get() as { n: number }).n).toBe(0);
  });

  it('a mid-batch failure rolls back — the previous snapshot survives intact', async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    // Bypass validation to hit the storage CHECK inside the batch: the real
    // transaction must roll the whole replace back, DELETEs included.
    const poisoned = validateSnapshotPayload(snapshotBody());
    if (!poisoned.ok) throw new Error('fixture must validate');
    (poisoned.snapshot.items[0] as { status: string }).status = 'someday';
    await expect(replaceRoadmapMirror(env, 'u_alice', poisoned.snapshot, 1_755_900_000)).rejects.toThrow();
    const body = (await (await handleRoadmapMirrorGet(getReq('repo=acme/widgets'), env)).json()) as {
      mirror: Record<string, unknown>;
      board: Record<string, Array<{ slug: string }>>;
    };
    expect(body.mirror.generatedAt).toBe(GENERATED_AT); // still the FIRST snapshot
    expect(body.board.now!.map((i) => i.slug)).toEqual(['ship-the-mirror']);
  });

  it('chunked multi-row inserts land every row (3 chunks worth)', async () => {
    const { env } = makeMirrorEnv();
    const items = Array.from({ length: 101 }, (_, i) => ({
      slug: `bulk-${String(i).padStart(3, '0')}`, status: 'backlog', summaryMd: `Item ${i}`,
      lastTouchedAt: GENERATED_AT - i, // distinct, descending freshness
    }));
    await handleRoadmapSnapshotPut(putReq(snapshotBody({ items, edges: [], activityTail: [] })), env);
    const board = await readBoard(env, 'u_alice', 'acme/widgets');
    expect(board.backlog).toHaveLength(101);
    // Board order is freshest-touched first.
    expect(board.backlog![0]!.slug).toBe('bulk-000');
    expect(board.backlog![100]!.slug).toBe('bulk-100');
  });
});

// ── activity cap: ingest + retention sweep ───────────────────────────────────

describe('activity cap', () => {
  it('ingest keeps only the newest ROADMAP_ACTIVITY_CAP entries', async () => {
    const { env } = makeMirrorEnv();
    const activityTail = Array.from({ length: ROADMAP_ACTIVITY_CAP + 50 }, (_, i) => ({
      at: 1_000_000 + i, slug: 'ship-the-mirror', kind: 'touch',
    }));
    await handleRoadmapSnapshotPut(putReq(snapshotBody({ activityTail })), env);
    const tail = await readActivityTail(env, 'u_alice', 'acme/widgets', ROADMAP_ACTIVITY_CAP + 100);
    expect(tail).toHaveLength(ROADMAP_ACTIVITY_CAP);
    expect(tail[0]!.at).toBe(1_000_000 + ROADMAP_ACTIVITY_CAP + 49); // newest survived
  });

  it('the retention sweep prunes rows beyond the cap per (user, repo) — mirrors persist', async () => {
    const { env, sql } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    // Simulate a bypass: stuff extra activity rows straight into storage.
    const ins = sql.prepare(
      "INSERT OR IGNORE INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice', 'acme/widgets', ?, 'stuffed', 'touch')",
    );
    for (let i = 0; i < ROADMAP_ACTIVITY_CAP + 37; i++) ins.run(2_000_000 + i);
    const r = await runRetentionSweep(env, 1_800_000_000);
    expect(r.errors).toEqual([]);
    // 2 rows rode the original push; 237 stuffed → 239 total, cap 200 → 39 pruned.
    expect(r.roadmapActivityPruned).toBe(39);
    const left = (sql.prepare("SELECT COUNT(*) AS n FROM roadmap_mirror_activity WHERE user_id = 'u_alice'").get() as { n: number }).n;
    expect(left).toBe(ROADMAP_ACTIVITY_CAP);
    // The newest 200 survive: the push's two unix-ms entries (the largest
    // `at`s here) plus the newest 198 stuffed rows — so the oldest survivor
    // is stuffed row 2_000_236 - 197.
    const oldest = (sql.prepare("SELECT MIN(at) AS m FROM roadmap_mirror_activity WHERE user_id = 'u_alice'").get() as { m: number }).m;
    expect(oldest).toBe(2_000_039);
    // Mirrors themselves persist through the sweep.
    expect(await readMirrorHeader(env, 'u_alice', 'acme/widgets')).not.toBeNull();
    expect((await readBoard(env, 'u_alice', 'acme/widgets')).now).toHaveLength(1);
  });
});

// ── ADR-0101 lifecycle: export + erase ───────────────────────────────────────

describe('ADR-0101 lifecycle (team tier)', () => {
  it('GET /account/export carries all four mirror tables', async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    const res = await handleAccountExport(
      new Request(`${BASE}/account/export`, { headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roadmapMirrors: Array<Record<string, unknown>> };
    expect(body.roadmapMirrors).toHaveLength(1);
    const m = body.roadmapMirrors[0]!;
    expect(m.repo).toBe('acme/widgets');
    expect(m.generatedAt).toBe(GENERATED_AT);
    expect((m.items as unknown[]).length).toBe(3); // tombstone exports too — it is the user's data
    expect((m.edges as unknown[]).length).toBe(2);
    expect((m.activity as unknown[]).length).toBe(2);
  });

  it('exportRoadmapMirrors returns only the requested account', async () => {
    const { env } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    await handleRoadmapSnapshotPut(putReq(snapshotBody({ repoFullName: 'bob/private' }), BOB_TOKEN), env);
    const aliceExport = (await exportRoadmapMirrors(env, 'u_alice')) as Array<{ repo: string }>;
    expect(aliceExport.map((m) => m.repo)).toEqual(['acme/widgets']);
  });

  it('eraseUser purges all four tables for exactly the erased account', async () => {
    const { env, sql } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    await handleRoadmapSnapshotPut(putReq(snapshotBody({ repoFullName: 'bob/private' }), BOB_TOKEN), env);
    const count = (table: string, user: string): number =>
      (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(user) as { n: number }).n;
    const TABLES = ['roadmap_mirrors', 'roadmap_mirror_items', 'roadmap_mirror_edges', 'roadmap_mirror_activity'];
    // BEFORE: both accounts hold real rows in every table — so the zeros below
    // prove a delete happened, not that the fixture was empty all along.
    const aliceBefore = Object.fromEntries(TABLES.map((t) => [t, count(t, 'u_alice')]));
    const bobBefore = Object.fromEntries(TABLES.map((t) => [t, count(t, 'u_bob')]));
    expect(aliceBefore).toEqual({
      roadmap_mirrors: 1, roadmap_mirror_items: 3, roadmap_mirror_edges: 2, roadmap_mirror_activity: 2,
    });
    expect(bobBefore).toEqual(aliceBefore); // bob pushed the same fixture under his own repo

    await eraseUser(env.DB, 'u_alice', 1_800_000_000);

    // AFTER: alice's rows are gone from every table; bob's counts are byte-for-byte unchanged.
    for (const table of TABLES) {
      expect(count(table, 'u_alice'), `${table} must be empty for the erased user`).toBe(0);
      expect(count(table, 'u_bob'), `${table} must be untouched for the other account`).toBe(
        bobBefore[table] as number,
      );
    }
    // And nothing leaked into a third account's namespace: the tables hold
    // exactly bob's rows now, so the DELETEs were scoped, not global.
    for (const table of TABLES) {
      const total = (sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(total, `${table} total must equal bob's rows after erasure`).toBe(bobBefore[table] as number);
    }
    // And the 30-day hard delete can now run without the MIRROR tables ever
    // blocking it on their users(id) FKs. (user_tokens rows also reference
    // users(id) and are only revoked, never deleted, by eraseUser — that is
    // pre-existing retention debt outside this PR; clear it here so the
    // assertion isolates the mirror's contribution.)
    sql.exec("DELETE FROM user_tokens WHERE user_id = 'u_alice'");
    const r = await runRetentionSweep(env, 1_800_000_000 + 31 * 24 * 60 * 60);
    expect(r.errors).toEqual([]);
    expect(r.usersHardDeleted).toBe(1);
  });

  it('the sweep leaves NO orphaned mirror rows behind a hard-deleted user', async () => {
    // The defensive deletes in the sweep exist for rows a soft-deleted user
    // still owns (a crash between eraseUser's statements, a future bug). Seed
    // exactly that state — mirror rows present, user soft-deleted, eraseUser
    // never run — and prove the sweep clears them AND the user, with zero rows
    // left pointing at a users(id) that no longer exists.
    const { env, sql } = makeMirrorEnv();
    await handleRoadmapSnapshotPut(putReq(snapshotBody()), env);
    await handleRoadmapSnapshotPut(putReq(snapshotBody({ repoFullName: 'bob/private' }), BOB_TOKEN), env);
    const softDeletedAt = 1_800_000_000;
    sql.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(softDeletedAt, 'u_alice');
    sql.exec("DELETE FROM user_tokens WHERE user_id = 'u_alice'"); // unrelated pre-existing FK debt
    const TABLES = ['roadmap_mirrors', 'roadmap_mirror_items', 'roadmap_mirror_edges', 'roadmap_mirror_activity'];
    // The orphan-to-be really exists before the sweep runs.
    for (const table of TABLES) {
      const n = (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'u_alice'`).get() as { n: number }).n;
      expect(n, `${table} must hold alice's rows before the sweep`).toBeGreaterThan(0);
    }

    const r = await runRetentionSweep(env, softDeletedAt + 31 * 24 * 60 * 60);
    expect(r.errors).toEqual([]);
    expect(r.usersHardDeleted).toBe(1);

    // No row in any mirror table references a user that no longer exists.
    for (const table of TABLES) {
      const orphans = (
        sql
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id NOT IN (SELECT id FROM users)`)
          .get() as { n: number }
      ).n;
      expect(orphans, `${table} must have no rows orphaned by the hard delete`).toBe(0);
      // Bob is alive and keeps every row.
      const bob = (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'u_bob'`).get() as { n: number }).n;
      expect(bob, `${table} must keep the surviving account's rows`).toBeGreaterThan(0);
    }
  });
});

// ── negative CHECK probes (the storage layer bites) ──────────────────────────

describe('storage-layer CHECK constraints', () => {
  it('rejects a lane outside the enum, invalid JSON bags, and an unknown edge type', () => {
    const { sql } = makeMirrorEnv();
    const bads = [
      "INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at) VALUES ('u_alice', 'a/b', 's', 'h', 'someday', 'x', 0, 0)",
      "INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, dependencies_json) VALUES ('u_alice', 'a/b', 's', 'h', 'now', 'x', 0, 0, 'not json')",
      "INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, notes_json) VALUES ('u_alice', 'a/b', 's', 'h', 'now', 'x', 0, 0, 'not json')",
      "INSERT INTO roadmap_mirror_edges (user_id, repo_full_name, scope, source_id, edge_type, target_id) VALUES ('u_alice', 'a/b', 'r', 's1', 'blocks', 's2')",
      // activity.at must be a positive INTEGER — SQLite affinity alone would
      // admit all four of these, and a text `at` sorts ABOVE every integer,
      // which would hijack the newest-first tail and the cap prune.
      "INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice', 'a/b', -1, 's1', 'touch')",
      "INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice', 'a/b', 0, 's1', 'touch')",
      "INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice', 'a/b', 1.5, 's1', 'touch')",
      "INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind) VALUES ('u_alice', 'a/b', 'not-a-timestamp', 's1', 'touch')",
    ];
    for (const bad of bads) {
      expect(() => sql.exec(bad), bad).toThrow();
    }
    // And a mirror row for an unknown user violates the FK — user_id is real.
    expect(() =>
      sql.exec("INSERT INTO roadmap_mirrors (user_id, repo_full_name, harbor, generated_at, received_at, item_count, edge_count) VALUES ('u_ghost', 'a/b', 'h', 1, 1, 0, 0)"),
    ).toThrow();
  });
});
