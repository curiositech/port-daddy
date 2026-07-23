import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pdFetch = jest.fn();
const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});
let logSpy;
let errorSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const { handleRoadmap, resolveRoadmapHarbor } = await import('../../cli/commands/roadmap.js');

const fixture = {
  generatedAt: 1,
  sources: {
    roadmapPath: '/repo/docs/ROADMAP.md',
    ideasTrovePath: '/repo/docs/recovery/IDEAS-TROVE.md',
    dogfoodFeedbackPath: '/repo/docs/recovery/DOGFOOD-FEEDBACK.md',
    currentWorkPath: '/repo/docs/recovery/CURRENT-WORK.md',
    cartographerStatusPath: '/repo/.cartographer/status.md',
  },
  freshness: { latestUpdateMs: 1, hoursSinceLastUpdate: 0.2 },
  nextCuts: [{ slug: 'cartographer-roadmap-progress-screen', summary: 'Surface roadmap state.' }],
  ideasNow: [{ slug: 'cartographer-roadmap-progress-screen', status: 'now', surface: 'Fleet UI', hook: 'one glance' }],
  liveFeedback: [{
    slug: 'cartographer-live-body-salvage-friction',
    status: 'open',
    surface: 'CLI',
    hook: 'operator asks whether Cartographer can listen',
    feedbackId: 'fb-1',
    severity: 'high',
    droppedBy: 'agent-dfdc92f3',
    provenance: 'tuple',
  }],
  feedbackSummary: {
    total: 1,
    open: 1,
    harvested: 0,
    bySeverity: { low: 0, medium: 0, high: 1, critical: 0 },
    bySurface: { CLI: 1 },
  },
  dogfoodFeedback: [{ slug: 'coordination-ticker-as-high-signal-feed', status: 'backlog', surface: 'Fleet UI', hook: null }],
  currentWorkExcerpt: '# Current\nActive slice.',
  cartographerStatusExcerpt: '# Status\nNominal.',
  warnings: [],
};

beforeEach(() => {
  pdFetch.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
});

afterAll(() => {
  exit.mockRestore();
});

// ADR-0033: the roadmap_items SQL table is the source of truth. `pd roadmap`
// reads from GET /roadmap/items, NOT by re-parsing markdown via
// /cartographer/roadmap-progress (that was the markdown-as-DB bug).
const itemsFixture = {
  success: true,
  count: 2,
  items: [
    {
      id: 'r1',
      slug: 'cartographer-roadmap-progress-screen',
      summaryMd: 'Surface roadmap state in one glance.',
      status: 'now',
      promotedFromFeedbackId: null,
      promotedByAgentId: 'agent-cartographer',
      promotedAt: null,
      lastTouchedAt: 1,
      dependencies: [],
      notes: [],
      harbor: 'port-daddy:fleet',
    },
    {
      id: 'r2',
      slug: 'daemon-introspection-api',
      summaryMd: 'Unified daemon health view.',
      status: 'now',
      promotedFromFeedbackId: null,
      promotedByAgentId: null,
      promotedAt: null,
      lastTouchedAt: 2,
      dependencies: [],
      notes: [],
      harbor: 'port-daddy:fleet',
    },
  ],
};

describe('pd roadmap', () => {
  test('lists from the roadmap_items SQL table, not the markdown piles', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => itemsFixture,
    });

    await handleRoadmap({ json: true });

    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('/roadmap/items');
    expect(url).not.toContain('/cartographer/roadmap-progress');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cartographer-roadmap-progress-screen'));
  });

  test('quiet output prints one slug per line from the table', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => itemsFixture,
    });

    await handleRoadmap({ quiet: true });

    expect(console.log).toHaveBeenCalledWith([
      'cartographer-roadmap-progress-screen',
      'daemon-introspection-api',
    ].join('\n'));
  });

  test('import-markdown backfills the table from the curated piles', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        candidates: [{ slug: 'a', summaryMd: 'A', status: 'now', source: 'next-cut' }],
        inserted: ['a'],
        updated: [],
        parsed: { nextCuts: 1, ideasNow: 0, dogfood: 0 },
        missingFiles: [],
        dryRun: false,
      }),
    });

    await handleRoadmap(['import-markdown'], { dir: '/Users/test/port-daddy', json: true });

    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('/roadmap/import-markdown');
    const opts = pdFetch.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ rootDir: '/Users/test/port-daddy' });
  });

  test('import-markdown resolves harbor via resolveRoadmapHarbor instead of falling back to the daemon default', async () => {
    // Regression test for the second root cause behind the Planner pane's
    // "harbor split": import-markdown used to send NO harbor when unflagged,
    // so the daemon fell back to its own DEFAULT_HARBOR ('fleet') while every
    // other write (pd roadmap upsert/add) resolved the real project harbor.
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        candidates: [],
        inserted: [],
        updated: [],
        parsed: { nextCuts: 0, ideasNow: 0, dogfood: 0 },
        missingFiles: [],
        dryRun: false,
      }),
    });

    await handleRoadmap(['import-markdown'], { dir: '/Users/test/port-daddy', harbor: 'explicit-harbor', json: true });

    const opts = pdFetch.mock.calls[0][1];
    expect(JSON.parse(opts.body)).toMatchObject({ harbor: 'explicit-harbor' });
  });

  test('import-markdown honors $PD_HARBOR the same way pd roadmap upsert does', async () => {
    const previousHarbor = process.env.PD_HARBOR;
    process.env.PD_HARBOR = 'env-resolved-harbor';
    try {
      pdFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          candidates: [],
          inserted: [],
          updated: [],
          parsed: { nextCuts: 0, ideasNow: 0, dogfood: 0 },
          missingFiles: [],
          dryRun: false,
        }),
      });

      await handleRoadmap(['import-markdown'], { dir: '/Users/test/port-daddy', json: true });

      const opts = pdFetch.mock.calls[0][1];
      expect(JSON.parse(opts.body)).toMatchObject({ harbor: 'env-resolved-harbor' });
    } finally {
      if (previousHarbor === undefined) delete process.env.PD_HARBOR;
      else process.env.PD_HARBOR = previousHarbor;
    }
  });

  test('upsert writes a roadmap item receipt into the table', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        item: {
          id: 'r3',
          slug: 'swarm-coordination',
          summaryMd: 'Make swarm coordination governed and enforceable.',
          status: 'now',
          promotedFromFeedbackId: null,
          promotedByAgentId: 'agent-1',
          promotedAt: 1,
          lastTouchedAt: 2,
          dependencies: [],
          notes: [],
          harbor: 'fleet',
        },
      }),
    });

    await handleRoadmap(['upsert', 'swarm-coordination'], {
      summary: 'Make swarm coordination governed and enforceable.',
      status: 'now',
      as: 'agent-1',
      note: 'phase 0 implementation',
      json: true,
    });

    expect(pdFetch).toHaveBeenCalledWith(
      '/roadmap/items',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      slug: 'swarm-coordination',
      summaryMd: 'Make swarm coordination governed and enforceable.',
      status: 'now',
      promotedByAgentId: 'agent-1',
    });
    expect(body.notes[0]).toMatchObject({ by: 'agent-1', text: 'phase 0 implementation' });
  });

  test('harbor resolution falls back to cwd basename outside a git repository', () => {
    const previousCwd = process.cwd();
    const previousHarbor = process.env.PD_HARBOR;
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-harbor-'));
    const projectDir = join(root, 'standalone-project');
    mkdirSync(projectDir);
    delete process.env.PD_HARBOR;

    try {
      process.chdir(projectDir);
      expect(resolveRoadmapHarbor({})).toBe('standalone-project');
    } finally {
      process.chdir(previousCwd);
      if (previousHarbor === undefined) {
        delete process.env.PD_HARBOR;
      } else {
        process.env.PD_HARBOR = previousHarbor;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('harbor resolution uses the canonical project name inside a linked worktree', () => {
    const previousCwd = process.cwd();
    const previousHarbor = process.env.PD_HARBOR;
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-linked-harbor-'));
    const projectDir = join(root, 'canonical-harbor');
    const linkedWorktree = join(root, 'linked-feature');
    mkdirSync(projectDir);
    delete process.env.PD_HARBOR;

    try {
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', [
        '-c', 'user.name=Port Daddy Test',
        '-c', 'user.email=port-daddy-test@example.invalid',
        'commit', '--allow-empty', '-m', 'initial',
      ], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'feature-roadmap', linkedWorktree], {
        cwd: projectDir,
        stdio: 'ignore',
      });

      process.chdir(linkedWorktree);
      expect(resolveRoadmapHarbor({})).toBe('canonical-harbor');
    } finally {
      process.chdir(previousCwd);
      if (previousHarbor === undefined) {
        delete process.env.PD_HARBOR;
      } else {
        process.env.PD_HARBOR = previousHarbor;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('touch preserves the existing summary and appends a roadmap receipt note', async () => {
    pdFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          item: {
            id: 'r4',
            slug: 'swarm-coordination',
            summaryMd: 'Existing summary.',
            status: 'now',
            promotedFromFeedbackId: null,
            promotedByAgentId: 'agent-old',
            promotedAt: 1,
            lastTouchedAt: 2,
            dependencies: ['parley'],
            notes: [{ at: 1, by: 'agent-old', text: 'old' }],
            harbor: 'fleet',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          item: {
            id: 'r4',
            slug: 'swarm-coordination',
            summaryMd: 'Existing summary.',
            status: 'now',
            promotedFromFeedbackId: null,
            promotedByAgentId: 'agent-1',
            promotedAt: 1,
            lastTouchedAt: 3,
            dependencies: ['parley'],
            notes: [],
            harbor: 'fleet',
          },
        }),
      });

    await handleRoadmap(['touch', 'swarm-coordination'], {
      as: 'agent-1',
      note: 'guard receipt',
      json: true,
    });

    expect(pdFetch.mock.calls[0][0]).toBe('/roadmap/items/swarm-coordination');
    expect(pdFetch.mock.calls[1][0]).toBe('/roadmap/items');
    const body = JSON.parse(pdFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      slug: 'swarm-coordination',
      summaryMd: 'Existing summary.',
      status: 'now',
      dependencies: ['parley'],
      promotedByAgentId: 'agent-1',
    });
    expect(body.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ by: 'agent-old', text: 'old' }),
      expect.objectContaining({ by: 'agent-1', text: 'guard receipt' }),
    ]));
  });

  test('ack harvests live feedback from the roadmap surface', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, entry: { feedbackId: 'fb-1', status: 'harvested' } }),
    });

    await handleRoadmap(['ack', 'fb-1'], { as: 'cartographer', into: 'cartographer-live-body-salvage-friction' });

    expect(pdFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/feedback/fb-1/harvest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          harvestedBy: 'cartographer',
          intoSlug: 'cartographer-live-body-salvage-friction',
        }),
      }),
    );
  });
});
