import { describe, expect, jest, test } from '@jest/globals';
import { printRoadmapSuggestions } from '../../cli/commands/sugar.js';

/**
 * printRoadmapSuggestions is a best-effort, never-throws convenience that
 * prints ranked roadmap candidates on the rent-gate's generic rejection
 * (cli/commands/sugar.ts, GET /roadmap/search). Its own docblock states the
 * contract this suite pins: a daemon hiccup or un-indexed roadmap degrades
 * silently, never propagating an error into the caller's rent-gate flow.
 * ui.note's actual terminal output is not asserted here — matching the
 * house convention (see sugar-helpful-suggestions.test.ts) of testing the
 * fetch/decide logic, not the UI side effect.
 */
describe('printRoadmapSuggestions', () => {
  test('queries /roadmap/search with the purpose and an optional harbor', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    })) as any;

    await printRoadmapSuggestions('fix the login bug', 'port-daddy', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0][0], 'http://x');
    expect(url.pathname).toBe('/roadmap/search');
    expect(url.searchParams.get('q')).toBe('fix the login bug');
    expect(url.searchParams.get('harbor')).toBe('port-daddy');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  test('omits the harbor param when none is given', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    })) as any;

    await printRoadmapSuggestions('fix the login bug', undefined, fetcher);

    const url = new URL(fetcher.mock.calls[0][0], 'http://x');
    expect(url.searchParams.has('harbor')).toBe(false);
  });

  test('never throws when the daemon responds non-ok', async () => {
    const fetcher = jest.fn(async () => ({ ok: false, status: 503 })) as any;
    await expect(printRoadmapSuggestions('fix the login bug', undefined, fetcher)).resolves.toBeUndefined();
  });

  test('never throws on malformed JSON', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    })) as any;
    await expect(printRoadmapSuggestions('fix the login bug', undefined, fetcher)).resolves.toBeUndefined();
  });

  test('never throws when the fetch itself rejects (daemon unreachable)', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    await expect(printRoadmapSuggestions('fix the login bug', undefined, fetcher)).resolves.toBeUndefined();
  });

  test('resolves cleanly when the search index returns zero hits', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], degraded: 'search index unavailable' }),
    })) as any;
    await expect(printRoadmapSuggestions('fix the login bug', undefined, fetcher)).resolves.toBeUndefined();
  });
});
