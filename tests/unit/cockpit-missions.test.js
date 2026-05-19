import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMissions } from '../../lib/cockpit-missions.js';
import { cockpitPlugin } from '../../routes/cockpit.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-missions-'));
  mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
  mkdirSync(join(root, '.cartographer'), { recursive: true });

  writeFileSync(
    join(root, 'docs', 'recovery', 'CURRENT-WORK.md'),
    [
      '# Current Work',
      '',
      '## In Flight',
      '',
      '### Cockpit mission intake (UNCOMMITTED)',
      '',
      'Build the smallest cockpit slice that reads roadmap docs.',
      '',
      '- adds `lib/cockpit-missions.ts`',
      '- adds `routes/cockpit.ts`',
      '- updates [features.manifest.json](features.manifest.json)',
      '',
      '### Tube prose loop (IN-FLIGHT)',
      '',
      'Tube becomes a single-command crank-handle conversation.',
      '',
      '- touches `lib/tube.ts`',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(root, 'docs', 'recovery', 'UNIFIED-ROADMAP.md'),
    [
      '# Unified Roadmap',
      '',
      '## Track 1: Cost And Observability Foundation (CLOSED)',
      '',
      'Closed.',
      '',
      '- `lib/counters.ts`',
      '',
      '## Track 5: Unblock Phase 1 By Landing graph_edges',
      '',
      'Open.',
      '',
      '- `lib/symbol-index.ts`',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(root, '.cartographer', 'status.md'),
    [
      '# Cartographer Status',
      '',
      '## Top 3 Blocked or Drifting',
      '',
      '### Phase 1 — Unified Edge Table (1A)',
      '',
      'Three modules sit on disk waiting on a migration.',
      '',
      '- `lib/symbol-index.ts`',
      '- `lib/merge-queue.ts`',
      '',
      '### Phase 4A — Bun binary (STALLED — 5 days since last commit)',
      '',
      'No commits since Apr 4.',
      '',
      '- build scripts dormant',
      '',
    ].join('\n'),
  );

  return root;
}

describe('readMissions', () => {
  let fixtureRoot;

  beforeAll(() => {
    fixtureRoot = makeFixture();
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('parses status tags from heading suffixes', () => {
    const intake = readMissions({ projectDir: fixtureRoot });
    const byId = Object.fromEntries(intake.missions.map((m) => [m.id, m]));
    expect(byId['cockpit-mission-intake'].status).toBe('uncommitted');
    expect(byId['tube-prose-loop'].status).toBe('in-flight');
    expect(byId['track-1-cost-and-observability-foundation'].status).toBe('closed');
    expect(byId['phase-4a-bun-binary'].status).toBe('stalled');
  });

  test('infers blocked status from parent H2 in cartographer status', () => {
    const intake = readMissions({ projectDir: fixtureRoot });
    const phase1 = intake.missions.find((m) => m.id === 'phase-1-unified-edge-table-1a');
    // Suffix `(1A)` is a code reference, not a status tag, so it stays in the slug.
    expect(phase1).toBeDefined();
    expect(phase1.status).toBe('blocked');
    expect(phase1.source).toBe('.cartographer/status.md');
  });

  test('extracts files from backticks and markdown links', () => {
    const intake = readMissions({ projectDir: fixtureRoot });
    const cockpit = intake.missions.find((m) => m.id === 'cockpit-mission-intake');
    expect(cockpit.files).toEqual(
      expect.arrayContaining(['lib/cockpit-missions.ts', 'routes/cockpit.ts', 'features.manifest.json']),
    );
  });

  test('summary captures the first paragraph and evidence captures bullets', () => {
    const intake = readMissions({ projectDir: fixtureRoot });
    const cockpit = intake.missions.find((m) => m.id === 'cockpit-mission-intake');
    expect(cockpit.summary).toMatch(/smallest cockpit slice/);
    expect(cockpit.evidence.length).toBeGreaterThanOrEqual(2);
  });

  test('first source wins on duplicate slugs', () => {
    const intake = readMissions({ projectDir: fixtureRoot });
    const ids = intake.missions.map((m) => m.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  test('status filter narrows the result set', () => {
    const intake = readMissions({ projectDir: fixtureRoot, status: ['blocked'] });
    expect(intake.missions.length).toBeGreaterThan(0);
    for (const m of intake.missions) expect(m.status).toBe('blocked');
  });

  test('limit truncates after status filter', () => {
    const intake = readMissions({ projectDir: fixtureRoot, limit: 2 });
    expect(intake.missions.length).toBeLessThanOrEqual(2);
  });

  test('missing source files surface in `missing`', () => {
    const empty = mkdtempSync(join(tmpdir(), 'cockpit-empty-'));
    try {
      const intake = readMissions({ projectDir: empty });
      expect(intake.missing.length).toBe(3);
      expect(intake.sourcesWithNoCards).toEqual([]);
      expect(intake.missions).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('present-but-empty source files surface in `sourcesWithNoCards`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-no-cards-'));
    try {
      // Create the three default sources with content that produces zero
      // mission cards (no headings at the configured level / no status tags).
      mkdirSync(join(dir, 'docs', 'recovery'), { recursive: true });
      mkdirSync(join(dir, '.cartographer'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'recovery', 'CURRENT-WORK.md'), '# Work\n\nNo tagged sections.\n');
      writeFileSync(join(dir, 'docs', 'recovery', 'UNIFIED-ROADMAP.md'), '# Roadmap\n');
      writeFileSync(join(dir, '.cartographer', 'status.md'), '# Status\n\nNothing yet.\n');

      const intake = readMissions({ projectDir: dir });
      expect(intake.missing).toEqual([]);
      expect(intake.sourcesWithNoCards.sort()).toEqual([
        '.cartographer/status.md',
        'docs/recovery/CURRENT-WORK.md',
        'docs/recovery/UNIFIED-ROADMAP.md',
      ]);
      expect(intake.missions).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /cockpit/missions route', () => {
  let app;
  let fixtureRoot;

  beforeAll(async () => {
    fixtureRoot = makeFixture();
    app = Fastify({ logger: false });
    await app.register(cockpitPlugin, {
      deps: {
        repoRoot: fixtureRoot,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('returns the intake using daemon repoRoot when projectDir omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.intake.projectDir).toBe(fixtureRoot);
    expect(Array.isArray(body.intake.missions)).toBe(true);
    expect(body.count).toBe(body.intake.missions.length);
  });

  test('honors status filter and limit query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cockpit/missions?status=blocked,closed&limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intake.missions.every((m) => m.status === 'blocked' || m.status === 'closed')).toBe(
      true,
    );
    expect(body.intake.missions.length).toBeLessThanOrEqual(5);
  });

  test('rejects relative projectDir', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cockpit/missions?projectDir=relative/path',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/absolute/);
  });

  test('returns 400 when projectDir is missing and no repoRoot is configured', async () => {
    const bare = Fastify({ logger: false });
    await bare.register(cockpitPlugin, {
      deps: {
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
      },
    });
    try {
      const res = await bare.inject({ method: 'GET', url: '/cockpit/missions' });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/projectDir required/);
    } finally {
      await bare.close();
    }
  });
});

describe('GET /cockpit/missions/:id and POST /cockpit/missions/:id/plan', () => {
  let app;
  let fixtureRoot;

  const liveDeps = {
    sessions: {
      list: () => [
        { sessionId: 'sess-A', purpose: 'cockpit-mission-intake follow-up', project: '/x' },
        { sessionId: 'sess-B', purpose: 'editing lib/cockpit-missions.ts', project: '/x' },
        { sessionId: 'sess-C', purpose: 'unrelated work', project: '/x' },
      ],
      listAllActiveClaims: () => ({
        claims: [
          { sessionId: 'sess-B', filePath: 'lib/cockpit-missions.ts' },
          { sessionId: 'sess-C', filePath: 'lib/elsewhere.ts' },
        ],
      }),
    },
    resurrection: {
      pending: () => [
        { id: 'r-1', purpose: 'cockpit-mission-intake', note: 'died mid-edit' },
        { id: 'r-2', purpose: 'unrelated', note: 'nothing to see' },
      ],
    },
    feedback: {
      list: () => [
        { feedbackId: 'fb-1', slug: 'cockpit-mission-intake', summary: 'panel needs limit chip', status: 'open' },
        { feedbackId: 'fb-2', slug: 'unrelated-thing', summary: 'something else', status: 'open' },
      ],
    },
  };

  beforeAll(async () => {
    fixtureRoot = makeFixture();
    app = Fastify({ logger: false });
    await app.register(cockpitPlugin, {
      deps: {
        repoRoot: fixtureRoot,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
        ...liveDeps,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('detail returns 404 for unknown mission', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions/no-such-thing' });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });

  test('detail returns mission + live cross-references', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions/cockpit-mission-intake' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mission.id).toBe('cockpit-mission-intake');
    expect(body.live.sessions.length).toBeGreaterThanOrEqual(2);
    expect(body.live.claims.length).toBe(1);
    expect(body.live.claims[0].filePath).toBe('lib/cockpit-missions.ts');
    expect(body.live.salvage.length).toBe(1);
    expect(body.live.dogfood.length).toBe(1);
    expect(body.live.dogfood[0].slug).toBe('cockpit-mission-intake');
  });

  test('plan returns proposal with sensible defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/cockpit-mission-intake/plan',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.missionId).toBe('cockpit-mission-intake');
    expect(body.proposal.harbor).toBe('cockpit');
    expect(body.proposal.backend).toBe('codex');
    expect(body.proposal.modelTier).toBe('mid');
    expect(body.proposal.budgetUsd).toBe(1.0);
    expect(body.proposal.goal).toMatch(/Cockpit mission intake/);
    expect(body.proposal.files.length).toBeGreaterThan(0);
    expect(body.proposal.context).toMatch(/Status: uncommitted/);
  });

  test('plan honors valid overrides', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/cockpit-mission-intake/plan',
      payload: { backend: 'claude-cli', modelTier: 'high', budgetUsd: 2.5, goal: 'custom goal' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proposal.backend).toBe('claude-cli');
    expect(body.proposal.modelTier).toBe('high');
    expect(body.proposal.budgetUsd).toBe(2.5);
    expect(body.proposal.goal).toBe('custom goal');
  });

  test('plan rejects invalid backend', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/cockpit-mission-intake/plan',
      payload: { backend: 'made-up-backend' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/backend must be/);
  });

  test('plan rejects invalid tier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/cockpit-mission-intake/plan',
      payload: { modelTier: 'medium' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/modelTier must be/);
  });

  test('plan rejects non-positive budget', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/cockpit-mission-intake/plan',
      payload: { budgetUsd: -1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/budgetUsd/);
  });

  test('detail/plan tolerate missing live deps', async () => {
    const bare = Fastify({ logger: false });
    await bare.register(cockpitPlugin, {
      deps: {
        repoRoot: fixtureRoot,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
      },
    });
    try {
      const detail = await bare.inject({ method: 'GET', url: '/cockpit/missions/cockpit-mission-intake' });
      expect(detail.statusCode).toBe(200);
      const detailBody = detail.json();
      expect(detailBody.live.sessions).toEqual([]);
      expect(detailBody.live.claims).toEqual([]);
      expect(detailBody.live.salvage).toEqual([]);
      expect(detailBody.live.dogfood).toEqual([]);

      const plan = await bare.inject({
        method: 'POST',
        url: '/cockpit/missions/cockpit-mission-intake/plan',
        payload: {},
      });
      expect(plan.statusCode).toBe(200);
      expect(plan.json().proposal.missionId).toBe('cockpit-mission-intake');
    } finally {
      await bare.close();
    }
  });
});

describe('Cockpit mission-state mutation routes', () => {
  let app;
  let fixtureRoot;
  let stateCalls;

  beforeAll(async () => {
    fixtureRoot = makeFixture();
    stateCalls = [];
    const stateStub = {
      get: () => null,
      listForProject: () => new Map(),
      set: () => null,
      dismiss: (projectDir, missionId, notes) => {
        stateCalls.push({ op: 'dismiss', projectDir, missionId, notes });
        return {
          missionId,
          projectDir,
          dismissedAt: 1700000000000,
          snoozedUntil: null,
          plannedSortieId: null,
          notes,
          updatedAt: 1700000000000,
        };
      },
      snooze: (projectDir, missionId, until, notes) => {
        stateCalls.push({ op: 'snooze', projectDir, missionId, until, notes });
        return {
          missionId,
          projectDir,
          dismissedAt: null,
          snoozedUntil: until,
          plannedSortieId: null,
          notes,
          updatedAt: 1700000000000,
        };
      },
      clear: (projectDir, missionId, field) => {
        stateCalls.push({ op: 'clear', projectDir, missionId, field });
        return field === 'all' ? null : { missionId, projectDir, dismissedAt: null, snoozedUntil: null, plannedSortieId: null, notes: null, updatedAt: 1700000000000 };
      },
    };
    app = Fastify({ logger: false });
    await app.register(cockpitPlugin, {
      deps: {
        repoRoot: fixtureRoot,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
        cockpitMissionState: stateStub,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('POST /dismiss returns 200 with state body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/m-1/dismiss',
      payload: { notes: 'not now' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.state.missionId).toBe('m-1');
    expect(body.state.dismissedAt).toBeGreaterThan(0);
    expect(stateCalls.some((c) => c.op === 'dismiss' && c.missionId === 'm-1' && c.notes === 'not now')).toBe(true);
  });

  test('POST /snooze accepts epoch ms', async () => {
    const until = Date.now() + 86400000;
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/m-2/snooze',
      payload: { until, notes: 'tomorrow' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.snoozedUntil).toBe(until);
  });

  test('POST /snooze accepts ISO 8601', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/m-3/snooze',
      payload: { until: future },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.snoozedUntil).toBe(Date.parse(future));
  });

  test('POST /snooze rejects past timestamps', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cockpit/missions/m-4/snooze',
      payload: { until: Date.now() - 60000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/future/i);
  });

  test('DELETE /state with field=all returns null state', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/cockpit/missions/m-5/state?field=all',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBeNull();
  });

  test('DELETE /state rejects unknown field', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/cockpit/missions/m-6/state?field=bogus',
    });
    expect(res.statusCode).toBe(400);
  });

  test('mutation routes return 503 when cockpitMissionState dep is absent', async () => {
    const bare = Fastify({ logger: false });
    await bare.register(cockpitPlugin, {
      deps: {
        repoRoot: fixtureRoot,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
      },
    });
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/cockpit/missions/m-x/dismiss',
        payload: {},
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toMatch(/not wired/);
    } finally {
      await bare.close();
    }
  });

  test('GET /cockpit/missions merges state into each card when module is wired', async () => {
    const res = await app.inject({ method: 'GET', url: '/cockpit/missions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    for (const m of body.intake.missions) {
      expect(m).toHaveProperty('state');
      expect(m.state === null || typeof m.state === 'object').toBe(true);
    }
  });
});
