/**
 * Jira-grade roadmap item routes (operator-mandated roadmap command-center,
 * 2026-08-22): durable owner validated against the durable-agent roster,
 * tags filterable in the list read, typed pr/doc/file/media links on
 * graph_edges, and GET /roadmap/items/:slug as the full card (owner join +
 * links + blocks/blocked-by + parent/children + planned-vs-actual).
 *
 * Uses initDatabase({ inMemory: true }) so the REAL schema + boot migrations
 * run (tags_json/actual/completed_at land via the PRAGMA-guarded ALTER path
 * on fresh DBs too), and a real durable-agent roster with a stub embedder —
 * owner validation is exercised against the actual registry, not a mock.
 */

import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { createDurableAgentRoster } from '../../lib/durable-agent-roster.js';
import { roadmapPlugin } from '../../routes/roadmap.js';

let app;
let db;
let graphEdges;
let durableAgentRoster;

beforeEach(async () => {
  db = initDatabase({ inMemory: true });
  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples });
  graphEdges = createGraphEdges(db);
  durableAgentRoster = createDurableAgentRoster(db, {
    resolver: {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      embed: async () => [0.5, 0.5],
    },
    gitleaksRunner: () => ({ findings: [] }),
    logger: { info: jest.fn(), error: jest.fn() },
  });
  const roadmapPromote = {
    promoteFromFeedback: () => {
      throw new Error('not used in jira-card tests');
    },
  };
  app = Fastify();
  await app.register(roadmapPlugin, {
    deps: { roadmapItems, roadmapPromote, graphEdges, durableAgentRoster },
  });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) closeDatabase(db);
});

async function registerRosterAgent(slug = 'portdaddy-relay-steward') {
  const { agent } = await durableAgentRoster.create({
    slug,
    scope: { kind: 'system' },
    remit: 'Own relay reliability work end to end.',
    instructions: 'Keep retry storms bounded; verify both ends after every write.',
    lifecycle: 'ready',
  });
  return agent;
}

async function upsertItem(payload) {
  const res = await app.inject({
    method: 'POST',
    url: '/roadmap/items',
    payload: { harbor: 'fleet', ...payload },
  });
  return res;
}

describe('durable owner: assignee_id validates against the durable-agent roster', () => {
  test('unknown assignee is a 400 that names the registration path', async () => {
    const res = await upsertItem({
      slug: 'owned-item',
      summaryMd: 'needs an owner',
      assigneeId: 'nobody-here',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not on the durable-agent roster/);
    expect(body.error).toMatch(/pd roster create/);
    expect(body.error).toMatch(/POST \/durable-agents/);
  });

  test('a roster agentNodeId is accepted and stored as-is', async () => {
    const agent = await registerRosterAgent();
    const res = await upsertItem({
      slug: 'owned-item',
      summaryMd: 'needs an owner',
      assigneeId: agent.agentNodeId,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.assigneeId).toBe(agent.agentNodeId);
  });

  test('a unique roster slug resolves to the canonical agentNodeId', async () => {
    const agent = await registerRosterAgent();
    const res = await upsertItem({
      slug: 'owned-item',
      summaryMd: 'needs an owner',
      assigneeId: 'portdaddy-relay-steward',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.assigneeId).toBe(agent.agentNodeId);
  });

  test('explicit null clears the owner; omission preserves it', async () => {
    const agent = await registerRosterAgent();
    await upsertItem({ slug: 'owned-item', summaryMd: 'v1', assigneeId: agent.agentNodeId });

    const preserved = await upsertItem({ slug: 'owned-item', summaryMd: 'v2' });
    expect(preserved.json().item.assigneeId).toBe(agent.agentNodeId);

    const cleared = await upsertItem({ slug: 'owned-item', summaryMd: 'v3', assigneeId: null });
    expect(cleared.statusCode).toBe(201);
    expect(cleared.json().item.assigneeId).toBeNull();
  });

  test('list and detail reads join owner display info (name/status) from the roster', async () => {
    const agent = await registerRosterAgent();
    await upsertItem({ slug: 'owned-item', summaryMd: 'owned', assigneeId: agent.agentNodeId });
    await upsertItem({ slug: 'orphan-item', summaryMd: 'unowned' });

    const list = await app.inject({ method: 'GET', url: '/roadmap/items?harbor=fleet&status=all' });
    const items = list.json().items;
    const owned = items.find((i) => i.slug === 'owned-item');
    expect(owned.owner).toEqual({
      agentNodeId: agent.agentNodeId,
      slug: 'portdaddy-relay-steward',
      displayName: agent.profile.displayName,
      status: 'active',
    });
    expect(items.find((i) => i.slug === 'orphan-item').owner).toBeNull();

    const detail = await app.inject({ method: 'GET', url: '/roadmap/items/owned-item?harbor=fleet' });
    expect(detail.json().owner.agentNodeId).toBe(agent.agentNodeId);
    expect(detail.json().item.owner.slug).toBe('portdaddy-relay-steward');
  });
});

describe('tags: route round-trip and ?tag= filter', () => {
  test('tags persist through POST and filter the list read exactly', async () => {
    await upsertItem({ slug: 'tag-a', summaryMd: 'a', tags: ['infra', 'reliability'] });
    await upsertItem({ slug: 'tag-b', summaryMd: 'b', tags: ['infra-v2'] });

    const filtered = await app.inject({ method: 'GET', url: '/roadmap/items?harbor=fleet&status=all&tag=infra' });
    expect(filtered.json().items.map((i) => i.slug)).toEqual(['tag-a']);

    const detail = await app.inject({ method: 'GET', url: '/roadmap/items/tag-a?harbor=fleet' });
    expect(detail.json().item.tags).toEqual(['infra', 'reliability']);
  });
});

describe('typed links: pr/doc/file/media add, list, remove', () => {
  beforeEach(async () => {
    await upsertItem({ slug: 'linked-item', summaryMd: 'carries evidence' });
  });

  test('each link kind round-trips with whitelisted metadata', async () => {
    const adds = [
      { type: 'pr', target: '9340', url: 'https://github.com/curiositech/port-daddy/pull/9340', title: 'retry backoff' },
      { type: 'doc', target: 'docs/adr/0086-pd-planner-hierarchical-task-model.md' },
      { type: 'file', target: 'lib/planner-edges.ts' },
      { type: 'media', target: 'screenshots/board.png', mime: 'image/png', caption: 'board render' },
    ];
    for (const payload of adds) {
      const res = await app.inject({ method: 'POST', url: '/roadmap/items/linked-item/links', payload });
      expect(res.statusCode).toBe(201);
      expect(res.json().link.kind).toBe(payload.type);
      expect(res.json().link.targetId).toBe(payload.target);
    }

    const list = await app.inject({ method: 'GET', url: '/roadmap/items/linked-item/links' });
    const links = list.json().links;
    expect(links).toHaveLength(4);
    const byKind = Object.fromEntries(links.map((l) => [l.kind, l]));
    expect(byKind.pr.metadata).toEqual({
      url: 'https://github.com/curiositech/port-daddy/pull/9340',
      title: 'retry backoff',
    });
    expect(byKind.media.metadata).toEqual({ mime: 'image/png', caption: 'board render' });
    expect(byKind.doc.metadata).toBeNull();
    expect(byKind.file.metadata).toBeNull();
  });

  test('re-adding the same link upserts (no duplicates); DELETE removes exactly one and 404s when absent', async () => {
    await app.inject({ method: 'POST', url: '/roadmap/items/linked-item/links', payload: { type: 'pr', target: '1' } });
    await app.inject({ method: 'POST', url: '/roadmap/items/linked-item/links', payload: { type: 'pr', target: '1', title: 'retitled' } });
    await app.inject({ method: 'POST', url: '/roadmap/items/linked-item/links', payload: { type: 'pr', target: '2' } });

    let list = await app.inject({ method: 'GET', url: '/roadmap/items/linked-item/links' });
    expect(list.json().count).toBe(2);

    const del = await app.inject({ method: 'DELETE', url: '/roadmap/items/linked-item/links?type=pr&target=1' });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);

    list = await app.inject({ method: 'GET', url: '/roadmap/items/linked-item/links' });
    expect(list.json().links.map((l) => l.targetId)).toEqual(['2']);

    const again = await app.inject({ method: 'DELETE', url: '/roadmap/items/linked-item/links?type=pr&target=1' });
    expect(again.statusCode).toBe(404);
  });

  test('validation: unknown item 404s, bad type and non-numeric PR target 400', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/roadmap/items/never-existed/links',
      payload: { type: 'pr', target: '1' },
    });
    expect(missing.statusCode).toBe(404);

    const badType = await app.inject({
      method: 'POST',
      url: '/roadmap/items/linked-item/links',
      payload: { type: 'commitish', target: 'abc' },
    });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error).toMatch(/pr\|doc\|file\|media/);

    const badPr = await app.inject({
      method: 'POST',
      url: '/roadmap/items/linked-item/links',
      payload: { type: 'pr', target: 'not-a-number' },
    });
    expect(badPr.statusCode).toBe(400);
    expect(badPr.json().error).toMatch(/PR number/);
  });
});

describe('detail read: the full Jira card', () => {
  test('returns owner, links, both blocking directions, hierarchy, tags, and planned-vs-actual', async () => {
    const agent = await registerRosterAgent();
    await upsertItem({ slug: 'base', summaryMd: 'foundation' });
    await upsertItem({
      slug: 'mid',
      summaryMd: 'the card under test',
      dependencies: ['base'],
      assigneeId: agent.agentNodeId,
      tags: ['infra'],
      estimate: 5,
      actual: 8,
      startedAt: 1_700_000_000_000,
      dueAt: 1_700_600_000_000,
    });
    await upsertItem({ slug: 'leaf', summaryMd: 'depends on mid', dependencies: ['mid'] });
    await app.inject({
      method: 'POST',
      url: '/roadmap/items/mid/links',
      payload: { type: 'pr', target: '9340', title: 'evidence' },
    });
    // Hierarchy edges live in graph_edges (planner:hierarchy, parent_of).
    graphEdges.remember({
      scope: 'planner:hierarchy',
      sourceType: 'roadmap:item',
      sourceId: 'epic-root',
      edgeType: 'parent_of',
      targetType: 'roadmap:item',
      targetId: 'mid',
    });
    graphEdges.remember({
      scope: 'planner:hierarchy',
      sourceType: 'roadmap:item',
      sourceId: 'mid',
      edgeType: 'parent_of',
      targetType: 'roadmap:item',
      targetId: 'leaf',
    });

    const res = await app.inject({ method: 'GET', url: '/roadmap/items/mid?harbor=fleet' });
    expect(res.statusCode).toBe(200);
    const card = res.json();

    expect(card.item.slug).toBe('mid');
    expect(card.item.tags).toEqual(['infra']);
    expect(card.owner.agentNodeId).toBe(agent.agentNodeId);
    expect(card.links).toHaveLength(1);
    expect(card.links[0]).toMatchObject({ kind: 'pr', targetId: '9340' });
    expect(card.blockedBy).toEqual(['base']);
    expect(card.blocks).toEqual(['leaf']);
    expect(card.parent).toBe('epic-root');
    expect(card.children).toEqual(['leaf']);
    expect(card.plannedVsActual).toEqual({
      estimate: 5,
      actual: 8,
      variance: 3,
      startedAt: 1_700_000_000_000,
      dueAt: 1_700_600_000_000,
      completedAt: null,
    });
  });

  test('boot backfill migrates legacy dependencies_json into planner:deps edges and clears the column', async () => {
    // A separate file-backed registry so we can close and re-open it — the
    // backfill runs inside initDatabase, i.e. at daemon boot.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pd-backfill-'));
    const dbPath = join(dir, 'registry.db');
    try {
      const first = initDatabase({ dbPath });
      // Simulate a pre-retirement row (e.g. arrived from an old replica).
      first.prepare(`INSERT INTO roadmap_items (id, slug, summary_md, status, last_touched_at, dependencies_json, notes_json, harbor, created_at)
                     VALUES ('old-id', 'old-item', 'legacy deps', 'backlog', 1, '["base-dep"]', '[]', 'fleet', 1)`).run();
      closeDatabase(first);

      // Next boot: the backfill converts JSON → edges and clears the column.
      const second = initDatabase({ dbPath });
      const edges = second
        .prepare(`SELECT source_id, target_id FROM graph_edges
                   WHERE scope = 'planner:deps' AND edge_type = 'depends_on'`)
        .all();
      expect(edges).toEqual([{ source_id: 'old-item', target_id: 'base-dep' }]);
      expect(
        second.prepare(`SELECT dependencies_json FROM roadmap_items WHERE slug = 'old-item'`).get().dependencies_json,
      ).toBe('[]');
      closeDatabase(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the done transition stamps completed_at into planned-vs-actual', async () => {
    await upsertItem({ slug: 'closing', summaryMd: 'about to ship', estimate: 2, actual: 2 });
    const status = await app.inject({
      method: 'POST',
      url: '/roadmap/items/closing/status',
      payload: { status: 'done', by: 'agent-test', harbor: 'fleet' },
    });
    expect(status.statusCode).toBe(200);

    const card = await app.inject({ method: 'GET', url: '/roadmap/items/closing?harbor=fleet' });
    const pva = card.json().plannedVsActual;
    expect(typeof pva.completedAt).toBe('number');
    expect(pva.variance).toBe(0);
  });
});
