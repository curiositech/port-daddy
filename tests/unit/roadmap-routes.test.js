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
  const roadmapPromote = {
    promoteFromFeedback: () => {
      throw new Error('not used in route note tests');
    },
  };
  app = Fastify();
  await app.register(roadmapPlugin, { deps: { roadmapItems, roadmapPromote } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

test('POST /roadmap/items persists structured receipt notes', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: {
      slug: 'swarm-coordination-parley',
      summaryMd: 'Make swarm coordination governed.',
      status: 'now',
      project: 'port-daddy',
      promotedByAgentId: 'agent-cartographer',
      notes: [
        {
          at: 1_700_000_000_000,
          by: 'agent-cartographer',
          text: 'receipt: roadmap updated before commit',
        },
      ],
    },
  });

  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  expect(body.item.notes).toEqual([
    {
      at: 1_700_000_000_000,
      by: 'agent-cartographer',
      text: 'receipt: roadmap updated before commit',
    },
  ]);

  const show = await app.inject({
    method: 'GET',
    url: '/roadmap/items/swarm-coordination-parley?harbor=port-daddy:fleet',
  });
  expect(show.statusCode).toBe(200);
  expect(JSON.parse(show.body).item.notes[0].text).toBe('receipt: roadmap updated before commit');
});

test('DELETE /roadmap/items/:slug removes an item, then 404s on a second delete', async () => {
  await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: { slug: 'stray-dupe', summaryMd: 'remove me', status: 'backlog', harbor: 'fleet' },
  });

  const del = await app.inject({ method: 'DELETE', url: '/roadmap/items/stray-dupe?harbor=fleet' });
  expect(del.statusCode).toBe(200);
  const body = del.json();
  expect(body.success).toBe(true);
  expect(body.removed).toBe(true);
  expect(body.item.slug).toBe('stray-dupe');

  const gone = await app.inject({ method: 'GET', url: '/roadmap/items/stray-dupe?harbor=fleet' });
  expect(gone.statusCode).toBe(404);

  const again = await app.inject({ method: 'DELETE', url: '/roadmap/items/stray-dupe?harbor=fleet' });
  expect(again.statusCode).toBe(404);
  expect(again.json().success).toBe(false);
});

test('POST /roadmap/items accepts planner columns and GET serves them back', async () => {
  const dueAt = 1_700_900_000_000;
  const post = await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: {
      slug: 'gantt-ready',
      summaryMd: 'A schedulable item.',
      status: 'now',
      harbor: 'fleet',
      kind: 'epic',
      priority: 2,
      estimate: 5,
      dueAt,
      assigneeId: 'agent-navigator',
      descriptionMd: 'Body text.',
    },
  });
  expect(post.statusCode).toBe(201);
  const posted = post.json().item;
  expect(posted.kind).toBe('epic');
  expect(posted.priority).toBe(2);
  expect(posted.estimate).toBe(5);
  expect(posted.dueAt).toBe(dueAt);

  const show = await app.inject({ method: 'GET', url: '/roadmap/items/gantt-ready?harbor=fleet' });
  const item = show.json().item;
  expect(item.kind).toBe('epic');
  expect(item.estimate).toBe(5);
  expect(item.assigneeId).toBe('agent-navigator');
  expect(item.descriptionMd).toBe('Body text.');
});

test('POST /roadmap/items ignores an unknown kind instead of failing the write', async () => {
  const post = await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: { slug: 'odd-kind', summaryMd: 'x', harbor: 'fleet', kind: 'saga' },
  });
  expect(post.statusCode).toBe(201);
  expect(post.json().item.kind).toBe('task'); // closed enum: unknown → default
});
