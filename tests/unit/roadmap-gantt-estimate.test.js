/**
 * Gantt-estimate wiring — routes/roadmap.ts's GET /roadmap/board handler passed a hardcoded
 * `estimate: 1` to lib/planner-schedule.ts's schedule() for EVERY task, ignoring the real
 * `roadmap_items.estimate` column entirely. These tests seed distinct real estimates and prove
 * the resulting Gantt schedule (earliestStart/earliestFinish/makespan) actually reflects them —
 * not just that the route compiles/renders.
 *
 * Split into its own file (rather than extending tests/unit/roadmap-board-route.test.js) to avoid
 * touching a file another active Port Daddy session was concurrently editing for the unrelated
 * writePlanEdges/graph_edges persistence effort (session-light-up-writeplanedges-...).
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { roadmapPlugin } from '../../routes/roadmap.js';

let app;
let db;

beforeEach(async () => {
  db = createTestDb();
  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples, now: () => 1_700_000_000_000 });
  // Same seed shape as roadmap-board-route.test.js: two ADR-0048 phases (phase-1 depends on
  // phase-0) + a loose item, so the derived plan/hierarchy is realistic.
  roadmapItems.upsert({ slug: 'adr-0048-phase-0-ratify', summaryMd: 'ratify', status: 'now', harbor: 'port-daddy' });
  roadmapItems.upsert({
    slug: 'adr-0048-phase-1-proto',
    summaryMd: 'protocol',
    status: 'now',
    dependencies: ['adr-0048-phase-0-ratify'],
    harbor: 'port-daddy',
  });
  roadmapItems.upsert({ slug: 'a-loose-idea', summaryMd: 'no adr token', status: 'backlog', harbor: 'fleet' });

  const roadmapPromote = { promoteFromFeedback: () => { throw new Error('not used'); } };
  app = Fastify();
  await app.register(roadmapPlugin, { deps: { roadmapItems, roadmapPromote } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

// Pull the embedded board payload (plan + schedule) back out of the served HTML so assertions can
// inspect the actual scheduler output, not just substring presence in the rendered markup.
function extractBoardData(html) {
  const m = html.match(/<script id="board-data" type="application\/json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m[1]);
}

// roadmapItems.upsert() has no `estimate` input yet (no write path exists — see
// lib/roadmap-items.ts), so tests seed the column the same way any future write path or a
// manual operator edit would: a direct UPDATE against the durable row.
function setEstimate(slug, harbor, estimate) {
  db.prepare('UPDATE roadmap_items SET estimate = ? WHERE slug = ? AND harbor = ?').run(
    estimate,
    slug,
    harbor,
  );
}

describe('Gantt schedule reflects real roadmap_items.estimate (not a hardcoded 1)', () => {
  test('two independent (no dependency) tasks with different real estimates get proportionally different bar widths', async () => {
    // adr-0048-phase-0 and adr-0048-phase-1 depend on each other in the beforeEach seed, which
    // would confound "proportional width" (phase-1's start is bound by phase-0's finish). Use the
    // loose item plus a fresh independent item instead, so each starts at t=0 and its
    // earliestFinish is driven purely by its own estimate.
    await app.inject({
      method: 'POST',
      url: '/roadmap/items',
      payload: { slug: 'z-independent-big', summaryMd: 'big task', status: 'now', harbor: 'fleet' },
    });
    setEstimate('a-loose-idea', 'fleet', 1);
    setEstimate('z-independent-big', 'fleet', 5);

    const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
    expect(res.statusCode).toBe(200);
    const data = extractBoardData(res.body);
    const nodeById = new Map(data.schedule.nodes.map((n) => [n.id, n]));

    const small = nodeById.get('a-loose-idea');
    const big = nodeById.get('z-independent-big');
    expect(small).toBeDefined();
    expect(big).toBeDefined();

    // Both are independent roots: earliestStart 0, duration = their own estimate.
    expect(small.earliestStart).toBe(0);
    expect(big.earliestStart).toBe(0);
    expect(small.earliestFinish - small.earliestStart).toBe(1);
    expect(big.earliestFinish - big.earliestStart).toBe(5);
    // Proof the hardcoded-1 bug is fixed: the two durations actually differ, and the ratio is
    // exactly the ratio of the real DB estimates (5:1) — not 1:1, which is what the old hardcoded
    // `estimate: 1` for every task would have produced.
    expect(big.earliestFinish - big.earliestStart).toBe(
      5 * (small.earliestFinish - small.earliestStart),
    );
    // The makespan (and therefore the Gantt chart's overall span) is driven by the bigger real
    // estimate, not by a hardcoded uniform 1 per task.
    expect(data.schedule.makespan).toBeGreaterThanOrEqual(5);
  });

  test('a chain of two dependent tasks with different estimates schedules the second to start after the first estimate elapses', async () => {
    // adr-0048-phase-1-proto depends_on adr-0048-phase-0-ratify (seeded in beforeEach).
    setEstimate('adr-0048-phase-0-ratify', 'port-daddy', 3);
    setEstimate('adr-0048-phase-1-proto', 'port-daddy', 2);

    const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
    const data = extractBoardData(res.body);
    const nodeById = new Map(data.schedule.nodes.map((n) => [n.id, n]));
    const phase0 = nodeById.get('adr-0048-phase-0-ratify');
    const phase1 = nodeById.get('adr-0048-phase-1-proto');

    expect(phase0.earliestStart).toBe(0);
    expect(phase0.earliestFinish).toBe(3); // driven by phase-0's real estimate, not 1
    // phase-1 can't start until phase-0 (its dependency) finishes — CPM forward pass.
    expect(phase1.earliestStart).toBe(3);
    expect(phase1.earliestFinish).toBe(5); // 3 + phase-1's own real estimate of 2
    expect(data.schedule.makespan).toBe(5);
  });

  test('an item with no estimate set falls back to the documented default of 1, not silently to 0 or undefined', async () => {
    // No setEstimate() call for 'a-loose-idea' — it stays NULL in the DB, exercising the
    // "genuinely unset" fallback path in routes/roadmap.ts.
    const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
    const data = extractBoardData(res.body);
    const nodeById = new Map(data.schedule.nodes.map((n) => [n.id, n]));
    const looseItem = nodeById.get('a-loose-idea');
    expect(looseItem).toBeDefined();
    expect(looseItem.earliestStart).toBe(0);
    expect(looseItem.earliestFinish).toBe(1); // fallback default, matching prior hardcoded behavior
  });

  test('an explicit estimate of 0 is honored as a real zero-duration task, not overridden by the unset-fallback', async () => {
    setEstimate('a-loose-idea', 'fleet', 0);
    const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
    const data = extractBoardData(res.body);
    const nodeById = new Map(data.schedule.nodes.map((n) => [n.id, n]));
    const looseItem = nodeById.get('a-loose-idea');
    expect(looseItem.earliestFinish - looseItem.earliestStart).toBe(0);
  });
});
