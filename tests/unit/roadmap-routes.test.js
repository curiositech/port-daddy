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
