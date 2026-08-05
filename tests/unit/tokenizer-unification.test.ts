/**
 * One analyzer, repo-wide — and the common-sense properties every consumer of
 * it depends on.
 *
 * Four modules had independently hand-rolled the same ASCII-only tokenizer
 * (`text.toLowerCase().split(/[^a-z0-9]+/i)`): skill matching, agent-roster
 * expertise lookup, whois search, and episodic memory. Each therefore shared
 * the same silent defect — every non-ASCII character acted as a delimiter, so
 * `café` indexed as `caf`, a Cyrillic word vanished outright, and CJK produced
 * nothing at all.
 *
 * That is worse than it sounds in two of those places. Roster expertise lookup
 * and skill matching FUSE lexical scores with MiniLM embeddings, and the
 * embedding half handles non-English text correctly — so the lexical half was
 * silently the weaker of two tiers for every non-English document, in a way no
 * test would catch and no user could attribute.
 *
 * These are the sanity checks, not the clever ones: text goes in, terms that a
 * human would recognise come out, in every script the fleet might actually use.
 */
import { describe, expect, test } from '@jest/globals';

import { analyze, fold } from '../../lib/lexical-index.js';
import { tokenize as skillTokenize } from '../../lib/skill-graft-bm25.js';

describe('every consumer shares one analyzer', () => {
  test('skill-graft tokenize IS the shared analyzer', () => {
    for (const s of ['café résumé', '日本語', 'ЖУРНАЛ', 'lib/squid/reconcile.ts', '']) {
      expect(skillTokenize(s)).toEqual(analyze(s));
    }
  });
});

describe('common-sense properties, in every script', () => {
  test.each([
    ['English', 'reconcile the loop', ['reconcile', 'the', 'loop']],
    ['accented Latin', 'refactorización', ['refactorizacion']],
    ['German', 'Größe Müller', ['grosse', 'muller']],
    ['Cyrillic', 'журнал агент', ['журнал', 'агент']],
  ])('%s survives tokenization', (_label, input, expected) => {
    expect(analyze(input)).toEqual(expected);
  });

  test('CJK yields character bigrams rather than silence', () => {
    // No spaces and no cheap segmenter, so bigrams stand in for words. The
    // alternative — what shipped before — was returning nothing at all.
    expect(analyze('日本語').length).toBeGreaterThan(0);
    expect(analyze('中文代理').length).toBeGreaterThan(0);
  });

  test('German eszett matches its ss spelling', () => {
    // NFKD leaves ß intact (no combining mark to strip), so without an explicit
    // rule `große` and `grosse` are different terms — a distinction German
    // writers do not observe and ASCII transliteration drops entirely.
    expect(analyze('Größe')).toEqual(analyze('grosse'));
    expect(analyze('Straße')).toEqual(analyze('strasse'));
  });

  test('Greek case and accent fold together', () => {
    // Uppercase sigma, lowercase sigma, and the accented form must be one term.
    expect(analyze('ΛΟΓΟΣ')).toEqual(analyze('λόγος'));
  });

  test('an accented query matches its unaccented twin', () => {
    // The property that makes search usable when half the fleet types accents
    // and half does not.
    expect(analyze('café')).toEqual(analyze('cafe'));
    expect(analyze('naïve résumé')).toEqual(analyze('naive resume'));
  });

  test('case never changes the terms', () => {
    expect(analyze('RECONCILE Loop')).toEqual(analyze('reconcile loop'));
  });

  test('paths split into their components', () => {
    expect(analyze('lib/squid/reconcile-sources.ts')).toEqual([
      'lib', 'squid', 'reconcile', 'sources', 'ts',
    ]);
  });

  test('empty and whitespace-only input yield nothing, not a crash', () => {
    expect(analyze('')).toEqual([]);
    expect(analyze('   \n\t ')).toEqual([]);
  });

  test('punctuation alone yields nothing', () => {
    expect(analyze('!!! --- ... ***')).toEqual([]);
  });

  test('emoji do not become terms', () => {
    // They carry no retrieval signal and would otherwise match promiscuously
    // across every doc that uses the same emoji.
    expect(analyze('⚓ 🐙 reconcile')).toEqual(['reconcile']);
  });

  test('a very long token is not silently dropped', () => {
    const long = 'a'.repeat(500);
    expect(analyze(long)).toEqual([long]);
  });

  test('numbers and identifiers survive', () => {
    expect(analyze('ADR-0108 phase0 v3')).toEqual(['adr', '0108', 'phase0', 'v3']);
  });

  test('tokenization is idempotent through fold', () => {
    // Folding an already-folded string must not change it, or repeated
    // indexing passes would drift.
    const once = fold('Café ﬁle Ａ');
    expect(fold(once)).toBe(once);
  });
});
