#!/usr/bin/env node
/**
 * capture.mjs — produce the visual evidence for the relay roadmap command-center
 * mirror (PR 1/4: `PUT /v1/roadmap/snapshot` + `GET /v1/roadmap/mirror`).
 *
 * This slice ships NO operator-visible page (the pages are PR 3/4). What a
 * reviewer can be shown honestly is the mirror actually holding a real roadmap,
 * so this script drives the REAL Worker and renders its REAL responses.
 *
 *   1. Applies the REAL migration chain (apps/relay/migrations/*.sql, in the
 *      same sorted order the relay test suite and `check-migrations.mjs` use)
 *      to a throwaway local D1 via `wrangler d1 execute --local`.
 *   2. Seeds two throwaway accounts + `pdu_` tokens directly in that D1.
 *   3. Boots the REAL Worker — `wrangler dev --local`, i.e. workerd + miniflare
 *      running apps/relay/src/index.ts with the real D1/KV/DO/Queue bindings.
 *   4. Drives real HTTP against it: null states, a real roadmap push, the board
 *      read, an item detail with edges both directions, a tombstone, the
 *      payload guards, and a re-read proving a refused push changes nothing.
 *   5. Runs rollback-probe.ts in-process (see that file for why the mid-batch
 *      rollback is unreachable over HTTP) against a real-SQLite D1 with the
 *      same migration chain.
 *   6. Writes run-log.json (every request + verbatim response) and hands it to
 *      render.mjs, which builds the evidence sheets and screenshots them with
 *      headless Playwright.
 *
 * The roadmap pushed is REAL: docs/roadmap/roadmap.snapshot.json, the committed
 * export the daemon produced via scripts/export-roadmap-snapshot.ts (279 items,
 * verbatim slug/status/summaryMd + the daemon's own generatedAt clock). That
 * export carries no edges, no activity tail and no tombstones, so the second
 * push adds a small, EXPLICITLY LABELLED augmentation to exercise those paths.
 * Nothing else is invented: every value on every sheet is copied out of a real
 * response body recorded in run-log.json.
 *
 * Usage:
 *   node docs/reports/relay-roadmap-mirror/capture.mjs
 *   PORT=8801 node docs/reports/relay-roadmap-mirror/capture.mjs
 *
 * Requirements: apps/relay deps installed (`npm ci` in apps/relay — provides
 * wrangler/workerd/esbuild), node >= 22 (node:sqlite), and Playwright resolvable
 * (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers in this environment).
 */
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const RELAY = join(REPO, 'apps', 'relay');
const WRANGLER = join(RELAY, 'node_modules', '.bin', 'wrangler');
const CONFIG = join(HERE, 'wrangler.capture.toml');
const MIGRATIONS = join(RELAY, 'migrations');
const ROADMAP_EXPORT = join(REPO, 'docs', 'roadmap', 'roadmap.snapshot.json');
const PORT = Number(process.env.PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const WORK = mkdtempSync(join(tmpdir(), 'roadmap-mirror-capture-'));
const REPO_FULL = 'curiositech/port-daddy';
const NEVER_SYNCED = 'curiositech/never-synced-repo';

// Throwaway local credentials — this D1 lives for the length of this run only.
const ALICE_TOKEN = `pdu_${'aa'.repeat(32)}`;
const BOB_TOKEN = `pdu_${'bb'.repeat(32)}`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const log = (...a) => console.log('[capture]', ...a);

// ── 1. local D1 with the real migration chain ────────────────────────────────

function d1(args, opts = {}) {
  return execFileSync(
    WRANGLER,
    ['d1', 'execute', 'DB', '--local', '--persist-to', join(WORK, 'state'), '--config', CONFIG, ...args],
    { cwd: RELAY, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...opts },
  );
}

function prepareDatabase() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  log(`applying ${files.length} migrations to a throwaway local D1…`);
  for (const f of files) d1(['--file', join(MIGRATIONS, f)]);
  const seed = [
    "INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_alice', 1, 'alice', 100);",
    "INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_bob', 2, 'bob', 100);",
    `INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES ('${sha256(ALICE_TOKEN)}', 'u_alice', 'capture laptop', 100);`,
    `INSERT INTO user_tokens (token_hash, user_id, label, created_at) VALUES ('${sha256(BOB_TOKEN)}', 'u_bob', 'other account', 100);`,
  ].join(' ');
  d1(['--command', seed]);
  const applied = JSON.parse(d1(['--command', "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'roadmap_mirror%' ORDER BY name", '--json']));
  return { migrations: files, tables: applied.flatMap((r) => (r.results ?? []).map((x) => x.name)) };
}

// ── 2. the real Worker ───────────────────────────────────────────────────────

async function startWorker() {
  log(`booting the real Worker (wrangler dev --local) on ${BASE}…`);
  const child = spawn(
    WRANGLER,
    ['dev', '--config', CONFIG, '--local', '--persist-to', join(WORK, 'state'), '--port', String(PORT), '--ip', '127.0.0.1'],
    { cwd: RELAY, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`worker did not become healthy:\n${out.join('')}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        const health = await res.json();
        log('worker healthy:', JSON.stringify(health));
        return { child, health, bootLog: out.join('') };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

// ── 3. the snapshots ─────────────────────────────────────────────────────────

/**
 * Snapshot A — the REAL daemon export, verbatim. Items carry only the fields
 * the committed export carries (slug/status/summaryMd); the relay fills its own
 * documented defaults (kind 'task', priority 3, clocks ← generatedAt).
 */
function snapshotA(exported) {
  return {
    repoFullName: REPO_FULL,
    harbor: exported.harbor,
    generatedAt: exported.generatedAt,
    daemonLabel: 'port-daddy-daemon',
    items: exported.items.map((i) => ({ slug: i.slug, status: i.status, summaryMd: i.summaryMd })),
  };
}

/**
 * Snapshot B — snapshot A plus the CAPTURE-AUTHORED augmentation the daemon's
 * committed export cannot supply: one tombstone, four edges, six activity rows.
 * Every augmented value is listed in `augmentation` so the sheets and MANIFEST
 * can name exactly what is authored rather than daemon-real.
 */
function snapshotB(exported) {
  const base = snapshotA(exported);
  const gen = exported.generatedAt + 3_600_000; // a later daemon push
  const TOMB = 'adr-0049-relay-v0';
  const FOCUS = 'roadmap-link-gate';
  const slugs = new Set(exported.items.map((i) => i.slug));
  for (const s of [TOMB, FOCUS, 'roadmap-schema-wiring', 'adr-0090-phase-6-roadmap-snapshot-and-ci-seed', 'mcp-roadmap-receipt-parity']) {
    if (!slugs.has(s)) throw new Error(`augmentation references a slug missing from the real export: ${s}`);
  }
  const edges = [
    // Derived from the REAL roadmap text: accountability-wedge-launch-assets'
    // summary ends "Spawned by distribution-dogfood-gtm-strategy."
    { scope: 'roadmap', sourceId: 'distribution-dogfood-gtm-strategy', edgeType: 'parent_of', targetId: 'accountability-wedge-launch-assets', derived: true },
    { scope: 'roadmap', sourceId: 'roadmap-schema-wiring', edgeType: 'parent_of', targetId: FOCUS, derived: false },
    { scope: 'roadmap', sourceId: FOCUS, edgeType: 'depends_on', targetId: 'adr-0090-phase-6-roadmap-snapshot-and-ci-seed', derived: false },
    { scope: 'roadmap', sourceId: 'mcp-roadmap-receipt-parity', edgeType: 'depends_on', targetId: FOCUS, derived: false },
  ];
  const activity = [
    { at: gen - 60_000, slug: FOCUS, kind: 'touch', byId: 'agent:cartographer', detail: { note: 'link gate wired' } },
    { at: gen - 240_000, slug: TOMB, kind: 'delete', byId: 'agent:cartographer', detail: { reason: 'superseded by the relay mirror program' } },
    { at: gen - 900_000, slug: 'roadmap-schema-wiring', kind: 'promote', byId: 'agent:coxswain', detail: { from: 'backlog', to: 'now' } },
    { at: gen - 1_800_000, slug: 'roadmap-reconciler-agent', kind: 'touch', byId: 'agent:navigator', detail: null },
    { at: gen - 3_600_000, slug: 'mcp-roadmap-receipt-parity', kind: 'status', byId: 'agent:coxswain', detail: { to: 'backlog' } },
    { at: gen - 7_200_000, slug: 'roadmap-jira-tool-design', kind: 'touch', byId: 'agent:lookout', detail: null },
  ];
  const touched = new Map(activity.map((a) => [a.slug, a.at]));
  return {
    payload: {
      ...base,
      generatedAt: gen,
      items: base.items.map((i) => ({
        ...i,
        ...(touched.has(i.slug) ? { lastTouchedAt: touched.get(i.slug) } : {}),
        ...(i.slug === TOMB ? { deletedAt: gen - 240_000 } : {}),
      })),
      edges: edges.map(({ derived, ...e }) => e),
      activityTail: activity,
    },
    augmentation: { tombstone: TOMB, focus: FOCUS, edges, activityCount: activity.length, generatedAt: gen },
  };
}

// ── 4. scenarios against the real Worker ─────────────────────────────────────

const steps = [];

async function step(id, title, note, req) {
  const { method = 'GET', path, token = ALICE_TOKEN, body = null, headers = {} } = req;
  const url = `${BASE}${path}`;
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body != null ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const rec = {
    id,
    title,
    note,
    harness: 'real-worker',
    request: {
      method,
      url: url.replace(BASE, ''),
      auth: token === ALICE_TOKEN ? 'Bearer pdu_… (account A)' : token === BOB_TOKEN ? 'Bearer pdu_… (account B — a DIFFERENT account)' : 'none',
      bodyBytes: body == null ? 0 : Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)),
    },
    status: res.status,
    ms: Date.now() - started,
    body: parsed ?? { RAW: text.slice(0, 400) },
  };
  steps.push(rec);
  log(`${id}  ${method} ${rec.request.url.slice(0, 62)} → ${res.status} (${rec.ms}ms)`);
  return rec;
}

// ── 5. the in-process rollback probe ─────────────────────────────────────────

async function runRollbackProbe(snapshot) {
  log('bundling + running the in-process rollback probe…');
  const esbuild = await import(join(RELAY, 'node_modules', 'esbuild', 'lib', 'main.js'));
  const bundle = join(WORK, 'rollback-probe.mjs');
  await esbuild.build({
    entryPoints: [join(HERE, 'rollback-probe.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: bundle,
    absWorkingDir: RELAY,
    logLevel: 'warning',
  });
  const snapPath = join(WORK, 'probe-snapshot.json');
  writeFileSync(snapPath, JSON.stringify(snapshot));
  const outPath = join(WORK, 'rollback.json');
  const stdout = execFileSync(process.execPath, [bundle, outPath, MIGRATIONS, snapPath], { encoding: 'utf8' });
  log(stdout.trim());
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  // Record WHICH paths were dirty, not just that something was: the question a
  // reviewer actually has is "was the code under test modified for the capture?"
  // (`apps/relay/**` appearing here would invalidate the evidence).
  const dirtyPaths = git(['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean);
  const relayDirty = git([
    'status', '--porcelain', '--',
    'apps/relay/src', 'apps/relay/migrations', 'apps/relay/schema.sql', 'apps/relay/tests',
  ]).split('\n').map((l) => l.trim()).filter(Boolean);
  const provenance = {
    capturedAt: new Date().toISOString(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', 'HEAD']),
    // The code under test — src/, migrations/, schema.sql, tests/ — as committed.
    relayTreeClean: relayDirty.length === 0,
    relayDirtyPaths: relayDirty,
    dirtyPaths,
    wrangler: execFileSync(WRANGLER, ['--version'], { cwd: RELAY, encoding: 'utf8' }).trim(),
    node: process.version,
    workdir: WORK,
  };
  log(`branch ${provenance.branch} @ ${provenance.commit.slice(0, 9)}`);

  const db = prepareDatabase();
  const worker = await startWorker();

  try {
    const exported = JSON.parse(readFileSync(ROADMAP_EXPORT, 'utf8'));
    const A = snapshotA(exported);
    const { payload: B, augmentation } = snapshotB(exported);

    // NULL STATE 1 — a repo that has never synced.
    await step('n1', 'Never-synced repo — no mirror at all', 'The read model refuses rather than inventing an empty board.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
    });

    // NULL STATE 2 — a mirror that exists but is empty (a daemon with an empty roadmap).
    await step('n2', 'Push an EMPTY roadmap', 'A daemon with nothing on the board still pushes; the mirror must accept zero items.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: { ...A, generatedAt: A.generatedAt - 600_000, items: [] },
    });
    await step('n3', 'Empty mirror — watermark present, every lane empty', 'The distinct null state: synced, but nothing to show.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
    });

    // NULL STATE 3 — another repo on a populated account.
    await step('n4', 'A different repo on the SAME account', 'Null states are per-repo: one mirrored repo does not conjure others.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(NEVER_SYNCED)}`,
    });

    // PUSH A — the real daemon export.
    await step('a1', 'Push the REAL roadmap export', `${A.items.length} items, verbatim from docs/roadmap/roadmap.snapshot.json.`, {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: A,
    });
    await step('a2', 'Read the mirror — header + board + activity', 'The honest watermark and the board grouped by status lane.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
    });

    // NULL STATE 4 — a different account.
    await step('n5', 'The SAME repo read by a DIFFERENT account', 'The mirror is account-scoped: account B sees a null state, not account A\'s roadmap.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
      token: BOB_TOKEN,
    });

    // PUSH B — full replace with the labelled augmentation.
    await step('b1', 'Re-push: full replace with edges, activity and one tombstone', 'A second push supersedes the first wholesale — never an interleaving.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: B,
    });
    await step('b2', 'Read the mirror again — watermark advanced, tombstone off the board', 'Same endpoint, after the replace.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
    });
    await step('b3', `Item detail — ${augmentation.focus}`, 'One item in full plus its edges in BOTH directions.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}&slug=${augmentation.focus}`,
    });
    await step('b4', `Tombstone detail — ${augmentation.tombstone}`, 'Off the board, still queryable, explicitly flagged deleted.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}&slug=${augmentation.tombstone}`,
    });
    await step('b5', 'An unknown slug on a live mirror', 'The fourth null state: the mirror exists, the item does not.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}&slug=no-such-item`,
    });

    // GUARDS.
    const tooMany = { ...A, items: Array.from({ length: 5001 }, (_, i) => ({ slug: `overflow-${i}`, status: 'backlog', summaryMd: 'x' })) };
    await step('g1', 'Guard: 5001 items', 'One over MAX_SNAPSHOT_ITEMS — refused loudly rather than silently trimmed.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: tooMany,
    });
    const filler = 'y'.repeat(3000);
    const tooBig = { ...A, items: Array.from({ length: 800 }, (_, i) => ({ slug: `bulk-${i}`, status: 'backlog', summaryMd: filler })) };
    await step('g2', 'Guard: body over 2 MB', 'Over MAX_SNAPSHOT_BYTES — refused before any storage work.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: tooBig,
    });
    await step('g3', 'Guard: an unknown status lane', 'The request guard refuses the lane the storage CHECK would also refuse.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      body: { ...A, generatedAt: A.generatedAt + 999_999, items: [{ slug: 'poisoned', status: 'someday', summaryMd: 'not a lane' }] },
    });
    await step('g4', 'Guard: no credential', 'Unauthenticated push is refused before parsing.', {
      method: 'PUT',
      path: '/v1/roadmap/snapshot',
      token: null,
      body: A,
    });
    await step('g5', 'Read back after all four refusals', 'The mirror is byte-identical to b2 — a refused push touches nothing.', {
      path: `/v1/roadmap/mirror?repo=${encodeURIComponent(REPO_FULL)}`,
    });

    const rollback = await runRollbackProbe(A);

    const runLog = { provenance, worker: { health: worker.health, base: BASE }, database: db, augmentation, steps, rollback };
    mkdirSync(HERE, { recursive: true });
    writeFileSync(join(HERE, 'run-log.json'), JSON.stringify(runLog, null, 1));
    log(`run-log.json written (${steps.length} real-Worker steps + 1 in-process probe)`);

    const { render } = await import(join(HERE, 'render.mjs'));
    await render(runLog, HERE);
  } finally {
    worker.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    worker.child.kill('SIGKILL');
    rmSync(WORK, { recursive: true, force: true });
  }
}

await main();
