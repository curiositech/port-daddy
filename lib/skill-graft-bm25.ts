/**
 * Skill Graft — BM25 lexical stage.
 *
 * Fixes the vocabulary-mismatch bug in `lib/skill-graft.ts` (a task phrased
 * in user language rarely shares cosine-similar phrasing with a skill's own
 * SKILL.md description) by giving the ranker a SECOND, independent signal:
 * plain lexical overlap. A query and a skill that share literal stemmed
 * terms (e.g. "optimizing" / "optimization" both stem to "optim") get
 * credit here even when the semantic tier (`./skill-graft-tool2vec.js`)
 * disagrees, and the two rankings are fused via reciprocal rank fusion in
 * `lib/skill-graft.ts`.
 *
 * Same tiny, no-external-deps BM25 formula `lib/whois.ts` already uses
 * (k1=1.2, b=0.75 — the canonical Okapi BM25 defaults), plus Porter
 * stemming layered onto the tokenizer so morphological variants match
 * ("detecting" / "detect", "optimization" / "optimize"). No dependency is
 * added: the Porter algorithm (Porter, 1980, "An Algorithm for Suffix
 * Stripping") is public-domain and small enough to implement directly.
 */

import { analyze } from './lexical-index.js';
import type { SkillEntry } from './shipwright/skill-index.js';

// ─── Tokenizer + Porter stemmer ─────────────────────────────────────────────

/**
 * Tokenize via the shared Unicode-safe analyzer (`lib/lexical-index.ts`).
 *
 * This docstring used to describe the thing that was wrong — "lowercase, split
 * on non-alphanumeric, drop 1-char tokens, same shape as lib/whois.ts's" — and
 * that description was the bug: splitting on non-alphanumeric makes every
 * non-ASCII character a delimiter. Left in place it would have invited the next
 * reader to "restore" the behaviour it names.
 *
 * NO stemming happens here. {@link tokenizeAndStem} is the stemming pass, and
 * it is a separate function because BM25 indexing and query analysis do not
 * always want the same aggressiveness.
 */
export function tokenize(text: string): string[] {
  // Shared Unicode-safe analyzer (lib/lexical-index.ts). This was the original
  // ASCII-only split — `[^a-z0-9]+` makes every non-ASCII character a
  // delimiter — and three other modules copied it. Skill ids and descriptions
  // are the corpus an agent searches when it does not know what it needs, so
  // silently dropping a whole script's worth of them was the worst place for
  // it to live.
  return analyze(text);
}

const VOWEL = 'aeiou';

/** 'y' is a consonant at the start of a word or right after a vowel;
 *  otherwise (after a consonant) it functions as a vowel. Recursive per
 *  Porter's own definition, but bottoms out at index 0. */
function isConsonantSimple(word: string, i: number): boolean {
  const ch = word[i];
  if (VOWEL.includes(ch)) return false;
  if (ch !== 'y') return true;
  return i === 0 ? true : !isConsonantSimple(word, i - 1);
}

/** Measure `m`: the count of VC sequences in the [C](VC)^m[V] decomposition. */
function measure(stem: string): number {
  let m = 0;
  let i = 0;
  const n = stem.length;
  // Skip leading consonant run.
  while (i < n && isConsonantSimple(stem, i)) i++;
  while (i < n) {
    // Skip vowel run.
    while (i < n && !isConsonantSimple(stem, i)) i++;
    if (i >= n) break;
    // Skip consonant run.
    while (i < n && isConsonantSimple(stem, i)) i++;
    m++;
  }
  return m;
}

function containsVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) if (!isConsonantSimple(stem, i)) return true;
  return false;
}

function endsWithDoubleConsonant(stem: string): boolean {
  const n = stem.length;
  if (n < 2) return false;
  return stem[n - 1] === stem[n - 2] && isConsonantSimple(stem, n - 1);
}

/** *o : stem ends cvc, where the second c is not W, X, or Y. */
function endsCvc(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  const c1 = isConsonantSimple(stem, n - 3);
  const v = !isConsonantSimple(stem, n - 2);
  const c2 = isConsonantSimple(stem, n - 1);
  return c1 && v && c2 && !'wxy'.includes(stem[n - 1]);
}

function replaceSuffix(word: string, suffix: string, replacement: string): string {
  return word.slice(0, word.length - suffix.length) + replacement;
}

/**
 * Porter stemmer (Porter, 1980). Reduces a token to its morphological root
 * so "optimization"/"optimize"/"optimizing" collide in the BM25 index.
 * Deterministic, dependency-free, pure function — independently testable.
 */
export function porterStem(input: string): string {
  let word = input.toLowerCase();
  if (word.length <= 2) return word;

  // Step 1a
  if (word.endsWith('sses')) word = replaceSuffix(word, 'sses', 'ss');
  else if (word.endsWith('ies')) word = replaceSuffix(word, 'ies', 'i');
  else if (word.endsWith('ss')) { /* unchanged */ }
  else if (word.endsWith('s') && !word.endsWith('us') && !word.endsWith('ss')) word = word.slice(0, -1);

  // Step 1b
  let step1bRuleApplied = false;
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) word = `${stem}ee`;
  } else if (/ed$/.test(word) && containsVowel(word.slice(0, -2))) {
    word = word.slice(0, -2);
    step1bRuleApplied = true;
  } else if (/ing$/.test(word) && containsVowel(word.slice(0, -3))) {
    word = word.slice(0, -3);
    step1bRuleApplied = true;
  }
  if (step1bRuleApplied) {
    if (/(at|bl|iz)$/.test(word)) {
      word += 'e';
    } else if (endsWithDoubleConsonant(word) && !/[lsz]$/.test(word)) {
      word = word.slice(0, -1);
    } else if (measure(word) === 1 && endsCvc(word)) {
      word += 'e';
    }
  }

  // Step 1c
  if (word.endsWith('y') && containsVowel(word.slice(0, -1))) {
    word = `${word.slice(0, -1)}i`;
  }

  // Step 2 — one round of the longest-suffix-first substitution table.
  const step2: Array<[string, string, number]> = [
    ['ational', 'ate', 0], ['tional', 'tion', 0], ['enci', 'ence', 0], ['anci', 'ance', 0],
    ['izer', 'ize', 0], ['abli', 'able', 0], ['alli', 'al', 0], ['entli', 'ent', 0],
    ['eli', 'e', 0], ['ousli', 'ous', 0], ['ization', 'ize', 0], ['ation', 'ate', 0],
    ['ator', 'ate', 0], ['alism', 'al', 0], ['iveness', 'ive', 0], ['fulness', 'ful', 0],
    ['ousness', 'ous', 0], ['aliti', 'al', 0], ['iviti', 'ive', 0], ['biliti', 'ble', 0],
  ];
  for (const [suffix, replacement] of step2) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) { word = stem + replacement; }
      break;
    }
  }

  // Step 3
  const step3: Array<[string, string]> = [
    ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', ''],
  ];
  for (const [suffix, replacement] of step3) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) { word = stem + replacement; }
      break;
    }
  }

  // Step 4
  const step4: string[] = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent',
    'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
  ];
  for (const suffix of step4) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (suffix === 'ion') {
        if (measure(stem) > 1 && /[st]$/.test(stem)) { word = stem; }
      } else if (measure(stem) > 1) {
        word = stem;
      }
      break;
    }
  }

  // Step 5a
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) word = stem;
  }

  // Step 5b
  if (measure(word) > 1 && endsWithDoubleConsonant(word) && word.endsWith('l')) {
    word = word.slice(0, -1);
  }

  return word;
}

/** Tokenize then stem — the exact pipeline every BM25 document AND query
 *  runs through, so both sides land in the same stemmed vocabulary. */
export function tokenizeAndStem(text: string): string[] {
  return tokenize(text).map(porterStem);
}

// ─── BM25 ranking over the skill catalog ────────────────────────────────────

const K1 = 1.2;
const B = 0.75;

interface Bm25Doc {
  id: string;
  tokens: string[];
}

/** Combine name + description + category + tags into one lexical document
 *  per skill — every field a query might literally overlap with. */
function skillDocumentText(skill: SkillEntry): string {
  return [skill.name, skill.description, skill.category, skill.tags.join(' ')]
    .filter(Boolean)
    .join(' ');
}

function buildCorpusStats(docs: Bm25Doc[]): { totalDocs: number; avgDocLen: number; docFreq: Map<string, number> } {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.tokens.length;
    for (const term of new Set(doc.tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  return {
    totalDocs: docs.length,
    avgDocLen: docs.length > 0 ? totalLen / docs.length : 0,
    docFreq,
  };
}

function scoreOne(
  queryTokens: string[],
  doc: Bm25Doc,
  corpus: { totalDocs: number; avgDocLen: number; docFreq: Map<string, number> },
): number {
  const docLen = doc.tokens.length;
  if (docLen === 0 || corpus.avgDocLen === 0) return 0;
  let score = 0;
  for (const term of queryTokens) {
    const df = corpus.docFreq.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (corpus.totalDocs - df + 0.5) / (df + 0.5));
    let tf = 0;
    for (const token of doc.tokens) if (token === term) tf++;
    if (tf === 0) continue;
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLen / corpus.avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
}

export interface Bm25RankedEntry {
  id: string;
  score: number;
}

/**
 * Rank every skill against `query` by BM25 over (name + description +
 * category + tags), Porter-stemmed. Returns every skill with score > 0,
 * sorted descending; ties break on skill id for determinism. Zero-score
 * skills are omitted (they contribute nothing to RRF as either signal).
 *
 * @example
 *   bm25Rank('optimize database connection pooling', skills)
 *   // → [{ id: 'postgres-connection-pooling', score: 4.1 }, ...]
 */
export function bm25Rank(query: string, skills: readonly SkillEntry[]): Bm25RankedEntry[] {
  const queryTokens = tokenizeAndStem(query);
  if (queryTokens.length === 0 || skills.length === 0) return [];

  const docs: Bm25Doc[] = skills.map((skill) => ({
    id: skill.id,
    tokens: tokenizeAndStem(skillDocumentText(skill)),
  }));
  const corpus = buildCorpusStats(docs);

  return docs
    .map((doc) => ({ id: doc.id, score: scoreOne(queryTokens, doc, corpus) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
