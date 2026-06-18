import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

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

const { handleRoadmap } = await import('../../cli/commands/roadmap.js');

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
