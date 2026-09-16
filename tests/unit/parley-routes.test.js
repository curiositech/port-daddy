import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createParley } from '../../lib/parley.js';
import { parleyPlugin } from '../../routes/parley.js';

let app;
let db;

beforeEach(async () => {
  db = createTestDb();
  const agentInbox = {
    internal: {
      sendOnce: () => ({ success: true, messageId: 1 }),
    },
  };
  const parley = createParley({
    db,
    tenantId: 'parley-route-test',
    agentInbox,
    now: () => 1_700_000_000_000,
  });
  app = Fastify();
  await app.register(parleyPlugin, { deps: { parley } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

async function callParley(overrides = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/parley/call',
    payload: {
      surface: 'lib/sessions.ts',
      reason: 'overlapping session edits',
      calledBy: 'operator',
      parties: ['agent-a', 'agent-b'],
      ...overrides,
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

test('POST /parley/resolve remains unavailable until CAP0 redeems authority', async () => {
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
  expect(res.statusCode).toBe(400);
  const body = JSON.parse(res.body);
  expect(body.success).toBe(false);
  expect(body.error).toMatch(/until CAP0 authorizes and redeems/);
  const summary = await app.inject({ method: 'GET', url: `/parley/${p.parleyId}` });
  expect(JSON.parse(summary.body).summary.status).toBe('SUMMONED');
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

test('POST /parley/respond reports turn delivery', async () => {
  const p = await callParley();
  const res = await app.inject({
    method: 'POST',
    url: '/parley/respond',
    payload: { parleyId: p.parleyId, party: 'agent-a', performative: 'propose', content: 'ship A' },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.notified).toEqual(['agent-b', 'operator']);
  expect(body.notifyFailures).toEqual([]);
});

test('GET /parley/:id?as=<party> records a read receipt', async () => {
  const p = await callParley();
  await app.inject({
    method: 'POST',
    url: '/parley/respond',
    payload: { parleyId: p.parleyId, party: 'agent-a', performative: 'propose', content: 'ship A' },
  });

  const res = await app.inject({ method: 'GET', url: `/parley/${p.parleyId}?as=agent-b` });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.receiptRecorded).toBe(true);
  const receipt = body.summary.receipts.find((r) => r.party === 'agent-b');
  expect(receipt.lastSeenAt).toBe(1_700_000_000_000);
  expect(receipt.unseenTurns).toBe(0);
});

test('GET /parley/:id with an unknown ?as= does not record a receipt', async () => {
  const p = await callParley();
  const res = await app.inject({ method: 'GET', url: `/parley/${p.parleyId}?as=stranger` });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.receiptRecorded).toBe(false);
  expect(body.summary.receipts.map((r) => r.party)).toEqual(['agent-a', 'agent-b', 'operator']);
});

test('non-default harbor stays visible and mutable only when every route path carries it', async () => {
  const harbor = 'parley-route-nonfleet';
  const p = await callParley({ harbor });
  expect(p.harbor).toBe(harbor);

  const defaultShow = await app.inject({ method: 'GET', url: `/parley/${p.parleyId}` });
  expect(defaultShow.statusCode).toBe(404);

  const response = await app.inject({
    method: 'POST',
    url: '/parley/respond',
    payload: {
      parleyId: p.parleyId,
      harbor,
      party: 'agent-a',
      performative: 'propose',
      content: 'keep the record in its configured harbor',
    },
  });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).status.parley.harbor).toBe(harbor);

  const shown = await app.inject({
    method: 'GET',
    url: `/parley/${p.parleyId}?harbor=${encodeURIComponent(harbor)}&as=agent-b`,
  });
  expect(shown.statusCode).toBe(200);
  const body = JSON.parse(shown.body);
  expect(body.summary.parley.harbor).toBe(harbor);
  expect(body.receiptRecorded).toBe(true);
  expect(body.summary.receipts.find((receipt) => receipt.party === 'agent-b')).toMatchObject({
    lastSeenAt: 1_700_000_000_000,
    unseenTurns: 0,
  });
});

test('POST /parley/resolve forwards an explicit harbor to the CAP0 authority seam', async () => {
  const harbor = 'parley-route-nonfleet';
  const fakeApp = Fastify();
  let resolvedInput;
  let lookup;
  const parley = {
    resolve(input) {
      resolvedInput = input;
      return { status: 'COLLAPSED', decision: null, reason: null, dissenters: [], resolvedAt: 1 };
    },
    get(...args) {
      lookup = args;
      return { parley: { parleyId: 'parley-nonfleet', harbor }, status: 'COLLAPSED' };
    },
  };

  await fakeApp.register(parleyPlugin, { deps: { parley } });
  await fakeApp.ready();
  try {
    const res = await fakeApp.inject({
      method: 'POST',
      url: '/parley/resolve',
      payload: {
        parleyId: 'parley-nonfleet',
        harbor,
        status: 'COLLAPSED',
        resolvedBy: 'operator',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(resolvedInput).toMatchObject({ parleyId: 'parley-nonfleet', harbor, resolvedBy: 'operator' });
    expect(lookup).toEqual(['parley-nonfleet', harbor]);
  } finally {
    await fakeApp.close();
  }
});
