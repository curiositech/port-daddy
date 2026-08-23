/**
 * Atomic-rollback probe for the relay roadmap mirror (PR "relay roadmap
 * command-center mirror", PR 1/4).
 *
 * WHY THIS IS NOT DRIVEN OVER HTTP: the mid-batch rollback can only be
 * observed by getting a statement inside `replaceRoadmapMirror`'s single
 * `env.DB.batch()` to fail. Over HTTP that is unreachable BY DESIGN —
 * `validateSnapshotPayload` refuses `status:"someday"` with 400 BAD_STATUS
 * before any storage work happens (capture.mjs records that real HTTP refusal
 * separately). So this probe imports the REAL `src/roadmap-mirror.ts` handlers
 * and calls `replaceRoadmapMirror` directly, bypassing only the request guard,
 * against a REAL SQLite database with the REAL migration chain applied — the
 * same fixture idiom as apps/relay/tests/roadmap-mirror.test.ts.
 *
 * It writes {before, after, error} JSON to argv[2] for capture.mjs to render.
 *
 * Run indirectly: `node docs/reports/relay-roadmap-mirror/capture.mjs`
 * (capture.mjs bundles this with the relay's own esbuild, then runs it).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  validateSnapshotPayload,
  replaceRoadmapMirror,
  handleRoadmapSnapshotPut,
  handleRoadmapMirrorGet,
} from '../../../apps/relay/src/roadmap-mirror.js';
import { hashHex } from '../../../apps/relay/src/crypto.js';
import type { Env } from '../../../apps/relay/src/types.js';

const OUT = process.argv[2]!;
const MIGRATIONS_DIR = process.argv[3]!;
const SNAPSHOT_JSON = process.argv[4]!;
const BASE = 'http://127.0.0.1:8799';
const TOKEN = `pdu_${'aa'.repeat(32)}`;

/** D1 adapter over node:sqlite with the REAL migration chain applied. */
function makeRealDb(): { d1: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
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
        return (sql.prepare(query).get(...(args as never[])) as T | undefined) ?? null;
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

function makeEnv(d1: D1Database): Env {
  return {
    DB: d1,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    EVENT_RETENTION_DAYS: '30',
  } as unknown as Env;
}

async function main(): Promise<void> {
  const { d1, sql } = makeRealDb();
  sql.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_alice', 1, 'alice', 100)");
  sql
    .prepare('INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(hashHex(TOKEN), 'u_alice', 'capture-probe', 100);
  const env = makeEnv(d1);

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_JSON, 'utf8')) as Record<string, unknown>;
  const put = await handleRoadmapSnapshotPut(
    new Request(`${BASE}/v1/roadmap/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(snapshot),
    }),
    env,
  );
  const putBody = (await put.json()) as Record<string, unknown>;

  const repo = String(snapshot.repoFullName);
  const read = async (): Promise<Record<string, unknown>> => {
    const res = await handleRoadmapMirrorGet(
      new Request(`${BASE}/v1/roadmap/mirror?repo=${encodeURIComponent(repo)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      env,
    );
    return (await res.json()) as Record<string, unknown>;
  };
  const summarize = (body: Record<string, unknown>): Record<string, unknown> => {
    const board = (body.board ?? {}) as Record<string, unknown[]>;
    const rows = sql.prepare('SELECT COUNT(*) AS n FROM roadmap_mirror_items').get() as { n: number };
    return {
      mirror: body.mirror,
      laneCounts: Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v.length])),
      firstNow: (board.now ?? []).slice(0, 3).map((i) => (i as { slug: string }).slug),
      itemRowsInDb: Number(rows.n),
    };
  };

  const before = summarize(await read());

  // Poison the snapshot AFTER validation so the bad lane reaches the storage
  // CHECK inside the batch. This is the only way to exercise the transaction.
  const validated = validateSnapshotPayload({
    ...snapshot,
    generatedAt: (snapshot.generatedAt as number) + 60_000,
  });
  if (!validated.ok) throw new Error(`probe fixture must validate: ${validated.invalid.code}`);
  const poisonedIndex = Math.min(7, validated.snapshot.items.length - 1);
  const poisonedSlug = validated.snapshot.items[poisonedIndex]!.slug;
  (validated.snapshot.items[poisonedIndex] as { status: string }).status = 'someday';

  let thrown: string | null = null;
  try {
    await replaceRoadmapMirror(env, 'u_alice', validated.snapshot, Math.floor(Date.now() / 1000));
  } catch (e) {
    thrown = (e as Error).message;
  }

  const after = summarize(await read());

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        harness: 'in-process: real src/roadmap-mirror.ts over a node:sqlite D1 adapter, real migration chain',
        putResponse: putBody,
        poisoned: {
          slug: poisonedSlug,
          index: poisonedIndex,
          field: 'status',
          value: 'someday',
          watermarkAttempted: (snapshot.generatedAt as number) + 60_000,
        },
        thrown,
        before,
        after,
        identical: JSON.stringify(before) === JSON.stringify(after),
      },
      null,
      2,
    ),
  );
  console.log(`rollback-probe: threw=${thrown ? 'yes' : 'NO'} identical=${JSON.stringify(before) === JSON.stringify(after)}`);
}

await main();
