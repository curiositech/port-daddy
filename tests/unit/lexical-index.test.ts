/**
 * Lexical retrieval: analyzer hygiene, IDF behaviour, sparse scoring, top-k.
 *
 * The analyzer tests are regressions against real destruction, not style
 * preferences. The inherited tokenizer split on `[^a-z0-9]+/i`, so every
 * non-ASCII character was a delimiter: `café` became `caf`, `ЖУРНАЛ` vanished
 * entirely, and `日本語` produced nothing at all. This same PR hardened
 * `actorKey()` against ids like `日本語エージェント`, so non-ASCII text
 * demonstrably reaches this code.
 *
 * The IDF tests pin the property a stopword list can only approximate: a term
 * common in THIS corpus stops carrying signal, without anyone maintaining a
 * list of which terms those are.
 */
import { describe, expect, test } from '@jest/globals';

import {
  BM25_B,
  BM25_K1,
  TopK,
  analyze,
  bigrams,
  buildIndex,
  fold,
  terms,
} from '../../lib/lexical-index.js';

const identity = (t: string) => t;

// ─── analyzer ────────────────────────────────────────────────────────────────

describe('IDF never goes negative, however common the term', () => {
  test('a term in EVERY document scores >= 0, not below zero', () => {
    // The classic BM25 footgun. The unsmoothed Robertson/Sparck-Jones form,
    //     log((N - df + 0.5) / (df + 0.5))
    // goes NEGATIVE once a term appears in more than half the corpus, so a
    // document containing a common term scores WORSE than one that doesn't --
    // ranking is then actively inverted for exactly the terms users type most.
    //
    // The `1 +` in the implementation is what prevents it: the argument stays
    // above 1 even at df === N, so the log stays non-negative. That `1 +` is
    // load-bearing and looks like a rounding nicety, which is why it is pinned
    // here rather than left to a comment.
    const idx = buildIndex(
      ['alpha common', 'beta common', 'gamma common', 'delta common'].map((text, i) => ({
        id: String(i),
        terms: analyze(text),
      })),
    );

    // Present in 4 of 4.
    expect(idx.idf('common')).toBeGreaterThanOrEqual(0);
    // Present in 3 of 4 -- past the halfway point where the unsmoothed form flips.
    const three = buildIndex(
      ['x common', 'y common', 'z common', 'w alone'].map((text, i) => ({
        id: String(i),
        terms: analyze(text),
      })),
    );
    expect(three.idf('common')).toBeGreaterThan(0);
    // And a rare term still outranks the common one.
    expect(three.idf('alone')).toBeGreaterThan(three.idf('common'));
  });

  test('a term in exactly HALF the corpus is positive and finite', () => {
    const idx = buildIndex(
      ['a half', 'b half', 'c other', 'd other'].map((text, i) => ({
        id: String(i),
        terms: analyze(text),
      })),
    );
    const v = idx.idf('half');
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});

describe('a lone CJK character is a word, not debris', () => {
  test('a single CJK character survives analysis', () => {
    // The asymmetry that makes this worth its own case: analyze() drops lone
    // LATIN characters (identifier debris) and KEEPS lone CJK ones (whole
    // words). 猫 is "cat". A tokenizer that treats the two the same either
    // floods the index with debris or silently deletes a real query term --
    // whois did the latter until a review caught it.
    expect(analyze('猫')).toEqual(['猫']);
    expect(analyze('山')).toEqual(['山']);
    // ...while a lone Latin character is still dropped.
    expect(analyze('a')).toEqual([]);
  });

  test('CJK bigrams are over CHARACTERS, never sub-character radicals', () => {
    // 猫 decomposes visually into 犭+ 苗, but those are strokes, not tokens.
    // Splitting there would index parts no query will ever contain.
    expect(analyze('猫')).toEqual(['猫']);
    expect(analyze('日本語')).toEqual(['日本', '本語']);
  });
});

describe('fold', () => {
  test('diacritics fold to their base letter', () => {
    expect(fold('café')).toBe(fold('cafe'));
    expect(fold('naïve')).toBe(fold('naive'));
    expect(fold('Müller')).toBe(fold('muller'));
    expect(fold('ÅNGSTRÖM')).toBe(fold('angstrom'));
  });

  test('compatibility variants fold too', () => {
    // Ligatures and full-width forms arrive via pasted terminal output and
    // copied docs; an agent should not miss its own purpose over a paste.
    expect(fold('ﬁle')).toBe(fold('file'));
    expect(fold('Ａ')).toBe(fold('a'));
  });

  test('case folds', () => {
    expect(fold('RECONCILE')).toBe(fold('reconcile'));
  });
});

describe('analyze', () => {
  test('accented words survive whole', () => {
    // Regression: was ['caf', 'sum'] — the accent ate the word boundary and
    // 'résumé' was truncated to a different word entirely.
    expect(analyze('café résumé')).toEqual(['cafe', 'resume']);
  });

  test('non-Latin scripts survive', () => {
    // Regression: 'ЖУРНАЛ Ωmega' produced only ['mega'] — the entire Cyrillic
    // word was deleted, and the Greek initial was shaved off its own token.
    expect(analyze('ЖУРНАЛ')).toEqual(['журнал']);
    expect(analyze('Ωmega')).toEqual(['ωmega']);
  });

  test('CJK becomes character bigrams rather than nothing', () => {
    // Regression: produced []. CJK has no spaces, so bigram indexing stands in
    // for word segmentation.
    expect(analyze('日本語')).toEqual(['日本', '本語']);
  });

  test('a lone CJK character is kept, since many are words', () => {
    expect(analyze('猫')).toEqual(['猫']);
  });

  test('single Latin characters are dropped as identifier debris', () => {
    expect(analyze('a b reconcile')).toEqual(['reconcile']);
  });

  test('punctuation and paths split cleanly', () => {
    expect(analyze('lib/squid/reconcile.ts')).toEqual(['lib', 'squid', 'reconcile', 'ts']);
  });
});

describe('bigrams', () => {
  test('adjacent pairs, joined on a separator no token can contain', () => {
    expect(bigrams(['a', 'b', 'c'])).toEqual(['a\u0000b', 'b\u0000c']);
  });

  test('fewer than two tokens yields none', () => {
    expect(bigrams(['solo'])).toEqual([]);
    expect(bigrams([])).toEqual([]);
  });

  test('terms() returns unigrams ALONGSIDE bigrams', () => {
    // Bigrams alone would make a one-word query unmatchable.
    const t = terms('wire reconcile', identity);
    expect(t).toContain('wire');
    expect(t).toContain('reconcile');
    expect(t).toContain('wire\u0000reconcile');
  });

  test('word order is now distinguishable', () => {
    const a = new Set(terms('port daddy', identity));
    const b = new Set(terms('daddy port', identity));
    // Same unigrams, different bigram — the whole point of shingling.
    expect(a.has('port\u0000daddy')).toBe(true);
    expect(b.has('port\u0000daddy')).toBe(false);
  });
});

// ─── top-k ───────────────────────────────────────────────────────────────────

describe('TopK', () => {
  test('keeps the k highest scores, highest first', () => {
    const h = new TopK<string>(3);
    [['a', 1], ['b', 9], ['c', 5], ['d', 7], ['e', 2]].forEach(([v, s]) =>
      h.push(s as number, v as string),
    );
    expect(h.drain().map((x) => x.value)).toEqual(['b', 'd', 'c']);
  });

  test('never grows beyond k', () => {
    const h = new TopK<number>(2);
    for (let i = 0; i < 100; i += 1) h.push(i, i);
    expect(h.size).toBe(2);
    expect(h.drain().map((x) => x.value)).toEqual([99, 98]);
  });

  test('k of zero keeps nothing', () => {
    const h = new TopK<number>(0);
    h.push(5, 5);
    expect(h.size).toBe(0);
  });

  test('ties break by the caller comparator, so ordering is deterministic', () => {
    const h = new TopK<string>(3);
    h.push(1, 'zebra');
    h.push(1, 'apple');
    expect(h.drain((a, b) => a.localeCompare(b)).map((x) => x.value)).toEqual(['apple', 'zebra']);
  });
});

// ─── BM25 ────────────────────────────────────────────────────────────────────

describe('BM25 over the inverted index', () => {
  const docs = [
    { id: 'd1', terms: terms('wire the reconcile loop producers', identity) },
    { id: 'd2', terms: terms('reconcile the garbage collector', identity) },
    { id: 'd3', terms: terms('reconcile the roadmap snapshot', identity) },
    { id: 'd4', terms: terms('espresso machine descaling guide', identity) },
  ];

  test('IDF suppresses a term common in THIS corpus, with no stopword list', () => {
    // This is what the hand-written stopword list could never do: 'reconcile'
    // is a perfectly good word that happens to be worthless *here*, because
    // three of four documents contain it. Nobody has to notice or maintain it.
    const idx = buildIndex(docs);
    expect(idx.idf('reconcile')).toBeLessThan(idx.idf('producers'));
    expect(idx.idf('espresso')).toBeGreaterThan(idx.idf('reconcile'));
  });

  test('a term in every document earns near-zero IDF', () => {
    const all = buildIndex([
      { id: 'a', terms: ['the', 'cat'] },
      { id: 'b', terms: ['the', 'dog'] },
      { id: 'c', terms: ['the', 'bird'] },
    ]);
    expect(all.idf('the')).toBeLessThan(all.idf('cat'));
  });

  test('an unseen term contributes nothing rather than NaN', () => {
    expect(buildIndex(docs).idf('nonexistent')).toBe(0);
  });

  test('ranks the genuinely closest document first', () => {
    const hits = buildIndex(docs).search(terms('reconcile loop producers', identity), 4);
    expect(hits[0].id).toBe('d1');
  });

  test('a document sharing no term is never returned', () => {
    // Sparse accumulation: it is not scored-then-filtered, it is never touched.
    const hits = buildIndex(docs).search(terms('espresso descaling', identity), 4);
    expect(hits.map((h) => h.id)).toEqual(['d4']);
  });

  test('respects k', () => {
    expect(buildIndex(docs).search(terms('reconcile', identity), 2)).toHaveLength(2);
  });

  test('an empty query or empty corpus returns nothing', () => {
    expect(buildIndex(docs).search([], 5)).toEqual([]);
    expect(buildIndex([]).search(terms('anything', identity), 5)).toEqual([]);
  });

  test('a short query still matches a long document', () => {
    // The failure that motivated abandoning BM25 the first time round. At
    // b=0.75 the long body is penalised hard enough to lose; b=0.25 keeps
    // length normalisation without letting it dominate.
    const mixed = [
      { id: 'long', terms: terms(`wire the reconcile loop producers ${'filler word '.repeat(80)}`, identity) },
      { id: 'short', terms: terms('unrelated espresso', identity) },
    ];
    const hits = buildIndex(mixed).search(terms('reconcile producers', identity), 2);
    expect(hits[0].id).toBe('long');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  test('the tuning constants are the documented ones', () => {
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.25);
  });

  test('a repeated query term does not double its own weight', () => {
    const idx = buildIndex(docs);
    const once = idx.search(['reconcile'], 4);
    const twice = idx.search(['reconcile', 'reconcile'], 4);
    expect(twice[0].score).toBeCloseTo(once[0].score, 10);
  });

  test('vocabulary is sparse — only terms that actually occur', () => {
    const idx = buildIndex([{ id: 'a', terms: ['x', 'y'] }]);
    expect(idx.vocabulary()).toBe(2);
  });
});
