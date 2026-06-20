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
