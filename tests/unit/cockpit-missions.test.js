import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import Fastify from 'fastify';
import { readMissions, roadmapItemToMissionCard } from '../../lib/cockpit-missions.js';
import { cockpitPlugin } from '../../routes/cockpit.js';

function makeItem(overrides = {}) {
  return {
    id: 'item-1',
    slug: 'cockpit-mission-intake',
    summaryMd: 'Cockpit mission intake\nBuild the smallest cockpit slice that reads roadmap docs.',
    status: 'now',
    promotedFromFeedbackId: null,
    promotedByAgentId: null,
    promotedAt: null,
    lastTouchedAt: 1700000000000,
    dependencies: ['lib/cockpit-missions.ts', 'routes/cockpit.ts'],
    notes: [
      { at: 1700000000000, by: 'cartographer', text: 'Reads CURRENT-WORK.md.' },
      { at: 1700000001000, by: 'cartographer', text: 'Hooks Fleet UI panel.' },
    ],
    harbor: 'port-daddy',
    ...overrides,
  };
}

function makeRoadmapItemsStub(items) {
  return {
    list: (opts = {}) => {
      let out = [...items];
      if (typeof opts.limit === 'number' && opts.limit > 0) out = out.slice(0, opts.limit);
      return out;
    },
    get: (slug) => items.find((i) => i.slug === slug) ?? null,
    upsert: () => null,
    updateStatus: () => null,
    touch: () => null,
  };
}

describe('roadmapItemToMissionCard', () => {
  test('extracts title from first line, summary from rest', () => {
    const card = roadmapItemToMissionCard(makeItem());
    expect(card.id).toBe('cockpit-mission-intake');
    expect(card.title).toBe('Cockpit mission intake');
    expect(card.summary).toBe('Build the smallest cockpit slice that reads roadmap docs.');
  });

  test('strips leading markdown hashes from title', () => {
    const card = roadmapItemToMissionCard(makeItem({ summaryMd: '## Big mission\nWith a body.' }));
    expect(card.title).toBe('Big mission');
  });

  test('uses slug as title when summaryMd is empty', () => {
    const card = roadmapItemToMissionCard(makeItem({ summaryMd: '' }));
    expect(card.title).toBe('cockpit-mission-intake');
  });

  test('empty summary when there is no second line', () => {
    const card = roadmapItemToMissionCard(makeItem({ summaryMd: 'Just a title' }));
    expect(card.title).toBe('Just a title');
    expect(card.summary).toBe('');
  });

  test('evidence = note texts, files = dependencies', () => {
    const card = roadmapItemToMissionCard(makeItem());
    expect(card.evidence).toEqual(['Reads CURRENT-WORK.md.', 'Hooks Fleet UI panel.']);
    expect(card.files).toEqual(['lib/cockpit-missions.ts', 'routes/cockpit.ts']);
  });

  test('source and sourceAnchor are stable', () => {
    const card = roadmapItemToMissionCard(makeItem());
    expect(card.source).toBe('roadmap_items');
    expect(card.sourceAnchor).toBe('cockpit-mission-intake');
  });

  test('status passes through unchanged (5-bucket RoadmapStatus)', () => {
    for (const s of ['now', 'backlog', 'parked', 'merge', 'done']) {
      expect(roadmapItemToMissionCard(makeItem({ status: s })).status).toBe(s);
    }
  });

  test('null/missing notes/dependencies fall back to empty arrays', () => {
    const card = roadmapItemToMissionCard(makeItem({ notes: null, dependencies: null }));
    expect(card.evidence).toEqual([]);
    expect(card.files).toEqual([]);
  });
});

describe('readMissions', () => {
  const items = [
    makeItem({ slug: 'a', status: 'now' }),
    makeItem({ slug: 'b', status: 'backlog' }),
    makeItem({ slug: 'c', status: 'parked' }),
    makeItem({ slug: 'd', status: 'merge' }),
    makeItem({ slug: 'e', status: 'done' }),
  ];

  test('returns one mission per item with no filter', () => {
    const intake = readMissions({ projectDir: '/p', roadmapItems: makeRoadmapItemsStub(items) });
    expect(intake.missions).toHaveLength(5);
    expect(intake.sources).toEqual(['roadmap_items']);
    expect(intake.missing).toEqual([]);
    expect(intake.sourcesWithNoCards).toEqual([]);
    expect(intake.projectDir).toBe('/p');
  });

  test('status filter narrows results', () => {
    const intake = readMissions({
      projectDir: '/p',
      roadmapItems: makeRoadmapItemsStub(items),
      status: ['now', 'merge'],
    });
    expect(intake.missions.map((m) => m.id).sort()).toEqual(['a', 'd']);
  });

  test('limit caps the count', () => {
    const intake = readMissions({
      projectDir: '/p',
      roadmapItems: makeRoadmapItemsStub(items),
      limit: 2,
    });
    expect(intake.missions).toHaveLength(2);
  });

  test('empty roadmap returns an empty intake (not an error)', () => {
    const intake = readMissions({ projectDir: '/p', roadmapItems: makeRoadmapItemsStub([]) });
    expect(intake.missions).toEqual([]);
    expect(intake.generatedAt).toBeGreaterThan(0);
  });
});

describe('GET /cockpit/missions route', () => {
  let app;
  const items = [
    makeItem({ slug: 'm-now-1', status: 'now' }),
    makeItem({ slug: 'm-backlog-1', status: 'backlog' }),
    makeItem({ slug: 'm-done-1', status: 'done' }),
  ];

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(cockpitPlugin, {
      deps: {
        repoRoot: '/test',
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
        roadmapItems: makeRoadmapItemsStub(items),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test('200 with mapped mission cards', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
    expect(body.intake.missions.map((m) => m.id).sort()).toEqual(['m-backlog-1', 'm-done-1', 'm-now-1']);
  });

  test('honors status filter + limit query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cockpit/missions?status=now,done&limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intake.missions.every((m) => m.status === 'now' || m.status === 'done')).toBe(true);
  });

  test('503 when roadmapItems dep is absent', async () => {
    const bare = Fastify({ logger: false });
    await bare.register(cockpitPlugin, {
      deps: {
        repoRoot: '/test',
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
      },
    });
    try {
      const res = await bare.inject({ method: 'GET', url: '/cockpit/missions' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toMatch(/roadmap_items/);
    } finally {
      await bare.close();
    }
  });
});

describe('GET /cockpit/missions/:id and POST /cockpit/missions/:id/plan', () => {
  let app;
  const items = [
    makeItem({ slug: 'mission-alpha', status: 'now' }),
    makeItem({ slug: 'mission-beta', status: 'backlog' }),
  ];

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(cockpitPlugin, {
      deps: {
        repoRoot: '/test',
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
        roadmapItems: makeRoadmapItemsStub(items),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test('GET /:id returns 200 with mission + live context', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions/mission-alpha' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mission.id).toBe('mission-alpha');
    expect(body.live).toBeDefined();
  });

  test('GET /:id returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  test('POST /:id/plan returns a proposal with mission scaffolding', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/mission-alpha/plan',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.missionId).toBe('mission-alpha');
  });
});
