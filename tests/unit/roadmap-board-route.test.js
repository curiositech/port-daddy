import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { roadmapPlugin } from '../../routes/roadmap.js';

let app;
let db;

function seedHierarchy(roadmapItems) {
  // Seed a small hierarchy: two ADR-0048 phases (phase-1 depends on phase-0) + a loose item.
  roadmapItems.upsert({ slug: 'adr-0048-phase-0-ratify', summaryMd: 'ratify', status: 'now', harbor: 'port-daddy' });
  roadmapItems.upsert({
    slug: 'adr-0048-phase-1-proto',
    summaryMd: 'protocol',
    status: 'now',
    dependencies: ['adr-0048-phase-0-ratify'],
    harbor: 'port-daddy',
  });
  roadmapItems.upsert({ slug: 'a-loose-idea', summaryMd: 'no adr token', status: 'backlog', harbor: 'fleet' });
}

beforeEach(async () => {
  db = createTestDb();
  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples, now: () => 1_700_000_000_000 });
  seedHierarchy(roadmapItems);

  const roadmapPromote = { promoteFromFeedback: () => { throw new Error('not used'); } };
  app = Fastify();
  await app.register(roadmapPlugin, { deps: { roadmapItems, roadmapPromote } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

test('GET /roadmap/board returns a self-contained HTML board derived live from roadmap_items', async () => {
  const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  const html = res.body;
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).toContain('Planner Board');
  // hierarchy derived from the seeded slugs
  expect(html).toContain('ADR-0048');
  expect(html).toContain('adr-0048-phase-0-ratify');
  expect(html).toContain('Unsorted'); // the loose item
  // same-origin live layer (pdBase '') → relative fetch, and the tube box
  expect(html).toContain("/roadmap/items");
  expect(html).toContain('pdTube');
});

test('the board reflects current items on each request (no migration needed)', async () => {
  const before = await app.inject({ method: 'GET', url: '/roadmap/board' });
  expect(before.body).not.toContain('adr-0099-phase-0-fresh');
  // Add an item, then re-request — it should appear (derived live).
  const res2 = await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: { slug: 'adr-0099-phase-0-fresh', summaryMd: 'fresh', status: 'now', harbor: 'port-daddy' },
  });
  expect(res2.statusCode).toBe(201);
  const after = await app.inject({ method: 'GET', url: '/roadmap/board' });
  expect(after.body).toContain('adr-0099-phase-0-fresh');
  expect(after.body).toContain('ADR-0099');
});

describe('GET /roadmap/board persists the derived plan into graph_edges', () => {
  // ADR-0086 §3 designed graph_edges to hold this hierarchy/dependency structure, but
  // writePlanEdges (lib/planner-edges.ts) had zero callers so the table stayed empty forever.
  // The board route is the one place a PlannerPlan is already derived from live roadmap_items —
  // these tests prove the wire-up actually lands real rows, and that it converges (no dupes) on
  // repeat renders.
  let edgesApp;
  let edgesDb;
  let graphEdges;

  beforeEach(async () => {
    edgesDb = createTestDb();
    const tuples = createTupleSpace(edgesDb);
    const roadmapItems = createRoadmapItems({ db: edgesDb, tuples, now: () => 1_700_000_000_000 });
    seedHierarchy(roadmapItems);
    graphEdges = createGraphEdges(edgesDb);

    const roadmapPromote = { promoteFromFeedback: () => { throw new Error('not used'); } };
    edgesApp = Fastify();
    await edgesApp.register(roadmapPlugin, { deps: { roadmapItems, roadmapPromote, graphEdges } });
    await edgesApp.ready();
  });

  afterEach(async () => {
    if (edgesApp) await edgesApp.close();
    if (edgesDb) edgesDb.close();
  });

  test('rendering the board writes real hierarchy + dependency edges matching dependencies_json', async () => {
    // Nothing persisted before the board has ever been rendered.
    expect(graphEdges.list({ scope: 'planner:hierarchy', limit: 100 })).toHaveLength(0);
    expect(graphEdges.list({ scope: 'planner:deps', limit: 100 })).toHaveLength(0);

    const res = await edgesApp.inject({ method: 'GET', url: '/roadmap/board' });
    expect(res.statusCode).toBe(200);

    // depends_on edge: adr-0048-phase-1-proto depends on adr-0048-phase-0-ratify (its
    // dependencies_json), stored dependent→dependency per dependsOnEdge()'s contract.
    const deps = graphEdges.list({ scope: 'planner:deps', edgeType: 'depends_on', limit: 100 });
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      sourceType: 'roadmap:item',
      sourceId: 'adr-0048-phase-1-proto',
      edgeType: 'depends_on',
      targetType: 'roadmap:item',
      targetId: 'adr-0048-phase-0-ratify',
    });

    // Hierarchy edges: project→epic and epic→task containment for every seeded item.
    const hierarchy = graphEdges.list({ scope: 'planner:hierarchy', edgeType: 'parent_of', limit: 100 });
    expect(hierarchy.some((e) => e.sourceId === 'port-daddy' && e.targetId === 'adr-0048')).toBe(true);
    expect(hierarchy.some((e) => e.sourceId === 'port-daddy' && e.targetId === 'unsorted')).toBe(true);
    expect(hierarchy.some((e) => e.sourceId === 'adr-0048' && e.targetId === 'adr-0048-phase-0-ratify')).toBe(true);
    expect(hierarchy.some((e) => e.sourceId === 'adr-0048' && e.targetId === 'adr-0048-phase-1-proto')).toBe(true);
    expect(hierarchy.some((e) => e.sourceId === 'unsorted' && e.targetId === 'a-loose-idea')).toBe(true);
  });

  test('rendering the board twice is idempotent — no duplicate rows, no error', async () => {
    const first = await edgesApp.inject({ method: 'GET', url: '/roadmap/board' });
    expect(first.statusCode).toBe(200);
    const depsAfterFirst = graphEdges.list({ scope: 'planner:deps', limit: 100 });
    const hierarchyAfterFirst = graphEdges.list({ scope: 'planner:hierarchy', limit: 100 });

    const second = await edgesApp.inject({ method: 'GET', url: '/roadmap/board' });
    expect(second.statusCode).toBe(200);
    const depsAfterSecond = graphEdges.list({ scope: 'planner:deps', limit: 100 });
    const hierarchyAfterSecond = graphEdges.list({ scope: 'planner:hierarchy', limit: 100 });

    expect(depsAfterSecond).toHaveLength(depsAfterFirst.length);
    expect(hierarchyAfterSecond).toHaveLength(hierarchyAfterFirst.length);
    expect(depsAfterFirst.length).toBeGreaterThan(0);
    expect(hierarchyAfterFirst.length).toBeGreaterThan(0);
  });

  test('a subsequent render reflects a removed dependency (replaceScope converges, not just appends)', async () => {
    await edgesApp.inject({ method: 'GET', url: '/roadmap/board' });
    expect(graphEdges.list({ scope: 'planner:deps', limit: 100 })).toHaveLength(1);

    // Drop the dependency on the roadmap item, then re-render.
    const res = await edgesApp.inject({
      method: 'POST',
      url: '/roadmap/items',
      payload: {
        slug: 'adr-0048-phase-1-proto',
        summaryMd: 'protocol',
        status: 'now',
        dependencies: [],
        harbor: 'port-daddy',
      },
    });
    expect(res.statusCode).toBe(201);

    await edgesApp.inject({ method: 'GET', url: '/roadmap/board' });
    expect(graphEdges.list({ scope: 'planner:deps', limit: 100 })).toHaveLength(0);
  });

  test('graphEdges absent from deps (bare unit fixtures) skips persistence without erroring', async () => {
    // `app`/`db` (top-level beforeEach) registers the plugin with only { roadmapItems,
    // roadmapPromote } — exactly the fixture shape used by every other test in this file, and by
    // tests that predate this PR. The route must render successfully without ever touching
    // writePlanEdges/graph_edges when that dependency is missing.
    const res = await app.inject({ method: 'GET', url: '/roadmap/board' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Planner Board');
  });

  test('a writePlanEdges failure is caught and logged — board rendering still succeeds', async () => {
    const failingGraphEdges = {
      replaceScope: () => {
        throw new Error('simulated graph_edges write failure');
      },
      list: () => [],
    };
    const roadmapItems = createRoadmapItems({ db: edgesDb, tuples: createTupleSpace(edgesDb), now: () => 1_700_000_000_000 });
    // edgesDb already has the seeded hierarchy from the outer beforeEach's roadmapItems instance
    // (same db connection), so a fresh createRoadmapItems here just re-wraps the same tables.
    const roadmapPromote = { promoteFromFeedback: () => { throw new Error('not used'); } };
    const failingApp = Fastify();
    await failingApp.register(roadmapPlugin, {
      deps: { roadmapItems, roadmapPromote, graphEdges: failingGraphEdges },
    });
    await failingApp.ready();

    const res = await failingApp.inject({ method: 'GET', url: '/roadmap/board' });
    // The try/catch around writePlanEdges must swallow the failure — a persistence error can
    // never break board rendering, which is the one user-visible thing this route does.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Planner Board');

    await failingApp.close();
  });
});
