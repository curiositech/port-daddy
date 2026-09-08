/**
 * Intent Matcher — semantic intent → salvage/roadmap ranking.
 *
 * These tests inject a DETERMINISTIC fake embedder (no ONNX / no model download)
 * so the cosine ranking math is exercised offline — mirroring how the
 * semantic-resolver tests inject an embedder. The fake maps each text to a
 * pinned unit vector, so cosine is 1.0 for same-axis pairs and 0.0 for
 * orthogonal ones. The module under test contains no topic logic of its own:
 * it only calls `embedder.embed()` + `cosineSimilarity()`, so the ranking under
 * test is pure cosine, never lexical/substring.
 */

import { describe, test, expect } from '@jest/globals';
import {
  createIntentMatcher,
  type IntentEmbedder,
  type Candidate,
} from '../../lib/intent-matcher.js';

// A tiny 3-axis "topic space": MERGE, AUTH, CSS. Orthogonal unit vectors →
// cosine is exactly 1.0 within an axis and 0.0 across axes.
const MERGE = [1, 0, 0];
const AUTH = [0, 1, 0];
const CSS = [0, 0, 1];
const NEUTRAL = [0, 0, 0]; // orthogonal-ish; cosine 0 against everything

/**
 * Deterministic fake embedder driven by an explicit text → vector map. Any text
 * not pinned falls back to NEUTRAL. This proves ranking is embedding-driven: the
 * test controls the vectors directly, independent of the candidate strings.
 */
function makeFakeEmbedder(pins: Map<string, number[]>): IntentEmbedder & { calls: number } {
  const embedder = {
    calls: 0,
    async embed(texts: string[]): Promise<number[][]> {
      this.calls += texts.length;
      return texts.map((t) => pins.get(t) ?? NEUTRAL);
    },
  };
  return embedder;
}

describe('Intent Matcher — semantic intent → salvage/roadmap ranking', () => {
  test('purpose near one salvage + one roadmap candidate ranks those #1, unrelated last', async () => {
    const purpose = 'fix the merge queue dedup';
    const salvage: Candidate[] = [
      { id: 'agent-auth', text: 'Implement OAuth login flow' },
      { id: 'agent-merge', text: 'Deduplicate entries in the merge queue', title: 'Merge dedup agent' },
      { id: 'agent-css', text: 'Write CSS design system tokens' },
    ];
    const roadmap: Candidate[] = [
      { id: 'css-tokens', text: 'CSS design system tokens' },
      { id: 'merge-queue-dedup', text: 'Merge queue dedup: collapse duplicate PRs' },
      { id: 'oauth-login', text: 'OAuth login for accounts' },
    ];

    const pins = new Map<string, number[]>([
      [purpose, MERGE],
      ['Implement OAuth login flow', AUTH],
      ['Deduplicate entries in the merge queue', MERGE],
      ['Write CSS design system tokens', CSS],
      ['CSS design system tokens', CSS],
      ['Merge queue dedup: collapse duplicate PRs', MERGE],
      ['OAuth login for accounts', AUTH],
    ]);

    const matcher = createIntentMatcher({ embedder: makeFakeEmbedder(pins) });
    const result = await matcher.match(purpose, { salvage, roadmap });

    // #1 in each set is the same-axis (MERGE) candidate at cosine 1.0.
    expect(result.salvage[0]?.id).toBe('agent-merge');
    expect(result.salvage[0]?.score).toBeCloseTo(1, 5);
    expect(result.salvage[0]?.title).toBe('Merge dedup agent');
    expect(result.roadmap[0]?.id).toBe('merge-queue-dedup');
    expect(result.roadmap[0]?.score).toBeCloseTo(1, 5);

    // The unrelated (orthogonal) candidates sink to cosine 0 and rank last.
    expect(result.salvage[result.salvage.length - 1]?.score).toBeCloseTo(0, 5);
    expect(result.roadmap[result.roadmap.length - 1]?.score).toBeCloseTo(0, 5);

    // `why` explains the match with the cosine score, not a matched keyword.
    expect(result.roadmap[0]?.why).toContain('cosine 1.00');
    // Default title falls back to id when none supplied.
    expect(result.roadmap[0]?.title).toBe('merge-queue-dedup');
  });

  test('ranking is embedding-driven, NOT substring: zero shared characters can still match', async () => {
    const purpose = 'zap the rug'; // shares no characters with 'qqqbody'
    const salvage: Candidate[] = [{ id: 'qqq', text: 'qqq body' }];
    const roadmap: Candidate[] = [{ id: 'auth-thing', text: 'oauth login flow' }];

    // Pin the purpose and the qqq candidate to the SAME vector despite sharing
    // no characters; the auth candidate to an orthogonal one.
    const pins = new Map<string, number[]>([
      [purpose, MERGE],
      ['qqq body', MERGE],
      ['oauth login flow', AUTH],
    ]);
    const matcher = createIntentMatcher({ embedder: makeFakeEmbedder(pins) });
    const result = await matcher.match(purpose, { salvage, roadmap });

    expect(result.salvage[0]?.id).toBe('qqq');
    expect(result.salvage[0]?.score).toBeCloseTo(1, 5);
    expect(result.roadmap[0]?.score).toBeCloseTo(0, 5);
    // Sanity: purpose and winner share literally no characters.
    const purposeChars = new Set(purpose.replace(/ /g, ''));
    expect([...purposeChars].some((c) => 'qqqbody'.includes(c))).toBe(false);
  });

  test('topN cap: returns at most topN per set (default 3)', async () => {
    const salvage: Candidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
      text: `merge variant ${i}`,
    }));
    const roadmap: Candidate[] = Array.from({ length: 4 }, (_, i) => ({
      id: `r-${i}`,
      text: `merge item ${i}`,
    }));

    const pins = new Map<string, number[]>();
    pins.set('merge queue dedup', MERGE);
    for (const c of [...salvage, ...roadmap]) pins.set(c.text, MERGE);

    const matcher = createIntentMatcher({ embedder: makeFakeEmbedder(pins) });

    const capped = await matcher.match('merge queue dedup', { salvage, roadmap }, { topN: 2 });
    expect(capped.salvage).toHaveLength(2);
    expect(capped.roadmap).toHaveLength(2);

    const dflt = await matcher.match('merge queue dedup', { salvage, roadmap });
    expect(dflt.salvage).toHaveLength(3); // default cap = 3
    expect(dflt.roadmap).toHaveLength(3);
  });

  test('stable ties: equal cosine scores break deterministically on input order', async () => {
    // Two candidates tie at cosine 1.0 — original input order must be preserved,
    // identically across repeated calls.
    const roadmap: Candidate[] = [
      { id: 'merge-a', text: 'merge queue dedup a' },
      { id: 'merge-b', text: 'merge queue dedup b' },
    ];
    const pins = new Map<string, number[]>([
      ['merge queue dedup', MERGE],
      ['merge queue dedup a', MERGE],
      ['merge queue dedup b', MERGE],
    ]);
    const matcher = createIntentMatcher({ embedder: makeFakeEmbedder(pins) });

    const first = await matcher.match('merge queue dedup', { salvage: [], roadmap });
    const second = await matcher.match('merge queue dedup', { salvage: [], roadmap });

    expect(first.roadmap.map((r) => r.id)).toEqual(['merge-a', 'merge-b']);
    expect(second.roadmap.map((r) => r.id)).toEqual(first.roadmap.map((r) => r.id));
  });

  test('empty sets → empty arrays, no throw, and the embedder is never called', async () => {
    const embedder = makeFakeEmbedder(new Map());
    const matcher = createIntentMatcher({ embedder });

    const result = await matcher.match('anything at all', { salvage: [], roadmap: [] });

    expect(result.salvage).toEqual([]);
    expect(result.roadmap).toEqual([]);
    expect(embedder.calls).toBe(0);
  });

  test('one empty set still ranks the other and returns [] for the empty side', async () => {
    const salvage: Candidate[] = [{ id: 'agent-merge', text: 'merge queue dedup' }];
    const pins = new Map<string, number[]>([
      ['fix merge', MERGE],
      ['merge queue dedup', MERGE],
    ]);
    const matcher = createIntentMatcher({ embedder: makeFakeEmbedder(pins) });

    const result = await matcher.match('fix merge', { salvage, roadmap: [] });
    expect(result.roadmap).toEqual([]);
    expect(result.salvage[0]?.id).toBe('agent-merge');
    expect(result.salvage[0]?.score).toBeCloseTo(1, 5);
  });
});
