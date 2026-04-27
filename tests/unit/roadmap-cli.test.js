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

describe('pd roadmap', () => {
  test('fetches the Cartographer endpoint for the selected repo root', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    await handleRoadmap({ dir: '/Users/test/port-daddy', json: true });

    expect(pdFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/cartographer/roadmap-progress?root=%2FUsers%2Ftest%2Fport-daddy',
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"nextCuts"'));
  });

  test('quiet output is section-prefixed for agent prompts', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    await handleRoadmap({ dir: '/Users/test/port-daddy', quiet: true });

    expect(console.log).toHaveBeenCalledWith([
      'next:cartographer-roadmap-progress-screen',
      'now:cartographer-roadmap-progress-screen',
      'feedback:coordination-ticker-as-high-signal-feed',
    ].join('\n'));
  });
});
