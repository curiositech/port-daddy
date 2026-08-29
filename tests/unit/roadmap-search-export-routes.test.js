/**
 * Route-level (Fastify app.inject) coverage for the three new roadmap
 * endpoints — GET /roadmap/search, POST /roadmap/reindex-search, and
 * POST /roadmap/items/:slug/export. tests/unit/roadmap-search.test.js and
 * tests/unit/roadmap-export.test.js already cover the underlying library
 * modules directly; this file exercises the actual route wiring (query/body
 * parsing, status codes, error propagation, and the graphEdges side effect
 * on a successful export) that those unit tests never touch.
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { roadmapPlugin } from '../../routes/roadmap.js';

const DIM = 32;
function fixedVecFor(text) {
  const norm = text.trim().toLowerCase();
  const v = new Array(DIM).fill(0);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < norm.length; i++) h = Math.imul(h ^ norm.charCodeAt(i), 16777619) >>> 0;
  v[h % DIM] += 1;
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}
function makeStubResolver() {
  return { modelId: 'stub', async embed(text) { return fixedVecFor(text); } };
}

const roadmapPromote = {
  promoteFromFeedback: () => {
    throw new Error('not used in these tests');
  },
};

async function buildApp(depsFactory = () => ({})) {
  const db = createTestDb();
  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples, now: () => 1_700_000_000_000 });
  const app = Fastify();
  await app.register(roadmapPlugin, { deps: { roadmapItems, roadmapPromote, db, ...depsFactory(db) } });
  await app.ready();
  return { app, db, roadmapItems };
}

describe('GET /roadmap/search', () => {
  test('degrades to an empty, non-error result when no semantic resolver is wired', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/roadmap/search?q=fix+the+login+bug' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ success: true, hits: [], count: 0, degraded: 'search index unavailable' });
    await app.close();
  });

  test('returns an empty result without touching the index when q is missing', async () => {
    const { app } = await buildApp(() => ({ semanticResolver: makeStubResolver() }));
    const res = await app.inject({ method: 'GET', url: '/roadmap/search' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, hits: [], count: 0 });
    await app.close();
  });

  test('ranks a seeded item and returns it through the real route', async () => {
    const { app, roadmapItems } = await buildApp(() => ({ semanticResolver: makeStubResolver() }));
    roadmapItems.upsert({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug', status: 'now' });

    // The route fires reindexItem fire-and-forget on write; reindex explicitly
    // to avoid a race with the assertion below.
    const reindex = await app.inject({ method: 'POST', url: '/roadmap/reindex-search', payload: {} });
    expect(reindex.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/roadmap/search?q=login%20bug&limit=5' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.hits[0].slug).toBe('fix-login-bug');
    await app.close();
  });
});

describe('POST /roadmap/reindex-search', () => {
  test('503s when no semantic resolver is wired', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/roadmap/reindex-search', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).success).toBe(false);
    await app.close();
  });

  test('backfills every item and reports indexed/total counts', async () => {
    const { app, roadmapItems } = await buildApp(() => ({ semanticResolver: makeStubResolver() }));
    roadmapItems.upsert({ slug: 'a', summaryMd: 'First item', status: 'now' });
    roadmapItems.upsert({ slug: 'b', summaryMd: 'Second item', status: 'backlog' });

    const res = await app.inject({ method: 'POST', url: '/roadmap/reindex-search', payload: {} });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.total).toBe(2);
    expect(body.indexed).toBe(2);
    await app.close();
  });
});

describe('POST /roadmap/items/:slug/export', () => {
  const originalFetch = global.fetch;
  const savedEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...savedEnv };
  });

  test('404s on an unknown slug', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/items/does-not-exist/export',
      payload: { target: 'github' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('400s on an unrecognized target', async () => {
    const { app, roadmapItems } = await buildApp();
    roadmapItems.upsert({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug', status: 'now' });
    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/items/fix-login-bug/export',
      payload: { target: 'trello' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('503s when the target credential env var is not configured', async () => {
    delete process.env.PD_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const { app, roadmapItems } = await buildApp();
    roadmapItems.upsert({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug', status: 'now' });
    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/items/fix-login-bug/export',
      payload: { target: 'github', repo: 'acme/widgets' },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  test('creates a GitHub issue, records an issue link, and never leaks the token into the response', async () => {
    process.env.PD_GITHUB_TOKEN = 'ghp_secret';
    global.fetch = async () => ({
      ok: true,
      status: 201,
      async json() { return { number: 42, html_url: 'https://github.com/acme/widgets/issues/42' }; },
      async text() { return ''; },
    });

    const { app, db, roadmapItems } = await buildApp((db) => ({ graphEdges: createGraphEdges(db) }));
    roadmapItems.upsert({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug', status: 'now' });

    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/items/fix-login-bug/export',
      payload: { target: 'github', repo: 'acme/widgets' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      success: true,
      export: {
        target: 'github',
        externalId: '42',
        externalUrl: 'https://github.com/acme/widgets/issues/42',
      },
    });
    expect(JSON.stringify(body)).not.toContain('ghp_secret');

    const links = createGraphEdges(db).list({ scope: 'planner:links', limit: 10 });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ edgeType: 'links', targetId: '42' });
    await app.close();
  });

  test('propagates an upstream failure as a 502 without a graphEdges write', async () => {
    process.env.PD_GITHUB_TOKEN = 'ghp_secret';
    global.fetch = async () => ({
      ok: false,
      status: 422,
      async json() { return { message: 'Validation Failed' }; },
      async text() { return 'Validation Failed'; },
    });

    const { app, db, roadmapItems } = await buildApp((db) => ({ graphEdges: createGraphEdges(db) }));
    roadmapItems.upsert({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug', status: 'now' });

    const res = await app.inject({
      method: 'POST',
      url: '/roadmap/items/fix-login-bug/export',
      payload: { target: 'github', repo: 'acme/widgets' },
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(createGraphEdges(db).list({ scope: 'planner:links', limit: 10 })).toHaveLength(0);
    await app.close();
  });
});
