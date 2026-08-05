/**
 * Arrival briefing — what an agent should be told the moment it starts.
 *
 * A new session begins knowing nothing: not that someone abandoned this exact
 * work an hour ago, not that a roadmap item already describes it, not that a
 * skill in the catalog exists precisely for it, and not that another agent is
 * editing the same files right now. All four facts are already in the daemon.
 * None of them arrive unless something goes and looks.
 *
 * **Relevance, not a state dump.** `lib/briefing.ts` already projects project
 * state into `.portdaddy/` for agents to read; this module is the layer above
 * it that decides *which* of that state is worth an arriving agent's attention.
 * The distinction is the whole point — an agent that gets everything reads
 * nothing, and a briefing that fires on every session with the same content is
 * indistinguishable from noise. Sections that match nothing are omitted rather
 * than rendered empty.
 *
 * **Pure by construction.** Every function here takes already-fetched corpora
 * and returns a ranking. No database, no filesystem, no clock beyond an injected
 * one. The caller (the session-start path, or `pd briefing --arrival`) does the
 * I/O. That split is what makes the ranking decisions — which are the part that
 * can be subtly, silently wrong — testable against fixtures.
 *
 * **Retrieval is BM25 with real IDF over a sparse inverted index**
 * (`lib/lexical-index.ts`), fused with cosine similarity over the shared
 * embedding store. An earlier version scored with set overlap and leaned on a
 * hand-written stopword list to stand in for IDF; that list could only ever
 * know which words are useless *everywhere*, never which are useless *in this
 * corpus*. Stemming, diacritic folding, and Unicode-safe tokenization all live
 * in the analyzer, so `café`/`cafe` and `reconciling`/`reconciled` are one term
 * and a purpose written in any script survives tokenization intact.
 */

import { porterStem } from './skill-graft-bm25.js';
import { analyze, bigrams, buildIndex } from './lexical-index.js';
import { reciprocalRankFusion, type VectorSearchResult } from './vector-store.js';

/**
 * The `kind` each corpus registers under in the shared vector store.
 *
 * Named constants rather than inline strings because the warm path (the daemon)
 * and the read path (this module) must agree exactly — a typo in either would
 * produce a permanently cold corpus that degrades silently to lexical, which is
 * a working system that quietly does less than it claims.
 */
export const VECTOR_KIND = {
  salvage: 'arrival:salvage',
  roadmap: 'arrival:roadmap',
  skills: 'arrival:skills',
  neighbours: 'arrival:neighbours',
  notes: 'arrival:notes',
} as const;

/** The slice of the shared vector store this module needs. */
export interface SemanticStoreLike {
  embedQuery(text: string): Promise<number[] | null>;
  search(kind: string, query: string | readonly number[], k?: number): Promise<VectorSearchResult>;
}

/**
 * Terms that carry no signal for this kind of matching.
 *
 * **Why this list exists at all.** BM25 does not need one — a term appearing in
 * every document earns a near-zero IDF and disappears on its own. The scoring
 * here is deliberately simpler than BM25 (set overlap normalised by the smaller
 * side, so a three-word purpose can match a long roadmap body), and that
 * simplification throws away the corpus statistics that would have suppressed
 * these. Without the list, "watering the plants" matches "wire the reconcile
 * loop" on the word *the*, and the briefing renders `similar goal: the`.
 *
 * Bare file extensions are in here for the same reason: `contextQuery` includes
 * file basenames, and `ts` is shared by every TypeScript file in the repo, so it
 * would silently introduce every agent to every other agent.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // function words that survive stemming
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'up', 'down', 'out',
  'it', 'its', 'as', 'so', 'not', 'no', 'yes', 'do', 'doe', 'did', 'done', 'have', 'ha', 'had',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall',
  'i', 'we', 'you', 'they', 'he', 'she', 'them', 'us', 'my', 'our', 'your', 'their',
  // file extensions, which ride in on basenames
  'ts', 'js', 'tsx', 'jsx', 'md', 'json', 'yml', 'yaml', 'sh', 'rs', 'py', 'go', 'toml', 'txt',
]);

/**
 * Tokenize, stem, and drop terms that would match everything.
 *
 * Single-character tokens go too: they are almost always fragments of a split
 * identifier and match promiscuously.
 */
function tokenizeAndStem(text: string): string[] {
  const unigrams = analyze(text)
    .map(porterStem)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // Bigrams alongside, never instead: they carry the phrase signal unigrams
  // cannot ("reconcile loop" as a phrase beats the two words scattered), and a
  // one-word purpose would be unmatchable without the unigrams.
  return [...unigrams, ...bigrams(unigrams)];
}

/**
 * BM25 relevance of a query against one section's candidates, in [0, 1).
 *
 * **Why an index per section rather than one global corpus.** IDF is only
 * meaningful within a comparable population. `reconcile` is near-worthless
 * among session purposes in this repo and genuinely discriminating among skill
 * ids; pooling them would average those two facts into a number describing
 * neither.
 *
 * **Why the stopword list survives alongside IDF.** IDF is corpus statistics,
 * and a section with two candidates has no statistics worth the name — with
 * one document, every term it contains has identical document frequency, so
 * `the` and `reconcile` are indistinguishable. The static list covers that
 * degenerate case; IDF covers the case the list never could, which is a term
 * that is perfectly good English and worthless *here*. They fail in opposite
 * directions, which is the reason to keep both rather than pick one.
 *
 * Scores are squashed by `s / (s + 1)`: order-preserving, bounded below
 * MAX_TEXT_SCORE so a shared file still strictly dominates, and — unlike
 * dividing by the top hit — it does not promote the best of a bad field to a
 * perfect 1.0.
 */
function bm25Scores(
  query: readonly string[],
  docs: readonly { id: string; text: readonly string[] }[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!query.length || !docs.length) return out;
  const index = buildIndex(docs.map((d) => ({ id: d.id, terms: d.text })));
  for (const hit of index.search(query, docs.length)) {
    out.set(hit.id, hit.score / (hit.score + 1));
  }
  return out;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Everything known about the arriving agent at session start. */
export interface ArrivalContext {
  /** The arriving actor's id. Excluded from its own neighbour matches. */
  readonly actor: string;
  /** What this session is for, in the operator's words. The strongest signal. */
  readonly purpose?: string;
  /** Project id the session belongs to. */
  readonly project?: string;
  /** Files the session has already claimed or opened, if any. */
  readonly files?: readonly string[];
  /** Free-text branch name, ticket title, or anything else worth matching on. */
  readonly hints?: readonly string[];
}

/** A salvageable session left behind by an agent that went away. */
export interface SalvageCandidate {
  readonly agentId: string;
  readonly purpose?: string;
  readonly project?: string;
  readonly files?: readonly string[];
  readonly notes?: readonly string[];
  readonly detectedAt?: number;
}

/** A roadmap item the arriving work might belong under. */
export interface RoadmapCandidate {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly status?: string;
  readonly tags?: readonly string[];
}

/** A skill in the catalog. */
export interface SkillCandidate {
  readonly id: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

/**
 * A note somebody already wrote about this kind of work.
 *
 * The highest-value corpus and the least discoverable one: notes are where an
 * agent records what it learned the hard way, and they are written into a
 * session that ends. Nobody ever goes looking through another session's notes,
 * so the knowledge is lost the moment the session closes — unless something
 * surfaces it at the exact moment a new agent starts the same work.
 */
export interface NoteCandidate {
  readonly id: string;
  readonly content: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly sessionPurpose?: string;
  readonly project?: string;
  readonly createdAt?: number;
}

/** Another live session, and therefore a possible neighbour. */
export interface NeighbourCandidate {
  readonly actor: string;
  readonly sessionId: string;
  readonly purpose?: string;
  readonly project?: string;
  readonly files?: readonly string[];
}

/** The four corpora, already fetched by the caller. */
export interface ArrivalCorpora {
  readonly salvage?: readonly SalvageCandidate[];
  readonly roadmap?: readonly RoadmapCandidate[];
  readonly skills?: readonly SkillCandidate[];
  readonly neighbours?: readonly NeighbourCandidate[];
  readonly notes?: readonly NoteCandidate[];
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

/**
 * One briefing line.
 *
 * `why` is not decoration. An agent (or operator) shown a match it cannot
 * account for learns to distrust the whole section, so every entry carries the
 * evidence that earned it a place — the overlapping terms, or the shared file.
 */
export interface BriefingHit<T> {
  readonly item: T;
  readonly score: number;
  readonly why: string;
}

export interface ArrivalBriefing {
  readonly salvage: readonly BriefingHit<SalvageCandidate>[];
  readonly roadmap: readonly BriefingHit<RoadmapCandidate>[];
  readonly skills: readonly BriefingHit<SkillCandidate>[];
  readonly neighbours: readonly BriefingHit<NeighbourCandidate>[];
  readonly notes: readonly BriefingHit<NoteCandidate>[];
  /** True when every section is empty — the caller should then say nothing. */
  readonly empty: boolean;
  /**
   * Whether the semantic tier actually ran.
   *
   * `false` means these rankings are lexical-only: they will match
   * "reconcile producers" to "reconcile producers" but not to "hook up the
   * projection sources", which is the same work described in different words.
   * Surfaced rather than swallowed because a degraded briefing that looks
   * identical to a healthy one teaches operators to trust the wrong thing.
   */
  readonly semantic: boolean;
  /** Operator-facing reason when `semantic` is false. */
  readonly degradedReason?: string;
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Per-section ceiling. Four sections of three is already a lot to read. */
export const DEFAULT_PER_SECTION = 3;
/**
 * Minimum score a hit must clear.
 *
 * Deliberately above zero: a single incidental shared token ("the", already
 * stemmed away, but also "test", "fix", "update") is not a reason to interrupt
 * someone. A briefing is worth having only if a weak match stays out of it.
 */
export const MIN_SCORE = 0.15;
/**
 * Weight for a shared claimed file when matching neighbours.
 *
 * Far above any text signal on purpose: two agents editing the same file is not
 * a topical similarity, it is an imminent collision. One shared path should
 * outrank a paragraph of coincidental vocabulary every time.
 */
export const SHARED_FILE_WEIGHT = 2.0;

/**
 * Shortest note worth surfacing.
 *
 * "wip", "ok", "fixed" and "done" are the most common note bodies in any real
 * database. They match weakly against everything and crowd out the paragraph
 * somebody actually took the time to write.
 */
export const NOTE_MIN_CHARS = 24;

/**
 * The most any text-only match can score: a perfect overlap (1.0) plus the
 * same-project nudge. {@link SHARED_FILE_WEIGHT} is deliberately above this, so
 * a single shared file strictly *dominates* rather than merely ties the wordiest
 * possible coincidence — at equal scores the ordering would fall to sort
 * stability, which is not a decision anyone made.
 */
export const MAX_TEXT_SCORE = 1.0;

// ─── Scoring ─────────────────────────────────────────────────────────────────


/** The terms two texts share, for the `why` line. */
export function sharedTerms(a: readonly string[], b: readonly string[], limit = 4): string[] {
  const setB = new Set(b);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of a) {
    if (seen.has(t) || !setB.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** The arriving context flattened into one query string. */
export function contextQuery(ctx: ArrivalContext): string {
  return [ctx.purpose ?? '', ...(ctx.hints ?? []), ...(ctx.files ?? []).map(basename)].join(' ');
}

function basename(p: string): string {
  const cut = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return cut.length ? cut[cut.length - 1] : p;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

// ─── Sections ────────────────────────────────────────────────────────────────

interface RankOpts {
  readonly perSection?: number;
  readonly minScore?: number;
  /**
   * Keep candidates that pass every ELIGIBILITY rule but score zero lexically.
   *
   * There are two different reasons a candidate is absent from a section, and
   * conflating them breaks semantic search. *Ineligible* means a rule said no —
   * the roadmap item is shipped, the salvage is in another repo, the neighbour
   * is you — and no amount of similarity should bring it back. *Unscored* means
   * only that it shares no stemmed term with the query, which is exactly the
   * case embeddings exist to rescue: "hook up the projection sources" is the
   * same work as "wire the reconcile producers" and has zero lexical overlap
   * with it.
   *
   * The fusion path sets this so the semantic tier ranks over the full eligible
   * pool; the lexical-only path leaves it off, since a zero-overlap candidate
   * with no semantic tier to judge it is just noise.
   */
  readonly keepUnscored?: boolean;
}

function take<T>(hits: BriefingHit<T>[], opts: RankOpts): BriefingHit<T>[] {
  // With keepUnscored the floor is deliberately not applied: the caller is
  // assembling the eligible pool for semantic re-ranking, and a lexical floor
  // would discard precisely the same-meaning-different-words candidates that
  // the semantic tier is there to find.
  const min = opts.keepUnscored ? -Infinity : (opts.minScore ?? MIN_SCORE);
  return hits
    .filter((h) => h.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.perSection ?? DEFAULT_PER_SECTION);
}

/**
 * Salvage sessions worth resuming.
 *
 * Same-project is a prerequisite when both sides declare one: an abandoned
 * session in another repo is never the work in front of you, however similar it
 * reads. Shared files then dominate, because a salvage candidate holding a file
 * you are about to edit is not merely relevant — it is the reason your claim is
 * about to be contested.
 */
export function rankSalvage(
  ctx: ArrivalContext,
  candidates: readonly SalvageCandidate[],
  opts: RankOpts = {},
): BriefingHit<SalvageCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const mine = new Set((ctx.files ?? []).map(norm));
  const hits: BriefingHit<SalvageCandidate>[] = [];

  // Two passes: the corpus has to exist before IDF can be computed over it.
  const texts = new Map<string, string[]>();
  for (const c of candidates) {
    if (ctx.project && c.project && ctx.project !== c.project) continue;
    texts.set(c.agentId, tokenizeAndStem([c.purpose ?? '', ...(c.notes ?? [])].join(' ')));
  }
  const scores = bm25Scores(q, [...texts].map(([id, text]) => ({ id, text })));

  for (const c of candidates) {
    if (ctx.project && c.project && ctx.project !== c.project) continue;
    const theirs = (c.files ?? []).map(norm);
    const shared = theirs.filter((f) => mine.has(f));
    const text = texts.get(c.agentId) ?? [];
    const textScore = scores.get(c.agentId) ?? 0;
    const score = shared.length * SHARED_FILE_WEIGHT + textScore;
    if (score <= 0 && !opts.keepUnscored) continue;
    const terms = sharedTerms(q, text);
    hits.push({
      item: c,
      score,
      why: shared.length
        ? `holds ${shared.length === 1 ? basename(shared[0]) : `${shared.length} files you touched`}`
        : terms.length
          ? `similar work: ${terms.join(', ')}`
          : 'similar work (semantic match)',
    });
  }
  return take(hits, opts);
}

/** Roadmap items the arriving work plausibly belongs under. */
export function rankRoadmap(
  ctx: ArrivalContext,
  candidates: readonly RoadmapCandidate[],
  opts: RankOpts = {},
): BriefingHit<RoadmapCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const hits: BriefingHit<RoadmapCandidate>[] = [];
  const texts = new Map<string, string[]>();
  for (const c of candidates) {
    if (c.status && /^(done|shipped|closed|complete)/i.test(c.status)) continue;
    texts.set(c.id, tokenizeAndStem([c.title, c.body ?? '', ...(c.tags ?? [])].join(' ')));
  }
  const scores = bm25Scores(q, [...texts].map(([id, text]) => ({ id, text })));
  for (const c of candidates) {
    // A shipped item is history: it cannot be the thing you are starting.
    if (c.status && /^(done|shipped|closed|complete)/i.test(c.status)) continue;
    const text = texts.get(c.id) ?? [];
    const score = scores.get(c.id) ?? 0;
    if (score <= 0 && !opts.keepUnscored) continue;
    const terms = sharedTerms(q, text);
    hits.push({ item: c, score, why: terms.length ? `matches: ${terms.join(', ')}` : 'semantic match' });
  }
  return take(hits, opts);
}

/** Skills in the catalog that fit the work about to be done. */
export function rankSkills(
  ctx: ArrivalContext,
  candidates: readonly SkillCandidate[],
  opts: RankOpts = {},
): BriefingHit<SkillCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const hits: BriefingHit<SkillCandidate>[] = [];
  const texts = new Map<string, string[]>();
  for (const c of candidates) {
    texts.set(c.id, tokenizeAndStem([c.id.replace(/[-_]/g, ' '), c.description ?? '', ...(c.tags ?? [])].join(' ')));
  }
  const scores = bm25Scores(q, [...texts].map(([id, text]) => ({ id, text })));
  for (const c of candidates) {
    // The skill id itself is a strong signal — ids are hyphenated topic phrases
    // ("postgres-connection-pooling"), so they tokenize into exactly the terms
    // a matching purpose would use.
    const text = texts.get(c.id) ?? [];
    const score = scores.get(c.id) ?? 0;
    if (score <= 0 && !opts.keepUnscored) continue;
    const terms = sharedTerms(q, text);
    hits.push({ item: c, score, why: terms.length ? `matches: ${terms.join(', ')}` : 'semantic match' });
  }
  return take(hits, opts);
}

/**
 * Live agents worth being introduced to.
 *
 * This is the section that turns a briefing into coordination: the other three
 * tell an agent about artifacts, this one tells it about people. A shared file
 * is weighted to dominate because that pair is heading for a collision whether
 * or not either of them notices, and the introduction is what lets them settle
 * it in a parley instead of in a merge conflict.
 *
 * The arriving actor is always excluded from its own results — an agent
 * introduced to itself learns nothing and discredits the section.
 */
export function rankNeighbours(
  ctx: ArrivalContext,
  candidates: readonly NeighbourCandidate[],
  opts: RankOpts = {},
): BriefingHit<NeighbourCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const mine = new Set((ctx.files ?? []).map(norm));
  const hits: BriefingHit<NeighbourCandidate>[] = [];

  const texts = new Map<string, string[]>();
  for (const c of candidates) {
    if (c.actor === ctx.actor) continue;
    texts.set(c.sessionId, tokenizeAndStem(c.purpose ?? ''));
  }
  const scores = bm25Scores(q, [...texts].map(([id, text]) => ({ id, text })));

  for (const c of candidates) {
    if (c.actor === ctx.actor) continue;
    const theirs = (c.files ?? []).map(norm);
    const shared = theirs.filter((f) => mine.has(f));
    const text = texts.get(c.sessionId) ?? [];
    const textScore = scores.get(c.sessionId) ?? 0;
    // Same project is corroboration, not a gate: cross-project agents with the
    // same expertise are exactly who you want to meet.
    const sameProject = ctx.project && c.project && ctx.project === c.project ? 0.1 : 0;
    const score = shared.length * SHARED_FILE_WEIGHT + textScore + sameProject;
    if (score <= 0 && !opts.keepUnscored) continue;
    const terms = sharedTerms(q, text);
    hits.push({
      item: c,
      score,
      why: shared.length
        ? `editing ${shared.length === 1 ? basename(shared[0]) : `${shared.length} of the same files`}`
        : terms.length
          ? `similar goal: ${terms.join(', ')}`
          : 'similar goal (semantic match)',
    });
  }
  return take(hits, opts);
}

/**
 * Notes from earlier work that reads like this work.
 *
 * Scoped to the same project when both declare one — a lesson learned in
 * another repo usually is not transferable, and a false hit here is expensive:
 * an agent that acts on a confidently-surfaced but irrelevant note does the
 * wrong thing with conviction.
 *
 * Very short notes are dropped outright. `wip`, `ok`, `fixed` are the most
 * common note contents in any real database and carry no recoverable meaning;
 * left in, they match everything weakly and crowd out the paragraph somebody
 * actually wrote.
 */
export function rankNotes(
  ctx: ArrivalContext,
  candidates: readonly NoteCandidate[],
  opts: RankOpts = {},
): BriefingHit<NoteCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const hits: BriefingHit<NoteCandidate>[] = [];
  const texts = new Map<string, string[]>();
  for (const c of candidates) {
    if (ctx.project && c.project && ctx.project !== c.project) continue;
    if ((c.content ?? '').trim().length < NOTE_MIN_CHARS) continue;
    texts.set(c.id, tokenizeAndStem([(c.content ?? '').trim(), c.sessionPurpose ?? ''].join(' ')));
  }
  const scores = bm25Scores(q, [...texts].map(([id, text]) => ({ id, text })));
  for (const c of candidates) {
    if (ctx.project && c.project && ctx.project !== c.project) continue;
    const body = (c.content ?? '').trim();
    if (body.length < NOTE_MIN_CHARS) continue;
    const text = texts.get(c.id) ?? [];
    const score = scores.get(c.id) ?? 0;
    if (score <= 0 && !opts.keepUnscored) continue;
    const terms = sharedTerms(q, text);
    hits.push({
      item: c,
      score,
      why: terms.length ? `note matches: ${terms.join(', ')}` : 'note (semantic match)',
    });
  }
  return take(hits, opts);
}

// ─── Assembly ────────────────────────────────────────────────────────────────

/**
 * Rank all four corpora against one arrival.
 *
 * An absent corpus and an empty one are both rendered as an empty section here,
 * unlike the reconcile loop where the distinction is load-bearing — nothing is
 * deleted on the strength of this result, so there is no key to protect.
 */
export function buildArrivalBriefing(
  ctx: ArrivalContext,
  corpora: ArrivalCorpora,
  opts: RankOpts = {},
): ArrivalBriefing {
  const salvage = rankSalvage(ctx, corpora.salvage ?? [], opts);
  const roadmap = rankRoadmap(ctx, corpora.roadmap ?? [], opts);
  const skills = rankSkills(ctx, corpora.skills ?? [], opts);
  const neighbours = rankNeighbours(ctx, corpora.neighbours ?? [], opts);
  const notes = rankNotes(ctx, corpora.notes ?? [], opts);
  return {
    salvage,
    roadmap,
    skills,
    neighbours,
    notes,
    empty: !salvage.length && !roadmap.length && !skills.length && !neighbours.length && !notes.length,
    semantic: false,
    degradedReason: 'lexical-only ranking (no vector store supplied)',
  };
}

// ─── semantic fusion ─────────────────────────────────────────────────────────

/** Rank ids by descending score, for feeding into RRF. */
function rankedIds<T>(hits: readonly BriefingHit<T>[], id: (item: T) => string): string[] {
  return hits.map((h) => id(h.item));
}

/**
 * Fuse the lexical ranking of one section with a semantic ranking of the same
 * candidates, by reciprocal rank.
 *
 * **Why fuse rather than replace.** Embeddings are better at "same work,
 * different words" and worse at exact identifiers — a MiniLM vector will
 * happily rate `reconcile-loop-design` and `reconcile-loop-producers` as near
 * identical, while BM25 keeps them apart. The two tiers fail in different
 * directions, which is precisely when fusion beats either alone, and it is the
 * pattern `lib/durable-agent-roster.ts` already uses for expertise lookup.
 *
 * Structural evidence survives fusion untouched: a shared claimed file is not
 * a similarity signal at all, so hits carrying one keep their `why` and stay
 * pinned above anything that merely reads alike.
 */
function fuseSection<T>(
  pool: readonly BriefingHit<T>[],
  lexical: readonly BriefingHit<T>[],
  semanticOrder: readonly string[],
  id: (item: T) => string,
  limit: number,
): BriefingHit<T>[] {
  // No semantic signal: fall back to exactly what the lexical tier produced,
  // floor and all. The eligible pool is deliberately NOT used here — without a
  // semantic ranker, zero-overlap candidates are noise, not recall.
  if (!semanticOrder.length) return [...lexical];

  // Fuse over the eligible pool so a zero-lexical candidate can still surface,
  // but only ever an ELIGIBLE one: `byId` is built from the pool, so an id the
  // semantic tier returns for something a rule excluded is dropped on lookup.
  const byId = new Map(pool.map((h) => [id(h.item), h]));
  const lexicalOrder = rankedIds([...lexical].sort((a, b) => b.score - a.score), id);
  const fused = reciprocalRankFusion([lexicalOrder, semanticOrder.filter((s) => byId.has(s))]);

  return [...fused.entries()]
    .map(([itemId, score]) => {
      const hit = byId.get(itemId);
      return hit ? { ...hit, score } : null;
    })
    .filter((h): h is BriefingHit<T> => h !== null)
    // A structural hit (shared file) outranks any fused text score: the two
    // agents are colliding regardless of how the words compare.
    .sort((a, b) => Number(isStructural(b)) - Number(isStructural(a)) || b.score - a.score)
    .slice(0, limit);
}

/** A hit earned by a shared file rather than by wording. */
function isStructural<T>(hit: BriefingHit<T>): boolean {
  return hit.why.startsWith('holds ') || hit.why.startsWith('editing ');
}

/**
 * Rank all four corpora with semantic + lexical fusion.
 *
 * Falls back to the pure-lexical result — clearly labeled — whenever the
 * embedder cannot answer. That covers a model that has not downloaded yet, an
 * ONNX runtime that failed to load, and a cold vector store, all of which are
 * ordinary states on a fresh install rather than exceptional ones.
 *
 * The query is embedded ONCE and reused across all four kinds; embedding is the
 * only genuinely expensive step here, and doing it per-corpus would quadruple
 * the cost of every arrival for no benefit.
 */
export async function buildArrivalBriefingSemantic(
  ctx: ArrivalContext,
  corpora: ArrivalCorpora,
  store: SemanticStoreLike,
  opts: RankOpts = {},
): Promise<ArrivalBriefing> {
  const lexical = buildArrivalBriefing(ctx, corpora, opts);
  const query = contextQuery(ctx).trim();
  if (!query) return { ...lexical, semantic: false, degradedReason: 'no arrival context to match on' };

  // The ELIGIBLE pool, not the lexically-thresholded one. Everything here has
  // passed its section's rules (right project, not shipped, not you); what it
  // may lack is any shared vocabulary with the query, which is the gap the
  // semantic tier exists to close. Ranking fusion over `lexical` alone would
  // make embeddings a re-ranker of things lexical already found — useful, but
  // not the point.
  const poolOpts: RankOpts = { ...opts, keepUnscored: true, perSection: Number.MAX_SAFE_INTEGER };
  const pool = {
    salvage: rankSalvage(ctx, corpora.salvage ?? [], poolOpts),
    roadmap: rankRoadmap(ctx, corpora.roadmap ?? [], poolOpts),
    skills: rankSkills(ctx, corpora.skills ?? [], poolOpts),
    neighbours: rankNeighbours(ctx, corpora.neighbours ?? [], poolOpts),
    notes: rankNotes(ctx, corpora.notes ?? [], poolOpts),
  };

  const limit = opts.perSection ?? DEFAULT_PER_SECTION;
  let vector: number[] | null = null;
  try {
    vector = await store.embedQuery(query);
  } catch {
    vector = null;
  }
  if (!vector) {
    return {
      ...lexical,
      semantic: false,
      degradedReason: 'shared MiniLM embedder unavailable; ranking is lexical only. Run pd doctor.',
    };
  }

  const order = async (kind: string): Promise<string[]> => {
    try {
      const res = await store.search(kind, vector!, 50);
      return res.semanticAvailable ? res.hits.map((h) => h.id) : [];
    } catch {
      return [];
    }
  };

  const [salvageOrder, roadmapOrder, skillsOrder, neighbourOrder, notesOrder] = await Promise.all([
    order(VECTOR_KIND.salvage),
    order(VECTOR_KIND.roadmap),
    order(VECTOR_KIND.skills),
    order(VECTOR_KIND.neighbours),
    order(VECTOR_KIND.notes),
  ]);

  const anySemantic =
    salvageOrder.length + roadmapOrder.length + skillsOrder.length + neighbourOrder.length + notesOrder.length > 0;

  const salvage = fuseSection(pool.salvage, lexical.salvage, salvageOrder, (c) => c.agentId, limit);
  const roadmap = fuseSection(pool.roadmap, lexical.roadmap, roadmapOrder, (c) => c.id, limit);
  const skills = fuseSection(pool.skills, lexical.skills, skillsOrder, (c) => c.id, limit);
  const neighbours = fuseSection(pool.neighbours, lexical.neighbours, neighbourOrder, (c) => c.sessionId, limit);
  const notes = fuseSection(pool.notes, lexical.notes, notesOrder, (c) => c.id, limit);

  return {
    salvage,
    roadmap,
    skills,
    neighbours,
    notes,
    empty: !salvage.length && !roadmap.length && !skills.length && !neighbours.length && !notes.length,
    semantic: anySemantic,
    ...(anySemantic
      ? {}
      : { degradedReason: 'vector store is cold for every corpus; ranking is lexical only' }),
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render a briefing for injection into an agent's first turn.
 *
 * Returns `''` for an empty briefing rather than a "nothing to report" header:
 * the harness is quiet by design, and a section that always prints teaches
 * agents to skip the block that will one day matter.
 */
/** Collapse a note to one readable line; the matrix and the terminal both want flat text. */
function oneLineNote(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function renderArrivalBriefing(b: ArrivalBriefing): string {
  if (b.empty) return '';
  const lines: string[] = ['⚓ Port Daddy — arrival briefing'];

  if (b.neighbours.length) {
    lines.push('', 'Agents on adjacent work:');
    for (const h of b.neighbours) {
      lines.push(`  • ${h.item.actor} — ${h.item.purpose ?? 'no stated purpose'} (${h.why})`);
    }
    lines.push('  → `pd parley call <agent> --reason "..."` to settle overlap before it lands.');
  }

  if (b.salvage.length) {
    lines.push('', 'Salvageable work that looks like yours:');
    for (const h of b.salvage) {
      lines.push(`  • ${h.item.agentId} — ${h.item.purpose ?? 'no stated purpose'} (${h.why})`);
    }
    lines.push('  → `pd salvage claim <agent>` to resume it instead of restarting it.');
  }

  if (b.roadmap.length) {
    lines.push('', 'Roadmap items this may belong under:');
    for (const h of b.roadmap) {
      lines.push(`  • ${h.item.id} — ${h.item.title} (${h.why})`);
    }
  }

  if (b.notes.length) {
    lines.push('', 'Notes from earlier work like this:');
    for (const h of b.notes) {
      const who = h.item.agentId ? `${h.item.agentId}: ` : '';
      lines.push(`  • ${who}${oneLineNote(h.item.content)} (${h.why})`);
    }
  }

  if (b.skills.length) {
    lines.push('', 'Skills for this work:');
    for (const h of b.skills) {
      lines.push(`  • ${h.item.id} (${h.why})`);
    }
  }

  return lines.join('\n');
}
