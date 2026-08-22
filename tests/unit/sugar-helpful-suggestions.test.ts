import { describe, expect, jest, test } from '@jest/globals';
import {
  fetchHelpfulPeerSuggestions,
  HELPFUL_SUGGESTION_LIMIT,
  HELPFUL_SUGGESTION_TIMEOUT_MS,
  selectHelpfulPeerSuggestions,
  type HelpfulPeerSuggestion,
} from '../../cli/commands/sugar.js';

function hit(
  agentId: string,
  score: number,
  similarity = score,
  stage: HelpfulPeerSuggestion['stage'] = 'semantic',
): HelpfulPeerSuggestion {
  return { agentId, phrase: `capability for ${agentId}`, score, similarity, stage };
}

describe('pd begin helpful suggestions', () => {
  test('shows only high-confidence semantic peers, excluding the just-created agent', () => {
    const selected = selectHelpfulPeerSuggestions([
      hit('current', 1),
      hit('strong-a', 0.94),
      hit('weak', 0.79, 0.99),
      hit('strong-b', 0.88),
      hit('invalid', Number.NaN),
      hit('lexical-only', 1, 1, 'exact'),
      hit('bm25-only', 1, 1, 'bm25'),
    ], 'current');

    expect(selected.map((candidate) => candidate.agentId)).toEqual(['strong-a', 'strong-b']);
  });

  test('accepts an LLM-reviewed peer without reopening lexical-only stages', () => {
    expect(selectHelpfulPeerSuggestions([
      hit('bm25-only', 1, 1, 'bm25'),
      hit('reviewed', 0.91, 0.91, 'llm'),
    ], undefined)).toEqual([hit('reviewed', 0.91, 0.91, 'llm')]);
  });

  test('enforces the three-item arrival budget without adding a lexical fallback', () => {
    const selected = selectHelpfulPeerSuggestions([
      hit('a', 0.99),
      hit('b', 0.98),
      hit('c', 0.97),
      hit('d', 0.96),
    ], undefined);

    expect(selected.map((candidate) => candidate.agentId)).toEqual(['a', 'b', 'c']);
    expect(selected).toHaveLength(3);
  });

  test('sends one bounded hybrid query with the 75ms fail-open deadline', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hits: [hit('current', 1), hit('peer', 0.95)] }),
    })) as any;

    await expect(fetchHelpfulPeerSuggestions('repair the hooks', 'current', fetcher))
      .resolves.toEqual([hit('peer', 0.95)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain(`/whois?`);
    expect(fetcher.mock.calls[0][0]).toContain(`kind=agent`);
    expect(fetcher.mock.calls[0][0]).toContain(`limit=${HELPFUL_SUGGESTION_LIMIT + 1}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      timeout: HELPFUL_SUGGESTION_TIMEOUT_MS,
      retry: false,
      signal: expect.any(AbortSignal),
    });
  });

  test('contains lookup failures without delaying or invalidating begin', async () => {
    const fetcher = jest.fn(async () => { throw new Error('cold dependency'); }) as any;
    await expect(fetchHelpfulPeerSuggestions('repair the hooks', undefined, fetcher)).resolves.toEqual([]);
  });

  test('aborts and returns at the total deadline even when the transport never settles', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = jest.fn((_path: string, options: { signal?: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => {});
      }) as any;

      const result = fetchHelpfulPeerSuggestions('repair the hooks', undefined, fetcher);
      await jest.advanceTimersByTimeAsync(HELPFUL_SUGGESTION_TIMEOUT_MS);

      await expect(result).resolves.toEqual([]);
      expect(signal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
