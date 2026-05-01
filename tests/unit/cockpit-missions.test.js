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
      expect(intake.missions).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
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
