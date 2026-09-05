/**
 * Lexical retrieval done properly: Unicode-safe analysis, BM25 with real IDF,
 * a sparse inverted index, and bounded top-k selection.
 *
 * **What this replaces and why.** The arrival briefing originally scored with
 * set overlap normalised by the smaller side, and suppressed ubiquitous terms
 * with a hand-written stopword list. That list is a corpus-blind imitation of
 * IDF: it knows `the` is useless everywhere, but not that `reconcile` is
 * useless *in this repository* where half the sessions mention it. IDF gets
 * that for free from the corpus and needs no maintenance. There was already a
 * correct BM25 with IDF in `lib/skill-graft-bm25.ts`; not using it was the
 * mistake, and the stopword list was compensating for a gap that did not need
 * to exist.
 *
 * **The analyzer was silently destroying text.** The inherited tokenizer split
 * on `[^a-z0-9]+/i`, which makes every non-ASCII character a delimiter:
 *
 *     'café résumé'   -> ['caf', 'sum']      (é eaten, 'resume' truncated)
 *     'naïve Müller'  -> ['na', 've', 'ller']
 *     'Ωmega ЖУРНАЛ'  -> ['mega']            (Cyrillic word gone entirely)
 *     '日本語'         -> []                  (nothing at all)
 *
 * Not hypothetical here: this same PR hardened `actorKey()` against agent ids
 * like `日本語エージェント` and `你好`, so non-ASCII identifiers demonstrably
 * exist in this system. An agent whose purpose is written in any language but
 * English was being matched on debris.
 *
 * The analyzer below folds diacritics (NFKD, then strip combining marks) so
 * `café` and `cafe` are one term, keeps every Unicode letter and number via
 * `\p{L}`/`\p{N}`, and handles scripts without spaces — CJK — by character
 * bigrams, which is the standard substitute for word segmentation.
 *
 * **Bigrams carry phrase signal.** Unigrams alone cannot tell `port daddy`
 * from `daddy port`, and cannot tell that `reconcile loop` as a phrase means
 * more than the two words scattered apart. Adjacent-pair shingles are the
 * cheap 80% of that, at one extra posting per token.
 *
 * **Sparse, not dense.** Scoring walks postings for the query's terms only, so
 * a candidate sharing no term is never touched. Dense iteration over every
 * candidate × every term is what you write when the corpus is five items and
 * regret when it is five thousand.
 *
 * Note the deliberate asymmetry with `lib/vector-store.ts`: embeddings there
 * are stored DENSE, as `Float32Array`. That is not an oversight — MiniLM
 * output has all 384 components non-zero, so sparse encoding of an embedding
 * costs strictly more space and time than dense. Sparse belongs to the lexical
 * side, where a document touches a few dozen of a vocabulary of thousands.
 */

// ─── analysis ────────────────────────────────────────────────────────────────

/** Matches one run of letters/digits in ANY script, plus internal ' and _. */
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}_']*/gu;

/** Scripts written without spaces, where whitespace splitting yields one huge token. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/u;

/**
 * Fold text to a comparable form: compatibility-decompose, strip combining
 * marks, lowercase.
 *
 * NFKD rather than NFD so that compatibility variants collapse too — `ﬁ` to
 * `fi`, full-width `Ａ` to `A`. Those appear in pasted terminal output and
 * copied documentation more often than anyone expects, and an agent should not
 * fail to match its own purpose because the ticket title was pasted from a PDF.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    // ß has no combining-mark decomposition, so NFKD leaves it intact and
    // `große` would never match `grosse` — a distinction German writers do not
    // observe, and one that ASCII transliteration and Swiss orthography drop
    // outright. Expanded AFTER lowercasing so `ẞ` is covered by the same rule.
    .replace(/ß/g, 'ss');
}

/**
 * Split folded text into terms, Unicode-aware.
 *
 * CJK runs become character bigrams (`日本語` → `日本`, `本語`) because those
 * scripts have no spaces and no cheap segmenter; bigram indexing is the
 * standard approach and gives usable precision without a dictionary. A
 * single-character CJK run is kept whole rather than dropped, since many are
 * words on their own.
 */
export function analyze(text: string): string[] {
  const out: string[] = [];
  for (const match of fold(text).matchAll(WORD_RE)) {
    const token = match[0];
    if (CJK_RE.test(token)) {
      if (token.length === 1) out.push(token);
      for (let i = 0; i + 1 < token.length; i += 1) out.push(token.slice(i, i + 2));
      continue;
    }
    // Latin-script single characters are almost always identifier debris.
    if (token.length > 1) out.push(token);
  }
  return out;
}

/**
 * Adjacent-pair shingles, joined by a separator that cannot occur in a token.
 *
 * Returned ALONGSIDE unigrams, never instead of them: bigrams alone would make
 * a one-word query unmatchable.
 */
export function bigrams(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) out.push(`${tokens[i]}\u0000${tokens[i + 1]}`);
  return out;
}

/** Full analysis chain: fold → tokenize → stem → unigrams + bigrams. */
export function terms(text: string, stem: (t: string) => string): string[] {
  const unis = analyze(text).map(stem);
  return [...unis, ...bigrams(unis)];
}

// ─── top-k selection ─────────────────────────────────────────────────────────

/**
 * Bounded min-heap for top-k selection.
 *
 * Sorting the whole candidate list to take five is O(n log n) work to answer an
 * O(n log k) question. At briefing sizes the difference is small; the reason to
 * do it right is that this runs on the session-start path, where the corpora
 * grow with the fleet and nobody will revisit the sort when they do.
 *
 * Keeps the SMALLEST of the kept items at the root, so the check "is this
 * better than the worst thing I am keeping" is O(1) and eviction is O(log k).
 */
export class TopK<T> {
  private readonly heap: { score: number; value: T }[] = [];

  constructor(private readonly k: number) {}

  push(score: number, value: T): void {
    if (this.k <= 0) return;
    if (this.heap.length < this.k) {
      this.heap.push({ score, value });
      this.up(this.heap.length - 1);
      return;
    }
    if (score <= this.heap[0].score) return;
    this.heap[0] = { score, value };
    this.down(0);
  }

  /**
   * Drain the kept items, highest score first.
   *
   * `tieBreak` orders items that ARE being kept; it does not decide WHICH are
   * kept. {@link push} discards anything scoring `<=` the current worst, so at
   * the cutoff a tie is resolved by arrival order — first one in wins — and no
   * comparator can reach that decision. Stated explicitly because "ties broken
   * by the caller's comparator" reads like a guarantee about selection, and a
   * caller relying on that would get a stable-looking result that quietly
   * depends on corpus iteration order.
   *
   * @param tieBreak optional comparator applied to equal scores, for
   *   presentation order only
   * @returns the kept items, descending by score
   */
  drain(tieBreak?: (a: T, b: T) => number): { score: number; value: T }[] {
    return [...this.heap].sort(
      (a, b) => b.score - a.score || (tieBreak ? tieBreak(a.value, b.value) : 0),
    );
  }

  get size(): number {
    return this.heap.length;
  }

  private up(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private down(i: number): void {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let min = i;
      if (l < this.heap.length && this.heap[l].score < this.heap[min].score) min = l;
      if (r < this.heap.length && this.heap[r].score < this.heap[min].score) min = r;
      if (min === i) break;
      [this.heap[min], this.heap[i]] = [this.heap[i], this.heap[min]];
      i = min;
    }
  }
}

// ─── BM25 over a sparse inverted index ───────────────────────────────────────

export const BM25_K1 = 1.2;

/**
 * Length-normalisation strength.
 *
 * Lower than the textbook 0.75 on purpose. These corpora mix a twelve-word
 * session purpose against a multi-paragraph roadmap body, and at b=0.75 the
 * long document is penalised hard enough that a genuine match loses to a
 * shorter, weaker one. The earlier decision to abandon BM25 entirely over this
 * was an overcorrection: `b` is a dial, and turning it down is the actual fix.
 * b=0 would ignore length completely and let a sprawling document match
 * everything, so this keeps a third of the normalisation.
 */
export const BM25_B = 0.25;

export interface LexicalDoc {
  readonly id: string;
  readonly terms: readonly string[];
}

/**
 * An inverted index with document frequencies — the sparse structure BM25
 * actually wants.
 */
export function buildIndex(docs: readonly LexicalDoc[]) {
  /** term → [(docIndex, termFrequency)], the postings list. */
  const postings = new Map<string, { doc: number; tf: number }[]>();
  const lengths = new Float64Array(docs.length);
  let totalLen = 0;

  docs.forEach((doc, i) => {
    lengths[i] = doc.terms.length;
    totalLen += doc.terms.length;
    const tf = new Map<string, number>();
    for (const t of doc.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      let list = postings.get(term);
      if (!list) postings.set(term, (list = []));
      list.push({ doc: i, tf: count });
    }
  });

  const avgLen = docs.length ? totalLen / docs.length : 0;

  /** Robertson/Sparck-Jones IDF, the same form as lib/skill-graft-bm25.ts. */
  function idf(term: string): number {
    const df = postings.get(term)?.length ?? 0;
    if (df === 0) return 0;
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  }

  /**
   * Score a query against the corpus, touching only documents that share a term.
   *
   * Accumulation is sparse — a `Map` keyed by the doc indices that actually
   * appear in some posting list — so a candidate with no overlap costs nothing
   * rather than a wasted inner loop.
   */
  function search(queryTerms: readonly string[], k: number): { id: string; score: number }[] {
    if (!docs.length || !queryTerms.length) return [];
    const acc = new Map<number, number>();
    // Query term frequency matters: a term repeated in the query is not twice
    // as important, so each DISTINCT query term contributes once.
    for (const term of new Set(queryTerms)) {
      const list = postings.get(term);
      if (!list) continue;
      const termIdf = idf(term);
      if (termIdf <= 0) continue;
      for (const { doc, tf } of list) {
        const norm = 1 - BM25_B + BM25_B * (avgLen ? lengths[doc] / avgLen : 1);
        const contribution = termIdf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
        acc.set(doc, (acc.get(doc) ?? 0) + contribution);
      }
    }
    const top = new TopK<number>(k);
    for (const [doc, score] of acc) top.push(score, doc);
    return top
      .drain((a, b) => docs[a].id.localeCompare(docs[b].id))
      .map(({ score, value }) => ({ id: docs[value].id, score }));
  }

  return { search, idf, size: docs.length, vocabulary: () => postings.size };
}

export type LexicalIndex = ReturnType<typeof buildIndex>;
