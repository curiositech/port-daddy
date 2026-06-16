import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createParley } from '../../lib/parley.js';
import { parleyPlugin } from '../../routes/parley.js';

let app;
let db;

beforeEach(async () => {
  db = createTestDb();
  const tuples = createTupleSpace(db);
  const parley = createParley({ tuples, now: () => 1_700_000_000_000 });
  app = Fastify();
  await app.register(parleyPlugin, { deps: { parley } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

async function callParley() {
  const res = await app.inject({
    method: 'POST',
    url: '/parley/call',
    payload: {
      surface: 'lib/sessions.ts',
      reason: 'overlapping session edits',
      calledBy: 'operator',
      parties: ['agent-a', 'agent-b'],
    },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).parley;
}

test('POST /parley/call opens a parley', async () => {
  const p = await callParley();
  expect(p.status).toBe('SUMMONED');
  expect(p.channel).toBe(`parley:${p.parleyId}`);
});

test('POST /parley/respond records a turn and returns status', async () => {
  const p = await callParley();
  const res = await app.inject({
    method: 'POST',
    url: '/parley/respond',
    payload: {
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'agent-a owns code path',
    },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.turn.performative).toBe('propose');
  expect(body.status.missingParties).toEqual(['agent-b']);
});

test('POST /parley/resolve collapses a parley', async () => {
  const p = await callParley();
  const res = await app.inject({
    method: 'POST',
    url: '/parley/resolve',
    payload: {
      parleyId: p.parleyId,
      status: 'COLLAPSED',
      decision: 'agent-a owns code path; agent-b owns tests',
      resolvedBy: 'operator',
    },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.outcome.status).toBe('COLLAPSED');
  expect(body.summary.status).toBe('COLLAPSED');
});

test('GET /parley and /parley/:id show summaries', async () => {
  const p = await callParley();
  const list = await app.inject({ method: 'GET', url: '/parley' });
  expect(list.statusCode).toBe(200);
  expect(JSON.parse(list.body).count).toBe(1);

  const show = await app.inject({ method: 'GET', url: `/parley/${p.parleyId}` });
  expect(show.statusCode).toBe(200);
  expect(JSON.parse(show.body).summary.parley.surface).toBe('lib/sessions.ts');
});

test('validates required call fields', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/parley/call',
    payload: { surface: 'x' },
  });
  expect(res.statusCode).toBe(400);
});
