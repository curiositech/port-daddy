/**
 * Roadmap projection — the "roadmap is home" read model (lib/roadmap-projection.ts).
 *
 * Pins:
 *   1. shape — a fixture DB (items + claims + receipts) projects to the
 *      versioned {v, harbor, generatedAt, items, doThisNext} shape.
 *   2. law 13 — an item with no dispatch receipt trail can NEVER emit
 *      liveEvidence.live=true, no matter how fresh its other rows are.
 *   3. worktree anchoring — two worktrees of one repo project identically.
 *   4. determinism — same DB + same clock => byte-identical JSON.
 *   5. route — GET /roadmap/projection serves the projection read-only.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import {
  buildRoadmapProjection,
  serializeRoadmapProjection,
  resolveProjectionHarbor,
  ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS,
} from '../../lib/roadmap-projection.ts';
import { roadmapPlugin } from '../../routes/roadmap.js';

const NOW = 1_700_000_100_000;
const clock = () => NOW;

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE roadmap_items (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, summary_md TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      promoted_from_feedback_id TEXT, promoted_by_agent_id TEXT, promoted_at INTEGER,
      last_touched_at INTEGER NOT NULL,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      notes_json TEXT NOT NULL DEFAULT '[]',
      harbor TEXT NOT NULL, created_at INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'task',
      priority INTEGER NOT NULL DEFAULT 3,
      nightshift_eligible INTEGER NOT NULL DEFAULT 0,
      dispatch_id TEXT,
      deleted_at INTEGER,
      UNIQUE(slug, harbor));
    CREATE TABLE roadmap_item_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL,
      by_agent_id TEXT, at INTEGER NOT NULL, harbor TEXT NOT NULL);
    CREATE TABLE roadmap_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL, kind TEXT NOT NULL, feedback_id TEXT,
      claimed_by TEXT NOT NULL, claimed_at INTEGER NOT NULL,
      released_at INTEGER, released_by TEXT, release_reason TEXT,
      summary TEXT, surface TEXT, payload TEXT, session_id TEXT, agent_id TEXT);
    CREATE TABLE dispatches (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, goal TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      requested_by TEXT NOT NULL DEFAULT 'operator',
      created_at INTEGER NOT NULL, claimed_at INTEGER, started_at INTEGER,
      produced_at INTEGER, reviewed_at INTEGER, settled_at INTEGER);
  `);
  return db;
}

function seedItem(db, row) {
  db.prepare(`
    INSERT INTO roadmap_items
      (id, slug, summary_md, status, last_touched_at, dependencies_json,
       notes_json, harbor, created_at, priority, nightshift_eligible,
       dispatch_id, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.slug, row.summary, row.status ?? 'backlog',
    row.touched ?? NOW - 600_000, JSON.stringify(row.deps ?? []),
    JSON.stringify(row.notes ?? []), row.harbor ?? 'port-daddy',
    row.created ?? NOW - 1_000_000, row.priority ?? 3, row.eligible ?? 0,
    row.dispatchId ?? null, row.deletedAt ?? null,
  );
}

function seedFixture(db) {
  // Front-door intent, claimed, with a receipt trail but NO dispatch.
  seedItem(db, {
    id: 'i-home', slug: 'ship-roadmap-home',
    summary: '# Ship the roadmap-home projection\nOne projection, three consumers.',
    status: 'now', priority: 1, touched: NOW - 120_000,
    notes: [{ at: NOW - 500_000, by: 'erich', text: 'operator decision 4: roadmap is home' }],
  });
  db.prepare(`INSERT INTO roadmap_item_status_events (item_id, slug, status, by_agent_id, at, harbor)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('i-home', 'ship-roadmap-home', 'now', 'cartographer', NOW - 400_000, 'port-daddy');
  db.prepare(`INSERT INTO roadmap_claims (slug, kind, claimed_by, claimed_at, session_id, agent_id)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('ship-roadmap-home', 'now', 'wave-f1', NOW - 300_000, 'sess-1', 'agent-f1');
  // A released claim must NOT surface.
  db.prepare(`INSERT INTO roadmap_claims (slug, kind, claimed_by, claimed_at, released_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('night-ready', 'live', 'someone-earlier', NOW - 900_000, NOW - 800_000);

  // Popper-dispatched with FRESH stream evidence -> live.
  seedItem(db, {
    id: 'i-live', slug: 'popper-live', summary: 'Being worked right now',
    status: 'backlog', touched: NOW - 200_000, dispatchId: 'd-live',
  });
  db.prepare(`INSERT INTO dispatches (id, slug, goal, state, requested_by, created_at, claimed_at, started_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-live', 'popper-live', 'Being worked right now', 'in_progress',
      'roadmap-popper', NOW - 90_000, NOW - 80_000, NOW - 30_000);

  // Popper-dispatched but evidence far outside the freshness window -> stale.
  seedItem(db, {
    id: 'i-stale', slug: 'popper-stale', summary: 'Dispatched an hour ago',
    status: 'backlog', touched: NOW - 3_700_000, dispatchId: 'd-stale',
  });
  db.prepare(`INSERT INTO dispatches (id, slug, goal, state, requested_by, created_at, started_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('d-stale', 'popper-stale', 'Dispatched an hour ago', 'in_progress',
      'roadmap-popper', NOW - 3_700_000, NOW - 3_600_000);

  // Nightshift-eligible, undelayed backlog item -> the popper-next suggestion.
  seedItem(db, {
    id: 'i-night', slug: 'night-ready', summary: 'Ready for nightshift',
    status: 'backlog', touched: NOW - 250_000, eligible: 1,
  });

  // Other harbors and tombstones are invisible.
  seedItem(db, { id: 'i-other', slug: 'other-board', summary: 'Different harbor', harbor: 'windags' });
  seedItem(db, {
    id: 'i-dead', slug: 'tombstoned', summary: 'Deleted', deletedAt: NOW - 10_000,
  });
}

describe('roadmap-projection', () => {
  let db;
  beforeEach(() => { db = setupDb(); seedFixture(db); });
  afterEach(() => { db.close(); });

  test('pins the versioned shape over the fixture DB (items + claims + receipts)', () => {
    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });

    expect(p.v).toBe(1);
    expect(p.harbor).toBe('port-daddy');
    expect(p.generatedAt).toBe(NOW);
    // Other-harbor + tombstoned rows are invisible; total order is
    // status rank, then priority, then freshest-first, then slug.
    expect(p.items.map((i) => i.slug)).toEqual([
      'ship-roadmap-home', 'popper-live', 'night-ready', 'popper-stale',
    ]);

    const home = p.items[0];
    expect(home).toMatchObject({
      id: 'i-home',
      slug: 'ship-roadmap-home',
      title: 'Ship the roadmap-home projection',
      status: 'now',
      priority: 1,
      claim: {
        claimedBy: 'wave-f1',
        claimedAt: NOW - 300_000,
        kind: 'now',
        sessionId: 'sess-1',
        agentId: 'agent-f1',
      },
    });
    // Receipt trail: oldest first, note + status-event both present.
    expect(home.receipts).toEqual([
      { kind: 'note', at: NOW - 500_000, by: 'erich', detail: 'operator decision 4: roadmap is home' },
      { kind: 'status-event', at: NOW - 400_000, by: 'cartographer', detail: 'status -> now' },
    ]);

    // The dispatched item carries its dispatch receipt.
    const live = p.items.find((i) => i.slug === 'popper-live');
    expect(live.receipts).toEqual([
      { kind: 'dispatch', at: NOW - 90_000, by: 'roadmap-popper', detail: 'dispatch d-live (in_progress)' },
    ]);

    // The released claim never surfaces.
    expect(p.items.find((i) => i.slug === 'night-ready').claim).toBeNull();

    // doThisNext: intent first, then the popper's next candidate.
    expect(p.doThisNext).toEqual([
      { slug: 'ship-roadmap-home', title: 'Ship the roadmap-home projection', reason: 'status-now' },
      { slug: 'night-ready', title: 'Ready for nightshift', reason: 'popper-next' },
    ]);
  });

  test('law 13: no receipt trail can never emit liveEvidence.live=true', () => {
    // Give the trail-less item stream-fresh EVERYTHING except a dispatch stamp:
    // a status event and a note landed 1s ago, last_touched_at is now.
    db.prepare(`INSERT INTO roadmap_item_status_events (item_id, slug, status, by_agent_id, at, harbor)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('i-home', 'ship-roadmap-home', 'now', 'someone', NOW - 1_000, 'port-daddy');
    db.prepare(`UPDATE roadmap_items SET last_touched_at = ? WHERE id = 'i-home'`).run(NOW);

    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });

    const home = p.items.find((i) => i.slug === 'ship-roadmap-home');
    expect(home.liveEvidence).toEqual({
      live: false,
      source: null,
      dispatchId: null,
      lastEvidenceAt: null,
      ageMs: null,
      maxAgeMs: ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS,
      label: 'static — no dispatch receipt trail',
    });
    // Every trail-less item in the projection obeys the same law.
    for (const item of p.items) {
      if (item.liveEvidence.dispatchId === null) {
        expect(item.liveEvidence.live).toBe(false);
      }
    }
  });

  test('law 13: dispatch trail goes live only inside the freshness window, stale is labeled on its face', () => {
    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });

    const live = p.items.find((i) => i.slug === 'popper-live');
    expect(live.liveEvidence).toMatchObject({
      live: true,
      source: 'popper-dispatch',
      dispatchId: 'd-live',
      lastEvidenceAt: NOW - 30_000,
      ageMs: 30_000,
      label: 'live — events arriving',
    });
    expect(live.liveEvidence.ageMs).toBeLessThanOrEqual(ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS);

    const stale = p.items.find((i) => i.slug === 'popper-stale');
    expect(stale.liveEvidence.live).toBe(false);
    expect(stale.liveEvidence.source).toBe('popper-dispatch');
    expect(stale.liveEvidence.label).toBe('showing cached truth — last evidence 3600s');
  });

  test('law 13: evidence dated in the FUTURE can never render live', () => {
    // The bypass this pins: ageMs was Math.max(0, now - lastEvidenceAt), so a
    // future-dated row clamped to age 0, satisfied `ageMs <= maxAge`, and
    // rendered "live — events arriving" FOREVER. Clock skew on another device,
    // a corrupt row, or a bad write would each produce a permanently-LIVE item
    // backed by evidence that has not happened yet — precisely the fake
    // freshness law 13 exists to forbid.
    seedItem(db, {
      id: 'i-future', slug: 'popper-future', summary: 'Evidence from tomorrow',
      status: 'backlog', touched: NOW - 1_000, dispatchId: 'd-future',
    });
    db.prepare(`INSERT INTO dispatches (id, slug, goal, state, requested_by, created_at, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('d-future', 'popper-future', 'Evidence from tomorrow', 'in_progress',
        'roadmap-popper', NOW + 86_400_000, NOW + 86_400_000);

    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });
    const future = p.items.find((i) => i.slug === 'popper-future');
    expect(future.liveEvidence.live).toBe(false);
    expect(future.liveEvidence.label).toMatch(/future/i);
  });

  test('law 13: small forward clock skew is tolerated rather than treated as corruption', () => {
    // Distributed clocks disagree by seconds all the time; a daemon a second
    // ahead of the reader is not lying about its evidence. Only skew beyond
    // the tolerance is refused, so this stays a corruption guard and does not
    // become a flaky-clock guard.
    seedItem(db, {
      id: 'i-skew', slug: 'popper-skew', summary: 'A second ahead',
      status: 'backlog', touched: NOW - 1_000, dispatchId: 'd-skew',
    });
    db.prepare(`INSERT INTO dispatches (id, slug, goal, state, requested_by, created_at, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('d-skew', 'popper-skew', 'A second ahead', 'in_progress',
        'roadmap-popper', NOW - 10_000, NOW + 1_000);

    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });
    const skew = p.items.find((i) => i.slug === 'popper-skew');
    expect(skew.liveEvidence.live).toBe(true);
    expect(skew.liveEvidence.ageMs).toBe(0);
  });

  test('law 13: a settled dispatch and a ghost dispatch id both stay non-live', () => {
    seedItem(db, {
      id: 'i-done', slug: 'popper-done', summary: 'Already settled',
      status: 'done', touched: NOW - 5_000, dispatchId: 'd-done',
    });
    db.prepare(`INSERT INTO dispatches (id, slug, goal, state, created_at, settled_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('d-done', 'popper-done', 'Already settled', 'settled', NOW - 50_000, NOW - 10_000);
    // A stamp whose dispatch row vanished: trail without stream evidence.
    seedItem(db, {
      id: 'i-ghost', slug: 'popper-ghost', summary: 'Orphaned stamp',
      status: 'backlog', touched: NOW - 1_000, dispatchId: 'd-ghost',
    });

    const p = buildRoadmapProjection(db, '/nonexistent/port-daddy', {
      harbor: 'port-daddy', now: clock,
    });
    const done = p.items.find((i) => i.slug === 'popper-done');
    expect(done.liveEvidence.live).toBe(false);
    expect(done.liveEvidence.label).toBe('settled — dispatch settled');
    const ghost = p.items.find((i) => i.slug === 'popper-ghost');
    expect(ghost.liveEvidence.live).toBe(false);
    expect(ghost.liveEvidence.label).toBe('stale — dispatch trail without stream evidence');
  });

  test('determinism: same DB twice gives byte-identical JSON', () => {
    const opts = { harbor: 'port-daddy', now: clock };
    const first = serializeRoadmapProjection(
      buildRoadmapProjection(db, '/nonexistent/port-daddy', opts),
    );
    const second = serializeRoadmapProjection(
      buildRoadmapProjection(db, '/nonexistent/port-daddy', opts),
    );
    expect(second).toBe(first);
    expect(first).toContain('"v":1');
  });

  test('worktree anchoring: two worktrees of one repo project identically', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-projection-'));
    const projectDir = join(root, 'canonical-harbor');
    const linkedWorktree = join(root, 'linked-feature');
    mkdirSync(projectDir);
    try {
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', [
        '-c', 'user.name=Port Daddy Test',
        '-c', 'user.email=port-daddy-test@example.invalid',
        'commit', '--allow-empty', '-m', 'initial',
      ], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'feature-projection', linkedWorktree], {
        cwd: projectDir, stdio: 'ignore',
      });

      seedItem(db, {
        id: 'i-canon', slug: 'canonical-item', summary: 'On the canonical board',
        status: 'now', harbor: 'canonical-harbor',
      });

      // Isolate from any ambient $PD_HARBOR via env injection.
      expect(resolveProjectionHarbor(projectDir, { env: {} })).toBe('canonical-harbor');
      expect(resolveProjectionHarbor(linkedWorktree, { env: {} })).toBe('canonical-harbor');

      const fromCanonical = serializeRoadmapProjection(
        buildRoadmapProjection(db, projectDir, { now: clock, env: {} }),
      );
      const fromLinked = serializeRoadmapProjection(
        buildRoadmapProjection(db, linkedWorktree, { now: clock, env: {} }),
      );
      expect(fromLinked).toBe(fromCanonical);
      const parsed = JSON.parse(fromCanonical);
      expect(parsed.harbor).toBe('canonical-harbor');
      expect(parsed.items.map((i) => i.slug)).toEqual(['canonical-item']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('tolerant reader: a legacy DB without popper/planner/tombstone columns still projects', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE roadmap_items (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL, summary_md TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'backlog',
        last_touched_at INTEGER NOT NULL,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        notes_json TEXT NOT NULL DEFAULT '[]',
        harbor TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(slug, harbor));
    `);
    legacy.prepare(`INSERT INTO roadmap_items
        (id, slug, summary_md, status, last_touched_at, harbor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('l-1', 'legacy-item', 'Legacy row', 'now', NOW - 1_000, 'port-daddy', NOW - 2_000);
    try {
      const p = buildRoadmapProjection(legacy, '/nonexistent/port-daddy', {
        harbor: 'port-daddy', now: clock,
      });
      expect(p.items).toHaveLength(1);
      expect(p.items[0]).toMatchObject({
        slug: 'legacy-item', priority: 3, claim: null, receipts: [],
      });
      expect(p.items[0].liveEvidence.live).toBe(false);
    } finally {
      legacy.close();
    }
  });
});

describe('GET /roadmap/projection', () => {
  let db;
  let app;
  const stubDeps = () => ({
    roadmapItems: { list: () => [] },
    roadmapPromote: { promoteFromFeedback: () => { throw new Error('not used'); } },
  });

  beforeEach(() => { db = setupDb(); seedFixture(db); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    db.close();
  });

  test('serves the read-only projection with the canonical serialization', async () => {
    app = Fastify();
    await app.register(roadmapPlugin, {
      deps: { ...stubDeps(), db, repoRoot: '/nonexistent/port-daddy' },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/roadmap/projection?harbor=port-daddy' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(res.body);
    expect(body.v).toBe(1);
    expect(body.harbor).toBe('port-daddy');
    expect(body.items.map((i) => i.slug)).toEqual([
      'ship-roadmap-home', 'popper-live', 'night-ready', 'popper-stale',
    ]);
    expect(body.doThisNext[0].slug).toBe('ship-roadmap-home');
    // Canonical bytes: the served body equals a re-serialization of itself.
    expect(res.body).toBe(serializeRoadmapProjection(body));
  });

  test('self-degrades with 503 when the daemon mode carries no db', async () => {
    app = Fastify();
    await app.register(roadmapPlugin, { deps: stubDeps() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/roadmap/projection' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      error: 'roadmap projection requires daemon db',
    });
  });
});
